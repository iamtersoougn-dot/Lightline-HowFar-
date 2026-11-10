/**
 * Reading and writing community reports. Every incoming report is checked before it is
 * stored; a report that can never be valid is acknowledged and dropped, so it does not sit in
 * a phone's outbox forever.
 */
import {
  StateCode,
  TARIFF_BANDS,
  getState,
  isStateCode,
  legacyCityToState
} from '../src/data/nigeriaStates';
import type { Db } from './db';

export interface Mutation {
  mutationId: string;
  type: 'PING_POWER' | 'REPORT_BANK' | 'REPORT_MARKET_RADAR';
  payload: Record<string, any>;
  createdAtIso: string;
}

const GRID = ['ON_GRID', 'OFF_GRID', 'LOW_VOLTAGE'];
const DETECTED = ['MANUAL', 'CHARGER_HOOK'];
const INST_TYPE = ['FINTECH', 'COMMERCIAL_BANK'];
const CHANNEL = ['APP_TRANSFER', 'POS_CARD', 'USSD'];
const OUTCOME = ['INSTANT', 'DELAYED', 'FAILED_REVERSED', 'HANGING'];
const CATEGORY = ['PMS_FUEL', 'DIESEL', 'COOKING_GAS', 'ROUTE_FARE'];
const QUEUE = ['NO_QUEUE', 'MOVING_FAST', 'LONG_HOLDUP', 'LOCKED_UP'];

/** Accepts a state code, or a city name from older app builds still in someone's outbox. */
export function resolveState(payload: Record<string, any>): StateCode | null {
  if (isStateCode(payload.stateCode)) return payload.stateCode;
  return legacyCityToState(payload.city);
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Report time from the phone, kept within sensible bounds (no future, at most 30 days old). */
export function reportTime(iso: unknown, now = new Date()): Date {
  const t = typeof iso === 'string' ? new Date(iso) : new Date(NaN);
  if (isNaN(t.getTime())) return now;
  if (t.getTime() > now.getTime() + 5 * 60_000) return now;
  if (t.getTime() < now.getTime() - 30 * 86_400_000) return new Date(now.getTime() - 30 * 86_400_000);
  return t;
}

export async function bootstrap(db: Db, stateCode: StateCode) {
  const [zones, bank, radar] = await Promise.all([
    db.query('SELECT * FROM v_live_neighborhood_power WHERE state_code = $1', [stateCode]),
    db.query('SELECT * FROM v_live_bank_weather'),
    db.query(
      'SELECT * FROM market_radar_reports WHERE state_code = $1 ORDER BY created_at DESC LIMIT 25',
      [stateCode]
    )
  ]);
  return { zones: zones.rows, bankWeather: bank.rows, marketRadar: radar.rows };
}

/** Stores one report. Returns true when the phone can remove it from its outbox. */
export async function ingest(db: Db, m: Mutation, now = new Date()): Promise<boolean> {
  const id = text(m.mutationId, 100);
  if (!id || !m.payload || typeof m.payload !== 'object') return true; // malformed: drop
  const p = m.payload;
  const at = reportTime(m.createdAtIso, now);

  if (m.type === 'PING_POWER') {
    // Legacy zone ids from the Abuja/Lagos-only build
    const zoneId = text(p.zoneId, 80).replace(/^abj-/, 'fc-').replace(/^lag-/, 'la-');
    const prefix = zoneId.slice(0, 2).toUpperCase();
    const state = resolveState(p) || (isStateCode(prefix) ? prefix : null);
    if (!zoneId || !state || !GRID.includes(p.gridState)) return true;
    // Areas users add on their phone are created on their first report
    await db.query(
      `INSERT INTO feeder_zones (id, state_code, neighborhood, disco_name, tariff_band)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [
        zoneId,
        state,
        text(p.neighborhood, 80) || zoneId,
        text(p.discoName, 40) || getState(state).disco,
        TARIFF_BANDS.includes(p.tariffBand) ? p.tariffBand : null
      ]
    );
    const voltage = Number.isFinite(Number(p.voltageEstimate)) ? Math.max(0, Math.min(300, Math.round(Number(p.voltageEstimate)))) : 220;
    await db.query(
      `INSERT INTO power_pings (client_mutation_id, zone_id, grid_state, voltage_estimate, detected_via, reporter_alias, created_at)
       VALUES ($1, $2, $3, $4, $5, 'Neighbor', $6) ON CONFLICT (client_mutation_id) DO NOTHING`,
      [id, zoneId, p.gridState, voltage, DETECTED.includes(p.detectedVia) ? p.detectedVia : 'MANUAL', at]
    );
    return true;
  }

  if (m.type === 'REPORT_BANK') {
    const inst = text(p.institutionId, 40);
    if (!inst || !CHANNEL.includes(p.channel) || !OUTCOME.includes(p.outcome)) return true;
    await db.query(
      `INSERT INTO bank_telemetry_logs (client_mutation_id, institution_id, institution_name, institution_type, channel, outcome, latency_seconds, state_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (client_mutation_id) DO NOTHING`,
      [
        id,
        inst,
        text(p.institutionName, 60) || inst,
        INST_TYPE.includes(p.institutionType) ? p.institutionType : 'COMMERCIAL_BANK',
        p.channel,
        p.outcome,
        Number.isFinite(Number(p.latencySeconds)) ? Math.max(0, Math.min(3600, Math.round(Number(p.latencySeconds)))) : 15,
        resolveState(p),
        at
      ]
    );
    return true;
  }

  if (m.type === 'REPORT_MARKET_RADAR') {
    const state = resolveState(p);
    const price = Number(p.priceNgn);
    const location = text(p.locationTitle, 120);
    if (!state || !CATEGORY.includes(p.category) || !(price > 0 && price < 1_000_000) || !location) return true;
    await db.query(
      `INSERT INTO market_radar_reports (client_mutation_id, state_code, category, location_title, price_ngn, unit_label, queue_severity, pos_accepted, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (client_mutation_id) DO NOTHING`,
      [
        id,
        state,
        p.category,
        location,
        price,
        text(p.unitLabel, 20) || 'per Litre',
        QUEUE.includes(p.queueSeverity) ? p.queueSeverity : 'MOVING_FAST',
        p.posAccepted !== false,
        text(p.notes, 200),
        at
      ]
    );
    return true;
  }

  return true; // unknown type from a future app version: drop
}
