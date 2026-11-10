import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap,
  Activity,
  Sunrise,
  Flame,
  Building2,
  Navigation,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  BatteryCharging,
  Plus,
  CheckSquare,
  Square,
  ShieldAlert,
  TrendingUp,
  Fuel,
  MapPin,
  ArrowUpRight,
  Radio,
  Sparkles,
  Wallet
} from 'lucide-react';
import {
  GEO_ZONES,
  NIGERIAN_STATES,
  StateCode,
  TARIFF_BANDS,
  TariffBand,
  getState
} from './data/nigeriaStates';
import {
  BankChannel,
  BankWeatherItem,
  FeederZoneStatus,
  GeneratorState,
  GridPowerState,
  MarketRadarItem,
  PowerTriggeredChore,
  TransferOutcome
} from './types/rhythm';
import { OfflineSyncEngine } from './services/offlineSyncEngine';
import { useHardwarePowerSensor } from './hooks/useHardwarePowerSensor';
import MoneyTab from './components/MoneyTab';
import WetinDeyStrip from './components/WetinDeyStrip';

type ActiveTab = 'LIGHT_GEN' | 'BANK_WEATHER' | 'CHORE_QUEUE' | 'FUEL_RADAR' | 'MONEY';

export default function App() {
  // Core Persistent State
  const [stateCode, setStateCode] = useState<StateCode>(() => OfflineSyncEngine.getSelectedState());
  const currentState = getState(stateCode);
  const [zones, setZones] = useState<FeederZoneStatus[]>(() => OfflineSyncEngine.getZones());
  const [selectedZoneId, setSelectedZoneId] = useState<string>(() =>
    OfflineSyncEngine.getSelectedZoneId()
  );
  const [genState, setGenState] = useState<GeneratorState>(() =>
    OfflineSyncEngine.getGeneratorState()
  );
  const [chores, setChores] = useState<PowerTriggeredChore[]>(() =>
    OfflineSyncEngine.getChores()
  );
  const [bankWeather, setBankWeather] = useState<BankWeatherItem[]>(() =>
    OfflineSyncEngine.getBankWeather()
  );
  const [marketRadar, setMarketRadar] = useState<MarketRadarItem[]>(() =>
    OfflineSyncEngine.getMarketRadar()
  );
  const [outboxCount, setOutboxCount] = useState<number>(
    () => OfflineSyncEngine.getOutbox().length
  );

  // UI & Runtime State
  const [activeTab, setActiveTab] = useState<ActiveTab>('LIGHT_GEN');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // Add-your-area form
  const [showAddArea, setShowAddArea] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaDisco, setNewAreaDisco] = useState('');
  const [newAreaBand, setNewAreaBand] = useState<TariffBand | ''>('');

  // Chore Form State
  const [newChoreTitle, setNewChoreTitle] = useState('');
  const [newChoreCategory, setNewChoreCategory] =
    useState<PowerTriggeredChore['category']>('WATER_PUMP');
  const [newChoreHeavy, setNewChoreHeavy] = useState(true);

  // Market Radar Form State
  const [newRadarLocation, setNewRadarLocation] = useState('');
  const [newRadarCategory, setNewRadarCategory] =
    useState<MarketRadarItem['category']>('PMS_FUEL');
  const [newRadarPrice, setNewRadarPrice] = useState('1020');
  const [newRadarQueue, setNewRadarQueue] =
    useState<MarketRadarItem['queueSeverity']>('MOVING_FAST');
  const [newRadarNotes, setNewRadarNotes] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3800);
  };

  // Hardware Charger Hook
  const {
    isDevicePluggedIn,
    batteryPercentage,
    powerTransitionDetectedAt,
    dismissTransitionAlert,
    simulateChargerPlugIn
  } = useHardwarePowerSensor(() => {
    showToast('⚡ Charger voltage detected! Did AEDC/EKEDC just bring light?');
  });

  // Live 5-second ticker for Generator Fuel Burn math
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Network Connectivity & Outbox Auto-Flush
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      handleSyncOutbox();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // On launch: push anything queued offline, then pull the latest crowd data
    handleSyncOutbox(true);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const stateZones = useMemo(
    () => zones.filter((z) => z.stateCode === stateCode),
    [zones, stateCode]
  );

  const activeZone = useMemo(
    () =>
      stateZones.find((z) => z.zoneId === selectedZoneId) || stateZones[0],
    [stateZones, selectedZoneId]
  );

  // Live Generator Fuel Calculations
  const liveGenMetrics = useMemo(() => {
    if (!genState.isRunning || !genState.startedAtIso) {
      const hoursLeft =
        genState.currentFuelLitres / Math.max(0.2, genState.burnRateLitresPerHour);
      return {
        elapsedHours: 0,
        liveFuelRemainingLitres: Number(genState.currentFuelLitres.toFixed(2)),
        hoursRemaining: Number(hoursLeft.toFixed(1)),
        estimatedEmptyTimeLabel: 'Gen is Standby',
        sessionCostNgn: 0,
        weeklyGenCostNgn: Math.round(
          genState.totalGenHoursThisWeek *
            genState.burnRateLitresPerHour *
            genState.fuelPricePerLitreNgn
        )
      };
    }

    const elapsedMs = Math.max(0, nowTick - new Date(genState.startedAtIso).getTime());
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    const burnedLitres = elapsedHours * genState.burnRateLitresPerHour;
    const liveFuelRemainingLitres = Math.max(
      0,
      Number((genState.fuelLevelAtStartLitres - burnedLitres).toFixed(2))
    );
    const hoursRemaining =
      liveFuelRemainingLitres / Math.max(0.2, genState.burnRateLitresPerHour);

    const emptyTimestamp = new Date(nowTick + hoursRemaining * 3600 * 1000);
    const estimatedEmptyTimeLabel =
      liveFuelRemainingLitres <= 0.05
        ? 'TANK EMPTY!'
        : emptyTimestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const sessionCostNgn = Math.round(burnedLitres * genState.fuelPricePerLitreNgn);
    const weeklyGenCostNgn = Math.round(
      (genState.totalGenHoursThisWeek + elapsedHours) *
        genState.burnRateLitresPerHour *
        genState.fuelPricePerLitreNgn
    );

    return {
      elapsedHours: Number(elapsedHours.toFixed(2)),
      liveFuelRemainingLitres,
      hoursRemaining: Number(hoursRemaining.toFixed(1)),
      estimatedEmptyTimeLabel,
      sessionCostNgn,
      weeklyGenCostNgn
    };
  }, [genState, nowTick]);

  // Ready-to-run chores when Grid is ON_GRID
  const readyGridChores = useMemo(
    () =>
      chores.filter(
        (c) =>
          !c.completed &&
          c.triggerCondition === 'ON_GRID_RESTORED' &&
          activeZone?.currentState === 'ON_GRID'
      ),
    [chores, activeZone]
  );

  // Handlers
  const handleStateChange = (next: StateCode) => {
    setStateCode(next);
    OfflineSyncEngine.setSelectedState(next);
    setShowAddArea(false);
    const firstZone = zones.find((z) => z.stateCode === next);
    if (firstZone) {
      setSelectedZoneId(firstZone.zoneId);
      OfflineSyncEngine.setSelectedZoneId(firstZone.zoneId);
    }
    // Pull the latest reports for the new state if we are online
    OfflineSyncEngine.pullLiveSnapshot(next).then((snapshot) => {
      if (!snapshot) return;
      setZones(snapshot.zones);
      setBankWeather(snapshot.bankWeather);
      setMarketRadar(snapshot.marketRadar);
    });
  };

  const handleAddArea = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newAreaName.trim();
    if (name.length < 2) return;
    const { zones: updated, zoneId } = OfflineSyncEngine.addArea(
      stateCode,
      name,
      newAreaDisco || currentState.disco,
      newAreaBand || null
    );
    setZones(updated);
    setSelectedZoneId(zoneId);
    OfflineSyncEngine.setSelectedZoneId(zoneId);
    setNewAreaName('');
    setNewAreaDisco('');
    setNewAreaBand('');
    setShowAddArea(false);
    showToast(`📍 ${name} added. Report light status so neighbours can see it.`);
  };

  const handleZoneChange = (zoneId: string) => {
    setSelectedZoneId(zoneId);
    OfflineSyncEngine.setSelectedZoneId(zoneId);
  };

  const handlePingPower = (
    newState: GridPowerState,
    source: 'MANUAL' | 'CHARGER_HOOK' = 'MANUAL'
  ) => {
    if (!activeZone) return;
    const updated = OfflineSyncEngine.recordPowerPing(
      activeZone.zoneId,
      newState,
      source
    );
    setZones(updated);
    setOutboxCount(OfflineSyncEngine.getOutbox().length);
    dismissTransitionAlert();

    if (newState === 'ON_GRID') {
      // Automatically offer to stop generator if running
      if (genState.isRunning) {
        toggleGenerator(false);
        showToast('⚡ Up NEPA confirmed! Generator switched to Standby to save fuel.');
      } else {
        showToast(`⚡ Up NEPA logged for ${activeZone.neighborhood}!`);
      }
    } else if (newState === 'OFF_GRID') {
      showToast(`🕯️ Outage logged for ${activeZone.neighborhood}.`);
    } else {
      showToast(`⚠️ Low voltage (Half-current) logged. Unplug fridge & iron!`);
    }
  };

  const toggleGenerator = (forceState?: boolean) => {
    const nextRunning = forceState !== undefined ? forceState : !genState.isRunning;

    if (nextRunning) {
      const updated: GeneratorState = {
        ...genState,
        isRunning: true,
        startedAtIso: new Date().toISOString(),
        fuelLevelAtStartLitres: genState.currentFuelLitres
      };
      setGenState(updated);
      OfflineSyncEngine.saveGeneratorState(updated);
      showToast('⛽ Generator started. Live fuel burn timer active.');
    } else {
      const updated: GeneratorState = {
        ...genState,
        isRunning: false,
        startedAtIso: null,
        currentFuelLitres: liveGenMetrics.liveFuelRemainingLitres,
        fuelLevelAtStartLitres: liveGenMetrics.liveFuelRemainingLitres,
        totalGenHoursThisWeek: Number(
          (genState.totalGenHoursThisWeek + liveGenMetrics.elapsedHours).toFixed(2)
        )
      };
      setGenState(updated);
      OfflineSyncEngine.saveGeneratorState(updated);
    }
  };

  const handleAddFuelLitres = (litresToAdd: number) => {
    const capped = Math.min(
      genState.tankCapacityLitres,
      Number((liveGenMetrics.liveFuelRemainingLitres + litresToAdd).toFixed(1))
    );
    // If the gen is running, bank the hours burned so far before restarting the session clock
    const updated: GeneratorState = {
      ...genState,
      currentFuelLitres: capped,
      fuelLevelAtStartLitres: capped,
      startedAtIso: genState.isRunning ? new Date().toISOString() : null,
      totalGenHoursThisWeek: genState.isRunning
        ? Number((genState.totalGenHoursThisWeek + liveGenMetrics.elapsedHours).toFixed(2))
        : genState.totalGenHoursThisWeek
    };
    setGenState(updated);
    OfflineSyncEngine.saveGeneratorState(updated);
    showToast(`⛽ Added ${litresToAdd}L to keg/tank (${capped}L total).`);
  };

  const handleBankTelemetryVote = (
    institutionId: string,
    channel: BankChannel,
    outcome: TransferOutcome
  ) => {
    const updated = OfflineSyncEngine.recordBankReport(institutionId, channel, outcome);
    setBankWeather(updated);
    setOutboxCount(OfflineSyncEngine.getOutbox().length);
    showToast(
      outcome === 'INSTANT'
        ? '✅ Logged: Instant alert confirmed!'
        : '⚠️ Logged: Network delay recorded for neighbors.'
    );
  };

  const handleToggleChore = (id: string) => {
    const updated = chores.map((c) =>
      c.id === id ? { ...c, completed: !c.completed } : c
    );
    setChores(updated);
    OfflineSyncEngine.saveChores(updated);
  };

  const handleAddChore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChoreTitle.trim()) return;
    const item: PowerTriggeredChore = {
      id: `chore-${Date.now()}`,
      title: newChoreTitle.trim(),
      category: newChoreCategory,
      triggerCondition: 'ON_GRID_RESTORED',
      estimatedMinutes: 25,
      requiresHeavyLoad: newChoreHeavy,
      completed: false,
      createdAtIso: new Date().toISOString()
    };
    const updated = [item, ...chores];
    setChores(updated);
    OfflineSyncEngine.saveChores(updated);
    setNewChoreTitle('');
    showToast('📌 Added to Power-Triggered Chore Queue.');
  };

  const handleAddRadarReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRadarLocation.trim() || !newRadarPrice) return;
    const unitLabel =
      newRadarCategory === 'PMS_FUEL' || newRadarCategory === 'DIESEL'
        ? 'per Litre'
        : newRadarCategory === 'COOKING_GAS'
        ? 'per Kg'
        : 'per Seat';

    const updated = OfflineSyncEngine.addMarketRadarReport({
      stateCode,
      category: newRadarCategory,
      locationTitle: newRadarLocation.trim(),
      priceNgn: Number(newRadarPrice),
      unitLabel,
      queueSeverity: newRadarQueue,
      posAccepted: true,
      notes: newRadarNotes.trim() || 'Confirmed on ground.'
    });

    setMarketRadar(updated);
    setOutboxCount(OfflineSyncEngine.getOutbox().length);
    setNewRadarLocation('');
    setNewRadarNotes('');
    showToast('📍 Street price & queue update broadcasted!');
  };

  const handleSyncOutbox = async (silent = false) => {
    setIsSyncing(true);
    const result = await OfflineSyncEngine.flushOutbox();
    setOutboxCount(result.remainingCount);
    const snapshot = await OfflineSyncEngine.pullLiveSnapshot(
      OfflineSyncEngine.getSelectedState()
    );
    if (snapshot) {
      setZones(snapshot.zones);
      setBankWeather(snapshot.bankWeather);
      setMarketRadar(snapshot.marketRadar);
    }
    setIsSyncing(false);
    if (silent) return;
    if (result.flushedCount > 0) {
      showToast(`☁️ Synced ${result.flushedCount} offline telemetry reports!`);
    } else if (result.remainingCount === 0) {
      showToast('✓ All local data is backed up.');
    } else {
      showToast('📦 Saved to local outbox. Will auto-sync when network stabilizes.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 selection:bg-emerald-500 selection:text-slate-950">
      {/* Compact one-row header: brand, state picker, sync status. Never wraps on phones. */}
      <header
        className="sticky z-30 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-4 py-2.5"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Activity className="w-4 h-4" strokeWidth={2.75} />
            </div>
            <div className="leading-tight">
              <h1 className="font-extrabold text-sm tracking-tight text-white">Lightline</h1>
              <p className="text-[11px] font-semibold text-emerald-300">
                Wetin dey?
                <span className="hidden sm:inline font-normal text-slate-400">
                  {' '}
                  Light, bank network, prices & money
                </span>
              </p>
            </div>
          </div>

          {/* State picker: all 36 states + FCT, grouped by geopolitical zone */}
          <label htmlFor="state-picker" className="sr-only">
            Your state
          </label>
          <div className="relative flex-1 min-w-0 flex justify-end">
            <MapPin className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-400" />
            <select
              id="state-picker"
              value={stateCode}
              onChange={(e) => handleStateChange(e.target.value as StateCode)}
              className="w-full max-w-[13rem] appearance-none truncate bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-7 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-emerald-500"
            >
              {GEO_ZONES.map((gz) => (
                <optgroup key={gz} label={gz}>
                  {NIGERIAN_STATES.filter((st) => st.zone === gz).map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">
              ▼
            </span>
          </div>

          <button
            onClick={() => handleSyncOutbox()}
            disabled={isSyncing}
            aria-label={
              outboxCount > 0 ? `Sync ${outboxCount} saved reports` : 'Sync now'
            }
            className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300"
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            {outboxCount > 0 && (
              <span className="px-1.5 bg-amber-500 text-slate-950 font-bold rounded-full text-[10px]">
                {outboxCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md bg-emerald-950/95 border border-emerald-500/50 text-emerald-100 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-sm font-medium">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Hardware Charger Auto-Detection Banner */}
        {powerTransitionDetectedAt && (
          <div className="bg-emerald-950/70 border border-emerald-500/50 rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <BatteryCharging className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-200">
                  Phone Charger Voltage Detected!
                </p>
                <p className="text-xs text-emerald-300/80">
                  Did {activeZone?.discoName} just bring light in{' '}
                  {activeZone?.neighborhood}? Confirm to alert neighbors & trigger chores.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                onClick={() => handlePingPower('ON_GRID', 'CHARGER_HOOK')}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400"
              >
                Confirm Up NEPA!
              </button>
              <button
                onClick={dismissTransitionAlert}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-slate-400 text-xs hover:text-slate-200"
              >
                It's Gen / Powerbank
              </button>
            </div>
          </div>
        )}

        {/* Active Grid Chore Alert Strip */}
        {readyGridChores.length > 0 && activeTab !== 'LIGHT_GEN' && (
          <div
            onClick={() => setActiveTab('CHORE_QUEUE')}
            className="cursor-pointer bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 flex items-center justify-between gap-3 hover:bg-amber-500/15 transition"
          >
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs font-medium text-amber-200">
                <strong className="font-bold">Grid is ON:</strong> You have{' '}
                {readyGridChores.length} power-triggered chore(s) waiting (e.g.,{' '}
                {readyGridChores[0].title}).
              </p>
            </div>
            <ArrowUpRight className="w-4 h-4 text-amber-400 shrink-0" />
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 1: UP NEPA & GENERATOR FUEL CALCULATOR                          */}
        {/* =================================================================== */}
        {activeTab === 'LIGHT_GEN' && (
          <div className="space-y-4">
            <WetinDeyStrip
              stateName={currentState.name}
              stateCode={stateCode}
              zone={activeZone}
              genFuelLitres={liveGenMetrics.liveFuelRemainingLitres}
              genHoursLeft={liveGenMetrics.hoursRemaining}
              genRunning={genState.isRunning}
              readyChores={readyGridChores.length}
              pendingChores={chores.filter((c) => !c.completed).length}
              bankWeather={bankWeather}
              marketRadar={marketRadar}
              onOpen={(tab) => {
                setActiveTab(tab);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />

            {/* Feeder Selector Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    Your area ({currentState.name})
                  </span>
                  <select
                    value={activeZone?.zoneId}
                    onChange={(e) => handleZoneChange(e.target.value)}
                    className="mt-1 block w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:border-emerald-500"
                  >
                    {stateZones.map((z) => (
                      <option key={z.zoneId} value={z.zoneId}>
                        {z.neighborhood} ({z.discoName}
                        {z.tariffBand ? ` • ${z.tariffBand}` : ''})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddArea((v) => !v)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-300 font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {showAddArea ? 'Cancel' : 'My area is not listed'}
                  </button>
                </div>

                <button
                  onClick={simulateChargerPlugIn}
                  className="self-start sm:self-end inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-800 text-emerald-300 border border-slate-700"
                >
                  <BatteryCharging className="w-3.5 h-3.5" />
                  Test Charger Sensor ({batteryPercentage}%)
                </button>
              </div>

              {showAddArea && (
                <form
                  onSubmit={handleAddArea}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5"
                >
                  <p className="text-xs text-slate-300">
                    Add your street, estate or feeder in {currentState.name}. Neighbours who add
                    the same name share one status.
                  </p>
                  <input
                    id="new-area-name"
                    type="text"
                    value={newAreaName}
                    onChange={(e) => setNewAreaName(e.target.value)}
                    placeholder={`e.g., ${currentState.capital} GRA or your estate name`}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      id="new-area-disco"
                      type="text"
                      value={newAreaDisco}
                      onChange={(e) => setNewAreaDisco(e.target.value)}
                      placeholder={`DisCo: ${currentState.disco}`}
                      className="min-w-0 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500"
                    />
                    <select
                      id="new-area-band"
                      value={newAreaBand}
                      onChange={(e) => setNewAreaBand(e.target.value as TariffBand | '')}
                      className="min-w-0 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200"
                    >
                      <option value="">Band not sure</option>
                      {TARIFF_BANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={newAreaName.trim().length < 2}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 disabled:opacity-40 text-slate-950 font-bold text-xs"
                  >
                    Add area
                  </button>
                </form>
              )}

              {/* Current Grid Status Display */}
              {activeZone && (
                <div
                  className={`rounded-2xl p-4 border ${
                    activeZone.currentState === 'ON_GRID'
                      ? 'bg-emerald-950/40 border-emerald-500/40'
                      : activeZone.currentState === 'LOW_VOLTAGE'
                      ? 'bg-amber-950/40 border-amber-500/40'
                      : activeZone.currentState === 'UNKNOWN'
                      ? 'bg-slate-950 border-slate-700'
                      : 'bg-rose-950/30 border-rose-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-full ${
                            activeZone.currentState === 'ON_GRID'
                              ? 'bg-emerald-400 animate-pulse'
                              : activeZone.currentState === 'LOW_VOLTAGE'
                              ? 'bg-amber-400'
                              : activeZone.currentState === 'UNKNOWN'
                              ? 'bg-slate-500'
                              : 'bg-rose-500'
                          }`}
                        />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                          {activeZone.discoName}
                          {activeZone.tariffBand ? ` • ${activeZone.tariffBand}` : ''}
                          {activeZone.tariffRateNgnKwh
                            ? ` (₦${activeZone.tariffRateNgnKwh}/kWh)`
                            : ''}
                        </span>
                      </div>
                      <h2 className="text-xl font-extrabold mt-1 text-white">
                        {activeZone.currentState === 'ON_GRID'
                          ? 'UP NEPA! Grid Power Active'
                          : activeZone.currentState === 'LOW_VOLTAGE'
                          ? 'LOW VOLTAGE (Half-Current)'
                          : activeZone.currentState === 'UNKNOWN'
                          ? 'No reports yet'
                          : 'NO LIGHT (Off-Grid)'}
                      </h2>
                      <p className="text-xs text-slate-300 mt-1">
                        {activeZone.currentState === 'UNKNOWN'
                          ? `Be the first in ${activeZone.neighborhood} to report. Tap a button below.`
                          : `${activeZone.recentConfirmations} neighbor confirmations • Est. ${activeZone.estimatedVoltage}V`}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] text-slate-400 block">Last Ping</span>
                      <span className="text-xs font-semibold text-slate-200">
                        {activeZone.currentState === 'UNKNOWN'
                          ? '—'
                          : new Date(activeZone.lastUpdatedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                      </span>
                    </div>
                  </div>

                  {/* 1-Tap Crowdsourced Grid Buttons */}
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <button
                      onClick={() => handlePingPower('ON_GRID')}
                      className="py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
                    >
                      <Zap className="w-4 h-4 fill-slate-950" />
                      Up NEPA!
                    </button>
                    <button
                      onClick={() => handlePingPower('LOW_VOLTAGE')}
                      className="py-2.5 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Low Voltage
                    </button>
                    <button
                      onClick={() => handlePingPower('OFF_GRID')}
                      className="py-2.5 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                    >
                      They Took Light
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Generator & Inverter Runtime Engine */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame
                    className={`w-5 h-5 ${
                      genState.isRunning
                        ? 'text-orange-400 animate-bounce'
                        : 'text-slate-400'
                    }`}
                  />
                  <div>
                    <h3 className="font-bold text-sm text-white">
                      Generator & Keg Fuel Tracker
                    </h3>
                    <p className="text-xs text-slate-400">
                      Burn Rate: {genState.burnRateLitresPerHour}L/hr @ ₦
                      {genState.fuelPricePerLitreNgn}/L
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => toggleGenerator()}
                  className={`px-4 py-2 rounded-xl font-bold text-xs transition ${
                    genState.isRunning
                      ? 'bg-rose-500 text-white hover:bg-rose-400'
                      : 'bg-orange-500 text-slate-950 hover:bg-orange-400'
                  }`}
                >
                  {genState.isRunning ? 'Stop Gen' : 'Start Generator'}
                </button>
              </div>

              {/* Fuel Gauge Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300 font-medium">
                    Tank Level:{' '}
                    <strong className="text-white">
                      {liveGenMetrics.liveFuelRemainingLitres}L
                    </strong>{' '}
                    / {genState.tankCapacityLitres}L
                  </span>
                  <span className="text-orange-300 font-semibold">
                    ~{liveGenMetrics.hoursRemaining} hrs runtime left
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      liveGenMetrics.liveFuelRemainingLitres <= 2.5
                        ? 'bg-rose-500'
                        : 'bg-gradient-to-r from-orange-500 to-amber-400'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        (liveGenMetrics.liveFuelRemainingLitres /
                          genState.tankCapacityLitres) *
                          100
                      )}%`
                    }}
                  />
                </div>
              </div>

              {/* Runtime Stats Grid */}
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl p-2.5">
                  <span className="text-[11px] text-slate-400 block">Est. Tank Empty</span>
                  <span className="text-sm font-bold text-white mt-0.5 block">
                    {liveGenMetrics.estimatedEmptyTimeLabel}
                  </span>
                </div>
                <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl p-2.5">
                  <span className="text-[11px] text-slate-400 block">This Gen Session</span>
                  <span className="text-sm font-bold text-orange-300 mt-0.5 block">
                    ₦{liveGenMetrics.sessionCostNgn.toLocaleString()}
                  </span>
                </div>
                <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl p-2.5">
                  <span className="text-[11px] text-slate-400 block">7-Day Gen Spend</span>
                  <span className="text-sm font-bold text-slate-200 mt-0.5 block">
                    ₦{liveGenMetrics.weeklyGenCostNgn.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Quick Keg Top-Up Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <span className="text-xs text-slate-400">Pour from Jerrycan:</span>
                <div className="flex items-center gap-2">
                  {[2, 5, 10].map((litres) => (
                    <button
                      key={litres}
                      onClick={() => handleAddFuelLitres(litres)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
                    >
                      +{litres}L
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: LIVE BANK & POS NETWORK WEATHER                              */}
        {/* =================================================================== */}
        {activeTab === 'BANK_WEATHER' && (
          <div className="space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Bank & POS Network Weather
                  </h2>
                  <p className="text-xs text-slate-400">
                    Check before you do transfer at market, filling station, or POS.
                  </p>
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-800 text-emerald-300 font-semibold">
                  Rolling 60m Live
                </span>
              </div>

              <div className="space-y-3">
                {bankWeather.map((bank) => {
                  const badgeStyle =
                    bank.statusAdvisory === 'SMOOTH'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : bank.statusAdvisory === 'SLIGHT_DELAY'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40';

                  const badgeLabel =
                    bank.statusAdvisory === 'SMOOTH'
                      ? 'Going Sharp-Sharp'
                      : bank.statusAdvisory === 'SLIGHT_DELAY'
                      ? 'Slight Delay'
                      : 'Network Dey Hang!';

                  return (
                    <div
                      key={bank.institutionId}
                      className="bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-white">
                              {bank.institutionName}
                            </h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                              {bank.institutionType === 'FINTECH' ? 'Fintech' : 'Bank'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Avg alert time: ~{bank.avgLatencySec}s •{' '}
                            {bank.reportsLastHour} reports in last hr
                          </p>
                        </div>

                        <span
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${badgeStyle}`}
                        >
                          {badgeLabel}
                        </span>
                      </div>

                      {/* Channel Metrics */}
                      <div className="grid grid-cols-3 gap-2 text-center bg-slate-900/70 rounded-lg p-2">
                        <div>
                          <span className="text-[10px] text-slate-400 block">
                            App Transfer
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              bank.appTransferSuccessPct >= 80
                                ? 'text-emerald-400'
                                : bank.appTransferSuccessPct >= 60
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {bank.appTransferSuccessPct}%
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">
                            POS Card
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              bank.posCardSuccessPct >= 80
                                ? 'text-emerald-400'
                                : bank.posCardSuccessPct >= 60
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {bank.posCardSuccessPct}%
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">USSD</span>
                          <span className="text-xs font-bold text-slate-300">
                            {bank.ussdSuccessPct}%
                          </span>
                        </div>
                      </div>

                      {/* 1-Tap Report Buttons */}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-slate-400">
                          Just did a transaction?
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() =>
                              handleBankTelemetryVote(
                                bank.institutionId,
                                'APP_TRANSFER',
                                'INSTANT'
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold"
                          >
                            ✓ Alert Entered Fast
                          </button>
                          <button
                            onClick={() =>
                              handleBankTelemetryVote(
                                bank.institutionId,
                                'APP_TRANSFER',
                                'HANGING'
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-semibold"
                          >
                            ✕ Hanging / Reversed
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: POWER-TRIGGERED CHORE QUEUE                                  */}
        {/* =================================================================== */}
        {activeTab === 'CHORE_QUEUE' && (
          <div className="space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">
                  Power-Triggered Chore Queue
                </h2>
                <p className="text-xs text-slate-400">
                  Don't schedule heavy chores by clock time—queue them for the exact
                  minute {activeZone?.discoName} brings light.
                </p>
              </div>

              {/* Add Chore Form */}
              <form onSubmit={handleAddChore} className="space-y-2.5 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <input
                  type="text"
                  value={newChoreTitle}
                  onChange={(e) => setNewChoreTitle(e.target.value)}
                  placeholder="e.g., Pump borehole water, Iron Agbada, Blend pepper..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={newChoreCategory}
                      onChange={(e) =>
                        setNewChoreCategory(
                          e.target.value as PowerTriggeredChore['category']
                        )
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="WATER_PUMP">Water Pump</option>
                      <option value="IRONING">Ironing</option>
                      <option value="CHARGING">Charging Devices</option>
                      <option value="FREEZER">Deep Freezer</option>
                    </select>

                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newChoreHeavy}
                        onChange={(e) => setNewChoreHeavy(e.target.checked)}
                        className="rounded border-slate-700"
                      />
                      High-Wattage (Grid Only)
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1 hover:bg-emerald-400"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Queue Task
                  </button>
                </div>
              </form>

              {/* Chore List */}
              <div className="space-y-2.5">
                {chores.map((chore) => {
                  const canRunNow =
                    activeZone?.currentState === 'ON_GRID' || !chore.requiresHeavyLoad;

                  return (
                    <div
                      key={chore.id}
                      onClick={() => handleToggleChore(chore.id)}
                      className={`cursor-pointer p-3.5 rounded-xl border transition flex items-start justify-between gap-3 ${
                        chore.completed
                          ? 'bg-slate-950/40 border-slate-800/50 opacity-60'
                          : canRunNow
                          ? 'bg-emerald-950/25 border-emerald-500/40'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {chore.completed ? (
                          <CheckSquare className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p
                            className={`text-sm font-semibold ${
                              chore.completed
                                ? 'line-through text-slate-500'
                                : 'text-white'
                            }`}
                          >
                            {chore.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              {chore.category.replace('_', ' ')}
                            </span>
                            {chore.requiresHeavyLoad && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                Heavy Coil / Motor Load
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {!chore.completed && (
                        <span
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                            activeZone?.currentState === 'ON_GRID'
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {activeZone?.currentState === 'ON_GRID'
                            ? '⚡ DO NOW!'
                            : 'Waiting for Light'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: STREET FUEL, GAS & ALONG-FARE RADAR                          */}
        {/* =================================================================== */}
        {activeTab === 'FUEL_RADAR' && (
          <div className="space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">
                  {currentState.name} Fuel, Gas & Fare Radar
                </h2>
                <p className="text-xs text-slate-400">
                  Real street prices and queue status reported by commuters today.
                </p>
              </div>

              {/* Quick Crowdsource Report Form */}
              <form
                onSubmit={handleAddRadarReport}
                className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newRadarLocation}
                    onChange={(e) => setNewRadarLocation(e.target.value)}
                    placeholder={
                      stateCode === 'FC'
                        ? 'e.g., Conoil Gwarinpa or Berger -> Wuse'
                        : stateCode === 'LA'
                        ? 'e.g., Mobil Opebi or Oshodi -> VI'
                        : `e.g., NNPC ${currentState.capital} or Motor park -> Market`
                    }
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  />
                  <div className="flex gap-2">
                    <select
                      value={newRadarCategory}
                      onChange={(e) =>
                        setNewRadarCategory(
                          e.target.value as MarketRadarItem['category']
                        )
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-200 flex-1"
                    >
                      <option value="PMS_FUEL">Fuel (PMS)</option>
                      <option value="COOKING_GAS">Cooking Gas (LPG)</option>
                      <option value="ROUTE_FARE">Bus / Along Fare</option>
                      <option value="DIESEL">Diesel (AGO)</option>
                    </select>
                    <input
                      type="number"
                      value={newRadarPrice}
                      onChange={(e) => setNewRadarPrice(e.target.value)}
                      placeholder="₦ Price"
                      className="w-24 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <select
                    value={newRadarQueue}
                    onChange={(e) =>
                      setNewRadarQueue(
                        e.target.value as MarketRadarItem['queueSeverity']
                      )
                    }
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    <option value="NO_QUEUE">No Queue / Free Flow</option>
                    <option value="MOVING_FAST">Moving Fast</option>
                    <option value="LONG_HOLDUP">Long Queue / Hold-Up</option>
                    <option value="LOCKED_UP">Locked Up / No Product</option>
                  </select>

                  <input
                    type="text"
                    value={newRadarNotes}
                    onChange={(e) => setNewRadarNotes(e.target.value)}
                    placeholder="Short note (e.g., POS working, 4 pumps active)"
                    className="flex-1 min-w-[160px] bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />

                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400"
                  >
                    Post Update
                  </button>
                </div>
              </form>

              {/* Radar Feed */}
              {!marketRadar.some((item) => item.stateCode === stateCode) && (
                <p className="text-xs text-slate-400 bg-slate-950 border border-dashed border-slate-700 rounded-xl p-4">
                  No prices reported in {currentState.name} yet. Seen a fuel price, gas refill or bus
                  fare today? Post it above and neighbours in {currentState.capital} will see it.
                </p>
              )}
              <div className="space-y-2.5">
                {marketRadar
                  .filter((item) => item.stateCode === stateCode)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-emerald-300">
                            {item.category.replace('_', ' ')}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              item.queueSeverity === 'NO_QUEUE' ||
                              item.queueSeverity === 'MOVING_FAST'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {item.queueSeverity.replace('_', ' ')}
                          </span>
                        </div>
                        <h3 className="font-bold text-sm text-white">
                          {item.locationTitle}
                        </h3>
                        <p className="text-xs text-slate-400">{item.notes}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-base font-extrabold text-emerald-400 block">
                          ₦{item.priceNgn.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-slate-400 block">
                          {item.unitLabel}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
        {/* =================================================================== */}
        {/* TAB 5: MONEY ALERTS (ON-DEVICE BANK ALERT PARSER)                   */}
        {/* =================================================================== */}
        {activeTab === 'MONEY' && (
          <MoneyTab
            fuelPricePerLitreNgn={genState.fuelPricePerLitreNgn}
            tankSpaceLitres={genState.tankCapacityLitres - liveGenMetrics.liveFuelRemainingLitres}
            onAddFuelToGen={handleAddFuelLitres}
            showToast={showToast}
          />
        )}
      </main>

      {/* Bottom Mobile Navigation Bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 px-2 py-1.5">
        <div className="max-w-md mx-auto grid grid-cols-5 gap-1">
          <button
            onClick={() => setActiveTab('LIGHT_GEN')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'LIGHT_GEN'
                ? 'text-emerald-400 bg-emerald-500/10 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sunrise className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Today</span>
          </button>

          <button
            onClick={() => setActiveTab('BANK_WEATHER')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'BANK_WEATHER'
                ? 'text-emerald-400 bg-emerald-500/10 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Bank/POS</span>
          </button>

          <button
            onClick={() => setActiveTab('CHORE_QUEUE')}
            className={`relative flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'CHORE_QUEUE'
                ? 'text-emerald-400 bg-emerald-500/10 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Chores</span>
            {readyGridChores.length > 0 && (
              <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('FUEL_RADAR')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'FUEL_RADAR'
                ? 'text-emerald-400 bg-emerald-500/10 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Fuel className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Fuel & Fare</span>
          </button>

          <button
            onClick={() => setActiveTab('MONEY')}
            className={`flex flex-col items-center py-1.5 rounded-xl transition ${
              activeTab === 'MONEY'
                ? 'text-emerald-400 bg-emerald-500/10 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wallet className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Money</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
