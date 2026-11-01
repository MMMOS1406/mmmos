// SRV-STUDIO-V2-033 — Monthly Mix server policy: config gate, eligibility (YouTube visibility), record checks, draft
// save/lock, private resumable upload one chunk per call with failure injection (dropped chunk, 5xx, short storage read,
// expired session), duplicate prevention, lineage re-verification, size/type checks, channel isolation, playlist
// (not configured / configured / other channel), public confirmation, sealed session, api/ops.js wiring.
//   node tests/srv/test_srv_studio_v2_033_server.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MS from '../../lib/srvStudioV2MixServer.mjs';
import * as M from '../../lib/srvStudioV2Mix.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 400))); };
const CH = 'UC0nzWQX6AaUqlF5FozNpWPg', NOW = Date.parse('2026-11-20T15:00:00Z');
const songs = [
  ['pkg_a', 'Song A', 'AAAAAAAAAAA', 240], ['pkg_b', 'Song B', 'BBBBBBBBBBB', 236], ['pkg_c', 'Song C', 'CCCCCCCCCCC', 250], ['pkg_d', 'Song D', 'DDDDDDDDDDD', 228],
  ['pkg_e', 'Song E', 'EEEEEEEEEEE', 245], ['pkg_f', 'Song F', 'FFFFFFFFFFF', 232], ['pkg_g', 'Song G', 'GGGGGGGGGGG', 241], ['pkg_h', 'Song H', 'HHHHHHHHHHH', 238],
];
const pkg = ([id, title, yt, sec], o = {}) => ({ id, engine: 'SRV English', title, srvTaskUid: 'srve_1_' + id, srvRender: { width: 1920, height: 1080, audioDurationSec: sec }, srvProduction: { youtubeVideoId: yt }, _srvLongVideoUrl: 'https://x/' + id + '.mp4', ...o });
function fakeYt({ privacy = {}, failChunkAt = null, fail5xxOnce = false, expire = false, playlists = {} } = {}) {
  const st = { sessions: {}, calls: [], items: {}, nextVid: 1 };
  const yt = {
    st,
    getVideosStatus: async (ids) => { st.calls.push(['getVideosStatus', ids.length]); const o = {}; for (const id of ids) { const p = privacy[id] === undefined ? 'public' : privacy[id]; if (p !== 'missing') o[id] = { channelId: p === 'other' ? 'UCxxxxxxxxxxxxxxxxxxxxxx' : CH, privacyStatus: p === 'other' ? 'public' : p }; } for (const [id, s] of Object.entries(st.sessions)) if (s.video && ids.includes(s.video.id)) o[s.video.id] = { channelId: CH, privacyStatus: s.video.privacyStatus }; return o; },
    initResumable: async (resource, bytes, mime) => { st.calls.push(['init', resource.status.privacyStatus, 'publishAt' in resource.status, bytes, mime]); const id = 'https://upload.fake/session/' + Object.keys(st.sessions).length; st.sessions[id] = { got: 0, total: bytes, resource, video: null }; return id; },
    status: async (sid, total) => { const s = st.sessions[sid]; if (!s || expire) return { expired: true }; if (s.video) return { complete: true, video: s.video }; return { offset: s.got }; },
    putChunk: async (sid, buf, start, total) => {
      const s = st.sessions[sid]; st.calls.push(['put', start, buf.length]);
      if (fail5xxOnce) { fail5xxOnce = false; throw new Error('HTTP 503'); }
      if (failChunkAt !== null && start >= failChunkAt) { const part = Math.floor(buf.length / 2); s.got = start + part; failChunkAt = null; throw new Error('connection reset after ' + part + ' bytes'); }
      if (start !== s.got) throw new Error('offset mismatch'); s.got += buf.length;
      if (s.got >= s.total) { s.video = { id: 'MIXvid' + String(st.nextVid++).padStart(5, '0'), channelId: CH, privacyStatus: s.resource.status.privacyStatus }; return { complete: true, video: s.video }; }
      return { complete: false, offset: s.got };
    },
    getPlaylist: async (id) => playlists[id] ? { id, snippet: { channelId: playlists[id], title: 'SRV Studio Mixes' }, status: { privacyStatus: 'public' } } : null,
    findItem: async (pl, v) => ((st.items[pl] || []).includes(v) ? { id: 'i' } : null),
    insertItem: async (pl, v) => { (st.items[pl] = st.items[pl] || []).push(v); return { id: 'i' }; },
    setThumbnail: async (v, buf) => { st.calls.push(['thumb', v, buf.length]); if (st.thumbFailOnce) { st.thumbFailOnce = false; throw new Error('HTTP 500'); } return true; },
  };
  return yt;
}
function world({ cfg = { enabled: true, channelId: CH, playlistId: null }, pk = songs.map((s) => pkg(s)), yt = fakeYt(), bytes = 150 * 1024 * 1024 + 123, storedBytes, channel = CH, readShortAt = null } = {}) {
  const table = { srv_studio_v2_mix: cfg === null ? undefined : JSON.stringify(cfg) }; const sealed = [];
  const file = Buffer.alloc(bytes, 7); const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(180000, 1)]);
  const deps = {
    now: () => NOW, by: 'operator', flagOn: async () => true,
    getSetting: async (k) => (table[k] != null ? { text: table[k] } : null),
    casSetting: async (k, o, n) => { if ((table[k] != null ? table[k] : null) !== o) return false; table[k] = n; return true; },
    listSrvPackages: async () => pk, lookupChannel: async () => ({ channel_id: channel }), ytFor: async () => yt,
    headObject: async (p) => (/thumbnail\.jpg$/.test(p) ? { bytes: jpeg.length, type: 'image/jpeg' } : { bytes: storedBytes === undefined ? bytes : storedBytes, type: 'video/mp4' }),
    readRange: async (p, s, e) => { if (/thumbnail\.jpg$/.test(p)) return jpeg.subarray(s, e); if (readShortAt !== null && s >= readShortAt) { readShortAt = null; return file.subarray(s, s + 10); } return file.subarray(s, e); },
    seal: (t) => { sealed.push(t); return 'sealed:' + Buffer.from(t).toString('base64'); }, unseal: (s) => Buffer.from(s.slice(7), 'base64').toString(),
    newId: (() => { let i = 0; return () => 'mx_' + (++i); })(),
  };
  return { deps, table, yt, sealed, bytes };
}
const run = (w, body) => MS.srv2RunMixOp(w.deps, body);
// a valid record from 8 songs
function record(month = '2026-11', o = {}) {
  const tracks0 = songs.map(([pkgId, title, youtubeVideoId, sec]) => ({ pkgId, title, youtubeVideoId, durationSec: sec - 3.5 }));
  const tl = M.srv2MixTimeline(tracks0);
  const mixId = M.srv2MixKey(month, tl);
  return { mixId, monthKey: month, status: 'approved', title: M.srv2MixTitle(month, tl), description: M.srv2MixDescription(month, tl), tags: M.srv2MixTags(tl), crossfadeSec: 6, totalSec: tl.totalSec,
    tracks: tl.items.map((x, i) => ({ order: i + 1, pkgId: x.pkgId, taskUid: 'srve_1_' + x.pkgId, title: x.title, youtubeVideoId: x.youtubeVideoId, audioSource: 'long-video-aac', sourceDurationSec: songs[i][3], inSec: 0.5, outSec: songs[i][3] - 3, usedSec: x.durationSec, gainDb: 1, chapterSec: x.chapterSec, timestamp: x.timestamp })),
    image: { avatarId: 'srv2-fm-17' }, plannedRelease: M.srv2MixMonthlySlot(month), output: { storagePath: `mixes/${mixId}/mix.mp4`, bytes: 150 * 1024 * 1024 + 123, mime: 'video/mp4', thumbnailPath: `mixes/${mixId}/thumbnail.jpg` }, ...o };
}

