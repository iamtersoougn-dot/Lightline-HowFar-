/**
 * Act, safely: the nudge limiter decides which suggestions become notifications, and when.
 *
 * Rules, in order:
 *  1. Nudges off → nothing.             6. Already told you (by a nudge or in the morning
 *  2. Dismissed by you → never.            brief) → never again.
 *  3. Not confident (< 60%) → never.    7. Quiet hours → moved to the end of quiet hours,
 *  4. Low priority → shown in the app      or dropped if it would be stale by then.
 *     only, never pushed.               8. Same kind within 4 hours → wait.
 *  5. Kind you marked "not useful"      9. Daily cap (Few = 3, Normal = 5) → the rest wait.
 *     → muted, or only if urgent.
 * The morning brief is separate: you asked for it, so it does not use up the cap, and
 * everything it already said is not pushed again that day.
 */
import { dayKey } from './format';
import type { GovernorState, GuideSettings, Insight, InsightKind, NudgeFrequency } from './types';

const HOUR = 3_600_000;

export const DAILY_CAP: Record<NudgeFrequency, number> = { OFF: 0, FEW: 3, NORMAL: 5 };
export const MIN_CONFIDENCE = 0.6;
export const KIND_COOLDOWN_HOURS = 4;
/** Any two nudges are at least this far apart, so they never arrive in a burst. */
export const MIN_GAP_MINUTES = 15;
const LOG_KEEP_DAYS = 14;

export interface PlannedNudge {
  insight: Insight;
  at: Date;
}

export interface NudgePlan {
  scheduled: PlannedNudge[];
  deferred: Array<{ insight: Insight; reason: string }>;
  suppressed: Array<{ insight: Insight; reason: string }>;
}

export function isQuietHour(hour: number, s: Pick<GuideSettings, 'quietStartHour' | 'quietEndHour'>): boolean {
  const { quietStartHour: a, quietEndHour: b } = s;
  if (a === b) return false;
  return a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

/** The first moment at or after `t` that is outside quiet hours. */
export function nextAllowedTime(t: Date, s: GuideSettings): Date {
  if (!isQuietHour(t.getHours(), s)) return t;
  const out = new Date(t);
  out.setMinutes(0, 0, 0);
  for (let i = 0; i < 24 && isQuietHour(out.getHours(), s); i++) out.setTime(out.getTime() + HOUR);
  return out;
}

export function kindMuteLevel(state: GovernorState, kind: InsightKind): 'none' | 'urgent-only' | 'muted' {
  const f = state.feedback[kind];
  if (!f) return 'none';
  if (f.notUseful >= 3 && f.notUseful > f.useful * 2) return 'muted';
  if (f.notUseful >= 2 && f.notUseful > f.useful) return 'urgent-only';
  return 'none';
}

export function planNudges(
  insights: Insight[],
  state: GovernorState,
  settings: GuideSettings,
  now: Date
): NudgePlan {
  const plan: NudgePlan = { scheduled: [], deferred: [], suppressed: [] };
  const cap = DAILY_CAP[settings.frequency];
  const sentKeys = new Set(state.delivered.map((d) => d.key));
  const dismissed = new Set(state.dismissedKeys);
  // Brief mentions block repeats but are not nudges: they skip the cap and the cooldown
  const log = state.delivered.filter((d) => !d.viaBrief).map((d) => ({ kind: d.kind, at: new Date(d.at) }));
  const countOn = (day: string) => log.filter((d) => dayKey(d.at) === day).length;

  // Most important first; among equals, the one that expires soonest
  const ordered = [...insights].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.validUntil.localeCompare(b.validUntil) ||
      b.confidence - a.confidence
  );

  for (const insight of ordered) {
    if (cap === 0) {
      plan.suppressed.push({ insight, reason: 'Nudges are turned off' });
      continue;
    }
    if (dismissed.has(insight.key)) {
      plan.suppressed.push({ insight, reason: 'You dismissed this' });
      continue;
    }
    if (insight.confidence < MIN_CONFIDENCE) {
      plan.suppressed.push({ insight, reason: 'Not sure enough yet' });
      continue;
    }
    if (insight.priority < 2) {
      plan.suppressed.push({ insight, reason: 'Shown in the app only (low priority)' });
      continue;
    }
    const mute = kindMuteLevel(state, insight.kind);
    if (mute === 'muted' || (mute === 'urgent-only' && insight.priority < 3)) {
      plan.suppressed.push({ insight, reason: 'You marked this kind of nudge not useful' });
      continue;
    }
    if (sentKeys.has(insight.key)) {
      plan.suppressed.push({ insight, reason: 'Already told you' });
      continue;
    }

    const wanted = new Date(Math.max(now.getTime(), new Date(insight.notifyAt || now).getTime()));
    let at = nextAllowedTime(wanted, settings);
    const validUntil = new Date(insight.validUntil).getTime();
    if (at.getTime() >= validUntil) {
      plan.deferred.push({ insight, reason: 'Falls in your quiet hours' });
      continue;
    }
    // Keep a gap from every other nudge
    const gap = MIN_GAP_MINUTES * 60_000;
    for (let i = 0; i < 8 && log.some((d) => Math.abs(d.at.getTime() - at.getTime()) < gap); i++) {
      at = nextAllowedTime(new Date(at.getTime() + gap), settings);
    }
    if (at.getTime() >= validUntil) {
      plan.deferred.push({ insight, reason: 'Too many nudges close together' });
      continue;
    }

    const tooClose = log.some(
      (d) => d.kind === insight.kind && Math.abs(d.at.getTime() - at.getTime()) < KIND_COOLDOWN_HOURS * HOUR
    );
    if (tooClose) {
      plan.deferred.push({ insight, reason: 'Told you something similar recently' });
      continue;
    }

    if (countOn(dayKey(at)) >= cap) {
      plan.deferred.push({ insight, reason: 'Daily nudge limit reached' });
      continue;
    }

    plan.scheduled.push({ insight, at });
    log.push({ kind: insight.kind, at });
    sentKeys.add(insight.key);
  }

  plan.scheduled.sort((a, b) => a.at.getTime() - b.at.getTime());
  return plan;
}

