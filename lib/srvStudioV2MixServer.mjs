// SRV-STUDIO-V2-033 — Monthly Mix server policy (pure; api/ops.js supplies the real dependencies, tests supply mocks).
// One action, srv_studio_v2_mix, with operations:
//   list · eligibility · save · upload_init · upload_chunk · playlist · confirm_public
// Data (app_settings, write-locked to the server by M1):
//   srv_studio_v2_mix         config  {enabled, channelId, playlistId|null, maxBytes}
//   srv_studio_v2_mixes       records {rev, mixes:{[mixId]: record}}
//   srv_studio_v2_mix_ledger  uploads {rev, entries:[…]}   (separate from the Long/Short ledgers)
// Uploads: private only, never publishAt, verified channel, lineage re-verified (every source a PUBLIC SRV Studio Long),
// size/type checked against the stored object, one upload per mix/month, and a resumable YouTube session driven ONE
// CHUNK PER CALL so it fits short server windows and resumes after interruptions (offset re-read from YouTube).
import { srv2MixRecordCheck, srv2MixUploadDecide, SRV2_MIX_CONFIG, srv2Clock } from './srvStudioV2Mix.mjs';
import { srv2ParseLedger } from './srvStudioV2Pilot.mjs';
import { srv2EnsurePlaylistId } from './srvStudioV2Playlists.mjs';

export const SRV2_MIX_KEYS = Object.freeze({ config: 'srv_studio_v2_mix', mixes: 'srv_studio_v2_mixes', ledger: 'srv_studio_v2_mix_ledger' });
export const SRV2_MIX_CHUNK_BYTES = 64 * 1024 * 1024; // multiple of 256 KiB (YouTube resumable rule)
const CH = 'UC0nzWQX6AaUqlF5FozNpWPg';
const VID = /^[A-Za-z0-9_-]{11}$/;
const MIXID = /^mix_\d{6}_[a-z0-9]+$/;

export function srv2ParseMixConfig(raw) {
  if (raw == null || raw === '') return { error: 'mix_not_configured' };
  let c; try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { error: 'mix_config_unreadable' }; }
  if (!c || c.enabled !== true) return { error: 'mix_disabled' };
  if (c.channelId !== CH) return { error: 'mix_channel_invalid' };
  if (c.playlistId != null && !/^PL[A-Za-z0-9_-]{10,40}$/.test(String(c.playlistId))) return { error: 'mix_playlist_invalid' };
  const maxBytes = Number.isInteger(c.maxBytes) ? Math.min(c.maxBytes, SRV2_MIX_CONFIG.maxFileBytes) : SRV2_MIX_CONFIG.maxFileBytes;
  return { config: { enabled: true, channelId: CH, playlistId: c.playlistId || null, maxBytes } };
}
const parseDoc = (row, empty) => { if (!row || !row.text) return empty; try { const d = JSON.parse(row.text); return d && typeof d === 'object' ? d : null; } catch (_) { return null; } };

// srv2MixRecordCheck lives in srvStudioV2Mix.mjs (shared with the app) — re-exported here.
export { srv2MixRecordCheck } from './srvStudioV2Mix.mjs';

