import React, { useState } from 'react';
import { ShieldCheck, Trash2, X } from 'lucide-react';
import { hourLabel } from '../../agent/format';
import type { NudgeFrequency } from '../../agent/types';
import type { DailyGuide } from '../../hooks/useDailyGuide';

interface Props {
  guide: DailyGuide;
  onClose: () => void;
  showToast: (msg: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function Toggle({ id, checked, onChange, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-11 h-6 rounded-full transition disabled:opacity-40 ${checked ? 'bg-emerald-500' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${checked ? 'left-[1.375rem]' : 'left-0.5'}`} />
    </button>
  );
}

/** You stay in control: how often, when, what language, what (if anything) leaves the phone. */
export default function GuideSettings({ guide, onClose, showToast }: Props) {
  const { settings: s, updateSettings, journalCounts } = guide;
  const [confirmForget, setConfirmForget] = useState(false);
  const [budget, setBudget] = useState(s.weeklyBudgetNgn ? String(s.weeklyBudgetNgn) : '');
  const L = (en: string, pcm: string) => (s.language === 'pcm' ? pcm : en);

  const freq: Array<{ v: NudgeFrequency; label: string; sub: string }> = [
    { v: 'OFF', label: L('Off', 'Off'), sub: L('Brief only, in the app', 'Only brief, inside app') },
    { v: 'FEW', label: L('Few', 'Small'), sub: L('Up to 3 a day', 'Max 3 every day') },
    { v: 'NORMAL', label: L('Normal', 'Normal'), sub: L('Up to 5 a day', 'Max 5 every day') }
  ];

  const row = 'flex items-center justify-between gap-3 py-2.5';
  const select = 'bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="gs-title">
      <div className="w-full sm:max-w-md max-h-[90%] overflow-y-auto bg-slate-950 border border-slate-800 rounded-t-2xl sm:rounded-2xl px-4 pt-3 pb-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))' }}>
        <div className="flex items-center justify-between mb-2">
          <h2 id="gs-title" className="text-sm font-extrabold text-white">{L('Daily Guide settings', 'Daily Guide settings')}</h2>
          <button type="button" onClick={onClose} aria-label="Close settings" className="p-2 rounded-lg text-slate-300 hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mt-2">{L('Reminders', 'Reminders')}</h3>
        <div className="grid grid-cols-3 gap-2 mt-2" role="radiogroup" aria-label="How many reminders">
          {freq.map((f) => (
            <button
              key={f.v}
              type="button"
              role="radio"
              aria-checked={s.frequency === f.v}
              onClick={async () => {
                updateSettings({ frequency: f.v });
                if (f.v !== 'OFF') await guide.enableNotifications();
              }}
              className={`rounded-xl border px-2 py-2 text-left ${s.frequency === f.v ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900'}`}
            >
              <span className="block text-xs font-bold text-white">{f.label}</span>
              <span className="block text-[10px] text-slate-400">{f.sub}</span>
            </button>
          ))}
        </div>

        <div className={row}>
          <label htmlFor="gs-quiet-start" className="text-xs text-slate-200">{L('Quiet hours', 'Quiet time')}</label>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <select id="gs-quiet-start" className={select} value={s.quietStartHour} onChange={(e) => updateSettings({ quietStartHour: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            {L('to', 'reach')}
            <select id="gs-quiet-end" aria-label="Quiet hours end" className={select} value={s.quietEndHour} onChange={(e) => updateSettings({ quietEndHour: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </span>
        </div>

        <div className={row}>
          <label htmlFor="gs-brief" className="text-xs text-slate-200">{L('Morning brief from', 'Morning brief from')}</label>
          <select id="gs-brief" className={select} value={s.briefHour} onChange={(e) => updateSettings({ briefHour: Number(e.target.value) })}>
            {[4, 5, 6, 7, 8, 9].map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </div>

        <div className={row}>
          <label htmlFor="gs-budget" className="text-xs text-slate-200">{L('Weekly spending budget', 'Weekly budget')}</label>
          <span className="flex items-center gap-1">
            <span className="text-xs text-slate-400">₦</span>
            <input
              id="gs-budget"
              inputMode="numeric"
              value={budget}
              placeholder={L('Not set', 'No set')}
              onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => updateSettings({ weeklyBudgetNgn: budget ? Number(budget) : null })}
              className="w-24 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white text-right tabular-nums"
            />
          </span>
        </div>

        <div className={row}>
          <span className="text-xs text-slate-200">{L('Language', 'Language')}</span>
          <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
            {(['en', 'pcm'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={s.language === l} onClick={() => updateSettings({ language: l })} className={`px-2.5 py-1 text-[11px] rounded-md font-semibold ${s.language === l ? 'bg-emerald-500 text-slate-950' : 'text-slate-400'}`}>
                {l === 'en' ? 'English' : 'Pidgin'}
              </button>
            ))}
          </div>
        </div>

        <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mt-4">{L('Privacy', 'Privacy')}</h3>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-px" />
          {L(
            'The Guide learns and predicts on this phone. Your bank alerts and spending never leave it unless you allow money totals below.',
            'The Guide dey learn for this phone. Your bank alerts and spending no dey comot unless you allow money totals below.'
          )}
        </p>
        <div className={row}>
          <label htmlFor="gs-ai" className="text-xs text-slate-200">
            {L('Smarter chat answers (online)', 'Smarter chat answer (online)')}
            <span className="block text-[10px] text-slate-500">
              {L('Sends your question and a short summary of light, gen and price figures to our server for AI wording.', 'E go send your question and small summary of light, gen and price to our server.')}
            </span>
          </label>
          <Toggle id="gs-ai" checked={s.aiChatOnline} onChange={(v) => updateSettings({ aiChatOnline: v, shareMoneyWithAi: v ? s.shareMoneyWithAi : false })} />
        </div>
        <div className={row}>
          <label htmlFor="gs-money" className={`text-xs ${s.aiChatOnline ? 'text-slate-200' : 'text-slate-500'}`}>
            {L('Include money totals', 'Add money totals')}
            <span className="block text-[10px] text-slate-500">
              {L('Totals only (e.g. spent today). Never alert text, names or account digits.', 'Only totals. No alert text, names or account number.')}
            </span>
          </label>
          <Toggle id="gs-money" checked={s.shareMoneyWithAi} disabled={!s.aiChatOnline} onChange={(v) => updateSettings({ shareMoneyWithAi: v })} />
        </div>

        <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mt-4">{L('What the Guide has learned from', 'Wetin the Guide don learn from')}</h3>
        <p className="mt-2 text-[11px] text-slate-400 tabular-nums">
          {journalCounts.POWER} {L('light reports', 'light reports')} · {journalCounts.GEN_RUN} {L('gen runs', 'gen runs')} · {journalCounts.GEN_FUEL} {L('refuels', 'refuels')} · {journalCounts.PRICE} {L('prices', 'prices')} · {journalCounts.BANK} {L('bank reports', 'bank reports')}
          {L(' (kept up to 90 days, on this phone)', ' (90 days max, for this phone)')}
        </p>
        <div className="mt-2">
          {confirmForget ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-300">{L('Delete everything the Guide has learned?', 'Delete everything wey the Guide don learn?')}</span>
              <button type="button" onClick={() => { guide.forgetAll(); setConfirmForget(false); showToast(L('The Guide has forgotten everything.', 'The Guide don forget everything.')); }} className="px-2 py-1 rounded bg-rose-500 text-white font-bold">
                {L('Delete', 'Delete')}
              </button>
              <button type="button" onClick={() => setConfirmForget(false)} className="px-2 py-1 rounded bg-slate-800 text-slate-300">{L('Keep', 'Keep')}</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmForget(true)} className="inline-flex items-center gap-1 text-[11px] text-rose-300">
              <Trash2 className="w-3 h-3" />
              {L('Forget everything', 'Forget everything')}
            </button>
          )}
        </div>

        <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mt-4">{L('Demo', 'Demo')}</h3>
        <div className={row}>
          <label htmlFor="gs-demo" className="text-xs text-slate-200">
            {L('Demo week', 'Demo week')}
            <span className="block text-[10px] text-slate-500">{L('Shows a simulated week for an example user in Gwarinpa, Abuja. Your own data is not touched.', 'E show one example week for Gwarinpa, Abuja. Your own data no go change.')}</span>
          </label>
          <Toggle id="gs-demo" checked={s.demoMode} onChange={(v) => updateSettings({ demoMode: v })} />
        </div>
      </div>
    </div>
  );
}