/** Records scheduled nudges so they count toward the cap and are never repeated. */
export function recordNudges(state: GovernorState, scheduled: PlannedNudge[], now: Date): GovernorState {
  const keepFrom = now.getTime() - LOG_KEEP_DAYS * 24 * HOUR;
  return {
    ...state,
    delivered: [
      ...state.delivered.filter((d) => new Date(d.at).getTime() >= keepFrom),
      ...scheduled.map((n) => ({ key: n.insight.key, kind: n.insight.kind, at: n.at.toISOString() }))
    ]
  };
}

/** The brief was shown: mark what it covered as told, so it is not pushed again today. */
export function recordBrief(state: GovernorState, insights: Insight[], now: Date): GovernorState {
  const sent = new Set(state.delivered.map((d) => d.key));
  return {
    ...state,
    lastBriefDate: dayKey(now),
    delivered: [
      ...state.delivered,
      ...insights
        .filter((i) => !sent.has(i.key))
        .map((i) => ({ key: i.key, kind: i.kind, at: now.toISOString(), viaBrief: true }))
    ]
  };
}

export function giveFeedback(state: GovernorState, insight: Insight, useful: boolean): GovernorState {
  const prev = state.feedback[insight.kind] || { useful: 0, notUseful: 0 };
  return {
    ...state,
    feedback: {
      ...state.feedback,
      [insight.kind]: useful
        ? { ...prev, useful: prev.useful + 1 }
        : { ...prev, notUseful: prev.notUseful + 1 }
    },
    dismissedKeys: useful
      ? state.dismissedKeys
      : [...state.dismissedKeys.slice(-200), insight.key]
  };
}

export function shouldShowBrief(state: GovernorState, settings: GuideSettings, now: Date): boolean {
  return now.getHours() >= settings.briefHour && state.lastBriefDate !== dayKey(now);
}