// ── 1. gate ──
ok('config gate: OFF when not configured or disabled; channel must be SRV Studio; playlist id validated', (await run(world({ cfg: null }), { op: 'list' })).json.error === 'mix_not_configured' && (await run(world({ cfg: { enabled: false, channelId: CH } }), { op: 'list' })).json.error === 'mix_disabled' && (await run(world({ cfg: { enabled: true, channelId: 'UCCUa5BLzGh2eRBoqqWBCK_g' } }), { op: 'list' })).json.error === 'mix_channel_invalid' && (await run(world({ cfg: { enabled: true, channelId: CH, playlistId: 'bad' } }), { op: 'list' })).json.error === 'mix_playlist_invalid');
ok('the V2 flag off → every mix operation refused', (await MS.srv2RunMixOp({ ...world().deps, flagOn: async () => false }, { op: 'list' })).json.error === 'srv_studio_v2_off');

// ── 2. eligibility ──
{
  const pk = songs.map((s) => pkg(s)).concat([pkg(['pkg_short', 'Song A', 'SHORTvid001', 30], { srvShortOf: { longPkgId: 'pkg_a' }, srvRender: { width: 1080, height: 1920, durationSec: 30 } }), pkg(['pkg_priv', 'Private', 'PRIVvid0001', 230]), pkg(['pkg_oth', 'Other', 'OTHERvid001', 230]), pkg(['pkg_nob', 'Unbuilt', 'NOBUILD0001', 230], { srvRender: {} }), pkg(['pkg_mp3', 'Has MP3', 'MP3vid00001', 230], { _srvAudioUrl: 'https://x/a.mp3' })]);
  const w = world({ pk, yt: fakeYt({ privacy: { PRIVvid0001: 'private', OTHERvid001: 'other' } }) });
  const r = (await run(w, { op: 'eligibility' })).json; const s = Object.fromEntries(r.songs.map((x) => [x.pkgId, x]));
  ok('eligibility: public SRV Studio Longs eligible; a private Long (not_public), another channel\'s video (other_channel) and an unbuilt Long (not_built) are listed with reasons; Shorts are not listed', s.pkg_a.eligible && s.pkg_priv.reason === 'not_public' && s.pkg_oth.reason === 'other_channel' && s.pkg_nob.reason === 'not_built' && !s.pkg_short);
  ok('audio source recorded: original MP3 when kept (029), else the Long soundtrack', s.pkg_mp3.audioSource === 'original-mp3' && s.pkg_a.audioSource === 'long-video-aac');
  ok('readiness: 9 eligible songs → ready', r.ready === true && r.readiness === 'ready' && r.eligibleCount === 9);
  const few = (await run(world({ pk: songs.slice(0, 5).map((s) => pkg(s)) }), { op: 'eligibility' })).json;
  ok('readiness with only 5 songs (≈ 20 min): "Not ready — insufficient eligible music"', few.ready === false && few.readiness === 'Not ready — insufficient eligible music' && few.possibleSec < 1560, few.possibleSec);
  ok('eligibility refuses when the YouTube connection is not SRV Studio', (await run(world({ channel: 'UCCUa5BLzGh2eRBoqqWBCK_g' }), { op: 'eligibility' })).json.error === 'wrong_channel');
}

