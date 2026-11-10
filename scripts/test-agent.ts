/**
 * Daily Guide agent tests: pattern learning, predictions, explanations, offline fallback,
 * privacy of what goes online, nudge limits, demo mode, storage limits and speed.
 * Run: npm test   (or: npx tsx scripts/test-agent.ts)
 */
process.env.TZ = 'Africa/Lagos';

// Minimal browser stand-ins for Node
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
};

const { learnPowerPattern, predictOutageWindow, learnGenUsage, learnFuelTrend, learnBankHabit, learnSpending, learnCommute, MIN_DAYS_FOR_PREDICTION } = await import('../src/agent/learn');
const { buildInsights } = await import('../src/agent/insights');
const { buildBrief } = await import('../src/agent/brief');
const { runAgent } = await import('../src/agent/agent');
const { planNudges, recordNudges, recordBrief, giveFeedback, kindMuteLevel, DAILY_CAP } = await import('../src/agent/governor');
const { answerOnDevice, askGuide, detectLang, detectIntent, buildFactsForAi } = await import('../src/agent/chat');
const { buildDemoWorld, demoDayStart } = await import('../src/agent/demo');
const { AgentStore, DEFAULT_SETTINGS, EMPTY_GOVERNOR, pruneJournal, JOURNAL_MAX_EVENTS } = await import('../src/agent/store');
const { INITIAL_BANK_WEATHER, INITIAL_GENERATOR_STATE } = await import('../src/services/offlineSyncEngine');
const { numbersAreGrounded, validateChatBody, createAgentChatHandler } = await import('../server/agentChat');

import type { AgentContext, AgentEvent, Insight, GuideSettings } from '../src/agent/types';
import type { LedgerEntry } from '../src/services/moneyLedger';

// ---------------------------------------------------------------- tiny harness
let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
  }
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------- builders
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ZONE = 'fc-test-zone';
const base = new Date(2026, 10, 12); // Thu 12 Nov 2026, local midnight
const at = (daysBack: number, h: number, m = 0) => new Date(base.getTime() - daysBack * DAY + h * HOUR + m * 60_000);
let seq = 0;
const ev = (e: Omit<AgentEvent, 'id'> & Record<string, unknown>) => ({ id: `t-${seq++}`, ...e }) as AgentEvent;

/** Light on at 5:30am every day; off between offH and onH on the given days back. */
function powerDays(days: number[], offH = 19, onH = 23, startFromDays = 14): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (let d = startFromDays; d >= 1; d--) {
    out.push(ev({ t: 'POWER', at: at(d, 5, 30).toISOString(), zoneId: ZONE, state: 'ON_GRID', source: 'CROWD' }));
    if (days.includes(d)) {
      out.push(ev({ t: 'POWER', at: at(d, offH, 5).toISOString(), zoneId: ZONE, state: 'OFF_GRID', source: 'CROWD' }));
      out.push(ev({ t: 'POWER', at: at(d, onH, 5).toISOString(), zoneId: ZONE, state: 'ON_GRID', source: 'CROWD' }));
    }
  }
  return out;
}

function ledgerRow(daysBack: number, h: number, amount: number, category: LedgerEntry['category'], institution = 'Zenith Bank', direction: 'DEBIT' | 'CREDIT' = 'DEBIT'): LedgerEntry {
  return {
    id: `l-${seq++}`, fingerprint: `f-${seq}`, institution, direction, amountNgn: amount,
    narration: `SECRET NARRATION ${seq} MUSA IBRAHIM`, category, occurredAtIso: at(daysBack, h).toISOString(), maskedAccount: '••34'
  };
}

function makeCtx(over: Partial<AgentContext> = {}, settings: Partial<GuideSettings> = {}): AgentContext {
  return {
    now: at(0, 12, 30),
    stateCode: 'FC',
    stateName: 'FCT Abuja',
    zoneId: ZONE,
    zoneName: 'Test Estate (Feeder 1)',
    zoneState: 'ON_GRID',
    gen: { ...INITIAL_GENERATOR_STATE, isRunning: false, startedAtIso: null },
    genLiveFuelLitres: 9.5,
    bankWeather: INITIAL_BANK_WEATHER,
    marketRadar: [],
    chores: [],
    ledger: [],
    journal: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
    ...over
  };
}

const insightOf = (kind: Insight['kind'], key = kind, priority: 1 | 2 | 3 = 2, notifyAt?: Date, validHours = 6, now = at(0, 12)): Insight => ({
  key, kind, priority, confidence: 0.9, title: `${kind} title`, titlePcm: `${kind} pcm`, why: 'Because of 3 reports', dataUsed: [],
  notifyAt: notifyAt?.toISOString(), validUntil: new Date((notifyAt || now).getTime() + validHours * HOUR).toISOString()
});

