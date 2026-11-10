import type { StateCode, TariffBand } from '../data/nigeriaStates';

export type { StateCode, TariffBand };

/** What a user can report. */
export type GridPowerState = 'ON_GRID' | 'OFF_GRID' | 'LOW_VOLTAGE';
/** What a zone can show: UNKNOWN means nobody in that area has reported yet. */
export type ZoneDisplayState = GridPowerState | 'UNKNOWN';

export interface FeederZoneStatus {
  zoneId: string;
  stateCode: StateCode;
  neighborhood: string;
  discoName: string;
  tariffBand: TariffBand | null; // null until someone in the area sets it
  tariffRateNgnKwh: number | null;
  currentState: ZoneDisplayState;
  lastUpdatedAt: string; // ISO timestamp
  recentConfirmations: number;
  estimatedVoltage: number;
}

export interface GeneratorState {
  isRunning: boolean;
  startedAtIso: string | null;
  tankCapacityLitres: number;
  fuelLevelAtStartLitres: number;
  currentFuelLitres: number;
  burnRateLitresPerHour: number; // e.g., 1.4L/hr for 3.5kVA Firman/Elepaq
  fuelPricePerLitreNgn: number;  // e.g., 1030 NGN
  inverterBatteryPct: number;
  totalGenHoursThisWeek: number;
}

export type PowerTriggerCondition = 'ON_GRID_RESTORED' | 'BEFORE_GEN_OFF' | 'MORNING_5AM';

export interface PowerTriggeredChore {
  id: string;
  title: string;
  category: 'WATER_PUMP' | 'IRONING' | 'CHARGING' | 'FREEZER' | 'ERRAND';
  triggerCondition: PowerTriggerCondition;
  estimatedMinutes: number;
  requiresHeavyLoad: boolean; // True for pressing iron or pumping machine (warn on Low Voltage/Inverter)
  completed: boolean;
  createdAtIso: string;
}

export type BankChannel = 'APP_TRANSFER' | 'POS_CARD' | 'USSD';
export type TransferOutcome = 'INSTANT' | 'DELAYED' | 'FAILED_REVERSED' | 'HANGING';

export interface BankWeatherItem {
  institutionId: string;
  institutionName: string;
  institutionType: 'FINTECH' | 'COMMERCIAL_BANK';
  appTransferSuccessPct: number;
  posCardSuccessPct: number;
  ussdSuccessPct: number;
  avgLatencySec: number;
  reportsLastHour: number;
  statusAdvisory: 'SMOOTH' | 'SLIGHT_DELAY' | 'HIGH_FAILURE_HOLD_ON';
  lastUpdatedIso: string;
}

export interface MarketRadarItem {
  id: string;
  stateCode: StateCode;
  category: 'PMS_FUEL' | 'DIESEL' | 'COOKING_GAS' | 'ROUTE_FARE';
  locationTitle: string;
  priceNgn: number;
  unitLabel: string;
  queueSeverity: 'NO_QUEUE' | 'MOVING_FAST' | 'LONG_HOLDUP' | 'LOCKED_UP';
  posAccepted: boolean;
  notes: string;
  reportedAtIso: string;
}

export type OutboxMutationType = 'PING_POWER' | 'REPORT_BANK' | 'REPORT_MARKET_RADAR';

export interface OutboxMutation {
  mutationId: string;
  type: OutboxMutationType;
  payload: Record<string, unknown>;
  createdAtIso: string;
  retryCount: number;
}
