import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  StateCode,
  TARIFF_BANDS,
  getState,
  isStateCode,
  legacyCityToState
} from '../src/data/nigeriaStates';
import { createAgentChatHandler } from './agentChat';

/** Accepts a state code, or a city name from older app builds still in someone's outbox. */
function resolveState(payload: Record<string, any>): StateCode | null {
  if (isStateCode(payload.stateCode)) return payload.stateCode;
  return legacyCityToState(payload.city);
}

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

/**
 * POST /api/v1/agent/chat — Daily Guide online answers (optional; the app works without it)
 */
app.post(
  '/api/v1/agent/chat',
  createAgentChatHandler({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.GUIDE_MODEL || 'claude-haiku-5-5'
  })
);

/**
 * GET /api/v1/bootstrap
 * Low-data single roundtrip endpoint returning Neighborhood Power, Bank Weather, and Fuel/Commute Radar
 */
app.get('/api/v1/bootstrap', async (req: Request, res: Response) => {
  const fromQuery = String(req.query.state || '').toUpperCase();
  const stateCode: StateCode | null = isStateCode(fromQuery)
    ? fromQuery
    : legacyCityToState(req.query.city);
  if (!stateCode) {
    return res.status(400).json({ error: 'Pass ?state= with a state code, e.g. ?state=LA or ?state=FC' });
  }

  if (!supabase) {
    return res.status(200).json({
      mode: 'LOCAL_FALLBACK_ACTIVE',
      stateCode,
      syncedAt: new Date().toISOString()
    });
  }

  try {
    const [zonesRes, bankRes, radarRes] = await Promise.all([
      supabase.from('v_live_neighborhood_power').select('*').eq('state_code', stateCode),
      supabase.from('v_live_bank_weather').select('*'),
      supabase
        .from('market_radar_reports')
        .select('*')
        .eq('state_code', stateCode)
        .order('created_at', { ascending: false })
        .limit(25)
    ]);

    return res.status(200).json({
      mode: 'SUPABASE_LIVE',
      stateCode,
      zones: zonesRes.data || [],
      bankWeather: bankRes.data || [],
      marketRadar: radarRes.data || [],
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Bootstrap Sync Error]:', error);
    return res.status(500).json({ error: 'Failed to fetch live telemetry' });
  }
});

/**
 * POST /api/v1/sync-outbox
 * Processes batched offline mutations idempotently using client_mutation_id
 */
app.post('/api/v1/sync-outbox', async (req: Request, res: Response) => {
  const { mutations } = req.body as {
    mutations: Array<{
      mutationId: string;
      type: 'PING_POWER' | 'REPORT_BANK' | 'REPORT_MARKET_RADAR';
      payload: Record<string, any>;
      createdAtIso: string;
    }>;
  };

  if (!Array.isArray(mutations) || mutations.length === 0) {
    return res.status(200).json({ processedIds: [] });
  }

  if (!supabase) {
    // Acknowledge in local-dev mode if Supabase env credentials are not yet wired
    return res.status(200).json({
      processedIds: mutations.map((m) => m.mutationId),
      mode: 'MOCK_ACK'
    });
  }

  const processedIds: string[] = [];

  for (const item of mutations) {
    try {
      if (item.type === 'PING_POWER') {
        // Legacy zone ids from the Abuja/Lagos-only build
        const zoneId = String(item.payload.zoneId || '')
          .replace(/^abj-/, 'fc-')
          .replace(/^lag-/, 'la-');
        const zoneState = resolveState(item.payload) || (isStateCode(zoneId.slice(0, 2).toUpperCase()) ? (zoneId.slice(0, 2).toUpperCase() as StateCode) : null);
        if (!zoneId || !zoneState) {
          processedIds.push(item.mutationId); // unusable report: acknowledge so it leaves the outbox
          continue;
        }
        // Areas users add on their phone are created on their first report
        await supabase.from('feeder_zones').upsert(
          {
            id: zoneId,
            state_code: zoneState,
            neighborhood: String(item.payload.neighborhood || zoneId).slice(0, 80),
            disco_name: String(item.payload.discoName || getState(zoneState).disco).slice(0, 40),
            tariff_band: TARIFF_BANDS.includes(item.payload.tariffBand) ? item.payload.tariffBand : null
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
        const { error } = await supabase.from('power_pings').upsert(
          {
            client_mutation_id: item.mutationId,
            zone_id: zoneId,
            grid_state: item.payload.gridState,
            voltage_estimate: item.payload.voltageEstimate || 220,
            detected_via: item.payload.detectedVia || 'MANUAL',
            reporter_alias: item.payload.reporterAlias || 'Citizen',
            created_at: item.createdAtIso
          },
          { onConflict: 'client_mutation_id' }
        );
        if (!error) processedIds.push(item.mutationId);
      } else if (item.type === 'REPORT_BANK') {
        const { error } = await supabase.from('bank_telemetry_logs').upsert(
          {
            client_mutation_id: item.mutationId,
            institution_id: item.payload.institutionId,
            institution_name: item.payload.institutionName,
            institution_type: item.payload.institutionType,
            channel: item.payload.channel,
            outcome: item.payload.outcome,
            latency_seconds: item.payload.latencySeconds || 15,
            state_code: resolveState(item.payload),
            created_at: item.createdAtIso
          },
          { onConflict: 'client_mutation_id' }
        );
        if (!error) processedIds.push(item.mutationId);
      } else if (item.type === 'REPORT_MARKET_RADAR') {
        const radarState = resolveState(item.payload);
        if (!radarState) {
          processedIds.push(item.mutationId);
          continue;
        }
        const { error } = await supabase.from('market_radar_reports').upsert(
          {
            client_mutation_id: item.mutationId,
            state_code: radarState,
            category: item.payload.category,
            location_title: item.payload.locationTitle,
            price_ngn: item.payload.priceNgn,
            unit_label: item.payload.unitLabel,
            queue_severity: item.payload.queueSeverity,
            pos_accepted: item.payload.posAccepted ?? true,
            notes: item.payload.notes || '',
            created_at: item.createdAtIso
          },
          { onConflict: 'client_mutation_id' }
        );
        if (!error) processedIds.push(item.mutationId);
      }
    } catch (err) {
      console.error(`Failed processing mutation ${item.mutationId}:`, err);
    }
  }

  return res.status(200).json({
    processedIds,
    syncedAt: new Date().toISOString()
  });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`[Lightline Backend] Listening on port ${PORT}`);
});
