/**
 * Chat with the Daily Guide, in English or Pidgin.
 *
 * Every question is first answered ON THE PHONE from the learned numbers, so chat works
 * with no network. If the user has switched on "Smarter answers (online)", the question,
 * that draft answer and a compact facts summary go to the Lightline backend, which asks an
 * LLM to phrase a natural reply using only those facts. Any failure falls back to the
 * on-device answer. Raw bank alerts, narrations and account digits are never sent.
 */
import { buildBrief } from './brief';
import { MIN_DAYS_FOR_PREDICTION, predictOutageWindow, predictReturnHour } from './learn';
import { durationLabel, hourLabel, naira, round1, shortBankName, timeLabel } from './format';
import type { AgentContext, ChatAnswer, Insight, LearnedPatterns } from './types';

type Lang = 'en' | 'pcm';

// Words that are clearly Pidgin. ("don" and "na" alone are left out: "don't" would match.)
const PIDGIN = /\b(wetin|dey|abeg|una|sabi|wahala|comot|abi|wey|howfar|shey|oya)\b|\bhow far\b|\bi go\b|\bmake i\b|\be don\b|\bi don\b|\bna (im|wetin|so)\b/i;

export function detectLang(q: string, fallback: Lang): Lang {
  if (PIDGIN.test(q)) return 'pcm';
  if (/\b(the|is|are|will|what|when|how much|my|should)\b/i.test(q)) return 'en';
  return fallback;
}

export type Intent =
  | 'FUEL_PRICE'
  | 'FUEL_WEEK'
  | 'GEN_LEFT'
  | 'LIGHT'
  | 'BANK'
  | 'SPEND'
  | 'FARE'
  | 'BRIEF'
  | 'HELP';

export function detectIntent(q: string): Intent {
  const s = q.toLowerCase();
  const fuel = /\b(fuel|petrol|pms|diesel|gas)\b/.test(s);
  if (/\b(fare|transport|bus|keke|okada|danfo|route|commute|brt)\b/.test(s)) return 'FARE';
  if (fuel && /\b(price|cost|cheap|cheapest|station|pump|how much (is|be|dey|e be))\b/.test(s)) return 'FUEL_PRICE';
  if (/\bgen(erator)?\b/.test(s) && /\b(left|remain|remaining|finish|last|enough|how long)\b/.test(s)) return 'GEN_LEFT';
  if (fuel && /\b(week|need|buy|how much|enough|last)\b/.test(s)) return 'FUEL_WEEK';
  if (/\b(light|nepa|phcn|power|current|electricity|outage)\b/.test(s)) return 'LIGHT';
  if (/\b(bank|transfer|app|pos|ussd|opay|moniepoint|palmpay|kuda|zenith|gtb|gtbank|access|uba|firstbank|first bank|network)\b/.test(s)) return 'BANK';
  if (/\b(spend|spent|money|budget|chop|expense|expenses|urgent|2k)\b/.test(s)) return 'SPEND';
  if (/\b(wetin dey|brief|summary|today|how far)\b/.test(s)) return 'BRIEF';
  if (fuel) return 'FUEL_WEEK';
  return 'HELP';
}

function fuelPrice(ctx: AgentContext, p: LearnedPatterns): { price: number; source: string } {
  if (p.fuel?.cheapest) return { price: p.fuel.cheapest.priceNgn, source: `the cheapest price reported in ${ctx.stateName}` };
  return { price: ctx.gen.fuelPricePerLitreNgn, source: 'your gen fuel price setting' };
}

