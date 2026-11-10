import React, { useMemo } from 'react';
import { CheckCircle2, Fuel, Landmark, Wallet, Zap, Flame } from 'lucide-react';
import type {
  BankWeatherItem,
  FeederZoneStatus,
  MarketRadarItem,
  StateCode
} from '../types/rhythm';
import { MoneyLedger } from '../services/moneyLedger';
import { localDateKey, summarizeDay } from '../services/alertParser';

type Tab = 'LIGHT_GEN' | 'BANK_WEATHER' | 'CHORE_QUEUE' | 'FUEL_RADAR' | 'MONEY';
type Tone = 'good' | 'warn' | 'bad' | 'muted';

interface WetinDeyStripProps {
  stateName: string;
  stateCode: StateCode;
  zone: FeederZoneStatus | undefined;
  genFuelLitres: number;
  genHoursLeft: number;
  genRunning: boolean;
  readyChores: number;
  pendingChores: number;
  bankWeather: BankWeatherItem[];
  marketRadar: MarketRadarItem[];
  onOpen: (tab: Tab) => void;
}

const TONE: Record<Tone, string> = {
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  muted: 'text-slate-300'
};

const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`;
const shortBank = (name: string) => name.replace(/\s+(Bank|Plc|MFB|IBTC)$/i, '');

/** "Wetin dey?" — one glance at the whole day: light, gen, chores, bank network, fuel, money. */
export default function WetinDeyStrip(props: WetinDeyStripProps) {
  const { zone, bankWeather, marketRadar, stateCode } = props;

  const light = useMemo(() => {
    const s = zone?.currentState;
    if (s === 'ON_GRID') return { value: 'Light dey', tone: 'good' as Tone };
    if (s === 'LOW_VOLTAGE') return { value: 'Low current', tone: 'warn' as Tone };
    if (s === 'OFF_GRID') return { value: 'No light', tone: 'bad' as Tone };
    return { value: 'No reports', tone: 'muted' as Tone };
  }, [zone]);

  const bank = useMemo(() => {
    const bad = bankWeather.filter((b) => b.statusAdvisory === 'HIGH_FAILURE_HOLD_ON');
    const slow = bankWeather.filter((b) => b.statusAdvisory === 'SLIGHT_DELAY');
    if (bad.length) {
      return {
        value: `${shortBank(bad[0].institutionName)} failing`,
        sub: bad.length > 1 ? `+${bad.length - 1} more` : 'Hold transfers',
        tone: 'bad' as Tone
      };
    }
    if (slow.length) {
      return {
        value: `${shortBank(slow[0].institutionName)} slow`,
        sub: slow.length > 1 ? `+${slow.length - 1} more slow` : 'Others smooth',
        tone: 'warn' as Tone
      };
    }
    return { value: 'All smooth', sub: `${bankWeather.length} banks`, tone: 'good' as Tone };
  }, [bankWeather]);

  const fuel = useMemo(() => {
    const prices = marketRadar
      .filter((m) => m.stateCode === stateCode && m.category === 'PMS_FUEL')
      .sort((a, b) => a.priceNgn - b.priceNgn);
    if (!prices.length) return { value: 'No price yet', sub: 'Post one', tone: 'muted' as Tone };
    return {
      value: `${naira(prices[0].priceNgn)}/L`,
      // cheapest reported petrol in the state
      sub: prices[0].locationTitle,
      tone: 'good' as Tone
    };
  }, [marketRadar, stateCode]);

  // Ledger lives in its own store; re-read whenever the strip renders (cheap, local only)
  const today = summarizeDay(MoneyLedger.getEntries(), localDateKey(new Date().toISOString()));

  const tiles: Array<{
    key: string;
    label: string;
    value: string;
    sub: string;
    tone: Tone;
    icon: React.ReactNode;
    tab: Tab;
  }> = [
    {
      key: 'light',
      label: 'Light',
      value: light.value,
      sub: zone?.neighborhood.replace(/\s*\(.*\)$/, '') || props.stateName,
      tone: light.tone,
      icon: <Zap className="w-3.5 h-3.5" />,
      tab: 'LIGHT_GEN'
    },
    {
      key: 'gen',
      label: 'Gen fuel',
      value: `${props.genFuelLitres.toFixed(1)}L`,
      sub: props.genRunning ? `~${props.genHoursLeft}h left, running` : `~${props.genHoursLeft}h of runtime`,
      tone: props.genHoursLeft < 2 ? 'bad' : props.genHoursLeft < 4 ? 'warn' : 'good',
      icon: <Flame className="w-3.5 h-3.5" />,
      tab: 'LIGHT_GEN'
    },
    {
      key: 'chores',
      label: 'Chores',
      value: props.readyChores ? `${props.readyChores} do now` : `${props.pendingChores} waiting`,
      sub: props.readyChores ? 'Light is on' : 'For when light comes',
      tone: props.readyChores ? 'warn' : 'muted',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      tab: 'CHORE_QUEUE'
    },
    {
      key: 'bank',
      label: 'Banks',
      value: bank.value,
      sub: bank.sub,
      tone: bank.tone,
      icon: <Landmark className="w-3.5 h-3.5" />,
      tab: 'BANK_WEATHER'
    },
    {
      key: 'fuel',
      label: 'Fuel',
      value: fuel.value,
      sub: fuel.sub,
      tone: fuel.tone,
      icon: <Fuel className="w-3.5 h-3.5" />,
      tab: 'FUEL_RADAR'
    },
    {
      key: 'money',
      label: 'Spent today',
      value: naira(today.spentNgn),
      sub: today.urgentCount ? `${today.urgentCount}× urgent 2k` : 'From bank alerts',
      tone: today.urgentCount >= 3 ? 'warn' : 'muted',
      icon: <Wallet className="w-3.5 h-3.5" />,
      tab: 'MONEY'
    }
  ];

  return (
    <section aria-label="Wetin dey today" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-extrabold text-white">
          Wetin dey today <span className="text-slate-400 font-medium">• {props.stateName}</span>
        </h2>
        <span className="text-[11px] text-slate-500">Tap any box</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => props.onOpen(t.tab)}
            className="min-w-0 text-left bg-slate-900/90 border border-slate-800 hover:border-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 rounded-xl px-2.5 py-2"
          >
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
              {t.icon}
              <span className="truncate">{t.label}</span>
            </span>
            <span className={`block mt-0.5 text-[13px] font-extrabold leading-tight truncate tabular-nums ${TONE[t.tone]}`}>
              {t.value}
            </span>
            <span className="block text-[10px] text-slate-500 truncate">{t.sub}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
