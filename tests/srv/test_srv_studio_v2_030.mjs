// SRV-STUDIO-V2-030 — playlists (verified IDs, no duplicates, channel-checked), Related-video / end-screen eligibility,
// the playlist sync runner, the production after-upload hook, server wiring, and client/server constant parity.
//   node tests/srv/test_srv_studio_v2_030.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PL from '../../lib/srvStudioV2Playlists.mjs';
import * as P from '../../lib/srvStudioV2Pilot.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const CH = 'UC0nzWQX6AaUqlF5FozNpWPg', SB = 'https://tldcwvtwjypmwynsklsd.supabase.co', NOW = Date.UTC(2026, 9, 25, 12);
const LONG_PL = 'PLXCBPiF9p6SA', SHORT_PL = 'PLATi-bbiaU30';

// in-memory YouTube: playlists by id, membership sets, video privacy; scope flag; call log
function fakeYt({ scope = true, playlists, videos = {}, items = {} } = {}) {
  const calls = [];
  const pls = playlists || { [LONG_PL]: { channelId: CH, title: 'SRV Studio, the full Collection', privacy: 'public' }, [SHORT_PL]: { channelId: CH, title: 'SRV Studio Full Short Collection', privacy: 'public' } };
  const mem = Object.fromEntries(Object.keys(pls).map((k) => [k, new Set(items[k] || [])]));
  return {
    calls, mem,
    getPlaylist: async (id) => { calls.push(['getPlaylist', id]); const p = pls[id]; return p ? { id, snippet: { channelId: p.channelId, title: p.title }, status: { privacyStatus: p.privacy } } : null; },
    findItem: async (pl, v) => { calls.push(['findItem', pl, v]); return mem[pl] && mem[pl].has(v) ? { id: 'item_' + v } : null; },
    insertItem: async (pl, v) => { calls.push(['insertItem', pl, v]); if (!scope) { const e = new Error('HTTP 403 insufficientPermissions'); e.code = 'insufficient_scope'; throw e; } mem[pl].add(v); return { id: 'item_' + v }; },
    getVideo: async (id) => { calls.push(['getVideo', id]); const v = videos[id]; return v ? { id, snippet: { channelId: v.channelId || CH }, status: { privacyStatus: v.privacy } } : null; },
  };
}

