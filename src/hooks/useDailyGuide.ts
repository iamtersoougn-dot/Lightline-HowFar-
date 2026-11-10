/**
 * Connects the Daily Guide to the app: builds the context (live or demo), runs the agent on a
 * battery-friendly schedule, applies the nudge limiter, schedules phone notifications on
 * Android, and exposes chat, feedback and settings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runAgent, type AgentRun } from '../agent/agent';
import { askGuide } from '../agent/chat';
import { buildDemoWorld } from '../agent/demo';
import {
  giveFeedback,
  planNudges,
  recordBrief,
  recordNudges,
  shouldShowBrief,
  type PlannedNudge
} from '../agent/governor';
import { AgentStore } from '../agent/store';
import type {
  AgentContext,
  AgentEvent,
  ChatAnswer,
  GovernorState,
  GuideSettings,
  Insight
} from '../agent/types';
import { MoneyLedger } from '../services/moneyLedger';
import type {
  BankWeatherItem,
  FeederZoneStatus,
  GeneratorState,
  MarketRadarItem,
  PowerTriggeredChore,
  StateCode
} from '../types/rhythm';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:4000';
const BRIEF_NOTIFICATION_ID = 900001;

export interface GuideInputs {
  stateCode: StateCode;
  stateName: string;
  zone: FeederZoneStatus | undefined;
  gen: GeneratorState;
  genLiveFuelLitres: number;
  bankWeather: BankWeatherItem[];
  marketRadar: MarketRadarItem[];
  chores: PowerTriggeredChore[];
  isOnline: boolean;
  batteryPct: number;
  isCharging: boolean;
  /** bump to make the Guide re-read bank alerts (e.g. after the Money tab changes them) */
  ledgerVersion: number;
}

function hashId(key: string): number {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % 800000) + 1000;
}

async function nativeNotifications() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return null;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return LocalNotifications;
  } catch {
    return null;
  }
}

