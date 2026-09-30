// MMMOS platform — end-to-end: the REAL client load/save code (extracted from public/index.html) running as
// two independent browser tabs against a REAL local Postgres 17 (PGlite) with the real migrations applied.
// A tiny fetch shim maps the three Supabase REST calls the client makes onto SQL. Never touches production.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const h = readFileSync(join(root, 'public/index.html'), 'utf8');
const s = h.indexOf('let _sbFinanceVerified=false;');
const e = h.indexOf('\n}\n', h.indexOf('function _reportFinanceSaveFailure')) + 3;
const ls = h.indexOf('async function loadAppState(){');
const le = h.indexOf('// 2. Load packages from Supabase', ls);
const clientSrc = h.slice(s, e) + '\n' + h.slice(ls, le) + '\n return financeLoaded; }';
const KEY = 'mmm_finance_v118';
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x = '') => { c ? pass++ : fail++; out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

async function db({ merge = true } = {}) {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated;
    create table public.app_settings (key text primary key, value text, updated_at timestamptz default now());`);
  await d.exec(readFileSync(join(root, 'migrations/p0_shared_state_write_guard.sql'), 'utf8'));
  if (merge) await d.exec(readFileSync(join(root, 'migrations/platform_business_state_isolation.sql'), 'utf8'));
  return d;
}
// PostgREST-shaped shim for the calls the client makes
function fetchFor(pg) {
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  return async (url, opts = {}) => {
    try {
      if (url.includes('/rest/v1/rpc/mmm_state_save')) {
        const b = JSON.parse(opts.body);
        const fn = await pg.query(`select 1 from pg_proc where proname='mmm_state_save'`);
        if (!fn.rows.length) return resp(404, { code: 'PGRST202', message: 'Could not find the function public.mmm_state_save' });
        const r = await pg.query(`select mmm_state_save($1,$2::jsonb,$3::jsonb) r`, [b.p_key, JSON.stringify(b.p_base), JSON.stringify(b.p_new)]);
        return resp(200, r.rows[0].r);
      }
      if (url.includes('/rest/v1/app_settings?key=eq.')) {
        const r = await pg.query(`select value from app_settings where key=$1`, [KEY]);
        return resp(200, r.rows);
      }
      if (url.endsWith('/rest/v1/app_settings') && opts.method === 'POST') {
        const b = JSON.parse(opts.body);
        await pg.query(`insert into app_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value`, [b.key, b.value]);
        return resp(201, {});
      }
      return resp(500, { message: 'unmapped ' + url });
    } catch (err) { return resp(400, { code: 'P0001', message: err.message }); }
  };
}
// One browser tab = its own D + its own copy of the real client functions
function tab(pg) {
  const t = { D: {} };
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'anon', SB_FINANCE_KEY: KEY, D: t.D,
    fetch: fetchFor(pg), AbortSignal: { timeout: () => undefined }, console: { log() {}, error() {} },
    applyFinanceState: p => { Object.keys(t.D).forEach(k => delete t.D[k]); Object.assign(t.D, p); } };
  const api = new Function(...Object.keys(env), clientSrc + '\nreturn {load:loadAppState, save:_persistFinancePayloadToSupabase};')(...Object.values(env));
  t.load = api.load;
  t.save = () => api.save(JSON.parse(JSON.stringify(t.D))); // saveAppState builds its payload from D the same way
  return t;
}
const task = (engine, id, x = {}) => ({ id, engine, name: `${engine} ${id}`, status: 'assigned', ...x });
function seed() {
  const tasks = [];
  for (let i = 1; i <= 6; i++) tasks.push(task('SRV Farsi', i), task('NextWave', i));
  return { tasks, engineState: { NextWave: 'test' }, srvFarsiTaskSeq: 4, nextWaveTaskSeq: 7, availableCash: 1702 };
}
const read = async pg => JSON.parse((await pg.query(`select value from app_settings where key=$1`, [KEY])).rows[0].value);
const find = (st, en, id) => st.tasks.find(x => x.engine === en && x.id === id);

// D + E through the real client: two stale tabs, each changing only its own business, alternating saves
{
  const pg = await db(); await pg.query(`insert into app_settings values ($1,$2)`, [KEY, JSON.stringify(seed())]);
  const srv = tab(pg), nw = tab(pg); await srv.load(); await nw.load();
  find(nw.D, 'NextWave', 2).status = 'done'; nw.D.nextWaveTaskSeq = 8; nw.D.tasks.push(task('NextWave', 7));
  ok('E2E NextWave tab save ok', await nw.save());
  find(srv.D, 'SRV Farsi', 1).status = 'generating'; srv.D.srvFarsiTaskSeq = 5; srv.D.engineState['SRV Farsi'] = 'test';
  ok('E2E SRV tab (stale) save ok', await srv.save());
  find(nw.D, 'NextWave', 3).status = 'done'; ok('E2E NextWave tab (now stale) saves again', await nw.save());
  const st = await read(pg);
  ok('D (client e2e): SRV save did not alter NextWave', find(st, 'NextWave', 2).status === 'done' && !!find(st, 'NextWave', 7) && st.nextWaveTaskSeq === 8);
  ok('E (client e2e): NextWave save did not alter SRV', find(st, 'SRV Farsi', 1).status === 'generating' && st.srvFarsiTaskSeq === 5 && st.engineState['SRV Farsi'] === 'test');
  ok('E2E: NextWave second change applied', find(st, 'NextWave', 3).status === 'done');
  ok('E2E: no tasks lost', st.tasks.length === 13, `tasks=${st.tasks.length}`);
}
// F through the real client: a tab whose load failed cannot save anything
{
  const pg = await db(); await pg.query(`insert into app_settings values ($1,$2)`, [KEY, JSON.stringify(seed())]);
  const t = tab(pg); t.D.tasks = []; // never loaded (e.g. load timed out)
  ok('F (client e2e): unloaded tab save refused', (await t.save()) === false);
  ok('F (client e2e): shared state untouched', (await read(pg)).tasks.length === 12);
}
// Compatibility: database without the merge migration → client falls back to the previous write path
{
  const pg = await db({ merge: false }); await pg.query(`insert into app_settings values ($1,$2)`, [KEY, JSON.stringify(seed())]);
  const t = tab(pg); await t.load(); find(t.D, 'SRV Farsi', 2).status = 'x';
  ok('COMPAT (client e2e): falls back to legacy write when merge RPC absent', (await t.save()) && find(await read(pg), 'SRV Farsi', 2).status === 'x');
}
// Enforcement on: legacy clients rejected, new client unaffected
{
  const pg = await db(); await pg.query(`insert into app_settings values ($1,$2)`, [KEY, JSON.stringify(seed())]);
  await pg.exec(`update mmm_platform_flags set enabled=true where flag='state_merge_only'`);
  const t = tab(pg); await t.load(); find(t.D, 'NextWave', 4).status = 'y';
  ok('ENFORCE (client e2e): merge client still saves with enforcement on', (await t.save()) && find(await read(pg), 'NextWave', 4).status === 'y');
}
console.log(out.join('\n')); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
