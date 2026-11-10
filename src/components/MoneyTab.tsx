import React, { useMemo, useState } from 'react';
import { ClipboardPaste, Fuel, ShieldCheck, Trash2, Wallet, X } from 'lucide-react';
import {
  CATEGORY_LABELS,
  SAMPLE_ALERTS,
  SpendCategory,
  localDateKey,
  summarizeDay
} from '../services/alertParser';
import { LedgerEntry, MoneyLedger } from '../services/moneyLedger';

interface MoneyTabProps {
  fuelPricePerLitreNgn: number;
  tankSpaceLitres: number;
  onAddFuelToGen: (litres: number) => void;
  showToast: (msg: string) => void;
}

const CATEGORY_COLORS: Record<SpendCategory, string> = {
  POS: 'bg-sky-400',
  FUEL: 'bg-orange-400',
  URGENT_2K: 'bg-rose-400',
  BANK_CHARGE: 'bg-amber-300',
  AIRTIME_DATA: 'bg-violet-400',
  ELECTRICITY: 'bg-emerald-400',
  TRANSFER: 'bg-slate-300',
  INCOME: 'bg-emerald-400',
  OTHER: 'bg-slate-500'
};

const THRESHOLDS = [2000, 5000, 10000];
const naira = (n: number) =>
  `₦${n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 })}`;