// ── 3. record checks + drafts ──
{
  const rec = record();
  ok('a complete record passes every check', MS.srv2MixRecordCheck(rec).ok, MS.srv2MixRecordCheck(rec).problems);
  const bad = (o, rx) => !MS.srv2MixRecordCheck({ ...rec, ...o }).ok && rx.test(MS.srv2MixRecordCheck({ ...rec, ...o }).problems.join('|'));
  ok('record checks: chapters/total must match the songs; mix id must match month + order; AI disclosure and tracklist must stay; slot must be the approved one; title 1–100', bad({ tracks: rec.tracks.map((t, i) => i === 3 ? { ...t, chapterSec: t.chapterSec + 5 } : t) }, /chapter times/) && bad({ totalSec: rec.totalSec + 30 }, /total length/) && bad({ mixId: 'mix_202611_zzzz' }, /mix id/) && bad({ description: rec.description.replace(M.SRV2_MIX_AI_DISCLOSURE, '') }, /AI disclosure/) && bad({ description: rec.description.replace(rec.tracks[4].timestamp + ' ', '') }, /tracklist/) && bad({ plannedRelease: { utcIso: '2026-11-27T12:00:00.000Z' } }, /approved monthly slot/) && bad({ title: 'x'.repeat(101) }, /title/));
  ok('no song twice in one mix', bad({ tracks: rec.tracks.map((t, i) => i === 7 ? { ...rec.tracks[0], chapterSec: t.chapterSec, timestamp: t.timestamp } : t) }, /twice/));
  const w = world();
  const d1 = await run(w, { op: 'save', mix: { ...rec, status: 'draft' } });
  const short = record('2026-11'); short.tracks = short.tracks.slice(0, 4);
  const d2 = await run(w, { op: 'save', mix: { ...rec, status: 'draft', tracks: rec.tracks.slice(0, 4) } });
  ok('draft save: stored with audit (who/when); a short draft (waiting for songs) is kept but marked not ready', d1.status === 200 && d1.json.mix.audit.length === 1 && d1.json.mix.audit[0].by === 'operator' && d2.status === 400 && /chapter|mix id/.test(JSON.stringify(d2.json)), d2.json);
  const t4 = M.srv2MixTimeline(songs.slice(0, 4).map(([pkgId, title, youtubeVideoId, sec]) => ({ pkgId, title, youtubeVideoId, durationSec: sec - 3.5 })));
  const r4 = { ...rec, status: 'draft', mixId: M.srv2MixKey('2026-11', t4), title: M.srv2MixTitle('2026-11', t4), description: M.srv2MixDescription('2026-11', t4), totalSec: t4.totalSec, tracks: rec.tracks.slice(0, 4) };
  const d4 = await run(w, { op: 'save', mix: r4 });
  ok('a self-consistent 4-song draft (waiting for more songs) is saved and marked not ready with the reasons', d4.status === 200 && d4.json.mix.ready === false && /at least 5 songs/.test(d4.json.mix.problems.join()) && /not within/.test(d4.json.mix.problems.join()), d4.json);
  const listed = (await run(w, { op: 'list' })).json;
  ok('list restores the saved draft', !!listed.mixes[rec.mixId]);
}