// ================================================================= LEARN
await test('power: learns a 7pm–11pm evening outage', () => {
  const p = learnPowerPattern(powerDays([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]), ZONE, at(0, 12));
  for (const h of [19, 20, 21, 22]) ok(p.hours[h].pOff > 0.7, `hour ${h} pOff ${p.hours[h].pOff.toFixed(2)}`);
  for (const h of [8, 12, 16, 23]) ok(p.hours[h].pOff < 0.3, `hour ${h} should be lit, pOff ${p.hours[h].pOff.toFixed(2)}`);
  ok(p.daysObserved >= 12, `daysObserved ${p.daysObserved}`);
});

await test('power: a lit evening with no new report still counts as lit', () => {
  const p = learnPowerPattern(powerDays([1, 2, 3, 5, 6, 7], 19, 23, 7), ZONE, at(0, 12, 30));
  const w = predictOutageWindow(p, at(0, 12, 30));
  ok(w, 'expected a window');
  ok(w!.seenDays === 7 && w!.offDays === 6, `expected 6 of 7, got ${w!.offDays} of ${w!.seenDays}`);
});

await test('power: no prediction with fewer than 5 days of reports', () => {
  const p = learnPowerPattern(powerDays([1, 2, 3], 19, 23, 3), ZONE, at(0, 12));
  ok(p.daysObserved < MIN_DAYS_FOR_PREDICTION, `daysObserved ${p.daysObserved}`);
  ok(predictOutageWindow(p, at(0, 12)) === null, 'should not predict yet');
});

await test('power: recent days outweigh older ones (pattern changed from 6pm to 8pm)', () => {
  const older = powerDays([6, 7, 8, 9, 10, 11, 12, 13, 14], 18, 20, 14).filter((e) => new Date(e.at) < at(5, 0));
  const recent = powerDays([1, 2, 3, 4, 5], 20, 23, 5);
  const p = learnPowerPattern([...older, ...recent], ZONE, at(0, 12));
  ok(p.hours[21].pOff > p.hours[18].pOff, `9pm ${p.hours[21].pOff.toFixed(2)} should beat 6pm ${p.hours[18].pOff.toFixed(2)}`);
});

await test('power: ignores reports from other areas', () => {
  const other = powerDays([1, 2, 3, 4, 5, 6, 7]).map((e) => ({ ...e, zoneId: 'other-zone' }) as AgentEvent);
  const p = learnPowerPattern(other, ZONE, at(0, 12));
  ok(p.daysObserved === 0, `daysObserved ${p.daysObserved}`);
});

await test('gen: litres per day and days left', () => {
  const runs: AgentEvent[] = [1, 2, 3, 4].map((d) => ev({ t: 'GEN_RUN', at: at(d, 22).toISOString(), startedAt: at(d, 19).toISOString(), hours: 3, litres: 4 }));
  const g = learnGenUsage(runs, 8, at(0, 0)); // 4 days covered, 16L
  ok(Math.abs(g.litresPerDay - 4) < 0.01, `litresPerDay ${g.litresPerDay}`);
  ok(g.daysLeft !== null && Math.abs(g.daysLeft - 2) < 0.01, `daysLeft ${g.daysLeft}`);
  ok(g.daysOfData === 4, `daysOfData ${g.daysOfData}`);
});

await test('gen: no forecast without at least 2 days of runs', () => {
  ok(learnGenUsage([], 10, at(0, 12)).daysLeft === null, 'no runs → null');
  const one = [ev({ t: 'GEN_RUN', at: at(0, 9).toISOString(), startedAt: at(0, 7).toISOString(), hours: 2, litres: 2.7 })];
  ok(learnGenUsage(one, 10, at(0, 12)).daysLeft === null, 'same-day runs → null');
});

await test('fuel: detects an 8% rise and the cheapest station', () => {
  const px = (d: number, price: number, loc: string) => ev({ t: 'PRICE', at: at(d, 10).toISOString(), stateCode: 'FC', category: 'PMS_FUEL', priceNgn: price, location: loc, own: false });
  const j = [px(8, 1000, 'A'), px(6, 990, 'B'), px(5, 1010, 'C'), px(1, 1085, 'D'), px(0, 1075, 'E'), px(0, 1080, 'F')];
  const t = learnFuelTrend(j, [], 'FC', at(0, 12))!;
  ok(Math.round(t.changePct) === 8, `changePct ${t.changePct}`);
  ok(t.cheapest?.location === 'E', `cheapest ${t.cheapest?.location}`);
  const other = learnFuelTrend(j, [], 'LA', at(0, 12));
  ok(other === null, 'other states are separate');
});