// ── eligibility (authoritative: YouTube is asked whether each source is public) ──
export async function srv2MixEligibility(deps) {
  const pk = await deps.listSrvPackages(); // full SRV English packages from the database
  const cands = [];
  for (const p of pk || []) {
    if (!p || p.engine !== 'SRV English') continue;
    const yt = (p.srvProduction && p.srvProduction.youtubeVideoId) || (p.srvVa && p.srvVa.youtubeVideoId) || (p.srvPilot && p.srvPilot.youtubeVideoId) || p._srvYtLongId || null;
    const r = p.srvRender || {};
    const isShort = !!p.srvShortOf || (r.width === 1080 && r.height === 1920) || p.contentFormat === 'short';
    const reason = isShort ? 'short' : !(r.width === 1920 && r.height === 1080) ? 'not_built' : !VID.test(String(yt || '')) ? 'not_uploaded' : !(p._srvAudioUrl || p._srvLongVideoUrl) ? 'no_audio_source' : !(Number(r.audioDurationSec || r.durationSec) > 30) ? 'unknown_duration' : null;
    if (isShort) continue; // Shorts are never listed
    cands.push({ pkgId: String(p.id), taskUid: p.srvTaskUid || null, title: String(p.title || '').trim(), youtubeVideoId: yt, durationSec: Number(r.audioDurationSec || r.durationSec || 0), audioSource: p._srvAudioUrl ? 'original-mp3' : 'long-video-aac', sourceUrl: p._srvAudioUrl || p._srvLongVideoUrl || null, thumbUrl: p._srvThumbUrl || null, avatarId: (p.srvAvatar && p.srvAvatar.id) || null, generatedAt: p.generatedAt || null, reason });
  }
  const ids = cands.filter((c) => !c.reason).map((c) => c.youtubeVideoId);
  const vis = ids.length ? await deps.yt.getVideosStatus(ids) : {}; // { id: { channelId, privacyStatus } }
  for (const c of cands) {
    if (c.reason) continue;
    const v = vis[c.youtubeVideoId];
    c.privacyStatus = v ? v.privacyStatus : null;
    if (!v) c.reason = 'not_found_on_youtube';
    else if (v.channelId !== CH) c.reason = 'other_channel';
    else if (v.privacyStatus !== 'public') c.reason = 'not_public';
  }
  for (const c of cands) c.eligible = !c.reason;
  const el = cands.filter((c) => c.eligible);
  const best = el.map((c) => c.durationSec).sort((a, b) => b - a).slice(0, SRV2_MIX_CONFIG.maxTracks);
  const possibleSec = best.reduce((a, b) => a + b, 0) - Math.max(0, best.length - 1) * SRV2_MIX_CONFIG.crossfadeSec;
  const ready = el.length >= SRV2_MIX_CONFIG.minTracks && possibleSec >= SRV2_MIX_CONFIG.targetSec - SRV2_MIX_CONFIG.toleranceSec;
  return { songs: cands, eligibleCount: el.length, possibleSec: Math.max(0, +possibleSec.toFixed(1)), ready, readiness: ready ? 'ready' : 'Not ready — insufficient eligible music', checkedAt: new Date(deps.now()).toISOString() };
}