export default function MoneyTab({
  fuelPricePerLitreNgn,
  tankSpaceLitres,
  onAddFuelToGen,
  showToast
}: MoneyTabProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>(() => MoneyLedger.getEntries());
  const [threshold, setThreshold] = useState<number>(() => MoneyLedger.getUrgentThreshold());
  const [pasteText, setPasteText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Default to the most recent day that has alerts, so pasted older alerts still show
  const dayKeys = useMemo(() => {
    const keys = Array.from(new Set(entries.map((e) => localDateKey(e.occurredAtIso))));
    return keys.sort().reverse();
  }, [entries]);
  const todayKey = localDateKey(new Date().toISOString());
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const activeDay = pickedDay || (dayKeys.includes(todayKey) ? todayKey : dayKeys[0] || todayKey);

  const summary = useMemo(() => summarizeDay(entries, activeDay), [entries, activeDay]);
  const dayEntries = useMemo(
    () => entries.filter((e) => localDateKey(e.occurredAtIso) === activeDay),
    [entries, activeDay]
  );

  const weekSpend = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    let total = 0;
    let fuel = 0;
    let urgent = 0;
    let fees = 0;
    for (const e of entries) {
      if (e.direction !== 'DEBIT' || new Date(e.occurredAtIso).getTime() < cutoff) continue;
      total += e.amountNgn;
      if (e.category === 'FUEL') fuel += e.amountNgn;
      if (e.category === 'URGENT_2K') urgent += e.amountNgn;
      if (e.category === 'BANK_CHARGE') fees += e.amountNgn;
    }
    return { total, fuel, urgent, fees };
  }, [entries]);

  const categoryRows = (Object.entries(summary.byCategory) as Array<[SpendCategory, number]>)
    .sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...categoryRows.map(([, v]) => v));

  const handleImport = (text: string) => {
    if (!text.trim()) return;
    const result = MoneyLedger.importText(text);
    setEntries(result.entries);
    setPasteText('');
    if (result.added.length > 0) {
      setPickedDay(localDateKey(result.added[0].occurredAtIso));
    }
    const parts = [`Added ${result.added.length} alert${result.added.length === 1 ? '' : 's'}`];
    if (result.duplicates) parts.push(`${result.duplicates} already saved`);
    if (result.unreadable) parts.push(`${result.unreadable} couldn't be read`);
    showToast(`💳 ${parts.join(', ')}.`);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setPasteText(text);
    } catch {
      showToast('Long-press the box below and choose Paste.');
    }
  };

  const handleThreshold = (value: number) => {
    setThreshold(value);
    setEntries(MoneyLedger.setUrgentThreshold(value));
  };

  const handleFuelToGen = (entry: LedgerEntry) => {
    const litres = Math.round((entry.amountNgn / Math.max(1, fuelPricePerLitreNgn)) * 10) / 10;
    const toAdd = Math.min(litres, Math.max(0, tankSpaceLitres));
    if (toAdd <= 0) {
      showToast('Generator tank is already full.');
      return;
    }
    onAddFuelToGen(toAdd);
    setEntries(MoneyLedger.markFuelLogged(entry.id));
  };

  const dayLabel = (key: string) => {
    if (key === todayKey) return 'Today';
    const d = new Date(`${key}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Money Alerts</h2>
            <p className="text-xs text-slate-400">
              Paste bank or fintech alerts. POS, fuel and small transfers are sorted for you.
            </p>
          </div>
          <Wallet className="w-5 h-5 text-emerald-400 shrink-0" />
        </div>

        {dayKeys.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {dayKeys.slice(0, 10).map((k) => (
              <button
                key={k}
                onClick={() => setPickedDay(k)}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                  k === activeDay
                    ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                    : 'bg-slate-950 text-slate-400 border-slate-800'
                }`}
              >
                {dayLabel(k)}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 block">Spent {dayLabel(activeDay).toLowerCase() === 'today' ? 'today' : dayLabel(activeDay)}</span>
            <span className="text-xl font-extrabold text-white tabular-nums">{naira(summary.spentNgn)}</span>
            <span className="text-[11px] text-emerald-300 block mt-0.5 tabular-nums">
              +{naira(summary.receivedNgn)} in
            </span>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 block">Urgent 2k sent</span>
            <span className="text-xl font-extrabold text-rose-300 tabular-nums">
              {summary.urgentCount}×
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5 tabular-nums">
              {naira(summary.byCategory.URGENT_2K || 0)} • {summary.posCount} POS
            </span>
          </div>
        </div>

        {categoryRows.length > 0 ? (
          <div className="space-y-2">
            {categoryRows.map(([cat, value]) => (
              <div key={cat} className="flex items-center gap-2.5 text-xs">
                <span className="w-24 shrink-0 text-slate-300">{CATEGORY_LABELS[cat]}</span>
                <div className="flex-1 h-2 bg-slate-950 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${CATEGORY_COLORS[cat]}`}
                    style={{ width: `${(value / maxCat) * 100}%` }}
                  />
                </div>
                <span className="w-20 text-right font-semibold text-white tabular-nums">{naira(value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No spending recorded for this day yet.</p>
        )}

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center">
          <div>
            <span className="text-[10px] text-slate-400 block">7-day fuel</span>
            <span className="text-xs font-bold text-orange-300 tabular-nums">{naira(weekSpend.fuel)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">7-day urgent 2k</span>
            <span className="text-xs font-bold text-rose-300 tabular-nums">{naira(weekSpend.urgent)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">7-day bank charges</span>
            <span className="text-xs font-bold text-amber-300 tabular-nums">{naira(weekSpend.fees)}</span>
          </div>
        </div>
      </div>

      {/* Paste box */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="alert-paste" className="text-sm font-bold text-white">
            Add alerts
          </label>
          <button
            onClick={handlePasteFromClipboard}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 border border-slate-700"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            Paste
          </button>
        </div>
        <textarea
          id="alert-paste"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={5}
          placeholder={'Paste one or more alerts. Leave a blank line between alerts.\n\nAcct: 012****345\nAmt: NGN2,000.00 DR\nDesc: NIP/OPAY/MUSA IBRAHIM'}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-emerald-500"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={() => handleImport(SAMPLE_ALERTS)}
            className="text-xs text-emerald-300 underline underline-offset-2"
          >
            Try 6 sample alerts
          </button>
          <button
            onClick={() => handleImport(pasteText)}
            disabled={!pasteText.trim()}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 disabled:opacity-40 text-slate-950 font-bold text-xs"
          >
            Read alerts
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-slate-400 shrink-0">Count as urgent 2k up to</span>
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
            {THRESHOLDS.map((t) => (
              <button
                key={t}
                onClick={() => handleThreshold(t)}
                className={`px-2 py-0.5 text-[11px] rounded-md font-semibold ${
                  threshold === t ? 'bg-rose-400 text-slate-950' : 'text-slate-400'
                }`}
              >
                ₦{t / 1000}k
              </button>
            ))}
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-px" />
          Alerts stay on this phone and are never synced. Balances are not saved and account
          numbers are cut to the last 2 digits.
        </p>
      </div>

      {/* Entries for the chosen day */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">{dayLabel(activeDay)}'s alerts</h3>
          <span className="text-[11px] text-slate-400">{entries.length} saved in total</span>
        </div>

        {dayEntries.length === 0 && (
          <p className="text-xs text-slate-500 py-3">
            Nothing here yet. Paste an alert above, or tap "Try 6 sample alerts" to see how it works.
          </p>
        )}

        {dayEntries.map((e) => {
          const litres = Math.round((e.amountNgn / Math.max(1, fuelPricePerLitreNgn)) * 10) / 10;
          return (
            <div key={e.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setEditingId(editingId === e.id ? null : e.id)}
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-200"
                      title="Change category"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_COLORS[e.category]}`} />
                      {CATEGORY_LABELS[e.category]} ▾
                    </button>
                    <span className="text-[10px] text-slate-500">
                      {e.institution}
                      {e.maskedAccount ? ` ${e.maskedAccount}` : ''} •{' '}
                      {new Date(e.occurredAtIso).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 break-words">{e.narration}</p>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`text-sm font-extrabold tabular-nums ${
                      e.direction === 'CREDIT' ? 'text-emerald-400' : 'text-white'
                    }`}
                  >
                    {e.direction === 'CREDIT' ? '+' : '−'}
                    {naira(e.amountNgn)}
                  </span>
                  <button
                    onClick={() => setEntries(MoneyLedger.remove(e.id))}
                    className="block ml-auto mt-1 text-slate-500 hover:text-rose-300"
                    aria-label="Remove alert"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {editingId === e.id && (
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(CATEGORY_LABELS) as SpendCategory[])
                    .filter((c) => (e.direction === 'CREDIT') === (c === 'INCOME'))
                    .map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setEntries(MoneyLedger.setCategory(e.id, c));
                          setEditingId(null);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          c === e.category
                            ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                            : 'bg-slate-900 text-slate-300 border-slate-700'
                        }`}
                      >
                        {CATEGORY_LABELS[c]}
                      </button>
                    ))}
                </div>
              )}

              {e.category === 'FUEL' && e.direction === 'DEBIT' && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-400">
                    About {litres}L at ₦{fuelPricePerLitreNgn}/L
                  </span>
                  {e.fuelLoggedToGen ? (
                    <span className="text-[11px] text-emerald-300 font-semibold">Added to gen ✓</span>
                  ) : (
                    <button
                      onClick={() => handleFuelToGen(e)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-500/15 text-orange-300 border border-orange-500/30 text-[11px] font-semibold"
                    >
                      <Fuel className="w-3 h-3" />
                      Add to gen tank
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {entries.length > 0 && (
          <div className="pt-2 flex justify-end">
            {confirmClear ? (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-300">Delete all {entries.length} saved alerts?</span>
                <button
                  onClick={() => {
                    setEntries(MoneyLedger.clearAll());
                    setConfirmClear(false);
                    showToast('All saved alerts deleted.');
                  }}
                  className="px-2 py-1 rounded bg-rose-500 text-white font-bold"
                >
                  Delete
                </button>
                <button onClick={() => setConfirmClear(false)} className="px-2 py-1 rounded bg-slate-800 text-slate-300">
                  Keep
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-300"
              >
                <Trash2 className="w-3 h-3" />
                Delete all alerts
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