await test('fuel: no trend claim without enough reports', () => {
  const j = [ev({ t: 'PRICE', at: at(0, 9).toISOString(), stateCode: 'FC', category: 'PMS_FUEL', priceNgn: 1100, location: 'X', own: true })];
  const t = learnFuelTrend(j, [], 'FC', at(0, 12))!;
  ok(t.changePct === 0 && t.baselineCount === 0, 'no baseline → no change claimed');
});

await test('bank: primary bank from alerts, unknown ignored', () => {
  const l = [ledgerRow(1, 9, 100, 'POS'), ledgerRow(2, 9, 100, 'POS'), ledgerRow(3, 9, 100, 'TRANSFER', 'OPay'), ledgerRow(1, 10, 100, 'OTHER', 'Unknown bank'), ledgerRow(1, 11, 100, 'OTHER', 'Unknown bank'), ledgerRow(1, 12, 100, 'OTHER', 'Unknown bank')];
  const b = learnBankHabit(l, at(0, 12));
  ok(b.primaryInstitutionName === 'Zenith Bank' && b.primaryInstitutionId === 'zenith', `primary ${b.primaryInstitutionName}`);
});

await test('spending: today vs usual, urgent 2k this week vs last, future ignored', () => {
  // base is Thursday; Monday = 3 days back
  const l = [
    ...[4, 5, 6, 7, 8].map((d) => ledgerRow(d, 10, 5000, 'POS')),
    ledgerRow(0, 9, 15000, 'TRANSFER'),
    ledgerRow(0, 10, 2000, 'URGENT_2K'), ledgerRow(1, 10, 2000, 'URGENT_2K'), ledgerRow(2, 10, 2000, 'URGENT_2K'),
    ledgerRow(5, 10, 2000, 'URGENT_2K'),
    ledgerRow(0, 20, 99999, 'POS') // later today: must be ignored at 12:30
  ];
  const s = learnSpending(l, at(0, 12, 30));
  ok(s.todaySpent === 17000, `todaySpent ${s.todaySpent}`);
  ok(s.urgentThisWeek === 3 && s.urgentLastWeek === 1, `urgent ${s.urgentThisWeek}/${s.urgentLastWeek}`);
  ok(s.daysOfData >= 5, `daysOfData ${s.daysOfData}`);
});

await test('commute: latest fare vs usual on the most-reported route', () => {
  const f = (d: number, price: number, loc = 'Kubwa → Wuse') => ev({ t: 'PRICE', at: at(d, 7).toISOString(), stateCode: 'FC', category: 'ROUTE_FARE', priceNgn: price, location: loc, own: true });
  const c = learnCommute([f(5, 500), f(4, 500), f(2, 520), f(0, 700), f(1, 300, 'Elsewhere')], at(0, 12));
  ok(c.route === 'Kubwa → Wuse' && c.latestFare === 700 && c.usualFare === 500, JSON.stringify(c));
});

// ================================================================= DECIDE + EXPLAIN
const eveningJournal = powerDays([1, 2, 3, 5, 6, 7, 8, 9, 10]);

await test('insight: "charge now" appears within 8 hours of the outage, not at 6am', () => {
  const morning = runAgent(makeCtx({ journal: eveningJournal, now: at(0, 6) }));
  ok(!morning.insights.some((i) => i.kind === 'POWER_OUTAGE'), 'no outage nudge 13h ahead');
  ok(morning.brief.lines[0].text.includes('7:05pm') || morning.brief.lines[0].text.includes('7pm'), `brief light line: ${morning.brief.lines[0].text}`);
  const noon = runAgent(makeCtx({ journal: eveningJournal, now: at(0, 12, 30) }));
  const out = noon.insights.find((i) => i.kind === 'POWER_OUTAGE');
  ok(out, 'outage insight at 12:30');
  ok(/7pm–11pm/.test(out!.title), `title: ${out!.title}`);
  ok(/of the last \d+ days/.test(out!.why), `why: ${out!.why}`);
  ok(new Date(out!.notifyAt!).getHours() === 18, 'nudge planned for 6:15pm');
});

await test('insight: no light predictions while still learning', () => {
  const r = runAgent(makeCtx({ journal: powerDays([1, 2], 19, 23, 2) }));
  ok(!r.insights.some((i) => i.kind === 'POWER_OUTAGE' || i.kind === 'POWER_RETURN'), 'no light insights');
  ok(/learning/i.test(r.brief.lines[0].text), `brief: ${r.brief.lines[0].text}`);
});

