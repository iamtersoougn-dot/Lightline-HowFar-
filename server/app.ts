/**
 * The Lightline HTTP API. Built as a function so tests can start it against a test database.
 */
import express, { Request, Response } from 'express';
import cors from 'cors';
import { StateCode, isStateCode, legacyCityToState } from '../src/data/nigeriaStates';
import { createAgentChatHandler, type AgentChatOptions } from './agentChat';
import type { Db } from './db';
import { bootstrap, ingest, type Mutation } from './store';

export interface AppOptions {
  db: Db | null;
  chat: AgentChatOptions;
  /** Per device (IP): sync requests allowed per 10 minutes */
  syncLimit?: number;
}

export function createApp(opts: AppOptions) {
  const app = express();
  app.set('trust proxy', 1); // Render and similar hosts sit behind one proxy
  app.use(cors()); // public read API with no cookies; phones (https://localhost in the app) and browsers both call it
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', async (_req, res) => {
    if (!opts.db) return res.json({ ok: true, database: 'not configured', chat: opts.chat.provider });
    try {
      await opts.db.query('SELECT 1');
      res.json({ ok: true, database: 'connected', chat: opts.chat.apiKey ? opts.chat.provider : 'off' });
    } catch {
      res.status(503).json({ ok: false, database: 'unreachable' });
    }
  });

  // Daily Guide online answers (optional; the app answers on the phone without it)
  app.post('/api/v1/agent/chat', createAgentChatHandler(opts.chat));

  // Low-data single round trip: area light status, bank network, prices for one state
  app.get('/api/v1/bootstrap', async (req: Request, res: Response) => {
    const fromQuery = String(req.query.state || '').toUpperCase();
    const stateCode: StateCode | null = isStateCode(fromQuery) ? fromQuery : legacyCityToState(req.query.city);
    if (!stateCode) {
      return res.status(400).json({ error: 'Pass ?state= with a state code, e.g. ?state=LA or ?state=FC' });
    }
    if (!opts.db) {
      return res.json({ mode: 'LOCAL_FALLBACK_ACTIVE', stateCode, syncedAt: new Date().toISOString() });
    }
    try {
      const data = await bootstrap(opts.db, stateCode);
      return res.json({ mode: 'LIVE', stateCode, ...data, syncedAt: new Date().toISOString() });
    } catch (error) {
      console.error('[bootstrap]', (error as Error).message);
      return res.status(500).json({ error: 'Failed to fetch live reports' });
    }
  });

  // Offline outbox: batched reports, stored once each (client_mutation_id)
  const hits = new Map<string, number[]>();
  const limit = opts.syncLimit ?? 60;
  app.post('/api/v1/sync-outbox', async (req: Request, res: Response) => {
    const who = String(req.ip || 'anon');
    const now = Date.now();
    const recent = (hits.get(who) || []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= limit) return res.status(429).json({ error: 'Too many syncs. Try again shortly.' });
    recent.push(now);
    hits.set(who, recent);
    if (hits.size > 10_000) hits.clear();

    const mutations = (req.body?.mutations ?? []) as Mutation[];
    if (!Array.isArray(mutations) || mutations.length === 0) return res.json({ processedIds: [] });
    const batch = mutations.slice(0, 200);

    if (!opts.db) {
      // No database configured (local development): acknowledge so the outbox can be tested
      return res.json({ processedIds: batch.map((m) => m.mutationId), mode: 'MOCK_ACK' });
    }

    const processedIds: string[] = [];
    for (const m of batch) {
      try {
        if (await ingest(opts.db, m)) processedIds.push(m.mutationId);
      } catch (err) {
        // Database trouble: leave it in the phone's outbox to retry later
        console.error(`[sync] ${m?.mutationId}:`, (err as Error).message);
      }
    }
    return res.json({ processedIds, syncedAt: new Date().toISOString() });
  });

  return app;
}
