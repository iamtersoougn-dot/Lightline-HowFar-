/**
 * Server tests: Neon connection strings, the Gemini/Claude chat switch, and (with a test
 * database) the full API against real Postgres, including the app reading the server's data.
 *
 * Run: npm run test:server
 * Database tests need TEST_DATABASE_URL, e.g.
 *   TEST_DATABASE_URL=postgres://lightline:lightline@localhost:5432/lightline_test npm run test:server
 * The test database is wiped on every run. Never point this at Neon production.
 */
process.env.TZ = 'Africa/Lagos';
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

import type { AddressInfo } from 'node:net';
const { normaliseDatabaseUrl, createDb, migrate } = await import('../server/db');
const { createApp } = await import('../server/app');
const { chatOptionsFromEnv, createAgentChatHandler, DEFAULT_MODELS } = await import('../server/agentChat');
const { reportTime } = await import('../server/store');

let passed = 0;
let skipped = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
  }
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const mockRes = () => {
  const r: any = { code: 200, body: null };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};

// ---------------------------------------------------------------- no database needed
await test('neon: connection string pasted as copied works', () => {
  const n = normaliseDatabaseUrl('postgresql://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
  ok(!n.connectionString.includes('channel_binding'), 'channel_binding removed');
  ok(n.ssl === true, 'TLS on for Neon');
  ok(n.connectionString.includes('neon.tech/neondb'), 'host and db kept');
  ok(normaliseDatabaseUrl('postgres://a:b@localhost:5432/x').ssl === false, 'no TLS for local Postgres');
});

await test('chat: Gemini is used when a Gemini key is set', () => {
  const g = chatOptionsFromEnv({ GEMINI_API_KEY: 'g' });
  ok(g.provider === 'gemini' && g.apiKey === 'g' && g.model === DEFAULT_MODELS.gemini, JSON.stringify(g));
  const a = chatOptionsFromEnv({ ANTHROPIC_API_KEY: 'a' });
  ok(a.provider === 'anthropic' && a.apiKey === 'a', 'Claude when only a Claude key');
  const forced = chatOptionsFromEnv({ GUIDE_AI_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', GUIDE_MODEL: 'm1' });
  ok(forced.provider === 'anthropic' && forced.model === 'm1', 'explicit provider and model');
  ok(chatOptionsFromEnv({}).apiKey === undefined, 'no key → chat off');
});

await test('chat: Gemini request format, reply parsing and number check', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const reply = (text: string) =>
    (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] } }] }));
    }) as any;
  const req = { body: { question: 'How much fuel?', lang: 'pcm', draft: 'Buy like 20L.', facts: { genLitresPerDay: 4.2 } }, headers: {}, ip: '9.9.9.9' } as any;
  const res = mockRes();
  await createAgentChatHandler({ provider: 'gemini', apiKey: 'gk', model: 'gemini-x', fetchImpl: reply('You go need like 20L this week.') })(req, res);
  ok(seen!.url.endsWith('/models/gemini-x:generateContent'), `url ${seen!.url}`);
  ok((seen!.init.headers as Record<string, string>)['x-goog-api-key'] === 'gk', 'key in header, not in the URL');
  const body = JSON.parse(String(seen!.init.body));
  ok(/Pidgin/.test(body.systemInstruction.parts[0].text), 'Pidgin instruction for pcm');
  ok(res.body?.text === 'You go need like 20L this week.' && res.body.grounded, `reply ${JSON.stringify(res.body)}`);

  const invented = mockRes();
  await createAgentChatHandler({ provider: 'gemini', apiKey: 'gk', model: 'gemini-x', fetchImpl: reply('Buy 35L.') })(req, invented);
  ok(invented.body?.text === 'Buy like 20L.' && invented.body.grounded === false, 'invented number → phone answer');

  const missing = mockRes();
  await createAgentChatHandler({ provider: 'gemini', apiKey: 'gk', model: 'nope', fetchImpl: (async () => new Response('{}', { status: 404 })) as any })(req, missing);
  ok(missing.code === 502, `unknown model → 502, got ${missing.code}`);
});