await test('insight: light off now → when it usually returns', () => {
  const r = runAgent(makeCtx({ journal: eveningJournal, now: at(0, 21), zoneState: 'OFF_GRID' }));
  const back = r.insights.find((i) => i.kind === 'POWER_RETURN');
  ok(back && /11pm/.test(back.title), `return: ${back?.title}`);
  ok(!r.insights.some((i) => i.kind === 'POWER_OUTAGE'), 'no "will go off" while already off');
});

await test('insight: heavy chores before the outage, only while light is on', () => {
  const chores = [{ id: 'c', title: 'Pump water', category: 'WATER_PUMP' as const, triggerCondition: 'ON_GRID_RESTORED' as const, estimatedMinutes: 30, requiresHeavyLoad: true, completed: false, createdAtIso: at(1, 9).toISOString() }];
  const on = runAgent(makeCtx({ journal: eveningJournal, chores, now: at(0, 14) }));
  const c = on.insights.find((i) => i.kind === 'CHORES_BEFORE_OUTAGE');
  ok(c && new Date(c.notifyAt!).getHours() === 17, `chores nudge at 5pm, got ${c?.notifyAt}`);
  const off = runAgent(makeCtx({ journal: eveningJournal, chores, now: at(0, 14), zoneState: 'LOW_VOLTAGE' }));
  ok(!off.insights.some((i) => i.kind === 'CHORES_BEFORE_OUTAGE'), 'not when light is not fully on');
});

await test('insight: gen fuel warning only when 3 days or less', () => {
  const runs = (lpd: number) => [1, 2, 3, 4].map((d) => ev({ t: 'GEN_RUN', at: at(d, 22).toISOString(), startedAt: at(d, 19).toISOString(), hours: 3, litres: lpd }));
  const low = runAgent(makeCtx({ journal: runs(4), genLiveFuelLitres: 8, now: at(0, 0, 1) }));
  ok(low.insights.some((i) => i.kind === 'GEN_FUEL' && /about 2 days/.test(i.title)), 'expected ~2 days warning');
  const fine = runAgent(makeCtx({ journal: runs(1), genLiveFuelLitres: 12, now: at(0, 0, 1) }));
  ok(!fine.insights.some((i) => i.kind === 'GEN_FUEL'), 'no warning at 12 days');
});

await test('insight: bank down → use POS if POS works, else another bank', () => {
  const ledger = [ledgerRow(1, 9, 1000, 'POS'), ledgerRow(2, 9, 1000, 'POS')];
  const failing = (pos: number) => INITIAL_BANK_WEATHER.map((b) => b.institutionId === 'zenith' ? { ...b, appTransferSuccessPct: 40, posCardSuccessPct: pos, ussdSuccessPct: 50, statusAdvisory: 'HIGH_FAILURE_HOLD_ON' as const, reportsLastHour: 30 } : b);
  const a = runAgent(makeCtx({ ledger, bankWeather: failing(90) })).insights.find((i) => i.kind === 'BANK_DOWN');
  ok(a && /POS card/.test(a.title), `POS advice: ${a?.title}`);
  const b = runAgent(makeCtx({ ledger, bankWeather: failing(40) })).insights.find((i) => i.kind === 'BANK_DOWN');
  ok(b && /another account/.test(b.title), `other bank advice: ${b?.title}`);
  const none = runAgent(makeCtx({ ledger: [], bankWeather: failing(40) })).insights.find((i) => i.kind === 'BANK_DOWN');
  ok(!none, 'no "your bank" claim without your alerts');
});

await test('explain: every demo suggestion has an English and Pidgin title and a why with real numbers', () => {
  for (const h of [6, 12, 18, 21]) {
    const { ctx } = buildDemoWorld(new Date(2026, 10, 12), h, h === 12 || h === 18 ? (h === 18 ? 15 : 30) : 0, DEFAULT_SETTINGS);
    const r = runAgent(ctx);
    ok(r.insights.length > 0, `insights at ${h}`);
    for (const i of r.insights) {
      ok(i.title && i.titlePcm && i.title !== i.titlePcm, `${i.kind} needs both languages`);
      ok(i.why.length > 20 && /\d/.test(i.why), `${i.kind} why must cite numbers: "${i.why}"`);
      ok(!i.why.includes('\n'), 'why is one line');
      ok(i.confidence >= 0.5 && i.confidence <= 0.95, `${i.kind} confidence ${i.confidence}`);
    }
  }
});

// ================================================================= CHAT + OFFLINE FALLBACK
await test('chat: detects Pidgin vs English', () => {
  ok(detectLang('How much fuel I go need this week?', 'en') === 'pcm', 'I go → Pidgin');
  ok(detectLang('Wetin dey today?', 'en') === 'pcm', 'wetin → Pidgin');
  ok(detectLang("Don't tell me, what is the fuel price?", 'pcm') === 'en', "don't is not Pidgin");
});

