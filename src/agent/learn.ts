/**
 * Learn: turns the on-device journal and ledger into patterns.
 * Plain arithmetic, no ML library: cheap enough for a low-end phone and easy to explain.
 * Every function is pure (inputs in, numbers out), which is what the tests exercise.
 */
import { localDateKey } from '../services/alertParser';
import type { LedgerEntry } from '../services/moneyLedger';
import type { MarketRadarItem, StateCode } from '../types/rhythm';
import type {
  AgentContext,
  AgentEvent,
  BankHabit,
  CommutePattern,
  GenUsage,
  LearnedPatterns,
  OutageWindow,
  PowerPattern,
  PriceTrend,
  SpendingPattern
} from './types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

export const POWER_LOOKBACK_DAYS = 21;
/**
 * A report is trusted for this long. People report changes, not "still on", so a quiet
 * evening after a morning "light came" report still counts as lit.
 */
export const POWER_STALE_HOURS = 18;
/** Yesterday counts fully; each older day counts a bit less, so new patterns win quickly. */
export const POWER_DECAY = 0.88;
export const DARK_THRESHOLD = 0.6;
export const MIN_DAYS_FOR_PREDICTION = 5;

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ------------------------------------------------------------------ Light

/**
 * For each of the last 21 days and each hour, works out whether the area was dark,
 * using the most recent report before that hour (if it is less than 12 hours old).
 */
export function learnPowerPattern(journal: AgentEvent[], zoneId: string, now: Date): PowerPattern {
  const reports = journal
    .filter((e): e is Extract<AgentEvent, { t: 'POWER' }> => e.t === 'POWER' && e.zoneId === zoneId)
    .map((e) => ({ at: new Date(e.at).getTime(), off: e.state === 'OFF_GRID' }))
    .sort((a, b) => a.at - b.at);

  const today = startOfLocalDay(now);
  const grid: Array<Array<0 | 1 | null>> = [];
  const weightSum = new Array(24).fill(0);
  const offSum = new Array(24).fill(0);
  const daysSeen = new Array(24).fill(0);
  let daysObserved = 0;

  for (let d = 1; d <= POWER_LOOKBACK_DAYS; d++) {
    const dayStart = new Date(today);
    dayStart.setDate(today.getDate() - d);
    const row: Array<0 | 1 | null> = [];
    let known = 0;
    const w = Math.pow(POWER_DECAY, d - 1);

    let idx = -1; // index of the last report at or before the probe time
    for (let h = 0; h < 24; h++) {
      const probe = dayStart.getTime() + h * HOUR + HOUR / 2;
      while (idx + 1 < reports.length && reports[idx + 1].at <= probe) idx++;
      const last = idx >= 0 ? reports[idx] : null;
      if (!last || probe - last.at > POWER_STALE_HOURS * HOUR) {
        row.push(null);
        continue;
      }
      const dark = last.off ? 1 : 0;
      row.push(dark);
      known++;
      weightSum[h] += w;
      offSum[h] += w * dark;
      daysSeen[h] += 1;
    }
    grid.push(row);
    if (known >= 6) daysObserved++;
  }

  return {
    // Light smoothing (+0.5 / +1) keeps one or two reports from looking like certainty
    hours: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      pOff: (offSum[h] + 0.5) / (weightSum[h] + 1),
      daysSeen: daysSeen[h]
    })),
    daysObserved,
    grid
  };
}

/** The next stretch of at least 2 hours, within 18 hours, when the area is usually dark. */
export function predictOutageWindow(pattern: PowerPattern, now: Date): OutageWindow | null {
  if (pattern.daysObserved < MIN_DAYS_FOR_PREDICTION) return null;

  const isDark = (h: number) => {
    const p = pattern.hours[h];
    return p.pOff >= DARK_THRESHOLD && p.daysSeen >= 3;
  };

  const base = new Date(now);
  base.setMinutes(0, 0, 0);
  // Start from the next full hour if we are more than halfway through this one
  const startOffset = now.getMinutes() >= 30 ? 1 : 0;

  for (let i = startOffset; i < 18; i++) {
    const h = (base.getHours() + i) % 24;
    if (!isDark(h)) continue;

    let len = 1;
    while (len < 12 && isDark((h + len) % 24)) len++;
    if (len < 2) continue;

    const hours = Array.from({ length: len }, (_, k) => (h + k) % 24);
    const probability = hours.reduce((s, x) => s + pattern.hours[x].pOff, 0) / len;

    let offDays = 0;
    let seenDays = 0;
    for (const row of pattern.grid) {
      const vals = hours.map((x) => row[x]).filter((v): v is 0 | 1 => v !== null);
      if (vals.length * 2 < hours.length) continue;
      seenDays++;
      if (vals.reduce<number>((s, v) => s + v, 0) * 2 >= vals.length) offDays++;
    }

    const start = new Date(base.getTime() + i * HOUR);
    return {
      start,
      end: new Date(start.getTime() + len * HOUR),
      probability,
      offDays,
      seenDays
    };
  }
  return null;
}