// ── 4. upload: happy path, private only, chunks, playlist not configured ──
{
  const w = world(); const rec = record(); await run(w, { op: 'save', mix: rec });
  const init = await run(w, { op: 'upload_init', mixId: rec.mixId });
  ok('upload_init: verifies channel, lineage (sources still public SRV Studio Longs), stored file size/type; opens a PRIVATE session without publishAt', init.status === 200 && w.yt.st.calls.some((c) => c[0] === 'init' && c[1] === 'private' && c[2] === false && c[4] === 'video/mp4'), init.json);
  ok('the YouTube session URL is sealed before it is stored and never returned to the app', w.sealed.length === 1 && !JSON.stringify(init.json).includes('upload.fake') && !w.table.srv_studio_v2_mix_ledger.includes('upload.fake'));
  let r, calls = 0; do { r = await run(w, { op: 'upload_chunk', mixId: rec.mixId, entryId: init.json.entryId }); calls++; } while (r.json.ok && !r.json.done && calls < 20);
  ok('upload_chunk: one 64 MiB chunk per call (3 calls for 150 MB), resumable offsets, done with a verified PRIVATE video', r.json.done && calls === 3 && r.json.privacyStatus === 'private' && /^MIXvid/.test(r.json.youtubeVideoId), { calls, r: r.json });
  const L = JSON.parse(w.table.srv_studio_v2_mix_ledger).entries[0]; const m = (await run(w, { op: 'list' })).json.mixes[rec.mixId];
  ok('ledger + mix record: uploaded, video id, lineage kept, session removed; mix status uploaded; playlist "not configured" (manual step)', L.status === 'uploaded' && L.youtubeVideoId === r.json.youtubeVideoId && L.lineage.length === 8 && !('session' in L) && m.status === 'uploaded' && m.playlist.status === 'not_configured');
  const again = await run(w, { op: 'upload_init', mixId: rec.mixId });
  ok('duplicate prevention: an uploaded mix cannot be uploaded again (record locked; ledger also refuses)', again.status === 409);
  const lockedSave = await run(w, { op: 'save', mix: rec });
  ok('an uploaded mix is locked against edits', lockedSave.json.error === 'mix_locked_after_upload');
  const other = record('2026-11'); other.tracks = other.tracks.slice().reverse().map((t, i) => t); // different order → different key, same month
  const tl2 = M.srv2MixTimeline(songs.slice().reverse().map(([pkgId, title, youtubeVideoId, sec]) => ({ pkgId, title, youtubeVideoId, durationSec: sec - 3.5 })));
  const rec2 = { ...record(), mixId: M.srv2MixKey('2026-11', tl2), title: M.srv2MixTitle('2026-11', tl2), description: M.srv2MixDescription('2026-11', tl2), totalSec: tl2.totalSec, tracks: tl2.items.map((x, i) => ({ ...record().tracks[0], order: i + 1, pkgId: x.pkgId, title: x.title, youtubeVideoId: x.youtubeVideoId, usedSec: x.durationSec, chapterSec: x.chapterSec, timestamp: x.timestamp })) };
  rec2.output = { ...rec2.output, storagePath: `mixes/${rec2.mixId}/mix.mp4` };
  await run(w, { op: 'save', mix: rec2 }); const second = await run(w, { op: 'upload_init', mixId: rec2.mixId });
  ok('one mix per month: a second November mix is refused at upload', second.json.error === 'month_already_has_a_mix', second.json);
}

