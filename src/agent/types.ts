/**
 * Daily Guide agent: shared types.
 *
 * The agent runs Observe → Learn → Decide → Act → Explain, entirely on the phone.
 * Only chat can (optionally) go online, and then only with a compact facts summary.
 */
import type {
  BankChannel,
  BankWeatherItem,
  GeneratorState,
  GridPowerState,
  MarketRadarItem,
  PowerTriggeredChore,
  StateCode,
  ZoneDisplayState
} from '../types/rhythm';
import type { LedgerEntry } from '../services/moneyLedger';

// ---------------------------------------------------------------- Observe

export type AgentEvent =
  | {
      id: string;
      t: 'POWER';
      at: string;
      zoneId: string;
      state: GridPowerState;
      source: 'SELF' | 'CROWD';
    }
  | { id: string; t: 'GEN_RUN'; at: string; startedAt: string; hours: number; litres: number }
  | { id: string; t: 'GEN_FUEL'; at: string; litres: number }
  | {
      id: string;
      t: 'BANK';
      at: string;
      institutionId: string;
      channel: BankChannel;
      outcome: 'INSTANT' | 'DELAYED' | 'FAILED_REVERSED' | 'HANGING';
    }
  | {
      id: string;
      t: 'PRICE';
      at: string;
      stateCode: StateCode;
      category: MarketRadarItem['category'];
      priceNgn: number;
      location: string;
      own: boolean;
    };

export type AgentEventType = AgentEvent['t'];

/** Everything the agent may look at for one run. Built from live app state or from demo mode. */
export interface AgentContext {
  now: Date;
  stateCode: StateCode;
  stateName: string;
  zoneId: string;
  zoneName: string;
  zoneState: ZoneDisplayState;
  gen: GeneratorState;
  genLiveFuelLitres: number;
  bankWeather: BankWeatherItem[];
  marketRadar: MarketRadarItem[];
  chores: PowerTriggeredChore[];
  ledger: LedgerEntry[];
  journal: AgentEvent[];
  settings: GuideSettings;
}

// ---------------------------------------------------------------- Learn

export interface PowerHour {
  hour: number; // 0–23 local
  pOff: number; // weighted chance of no light (0–1)
  daysSeen: number; // days with a known state at this hour
}

export interface PowerPattern {
  hours: PowerHour[];
  daysObserved: number;
  /** grid[d][h]: day d+1 days ago, hour h → 1 dark, 0 light, null unknown */
  grid: Array<Array<0 | 1 | null>>;
}

export interface OutageWindow {
  start: Date;
  end: Date; // exclusive
  probability: number;
  offDays: number; // past days this window was mostly dark
  seenDays: number; // past days with data for this window
}

export interface GenUsage {
  litresPerDay: number;
  hoursPerDay: number;
  daysOfData: number;
  daysLeft: number | null; // null when we have no usage yet
}

export interface PriceTrend {
  recentMedian: number;
  baselineMedian: number;
  changePct: number;
  recentCount: number;
  baselineCount: number;
  cheapest: { location: string; priceNgn: number } | null;
}

export interface BankHabit {
  primaryInstitutionId: string | null;
  primaryInstitutionName: string | null;
  alertsSeen: number;
  posShare: number; // share of debits that were POS
}

export interface SpendingPattern {
  todaySpent: number;
  avgDailySpent: number;
  daysOfData: number;
  weekSpent: number; // since Monday
  weekProjected: number;
  urgentThisWeek: number;
  urgentThisWeekNgn: number;
  urgentLastWeek: number;
}

export interface CommutePattern {
  route: string | null;
  latestFare: number | null;
  usualFare: number | null;
  reports: number;
}

export interface LearnedPatterns {
  power: PowerPattern;
  gen: GenUsage;
  fuel: PriceTrend | null;
  bank: BankHabit;
  spending: SpendingPattern;
  commute: CommutePattern;
}

// ---------------------------------------------------------------- Decide / Explain

export type InsightKind =
  | 'POWER_OUTAGE'
  | 'POWER_RETURN'
  | 'CHORES_BEFORE_OUTAGE'
  | 'GEN_FUEL'
  | 'FUEL_PRICE'
  | 'BANK_DOWN'
  | 'SPENDING'
  | 'URGENT_2K'
  | 'COMMUTE';

export type GuideTab = 'LIGHT_GEN' | 'BANK_WEATHER' | 'CHORE_QUEUE' | 'FUEL_RADAR' | 'MONEY';

export interface Insight {
  /** Stable for one occurrence (kind + day + subject), so the same thing is never nudged twice. */
  key: string;
  kind: InsightKind;
  priority: 1 | 2 | 3; // 3 = act now
  confidence: number; // 0–1
  title: string; // English
  titlePcm: string; // Nigerian Pidgin
  why: string; // one plain line: the reason and the data used
  dataUsed: string[]; // short labels, e.g. "12 days of light reports"
  action?: { label: string; tab: GuideTab };
  notifyAt?: string; // best time to nudge (ISO); defaults to now
  validUntil: string; // ISO
}

// ---------------------------------------------------------------- Act

export type NudgeFrequency = 'OFF' | 'FEW' | 'NORMAL';

export interface GuideSettings {
  frequency: NudgeFrequency;
  quietStartHour: number; // e.g. 22
  quietEndHour: number; // e.g. 6
  briefHour: number; // morning brief from this hour
  weeklyBudgetNgn: number | null;
  language: 'en' | 'pcm';
  aiChatOnline: boolean; // off until the user opts in
  shareMoneyWithAi: boolean; // separate opt-in; totals only, never alert text
  demoMode: boolean;
}

export interface NudgeLogEntry {
  key: string;
  kind: InsightKind;
  at: string;
  viaBrief?: boolean; // covered by the morning brief, not a separate nudge
}

export interface GovernorState {
  delivered: NudgeLogEntry[];
  feedback: Partial<Record<InsightKind, { useful: number; notUseful: number }>>;
  dismissedKeys: string[];
  lastBriefDate: string | null; // YYYY-MM-DD
}

export interface GovernorDecision {
  deliver: Insight[];
  deferred: Array<{ insight: Insight; reason: string }>;
  suppressed: Array<{ insight: Insight; reason: string }>;
}

export interface MorningBrief {
  dateKey: string;
  greeting: string;
  lines: Array<{ label: string; text: string; tone: 'good' | 'warn' | 'bad' | 'muted' }>;
}

export interface ChatAnswer {
  text: string;
  why: string;
  intent: string;
  lang: 'en' | 'pcm';
  source: 'ON_DEVICE' | 'AI';
  note?: string;
}
