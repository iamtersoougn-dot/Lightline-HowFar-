import {
  BankWeatherItem,
  FeederZoneStatus,
  GeneratorState,
  GridPowerState,
  MarketRadarItem,
  OutboxMutation,
  PowerTriggeredChore,
  TransferOutcome,
  BankChannel
} from '../types/rhythm';
import {
  NIGERIAN_STATES,
  StateCode,
  TariffBand,
  areaZoneId,
  getState,
  isStateCode,
  legacyCityToState
} from '../data/nigeriaStates';

// Keys keep the original "howfar_" prefix on purpose: renaming them would wipe saved data on update.
const STORAGE_KEYS = {
  ZONES: 'howfar_v2_zones',
  GENERATOR: 'howfar_v1_generator',
  CHORES: 'howfar_v1_chores',
  BANK_WEATHER: 'howfar_v1_bank_weather',
  MARKET_RADAR: 'howfar_v2_market_radar',
  OUTBOX: 'howfar_v1_outbox_queue',
  SELECTED_ZONE: 'howfar_v2_selected_zone_id',
  SELECTED_STATE: 'howfar_v2_selected_state',
  LEGACY_SELECTED_CITY: 'howfar_v1_selected_city'
};

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:4000';

const SAMPLE_FEEDER_ZONES: FeederZoneStatus[] = [
  {
    zoneId: 'fc-gwarinpa-01',
    stateCode: 'FC',
    neighborhood: 'Gwarinpa (3rd Ave / 6th Ave Feeder)',
    discoName: 'AEDC',
    tariffBand: 'Band A',
    tariffRateNgnKwh: 209.5,
    currentState: 'ON_GRID',
    lastUpdatedAt: new Date(Date.now() - 18 * 60000).toISOString(),
    recentConfirmations: 14,
    estimatedVoltage: 228
  },
  {
    zoneId: 'fc-wuse2-01',
    stateCode: 'FC',
    neighborhood: 'Wuse II / Aminu Kano Crescent',
    discoName: 'AEDC',
    tariffBand: 'Band A',
    tariffRateNgnKwh: 209.5,
    currentState: 'ON_GRID',
    lastUpdatedAt: new Date(Date.now() - 42 * 60000).toISOString(),
    recentConfirmations: 9,
    estimatedVoltage: 231
  },
  {
    zoneId: 'fc-lugbe-01',
    stateCode: 'FC',
    neighborhood: 'Lugbe FHA / Airport Road Feeder',
    discoName: 'AEDC',
    tariffBand: 'Band B',
    tariffRateNgnKwh: 68.2,
    currentState: 'OFF_GRID',
    lastUpdatedAt: new Date(Date.now() - 95 * 60000).toISOString(),
    recentConfirmations: 21,
    estimatedVoltage: 0
  },
  {
    zoneId: 'fc-kubwa-01',
    stateCode: 'FC',
    neighborhood: 'Kubwa Phase 4 / Arab Road',
    discoName: 'AEDC',
    tariffBand: 'Band B',
    tariffRateNgnKwh: 68.2,
    currentState: 'LOW_VOLTAGE',
    lastUpdatedAt: new Date(Date.now() - 27 * 60000).toISOString(),
    recentConfirmations: 7,
    estimatedVoltage: 164
  },
  {
    zoneId: 'la-ikeja-01',
    stateCode: 'LA',
    neighborhood: 'Ikeja Allen / Opebi Feeder',
    discoName: 'IKEDC',
    tariffBand: 'Band A',
    tariffRateNgnKwh: 209.5,
    currentState: 'ON_GRID',
    lastUpdatedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    recentConfirmations: 19,
    estimatedVoltage: 224
  },
  {
    zoneId: 'la-surulere-01',
    stateCode: 'LA',
    neighborhood: 'Surulere Bode Thomas / Adeniran Ogunsanya',
    discoName: 'EKEDC',
    tariffBand: 'Band A',
    tariffRateNgnKwh: 209.5,
    currentState: 'OFF_GRID',
    lastUpdatedAt: new Date(Date.now() - 64 * 60000).toISOString(),
    recentConfirmations: 11,
    estimatedVoltage: 0
  },
  {
    zoneId: 'la-lekki1-01',
    stateCode: 'LA',
    neighborhood: 'Lekki Phase 1 / Admiralty Way',
    discoName: 'EKEDC',
    tariffBand: 'Band A',
    tariffRateNgnKwh: 209.5,
    currentState: 'ON_GRID',
    lastUpdatedAt: new Date(Date.now() - 33 * 60000).toISOString(),
    recentConfirmations: 16,
    estimatedVoltage: 230
  },
  {
    zoneId: 'la-yaba-01',
    stateCode: 'LA',
    neighborhood: 'Yaba Akoka / Herbert Macaulay',
    discoName: 'EKEDC',
    tariffBand: 'Band B',
    tariffRateNgnKwh: 68.2,
    currentState: 'OFF_GRID',
    lastUpdatedAt: new Date(Date.now() - 110 * 60000).toISOString(),
    recentConfirmations: 8,
    estimatedVoltage: 0
  }
];