/** When the light is off now: the hour it usually comes back, if the pattern is clear. */
export function predictReturnHour(pattern: PowerPattern, now: Date): number | null {
  if (pattern.daysObserved < MIN_DAYS_FOR_PREDICTION) return null;
  for (let i = 1; i <= 12; i++) {
    const h = (now.getHours() + i) % 24;
    const p = pattern.hours[h];
    if (p.daysSeen >= 3 && p.pOff <= 1 - DARK_THRESHOLD) return h;
  }
  return null;
}

// ------------------------------------------------------------------ Generator

export const GEN_LOOKBACK_DAYS = 14;

export function learnGenUsage(journal: AgentEvent[], liveFuelLitres: number, now: Date): GenUsage {
  const cutoff = now.getTime() - GEN_LOOKBACK_DAYS * DAY;
  const runs = journal.filter(
    (e): e is Extract<AgentEvent, { t: 'GEN_RUN' }> =>
      e.t === 'GEN_RUN' && new Date(e.startedAt).getTime() >= cutoff
  );
  if (!runs.length) return { litresPerDay: 0, hoursPerDay: 0, daysOfData: 0, daysLeft: null };

  const first = Math.min(...runs.map((r) => new Date(r.startedAt).getTime()));
  // Days covered: from the start of the first run's day up to now (fractional, at least 1)
  const span = Math.min(
    GEN_LOOKBACK_DAYS,
    Math.max(1, (now.getTime() - startOfLocalDay(new Date(first)).getTime()) / DAY)
  );
  const daysOfData = Math.max(1, Math.floor(span));
  const litres = runs.reduce((s, r) => s + r.litres, 0);
  const hours = runs.reduce((s, r) => s + r.hours, 0);
  const litresPerDay = litres / span;

  return {
    litresPerDay,
    hoursPerDay: hours / span,
    daysOfData,
    daysLeft: daysOfData >= 2 && litresPerDay > 0.05 ? liveFuelLitres / litresPerDay : null
  };
}

// ------------------------------------------------------------------ Prices

interface PricePoint {
  at: number;
  price: number;
  location: string;
}

function pricePoints(
  journal: AgentEvent[],
  radar: MarketRadarItem[],
  stateCode: StateCode,
  category: MarketRadarItem['category']
): PricePoint[] {
  const seen = new Set<string>();
  const out: PricePoint[] = [];
  for (const e of journal) {
    if (e.t !== 'PRICE' || e.stateCode !== stateCode || e.category !== category) continue;
    seen.add(e.id);
    out.push({ at: new Date(e.at).getTime(), price: e.priceNgn, location: e.location });
  }
  for (const r of radar) {
    if (r.stateCode !== stateCode || r.category !== category || seen.has(`price-${r.id}`)) continue;
    out.push({ at: new Date(r.reportedAtIso).getTime(), price: r.priceNgn, location: r.locationTitle });
  }
  return out;
}

/** Compares the last 2 days of petrol prices in the state with 3–10 days ago. */
export function learnFuelTrend(
  journal: AgentEvent[],
  radar: MarketRadarItem[],
  stateCode: StateCode,
  now: Date
): PriceTrend | null {
  const pts = pricePoints(journal, radar, stateCode, 'PMS_FUEL');
  if (!pts.length) return null;
  const t = now.getTime();
  const recent = pts.filter((p) => p.at <= t && t - p.at <= 2 * DAY);
  const baseline = pts.filter((p) => t - p.at > 3 * DAY && t - p.at <= 10 * DAY);
  const pool = recent.length ? recent : pts.filter((p) => p.at <= t && t - p.at <= 7 * DAY);
  const cheapestPt = pool.length ? pool.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const recentMedian = median(recent.map((p) => p.price));
  const baselineMedian = median(baseline.map((p) => p.price));

  return {
    recentMedian,
    baselineMedian,
    changePct:
      recent.length && baseline.length && baselineMedian > 0
        ? ((recentMedian - baselineMedian) / baselineMedian) * 100
        : 0,
    recentCount: recent.length,
    baselineCount: baseline.length,
    cheapest: cheapestPt ? { location: cheapestPt.location, priceNgn: cheapestPt.price } : null
  };
}

// ------------------------------------------------------------------ Bank & money

