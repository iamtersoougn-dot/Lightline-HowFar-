import React from 'react';
import { Bell, X } from 'lucide-react';
import type { GuideTab, Insight } from '../../agent/types';

interface Props {
  nudges: Insight[];
  lang: 'en' | 'pcm';
  onOpen: (tab: GuideTab) => void;
  onDismiss: (insight: Insight) => void;
}

/** A nudge arriving now, styled like a phone notification (also shown in demo mode). */
export default function NudgeBanner({ nudges, lang, onOpen, onDismiss }: Props) {
  if (!nudges.length) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {nudges.slice(0, 2).map((n) => (
        <div key={n.key} className="flex items-start gap-2.5 bg-slate-800/95 border border-slate-700 rounded-2xl px-3 py-2.5 shadow-lg">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
            <Bell className="w-3.5 h-3.5" />
          </div>
          <button type="button" onClick={() => n.action && onOpen(n.action.tab)} className="min-w-0 flex-1 text-left">
            <span className="block text-[10px] uppercase tracking-wide text-slate-400">Lightline · {lang === 'pcm' ? 'now now' : 'now'}</span>
            <span className="block text-[13px] font-semibold text-white leading-snug">{lang === 'pcm' ? n.titlePcm : n.title}</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">{n.why}</span>
          </button>
          <button type="button" onClick={() => onDismiss(n)} aria-label="Dismiss" className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