/**
 * Every state starts with one city-wide area at its capital, marked "no reports yet".
 * FCT and Lagos also carry the detailed sample feeders above.
 */
const CAPITAL_AREAS: FeederZoneStatus[] = NIGERIAN_STATES.filter(
  (st) => !SAMPLE_FEEDER_ZONES.some((z) => z.stateCode === st.code)
).map((st) => ({
  zoneId: `${st.code.toLowerCase()}-capital`,
  stateCode: st.code,
  neighborhood: `${st.capital} (city-wide)`,
  discoName: st.disco,
  tariffBand: null,
  tariffRateNgnKwh: null,
  currentState: 'UNKNOWN',
  lastUpdatedAt: new Date(0).toISOString(),
  recentConfirmations: 0,
  estimatedVoltage: 0
}));

export const INITIAL_FEEDER_ZONES: FeederZoneStatus[] = [...SAMPLE_FEEDER_ZONES, ...CAPITAL_AREAS];

export const INITIAL_GENERATOR_STATE: GeneratorState = {
  isRunning: false,
  startedAtIso: null,
  tankCapacityLitres: 15,
  fuelLevelAtStartLitres: 9.5,
  currentFuelLitres: 9.5,
  burnRateLitresPerHour: 1.35, // Typical 3.5kVA generator load
  fuelPricePerLitreNgn: 1040,
  inverterBatteryPct: 78,
  totalGenHoursThisWeek: 14.5
};

export const INITIAL_CHORES: PowerTriggeredChore[] = [
  {
    id: 'chore-1',
    title: 'Pump Borehole Water to Overhead Tank',
    category: 'WATER_PUMP',
    triggerCondition: 'ON_GRID_RESTORED',
    estimatedMinutes: 35,
    requiresHeavyLoad: true,
    completed: false,
    createdAtIso: new Date().toISOString()
  },
  {
    id: 'chore-2',
    title: 'Iron 3 Work Shirts & Trad for Tomorrow',
    category: 'IRONING',
    triggerCondition: 'ON_GRID_RESTORED',
    estimatedMinutes: 20,
    requiresHeavyLoad: true,
    completed: false,
    createdAtIso: new Date().toISOString()
  },
  {
    id: 'chore-3',
    title: 'Top up 20,000mAh Power Bank & Laptop',
    category: 'CHARGING',
    triggerCondition: 'BEFORE_GEN_OFF',
    estimatedMinutes: 60,
    requiresHeavyLoad: false,
    completed: false,
    createdAtIso: new Date().toISOString()
  }
];

