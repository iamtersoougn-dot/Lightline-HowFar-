/**
 * Demo mode: a simulated week for one example user, for filming the competition video.
 *
 * Persona: lives in Gwarinpa, Abuja (AEDC). Light usually goes 7pm–11pm, the gen covers the
 * evenings, petrol has risen about 8% this week, the Zenith app starts failing mid-morning,
 * and spending (with "urgent 2k" transfers) is running ahead of a ₦60,000 weekly budget.
 *
 * The demo day is always the most recent Thursday, so the week reads the same every time,
 * and a time slider moves "now" through that day (6am brief, midday, 6:15pm, 9pm).
 * Demo data is generated in memory and never written over the user's real data.
 */
import { INITIAL_BANK_WEATHER } from '../services/offlineSyncEngine';
import type { LedgerEntry } from '../services/moneyLedger';
import type {
  BankWeatherItem,
  GeneratorState,
  MarketRadarItem,
  PowerTriggeredChore,
  ZoneDisplayState
} from '../types/rhythm';
import type { AgentContext, AgentEvent, GuideSettings } from './types';

const HOUR = 3_600_000;
const MIN = 60_000;

export const DEMO_ZONE = {
  zoneId: 'fc-gwarinpa-01',
  zoneName: 'Gwarinpa (3rd Ave / 6th Ave Feeder)',
  stateCode: 'FC' as const,
  stateName: 'FCT Abuja'
};

export const DEMO_TIMES: Array<{ label: string; hour: number; minute: number; story: string }> = [
  { label: '6:00am', hour: 6, minute: 0, story: 'Morning brief' },
  { label: '12:30pm', hour: 12, minute: 30, story: 'Bank down, fuel up, over budget' },
  { label: '6:15pm', hour: 18, minute: 15, story: 'Charge now, do chores before 7pm' },
  { label: '9:00pm', hour: 21, minute: 0, story: 'No light, gen running' }
];

/** Small seeded random generator, so the demo week is identical on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midnight of the most recent Thursday on or before `real`. */
export function demoDayStart(real: Date): Date {
  const d = new Date(real.getFullYear(), real.getMonth(), real.getDate());
  const back = (d.getDay() - 4 + 7) % 7; // Thursday = 4
  d.setDate(d.getDate() - back);
  return d;
}

const at = (day: Date, daysBack: number, h: number, m = 0) =>
  new Date(day.getTime() - daysBack * 24 * HOUR + h * HOUR + m * MIN);

export interface DemoWorld {
  ctx: AgentContext;
  gen: GeneratorState;
}