await test('sync: report times are kept within bounds', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  ok(reportTime('2026-11-10T13:00:00Z', now).getTime() === now.getTime(), 'future → now');
  ok(reportTime('garbage', now).getTime() === now.getTime(), 'invalid → now');
  ok(reportTime('2026-01-01T00:00:00Z', now).getTime() === now.getTime() - 30 * 86_400_000, 'very old → 30 days');
});

await test('no database: fallback mode keeps the app working', async () => {
  const server = createApp({ db: null, chat: chatOptionsFromEnv({}) }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const b = await (await fetch(`${base}/api/v1/bootstrap?state=KN`)).json();
    ok(b.mode === 'LOCAL_FALLBACK_ACTIVE' && b.stateCode === 'KN', JSON.stringify(b));
    const s = await (await fetch(`${base}/api/v1/sync-outbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mutations: [{ mutationId: 'x', type: 'PING_POWER', payload: {}, createdAtIso: '' }] }) })).json();
    ok(s.mode === 'MOCK_ACK' && s.processedIds[0] === 'x', JSON.stringify(s));
    const h = await (await fetch(`${base}/health`)).json();
    ok(h.ok && h.database === 'not configured', JSON.stringify(h));
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------- real Postgres
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  skipped = 1;
  console.log('  (database tests skipped: set TEST_DATABASE_URL to a throwaway Postgres database)');
} else {
  const db = createDb(TEST_DB)!;
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const server = createApp({ db, chat: chatOptionsFromEnv({}), syncLimit: 1000 }).listen(4000);
  const base = 'http://127.0.0.1:4000';
  const post = async (mutations: unknown[]) =>
    (await fetch(`${base}/api/v1/sync-outbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mutations }) })).json();
  const now = new Date().toISOString();

  await test('db: tables created on start, safe to run twice', async () => {
    await migrate(db);
    await migrate(db);
    const n = await db.query('SELECT count(*)::int AS n FROM ng_states');
    ok(n.rows[0].n === 37, `states ${n.rows[0].n}`);
    const h = await (await fetch(`${base}/health`)).json();
    ok(h.database === 'connected', JSON.stringify(h));
  });

  await test('db: a new area is created on its first light report and shown to neighbours', async () => {
    const r = await post([{ mutationId: 'p1', type: 'PING_POWER', payload: { zoneId: 'ri-rumuola', stateCode: 'RI', neighborhood: 'Rumuola', gridState: 'OFF_GRID', voltageEstimate: 0 }, createdAtIso: now }]);
    ok(r.processedIds.includes('p1'), JSON.stringify(r));
    const b = await (await fetch(`${base}/api/v1/bootstrap?state=RI`)).json();
    ok(b.mode === 'LIVE', `mode ${b.mode}`);
    const z = b.zones.find((x: any) => x.zone_id === 'ri-rumuola');
    ok(z && z.current_state === 'OFF_GRID' && Number(z.recent_confirmations) === 1 && z.disco_name === 'PHED', JSON.stringify(z));
    const cap = b.zones.find((x: any) => x.zone_id === 'ri-capital');
    ok(cap && cap.current_state === 'UNKNOWN', 'unreported areas say UNKNOWN');
  });

  await test('db: the same report sent twice is stored once', async () => {
    await post([{ mutationId: 'p1', type: 'PING_POWER', payload: { zoneId: 'ri-rumuola', stateCode: 'RI', gridState: 'OFF_GRID' }, createdAtIso: now }]);
    const n = await db.query("SELECT count(*)::int AS n FROM power_pings WHERE zone_id = 'ri-rumuola'");
    ok(n.rows[0].n === 1, `pings ${n.rows[0].n}`);
  });

  await test('db: bad reports are dropped (acknowledged) without being stored', async () => {
    const r = await post([
      { mutationId: 'bad1', type: 'PING_POWER', payload: { zoneId: 'ri-rumuola', stateCode: 'RI', gridState: 'MAYBE' }, createdAtIso: now },
      { mutationId: 'bad2', type: 'REPORT_MARKET_RADAR', payload: { stateCode: 'RI', category: 'PMS_FUEL', locationTitle: 'X', priceNgn: -5 }, createdAtIso: now },
      { mutationId: 'bad3', type: 'SOMETHING_NEW', payload: {}, createdAtIso: now }
    ]);
    ok(['bad1', 'bad2', 'bad3'].every((id) => r.processedIds.includes(id)), JSON.stringify(r));
    const n = await db.query("SELECT (SELECT count(*) FROM power_pings WHERE client_mutation_id LIKE 'bad%') + (SELECT count(*) FROM market_radar_reports WHERE client_mutation_id LIKE 'bad%') AS n");
    ok(Number(n.rows[0].n) === 0, 'nothing stored');
  });

  await test('db: bank reports feed the live bank network view', async () => {
    const r = await post([
      { mutationId: 'b1', type: 'REPORT_BANK', payload: { institutionId: 'zenith', institutionName: 'Zenith Bank', institutionType: 'COMMERCIAL_BANK', channel: 'APP_TRANSFER', outcome: 'FAILED_REVERSED', stateCode: 'FC' }, createdAtIso: now },
      { mutationId: 'b2', type: 'REPORT_BANK', payload: { institutionId: 'zenith', institutionName: 'Zenith Bank', institutionType: 'COMMERCIAL_BANK', channel: 'APP_TRANSFER', outcome: 'INSTANT', stateCode: 'FC' }, createdAtIso: now }
    ]);
    ok(r.processedIds.length === 2, JSON.stringify(r));
    const b = await (await fetch(`${base}/api/v1/bootstrap?state=FC`)).json();
    const w = b.bankWeather.find((x: any) => x.institution_id === 'zenith' && x.channel === 'APP_TRANSFER');
    ok(w && Number(w.success_rate_pct) === 50 && Number(w.total_reports_60m) === 2, JSON.stringify(w));
  });

  await test('db: older app builds (Abuja/Lagos ids, city names) still sync', async () => {
    const r = await post([
      { mutationId: 'old1', type: 'PING_POWER', payload: { zoneId: 'lag-yaba-01', gridState: 'ON_GRID' }, createdAtIso: now },
      { mutationId: 'old2', type: 'REPORT_MARKET_RADAR', payload: { city: 'Abuja', category: 'PMS_FUEL', locationTitle: 'Conoil Gwarinpa', priceNgn: 1060, unitLabel: 'per Litre', queueSeverity: 'NO_QUEUE' }, createdAtIso: now }
    ]);
    ok(r.processedIds.length === 2, JSON.stringify(r));
    const z = await db.query("SELECT count(*)::int AS n FROM power_pings WHERE zone_id = 'la-yaba-01'");
    ok(z.rows[0].n === 1, 'lag- mapped to la-');
  });

  await test('end to end: the app reads the server data into its own format', async () => {
    const { OfflineSyncEngine } = await import('../src/services/offlineSyncEngine');
    const snap = await OfflineSyncEngine.pullLiveSnapshot('RI');
    ok(snap, 'snapshot received');
    const z = snap!.zones.find((x) => x.zoneId === 'ri-rumuola');
    ok(z && z.currentState === 'OFF_GRID' && z.stateCode === 'RI' && z.recentConfirmations === 1, JSON.stringify(z));
    const fc = await OfflineSyncEngine.pullLiveSnapshot('FC');
    const radar = fc!.marketRadar.find((m) => m.locationTitle === 'Conoil Gwarinpa');
    ok(radar && radar.priceNgn === 1060 && typeof radar.priceNgn === 'number' && radar.stateCode === 'FC', JSON.stringify(radar));
    const bank = fc!.bankWeather.find((b) => b.institutionId === 'zenith');
    ok(bank && bank.appTransferSuccessPct === 50, JSON.stringify(bank));
  });

  await test('db: sync is rate-limited per device', async () => {
    const limited = createApp({ db, chat: chatOptionsFromEnv({}), syncLimit: 2 }).listen(0);
    const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/api/v1/sync-outbox`;
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"mutations":[]}' })).status);
    limited.close();
    ok(codes.join() === '200,200,429', `codes ${codes}`);
  });

  server.close();
  await db.end();
}

if (failures.length) {
  console.log(`${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
console.log(`ALL ${passed} SERVER TESTS PASS${skipped ? ' (database tests skipped)' : ''}`);
