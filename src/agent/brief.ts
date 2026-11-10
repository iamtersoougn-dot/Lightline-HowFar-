/** The morning brief: "Wetin dey today?" in five or six short lines. Works fully offline. */
import { localDateKey, summarizeDay } from '../services/alertParser';
import { MIN_DAYS_FOR_PREDICTION, predictOutageWindow, predictReturnHour } from './learn';
import { dayKey, durationLabel, hourLabel, naira, round1, shortBankName, timeLabel } from './format';
import type { AgentContext, Insight, LearnedPatterns, MorningBrief } from './types';

export function buildBrief(
  ctx: AgentContext,
  p: LearnedPatterns,
  insights: Insight[],
  lang: 'en' | 'pcm' = ctx.settings.language
): MorningBrief {
  const L = (en: string, pcm: string) => (lang === 'pcm' ? pcm : en);
  const now = ctx.now;
  const h = now.getHours();
  const area = ctx.zoneName.replace(/\s*\(.*\)$/, '');
  const lines: MorningBrief['lines'] = [];

  // Light
  const win = predictOutageWindow(p.power, now);
  if (p.power.daysObserved < MIN_DAYS_FOR_PREDICTION) {
    lines.push({
      label: L('Light', 'Light'),
      text: L(
        `Still learning ${area}: ${p.power.daysObserved} of ${MIN_DAYS_FOR_PREDICTION} days of reports so far.`,
        `I still dey learn ${area}: ${p.power.daysObserved} of ${MIN_DAYS_FOR_PREDICTION} days of report.`
      ),
      tone: 'muted'
    });
  } else if (ctx.zoneState === 'OFF_GRID') {
    const back = predictReturnHour(p.power, now);
    lines.push({
      label: L('Light', 'Light'),
      text: back !== null
        ? L(`No light in ${area} now. It usually comes back around ${hourLabel(back)}.`, `Light no dey ${area} now. E dey usually return around ${hourLabel(back)}.`)
        : L(`No light in ${area} now.`, `Light no dey ${area} now.`),
      tone: 'bad'
    });
  } else if (win) {
    lines.push({
      label: L('Light', 'Light'),
      text: L(
        `Likely off ${timeLabel(win.start)}–${timeLabel(win.end)} (${win.offDays} of the last ${win.seenDays} days). Charge up before then.`,
        `E fit go ${timeLabel(win.start)}–${timeLabel(win.end)} (${win.offDays} of last ${win.seenDays} days). Charge before then.`
      ),
      tone: 'warn'
    });
  } else {
    lines.push({
      label: L('Light', 'Light'),
      text: L(`No regular outage expected in ${area} in the next few hours.`, `No regular outage for ${area} for now.`),
      tone: 'good'
    });
  }

  // Generator
  if (p.gen.daysLeft !== null) {
    const left = durationLabel(p.gen.daysLeft);
    lines.push({
      label: L('Gen fuel', 'Gen fuel'),
      text: L(
        `${round1(ctx.genLiveFuelLitres)}L left, ${left.en} at your usual ${round1(p.gen.litresPerDay)}L a day.`,
        `${round1(ctx.genLiveFuelLitres)}L remain, e go last ${left.pcm} (${round1(p.gen.litresPerDay)}L every day).`
      ),
      tone: p.gen.daysLeft <= 1 ? 'bad' : p.gen.daysLeft <= 3 ? 'warn' : 'good'
    });
  } else {
    lines.push({
      label: L('Gen fuel', 'Gen fuel'),
      text: L(
        `${round1(ctx.genLiveFuelLitres)}L in the tank. Start and stop the gen in the app for 2 days to get a forecast.`,
        `${round1(ctx.genLiveFuelLitres)}L dey tank. Start and stop gen for app for 2 days make I fit calculate.`
      ),
      tone: 'muted'
    });
  }

  // Fuel price
  const f = p.fuel;
  if (f && f.recentCount >= 2 && f.baselineCount >= 2 && Math.abs(f.changePct) >= 5) {
    const pct = Math.round(Math.abs(f.changePct));
    lines.push({
      label: L('Fuel price', 'Fuel price'),
      text: f.changePct > 0
        ? L(`Up ${pct}% this week in ${ctx.stateName}${f.cheapest ? `. Cheapest: ${naira(f.cheapest.priceNgn)} at ${f.cheapest.location}` : ''}.`,
            `E don go up ${pct}% for ${ctx.stateName}${f.cheapest ? `. Cheapest: ${naira(f.cheapest.priceNgn)} for ${f.cheapest.location}` : ''}.`)
        : L(`Down ${pct}% this week in ${ctx.stateName}.`, `E don come down ${pct}% for ${ctx.stateName}.`),
      tone: f.changePct > 0 ? 'warn' : 'good'
    });
  } else if (f?.cheapest) {
    lines.push({
      label: L('Fuel price', 'Fuel price'),
      text: L(`Cheapest reported: ${naira(f.cheapest.priceNgn)}/L at ${f.cheapest.location}.`, `Cheapest: ${naira(f.cheapest.priceNgn)}/L for ${f.cheapest.location}.`),
      tone: 'muted'
    });
  }

  // Bank
  const bankInsight = insights.find((i) => i.kind === 'BANK_DOWN');
  const myBank = p.bank.primaryInstitutionId
    ? ctx.bankWeather.find((w) => w.institutionId === p.bank.primaryInstitutionId)
    : undefined;
  if (bankInsight) {
    lines.push({ label: L('Your bank', 'Your bank'), text: lang === 'pcm' ? bankInsight.titlePcm : bankInsight.title, tone: 'bad' });
  } else if (myBank) {
    lines.push({
      label: L('Your bank', 'Your bank'),
      text: L(`${shortBankName(myBank.institutionName)} app working (${myBank.appTransferSuccessPct}%).`, `${shortBankName(myBank.institutionName)} app dey work (${myBank.appTransferSuccessPct}%).`),
      tone: 'good'
    });
  } else {
    lines.push({
      label: L('Your bank', 'Your bank'),
      text: L('Paste a bank alert in Money so I know which bank to watch for you.', 'Paste one bank alert for Money make I know which bank to watch for you.'),
      tone: 'muted'
    });
  }

  // Money: yesterday
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterday = summarizeDay(ctx.ledger, localDateKey(y.toISOString()));
  if (yesterday.spentNgn > 0) {
    const usual = p.spending.avgDailySpent;
    lines.push({
      label: L('Money', 'Money'),
      text: L(
        `Yesterday you spent ${naira(yesterday.spentNgn)}${usual ? ` (usual ${naira(usual)})` : ''}${yesterday.urgentCount ? `, ${yesterday.urgentCount} urgent 2k` : ''}.`,
        `Yesterday you spend ${naira(yesterday.spentNgn)}${usual ? ` (normal na ${naira(usual)})` : ''}${yesterday.urgentCount ? `, ${yesterday.urgentCount} urgent 2k` : ''}.`
      ),
      tone: usual && yesterday.spentNgn > usual * 1.5 ? 'warn' : 'muted'
    });
  }

  // Chores
  const pending = ctx.chores.filter((c) => !c.completed);
  if (pending.length) {
    lines.push({
      label: L('Chores', 'Chores'),
      text: L(
        `${pending.length} waiting for light: ${pending.slice(0, 2).map((c) => c.title.toLowerCase()).join(', ')}.`,
        `${pending.length} dey wait for light: ${pending.slice(0, 2).map((c) => c.title.toLowerCase()).join(', ')}.`
      ),
      tone: 'muted'
    });
  }

  const greeting =
    h < 12
      ? L('Good morning. Wetin dey today:', 'Good morning o. Wetin dey today:')
      : h < 17
      ? L('Good afternoon. Wetin dey:', 'Good afternoon. Wetin dey:')
      : L('Good evening. Wetin dey tonight:', 'Good evening. Wetin dey tonight:');

  return { dateKey: dayKey(now), greeting, lines };
}