export const INITIAL_BANK_WEATHER: BankWeatherItem[] = [
  {
    institutionId: 'opay',
    institutionName: 'OPay',
    institutionType: 'FINTECH',
    appTransferSuccessPct: 97,
    posCardSuccessPct: 95,
    ussdSuccessPct: 91,
    avgLatencySec: 6,
    reportsLastHour: 48,
    statusAdvisory: 'SMOOTH',
    lastUpdatedIso: new Date(Date.now() - 4 * 60000).toISOString()
  },
  {
    institutionId: 'moniepoint',
    institutionName: 'Moniepoint',
    institutionType: 'FINTECH',
    appTransferSuccessPct: 96,
    posCardSuccessPct: 98,
    ussdSuccessPct: 89,
    avgLatencySec: 7,
    reportsLastHour: 52,
    statusAdvisory: 'SMOOTH',
    lastUpdatedIso: new Date(Date.now() - 3 * 60000).toISOString()
  },
  {
    institutionId: 'palmpay',
    institutionName: 'PalmPay',
    institutionType: 'FINTECH',
    appTransferSuccessPct: 94,
    posCardSuccessPct: 91,
    ussdSuccessPct: 86,
    avgLatencySec: 9,
    reportsLastHour: 31,
    statusAdvisory: 'SMOOTH',
    lastUpdatedIso: new Date(Date.now() - 8 * 60000).toISOString()
  },
  {
    institutionId: 'gtbank',
    institutionName: 'GTBank (GTWorld)',
    institutionType: 'COMMERCIAL_BANK',
    appTransferSuccessPct: 64,
    posCardSuccessPct: 78,
    ussdSuccessPct: 58,
    avgLatencySec: 85,
    reportsLastHour: 39,
    statusAdvisory: 'SLIGHT_DELAY',
    lastUpdatedIso: new Date(Date.now() - 6 * 60000).toISOString()
  },
  {
    institutionId: 'zenith',
    institutionName: 'Zenith Bank',
    institutionType: 'COMMERCIAL_BANK',
    appTransferSuccessPct: 48,
    posCardSuccessPct: 72,
    ussdSuccessPct: 52,
    avgLatencySec: 140,
    reportsLastHour: 27,
    statusAdvisory: 'HIGH_FAILURE_HOLD_ON',
    lastUpdatedIso: new Date(Date.now() - 5 * 60000).toISOString()
  },
  {
    institutionId: 'access',
    institutionName: 'Access Bank',
    institutionType: 'COMMERCIAL_BANK',
    appTransferSuccessPct: 82,
    posCardSuccessPct: 86,
    ussdSuccessPct: 79,
    avgLatencySec: 22,
    reportsLastHour: 24,
    statusAdvisory: 'SMOOTH',
    lastUpdatedIso: new Date(Date.now() - 11 * 60000).toISOString()
  },
  {
    institutionId: 'firstbank',
    institutionName: 'FirstBank',
    institutionType: 'COMMERCIAL_BANK',
    appTransferSuccessPct: 68,
    posCardSuccessPct: 81,
    ussdSuccessPct: 63,
    avgLatencySec: 55,
    reportsLastHour: 19,
    statusAdvisory: 'SLIGHT_DELAY',
    lastUpdatedIso: new Date(Date.now() - 14 * 60000).toISOString()
  },
  {
    institutionId: 'uba',
    institutionName: 'UBA',
    institutionType: 'COMMERCIAL_BANK',
    appTransferSuccessPct: 88,
    posCardSuccessPct: 90,
    ussdSuccessPct: 84,
    avgLatencySec: 18,
    reportsLastHour: 22,
    statusAdvisory: 'SMOOTH',
    lastUpdatedIso: new Date(Date.now() - 9 * 60000).toISOString()
  }
];