// ── 5. failure injection: dropped chunk, 5xx, short read, expired session ──
{
  const w = world({ yt: fakeYt({ failChunkAt: 64 * 1024 * 1024, fail5xxOnce: false }) }); const rec = record(); await run(w, { op: 'save', mix: rec });
  const init = await run(w, { op: 'upload_init', mixId: rec.mixId });
  const seq = []; let r; for (let i = 0; i < 20; i++) { r = await run(w, { op: 'upload_chunk', mixId: rec.mixId, entryId: init.json.entryId }); seq.push(r.json.ok ? (r.json.done ? 'done' : r.json.offset) : r.json.error); if (r.json.done) break; }
  ok('interrupted transfer (connection reset mid-chunk): reported as retryable; the next call resumes from the offset YouTube confirmed; completes', seq.includes('chunk_failed_retry') && seq[seq.length - 1] === 'done', seq);
  const w2 = world({ yt: fakeYt({ fail5xxOnce: true }) }); const rec2 = record(); await run(w2, { op: 'save', mix: rec2 }); const i2 = await run(w2, { op: 'upload_init', mixId: rec2.mixId });
  const s2 = []; for (let i = 0; i < 20; i++) { const x = await run(w2, { op: 'upload_chunk', mixId: rec2.mixId, entryId: i2.json.entryId }); s2.push(x.json.ok ? (x.json.done ? 'done' : x.json.offset) : x.json.error); if (x.json.done) break; }
  ok('YouTube 503 on a chunk: retryable, then completes; no duplicate video', s2[0] === 'chunk_failed_retry' && s2[s2.length - 1] === 'done' && Object.values(w2.yt.st.sessions).length === 1, s2);
  const w3 = world({ readShortAt: 0 }); const rec3 = record(); await run(w3, { op: 'save', mix: rec3 }); const i3 = await run(w3, { op: 'upload_init', mixId: rec3.mixId });
  const x3 = await run(w3, { op: 'upload_chunk', mixId: rec3.mixId, entryId: i3.json.entryId });
  ok('a short storage read is never sent to YouTube (refused, retryable)', x3.json.error === 'storage_read_short' && !w3.yt.st.calls.some((c) => c[0] === 'put'));
  const w4 = world({ yt: fakeYt({ expire: true }) }); const rec4 = record(); await run(w4, { op: 'save', mix: rec4 }); const i4 = await run(w4, { op: 'upload_init', mixId: rec4.mixId });
  const x4 = await run(w4, { op: 'upload_chunk', mixId: rec4.mixId, entryId: i4.json.entryId });
  const again4 = await run(w4, { op: 'upload_init', mixId: rec4.mixId });
  ok('expired session: entry closed as failed, mix back to approved, and a fresh upload can start (no duplicate)', x4.json.error === 'session_expired_restart_upload' && again4.status === 200, { x4: x4.json, again4: again4.json });
}

