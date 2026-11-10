import React from 'react';
import { Clapperboard } from 'lucide-react';
import { DEMO_TIMES } from '../../agent/demo';
import type { DailyGuide } from '../../hooks/useDailyGuide';

/** Demo mode controls: jump through the simulated day for filming. */
export default function DemoBar({ guide }: { guide: DailyGuide }) {
  const { demoTime, setDemoTime, ctx } = guide;
  const current = DEMO_TIMES.find((t) => t.hour === demoTime.hour && t.minute === demoTime.minute);
  return (
    <div className="bg-violet-950/60 border border-violet-500/40 rounded-xl p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Clapperboard className="w-4 h-4 text-violet-300 shrink-0" />
        <p className="flex-1 min-w-0 text-[11px] text-violet-100">
          <span className="font-bold">Demo week</span> · {ctx?.now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · Gwarinpa, Abuja
          {current && <span className="text-violet-300"> · {current.story}</span>}
        </p>
        <button type="button" onClick={() => guide.updateSettings({ demoMode: false })} className="text-[11px] font-semibold text-violet-200 underline underline-offset-2">
          Exit
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Demo time of day">
        {DEMO_TIMES.map((t) => {
          const on = t.hour === demoTime.hour && t.minute === demoTime.minute;
          return (
            <button
              key={t.label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDemoTime({ hour: t.hour, minute: t.minute })}
              className={`py-1.5 rounded-lg text-[11px] font-bold tabular-nums ${on ? 'bg-violet-400 text-slate-950' : 'bg-slate-900 text-violet-200 border border-violet-500/30'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