export function useDailyGuide(inputs: GuideInputs) {
  const [settings, setSettingsState] = useState<GuideSettings>(() => AgentStore.getSettings());
  const [journalVersion, setJournalVersion] = useState(0);
  const [demoTime, setDemoTime] = useState<{ hour: number; minute: number }>({ hour: 12, minute: 30 });
  const [governor, setGovernor] = useState<GovernorState>(() => AgentStore.getGovernor(settings.demoMode));
  const [tick, setTick] = useState(() => Date.now());
  const [hiddenNudges, setHiddenNudges] = useState<string[]>([]);

  // Re-run every 15 minutes, or hourly when the battery is low and not charging
  const lowPower = inputs.batteryPct < 15 && !inputs.isCharging;
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), lowPower ? 60 * 60_000 : 15 * 60_000);
    return () => clearInterval(id);
  }, [lowPower]);

  const updateSettings = useCallback((patch: Partial<GuideSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      AgentStore.saveSettings(next);
      return next;
    });
  }, []);

  // ------------------------------------------------------------------ Observe: journal
  const record = useCallback((events: AgentEvent[]) => {
    if (AgentStore.addEvents(events)) setJournalVersion((v) => v + 1);
  }, []);

  // ------------------------------------------------------------------ Context (live or demo)
  const genFuelRounded = Math.round(inputs.genLiveFuelLitres * 10) / 10;
  const demo = settings.demoMode;

  const ctx: AgentContext | null = useMemo(() => {
    if (demo) return buildDemoWorld(new Date(), demoTime.hour, demoTime.minute, settings).ctx;
    if (!inputs.zone) return null;
    return {
      now: new Date(tick),
      stateCode: inputs.stateCode,
      stateName: inputs.stateName,
      zoneId: inputs.zone.zoneId,
      zoneName: inputs.zone.neighborhood,
      zoneState: inputs.zone.currentState,
      gen: inputs.gen,
      genLiveFuelLitres: genFuelRounded,
      bankWeather: inputs.bankWeather,
      marketRadar: inputs.marketRadar,
      chores: inputs.chores,
      ledger: MoneyLedger.getEntries(),
      journal: AgentStore.getJournal(),
      settings
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, demoTime, tick, journalVersion, inputs.ledgerVersion, inputs.stateCode, inputs.zone?.zoneId, inputs.zone?.currentState, inputs.gen, genFuelRounded, inputs.bankWeather, inputs.marketRadar, inputs.chores, settings]);

  const run: AgentRun | null = useMemo(() => (ctx ? runAgent(ctx) : null), [ctx]);

  // ------------------------------------------------------------------ Demo: fresh nudge history per time
  useEffect(() => {
    if (!demo) {
      setGovernor(AgentStore.getGovernor(false));
      return;
    }
    let g = AgentStore.getGovernor(true);
    g = { delivered: [], feedback: g.feedback, dismissedKeys: [], lastBriefDate: null };
    // For later times, act as if the 6am brief was already seen
    if (demoTime.hour > settings.briefHour) {
      const morning = buildDemoWorld(new Date(), settings.briefHour, 0, settings).ctx;
      g = recordBrief(g, runAgent(morning).insights, morning.now);
    }
    AgentStore.saveGovernor(g, true);
    setGovernor(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, demoTime.hour, demoTime.minute]);

  // The brief opens by itself once a day; whatever it says is then not pushed again today
  const [briefOpen, setBriefOpen] = useState(false);

  // ------------------------------------------------------------------ Act: plan + notify
  useEffect(() => {
    if (!run || !ctx) return;
    let g = AgentStore.getGovernor(demo);
    if (shouldShowBrief(g, settings, ctx.now)) {
      g = recordBrief(g, run.insights, ctx.now);
      AgentStore.saveGovernor(g, demo);
      setGovernor(g);
      setBriefOpen(true);
    }
    const plan = planNudges(run.insights, g, settings, ctx.now);
    if (!plan.scheduled.length) return;
    const next = recordNudges(g, plan.scheduled, ctx.now);
    AgentStore.saveGovernor(next, demo);
    setGovernor(next);

    // Real notifications only for real data, on the Android app
    if (demo) return;
    nativeNotifications().then(async (LN) => {
      if (!LN) return;
      let perm = await LN.checkPermissions().catch(() => null);
      // Ask once, the first time there is something worth reminding about (Android 13+)
      if (perm && perm.display !== 'granted' && perm.display !== 'denied') {
        let asked = false;
        try { asked = localStorage.getItem('lightline_notif_asked') === '1'; } catch { /* ignore */ }
        if (!asked) {
          try { localStorage.setItem('lightline_notif_asked', '1'); } catch { /* ignore */ }
          perm = await LN.requestPermissions().catch(() => perm);
        }
      }
      if (perm?.display !== 'granted') return;
      await LN.schedule({
        notifications: plan.scheduled.map((n) => ({
          id: hashId(n.insight.key),
          title: 'Lightline: Wetin dey?',
          body: settings.language === 'pcm' ? n.insight.titlePcm : n.insight.title,
          largeBody: `${settings.language === 'pcm' ? n.insight.titlePcm : n.insight.title}\n\nWhy: ${n.insight.why}`,
          schedule: { at: new Date(Math.max(n.at.getTime(), Date.now() + 5000)), allowWhileIdle: true }
        }))
      }).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Morning brief notification for tomorrow (Android), rescheduled whenever settings change
  useEffect(() => {
    if (demo) return;
    nativeNotifications().then(async (LN) => {
      if (!LN) return;
      await LN.cancel({ notifications: [{ id: BRIEF_NOTIFICATION_ID }] }).catch(() => undefined);
      if (settings.frequency === 'OFF') return;
      const perm = await LN.checkPermissions().catch(() => null);
      if (perm?.display !== 'granted') return;
      const at = new Date();
      at.setDate(at.getDate() + (at.getHours() >= settings.briefHour ? 1 : 0));
      at.setHours(settings.briefHour, 0, 0, 0);
      await LN.schedule({
        notifications: [{
          id: BRIEF_NOTIFICATION_ID,
          title: settings.language === 'pcm' ? 'Wetin dey today?' : 'Wetin dey today? Your morning brief',
          body: settings.language === 'pcm'
            ? 'Light, gen fuel, fuel price, your bank and money: open am.'
            : 'Light, gen fuel, fuel prices, your bank and money for today.',
          schedule: { at, allowWhileIdle: true }
        }]
      }).catch(() => undefined);
    });
  }, [demo, settings.briefHour, settings.frequency, settings.language]);

  /** Ask for notification permission (Android). Returns false on the web or if refused. */
  const enableNotifications = useCallback(async () => {
    const LN = await nativeNotifications();
    if (!LN) return false;
    const r = await LN.requestPermissions().catch(() => null);
    return r?.display === 'granted';
  }, []);

  // ------------------------------------------------------------------ Feedback
  const feedback = useCallback((insight: Insight, useful: boolean) => {
    setGovernor((g) => {
      const next = giveFeedback(g, insight, useful);
      AgentStore.saveGovernor(next, demo);
      return next;
    });
    if (!useful) setHiddenNudges((list) => [...list, insight.key]);
  }, [demo]);

  // ------------------------------------------------------------------ Chat
  const lastRun = useRef(run);
  lastRun.current = run;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const ask = useCallback(async (question: string): Promise<ChatAnswer | null> => {
    const r = lastRun.current;
    const c = ctxRef.current;
    if (!r || !c) return null;
    return askGuide(question, c, r.patterns, r.insights, {
      online: inputs.isOnline,
      endpoint: `${API_BASE_URL}/api/v1/agent/chat`
    });
  }, [inputs.isOnline]);

  /** Hide a nudge banner without counting it as "not useful". */
  const hideNudge = useCallback((key: string) => {
    setHiddenNudges((list) => [...list, key]);
  }, []);

  // What was pushed in the last 30 minutes (banner) and what is lined up for later today.
  // Both come from the nudge log, so they stay stable however often the agent re-runs.
  const { liveNudges, plannedNudges } = useMemo(() => {
    const live: Insight[] = [];
    const planned: PlannedNudge[] = [];
    if (!run || !ctx) return { liveNudges: live, plannedNudges: planned };
    const byKey = new Map(run.insights.map((i) => [i.key, i]));
    const now = ctx.now.getTime();
    for (const d of governor.delivered) {
      if (d.viaBrief) continue;
      const insight = byKey.get(d.key);
      if (!insight) continue;
      const at = new Date(d.at).getTime();
      if (at <= now + 60_000 && at >= now - 30 * 60_000 && !hiddenNudges.includes(d.key)) live.push(insight);
      else if (at > now + 60_000) planned.push({ insight, at: new Date(at) });
    }
    planned.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { liveNudges: live, plannedNudges: planned };
  }, [run, ctx, governor.delivered, hiddenNudges]);

  const forgetAll = useCallback(() => {
    AgentStore.forgetAll();
    setGovernor(AgentStore.getGovernor(demo));
    setJournalVersion((v) => v + 1);
  }, [demo]);

  const visibleInsights = useMemo(
    () => (run ? run.insights.filter((i) => !governor.dismissedKeys.includes(i.key)) : []),
    [run, governor.dismissedKeys]
  );

  return {
    settings,
    updateSettings,
    run,
    ctx,
    insights: visibleInsights,
    briefOpen,
    setBriefOpen,
    liveNudges,
    plannedNudges,
    feedback,
    hideNudge,
    ask,
    record,
    forgetAll,
    enableNotifications,
    demoTime,
    setDemoTime,
    journalCounts: useMemo(() => AgentStore.counts(), [journalVersion]),
    lowPower
  };
}

export type DailyGuide = ReturnType<typeof useDailyGuide>;
