// SRV-STUDIO-V2-031 — approved release schedule recorded server-side in the production ledger (no duplicate slots,
// Short after its Long), still private with publishAt null; playlist sync reports visibility read-only.
//   node tests/srv/test_srv_studio_v2_031.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../../lib/srvStudioV2Pilot.mjs';
import * as S from '../../lib/srvStudioV2Schedule.mjs';
import * as PL from '../../lib/srvStudioV2Playlists.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const CH = 'UC0nzWQX6AaUqlF5FozNpWPg', SB = 'https://tldcwvtwjypmwynsklsd.supabase.co';
const NOW = Date.parse('2026-10-26T12:00:00Z'); // Monday

// ── 1. the approved slots ──
ok('approved slots: Long Friday 07:00, Short Sunday 18:00, America/New_York, status approved', S.SRV2_RELEASE_SLOTS.long.weekday === 5 && S.SRV2_RELEASE_SLOTS.long.hour === 7 && S.SRV2_RELEASE_SLOTS.short.weekday === 0 && S.SRV2_RELEASE_SLOTS.short.hour === 18 && S.SRV2_RELEASE_SLOTS.tz === 'America/New_York' && S.SRV2_RELEASE_SLOTS.status === 'approved');
const cases = [
  ['long', '2026-10-26T12:00:00Z', null, '2026-10-30T11:00:00.000Z', 'EDT'],
  ['long', '2026-10-31T00:00:00Z', null, '2026-11-06T12:00:00.000Z', 'EST'],
  ['short', '2026-10-26T12:00:00Z', null, '2026-11-01T23:00:00.000Z', 'EST'],
  ['short', '2026-10-26T12:00:00Z', '2026-11-06T12:00:00.000Z', '2026-11-08T23:00:00.000Z', 'EST'],
  ['long', '2027-03-08T12:00:00Z', null, '2027-03-12T12:00:00.000Z', 'EST'],
  ['long', '2027-03-13T12:00:00Z', null, '2027-03-19T11:00:00.000Z', 'EDT'],
  ['short', '2027-03-08T12:00:00Z', null, '2027-03-14T22:00:00.000Z', 'EDT'],
];
for (const [k, from, after, want, tzn] of cases) {
  const r = S.srv2PlanRelease(k, Date.parse(from), [], after ? Date.parse(after) : null);
  ok(`DST-aware slot: ${k} from ${from}${after ? ' after Long ' + after : ''} → ${want} (${tzn})`, r && r.utcIso === want && r.tzName === tzn && r.localTime === (k === 'long' ? '07:00' : '18:00'), r);
}