export const INITIAL_MARKET_RADAR: MarketRadarItem[] = [
  {
    id: 'mkt-abj-1',
    stateCode: 'FC',
    category: 'PMS_FUEL',
    locationTitle: 'NNPC Mega Station, Wuse Zone 1',
    priceNgn: 995,
    unitLabel: 'per Litre',
    queueSeverity: 'MOVING_FAST',
    posAccepted: true,
    notes: '6 pumps active, Moniepoint POS working at pump 3 & 4.',
    reportedAtIso: new Date(Date.now() - 19 * 60000).toISOString()
  },
  {
    id: 'mkt-abj-2',
    stateCode: 'FC',
    category: 'PMS_FUEL',
    locationTitle: 'TotalEnergies, Ahmadu Bello Way (Garki)',
    priceNgn: 1045,
    unitLabel: 'per Litre',
    queueSeverity: 'NO_QUEUE',
    posAccepted: true,
    notes: 'Drive straight in. Accepting transfer and card.',
    reportedAtIso: new Date(Date.now() - 34 * 60000).toISOString()
  },
  {
    id: 'mkt-abj-3',
    stateCode: 'FC',
    category: 'ROUTE_FARE',
    locationTitle: 'Lugbe Berger -> Area 1 / Central Area (Along)',
    priceNgn: 800,
    unitLabel: 'per Seat',
    queueSeverity: 'MOVING_FAST',
    posAccepted: false,
    notes: 'Hold cash or OPay transfer to driver before boarding.',
    reportedAtIso: new Date(Date.now() - 25 * 60000).toISOString()
  },
  {
    id: 'mkt-abj-4',
    stateCode: 'FC',
    category: 'COOKING_GAS',
    locationTitle: 'Gwarinpa 3rd Ave Gas Plant',
    priceNgn: 1450,
    unitLabel: 'per Kg',
    queueSeverity: 'NO_QUEUE',
    posAccepted: true,
    notes: '12.5kg cylinder refill is ₦18,125 flat.',
    reportedAtIso: new Date(Date.now() - 52 * 60000).toISOString()
  },
  {
    id: 'mkt-lag-1',
    stateCode: 'LA',
    category: 'PMS_FUEL',
    locationTitle: 'Mobil Allen Roundabout, Ikeja',
    priceNgn: 985,
    unitLabel: 'per Litre',
    queueSeverity: 'MOVING_FAST',
    posAccepted: true,
    notes: 'Slight tailback by Opebi link, POS active.',
    reportedAtIso: new Date(Date.now() - 15 * 60000).toISOString()
  },
  {
    id: 'mkt-lag-2',
    stateCode: 'LA',
    category: 'ROUTE_FARE',
    locationTitle: 'Berger -> Victoria Island / Obalende (Danfo)',
    priceNgn: 1500,
    unitLabel: 'per Seat',
    queueSeverity: 'LONG_HOLDUP',
    posAccepted: false,
    notes: 'Rush hour surge on 3rd Mainland approach.',
    reportedAtIso: new Date(Date.now() - 22 * 60000).toISOString()
  }
];

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[OfflineStorage] Quota warning:', err);
  }
}

export class OfflineSyncEngine {
  static getSelectedState(): StateCode {
    const saved = safeRead<unknown>(STORAGE_KEYS.SELECTED_STATE, null);
    if (isStateCode(saved)) return saved;
    // Carry over the choice from builds that only had Abuja / Lagos
    const legacy = legacyCityToState(safeRead<unknown>(STORAGE_KEYS.LEGACY_SELECTED_CITY, null));
    return legacy || 'FC';
  }

  static setSelectedState(code: StateCode): void {
    safeWrite(STORAGE_KEYS.SELECTED_STATE, code);
  }

  /** Adds a user's own area (street, estate or feeder) under a state, or returns the existing one. */
  static addArea(
    code: StateCode,
    areaName: string,
    discoName: string,
    tariffBand: TariffBand | null
  ): { zones: FeederZoneStatus[]; zoneId: string } {
    const zones = this.getZones();
    const zoneId = areaZoneId(code, areaName);
    if (!zones.some((z) => z.zoneId === zoneId)) {
      zones.push({
        zoneId,
        stateCode: code,
        neighborhood: areaName.trim().slice(0, 80),
        discoName: discoName.trim() || getState(code).disco,
        tariffBand,
        tariffRateNgnKwh: null,
        currentState: 'UNKNOWN',
        lastUpdatedAt: new Date(0).toISOString(),
        recentConfirmations: 0,
        estimatedVoltage: 0
      });
      this.saveZones(zones);
    }
    return { zones: this.getZones(), zoneId };
  }

  static getSelectedZoneId(): string {
    return safeRead<string>(STORAGE_KEYS.SELECTED_ZONE, 'fc-gwarinpa-01');
  }

  static setSelectedZoneId(zoneId: string): void {
    safeWrite(STORAGE_KEYS.SELECTED_ZONE, zoneId);
  }

  static getZones(): FeederZoneStatus[] {
    return safeRead<FeederZoneStatus[]>(STORAGE_KEYS.ZONES, INITIAL_FEEDER_ZONES);
  }

