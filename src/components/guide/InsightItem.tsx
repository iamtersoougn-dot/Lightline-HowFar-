import React, { useState } from 'react';
import { ArrowUpRight, Info, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { GuideTab, Insight } from '../../agent/types';

const STRIPE: Record<1 | 2 | 3, string> = {
  3: 'bg-rose-400',
  2: 'bg-amber-400',
  1: 'bg-slate-500'
};

interface Props {
  insight: Insight;
  lang: 'en' | 'pcm';
  onOpen: (tab: GuideTab) => void;
  onFeedback: (insight: Insight, useful: boolean) => void;
  compact?: boolean;
}

/** One suggestion: what to do, a one-line why, and quick feedback. */
export default function InsightItem({ insight, lang, onOpen, onFeedback, compact }: Props) {
  const [thanked, setThanked] = useState(false);
  const title = lang === 'pcm' ? insight.titlePcm : insight.title;

  return (
    <div className="relative bg-slate-950 border border-slate-800 rounded-xl pl-3.5 pr-3 py-2.5">
      <span className={`absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r ${STRIPE[insight.priority]}`} aria-hidden="true" />
      <p className="text-[13px] font-semibold text-white leading-snug">{title}</p>
      <p className="mt-1 flex items-start gap-1 text-[11px] text-slate-400 leading-snug">
        <Info className="w-3 h-3 mt-px shrink-0 text-slate-500" aria-hidden="true" />
        <span>
          <span className="font-semibold text-slate-300">{lang === 'pcm' ? 'Why I talk am: ' : 'Why: '}</span>
          {insight.why}
        </span>
      </p>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {insight.action && (
            <button
              type="button"
              onClick={() => onOpen(insight.action!.tab)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-slate-100 text-[11px] font-semibold"
            >
              {insight.action.label}
              <ArrowUpRight className="w-3 h-3" />
            </button>
          )}
          <span className="ml-auto flex items-center gap-1">
            {thanked ? (
              <span className="text-[11px] text-emerald-300">{lang === 'pcm' ? 'Thank you!' : 'Thanks, noted'}</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onFeedback(insight, true);
                    setThanked(true);
                  }}
                  aria-label="Useful"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-slate-800"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onFeedback(insight, false)}
                  aria-label="Not useful, hide this"
                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800 text-[11px]"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                  {lang === 'pcm' ? 'E no help' : 'Not useful'}
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