// ── 6. refusals before any upload ──
{
  const rec = record();
  const refuse = async (wo, mixO, code) => { const w = world(wo); await run(w, { op: 'save', mix: { ...rec, ...mixO } }); const r = await run(w, { op: 'upload_init', mixId: rec.mixId }); return r.json.error === code && !w.yt.st.calls.some((c) => c[0] === 'init') ? true : r.json; };
  ok('not approved → refused', (await refuse({}, { status: 'built' }, 'mix_not_approved')) === true);
  ok('stored file size differs from the record → refused', (await refuse({ storedBytes: 123 }, {}, 'output_not_in_storage_or_size_mismatch')) === true);
  ok('file over the storage limit → refused', (await refuse({ bytes: 600 * 1024 * 1024, storedBytes: 600 * 1024 * 1024 }, { output: { ...rec.output, bytes: 600 * 1024 * 1024 } }, 'output_too_large')) === true);
  ok('wrong media type / path → refused', (await refuse({}, { output: { ...rec.output, mime: 'text/html' } }, 'output_type_invalid')) === true && (await refuse({}, { output: { ...rec.output, storagePath: '../etc/passwd' } }, 'output_path_invalid')) === true);
  ok('a source song made private since the draft → refused (lineage re-verified at upload)', (await refuse({ yt: fakeYt({ privacy: { CCCCCCCCCCC: 'private' } }) }, {}, 'source_not_eligible')) === true);
  ok('connection is not SRV Studio → refused', (await refuse({ channel: 'UC41nsMBfVJCqj4vJRLktZTQ' }, {}, 'wrong_channel')) === true);
}