export function learnBankHabit(ledger: LedgerEntry[], now: Date): BankHabit {
  const cutoff = now.getTime() - 30 * DAY;
  const debits = ledger.filter(
    (e) => e.direction === 'DEBIT' && new Date(e.occurredAtIso).getTime() >= cutoff
  );
  const counts = new Map<string, number>();
  for (const e of debits) {
    if (e.institution === 'Unknown bank') continue;
    counts.set(e.institution, (counts.get(e.institution) || 0) + 1);
  }
  let primary: string | null = null;
  let best = 0;
  for (const [name, n] of counts) {
    if (n > best) {
      best = n;
      primary = name;
    }
  }
  return {
    primaryInstitutionName: primary,
    primaryInstitutionId: primary ? institutionIdFor(primary) : null,
    alertsSeen: debits.length,
    posShare: debits.length ? debits.filter((e) => e.category === 'POS').length / debits.length : 0
  };
}

/** Maps the parser's bank names to the bank-weather ids used across the app. */
export function institutionIdFor(name: string): string {
  const map: Record<string, string> = {
    OPay: 'opay',
    Moniepoint: 'moniepoint',
    PalmPay: 'palmpay',
    Kuda: 'kuda',
    GTBank: 'gtbank',
    'Zenith Bank': 'zenith',
    'Access Bank': 'access',
    FirstBank: 'firstbank',
    UBA: 'uba',
    'Fidelity Bank': 'fidelity',
    'Sterling Bank': 'sterling',
    'Wema / ALAT': 'wema',
    'Stanbic IBTC': 'stanbic',
    FCMB: 'fcmb',
    'Union Bank': 'union',
    Ecobank: 'ecobank',
    'Polaris Bank': 'polaris',
    'Keystone Bank': 'keystone'
  };
  return map[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function mondayOf(d: Date): Date {
  const s = startOfLocalDay(d);
  const dow = (s.getDay() + 6) % 7; // Monday = 0
  s.setDate(s.getDate() - dow);
  return s;
}

export function learnSpending(ledger: LedgerEntry[], now: Date): SpendingPattern {
  const todayKey = localDateKey(now.toISOString());
  const byDay = new Map<string, number>();
  const cutoff = startOfLocalDay(now).getTime() - 14 * DAY;
  const weekStart = mondayOf(now).getTime();
  const lastWeekStart = weekStart - 7 * DAY;

  let todaySpent = 0;
  let weekSpent = 0;
  let urgentThisWeek = 0;
  let urgentThisWeekNgn = 0;
  let urgentLastWeek = 0;

  for (const e of ledger) {
    if (e.direction !== 'DEBIT') continue;
    const at = new Date(e.occurredAtIso).getTime();
    if (at > now.getTime()) continue;
    const key = localDateKey(e.occurredAtIso);
    if (key === todayKey) todaySpent += e.amountNgn;
    else if (at >= cutoff) byDay.set(key, (byDay.get(key) || 0) + e.amountNgn);
    if (at >= weekStart) {
      weekSpent += e.amountNgn;
      if (e.category === 'URGENT_2K') {
        urgentThisWeek++;
        urgentThisWeekNgn += e.amountNgn;
      }
    } else if (at >= lastWeekStart && e.category === 'URGENT_2K') {
      urgentLastWeek++;
    }
  }

  const days = [...byDay.values()];
  const elapsedDays = Math.max(1, (now.getTime() - weekStart) / DAY);
  return {
    todaySpent,
    avgDailySpent: days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0,
    daysOfData: days.length,
    weekSpent,
    weekProjected: (weekSpent / elapsedDays) * 7,
    urgentThisWeek,
    urgentThisWeekNgn,
    urgentLastWeek
  };
}

// ------------------------------------------------------------------ Commute

/** The route the user reports fares for most often, and how today's fare compares. */
export function learnCommute(journal: AgentEvent[], now: Date): CommutePattern {
  const fares = journal
    .filter(
      (e): e is Extract<AgentEvent, { t: 'PRICE' }> =>
        e.t === 'PRICE' && e.own && e.category === 'ROUTE_FARE' && new Date(e.at) <= now
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  if (!fares.length) return { route: null, latestFare: null, usualFare: null, reports: 0 };

  const counts = new Map<string, number>();
  for (const f of fares) {
    const k = f.location.trim().toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const topKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const route = fares.filter((f) => f.location.trim().toLowerCase() === topKey);
  const older = route.slice(1).map((f) => f.priceNgn);
  return {
    route: route[0].location,
    latestFare: route[0].priceNgn,
    usualFare: older.length >= 2 ? median(older) : null,
    reports: route.length
  };
}

// ------------------------------------------------------------------ All together

export function learnAll(ctx: AgentContext): LearnedPatterns {
  return {
    power: learnPowerPattern(ctx.journal, ctx.zoneId, ctx.now),
    gen: learnGenUsage(ctx.journal, ctx.genLiveFuelLitres, ctx.now),
    fuel: learnFuelTrend(ctx.journal, ctx.marketRadar, ctx.stateCode, ctx.now),
    bank: learnBankHabit(ctx.ledger, ctx.now),
    spending: learnSpending(ctx.ledger, ctx.now),
    commute: learnCommute(ctx.journal, ctx.now)
  };
}