/** Answers from on-device numbers only. Never needs the network. */
export function answerOnDevice(
  question: string,
  ctx: AgentContext,
  p: LearnedPatterns,
  insights: Insight[]
): ChatAnswer {
  const lang = detectLang(question, ctx.settings.language);
  const L = (en: string, pcm: string) => (lang === 'pcm' ? pcm : en);
  const intent = detectIntent(question);
  const area = ctx.zoneName.replace(/\s*\(.*\)$/, '');
  const base = { intent, lang, source: 'ON_DEVICE' as const };

  switch (intent) {
    case 'FUEL_WEEK': {
      const g = p.gen;
      if (g.daysOfData < 2) {
        return { ...base, text: L(
          `I need at least 2 days of generator use to work this out. Tap Start and Stop on the gen tracker when you run it. You have ${round1(ctx.genLiveFuelLitres)}L now.`,
          `I need at least 2 days of gen use to calculate am. Press Start and Stop for gen tracker anytime you on am. You get ${round1(ctx.genLiveFuelLitres)}L now.`),
          why: L(`Only ${g.daysOfData} day of gen runs recorded so far.`, `Na only ${g.daysOfData} day of gen run I don see.`) };
      }
      const need = Math.ceil(g.litresPerDay * 7);
      const toBuy = Math.max(0, Math.ceil(g.litresPerDay * 7 - ctx.genLiveFuelLitres));
      const { price, source } = fuelPrice(ctx, p);
      return { ...base,
        text: toBuy > 0
          ? L(`At your usual ${round1(g.litresPerDay)}L a day, you'll need about ${need}L this week. You have ${round1(ctx.genLiveFuelLitres)}L, so buy about ${toBuy}L (${naira(toBuy * price)} at ${naira(price)}/L).`,
              `As you dey use ${round1(g.litresPerDay)}L every day, you go need like ${need}L this week. You get ${round1(ctx.genLiveFuelLitres)}L, so buy like ${toBuy}L (${naira(toBuy * price)}, ${naira(price)}/L).`)
          : L(`You have ${round1(ctx.genLiveFuelLitres)}L, enough for the week at your usual ${round1(g.litresPerDay)}L a day.`,
              `You get ${round1(ctx.genLiveFuelLitres)}L, e go reach this week as you dey use ${round1(g.litresPerDay)}L every day.`),
        why: L(`From your last ${g.daysOfData} days of gen use and ${source}.`, `From your last ${g.daysOfData} days of gen use and ${source}.`) };
    }

    case 'GEN_LEFT': {
      const g = p.gen;
      if (g.daysLeft === null) {
        return { ...base, text: L(
          `You have ${round1(ctx.genLiveFuelLitres)}L. Run the gen through the app for 2 days and I'll tell you how long it lasts.`,
          `You get ${round1(ctx.genLiveFuelLitres)}L. Use the gen tracker for 2 days make I tell you how long e go last.`),
          why: L('Not enough generator history yet.', 'I never get enough gen history.') };
      }
      const left = durationLabel(g.daysLeft);
      return { ...base, text: L(
        `${round1(ctx.genLiveFuelLitres)}L left. That's ${left.en} at your usual ${round1(g.litresPerDay)}L a day (${round1(g.hoursPerDay)} hours of gen a day).`,
        `${round1(ctx.genLiveFuelLitres)}L remain. E go last ${left.pcm} as you dey use ${round1(g.litresPerDay)}L every day.`),
        why: L(`From your last ${g.daysOfData} days of generator runs.`, `From your last ${g.daysOfData} days of gen run.`) };
    }

    case 'LIGHT': {
      if (p.power.daysObserved < MIN_DAYS_FOR_PREDICTION) {
        return { ...base, text: L(
          `I'm still learning ${area}: ${p.power.daysObserved} of ${MIN_DAYS_FOR_PREDICTION} days of light reports. Tap "Up NEPA" or "They Took Light" when it changes.`,
          `I still dey learn ${area}: ${p.power.daysObserved} of ${MIN_DAYS_FOR_PREDICTION} days. Press "Up NEPA" or "They Took Light" anytime e change.`),
          why: L('Predictions start after 5 days of reports for your area.', 'I go start to predict after 5 days of report.') };
      }
      if (ctx.zoneState === 'OFF_GRID') {
        const back = predictReturnHour(p.power, ctx.now);
        return { ...base, text: back !== null
          ? L(`No light in ${area} now. It usually comes back around ${hourLabel(back)}.`, `Light no dey ${area} now. E dey usually return around ${hourLabel(back)}.`)
          : L(`No light in ${area} now, and there's no clear pattern for when it returns.`, `Light no dey ${area} now, and I no fit tell when e go return.`),
          why: L(`From ${p.power.daysObserved} days of light reports in ${area}.`, `From ${p.power.daysObserved} days of light report for ${area}.`) };
      }
      const win = predictOutageWindow(p.power, ctx.now);
      return { ...base, text: win
        ? L(`Light is likely to go ${timeLabel(win.start)}–${timeLabel(win.end)}. Charge your phone and power bank before then.`,
            `Light fit go ${timeLabel(win.start)}–${timeLabel(win.end)}. Charge phone and power bank before then.`)
        : L(`No regular outage is due in ${area} in the next 18 hours.`, `No regular outage for ${area} for the next 18 hours.`),
        why: win
          ? L(`It was off at that time on ${win.offDays} of the last ${win.seenDays} days with reports.`, `E go off that time ${win.offDays} of the last ${win.seenDays} days.`)
          : L(`From ${p.power.daysObserved} days of light reports.`, `From ${p.power.daysObserved} days of light report.`) };
    }

    case 'BANK': {
      const bankInsight = insights.find((i) => i.kind === 'BANK_DOWN');
      if (bankInsight) return { ...base, text: lang === 'pcm' ? bankInsight.titlePcm : bankInsight.title, why: bankInsight.why };
      const mine = p.bank.primaryInstitutionId ? ctx.bankWeather.find((w) => w.institutionId === p.bank.primaryInstitutionId) : undefined;
      if (mine) {
        return { ...base, text: L(
          `${shortBankName(mine.institutionName)} is working: app ${mine.appTransferSuccessPct}%, POS ${mine.posCardSuccessPct}%, USSD ${mine.ussdSuccessPct}%.`,
          `${shortBankName(mine.institutionName)} dey work: app ${mine.appTransferSuccessPct}%, POS ${mine.posCardSuccessPct}%, USSD ${mine.ussdSuccessPct}%.`),
          why: L('Your bank comes from your alerts; the figures are live reports from the last hour.', 'Your bank na from your alerts; the numbers na live report from last one hour.') };
      }
      const bad = ctx.bankWeather.filter((w) => w.statusAdvisory !== 'SMOOTH').map((w) => shortBankName(w.institutionName));
      return { ...base, text: bad.length
        ? L(`Having trouble now: ${bad.join(', ')}. Others are working.`, `Dem wey get wahala now: ${bad.join(', ')}. Others dey work.`)
        : L('All the banks I track are working normally right now.', 'All the banks wey I dey watch dey work well now.'),
        why: L('From live bank network reports. Paste a bank alert in Money so I can watch your own bank.', 'From live bank report. Paste one alert for Money make I watch your own bank.') };
    }

    case 'SPEND': {
      const s = p.spending;
      if (!ctx.ledger.length) {
        return { ...base, text: L(
          'Paste your bank alerts in the Money tab and I can track your spending. They stay on this phone.',
          'Paste your bank alerts for Money tab make I track your spending. E no go comot this phone.'),
          why: L('No bank alerts saved yet.', 'You never paste any alert.') };
      }
      const budget = ctx.settings.weeklyBudgetNgn;
      const budgetEn = budget ? ` Your weekly budget is ${naira(budget)}; at this pace you'll spend ${naira(s.weekProjected)}.` : '';
      const budgetPcm = budget ? ` Your budget na ${naira(budget)}; as you dey go, e go reach ${naira(s.weekProjected)}.` : '';
      return { ...base, text: L(
        `Today: ${naira(s.todaySpent)}. This week: ${naira(s.weekSpent)}${s.avgDailySpent ? `. Your usual day is ${naira(s.avgDailySpent)}` : ''}. Urgent 2k this week: ${s.urgentThisWeek}.${budgetEn}`,
        `Today: ${naira(s.todaySpent)}. This week: ${naira(s.weekSpent)}${s.avgDailySpent ? `. Normal day na ${naira(s.avgDailySpent)}` : ''}. Urgent 2k this week: ${s.urgentThisWeek}.${budgetPcm}`),
        why: L('Added up from the bank alerts saved on this phone.', 'I add am from the bank alerts wey dey this phone.') };
    }

    case 'FARE': {
      const c = p.commute;
      if (c.route && c.latestFare) {
        return { ...base, text: L(
          `${c.route}: ${naira(c.latestFare)} last time${c.usualFare ? `, usually ${naira(c.usualFare)}` : ''}.`,
          `${c.route}: ${naira(c.latestFare)} last time${c.usualFare ? `, e dey usually be ${naira(c.usualFare)}` : ''}.`),
          why: L(`From the ${c.reports} fares you reported for this route.`, `From the ${c.reports} fares wey you report.`) };
      }
      const fares = ctx.marketRadar.filter((m) => m.stateCode === ctx.stateCode && m.category === 'ROUTE_FARE').slice(0, 3);
      return { ...base, text: fares.length
        ? L(`Recent fares in ${ctx.stateName}: ${fares.map((f) => `${f.locationTitle} ${naira(f.priceNgn)}`).join('; ')}.`,
            `Fares for ${ctx.stateName}: ${fares.map((f) => `${f.locationTitle} ${naira(f.priceNgn)}`).join('; ')}.`)
        : L(`No fares reported in ${ctx.stateName} yet. Post your route fare in Fuel & Fare and I'll track it.`,
            `Nobody don post fare for ${ctx.stateName}. Post your route fare make I track am.`),
        why: L('From fare reports in your state.', 'From fare report for your state.') };
    }

    case 'FUEL_PRICE': {
      const f = p.fuel;
      if (!f?.cheapest) {
        return { ...base, text: L(`No petrol prices reported in ${ctx.stateName} this week.`, `Nobody post petrol price for ${ctx.stateName} this week.`), why: L('From fuel price reports in your state.', 'From fuel price report.') };
      }
      const trend = f.recentCount >= 2 && f.baselineCount >= 2 && Math.abs(f.changePct) >= 2
        ? L(` Prices are ${f.changePct > 0 ? 'up' : 'down'} ${Math.round(Math.abs(f.changePct))}% on last week.`, ` Price don ${f.changePct > 0 ? 'go up' : 'come down'} ${Math.round(Math.abs(f.changePct))}% from last week.`)
        : '';
      return { ...base, text: L(
        `Cheapest petrol reported: ${naira(f.cheapest.priceNgn)}/L at ${f.cheapest.location}.${trend}`,
        `Cheapest petrol: ${naira(f.cheapest.priceNgn)}/L for ${f.cheapest.location}.${trend}`),
        why: L(`From ${f.recentCount + f.baselineCount} price reports in ${ctx.stateName}.`, `From ${f.recentCount + f.baselineCount} price report for ${ctx.stateName}.`) };
    }

    case 'BRIEF': {
      const brief = buildBrief(ctx, p, insights, lang);
      return { ...base, text: [brief.greeting, ...brief.lines.map((l) => `${l.label}: ${l.text}`)].join('\n'),
        why: L('Your morning brief, built from the data on this phone.', 'Your morning brief, from the data for this phone.') };
    }

    default:
      return { ...base, text: L(
        'I can help with light, gen fuel, fuel prices, fares, your bank and your spending. Try: "How much fuel I go need this week?" or "When will light go tonight?"',
        'I fit help with light, gen fuel, fuel price, transport fare, your bank and your spending. Try: "How much fuel I go need this week?" or "Wetin dey today?"'),
        why: L("I didn't recognise the question.", 'I no understand the question well.') };
  }
}