  static saveZones(zones: FeederZoneStatus[]): void {
    safeWrite(STORAGE_KEYS.ZONES, zones);
  }

  static getGeneratorState(): GeneratorState {
    return safeRead<GeneratorState>(STORAGE_KEYS.GENERATOR, INITIAL_GENERATOR_STATE);
  }

  static saveGeneratorState(state: GeneratorState): void {
    safeWrite(STORAGE_KEYS.GENERATOR, state);
  }

  static getChores(): PowerTriggeredChore[] {
    return safeRead<PowerTriggeredChore[]>(STORAGE_KEYS.CHORES, INITIAL_CHORES);
  }

  static saveChores(chores: PowerTriggeredChore[]): void {
    safeWrite(STORAGE_KEYS.CHORES, chores);
  }

  static getBankWeather(): BankWeatherItem[] {
    return safeRead<BankWeatherItem[]>(STORAGE_KEYS.BANK_WEATHER, INITIAL_BANK_WEATHER);
  }

  static saveBankWeather(items: BankWeatherItem[]): void {
    safeWrite(STORAGE_KEYS.BANK_WEATHER, items);
  }

  static getMarketRadar(): MarketRadarItem[] {
    return safeRead<MarketRadarItem[]>(STORAGE_KEYS.MARKET_RADAR, INITIAL_MARKET_RADAR);
  }

  static saveMarketRadar(items: MarketRadarItem[]): void {
    safeWrite(STORAGE_KEYS.MARKET_RADAR, items);
  }

  static getOutbox(): OutboxMutation[] {
    return safeRead<OutboxMutation[]>(STORAGE_KEYS.OUTBOX, []);
  }

  static saveOutbox(queue: OutboxMutation[]): void {
    safeWrite(STORAGE_KEYS.OUTBOX, queue);
  }

  /**
   * Optimistically updates local neighborhood grid status + queues background mutation
   */
  static recordPowerPing(
    zoneId: string,
    newState: GridPowerState,
    detectedVia: 'MANUAL' | 'CHARGER_HOOK' = 'MANUAL'
  ): FeederZoneStatus[] {
    const zones = this.getZones();
    const nowIso = new Date().toISOString();

    const updated = zones.map((z) => {
      if (z.zoneId !== zoneId) return z;
      return {
        ...z,
        currentState: newState,
        lastUpdatedAt: nowIso,
        recentConfirmations: z.recentConfirmations + 1,
        estimatedVoltage:
          newState === 'ON_GRID' ? 226 : newState === 'LOW_VOLTAGE' ? 162 : 0
      };
    });

    this.saveZones(updated);

    const zone = updated.find((z) => z.zoneId === zoneId);
    this.enqueueMutation('PING_POWER', {
      zoneId,
      stateCode: zone?.stateCode,
      neighborhood: zone?.neighborhood,
      discoName: zone?.discoName,
      tariffBand: zone?.tariffBand,
      gridState: newState,
      detectedVia,
      voltageEstimate: newState === 'ON_GRID' ? 226 : newState === 'LOW_VOLTAGE' ? 162 : 0
    });

    return updated;
  }