// ── 2. production runner records the plan in the ledger claim ──
function world() {
  const table = { [P.SRV2_PROD_KEY]: JSON.stringify({ enabled: true, format: 'long', formats: ['long', 'short'], dailyCap: 5, channelId: CH }) }; const uploads = []; let n = 0;
  const tasks = { srve_1792300000000_601: { engine: 'SRV English', isLong: true, contentType: 'Long', status: 'assigned' }, srve_1792300000000_602: { engine: 'SRV English', isLong: true, contentType: 'Long', status: 'assigned' }, srve_1792300000000_603: { engine: 'SRV English', isLong: false, contentFormat: 'short', srvPromo: true, status: 'assigned' }, srve_1792300000000_604: { engine: 'SRV English', isLong: false, contentFormat: 'short', srvPromo: true, status: 'assigned' } };
  const pk = (id, o = {}) => ({ id, engine: 'SRV English', title: 'Night Song', ...o });
  const pkgs = { pkg_601: pk('pkg_601', { srvTaskUid: 'srve_1792300000000_601', _srvLongVideoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_601/v.mp4` }), pkg_602: pk('pkg_602', { srvTaskUid: 'srve_1792300000000_602', _srvLongVideoUrl: 'x' }),
    pkg_603: pk('pkg_603', { srvTaskUid: 'srve_1792300000000_603', _srvShortVideoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_603/v.mp4`, srvShortOf: { longPkgId: 'pkg_602', startSec: 10, durationSec: 30 }, srvRender: { width: 1080, height: 1920, durationSec: 30 } }),
    pkg_604: pk('pkg_604', { srvTaskUid: 'srve_1792300000000_604', _srvShortVideoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_604/v.mp4`, srvShortOf: { longPkgId: 'pkg_601', startSec: 10, durationSec: 30 }, srvRender: { width: 1080, height: 1920, durationSec: 30 } }) };
  const deps = {
    now: () => NOW, flagOn: async () => true, engineState: async () => 'test',
    getSetting: async (k) => (k in table ? { text: table[k] } : null),
    casSetting: async (k, o, nw) => { if ((k in table ? table[k] : null) !== o) return false; table[k] = nw; return true; },
    lookupChannel: async () => ({ channel_id: CH }),
    upload: async (b) => { uploads.push(b); return { status: 200, json: { ok: true, youtubeVideoId: 'vid' + String(++n).padStart(8, '0'), channelId: CH, privacyStatus: 'private' } }; },
    newId: () => 'pr_' + (++n), by: 'operator', taskByUid: async (u) => tasks[u] || null, getPackage: async (id) => pkgs[id] || null,
  };
  return { table, uploads, deps };
}
const rq = (n, kind) => ({ taskUid: 'srve_1792300000000_' + n, kind, pkgId: 'pkg_' + n, videoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_${n}/v.mp4`, title: 'Night Song - Emotional Deep House | Night Drive SRV Studio', description: 'x\nMusic, vocals and visuals in this video are AI-generated and edited by SRV Studio.', tags: [] });
{
  const w = world();
  const a = await P.srv2RunProductionUpload(w.deps, rq(601, 'long'), { supabaseUrl: SB });
  const b = await P.srv2RunProductionUpload(w.deps, rq(602, 'long'), { supabaseUrl: SB });
  const c = await P.srv2RunProductionUpload(w.deps, rq(603, 'short'), { supabaseUrl: SB });
  const d = await P.srv2RunProductionUpload(w.deps, rq(604, 'short'), { supabaseUrl: SB });
  const e = JSON.parse(w.table[P.SRV2_PROD_LEDGER_KEY] || '{"entries":[]}').entries;
  ok('Long upload: planned release Friday 30 Oct 7:00 AM EDT recorded on the ledger entry and returned to the app', a.json.plannedRelease && a.json.plannedRelease.utcIso === '2026-10-30T11:00:00.000Z' && e[0].plannedRelease.utcIso === '2026-10-30T11:00:00.000Z' && e[0].plannedRelease.mode === 'manual-public', a.json.plannedRelease);
  ok('no duplicate slot: the second Long gets the next Friday (6 Nov 7:00 AM EST)', b.json.plannedRelease.utcIso === '2026-11-06T12:00:00.000Z');
  ok('the Short promotes its Long: the Short of the 6 Nov Long goes on Sunday 8 Nov 6:00 PM', c.json.plannedRelease.utcIso === '2026-11-08T23:00:00.000Z' && c.json.plannedRelease.afterLongRelease === '2026-11-06T12:00:00.000Z', c.json.plannedRelease);
  ok('the Short of the 30 Oct Long goes on Sunday 1 Nov 6:00 PM (the Sunday after its own Long, not after the other Short)', d.json.plannedRelease.utcIso === '2026-11-01T23:00:00.000Z', d.json.plannedRelease);
  ok('publication policy: every YouTube upload is PRIVATE with publishAt null; the plan is never sent to YouTube', w.uploads.length === 4 && w.uploads.every((u) => u.privacyStatus === 'private' && u.publishAt === null && !('plannedRelease' in u)));
  ok('pilot and VA-allowance specs have no planner (production only)', !P.SRV2_PILOT_SPEC.plan && !P.SRV2_VA_SPEC.plan && typeof P.SRV2_PROD_SPEC.plan === 'function');
}

// ── 3. sync reports visibility read-only ──
{
  const ledger = JSON.stringify({ rev: 1, entries: [{ id: 'pr_a', taskUid: 't', kind: 'long', pkgId: 'pkg_7001', status: 'uploaded', youtubeVideoId: 'aaaaaaaaaaa', plannedRelease: { utcIso: '2026-10-30T11:00:00.000Z' } }] });
  const table = { srv_studio_v2_production_ledger: ledger }; const calls = [];
  const yt = { getPlaylist: async (id) => ({ id, snippet: { channelId: CH, title: 't' }, status: { privacyStatus: 'public' } }), findItem: async () => ({ id: 'i' }), insertItem: async () => { calls.push('insert'); }, getVideo: async () => ({ snippet: { channelId: CH }, status: { privacyStatus: 'public' } }) };
  const r = await PL.srv2RunPlaylistSync({ now: () => NOW, flagOn: async () => true, getSetting: async (k) => ({ text: table[k] }), casSetting: async (k, o, n) => { table[k] = n; return true; }, getPackage: async () => ({}), lookupChannel: async () => ({ channel_id: CH }), yt: async () => yt }, { pkgId: 'pkg_7001' });
  ok('Check now reports YouTube\'s current visibility (read-only, verified) and the planned release from the ledger', r.json.visibility.privacyStatus === 'public' && r.json.visibility.verified === true && r.json.plannedRelease.utcIso === '2026-10-30T11:00:00.000Z' && calls.length === 0);
  const src = fs.readFileSync(path.join(repo, 'lib/srvStudioV2Playlists.mjs'), 'utf8') + fs.readFileSync(path.join(repo, 'lib/srvStudioV2Schedule.mjs'), 'utf8');
  ok('no code path sets visibility or publishAt (no videos.update / PUT / privacyStatus or publishAt writes)', !/method:\s*'PUT'|privacyStatus:\s*'(public|unlisted)'|publishAt\s*:/.test(src));
}

console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
