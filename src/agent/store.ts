/**
 * On-device storage for the Daily Guide. Nothing here is synced or sent anywhere.
 * Every read and write tolerates blocked or full storage, so the app never crashes on it.
 */
import type { AgentEvent, GovernorState, GuideSettings } from './types';

const KEYS = {
  JOURNAL: 'lightline_agent_journal_v1',
  SETTINGS: 'lightline_agent_settings_v1',
  GOVERNOR: 'lightline_agent_governor_v1',
  DEMO_GOVERNOR: 'lightline_demo_governor_v1'
};

export const JOURNAL_MAX_EVENTS = 2000;
export const JOURNAL_MAX_DAYS = 90;

export const DEFAULT_SETTINGS: GuideSettings = {
  frequency: 'FEW',
  quietStartHour: 22,
  quietEndHour: 6,
  briefHour: 6,
  weeklyBudgetNgn: null,
  language: 'en',
  aiChatOnline: false,
  shareMoneyWithAi: false,
  demoMode: false
};

export const EMPTY_GOVERNOR: GovernorState = {
  delivered: [],
  feedback: {},
  dismissedKeys: [],
  lastBriefDate: null
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the agent keeps working from memory for this session
  }
}

/** Keeps the journal small: newest first, at most 2,000 events and 90 days. */
export function pruneJournal(events: AgentEvent[], now: Date): AgentEvent[] {
  const cutoff = now.getTime() - JOURNAL_MAX_DAYS * 86_400_000;
  return events
    .filter((e) => new Date(e.at).getTime() >= cutoff)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, JOURNAL_MAX_EVENTS);
}

export const AgentStore = {
  getJournal(): AgentEvent[] {
    return read<AgentEvent[]>(KEYS.JOURNAL, []);
  },

  /** Adds events whose id is not already stored. Returns true if anything was added. */
  addEvents(events: AgentEvent[], now: Date = new Date()): boolean {
    if (!events.length) return false;
    const current = this.getJournal();
    const seen = new Set(current.map((e) => e.id));
    const fresh = events.filter((e) => !seen.has(e.id));
    if (!fresh.length) return false;
    write(KEYS.JOURNAL, pruneJournal([...fresh, ...current], now));
    return true;
  },

  getSettings(): GuideSettings {
    return { ...DEFAULT_SETTINGS, ...read<Partial<GuideSettings>>(KEYS.SETTINGS, {}) };
  },

  saveSettings(settings: GuideSettings): void {
    write(KEYS.SETTINGS, settings);
  },

  getGovernor(demo: boolean): GovernorState {
    return { ...EMPTY_GOVERNOR, ...read<Partial<GovernorState>>(demo ? KEYS.DEMO_GOVERNOR : KEYS.GOVERNOR, {}) };
  },

  saveGovernor(state: GovernorState, demo: boolean): void {
    write(demo ? KEYS.DEMO_GOVERNOR : KEYS.GOVERNOR, state);
  },

  resetDemoGovernor(): void {
    write(KEYS.DEMO_GOVERNOR, EMPTY_GOVERNOR);
  },

  /** "Forget everything": the Guide's memory and nudge history. Settings are kept. */
  forgetAll(): void {
    write(KEYS.JOURNAL, []);
    write(KEYS.GOVERNOR, EMPTY_GOVERNOR);
    write(KEYS.DEMO_GOVERNOR, EMPTY_GOVERNOR);
  },

  counts(): Record<AgentEvent['t'], number> {
    const c = { POWER: 0, GEN_RUN: 0, GEN_FUEL: 0, BANK: 0, PRICE: 0 };
    for (const e of this.getJournal()) c[e.t]++;
    return c;
  }
};
