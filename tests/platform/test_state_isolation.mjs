// MMMOS platform — business-state isolation tests (validation D, E, F, G, H + enforcement/compat).
// Runs the REAL migrations against a local in-process Postgres 17 (PGlite). Never touches production.
// Synthetic records only. Run: node tests/platform/test_state_isolation.mjs  (needs @electric-sql/pglite)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = 'mmm_finance_v118';
let pass = 0, fail = 0; const out = [];
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };

async function fresh({ merge = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create table public.app_settings (key text primary key, value text, updated_at timestamptz default now());`);
  await db.exec(readFileSync(join(root, 'migrations/p0_shared_state_write_guard.sql'), 'utf8'));
  if (merge) await db.exec(readFileSync(join(root, 'migrations/platform_business_state_isolation.sql'), 'utf8'));
  return db;
}
const clone = o => JSON.parse(JSON.stringify(o));
const task = (engine, id, extra = {}) => ({ id, engine, name: `${engine} task ${id}`, status: 'assigned', ...extra });
// Synthetic multi-business company state (numeric task ids deliberately collide across engines).
function seed() {
  const tasks = [];
  for (let i = 1; i <= 6; i++) tasks.push(task('SRV Farsi', i));
  for (let i = 1; i <= 6; i++) tasks.push(task('NextWave', i));
  tasks.push(task('AI Studio', 1));
  return {
    tasks,
    engineState: { 'NextWave': 'test', 'AI Studio': 'paused' },
    srvFarsiLifecycleStages: { '1': 'generate', '2': 'review' },
    nextWaveLifecycleStages: { '1': 'build' },
    srvFarsiTaskSeq: 4, nextWaveTaskSeq: 7,
    availableCash: 1702, commandLog: [{ at: 't0', cmd: 'x' }],
  };
}
async function put(db, v) { await db.query(`insert into app_settings(key,value) values ($1,$2)
  on conflict (key) do update set value=excluded.value`, [KEY, JSON.stringify(v)]); }
async function get(db) { return JSON.parse((await db.query(`select value from app_settings where key=$1`, [KEY])).rows[0].value); }
async function save(db, base, next, key = KEY) {
  return (await db.query(`select mmm_state_save($1,$2::jsonb,$3::jsonb) as r`, [key, JSON.stringify(base), JSON.stringify(next)])).rows[0].r;
}
async function legacy(db, next) { // the current production write path: whole-row upsert
  await db.query(`insert into app_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value`, [KEY, JSON.stringify(next)]);
}
const find = (s, engine, id) => s.tasks.find(t => t.engine === engine && t.id === id);
async function rejects(p, re) { try { await p; return false; } catch (e) { return re.test(e.message); } }

// Control: prove the defect exists on the current (legacy) write path
{
  const db = await fresh({ merge: false }); const s0 = seed(); await put(db, s0);
  const srvTab = clone(s0), nwTab = clone(s0);
  find(nwTab, 'NextWave', 2).status = 'done'; nwTab.nextWaveTaskSeq = 8; await legacy(db, nwTab);
  find(srvTab, 'SRV Farsi', 1).status = 'generating'; await legacy(db, srvTab);
  const s = await get(db);
  ok('CONTROL legacy path: stale SRV save wipes NextWave change (the defect)', find(s, 'NextWave', 2).status === 'assigned' && s.nextWaveTaskSeq === 7);
}

// D. SRV state save cannot alter NextWave state (SRV tab is stale w.r.t. NextWave)
{
  const db = await fresh(); const s0 = seed(); await put(db, s0);
  const srvBase = clone(s0), srvTab = clone(s0), nwBase = clone(s0), nwTab = clone(s0);
  find(nwTab, 'NextWave', 2).status = 'done'; nwTab.nextWaveTaskSeq = 8; nwTab.tasks.push(task('NextWave', 7));
  nwTab.nextWaveLifecycleStages['2'] = 'review';
  await save(db, nwBase, nwTab);
  find(srvTab, 'SRV Farsi', 1).status = 'generating'; srvTab.srvFarsiLifecycleStages['1'] = 'review'; srvTab.srvFarsiTaskSeq = 5;
  await save(db, srvBase, srvTab);
  const s = await get(db);
  ok('D: SRV change applied', find(s, 'SRV Farsi', 1).status === 'generating' && s.srvFarsiLifecycleStages['1'] === 'review' && s.srvFarsiTaskSeq === 5);
  ok('D: NextWave task edit preserved', find(s, 'NextWave', 2).status === 'done');
  ok('D: NextWave new task preserved', !!find(s, 'NextWave', 7));
  ok('D: NextWave counter + lifecycle preserved', s.nextWaveTaskSeq === 8 && s.nextWaveLifecycleStages['2'] === 'review');
  ok('D: no task lost or duplicated', s.tasks.length === 14, `tasks=${s.tasks.length}`);
}

// E. NextWave state save cannot alter SRV state (reverse order)
{
  const db = await fresh(); const s0 = seed(); await put(db, s0);
  const srvTab = clone(s0), nwTab = clone(s0);
  find(srvTab, 'SRV Farsi', 3).status = 'done'; srvTab.srvFarsiLifecycleStages['3'] = 'done';
  srvTab.tasks = srvTab.tasks.filter(t => !(t.engine === 'SRV Farsi' && t.id === 6)); // SRV deletes its own task 6
  await save(db, s0, srvTab);
  find(nwTab, 'NextWave', 1).status = 'generating'; await save(db, s0, nwTab);
  const s = await get(db);
  ok('E: NextWave change applied', find(s, 'NextWave', 1).status === 'generating');
  ok('E: SRV edit + lifecycle preserved', find(s, 'SRV Farsi', 3).status === 'done' && s.srvFarsiLifecycleStages['3'] === 'done');
  ok('E: SRV deletion of its own task preserved (not resurrected by stale NextWave tab)', !find(s, 'SRV Farsi', 6));
  ok('E: colliding numeric ids isolated by engine (SRV 1 vs NextWave 1)', find(s, 'SRV Farsi', 1).status === 'assigned' && find(s, 'NextWave', 1).status === 'generating');
}

// F. Empty/default browser state cannot wipe shared production state
{
  const db = await fresh(); const s0 = seed(); await put(db, s0);
  const defaults = { tasks: [], engineState: {}, srvFarsiLifecycleStages: {}, srvFarsiTaskSeq: 0, availableCash: 0, commandLog: [] };
  await save(db, {}, defaults); // fresh tab: loaded nothing (base {}), sends defaults
  let s = await get(db);
  ok('F: default tab via merge path cannot delete any task', s.tasks.length === 13, `tasks=${s.tasks.length}`);
  ok('F: default tab via merge path cannot reset engine states / stages', s.engineState.NextWave === 'test' && s.srvFarsiLifecycleStages['2'] === 'review');
  ok('F: legacy whole-row wipe still blocked by shrink guard', await rejects(legacy(db, defaults), /MMM_STATE_GUARD/));
  ok('F: merge path wiping everything a tab really loaded is blocked by shrink guard', await rejects(save(db, s, defaults), /MMM_STATE_GUARD/));
  ok('F: row delete blocked', await rejects(db.query(`delete from app_settings where key=$1`, [KEY]), /MMM_STATE_GUARD/));
  ok('F: merge refuses to save without a base', await rejects(save(db, null, s), /base required/));
}

// G. Test-mode activity stays within its business
{
  const db = await fresh(); const s0 = seed(); await put(db, s0);
  const srvTab = clone(s0), nwTab = clone(s0);
  srvTab.engineState['SRV Farsi'] = 'test'; srvTab.tasks.push(task('SRV Farsi', 99, { isTest: true, name: 'SRV test' }));
  await save(db, s0, srvTab);
  nwTab.engineState.NextWave = 'running'; await save(db, s0, nwTab); // NextWave leaves test; its tab never saw SRV go to test
  const s = await get(db);
  ok('G: SRV test mode not reverted by NextWave save', s.engineState['SRV Farsi'] === 'test');
  ok('G: NextWave state change applied only to NextWave', s.engineState.NextWave === 'running' && s.engineState['AI Studio'] === 'paused');
  ok('G: SRV test task stays SRV-only', find(s, 'SRV Farsi', 99)?.isTest === true && !s.tasks.some(t => t.engine !== 'SRV Farsi' && t.isTest));
}

// H. A new future engine can be added without sharing mutable business state
{
  const db = await fresh(); const s0 = seed(); await put(db, s0);
  const futTab = clone(s0), srvTab = clone(s0);
  futTab.tasks.push(task('Future Engine', 1)); futTab.engineState['Future Engine'] = 'running';
  futTab.futureEngineLifecycleStages = { '1': 'generate' }; futTab.futureEngineTaskSeq = 1;
  await save(db, s0, futTab);
  find(srvTab, 'SRV Farsi', 2).status = 'generating'; await save(db, s0, srvTab); // older client, unaware of Future Engine keys
  const s = await get(db);
  ok('H: future engine task/state/new keys survive saves from clients that never knew them',
    !!find(s, 'Future Engine', 1) && s.engineState['Future Engine'] === 'running' && s.futureEngineLifecycleStages?.['1'] === 'generate' && s.futureEngineTaskSeq === 1);
  ok('H: merge function has no engine names (business-agnostic)', !/SRV|NextWave|Studio|Farsi/i.test(readFileSync(join(root, 'migrations/platform_business_state_isolation.sql'), 'utf8').split('create or replace function public.mmm_json_merge3')[1].split('$$;')[0]));
}

// Enforcement + compatibility
{
  const db = await fresh(); const s0 = seed(); await put(db, s0);
  const t1 = clone(s0); find(t1, 'SRV Farsi', 4).status = 'x';
  await legacy(db, t1);
  ok('COMPAT: flag off -> legacy clients keep working during rollout', find(await get(db), 'SRV Farsi', 4).status === 'x');
  await db.exec(`update mmm_platform_flags set enabled = true where flag = 'state_merge_only'`);
  ok('ENFORCE: flag on -> legacy whole-row write rejected', await rejects(legacy(db, s0), /MMM_STATE_ISOLATION/));
  const cur = await get(db); const t2 = clone(cur); find(t2, 'NextWave', 3).status = 'y'; await save(db, cur, t2);
  ok('ENFORCE: flag on -> merge path still writes', find(await get(db), 'NextWave', 3).status === 'y');
  ok('SCOPE: merge RPC refuses non-managed keys (e.g. CEO login security)', await rejects(save(db, {}, { a: 1 }, 'ceo_login_security_production'), /not merge-managed/));
  const db2 = await fresh(); await save(db2, null, seed());
  ok('FIRST RUN: merge RPC creates the row when absent', (await get(db2)).tasks.length === 13);
  // same-business concurrent edit of the same field: last writer wins for that field only
  const db3 = await fresh(); await put(db3, s0); const a = clone(s0), b = clone(s0);
  find(a, 'SRV Farsi', 5).status = 'A'; find(a, 'SRV Farsi', 5).note = 'from A'; await save(db3, s0, a);
  find(b, 'SRV Farsi', 5).status = 'B'; await save(db3, s0, b);
  const s3 = find(await get(db3), 'SRV Farsi', 5);
  ok('SAME-BUSINESS conflict: field-level last-writer-wins, other fields kept', s3.status === 'B' && s3.note === 'from A');
}

console.log(out.join('\n')); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