await test('chat: understands the main questions', () => {
  const cases: Array<[string, string]> = [
    ['How much fuel I go need this week?', 'FUEL_WEEK'],
    ['How much is petrol at the cheapest station?', 'FUEL_PRICE'],
    ['How long will my gen fuel last?', 'GEN_LEFT'],
    ['When light go go tonight?', 'LIGHT'],
    ['Is my bank working?', 'BANK'],
    ['How much I don spend this week?', 'SPEND'],
    ['Wetin be the bus fare to Wuse?', 'FARE'],
    ['Wetin dey today?', 'BRIEF'],
    ['Tell me a joke', 'HELP']
  ];
  for (const [q, want] of cases) ok(detectIntent(q) === want, `"${q}" → ${detectIntent(q)}, wanted ${want}`);
});

const demoAt = (h: number, m: number, s: Partial<GuideSettings> = {}) => buildDemoWorld(new Date(2026, 10, 12), h, m, { ...DEFAULT_SETTINGS, ...s }).ctx;

await test('chat: fuel-for-the-week answer matches the gen-fuel suggestion', () => {
  const ctx = demoAt(12, 30);
  const r = runAgent(ctx);
  const a = answerOnDevice('How much fuel I go need this week?', ctx, r.patterns, r.insights);
  const gen = r.insights.find((i) => i.kind === 'GEN_FUEL')!;
  const litres = (s: string) => s.match(/buy (?:about|like) (\d+)L/i)?.[1];
  ok(a.lang === 'pcm' && a.source === 'ON_DEVICE', 'Pidgin, on device');
  ok(litres(a.text) && litres(a.text) === litres(gen.title), `chat ${litres(a.text)}L vs insight ${litres(gen.title)}L`);
});

await test('offline: no network → answered on the phone, nothing sent', async () => {
  const ctx = demoAt(12, 30, { aiChatOnline: true });
  const r = runAgent(ctx);
  let calls = 0;
  const a = await askGuide('When will light go?', ctx, r.patterns, r.insights, { online: false, endpoint: 'x', fetchImpl: (async () => { calls++; throw new Error('no'); }) as any });
  ok(calls === 0 && a.source === 'ON_DEVICE' && a.text.length > 10, 'offline answer without fetch');
});

await test('offline: AI switched off → never calls the server even when online', async () => {
  const ctx = demoAt(12, 30, { aiChatOnline: false });
  const r = runAgent(ctx);
  let calls = 0;
  await askGuide('When will light go?', ctx, r.patterns, r.insights, { online: true, endpoint: 'x', fetchImpl: (async () => { calls++; return new Response('{}'); }) as any });
  ok(calls === 0, 'must not call');
});

await test('offline: server error or timeout → phone answer with a note', async () => {
  const ctx = demoAt(12, 30, { aiChatOnline: true });
  const r = runAgent(ctx);
  const failing = (async () => new Response('busy', { status: 503 })) as any;
  const a = await askGuide('How much fuel I go need this week?', ctx, r.patterns, r.insights, { online: true, endpoint: 'x', fetchImpl: failing });
  ok(a.source === 'ON_DEVICE' && !!a.note, 'fallback with note');
  const hanging = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as any;
  const t0 = Date.now();
  const b = await askGuide('When will light go?', ctx, r.patterns, r.insights, { online: true, endpoint: 'x', fetchImpl: hanging, timeoutMs: 200 });
  ok(b.source === 'ON_DEVICE' && Date.now() - t0 < 2000, 'timeout falls back quickly');
});

await test('privacy: facts sent online never include alert text or account digits; money only if allowed', async () => {
  const sent: any[] = [];
  const fakeFetch = (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ text: 'Okay.' })); }) as any;
  const noMoney = demoAt(12, 30, { aiChatOnline: true, shareMoneyWithAi: false });
  const r1 = runAgent(noMoney);
  await askGuide('When will light go?', noMoney, r1.patterns, r1.insights, { online: true, endpoint: 'x', fetchImpl: fakeFetch });
  const money = demoAt(12, 30, { aiChatOnline: true, shareMoneyWithAi: true });
  const r2 = runAgent(money);
  await askGuide('How much have I spent this week?', money, r2.patterns, r2.insights, { online: true, endpoint: 'x', fetchImpl: fakeFetch });
  ok(sent.length === 2, `expected 2 requests, got ${sent.length}`);
  const [a, b] = sent.map((s) => JSON.stringify(s.facts));
  for (const body of [a, b]) {
    ok(!/NIP\/|POS\/WEB|MUSA|LANDLORD|••34|SALARY/.test(body), `alert text leaked: ${body.slice(0, 200)}`);
  }
  // Public bank-network status may be sent; which bank is YOURS, and your totals, may not
  ok(!/spentToday|myBank|Your Zenith/.test(a), 'no money or own-bank facts without permission');
  ok(/spentToday/.test(b) && /urgent2kThisWeek/.test(b), 'totals when allowed');
});