  /**
   * Optimistically recalculates Bank/POS reliability weather + queues telemetry report
   */
  static recordBankReport(
    institutionId: string,
    channel: BankChannel,
    outcome: TransferOutcome
  ): BankWeatherItem[] {
    const items = this.getBankWeather();
    const nowIso = new Date().toISOString();

    const scoreDelta =
      outcome === 'INSTANT'
        ? 4
        : outcome === 'DELAYED'
        ? -5
        : outcome === 'HANGING'
        ? -14
        : -18;

    const updated = items.map((bank) => {
      if (bank.institutionId !== institutionId) return bank;

      const clamp = (val: number) => Math.max(15, Math.min(99, val));
      const nextApp =
        channel === 'APP_TRANSFER'
          ? clamp(bank.appTransferSuccessPct + scoreDelta)
          : bank.appTransferSuccessPct;
      const nextPos =
        channel === 'POS_CARD'
          ? clamp(bank.posCardSuccessPct + scoreDelta)
          : bank.posCardSuccessPct;
      const nextUssd =
        channel === 'USSD'
          ? clamp(bank.ussdSuccessPct + scoreDelta)
          : bank.ussdSuccessPct;

      const minMainScore = Math.min(nextApp, nextPos);
      const statusAdvisory: BankWeatherItem['statusAdvisory'] =
        minMainScore >= 80
          ? 'SMOOTH'
          : minMainScore >= 60
          ? 'SLIGHT_DELAY'
          : 'HIGH_FAILURE_HOLD_ON';

      return {
        ...bank,
        appTransferSuccessPct: nextApp,
        posCardSuccessPct: nextPos,
        ussdSuccessPct: nextUssd,
        reportsLastHour: bank.reportsLastHour + 1,
        avgLatencySec:
          outcome === 'INSTANT'
            ? Math.max(5, Math.round(bank.avgLatencySec * 0.85))
            : Math.min(240, bank.avgLatencySec + 35),
        statusAdvisory,
        lastUpdatedIso: nowIso
      };
    });

    this.saveBankWeather(updated);

    const targetBank = items.find((b) => b.institutionId === institutionId);
    this.enqueueMutation('REPORT_BANK', {
      institutionId,
      institutionName: targetBank?.institutionName || institutionId,
      institutionType: targetBank?.institutionType || 'COMMERCIAL_BANK',
      channel,
      outcome,
      stateCode: this.getSelectedState()
    });

    return updated;
  }

  /**
   * Optimistically adds a roadside fuel/fare radar report + queues sync
   */
  static addMarketRadarReport(
    item: Omit<MarketRadarItem, 'id' | 'reportedAtIso'>
  ): MarketRadarItem[] {
    const current = this.getMarketRadar();
    const newReport: MarketRadarItem = {
      ...item,
      id: `mkt-${Date.now()}`,
      reportedAtIso: new Date().toISOString()
    };

    const updated = [newReport, ...current];
    this.saveMarketRadar(updated);

    this.enqueueMutation('REPORT_MARKET_RADAR', newReport as unknown as Record<string, unknown>);
    return updated;
  }

  static enqueueMutation(
    type: OutboxMutation['type'],
    payload: Record<string, unknown>
  ): void {
    const outbox = this.getOutbox();
    const mutation: OutboxMutation = {
      mutationId: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type,
      payload,
      createdAtIso: new Date().toISOString(),
      retryCount: 0
    };
    this.saveOutbox([...outbox, mutation]);
  }