export function buildDemoWorld(realNow: Date, hour: number, minute: number, settings: GuideSettings): DemoWorld {
  const day = demoDayStart(realNow);
  const now = at(day, 0, hour, minute);
  const rand = rng(20261112);
  const jitter = (max: number) => Math.round(rand() * max);
  const journal: AgentEvent[] = [];
  const zone = DEMO_ZONE.zoneId;
  let n = 0;
  const id = (p: string) => `demo-${p}-${n++}`;
  const power = (t: Date, state: 'ON_GRID' | 'OFF_GRID', source: 'SELF' | 'CROWD' = 'CROWD') =>
    journal.push({ id: id('pw'), t: 'POWER', at: t.toISOString(), zoneId: zone, state, source });

  // ---------------------------------------------------------------- Light + gen: last 7 days
  for (let d = 7; d >= 1; d--) {
    power(at(day, d, 5, 20 + jitter(25)), 'ON_GRID');
    if (d === 5 || d === 2) {
      // a short midday cut on two days: noise the pattern should ignore
      power(at(day, d, 13, jitter(20)), 'OFF_GRID');
      power(at(day, d, 14, 20 + jitter(20)), 'ON_GRID');
    }
    if (d === 4) continue; // one lucky evening with light
    const off = at(day, d, 19, jitter(12));
    const on = at(day, d, 22, 55 + jitter(20));
    power(off, 'OFF_GRID', d % 2 ? 'SELF' : 'CROWD');
    power(on, 'ON_GRID', 'CROWD');
    const start = new Date(off.getTime() + 8 * MIN);
    const hours = (on.getTime() - start.getTime()) / HOUR;
    journal.push({
      id: id('gen'), t: 'GEN_RUN', at: on.toISOString(), startedAt: start.toISOString(),
      hours: Math.round(hours * 100) / 100, litres: Math.round(hours * 1.35 * 100) / 100
    });
  }
  journal.push({ id: id('fuel'), t: 'GEN_FUEL', at: at(day, 3, 17, 40).toISOString(), litres: 10 });

  // Today
  power(at(day, 0, 5, 40), 'ON_GRID', 'SELF');
  const offToday = at(day, 0, 19, 4);
  if (now >= offToday) power(offToday, 'OFF_GRID', 'CROWD');

  // ---------------------------------------------------------------- Petrol prices + own fares
  const stations = ['Conoil, Gwarinpa 3rd Avenue', 'NNPC Mega Station, Wuse Zone 1', 'TotalEnergies, Kubwa Expressway', 'MRS, Life Camp'];
  const priceLog: Array<[number, number, number, number]> = [
    // daysBack, hour, station, price
    [9, 10, 1, 985], [8, 16, 2, 1000], [7, 9, 0, 980], [6, 12, 3, 990], [5, 8, 1, 995], [4, 17, 2, 1000],
    [1, 9, 1, 1075], [1, 15, 3, 1080], [0, 7, 0, 1060], [0, 8, 2, 1070]
  ];
  for (const [d, h, s, price] of priceLog) {
    journal.push({ id: id('px'), t: 'PRICE', at: at(day, d, h, 15).toISOString(), stateCode: 'FC', category: 'PMS_FUEL', priceNgn: price, location: stations[s], own: s === 0 });
  }
  const fares: Array<[number, number]> = [[8, 500], [7, 500], [3, 500], [1, 550], [0, 700]];
  for (const [d, price] of fares) {
    journal.push({ id: id('fare'), t: 'PRICE', at: at(day, d, 7, 50).toISOString(), stateCode: 'FC', category: 'ROUTE_FARE', priceNgn: price, location: 'Gwarinpa → Wuse (bus)', own: true });
  }

  const visible = journal.filter((e) => new Date(e.at) <= now);

  // ---------------------------------------------------------------- Bank alerts (Zenith user)
  type Row = [number, number, number, 'DEBIT' | 'CREDIT', number, string, LedgerEntry['category'], string?];
  const rows: Row[] = [
    // last week
    [10, 9, 10, 'CREDIT', 180000, 'SALARY OCT', 'INCOME'],
    [10, 18, 5, 'DEBIT', 6200, 'POS/WEB PMT SHOPRITE JABI', 'POS'],
    [9, 12, 30, 'DEBIT', 2000, 'NIP/OPAY/MUSA IBRAHIM/urgent 2k', 'URGENT_2K'],
    [9, 19, 0, 'DEBIT', 1500, 'MTN AIRTIME 0803', 'AIRTIME_DATA'],
    [8, 8, 40, 'DEBIT', 9800, 'POS/WEB PMT NNPC MEGA STATION WUSE', 'FUEL'],
    [7, 13, 10, 'DEBIT', 4500, 'POS WDL MONIEPOINT AGENT GWARINPA', 'POS'],
    [6, 10, 0, 'DEBIT', 2000, 'NIP/PALMPAY/CHIOMA OKAFOR', 'URGENT_2K'],
    [6, 17, 30, 'DEBIT', 5000, 'IKEDC PREPAID METER TOKEN', 'ELECTRICITY'],
    [5, 11, 0, 'DEBIT', 7300, 'POS/WEB PMT MARKET SQUARE GWARINPA', 'POS'],
    [4, 9, 0, 'DEBIT', 50, 'ELECTRONIC MONEY TRANSFER LEVY', 'BANK_CHARGE'],
    // this week (Mon = 3 days back)
    [3, 9, 20, 'DEBIT', 2000, 'NIP/OPAY/MUSA IBRAHIM/urgent 2k', 'URGENT_2K'],
    [3, 18, 0, 'DEBIT', 4500, 'POS/WEB PMT SPAR WUSE 2', 'POS'],
    [2, 10, 5, 'DEBIT', 2000, 'NIP/KUDA/AISHA BELLO', 'URGENT_2K'],
    [2, 16, 45, 'DEBIT', 2000, 'NIP/OPAY/TUNDE ADEBAYO', 'URGENT_2K'],
    [2, 20, 0, 'DEBIT', 1000, 'MTN DATA BUNDLE', 'AIRTIME_DATA'],
    [1, 8, 30, 'DEBIT', 10600, 'POS/WEB PMT CONOIL GWARINPA', 'FUEL'],
    [1, 14, 0, 'DEBIT', 3000, 'NIP/MONIEPOINT/EMEKA OBI', 'URGENT_2K'],
    [1, 19, 30, 'DEBIT', 6500, 'POS/WEB PMT CHICKEN REPUBLIC GWARINPA', 'POS'],
    // today
    [0, 8, 45, 'DEBIT', 3500, 'POS/WEB PMT MAMA NKECHI PROVISIONS', 'POS'],
    [0, 11, 5, 'DEBIT', 2000, 'NIP/OPAY/MUSA IBRAHIM/urgent 2k', 'URGENT_2K'],
    [0, 12, 0, 'DEBIT', 15000, 'NIP/GTB/LANDLORD ESTATE DUES', 'TRANSFER'],
    [0, 17, 20, 'DEBIT', 4000, 'POS WDL MONIEPOINT AGENT GWARINPA', 'POS']
  ];
  const ledger: LedgerEntry[] = rows
    .map(([d, h, m, direction, amountNgn, narration, category], i) => ({
      id: `demo-alert-${i}`,
      fingerprint: `demo-fp-${i}`,
      institution: 'Zenith Bank',
      direction,
      amountNgn,
      narration,
      category,
      occurredAtIso: at(day, d, h, m).toISOString(),
      maskedAccount: '••34'
    }))
    .filter((e) => new Date(e.occurredAtIso) <= now)
    .sort((a, b) => b.occurredAtIso.localeCompare(a.occurredAtIso));

  // ---------------------------------------------------------------- Live-looking state
  const zoneState: ZoneDisplayState = now >= offToday && hour < 23 ? 'OFF_GRID' : 'ON_GRID';
  const genRunning = now >= new Date(offToday.getTime() + 8 * MIN) && hour < 23;
  const genStart = new Date(offToday.getTime() + 8 * MIN);
  const fuelAtStart = 9.5;
  const live = genRunning ? Math.max(0, fuelAtStart - ((now.getTime() - genStart.getTime()) / HOUR) * 1.35) : fuelAtStart;

  const gen: GeneratorState = {
    isRunning: genRunning,
    startedAtIso: genRunning ? genStart.toISOString() : null,
    tankCapacityLitres: 15,
    fuelLevelAtStartLitres: fuelAtStart,
    currentFuelLitres: fuelAtStart,
    burnRateLitresPerHour: 1.35,
    fuelPricePerLitreNgn: 1070,
    inverterBatteryPct: 64,
    totalGenHoursThisWeek: 11.2
  };

  const bankWeather: BankWeatherItem[] = INITIAL_BANK_WEATHER.map((b) =>
    b.institutionId === 'zenith' && hour >= 9
      ? { ...b, appTransferSuccessPct: 41, posCardSuccessPct: 88, ussdSuccessPct: 70, avgLatencySec: 140, reportsLastHour: 52, statusAdvisory: 'HIGH_FAILURE_HOLD_ON' as const, lastUpdatedIso: now.toISOString() }
      : b.institutionId === 'zenith'
      ? { ...b, appTransferSuccessPct: 92, posCardSuccessPct: 94, ussdSuccessPct: 88, avgLatencySec: 12, reportsLastHour: 9, statusAdvisory: 'SMOOTH' as const, lastUpdatedIso: now.toISOString() }
      : { ...b, lastUpdatedIso: now.toISOString() }
  );

  const marketRadar: MarketRadarItem[] = visible
    .filter((e): e is Extract<AgentEvent, { t: 'PRICE' }> => e.t === 'PRICE' && e.category === 'PMS_FUEL')
    .slice(-4)
    .map((e) => ({
      id: e.id, stateCode: 'FC', category: 'PMS_FUEL', locationTitle: e.location, priceNgn: e.priceNgn,
      unitLabel: 'per Litre', queueSeverity: 'MOVING_FAST', posAccepted: true, notes: 'Demo data', reportedAtIso: e.at
    }));

  const chores: PowerTriggeredChore[] = [
    { id: 'demo-ch-1', title: 'Pump borehole water to overhead tank', category: 'WATER_PUMP', triggerCondition: 'ON_GRID_RESTORED', estimatedMinutes: 40, requiresHeavyLoad: true, completed: false, createdAtIso: at(day, 1, 9).toISOString() },
    { id: 'demo-ch-2', title: 'Iron work shirts for tomorrow', category: 'IRONING', triggerCondition: 'ON_GRID_RESTORED', estimatedMinutes: 30, requiresHeavyLoad: true, completed: false, createdAtIso: at(day, 1, 9).toISOString() },
    { id: 'demo-ch-3', title: 'Charge power bank and laptop', category: 'CHARGING', triggerCondition: 'ON_GRID_RESTORED', estimatedMinutes: 90, requiresHeavyLoad: false, completed: false, createdAtIso: at(day, 1, 9).toISOString() }
  ];

  return {
    gen,
    ctx: {
      now,
      stateCode: DEMO_ZONE.stateCode,
      stateName: DEMO_ZONE.stateName,
      zoneId: zone,
      zoneName: DEMO_ZONE.zoneName,
      zoneState,
      gen,
      genLiveFuelLitres: Math.round(live * 100) / 100,
      bankWeather,
      marketRadar,
      chores,
      ledger,
      journal: visible,
      settings: { ...settings, weeklyBudgetNgn: settings.weeklyBudgetNgn ?? 60000 }
    }
  };
}