await test('privacy: spending, "my bank" and brief questions stay on the phone unless money sharing is on', async () => {
  const ctx = demoAt(12, 30, { aiChatOnline: true, shareMoneyWithAi: false });
  const r = runAgent(ctx);
  let calls = 0;
  const f = (async () => { calls++; return new Response('{"text":"x"}'); }) as any;
  const a = await askGuide('How much I don spend this week?', ctx, r.patterns, r.insights, { online: true, endpoint: 'x', fetchImpl: f });
  ok(calls === 0 && a.intent === 'SPEND' && /₦/.test(a.text), 'spending answered locally');
  await askGuide('Is my bank working?', ctx, r.patterns, r.insights, { online: true, endpoint: 'x', fetchImpl: f });
  await askGuide('Wetin dey today?', ctx, r.patterns, r.insights, { online: true, endpoint: 'x', fetchImpl: f });
  ok(calls === 0, `bank and brief answered locally (calls ${calls})`);
  await askGuide('When will light go?', ctx, r.patterns, r.insights, { online: true, endpoint: 'x', fetchImpl: f });
  ok(calls === 1, 'light question may go online');
});

await test('server: input checks, number grounding, no key → 503, ungrounded reply → draft', async () => {
  ok(validateChatBody({ question: '', lang: 'en', draft: '', facts: {} }).ok === false, 'empty question rejected');
  ok(validateChatBody({ question: 'hi', lang: 'fr', draft: '', facts: {} }).ok === false, 'bad lang rejected');
  ok(validateChatBody({ question: 'hi', lang: 'en', draft: '', facts: { a: { nested: 1 } } }).ok === false, 'nested facts rejected');
  ok(numbersAreGrounded('Buy about 20L for ₦21,200.', '{"x":"20L ₦21,200"}'), 'grounded numbers pass');
  ok(!numbersAreGrounded('Buy 35L.', '{"x":"20L"}'), 'invented number fails');

  const mockRes = () => { const r: any = { code: 200, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
  const req = (body: unknown) => ({ body, headers: {}, ip: '1.2.3.4' }) as any;
  const valid = { question: 'How much fuel?', lang: 'en', draft: 'Buy about 20L.', facts: { genLitresPerDay: 4.2 } };

  const noKey = mockRes();
  await createAgentChatHandler({ apiKey: undefined, model: 'm' })(req(valid), noKey);
  ok(noKey.code === 503, `no key → ${noKey.code}`);

  const llm = (text: string) => (async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }))) as any;
  const good = mockRes();
  await createAgentChatHandler({ apiKey: 'k', model: 'm', fetchImpl: llm('You need to buy about 20L this week.') })(req(valid), good);
  ok(good.body?.text?.includes('20L') && good.body.grounded === true, `grounded reply: ${JSON.stringify(good.body)}`);
  const bad = mockRes();
  await createAgentChatHandler({ apiKey: 'k', model: 'm', fetchImpl: llm('Buy 45L at ₦900.') })(req(valid), bad);
  ok(bad.body?.text === 'Buy about 20L.' && bad.body.grounded === false, `ungrounded → draft: ${JSON.stringify(bad.body)}`);

  const limited = createAgentChatHandler({ apiKey: 'k', model: 'm', fetchImpl: llm('Ok 20L.'), rateLimit: { max: 2, windowMs: 60_000 } });
  const codes: number[] = [];
  for (let i = 0; i < 3; i++) { const r = mockRes(); await limited(req(valid), r); codes.push(r.code); }
  ok(codes[2] === 429, `rate limit codes ${codes}`);
});

// ================================================================= NUDGE LIMITS
const S = (s: Partial<GuideSettings> = {}): GuideSettings => ({ ...DEFAULT_SETTINGS, ...s });
const noon = at(0, 12);

await test('nudges: Off sends nothing', () => {
  const p = planNudges([insightOf('GEN_FUEL', 'a', 3)], EMPTY_GOVERNOR, S({ frequency: 'OFF' }), noon);
  ok(p.scheduled.length === 0 && p.suppressed.length === 1, 'nothing scheduled');
});