  /**
   * Flushes pending offline mutations to the Node/Supabase backend when network is online
   */
  static async flushOutbox(): Promise<{ flushedCount: number; remainingCount: number }> {
    const outbox = this.getOutbox();
    if (outbox.length === 0 || !navigator.onLine) {
      return { flushedCount: 0, remainingCount: outbox.length };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sync-outbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mutations: outbox })
      });

      if (!response.ok) {
        return { flushedCount: 0, remainingCount: outbox.length };
      }

      const data = (await response.json()) as { processedIds: string[] };
      const processedSet = new Set(data.processedIds || []);
      const remaining = outbox.filter((m) => !processedSet.has(m.mutationId));
      this.saveOutbox(remaining);

      return {
        flushedCount: outbox.length - remaining.length,
        remainingCount: remaining.length
      };
    } catch {
      // Remain gracefully in offline mode
      return { flushedCount: 0, remainingCount: outbox.length };
    }
  }

  /**
   * Pulls the live crowd snapshot from /api/v1/bootstrap and merges it into local state.
   * Returns null (and leaves local data untouched) when offline or the backend has no data yet.
   */
  static async pullLiveSnapshot(code: StateCode): Promise<{
    zones: FeederZoneStatus[];
    bankWeather: BankWeatherItem[];
    marketRadar: MarketRadarItem[];
  } | null> {
    if (!navigator.onLine) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/bootstrap?state=${code}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.mode !== 'LIVE' && data.mode !== 'SUPABASE_LIVE') return null;

      // Zones: server rows win by id; areas this phone added that the server lacks are kept
      let zones = this.getZones();
      if (Array.isArray(data.zones) && data.zones.length > 0) {
        const serverZones: FeederZoneStatus[] = data.zones.map((r: any) => ({
          zoneId: r.zone_id,
          stateCode: r.state_code,
          neighborhood: r.neighborhood,
          discoName: r.disco_name,
          tariffBand: r.tariff_band ?? null,
          tariffRateNgnKwh: r.tariff_rate_ngn_kwh == null ? null : Number(r.tariff_rate_ngn_kwh),
          currentState: r.current_state,
          lastUpdatedAt: r.last_updated_at,
          recentConfirmations: Number(r.recent_confirmations),
          estimatedVoltage: Number(r.estimated_voltage)
        }));
        const serverIds = new Set(serverZones.map((z) => z.zoneId));
        zones = [...zones.filter((z) => !serverIds.has(z.zoneId)), ...serverZones];
        this.saveZones(zones);
      }

      // Bank weather: the view returns one row per institution+channel; fold into one card each
      let bankWeather = this.getBankWeather();
      if (Array.isArray(data.bankWeather) && data.bankWeather.length > 0) {
        const byInst = new Map<string, BankWeatherItem>(
          bankWeather.map((b) => [b.institutionId, { ...b }])
        );
        const latencyAcc = new Map<string, { sum: number; n: number }>();
        for (const r of data.bankWeather) {
          const base: BankWeatherItem = byInst.get(r.institution_id) || {
            institutionId: r.institution_id,
            institutionName: r.institution_name,
            institutionType: r.institution_type,
            appTransferSuccessPct: 90,
            posCardSuccessPct: 90,
            ussdSuccessPct: 90,
            avgLatencySec: 10,
            reportsLastHour: 0,
            statusAdvisory: 'SMOOTH',
            lastUpdatedIso: r.last_reported_at
          };
          if (!latencyAcc.has(r.institution_id)) {
            base.reportsLastHour = 0;
            latencyAcc.set(r.institution_id, { sum: 0, n: 0 });
          }
          const pct = Number(r.success_rate_pct);
          if (r.channel === 'APP_TRANSFER') base.appTransferSuccessPct = pct;
          if (r.channel === 'POS_CARD') base.posCardSuccessPct = pct;
          if (r.channel === 'USSD') base.ussdSuccessPct = pct;
          base.reportsLastHour += Number(r.total_reports_60m);
          const acc = latencyAcc.get(r.institution_id)!;
          acc.sum += Number(r.avg_latency_sec) * Number(r.total_reports_60m);
          acc.n += Number(r.total_reports_60m);
          base.avgLatencySec = Math.round(acc.sum / Math.max(1, acc.n));
          if (r.last_reported_at > base.lastUpdatedIso) base.lastUpdatedIso = r.last_reported_at;
          const minMain = Math.min(base.appTransferSuccessPct, base.posCardSuccessPct);
          base.statusAdvisory =
            minMain >= 80 ? 'SMOOTH' : minMain >= 60 ? 'SLIGHT_DELAY' : 'HIGH_FAILURE_HOLD_ON';
          byInst.set(r.institution_id, base);
        }
        bankWeather = Array.from(byInst.values());
        this.saveBankWeather(bankWeather);
      }

      // Market radar: server feed for this state, other states stay cached
      let marketRadar = this.getMarketRadar();
      if (Array.isArray(data.marketRadar) && data.marketRadar.length > 0) {
        const serverItems: MarketRadarItem[] = data.marketRadar.map((r: any) => ({
          id: r.id,
          stateCode: r.state_code,
          category: r.category,
          locationTitle: r.location_title,
          priceNgn: Number(r.price_ngn),
          unitLabel: r.unit_label,
          queueSeverity: r.queue_severity,
          posAccepted: Boolean(r.pos_accepted),
          notes: r.notes || '',
          reportedAtIso: r.created_at
        }));
        marketRadar = [...serverItems, ...marketRadar.filter((m) => m.stateCode !== code)];
        this.saveMarketRadar(marketRadar);
      }

      return { zones, bankWeather, marketRadar };
    } catch {
      return null;
    }
  }
}