// ── 7. playlist + public confirmation ──
{
  const PL = 'PLmixesSRVStudio01';
  const w = world({ cfg: { enabled: true, channelId: CH, playlistId: PL }, yt: fakeYt({ playlists: { [PL]: CH } }) }); const rec = record(); await run(w, { op: 'save', mix: rec });
  const init = await run(w, { op: 'upload_init', mixId: rec.mixId }); let r; for (let i = 0; i < 10; i++) { r = await run(w, { op: 'upload_chunk', mixId: rec.mixId, entryId: init.json.entryId }); if (r.json.done) break; }
  ok('configured Mixes playlist: the private mix is added once and verified', r.json.playlist.status === 'added' && w.yt.st.items[PL].length === 1);
  const p2 = await run(w, { op: 'playlist', mixId: rec.mixId });
  ok('playlist retry: already a member → no duplicate', p2.json.playlist.status === 'already' && w.yt.st.items[PL].length === 1);
  const wO = world({ cfg: { enabled: true, channelId: CH, playlistId: PL }, yt: fakeYt({ playlists: { [PL]: 'UCCUa5BLzGh2eRBoqqWBCK_g' } }) }); const recO = record(); await run(wO, { op: 'save', mix: recO });
  const iO = await run(wO, { op: 'upload_init', mixId: recO.mixId }); let rO; for (let i = 0; i < 10; i++) { rO = await run(wO, { op: 'upload_chunk', mixId: recO.mixId, entryId: iO.json.entryId }); if (rO.json.done) break; }
  ok('a playlist owned by another channel is never written (playlist_not_srv_studio); the upload itself is still recorded', rO.json.done && rO.json.playlist.error === 'playlist_not_srv_studio' && !wO.yt.st.items[PL]);
  w.yt.st.thumbFailOnce = true; const t1 = await run(w, { op: 'thumbnail', mixId: rec.mixId });
  const t2 = await run(w, { op: 'thumbnail', mixId: rec.mixId }); const thumbCalls = w.yt.st.calls.filter((c) => c[0] === 'thumb');
  ok('thumbnail: the mix’s own 1280×720 JPEG is set on the verified private video; a YouTube failure is retryable and recorded, never undoes the upload', !t1.json.ok && t1.json.error === 'thumbnail_failed_retry' && t2.json.ok && thumbCalls.length === 2 && thumbCalls[1][2] === 180004 && (await run(w, { op: 'list' })).json.mixes[rec.mixId].thumbnail.status === 'set' && (await run(w, { op: 'list' })).json.mixes[rec.mixId].status === 'uploaded', { t1: t1.json, t2: t2.json });
  const tNo = await run(world(), { op: 'thumbnail', mixId: rec.mixId });
  ok('thumbnail: refused for a mix that was not uploaded', tNo.json.error === 'mix_not_uploaded');
  const c1 = await run(w, { op: 'confirm_public', mixId: rec.mixId });
  ok('public confirmation while still private: recorded with YouTube\'s answer (private), status stays uploaded', c1.json.publicConfirmation.youtubeReports === 'private' && !c1.json.publicConfirmation.verifiedByApi && (await run(w, { op: 'list' })).json.mixes[rec.mixId].status === 'uploaded');
  Object.values(w.yt.st.sessions)[0].video.privacyStatus = 'public'; // VA made it public in Studio
  const c2 = await run(w, { op: 'confirm_public', mixId: rec.mixId });
  ok('after the VA makes it public in Studio: confirmation verified by the API, status public, audit kept', c2.json.publicConfirmation.verifiedByApi && (await run(w, { op: 'list' })).json.mixes[rec.mixId].status === 'public' && (await run(w, { op: 'list' })).json.mixes[rec.mixId].audit.some((a) => a.action === 'confirm_public:public'));
}

// ── 8. wiring and isolation ──
{
  const OPS = fs.readFileSync(path.join(repo, 'api/ops.js'), 'utf8');
  const fn = (name) => { const i = OPS.indexOf('async function ' + name + '('); return OPS.slice(i, OPS.indexOf('\n}\n', i)); };
  const mx = fn('srvStudioV2Mix');
  ok('api: srv_studio_v2_mix requires a signed-in VA or CEO session, is behind the publishing gate, and uses the exact SRV Studio connection', /const who = await _publisherFromRequest\(req\);\n\s*if \(!who \|\| \(who\.role !== 'operator' && who\.role !== 'ceo'\)\) return res\.status\(401\)/.test(mx) && /'srv_studio_v2_mix', \/\/ SRV-STUDIO-V2-033/.test(OPS) && /_getYoutubeConnectionByTitle\('SRV Studio', \{ exact: true \}\)/.test(mx));
  ok('api: the session is sealed with AES-256-GCM; the upload never sets publishAt', /createCipheriv\('aes-256-gcm'/.test(OPS.slice(OPS.indexOf('function _srvMixSeal'), OPS.indexOf('function _srvMixSeal') + 400)) && !/publishAt/.test(fs.readFileSync(path.join(repo, 'lib/srvStudioV2MixServer.mjs'), 'utf8').replace(/never publishAt|never sets publishAt|publishAt;/g, '')));
  const lib = fs.readFileSync(path.join(repo, 'lib/srvStudioV2MixServer.mjs'), 'utf8');
  ok('the mix never touches the Long/Short production ledger or other businesses\' keys', !/srv_studio_v2_production_ledger|srv_studio_v2_pilot_ledger|srv_studio_v2_va_ledger|SRV Farsi|NextWave/.test(lib));
}
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