await test('nudges: daily cap (Few = 3, Normal = 5)', () => {
  const kinds: Insight['kind'][] = ['GEN_FUEL', 'BANK_DOWN', 'SPENDING', 'COMMUTE', 'URGENT_2K', 'FUEL_PRICE', 'POWER_RETURN'];
  const many = kinds.map((k, i) => insightOf(k, `k${i}`, 3));
  ok(planNudges(many, EMPTY_GOVERNOR, S({ frequency: 'FEW' }), noon).scheduled.length === DAILY_CAP.FEW, 'few cap');
  ok(planNudges(many, EMPTY_GOVERNOR, S({ frequency: 'NORMAL' }), noon).scheduled.length === DAILY_CAP.NORMAL, 'normal cap');
  ok(DAILY_CAP.FEW === 3 && DAILY_CAP.NORMAL === 5, 'caps as documented');
});

await test('nudges: cap counts what was already sent today', () => {
  const sent = recordNudges(EMPTY_GOVERNOR, [{ insight: insightOf('GEN_FUEL', 'x1', 3), at: at(0, 7) }, { insight: insightOf('BANK_DOWN', 'x2', 3), at: at(0, 8) }], noon);
  const p = planNudges([insightOf('SPENDING', 'y1', 2), insightOf('COMMUTE', 'y2', 2)], sent, S(), noon);
  ok(p.scheduled.length === 1, `only 1 left today, got ${p.scheduled.length}`);
});

await test('nudges: quiet hours move a nudge to the morning, or drop it if stale', () => {
  const late = insightOf('GEN_FUEL', 'late', 3, at(0, 23), 12, at(0, 23));
  const p = planNudges([late], EMPTY_GOVERNOR, S(), at(0, 23));
  ok(p.scheduled.length === 1 && p.scheduled[0].at.getHours() === 6, `moved to 6am, got ${p.scheduled[0]?.at}`);
  const stale = insightOf('POWER_OUTAGE', 'stale', 3, at(0, 23), 1, at(0, 23));
  const q = planNudges([stale], EMPTY_GOVERNOR, S(), at(0, 23));
  ok(q.scheduled.length === 0 && q.deferred[0]?.reason.includes('quiet'), 'dropped');
});

await test('nudges: never the same thing twice', () => {
  const i = insightOf('BANK_DOWN', 'same', 3);
  const first = planNudges([i], EMPTY_GOVERNOR, S(), noon);
  const g = recordNudges(EMPTY_GOVERNOR, first.scheduled, noon);
  const again = planNudges([i], g, S(), at(0, 15));
  ok(first.scheduled.length === 1 && again.scheduled.length === 0, 'deduped');
});

await test('nudges: 4-hour cooldown per kind and 15-minute gap between any two', () => {
  const g = recordNudges(EMPTY_GOVERNOR, [{ insight: insightOf('BANK_DOWN', 'b1', 3), at: at(0, 11) }], noon);
  const p = planNudges([insightOf('BANK_DOWN', 'b2', 3)], g, S(), noon);
  ok(p.scheduled.length === 0 && p.deferred.length === 1, 'same kind within 4h waits');
  const burst = planNudges([insightOf('GEN_FUEL', 'g', 3), insightOf('BANK_DOWN', 'b', 3), insightOf('SPENDING', 's', 2)], EMPTY_GOVERNOR, S(), noon);
  const times = burst.scheduled.map((n) => n.at.getTime()).sort();
  for (let k = 1; k < times.length; k++) ok(times[k] - times[k - 1] >= 15 * 60_000, 'gap of 15 minutes');
});

await test('nudges: low priority and low confidence are never pushed', () => {
  const low = planNudges([insightOf('COMMUTE', 'c', 1)], EMPTY_GOVERNOR, S(), noon);
  ok(low.scheduled.length === 0, 'priority 1 stays in the app');
  const unsure = { ...insightOf('GEN_FUEL', 'u', 3), confidence: 0.55 };
  ok(planNudges([unsure], EMPTY_GOVERNOR, S(), noon).scheduled.length === 0, 'confidence < 0.6 not pushed');
});

await test('nudges: "not useful" twice → urgent only; three times → muted', () => {
  let g = EMPTY_GOVERNOR;
  g = giveFeedback(g, insightOf('SPENDING', 'n1'), false);
  g = giveFeedback(g, insightOf('SPENDING', 'n2'), false);
  ok(kindMuteLevel(g, 'SPENDING') === 'urgent-only', 'urgent-only after 2');
  ok(planNudges([insightOf('SPENDING', 'n3', 2)], g, S(), noon).scheduled.length === 0, 'priority 2 blocked');
  g = giveFeedback(g, insightOf('SPENDING', 'n4'), false);
  ok(kindMuteLevel(g, 'SPENDING') === 'muted', 'muted after 3');
  ok(planNudges([insightOf('SPENDING', 'n5', 3)], g, S(), noon).scheduled.length === 0, 'even urgent blocked');
  ok(g.dismissedKeys.includes('n1'), 'dismissed card stays hidden');
});