/**
 * What may be sent to the online AI. Light, gen and price figures always; spending totals only
 * if the user switched on "Include money totals". Never alert text, names or account digits.
 */
export function buildFactsForAi(
  ctx: AgentContext,
  p: LearnedPatterns,
  insights: Insight[]
): Record<string, string | number | boolean | null> {
  const win = predictOutageWindow(p.power, ctx.now);
  const facts: Record<string, string | number | boolean | null> = {
    state: ctx.stateName,
    area: ctx.zoneName.replace(/\s*\(.*\)$/, ''),
    localTime: timeLabel(ctx.now),
    lightNow: ctx.zoneState,
    daysOfLightReports: p.power.daysObserved,
    likelyOutage: win ? `${timeLabel(win.start)}-${timeLabel(win.end)} (${win.offDays} of last ${win.seenDays} days)` : null,
    genFuelLitres: round1(ctx.genLiveFuelLitres),
    genLitresPerDay: round1(p.gen.litresPerDay),
    genDaysLeft: p.gen.daysLeft === null ? null : round1(p.gen.daysLeft),
    petrolCheapest: p.fuel?.cheapest ? `${naira(p.fuel.cheapest.priceNgn)}/L at ${p.fuel.cheapest.location}` : null,
    petrolChangePct: p.fuel && p.fuel.baselineCount >= 2 ? Math.round(p.fuel.changePct) : null,
    banksWithTrouble: ctx.bankWeather.filter((w) => w.statusAdvisory !== 'SMOOTH').map((w) => shortBankName(w.institutionName)).join(', ') || 'none',
    currentSuggestions: insights
      .filter((i) => ctx.settings.shareMoneyWithAi || !['SPENDING', 'URGENT_2K', 'BANK_DOWN'].includes(i.kind))
      .slice(0, 4)
      .map((i) => i.title)
      .join(' | ') || 'none'
  };
  if (ctx.settings.shareMoneyWithAi) {
    facts.myBank = p.bank.primaryInstitutionName;
    facts.spentToday = Math.round(p.spending.todaySpent);
    facts.spentThisWeek = Math.round(p.spending.weekSpent);
    facts.usualDailySpend = Math.round(p.spending.avgDailySpent);
    facts.urgent2kThisWeek = p.spending.urgentThisWeek;
    facts.weeklyBudget = ctx.settings.weeklyBudgetNgn;
  }
  return facts;
}

