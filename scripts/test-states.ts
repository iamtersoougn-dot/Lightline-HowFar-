const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k)
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });

const { NIGERIAN_STATES } = await import('../src/data/nigeriaStates');
const { OfflineSyncEngine } = await import('../src/services/offlineSyncEngine');

let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log('FAIL', msg); } };

check(NIGERIAN_STATES.length === 37, `37 entries, got ${NIGERIAN_STATES.length}`);
check(new Set(NIGERIAN_STATES.map((s) => s.code)).size === 37, 'unique codes');
const zones = OfflineSyncEngine.getZones();
for (const st of NIGERIAN_STATES) check(zones.some((z) => z.stateCode === st.code), `${st.name} has an area`);
check(zones.filter((z) => z.currentState === 'UNKNOWN').every((z) => z.recentConfirmations === 0), 'unreported areas claim nothing');

store.set('howfar_v1_selected_city', JSON.stringify('Lagos'));
check(OfflineSyncEngine.getSelectedState() === 'LA', 'legacy Lagos -> LA');

const a = OfflineSyncEngine.addArea('RI', 'Rumuola', '', null);
const b = OfflineSyncEngine.addArea('RI', '  rumuola ', '', null);
check(a.zoneId === b.zoneId, 'same area name -> same id');
check(b.zones.filter((z) => z.zoneId === a.zoneId).length === 1, 'no duplicate area');
check(b.zones.find((z) => z.zoneId === a.zoneId)!.discoName === 'PHED', 'default DisCo from state');

OfflineSyncEngine.recordPowerPing(a.zoneId, 'ON_GRID');
const ping = OfflineSyncEngine.getOutbox().at(-1)!;
check(ping.payload.stateCode === 'RI' && ping.payload.neighborhood === 'Rumuola', 'ping carries area info for the server');

console.log(fails ? `${fails} FAILED` : `ALL STATE CHECKS PASS (${zones.length} areas across 37 states)`);
process.exit(fails ? 1 : 0);