await test('nudges: what the morning brief said is not pushed again, and does not use the cap', () => {
  const brief = [insightOf('GEN_FUEL', 'gen', 3), insightOf('SPENDING', 'sp', 2)];
  const g = recordBrief(EMPTY_GOVERNOR, brief, at(0, 6));
  const p = planNudges([...brief, insightOf('BANK_DOWN', 'bk', 3), insightOf('POWER_OUTAGE', 'po', 3, at(0, 18, 15))], g, S(), noon);
  ok(p.scheduled.map((s) => s.insight.key).join(',') === 'bk,po', `got ${p.scheduled.map((s) => s.insight.key)}`);
});

await test('nudges: the demo day plans bank now, chores at 5pm, "charge now" at 6:15pm', () => {
  const ctx = demoAt(12, 30);
  const morning = demoAt(6, 0);
  const g = recordBrief(EMPTY_GOVERNOR, runAgent(morning).insights, morning.now);
  const plan = planNudges(runAgent(ctx).insights, g, ctx.settings, ctx.now);
  const got = plan.scheduled.map((s) => `${s.at.getHours()}:${String(s.at.getMinutes()).padStart(2, '0')} ${s.insight.kind}`);
  ok(got.join(' | ') === '12:30 BANK_DOWN | 17:00 CHORES_BEFORE_OUTAGE | 18:15 POWER_OUTAGE', got.join(' | '));
});

// ================================================================= DEMO + STORAGE + SPEED
await test('demo: same week every time, nothing from the future, real data untouched', () => {
  const before = JSON.stringify([...store.entries()]);
  const a = buildDemoWorld(new Date(2026, 10, 14), 12, 30, DEFAULT_SETTINGS).ctx;
  const b = buildDemoWorld(new Date(2026, 10, 14), 12, 30, DEFAULT_SETTINGS).ctx;
  ok(JSON.stringify(a.journal) === JSON.stringify(b.journal) && JSON.stringify(a.ledger) === JSON.stringify(b.ledger), 'deterministic');
  ok(demoDayStart(new Date(2026, 10, 14)).getDay() === 4, 'demo day is a Thursday');
  ok(a.journal.every((e) => new Date(e.at) <= a.now) && a.ledger.every((e) => new Date(e.occurredAtIso) <= a.now), 'no future events');
  ok(JSON.stringify([...store.entries()]) === before, 'demo writes nothing to storage');
});

await test('storage: journal is capped at 2,000 events and 90 days, duplicates skipped', () => {
  const now = new Date();
  const many: AgentEvent[] = Array.from({ length: 2600 }, (_, i) => ev({ t: 'GEN_FUEL', at: new Date(now.getTime() - i * 30 * 60_000).toISOString(), litres: 1 }));
  const old = ev({ t: 'GEN_FUEL', at: new Date(now.getTime() - 100 * DAY).toISOString(), litres: 1 });
  const pruned = pruneJournal([...many, old], now);
  ok(pruned.length === JOURNAL_MAX_EVENTS && !pruned.includes(old), `pruned ${pruned.length}`);
  AgentStore.forgetAll();
  ok(AgentStore.addEvents([many[0], many[1]]) === true, 'added');
  ok(AgentStore.addEvents([many[0]]) === false, 'duplicate skipped');
  ok(AgentStore.getJournal().length === 2, 'two stored');
  AgentStore.forgetAll();
  ok(AgentStore.getJournal().length === 0, 'forget everything clears memory');
});

await test('speed: full run on a full journal (2,000 events + 1,500 alerts) stays well under 100ms', () => {
  const journal: AgentEvent[] = [];
  for (let d = 90; d >= 1; d--) {
    for (let k = 0; k < 22; k++) journal.push(ev({ t: 'POWER', at: at(d, k, 10).toISOString(), zoneId: ZONE, state: k >= 19 ? 'OFF_GRID' : 'ON_GRID', source: 'CROWD' }));
  }
  const ledger = Array.from({ length: 1500 }, (_, i) => ledgerRow(i % 60, 9 + (i % 10), 1000 + i, i % 3 ? 'POS' : 'URGENT_2K'));
  const ctx = makeCtx({ journal: pruneJournal(journal, at(0, 12)), ledger });
  runAgent(ctx); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) runAgent(ctx);
  const ms = (performance.now() - t0) / 10;
  ok(ms < 100, `average run ${ms.toFixed(1)}ms`);
  console.log(`  (agent run with a full journal: ${ms.toFixed(1)}ms on this machine)`);
});

// ---------------------------------------------------------------- report
if (failures.length) {
  console.log(`${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
console.log(`ALL ${passed} AGENT TESTS PASS`);