// ── runner ──
export async function srv2RunMixOp(deps, body) {
  const fail = (status, error, extra) => ({ status, json: { ok: false, mix: true, error, ...(extra || {}) } });
  if (!(await deps.flagOn())) return fail(403, 'srv_studio_v2_off');
  const { config, error } = srv2ParseMixConfig((await deps.getSetting(SRV2_MIX_KEYS.config) || {}).text);
  if (!config) return fail(403, error);
  const op = String((body && body.op) || '');
  const now = () => new Date(deps.now()).toISOString();
  const by = deps.by || null;
  const loadMixes = async () => { const row = await deps.getSetting(SRV2_MIX_KEYS.mixes); const d = parseDoc(row, { rev: 0, mixes: {} }); return { row, d }; };
  const saveMixes = async (mutate) => {
    for (let a = 0; a < 8; a++) {
      const { row, d } = await loadMixes(); if (!d || typeof d.mixes !== 'object') return { error: 'mixes_unreadable' };
      const res = mutate(d.mixes); if (res && res.error) return res;
      if (await deps.casSetting(SRV2_MIX_KEYS.mixes, row ? row.text : null, JSON.stringify({ rev: (d.rev || 0) + 1, mixes: d.mixes }))) return res || { ok: true };
    }
    return { error: 'mixes_busy_try_again' };
  };
  const ledgerOp = async (mutate) => {
    for (let a = 0; a < 8; a++) {
      const row = await deps.getSetting(SRV2_MIX_KEYS.ledger); const l = srv2ParseLedger(row && row.text); if (!l) return { error: 'mix_ledger_unreadable' };
      const res = mutate(l.entries); if (res && res.error) return res;
      if (await deps.casSetting(SRV2_MIX_KEYS.ledger, row ? row.text : null, JSON.stringify({ rev: l.rev + 1, entries: l.entries }))) return res || { ok: true };
    }
    return { error: 'mix_ledger_busy_try_again' };
  };

  if (op === 'list') { const { d } = await loadMixes(); return { status: 200, json: { ok: true, mixes: d ? d.mixes : {}, config: { playlistId: config.playlistId, maxBytes: config.maxBytes } } }; }

  if (op === 'eligibility') { const conn = await deps.lookupChannel(); if (!conn || conn.channel_id !== CH) return fail(409, 'wrong_channel'); deps.yt = await deps.ytFor(conn); return { status: 200, json: { ok: true, ...(await srv2MixEligibility(deps)) } }; }

  if (op === 'save') {
    const rec = body.mix; const chk = srv2MixRecordCheck(rec);
    // drafts may be short of the rules (e.g. waiting for songs) — only identity, tracks and metadata shape are required
    const hard = chk.problems.filter((x) => !/at least \d songs|not within|YouTube needs at least 3 chapters/.test(x));
    if (hard.length) return fail(400, 'mix_invalid', { problems: hard });
    const res = await saveMixes((mixes) => {
      const old = mixes[rec.mixId];
      if (old && ['uploading', 'uploaded', 'public'].includes(old.status)) return { error: 'mix_locked_after_upload' };
      const keep = old ? { createdAt: old.createdAt, createdBy: old.createdBy, audit: old.audit || [] } : { createdAt: now(), createdBy: by, audit: [] };
      const status = ['draft', 'built', 'approved'].includes(rec.status) ? rec.status : 'draft';
      mixes[rec.mixId] = { ...rec, status, ...keep, updatedAt: now(), updatedBy: by, ready: chk.ok, problems: chk.problems, upload: old && old.upload || null, audit: keep.audit.concat({ at: now(), by, action: 'save:' + status }).slice(-50) };
      return { ok: true, mix: mixes[rec.mixId] };
    });
    if (res.error) return fail(409, res.error);
    return { status: 200, json: { ok: true, mix: res.mix } };
  }

  if (op === 'upload_init') {
    const { d } = await loadMixes(); const rec = d && d.mixes && d.mixes[String(body.mixId || '')];
    if (!rec) return fail(404, 'mix_not_found');
    if (rec.status !== 'approved') return fail(409, 'mix_not_approved');
    const chk = srv2MixRecordCheck(rec); if (!chk.ok) return fail(409, 'mix_invalid', { problems: chk.problems });
    const out = rec.output || {};
    if (!/^mixes\/mix_\d{6}_[a-z0-9]+\/[A-Za-z0-9._-]+\.(mp4|webm)$/.test(String(out.storagePath || ''))) return fail(400, 'output_path_invalid');
    if (!/^video\/(mp4|webm)/.test(String(out.mime || ''))) return fail(400, 'output_type_invalid');
    const head = await deps.headObject(out.storagePath);
    if (!head || head.bytes !== out.bytes) return fail(409, 'output_not_in_storage_or_size_mismatch', { stored: head && head.bytes, recorded: out.bytes });
    if (head.bytes > config.maxBytes) return fail(413, 'output_too_large', { bytes: head.bytes, maxBytes: config.maxBytes });
    const conn = await deps.lookupChannel(); if (!conn || conn.channel_id !== CH) return fail(409, 'wrong_channel');
    const yt = await deps.ytFor(conn); deps.yt = yt;
    // lineage: every source must still be a public SRV Studio Long with the same YouTube id
    const el = await srv2MixEligibility(deps); const byPkg = new Map(el.songs.map((s) => [s.pkgId, s]));
    const badSrc = rec.tracks.filter((t) => { const s = byPkg.get(t.pkgId); return !s || !s.eligible || s.youtubeVideoId !== t.youtubeVideoId; });
    if (badSrc.length) return fail(409, 'source_not_eligible', { tracks: badSrc.map((t) => ({ pkgId: t.pkgId, reason: (byPkg.get(t.pkgId) || {}).reason || 'missing' })) });
    const entryId = deps.newId();
    const claim = await ledgerOp((entries) => {
      const dec = srv2MixUploadDecide({ entries }, { mixKey: rec.mixId, mixPkgId: rec.mixId, monthKey: rec.monthKey });
      if (!dec.ok) return { error: dec.reason };
      entries.push({ id: entryId, mixKey: rec.mixId, mixPkgId: rec.mixId, monthKey: rec.monthKey, kind: 'mix', status: 'pending', claimedAt: now(), by, bytes: head.bytes, mime: out.mime, storagePath: out.storagePath, title: rec.title, lineage: rec.tracks.map((t) => t.pkgId) });
      return { ok: true };
    });
    if (claim.error) return fail(409, claim.error);
    let session;
    try {
      session = await yt.initResumable({ snippet: { title: rec.title, description: rec.description, tags: (rec.tags || []).slice(0, 30), categoryId: '10' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true } }, head.bytes, out.mime.split(';')[0]);
    } catch (e) {
      await ledgerOp((entries) => { const x = entries.find((y) => y.id === entryId); if (x) Object.assign(x, { status: 'failed', error: 'upload_init_failed', finishedAt: now() }); return { ok: true }; });
      return fail(502, 'upload_init_failed', { detail: String(e && e.message).slice(0, 200) });
    }
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === entryId); if (x) x.session = deps.seal(session); return { ok: true }; });
    await saveMixes((mixes) => { const m = mixes[rec.mixId]; if (m) { m.status = 'uploading'; m.upload = { entryId, startedAt: now(), bytes: head.bytes, offset: 0 }; m.audit = (m.audit || []).concat({ at: now(), by, action: 'upload_init' }); } return { ok: true }; });
    return { status: 200, json: { ok: true, entryId, offset: 0, total: head.bytes, chunkBytes: SRV2_MIX_CHUNK_BYTES } };
  }

  if (op === 'upload_chunk') {
    const row = await deps.getSetting(SRV2_MIX_KEYS.ledger); const l = srv2ParseLedger(row && row.text);
    const e = l && l.entries.find((x) => x.id === body.entryId && x.mixKey === body.mixId);
    if (!e) return fail(404, 'upload_not_found');
    if (e.status === 'uploaded') return { status: 200, json: { ok: true, done: true, youtubeVideoId: e.youtubeVideoId, offset: e.bytes, total: e.bytes, playlist: e.playlist || null } };
    if (e.status !== 'pending' || !e.session) return fail(409, 'upload_not_resumable', { status: e.status });
    const conn = await deps.lookupChannel(); if (!conn || conn.channel_id !== CH) return fail(409, 'wrong_channel');
    const yt = await deps.ytFor(conn); const session = deps.unseal(e.session);
    let st;
    try { st = await yt.status(session, e.bytes); } catch (err) { return fail(502, 'status_failed', { detail: String(err && err.message).slice(0, 200) }); }
    if (st.expired) {
      await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) Object.assign(x, { status: 'failed', error: 'session_expired', finishedAt: now() }); return { ok: true }; });
      await saveMixes((mixes) => { const m = mixes[e.mixKey]; if (m) { m.status = 'approved'; m.audit = (m.audit || []).concat({ at: now(), by, action: 'upload_session_expired' }); } return { ok: true }; });
      return fail(409, 'session_expired_restart_upload');
    }
    let result = st.complete ? st : null;
    if (!result) {
      const start = st.offset, end = Math.min(e.bytes, start + SRV2_MIX_CHUNK_BYTES);
      let buf;
      try { buf = await deps.readRange(e.storagePath, start, end); } catch (err) { return fail(502, 'storage_read_failed', { offset: start, detail: String(err && err.message).slice(0, 200) }); }
      if (!buf || buf.length !== end - start) return fail(502, 'storage_read_short', { offset: start });
      try { result = await yt.putChunk(session, buf, start, e.bytes); } catch (err) { return fail(502, 'chunk_failed_retry', { offset: start, detail: String(err && err.message).slice(0, 200) }); }
      if (!result.complete) {
        await saveMixes((mixes) => { const m = mixes[e.mixKey]; if (m && m.upload) m.upload.offset = result.offset; return { ok: true }; });
        return { status: 200, json: { ok: true, done: false, offset: result.offset, total: e.bytes } };
      }
    }
    // complete: verify the video before recording it
    const v = result.video || {};
    const vid = v.id; const verified = VID.test(String(vid || '')) && v.channelId === CH && v.privacyStatus === 'private';
    let playlist = null;
    if (verified && config.playlistId) { try { playlist = await srv2EnsurePlaylistId(yt, config.playlistId, vid, deps.now()); } catch (err) { playlist = { status: 'failed', error: 'playlist_exception' }; } }
    else if (verified) playlist = { status: 'not_configured', note: 'SRV Studio Mixes playlist ID not set yet — add it in YouTube Studio' };
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) { Object.assign(x, verified ? { status: 'uploaded', youtubeVideoId: vid, channelId: v.channelId, privacyStatus: v.privacyStatus, uploadedAt: now(), playlist } : { status: 'pending', youtubeVideoId: vid || null, error: 'uploaded_but_unverified_channel_or_privacy' }); delete x.session; } return { ok: true }; });
    await saveMixes((mixes) => { const m = mixes[e.mixKey]; if (m) { m.status = verified ? 'uploaded' : 'uploading'; m.upload = { ...(m.upload || {}), youtubeVideoId: vid || null, uploadedAt: now(), offset: e.bytes, verified }; m.playlist = playlist; m.audit = (m.audit || []).concat({ at: now(), by, action: verified ? 'uploaded_private' : 'uploaded_unverified' }); } return { ok: true }; });
    if (!verified) return fail(502, 'uploaded_but_unverified_channel_or_privacy', { youtubeVideoId: vid || null });
    return { status: 200, json: { ok: true, done: true, youtubeVideoId: vid, offset: e.bytes, total: e.bytes, privacyStatus: 'private', playlist } };
  }

  if (op === 'playlist') {
    const { d } = await loadMixes(); const m = d && d.mixes[String(body.mixId || '')];
    if (!m || !m.upload || !VID.test(String(m.upload.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    if (!config.playlistId) return fail(409, 'mix_playlist_not_configured');
    const conn = await deps.lookupChannel(); if (!conn || conn.channel_id !== CH) return fail(409, 'wrong_channel');
    const playlist = await srv2EnsurePlaylistId(await deps.ytFor(conn), config.playlistId, m.upload.youtubeVideoId, deps.now());
    await saveMixes((mixes) => { if (mixes[m.mixId]) { mixes[m.mixId].playlist = playlist; mixes[m.mixId].audit = (mixes[m.mixId].audit || []).concat({ at: now(), by, action: 'playlist:' + playlist.status }); } return { ok: true }; });
    return { status: 200, json: { ok: true, playlist } };
  }

  // custom 1280×720 thumbnail: only the mix's own JPEG (mixes/<mixId>/thumbnail.jpg, ≤ 2 MB), only on the verified SRV
  // Studio video; failure never undoes the upload — the VA can retry or set it in YouTube Studio.
  if (op === 'thumbnail') {
    const { d } = await loadMixes(); const m = d && d.mixes[String(body.mixId || '')];
    if (!m || !m.upload || !m.upload.verified || !VID.test(String(m.upload.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    const tp = String((m.output || {}).thumbnailPath || '');
    if (tp !== `mixes/${m.mixId}/thumbnail.jpg`) return fail(400, 'thumbnail_path_invalid');
    const head = await deps.headObject(tp);
    if (!head || !head.bytes) return fail(409, 'thumbnail_not_in_storage');
    if (head.bytes > 2 * 1024 * 1024) return fail(413, 'thumbnail_too_large');
    const conn = await deps.lookupChannel(); if (!conn || conn.channel_id !== CH) return fail(409, 'wrong_channel');
    const yt = await deps.ytFor(conn); const vid = m.upload.youtubeVideoId;
    const vis = (await yt.getVideosStatus([vid]))[vid] || null;
    if (!vis || vis.channelId !== CH) return fail(409, 'video_not_srv_studio');
    let buf; try { buf = await deps.readRange(tp, 0, head.bytes); } catch (err) { return fail(502, 'storage_read_failed'); }
    if (!buf || buf.length !== head.bytes || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return fail(400, 'thumbnail_not_jpeg');
    let thumbnail;
    try { await yt.setThumbnail(vid, buf); thumbnail = { status: 'set', at: now() }; } catch (err) { thumbnail = { status: 'failed', at: now(), error: String(err && err.message).slice(0, 160) }; }
    await saveMixes((mixes) => { const x = mixes[m.mixId]; if (x) { x.thumbnail = thumbnail; x.audit = (x.audit || []).concat({ at: now(), by, action: 'thumbnail:' + thumbnail.status }); } return { ok: true }; });
    return thumbnail.status === 'set' ? { status: 200, json: { ok: true, thumbnail } } : fail(502, 'thumbnail_failed_retry', { thumbnail });
  }

  if (op === 'confirm_public') {
    const { d } = await loadMixes(); const m = d && d.mixes[String(body.mixId || '')];
    if (!m || !m.upload || !VID.test(String(m.upload.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    const conn = await deps.lookupChannel(); if (!conn || conn.channel_id !== CH) return fail(409, 'wrong_channel');
    const yt = await deps.ytFor(conn); const vis = (await yt.getVideosStatus([m.upload.youtubeVideoId]))[m.upload.youtubeVideoId] || null;
    const conf = { confirmedAt: now(), by, youtubeReports: vis ? vis.privacyStatus : null, verifiedByApi: !!(vis && vis.privacyStatus === 'public') };
    await saveMixes((mixes) => { const x = mixes[m.mixId]; if (x) { x.publicConfirmation = conf; if (conf.verifiedByApi) x.status = 'public'; x.audit = (x.audit || []).concat({ at: now(), by, action: 'confirm_public:' + conf.youtubeReports }); } return { ok: true }; });
    return { status: 200, json: { ok: true, publicConfirmation: conf } };
  }
  return fail(400, 'unknown_op');
}
export { srv2Clock };

// Real YouTube adapter for the mix (api/ops.js): base playlist calls + batch visibility + resumable upload session.
// The session URL is returned to the caller only to be sealed into the ledger; it is never sent to the browser.
import { srv2YouTubeAdapter } from './srvStudioV2Playlists.mjs';
export function srv2MixYouTubeAdapter(token, fetchImpl = fetch) {
  const base = srv2YouTubeAdapter(token, fetchImpl); const auth = { Authorization: 'Bearer ' + token };
  return {
    ...base,
    async getVideosStatus(ids) {
      const out = {};
      for (let i = 0; i < ids.length; i += 50) {
        const r = await fetchImpl('https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=' + ids.slice(i, i + 50).map(encodeURIComponent).join(','), { headers: auth });
        if (!r.ok) throw new Error('videos.list HTTP ' + r.status);
        for (const v of (await r.json()).items || []) out[v.id] = { channelId: v.snippet && v.snippet.channelId, privacyStatus: v.status && v.status.privacyStatus };
      }
      return out;
    },
    async initResumable(resource, bytes, mime) {
      const r = await fetchImpl('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(bytes), 'X-Upload-Content-Type': mime }, body: JSON.stringify(resource) });
      if (!r.ok) throw new Error('upload init HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
      const loc = r.headers.get('location'); if (!loc) throw new Error('no upload session');
      return loc;
    },
    // resumable status probe: 308 + Range → bytes received so far; 200/201 → already complete; 404/410 → expired
    async status(session, total) {
      const r = await fetchImpl(session, { method: 'PUT', headers: { ...auth, 'Content-Length': '0', 'Content-Range': `bytes */${total}` } });
      if (r.status === 308) { const rg = r.headers.get('range'); return { offset: rg ? Number(rg.split('-')[1]) + 1 : 0 }; }
      if (r.status === 200 || r.status === 201) { const v = await r.json(); return { complete: true, video: { id: v.id, channelId: v.snippet && v.snippet.channelId, privacyStatus: v.status && v.status.privacyStatus } }; }
      if (r.status === 404 || r.status === 410) return { expired: true };
      throw new Error('status HTTP ' + r.status);
    },
    async setThumbnail(videoId, buf) {
      const r = await fetchImpl('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=' + encodeURIComponent(videoId), { method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg', 'Content-Length': String(buf.length) }, body: buf });
      if (!r.ok) throw new Error('thumbnails.set HTTP ' + r.status);
      return true;
    },
    async putChunk(session, buf, start, total) {
      const end = start + buf.length - 1;
      const r = await fetchImpl(session, { method: 'PUT', headers: { ...auth, 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${total}` }, body: buf });
      if (r.status === 308) { const rg = r.headers.get('range'); return { complete: false, offset: rg ? Number(rg.split('-')[1]) + 1 : start }; }
      if (r.status === 200 || r.status === 201) { const v = await r.json(); return { complete: true, video: { id: v.id, channelId: v.snippet && v.snippet.channelId, privacyStatus: v.status && v.status.privacyStatus } }; }
      throw new Error('chunk HTTP ' + r.status);
    },
  };
}
