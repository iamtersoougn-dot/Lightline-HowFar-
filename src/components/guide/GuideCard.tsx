import React, { useState } from 'react';
import { BellRing, ChevronDown, ChevronUp, Settings2, Sparkles, Sunrise } from 'lucide-react';
import { MIN_DAYS_FOR_PREDICTION } from '../../agent/learn';
import { timeLabel } from '../../agent/format';
import type { GuideTab } from '../../agent/types';
import type { DailyGuide } from '../../hooks/useDailyGuide';
import InsightItem from './InsightItem';

const TONE = {
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  muted: 'text-slate-300'
};

interface Props {
  guide: DailyGuide;
  onOpenTab: (tab: GuideTab) => void;
  onOpenSettings: () => void;
}

/** The Daily Guide on the Today tab: morning brief, suggestions with reasons, what's planned. */
export default function GuideCard({ guide, onOpenTab, onOpenSettings }: Props) {
  const [showAll, setShowAll] = useState(false);
  const { run, settings, insights, briefOpen, setBriefOpen, plannedNudges } = guide;
  const lang = settings.language;
  const L = (en: string, pcm: string) => (lang === 'pcm' ? pcm : en);

  if (!run) return null;
  const learning = run.patterns.power.daysObserved < MIN_DAYS_FOR_PREDICTION;
  const shown = showAll ? insights : insights.slice(0, 3);

  return (
    <section
      aria-labelledby="guide-title"
      className="bg-gradient-to-b from-emerald-950/50 to-slate-900/90 border border-emerald-500/30 rounded-2xl p-3.5 space-y-3"
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-300">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="guide-title" className="text-sm font-extrabold text-white leading-tight">
            {L('Daily Guide', 'Daily Guide')}
          </h2>
          <p className="text-[11px] text-slate-400 truncate">
            {learning
              ? L(
                  `Learning your area: ${run.patterns.power.daysObserved} of ${MIN_DAYS_FOR_PREDICTION} days`,
                  `I dey learn your area: ${run.patterns.power.daysObserved} of ${MIN_DAYS_FOR_PREDICTION} days`
                )
              : L(
                  `Learning from ${guide.ctx?.journal.length ?? 0} events, all on this phone`,
                  `I dey learn from ${guide.ctx?.journal.length ?? 0} events for this phone`
                )}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Daily Guide settings"
          className="p-2 rounded-lg text-slate-300 hover:bg-slate-800"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Morning brief */}
      <div className="bg-slate-950/70 border border-slate-800 rounded-xl">
        <button
          type="button"
          onClick={() => setBriefOpen(!briefOpen)}
          aria-expanded={briefOpen}
          className="w-full flex items-center gap-2 px-3 py-2 text-left"
        >
          <Sunrise className="w-4 h-4 text-amber-300 shrink-0" />
          <span className="flex-1 text-[13px] font-bold text-white">{run.brief.greeting}</span>
          {briefOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>
        {briefOpen && (
          <ul className="px-3 pb-3 space-y-1.5">
            {run.brief.lines.map((l) => (
              <li key={l.label} className="grid grid-cols-[4.5rem_1fr] gap-2 text-[12px] leading-snug">
                <span className="text-slate-500 font-semibold">{l.label}</span>
                <span className={TONE[l.tone]}>{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Suggestions */}
      {insights.length > 0 ? (
        <div className="space-y-2">
          {shown.map((i) => (
            <InsightItem key={i.key} insight={i} lang={lang} onOpen={onOpenTab} onFeedback={guide.feedback} />
          ))}
          {insights.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-center text-[12px] font-semibold text-emerald-300 py-1"
            >
              {showAll ? L('Show fewer', 'Show small') : L(`Show all ${insights.length} suggestions`, `Show all ${insights.length}`)}
            </button>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-slate-400">
          {L(
            'Nothing needs your attention right now. Keep reporting light changes and using the gen tracker, and I will learn your pattern.',
            'Nothing dey wey you need worry about now. Dey report light and use gen tracker make I learn your pattern.'
          )}
        </p>
      )}

      {/* Planned nudges: shows the agent acting ahead of time, within your limits */}
      {plannedNudges.length > 0 && settings.frequency !== 'OFF' && (
        <div className="flex items-start gap-2 text-[11px] text-slate-400 border-t border-slate-800 pt-2.5">
          <BellRing className="w-3.5 h-3.5 mt-px text-emerald-300 shrink-0" />
          <p>
            <span className="font-semibold text-slate-300">{L('Planned reminders: ', 'Reminder wey I plan: ')}</span>
            {plannedNudges
              .map((n) => `${timeLabel(n.at)} ${shortKind(n.insight.kind, lang)}`)
              .join(' · ')}
          </p>
        </div>
      )}
    </section>
  );
}

function shortKind(kind: string, lang: 'en' | 'pcm'): string {
  const en: Record<string, string> = {
    POWER_OUTAGE: 'charge before light goes',
    CHORES_BEFORE_OUTAGE: 'do heavy chores',
    GEN_FUEL: 'buy gen fuel',
    FUEL_PRICE: 'fuel price',
    BANK_DOWN: 'bank problem',
    SPENDING: 'spending check',
    URGENT_2K: 'urgent 2k count',
    COMMUTE: 'fare change',
    POWER_RETURN: 'light coming back'
  };
  const pcm: Record<string, string> = {
    POWER_OUTAGE: 'charge before light go',
    CHORES_BEFORE_OUTAGE: 'do heavy work',
    GEN_FUEL: 'buy gen fuel'
  };
  return (lang === 'pcm' && pcm[kind]) || en[kind] || kind;
}