// ── 1. verified IDs and parity with the client ──
{
  const H = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8');
  ok('playlist IDs: Long → PLXCBPiF9p6SA "SRV Studio, the full Collection", Short → PLATi-bbiaU30 "SRV Studio Full Short Collection"', PL.SRV2_PLAYLISTS.long.id === LONG_PL && PL.SRV2_PLAYLISTS.short.id === SHORT_PL && PL.SRV2_PLAYLISTS.long.title === 'SRV Studio, the full Collection' && PL.SRV2_PLAYLISTS.short.title === 'SRV Studio Full Short Collection');
  ok('the app shows exactly the same playlist IDs and titles as the server uses', H.includes("const SRV2_PLAYLISTS={long:{id:'PLXCBPiF9p6SA',title:'SRV Studio, the full Collection'},short:{id:'PLATi-bbiaU30',title:'SRV Studio Full Short Collection'}};"));
  ok('playlists are only addressed by ID: no playlist is looked up by title or created (playlists.insert / mine=true absent)', !/playlists\?part=snippet,status['"]?,\s*\{\s*method:\s*'POST'|mine=true|_ytGetOrCreatePlaylist/.test(fs.readFileSync(path.join(repo, 'lib/srvStudioV2Playlists.mjs'), 'utf8')));
}

// ── 2. srv2EnsurePlaylist ──
{
  let y = fakeYt();
  const a = await PL.srv2EnsurePlaylist(y, 'long', 'AAAAAAAAAAA', NOW);
  ok('Long: added to "SRV Studio, the full Collection" and verified by re-reading membership', a.status === 'added' && a.verified === true && a.playlistId === LONG_PL && y.mem[LONG_PL].has('AAAAAAAAAAA') && y.calls.filter((c) => c[0] === 'findItem').length === 2);
  const again = await PL.srv2EnsurePlaylist(y, 'long', 'AAAAAAAAAAA', NOW);
  ok('duplicate prevention: a video already in the playlist is not inserted again (status already, verified)', again.status === 'already' && y.calls.filter((c) => c[0] === 'insertItem').length === 1);
  y = fakeYt();
  const s = await PL.srv2EnsurePlaylist(y, 'short', 'BBBBBBBBBBB', NOW);
  ok('Short: added to "SRV Studio Full Short Collection" (never the Long playlist)', s.status === 'added' && s.playlistId === SHORT_PL && !y.mem[LONG_PL].has('BBBBBBBBBBB'));
  y = fakeYt({ scope: false });
  const nsc = await PL.srv2EnsurePlaylist(y, 'long', 'CCCCCCCCCCC', NOW);
  ok('without the playlist scope (today\'s SRV Studio token): reported as insufficient_scope, nothing thrown', nsc.status === 'failed' && nsc.error === 'insufficient_scope' && !y.mem[LONG_PL].has('CCCCCCCCCCC'));
  y = fakeYt({ playlists: { [LONG_PL]: { channelId: 'UCCUa5BLzGh2eRBoqqWBCK_g', title: 'x', privacy: 'public' }, [SHORT_PL]: { channelId: CH, title: 'y', privacy: 'public' } } });
  const foreign = await PL.srv2EnsurePlaylist(y, 'long', 'DDDDDDDDDDD', NOW);
  ok('channel isolation: a playlist owned by another channel (SRV Farsi id) is refused and never written', foreign.status === 'failed' && foreign.error === 'playlist_not_srv_studio' && !y.calls.some((c) => c[0] === 'insertItem'));
  y = fakeYt({ playlists: {} });
  const missing = await PL.srv2EnsurePlaylist(y, 'long', 'EEEEEEEEEEE', NOW);
  ok('a missing playlist is reported (playlist_not_found), nothing created', missing.error === 'playlist_not_found' && !y.calls.some((c) => c[0] === 'insertItem'));
  const bad = await PL.srv2EnsurePlaylist(fakeYt(), 'long', 'not a video', NOW);
  ok('an invalid video id is refused before any YouTube call', bad.error === 'bad_video_id');
  const unk = await PL.srv2EnsurePlaylist(fakeYt(), 'clip', 'FFFFFFFFFFF', NOW);
  ok('an unknown format has no playlist', unk.status === 'failed' && unk.error === 'unknown_kind');
}

// ── 3. Related-video and end-screen eligibility ──
{
  const y = fakeYt({ videos: { LONGPUBLIC1: { privacy: 'public' }, LONGUNLIST1: { privacy: 'unlisted' }, LONGPRIVAT1: { privacy: 'private' }, OTHERCHAN11: { privacy: 'public', channelId: 'UC41nsMBfVJCqj4vJRLktZTQ' } } });
  const r = await Promise.all(['LONGPUBLIC1', 'LONGUNLIST1', 'LONGPRIVAT1', 'OTHERCHAN11', 'MISSING1111'].map((v) => PL.srv2RelatedEligibility(y, v)));
  ok('Related video: a public or unlisted SRV Studio Long can be linked; private, other-channel or missing cannot', r[0].eligible && r[1].eligible && !r[2].eligible && r[2].reason === 'long_is_private' && !r[3].eligible && r[3].reason === 'long_not_srv_studio' && r[4].reason === 'long_not_found');
  ok('Related video: a Short without a Long video id is not eligible', (await PL.srv2RelatedEligibility(y, null)).reason === 'no_long_video_id');
  const es = await PL.srv2EndScreenEligibility(fakeYt());
  const esPriv = await PL.srv2EndScreenEligibility(fakeYt({ playlists: { [LONG_PL]: { channelId: CH, title: 't', privacy: 'private' }, [SHORT_PL]: { channelId: CH, title: 's', privacy: 'public' } } }));
  ok('End screen: the public "SRV Studio, the full Collection" playlist is eligible; a private one is not', es.eligible && es.playlistId === LONG_PL && !esPriv.eligible && esPriv.reason === 'playlist_is_private');
}

// ── 4. production upload hook ──
function world(settings = {}, o = {}) {
  const table = { ...settings }; const uploads = []; let n = 0; const hooks = [];
  const deps = {
    now: () => NOW, flagOn: async () => true, engineState: async () => 'test',
    getSetting: async (k) => (k in table ? { text: table[k] } : null),
    casSetting: async (k, oldT, newT) => { if ((k in table ? table[k] : null) !== oldT) return false; table[k] = newT; return true; },
    lookupChannel: async () => ({ channel_id: CH }),
    upload: async (b) => { uploads.push(b); return { status: 200, json: { ok: true, youtubeVideoId: 'ytVideo' + String(++n).padStart(4, '0'), channelId: CH, privacyStatus: 'private' } }; },
    newId: () => 'pr_' + (++n), by: 'operator',
    taskByUid: async () => ({ id: 1, engine: 'SRV English', isLong: true, contentType: 'Long', status: 'assigned' }),
    getPackage: async (id) => ({ id, engine: 'SRV English', srvTaskUid: 'srve_1792300000000_501' }),
    ...(o.hook === false ? {} : { afterUpload: async (a) => { hooks.push(a); if (o.hookThrows) throw new Error('boom'); return { status: o.hookStatus || 'added', playlistId: a.kind === 'short' ? SHORT_PL : LONG_PL, verified: true }; } }),
  };
  return { table, uploads, hooks, deps };
}
{
  const PROD = JSON.stringify({ enabled: true, format: 'long', formats: ['long', 'short'], dailyCap: 5, channelId: CH });
  const rq = { taskUid: 'srve_1792300000000_501', kind: 'long', pkgId: 'pkg_501', videoUrl: `${SB}/storage/v1/object/public/srv-assets/pkg_501/v.mp4`, title: 'Song - Emotional Deep House | Night Drive SRV Studio', description: 'x\nMusic, vocals and visuals in this video are AI-generated and edited by SRV Studio.', tags: [] };
  let w = world({ [P.SRV2_PROD_KEY]: PROD });
  const a = await P.srv2RunProductionUpload(w.deps, rq, { supabaseUrl: SB });
  const e = JSON.parse(w.table[P.SRV2_PROD_LEDGER_KEY]).entries[0];
  ok('production upload: after a verified upload the playlist step runs once with the format and the new video id', a.status === 200 && w.hooks.length === 1 && w.hooks[0].kind === 'long' && w.hooks[0].videoId === a.json.youtubeVideoId && w.hooks[0].conn.channel_id === CH);
  ok('the playlist result is returned to the app and recorded on the ledger entry', a.json.playlist && a.json.playlist.status === 'added' && e.playlist && e.playlist.playlistId === LONG_PL && e.status === 'uploaded');
  ok('the upload itself is unchanged: PRIVATE, publishAt null, AI disclosure', w.uploads[0].privacyStatus === 'private' && w.uploads[0].publishAt === null && w.uploads[0].containsSyntheticMedia === true);
  w = world({ [P.SRV2_PROD_KEY]: PROD }, { hookThrows: true });
  const b = await P.srv2RunProductionUpload(w.deps, rq, { supabaseUrl: SB });
  ok('a playlist failure never undoes or fails the upload (200, uploaded, playlist marked failed)', b.status === 200 && b.json.ok === true && b.json.playlist.status === 'failed' && JSON.parse(w.table[P.SRV2_PROD_LEDGER_KEY]).entries[0].status === 'uploaded');
  w = world({ [P.SRV2_PROD_KEY]: PROD }, { hookStatus: 'failed' });
  const dup1 = await P.srv2RunProductionUpload(w.deps, rq, { supabaseUrl: SB });
  const dup2 = await P.srv2RunProductionUpload(w.deps, rq, { supabaseUrl: SB });
  ok('duplicate-upload protection unchanged: the same task never uploads twice (and the playlist step does not run again)', dup1.status === 200 && dup2.json.error === 'task_already_uploaded_or_in_progress' && w.uploads.length === 1 && w.hooks.length === 1);
  // pilot / VA allowance never run the playlist step
  ok('only production runs the playlist step (pilot and VA-allowance specs have no after-upload)', P.SRV2_PROD_SPEC.afterUpload === true && !P.SRV2_PILOT_SPEC.afterUpload && !P.SRV2_VA_SPEC.afterUpload);
}

// ── 5. playlist sync runner (identity from the production ledger) ──
{
  const ledger = JSON.stringify({ rev: 3, entries: [
    { id: 'pr_l', taskUid: 'srve_1_150', kind: 'long', pkgId: 'pkg_1792604593962', status: 'uploaded', youtubeVideoId: 's34SXDqU0jk', title: 'Passenger Seat Witness - x' },
    { id: 'pr_s', taskUid: 'srve_1_152', kind: 'short', pkgId: 'pkg_1792875882770', status: 'uploaded', youtubeVideoId: '7LGUuXX1YnI', title: 'Passenger Seat Witness - x' },
    { id: 'pr_f', taskUid: 'srve_1_153', kind: 'long', pkgId: 'pkg_1792999999999', status: 'failed' },
  ] });
  const mk = (o = {}) => { const w = world({ srv_studio_v2_production_ledger: ledger }); const y = o.yt || fakeYt({ videos: { s34SXDqU0jk: { privacy: o.longPrivacy || 'public' } } });
    Object.assign(w.deps, { yt: async () => y, getPackage: async (id) => (id === 'pkg_1792875882770' ? { srvShortOf: { longYoutubeVideoId: 's34SXDqU0jk', longTitle: 'Passenger Seat Witness' } } : {}), ...(o.deps || {}) }); return { w, y }; };
  let { w, y } = mk();
  const r = await PL.srv2RunPlaylistSync(w.deps, { pkgId: 'pkg_1792875882770', kind: 'long', youtubeVideoId: 'HACKEDVIDEO' });
  const ent = JSON.parse(w.table.srv_studio_v2_production_ledger).entries;
  ok('sync: identity comes from the ledger — the request\'s kind / video id are ignored (Short 7LGUuXX1YnI → Short playlist)', r.status === 200 && r.json.kind === 'short' && r.json.youtubeVideoId === '7LGUuXX1YnI' && y.mem[SHORT_PL].has('7LGUuXX1YnI') && !y.mem[LONG_PL].has('HACKEDVIDEO'));
  ok('sync (Short): reports the Related-video eligibility of its Long (public → eligible)', r.json.related && r.json.related.eligible === true && r.json.related.longVideoId === 's34SXDqU0jk' && r.json.related.longTitle === 'Passenger Seat Witness' && r.json.endScreen === null);
  ok('sync records the playlist result on that ledger entry only; upload fields untouched; other entries untouched', ent[1].playlist && ent[1].playlist.status === 'added' && ent[1].youtubeVideoId === '7LGUuXX1YnI' && ent[1].status === 'uploaded' && !ent[0].playlist && !ent[2].playlist && JSON.parse(w.table.srv_studio_v2_production_ledger).rev === 4);
  ({ w, y } = mk());
  const L = await PL.srv2RunPlaylistSync(w.deps, { pkgId: 'pkg_1792604593962' });
  ok('sync (Long): Long playlist + end-screen eligibility of "SRV Studio, the full Collection"', L.json.kind === 'long' && L.json.playlist.playlistId === LONG_PL && L.json.endScreen.eligible === true && L.json.related === null);
  ({ w } = mk({ longPrivacy: 'private' }));
  const priv = await PL.srv2RunPlaylistSync(w.deps, { pkgId: 'pkg_1792875882770' });
  ok('sync (Short) with a private Long: not eligible for Related video (long_is_private)', priv.json.related.eligible === false && priv.json.related.reason === 'long_is_private');
  ({ w } = mk());
  const nf = await PL.srv2RunPlaylistSync(w.deps, { pkgId: 'pkg_1792999999999' });
  const badId = await PL.srv2RunPlaylistSync(w.deps, { pkgId: '../etc' });
  ok('sync refuses packages production did not upload (failed entry → 404) and malformed ids', nf.status === 404 && nf.json.error === 'not_uploaded_by_production' && badId.json.error === 'bad_package_id');
  ({ w } = mk({ deps: { lookupChannel: async () => ({ channel_id: 'UCCUa5BLzGh2eRBoqqWBCK_g' }) } }));
  const wc = await PL.srv2RunPlaylistSync(w.deps, { pkgId: 'pkg_1792604593962' });
  ok('sync refuses when the YouTube connection is not SRV Studio (channel isolation)', wc.status === 409 && wc.json.error === 'wrong_channel');
  ({ w } = mk({ deps: { flagOn: async () => false } }));
  ok('sync is off while SRV Studio V2 is off', (await PL.srv2RunPlaylistSync(w.deps, { pkgId: 'pkg_1792604593962' })).json.error === 'srv_studio_v2_off');
  ({ w, y } = mk({ yt: fakeYt({ scope: false, videos: { s34SXDqU0jk: { privacy: 'public' } } }) }));
  const nsc = await PL.srv2RunPlaylistSync(w.deps, { pkgId: 'pkg_1792604593962' });
  ok('sync without the playlist scope: 200 with playlist failed/insufficient_scope (the VA falls back to YouTube Studio)', nsc.status === 200 && nsc.json.playlist.error === 'insufficient_scope');
}

// ── 6. real adapter: endpoints and scope error mapping (mock fetch) ──
{
  const log = [];
  const f = async (url, init = {}) => { log.push([init.method || 'GET', url]); if (init.method === 'POST') return { ok: false, status: 403, text: async () => '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}' }; return { ok: true, json: async () => ({ items: [] }) }; };
  const a = PL.srv2YouTubeAdapter('tok', f);
  await a.getPlaylist(LONG_PL); await a.findItem(LONG_PL, 's34SXDqU0jk'); await a.getVideo('s34SXDqU0jk');
  let err = null; try { await a.insertItem(LONG_PL, 's34SXDqU0jk'); } catch (e) { err = e; }
  ok('adapter: read calls are playlists.list(id) / playlistItems.list(playlistId+videoId) / videos.list(id)', /playlists\?part=snippet,status&id=PLXCBPiF9p6SA$/.test(log[0][1]) && /playlistItems\?part=id&maxResults=5&playlistId=PLXCBPiF9p6SA&videoId=s34SXDqU0jk$/.test(log[1][1]) && /videos\?part=snippet,status&id=s34SXDqU0jk$/.test(log[2][1]));
  ok('adapter: the only write is playlistItems.insert; a 403 insufficientPermissions maps to insufficient_scope', log[3][0] === 'POST' && /playlistItems\?part=snippet$/.test(log[3][1]) && err && err.code === 'insufficient_scope' && log.filter((l) => l[0] !== 'GET').length === 1);
  const src = fs.readFileSync(path.join(repo, 'lib/srvStudioV2Playlists.mjs'), 'utf8');
  ok('no visibility or schedule change anywhere in the playlist module (no videos.update, privacyStatus or publishAt writes)', !/method:\s*'PUT'|privacyStatus:\s*'|publishAt/.test(src));
}

// ── 7. server wiring (api/ops.js) ──
{
  const OPS = fs.readFileSync(path.join(repo, 'api/ops.js'), 'utf8');
  const fnSrc = (name) => { const i = OPS.indexOf('async function ' + name + '('); return OPS.slice(i, OPS.indexOf('\n}\n', i)); };
  const ps = fnSrc('srvStudioV2PlaylistSync');
  ok('playlist sync requires a signed-in VA (operator) or CEO session', /const who = await _publisherFromRequest\(req\);\n\s*if \(!who \|\| \(who\.role !== 'operator' && who\.role !== 'ceo'\)\) return res\.status\(401\)/.test(ps));
  ok('playlist sync is behind the publishing gate and dispatched; uses the exact SRV Studio connection', /'srv_studio_v2_playlist_sync', \/\/ SRV-STUDIO-V2-030/.test(OPS) && /action === 'srv_studio_v2_playlist_sync'\) return await srvStudioV2PlaylistSync/.test(OPS) && /_getYoutubeConnectionByTitle\('SRV Studio', \{ exact: true \}\)/.test(ps));
  const pu = fnSrc('srvStudioV2ProductionUpload');
  ok('production upload adds the SRV Studio playlist step through srv2EnsurePlaylist (verified IDs), not the shared title-based helper', /afterUpload: async \(\{ kind, videoId, conn \}\) => srv2EnsurePlaylist\(srv2YouTubeAdapter\(/.test(pu) && !/playlistCategory|_ytGetOrCreatePlaylist/.test(pu));
  ok('shared YouTube upload and SRV Farsi playlist helpers are unchanged by this order (no SRV Studio reference added)', !/SRV2_PLAYLISTS|srvStudioV2Playlists/.test(fnSrc('youtubeUploadVideo')) && !/srv2/.test(fnSrc('_ytAddVideoToPlaylist')));
}

console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