export interface AskOptions {
  online: boolean;
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function askGuide(
  question: string,
  ctx: AgentContext,
  p: LearnedPatterns,
  insights: Insight[],
  opts: AskOptions
): Promise<ChatAnswer> {
  const local = answerOnDevice(question, ctx, p, insights);
  // Answers that draw on bank alerts (spending, "your bank", the brief's money line) stay on
  // the phone unless the user allowed money totals online: the draft itself would reveal them.
  const usesAlerts = ['SPEND', 'BANK', 'BRIEF'].includes(local.intent);
  if (!ctx.settings.aiChatOnline || !opts.online || (usesAlerts && !ctx.settings.shareMoneyWithAi)) return local;

  const doFetch = opts.fetchImpl || globalThis.fetch;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await doFetch(opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question.slice(0, 300),
        lang: local.lang,
        draft: local.text,
        facts: buildFactsForAi(ctx, p, insights)
      }),
      signal: controller?.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { text?: unknown };
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text || text.length > 900) throw new Error('Empty or oversized reply');
    return { ...local, text, source: 'AI' };
  } catch {
    return {
      ...local,
      note: local.lang === 'pcm' ? 'I answer am for your phone (AI no reach now).' : 'Answered on your phone (the online AI was not reachable).'
    };
  } finally {
    clearTimeout(timer);
  }
}
