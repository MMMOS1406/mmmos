// SRV Farsi Mix — server policy for the integrated, resumable, PRIVATE-first YouTube upload (CEO order 2026-11-12; preview only — nothing here is deployed).
// Pure: api/ops.js supplies the real dependencies, tests supply mocks. One action, srv_farsi_mix, with operations:
//   status · source_check · catalog · upload_init · upload_chunk · upload_status · thumbnail · playlist · playlist_fix · video_status · verify · abort
// Design (no file is ever stored by us): the BROWSER renders the Mix, then sends it in small chunks (CHUNK_BYTES, a multiple of 256 KiB — YouTube's resumable rule; small enough for
// a serverless request body); this server relays each chunk to ONE YouTube resumable session on the retained SRV Farsi channel ("Silk Road Voices"). The session URL is sealed
// (AES-256-GCM) before it is kept; the browser never sees it or any token. Interrupted uploads resume from the offset YouTube itself reports.
// Data (app_settings, server-written): srv_farsi_mix = config {enabled, channelId?, maxBytes?}  ·  srv_farsi_mix_ledger = {rev, entries[]}.
// Rules: OFF unless the config says enabled AND pins the exact YouTube channel id; CEO/VA session (checked by the caller); private only (never publishAt, never public); verified channel; every source song re-verified as a
// PUBLISHED SRV Farsi Long on that channel; one upload per Mix key (pending → resume, uploaded → refused); thumbnail only for the verified upload; failures never lose the record.
import { srvfMixCandidates, srvfMixValidate, srvfMixTimeline, srvfTitleCheck, srvfFinglishCheck, srvfMixDescription, srvfCatalogSummary, srvfAttachmentCandidate, srvfSourceSuggestions, srvfSongTitleFromYoutube, SRVF_ATTACH_TOLERANCE_SEC } from './srvFarsiMix.mjs';

export const SRVF_SERVER_KEYS = Object.freeze({ config: 'srv_farsi_mix', ledger: 'srv_farsi_mix_ledger', sources: 'srv_farsi_mix_sources' });
export function srvfParseSources(text) { if (text == null || text === '') return { rev: 0, items: {} }; try { const d = JSON.parse(text); return d && d.items && typeof d.items === 'object' ? { rev: Number(d.rev) || 0, items: d.items } : null; } catch (_) { return null; } }
export const SRVF_CHUNK_BYTES = 9 * 256 * 1024;                 // 2,359,296 bytes = 9 × 256 KiB; base64 in JSON ≈ 3.1 MB (< the 4.5 MB request limit)
export const SRVF_PLATFORM_MAX_BYTES = 256 * 1024 ** 3;          // YouTube's documented maximum file size
const VID = /^[A-Za-z0-9_-]{11}$/;
const PLID = /^PL[A-Za-z0-9_-]{16,40}$/;
const KEY = /^fmix_\d{6}_[a-z0-9]+$/;

export const SRVF_VALIDATION_MAX_WINDOW_MS = 7 * 24 * 3600 * 1000;
// credentialSource: 'production' (default: the stored Silk Road Voices connection + the server's OAuth client) or 'validation' (CEO-authorized isolated test: a dedicated temporary OAuth client + its own refresh token held in
// Preview-only environment variables; the production connection row, client and tokens are never read or written). A validation window MUST carry an expiry (at most 7 days ahead) after which every operation is refused.
export function srvfParseConfig(raw, nowMs = Date.now()) {
  if (raw == null || raw === '') return { error: 'mix_not_configured' };
  let c; try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { error: 'mix_config_unreadable' }; }
  if (!c || c.enabled !== true) return { error: 'mix_disabled' };
  if (c.channelId == null || c.channelId === '') return { error: 'mix_channel_required' };                  // the exact SRV Farsi channel must be pinned (no title-only routing)
  if (!/^UC[A-Za-z0-9_-]{20,24}$/.test(String(c.channelId))) return { error: 'mix_channel_invalid' };
  const maxBytes = Number.isInteger(c.maxBytes) && c.maxBytes > 0 ? Math.min(c.maxBytes, SRVF_PLATFORM_MAX_BYTES) : SRVF_PLATFORM_MAX_BYTES;
  const src = c.credentialSource == null ? 'production' : c.credentialSource; if (src !== 'production' && src !== 'validation') return { error: 'mix_credential_source_invalid' };
  let validationUntil = null;
  if (src === 'validation') { const t = Date.parse(c.validationUntil); if (!Number.isFinite(t)) return { error: 'mix_validation_expiry_required' }; if (t <= nowMs) return { error: 'mix_validation_expired' }; if (t - nowMs > SRVF_VALIDATION_MAX_WINDOW_MS) return { error: 'mix_validation_window_too_long' }; validationUntil = new Date(t).toISOString(); }
  // allowNonPublicSources: VALIDATION WINDOW ONLY (CEO/PM-approved test relaxation, default off): lets the private test Mix use the owner's own Longs even while they are still Unlisted/Private on the SAME channel. The upload itself stays Private-only.
  const relax = c.allowNonPublicSources === true; if (relax && src !== 'validation') return { error: 'mix_relaxation_requires_validation' };
  return { config: { enabled: true, channelId: c.channelId, maxBytes, credentialSource: src, validationUntil, allowNonPublicSources: relax } };
}
export function srvfParseLedger(text) {
  if (text == null || text === '') return { rev: 0, entries: [] };
  try { const d = JSON.parse(text); return d && Array.isArray(d.entries) ? { rev: Number(d.rev) || 0, entries: d.entries } : null; } catch (_) { return null; }
}
// One upload per Mix: a pending upload is RESUMED (same file size only), an uploaded one is final, failed/aborted ones may start again.
export function srvfUploadDecide(entries, mixKey, bytes) {
  const live = entries.filter((e) => e.mixKey === mixKey);
  const up = live.find((e) => e.status === 'uploaded'); if (up) return { ok: false, reason: 'already_uploaded', youtubeVideoId: up.youtubeVideoId };
  const pend = live.find((e) => e.status === 'pending');
  if (pend) return pend.bytes === bytes ? { ok: true, resume: pend } : { ok: false, reason: 'pending_upload_with_different_size', entryId: pend.id };
  return { ok: true };
}

// Re-verify the Mix against the authoritative database + YouTube (the browser's record is never trusted for lineage).
export async function srvfVerifyMix(deps, mix) {
  const accept = deps.acceptPrivacy || ['public'];
  const problems = [];
  if (!mix || typeof mix !== 'object') return { ok: false, problems: ['mix_missing'] };
  if (!KEY.test(String(mix.key || ''))) problems.push('mix_key_invalid');
  const tErr = srvfTitleCheck(mix.title); if (tErr) problems.push(tErr);
  const desc = String(mix.description || ''); if (!desc || Buffer.byteLength(desc, 'utf8') > 5000) problems.push('description_missing_or_over_5000_bytes');
  const tags = Array.isArray(mix.tags) ? mix.tags : []; if (tags.join(',').length > 480 || tags.length > 40) problems.push('tags_too_long');
  const ids = Array.isArray(mix.tracks) ? mix.tracks.map((t) => String(t && t.pkgId || '')) : []; if (ids.length < 2) problems.push('at_least_two_songs');
  const pk = await deps.listFarsiPackages();
  // A song whose length MMMOS never recorded (older Longs) is measured by YouTube itself: ask YouTube for the lengths of exactly the songs in this Mix (a failed lookup simply leaves them unmeasured → refused as before).
  let youtubeDurations = null; try { if (deps.yt && typeof deps.yt.videosInfo === 'function') { const first = new Map(srvfMixCandidates(pk || []).map((c) => [c.pkgId, c])); const want = [...new Set(ids.map((i) => first.get(i)).filter((c) => c && c.youtubeVideoId && /^[A-Za-z0-9_-]{11}$/.test(c.youtubeVideoId)).map((c) => c.youtubeVideoId))]; if (want.length) { const info = await deps.yt.videosInfo(want); youtubeDurations = {}; for (const k of Object.keys(info)) if (info[k] && info[k].durationSec) youtubeDurations[k] = info[k].durationSec; } } } catch (_) { youtubeDurations = null; }
  let taskArtists = null; try { taskArtists = typeof deps.listTaskArtists === 'function' ? await deps.listTaskArtists() : null; } catch (_) { taskArtists = null; }
  const cands = new Map(srvfMixCandidates(pk || [], { youtubeDurations, taskArtists }).map((c) => [c.pkgId, c]));
  // sources an operator linked to a published YouTube song (srv_farsi_mix_sources): same checks, against YouTube's own facts for that video
  const attIds = ids.filter((i) => /^src_[A-Za-z0-9_-]{11}$/.test(i)).map((i) => i.slice(4));
  if (attIds.length && typeof deps.getSources === 'function' && deps.yt && typeof deps.yt.videosInfo === 'function') { try {
    const reg = await deps.getSources(); const info = await deps.yt.videosInfo(attIds); const pkgById = new Map((pk || []).map((p) => [String(p.id), p]));
    for (const id of attIds) { const att = reg && reg.items && reg.items[id]; if (att) cands.set('src_' + id, srvfAttachmentCandidate(att, info[id] || null, { channelId: deps.channelId, accepts: accept, pkg: att.packageId ? pkgById.get(att.packageId) : null })); }
  } catch (_) { /* a failed lookup leaves them unknown -> refused as source_not_eligible:…:missing */ } }
  const songs = [];
  for (const t of mix.tracks || []) {
    const c = cands.get(String(t.pkgId)); if (!c || !c.eligible) { problems.push(`source_not_eligible:${t.pkgId}:${c ? c.reason : 'missing'}`); continue; }
    if (c.youtubeVideoId !== t.youtubeVideoId) problems.push(`source_video_mismatch:${t.pkgId}`);
    songs.push({ ...c, finglish: String(t.finglish || ''), finglishAuto: !!t.finglishAuto, finglishConfirmed: !!t.finglishConfirmed });
  }
  if (songs.length === ids.length && songs.length >= 2) {
    const v = srvfMixValidate(srvfMixTimeline(songs.map((s) => ({ pkgId: s.pkgId, title: s.title, finglish: s.finglish, artist: s.artist, durationSec: s.durationSec }))), { category: mix.category, mood: mix.mood, songs });
    for (const p of v.problems) problems.push('rule:' + p);
    for (const s of songs) { const fe = srvfFinglishCheck(s.finglish); if (fe) problems.push('finglish:' + s.pkgId); }
    const yt = await deps.yt.getVideosStatus(songs.map((s) => s.youtubeVideoId));
    for (const s of songs) { const v1 = yt[s.youtubeVideoId]; if (!v1) problems.push(`source_not_on_youtube:${s.pkgId}`); else if (deps.channelId && v1.channelId !== deps.channelId) problems.push(`source_other_channel:${s.pkgId}`); else if (!accept.includes(v1.privacyStatus)) problems.push(`source_not_public:${s.pkgId}`); }
  }
  return { ok: !problems.length, problems, songs };
}

// The upload is bound to an APPROVED, saved SRV Farsi Mix package: same key, title and songs as the request, approved with the exact metadata that will be published, built file of exactly the
// size being uploaded, and not uploaded before. Title, description and tags are taken from the package's approval record — the request's own copies are ignored.
export function srvfCheckApproval(pkg, mix, bytes, mime) {
  const p = [];
  if (!pkg || typeof pkg !== 'object') return { ok: false, problems: ['package_not_found'] };
  if (pkg.engine !== 'SRV Farsi') p.push('package_not_srv_farsi');
  if (pkg.contentType !== 'Mix' || !pkg.farsiMix) p.push('package_not_a_mix');
  if (String(String(pkg.srvTaskUid || '')).startsWith('set-aside:')) p.push('package_set_aside');
  const fm = pkg.farsiMix || {};
  if (fm.key !== mix.key) p.push('package_key_mismatch');
  if (!fm.approved || !fm.approved.at || !fm.approved.by) p.push('mix_not_approved');
  if (fm.approved && (!fm.approved.description || !fm.approved.title)) p.push('approval_record_incomplete');
  if (fm.approved && fm.approved.title !== fm.title) p.push('title_changed_after_approval');
  if (!fm.build || !fm.build.at || fm.build.bytes !== bytes || String(fm.build.mime || '').split(';')[0] !== mime) p.push('built_file_does_not_match_approved_build');
  const ids = (fm.tracks || []).map((t) => t.pkgId).join(','), req = (mix.tracks || []).map((t) => t.pkgId).join(','); if (ids !== req) p.push('songs_differ_from_approved_package');
  if (pkg.youtubeVideoId || pkg.youtube_video_id) p.push('package_already_has_a_video');
  return { ok: !p.length, problems: p, record: fm };
}

// Independent verification of the uploaded video through the YouTube API (not the upload response): channel, privacy, AI-content flag, title/description (chapters), file size/duration/streams
// (once YouTube has processed it), playlist membership. A check that YouTube's API cannot answer is reported as such, never as a pass.
// ── channel reconciliation (pure) ──
// Compares what YouTube says the channel contains with what MMMOS holds, by the stable YouTube video id, and decides eligibility for every published Long song:
//   YouTube is the authority for: the video exists on the pinned channel, its visibility, its length (song 2–10 min; shorter = Short; longer = a mix/compilation, never a song source).
//   MMMOS is the authority for: the source audio file, the singer category (package → mood text → the producing task; never guessed) and the Finglish/cover data.
// Anything that cannot be decided is listed with its reason; nothing is dropped and nothing is invented.
export const SRVF_COMPILATION_MIN_SEC = 600;
export function srvfCatalogReconcile({ uploads, discovery, packages, taskArtists = null, accepts = ['public'], channelId, minSongSec = 120, attachments = {} }) {
  const up = new Map((uploads || []).map((u) => [u.id, u])); const ytd = {}; for (const u of uploads || []) if (u.durationSec) ytd[u.id] = u.durationSec;
  const cands = srvfMixCandidates(packages || [], { youtubeDurations: ytd, taskArtists });
  const ids = (p) => [p._srvYtLongId, p.youtubeVideoId, p.youtube_video_id, p.srvPublish && p.srvPublish.videoId, p._srvYtShortId].filter(Boolean);
  const anyPkgYt = new Set(); for (const p of packages || []) for (const i of ids(p)) anyPkgYt.add(i);
  const complete = !!(discovery && discovery.complete); const attachedPk = new Set(Object.values(attachments || {}).map((a) => a && a.packageId).filter(Boolean));
  const songs = cands.filter((c) => !attachedPk.has(c.pkgId)).map((c) => {
    if (!c.youtubeVideoId) return { ...c, inMmmos: true };
    if (c.reason === 'test' || c.reason === 'set_aside' || c.reason === 'no_title' || c.reason === 'not_uploaded' || c.reason === 'not_built') return { ...c, inMmmos: true };
    const u = up.get(c.youtubeVideoId);
    if (!u) return complete ? { ...c, eligible: false, reason: 'not_found_on_youtube', inMmmos: true } : { ...c, inMmmos: true, unverified: true };
    let reason = c.reason;
    if (u.channelId !== channelId) reason = 'other_channel'; else if (accepts.indexOf(u.privacyStatus) < 0) reason = 'not_public_on_youtube'; else if (!reason && !(c.durationSec >= minSongSec)) reason = 'too_short';
    return { ...c, eligible: !reason, reason: reason || null, inMmmos: true, youtubePrivacy: u.privacyStatus, youtubeTitle: u.title || null, publishedAt: u.publishedAt || null };
  });
  const have = new Set(songs.map((c) => c.youtubeVideoId).filter(Boolean)); const yt = { uploads: (uploads || []).length, songs: 0, mixes: 0, shorts: 0, other: 0 }; const onlyYt = []; const pkgById = new Map((packages || []).map((p) => [String(p.id), p]));
  for (const u of uploads || []) {
    const sec = u.durationSec || 0; const kind = sec >= SRVF_COMPILATION_MIN_SEC ? 'mix' : sec >= minSongSec ? 'song' : sec > 0 ? 'short' : 'other'; yt[kind === 'song' ? 'songs' : kind === 'mix' ? 'mixes' : kind === 'short' ? 'shorts' : 'other']++;
    if (kind !== 'song' || have.has(u.id) || anyPkgYt.has(u.id)) continue;
    const att = (attachments || {})[u.id]; if (att) { const ac = srvfAttachmentCandidate(att, u, { channelId, accepts, minSongSec, pkg: att.packageId ? pkgById.get(att.packageId) : null }); onlyYt.push(ac); continue; }
    const reason = u.channelId !== channelId ? 'other_channel' : accepts.indexOf(u.privacyStatus) < 0 ? 'not_public_on_youtube' : 'not_in_mmmos';
    onlyYt.push({ pkgId: null, title: u.title || u.id, finglish: '', artist: '', artistSource: '', mood: '', durationSec: sec, durationSource: 'youtube', youtubeVideoId: u.id, eligible: false, reason, inMmmos: false, youtubePrivacy: u.privacyStatus, publishedAt: u.publishedAt || null });
  }
  const all = songs.concat(onlyYt); const visible = all.filter((c) => c.reason !== 'test' && c.reason !== 'set_aside');
  const exclusions = {}; for (const c of visible) if (!c.eligible) exclusions[c.reason] = (exclusions[c.reason] || 0) + 1;
  const matched = (uploads || []).filter((u) => { const d = u.durationSec || 0; return d >= minSongSec && d < SRVF_COMPILATION_MIN_SEC && songs.some((c) => c.youtubeVideoId === u.id); }).length;
  const artistGaps = visible.filter((c) => c.inMmmos && !c.artist && c.reason !== 'not_found_on_youtube' && c.reason !== 'not_uploaded' && c.reason !== 'not_built').map((c) => ({ pkgId: c.pkgId, youtubeVideoId: c.youtubeVideoId, title: c.title, suggestion: c.artistSuggestion || null, evidence: c.artistEvidence || null, onYoutube: !!(c.youtubeVideoId && up.has(c.youtubeVideoId)) }));
  return { songs: all, youtube: yt, mmmos: { longPackages: visible.filter((c) => c.inMmmos && c.reason !== 'not_built').length, notBuilt: visible.filter((c) => c.reason === 'not_built').length, matchedSongs: matched, notInMmmos: onlyYt.filter((c) => c.reason === 'not_in_mmmos').length, attached: onlyYt.filter((c) => c.attached).length }, counts: srvfCatalogSummary(visible), exclusions, artistGaps, complete, needSource: onlyYt.filter((c) => c.reason === 'not_in_mmmos'), uploadsById: up };
}
// YouTube reports a video's length two ways: fileDetails.durationMs (owner-only, may be absent for some containers) and contentDetails.duration (ISO 8601, e.g. PT7M15S, whole seconds).
// Both are parsed strictly: anything that is not a finite positive number is "not reported" — never NaN, never a pass.
export function srvfParseIsoDuration(v) {
  if (typeof v !== 'string') return null; const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v.trim()); if (!m || v.trim() === 'P' || /T$/.test(v.trim())) return null;
  const sec = (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0); return Number.isFinite(sec) && sec > 0 ? sec : null;
}
export function srvfDurationOf(video) {
  const fd = (video && video.fileDetails) || null, cd = (video && video.contentDetails) || null; const rawMs = fd ? fd.durationMs : undefined, rawIso = cd ? cd.duration : undefined;
  const ms = typeof rawMs === 'number' ? rawMs : (typeof rawMs === 'string' && /^\d+(\.\d+)?$/.test(rawMs.trim()) ? Number(rawMs) : NaN); const msSec = Number.isFinite(ms) && ms > 0 ? ms / 1000 : null; const isoSec = srvfParseIsoDuration(rawIso);
  const show = (x) => (x === undefined ? 'missing' : JSON.stringify(x).slice(0, 24));
  return { sec: msSec != null ? msSec : isoSec, source: msSec != null ? 'fileDetails.durationMs' : isoSec != null ? 'contentDetails.duration' : null, raw: 'fileDetails.durationMs=' + show(rawMs) + ', contentDetails.duration=' + show(rawIso) };
}
// What YouTube itself says about processing, shown on its own (the lifecycle is DONE once the private upload is complete; processing is reported separately).
export function srvfProcessingInfo(video) {
  if (!video) return { state: 'not_found', uploadStatus: null, fileDetails: 'not_available', partsProcessed: null, partsTotal: null, timeLeftMs: null };
  const st = video.status || {}, pd = video.processingDetails || null, fd = video.fileDetails || null, pp = (pd && pd.processingProgress) || {}; const num = (x) => (x == null || x === '' ? null : Number(x));
  return { state: pd ? (pd.processingStatus || 'unknown') : 'not_reported', uploadStatus: st.uploadStatus || null, fileDetails: fd ? 'available' : ((pd && pd.fileDetailsAvailability) || 'not_available_yet'), partsProcessed: num(pp.partsProcessed), partsTotal: num(pp.partsTotal), timeLeftMs: num(pp.timeLeftMs), failureReason: st.failureReason || (pd && pd.processingFailureReason) || null, rejectionReason: st.rejectionReason || null };
}
export function srvfVerifyChecks({ video, exp, playlist, individual }) {
  const c = []; const add = (name, ok, detail, warn) => c.push({ name, ok, detail: detail == null ? '' : String(detail), ...(warn ? { warn: true } : {}) });
  if (!video) { add('video_found', false, 'not returned by YouTube'); return { checks: c, overall: false, pending: false }; }
  const sn = video.snippet || {}, stt = video.status || {}, fd = video.fileDetails || null, pd = video.processingDetails || null;
  add('video_found', true, video.id);
  add('channel_is_exact_srv_farsi_channel', sn.channelId === exp.channelId, sn.channelId);
  add('privacy_is_private', stt.privacyStatus === 'private', stt.privacyStatus);
  add('not_scheduled_for_public_release', !stt.publishAt, stt.publishAt || 'none');
  const ai = stt.containsSyntheticMedia; add('ai_content_disclosure_set', ai === true, ai === undefined ? 'not reported by the YouTube API for this video — confirm "Altered content: Yes" in YouTube Studio' : String(ai), ai === undefined);   // never a pass when the API did not answer; shown as a warning, not a failure
  add('title_matches_approved_title', sn.title === exp.title, sn.title);
  add('description_matches_approved_description', sn.description === exp.description, (sn.description || '').length + ' chars');
  const ts = (String(sn.description || '').match(/^\d{1,2}:\d{2}(?::\d{2})?\s/gm) || []);
  add('chapters_in_description_start_at_0_00', /^0:00\s/m.test(sn.description || '') && ts.length >= 2, ts.length + ' timestamps');
  add('chapter_markers_will_show_on_youtube', ts.length >= 3, ts.length >= 3 ? 'YouTube shows chapter markers' : 'YouTube shows chapter markers only from 3 timestamps (the tracklist is still in the description)', true);
  add('tags_present', Array.isArray(sn.tags) && sn.tags.length > 0 && exp.tags.every((t) => (sn.tags || []).includes(t)), (sn.tags || []).length + ' tags');
  add('thumbnail_set_by_upload_step', exp.thumbnailStatus === 'set', exp.thumbnailStatus || 'not set'); // YouTube's API does not report whether a thumbnail is custom: this is the thumbnails.set result
  const proc = pd && pd.processingStatus; const failed = proc === 'failed' || proc === 'terminated'; const pending = !failed && (!fd || (proc && proc !== 'succeeded'));
  if (failed) add('file_processing_finished', false, proc + (stt.failureReason ? ' (' + stt.failureReason + ')' : ''));
  else if (pending) add('file_processing_finished', false, proc || 'file details not available yet');
  else {
    add('file_processing_finished', true, proc || 'succeeded');
    add('file_size_equals_uploaded_bytes', Number(fd.fileSize) === exp.bytes, fd.fileSize + ' vs ' + exp.bytes);
    const dd = srvfDurationOf(video);
    if (dd.sec == null) add('duration_matches_build', false, 'YouTube did not report a usable duration (' + dd.raw + ') — not a pass; a real length mismatch would be reported as a failure', true);
    else add('duration_matches_build', Math.abs(dd.sec - exp.durationSec) <= 3, dd.sec + ' s (' + dd.source + ') vs ' + exp.durationSec + ' s');
    const v0 = (fd.videoStreams || [])[0] || {}; add('video_is_1920x1080', v0.widthPixels === 1920 && v0.heightPixels === 1080, v0.widthPixels + 'x' + v0.heightPixels);
    const a0 = (fd.audioStreams || [])[0] || null; add('audio_stream_present', !!a0, a0 ? a0.codec : 'none');
  }
  if (exp.playlistId) add('in_the_mixes_playlist', !!playlist, exp.playlistId + (playlist ? (exp.playlistItemIds && exp.playlistItemIds.length > 1 ? ' — DUPLICATE: ' + exp.playlistItemIds.length + ' items' : '') : ' (not found)')); else add('in_the_mixes_playlist', false, 'no Mixes playlist configured');
  const ind = Array.isArray(individual) ? individual : []; add('not_in_individual_song_playlists', ind.length === 0, ind.length ? 'also in: ' + ind.join(', ') : 'none');
  const overall = c.every((x) => x.ok || x.warn);
  const integrityOk = c.every((x) => x.ok || x.warn || x.name === 'file_processing_finished');   // everything except YouTube's own processing
  return { checks: c, overall, integrityOk, pending: !!pending };
}

export async function srvfRunMixOp(deps, body) {
  const fail = (status, error, extra) => ({ status, json: { ok: false, farsiMix: true, error, ...(extra || {}) } });
  const { config, error } = srvfParseConfig(((await deps.getSetting(SRVF_SERVER_KEYS.config)) || {}).text, deps.now());
  if (!config) return fail(403, error);
  if (config.credentialSource === 'validation' && !(deps.validationAvailable && deps.validationAvailable())) return fail(403, 'validation_not_available');   // not a Preview deployment, or its temporary credentials are not set
  const op = String((body && body.op) || ''); const now = () => new Date(deps.now()).toISOString(); const by = deps.by || null;
  const ledgerOp = async (mutate) => {
    for (let a = 0; a < 8; a++) {
      const row = await deps.getSetting(SRVF_SERVER_KEYS.ledger); const l = srvfParseLedger(row && row.text); if (!l) return { error: 'mix_ledger_unreadable' };
      const res = mutate(l.entries); if (res && res.error) return res;
      if (await deps.casSetting(SRVF_SERVER_KEYS.ledger, row ? row.text : null, JSON.stringify({ rev: l.rev + 1, entries: l.entries }))) return res || { ok: true };
    }
    return { error: 'mix_ledger_busy_try_again' };
  };
  const loadEntry = async (entryId, mixKey) => { const row = await deps.getSetting(SRVF_SERVER_KEYS.ledger); const l = srvfParseLedger(row && row.text); return l ? l.entries.find((x) => x.id === entryId && x.mixKey === mixKey) || null : null; };
  const sourcesOp = async (mutate) => {
    for (let a = 0; a < 8; a++) {
      const row = await deps.getSetting(SRVF_SERVER_KEYS.sources); const reg = srvfParseSources(row && row.text); if (!reg) return { error: 'mix_sources_unreadable' };
      const res = mutate(reg.items); if (res && res.error) return res;
      if (await deps.casSetting(SRVF_SERVER_KEYS.sources, row ? row.text : null, JSON.stringify({ rev: reg.rev + 1, items: reg.items }))) return res || { ok: true };
    }
    return { error: 'mix_sources_busy_try_again' };
  };
  const loadSources = async () => { const row = await deps.getSetting(SRVF_SERVER_KEYS.sources); return srvfParseSources(row && row.text) || { rev: 0, items: {} }; };
  const pkgYtIds = (p) => [p._srvYtLongId, p.youtubeVideoId, p.youtube_video_id, p.srvPublish && p.srvPublish.videoId, p._srvYtShortId].filter(Boolean);
  const accepts = () => (config.allowNonPublicSources ? ['public', 'unlisted', 'private'] : ['public']);

  // production: the stored connection must be the exact pinned channel. validation: there is deliberately NO database lookup (the production connection row is never touched); the pinned channel id is the claim and the
  // token's real ownership is proven with channels.list(mine=true) before any upload.
  const channel = async () => { if (config.credentialSource === 'validation') return { channel_id: config.channelId, validation: true }; const conn = await deps.lookupChannel(); if (!conn || !conn.channel_id || conn.channel_id !== config.channelId) return null; return conn; };

  if (op === 'status') {
    const conn = await channel(); let probe = null;
    // probe: refresh the stored token with the server's OAuth client credentials and ask YouTube which channel(s) the token owns — proves the CLIENT_ID/SECRET pair AND the exact-channel ownership
    // without uploading anything. Only the verdict is returned/recorded (never a secret, never a token).
    if (body.probe && conn) {
      try { const ids = await (await deps.ytFor(conn, config.credentialSource)).myChannelIds(); probe = { ok: true, credential: 'valid', credentialSource: config.credentialSource, channelOwned: ids.includes(config.channelId), channelsSeen: ids.length };
      } catch (e) { const m = String((e && e.message) || e); probe = { ok: false, credentialSource: config.credentialSource, credential: /invalid_client|unauthorized_client/.test(m) ? 'invalid_client' : /invalid_grant/.test(m) ? 'invalid_grant' : 'error', detail: m.replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>').slice(0, 160) }; }
      probe.at = now(); probe.by = by;
      await ledgerOp((entries) => { entries.push({ id: 'probe_' + deps.newId(), kind: 'probe', ...probe }); const pr = entries.filter((x) => x.kind === 'probe'); if (pr.length > 5) pr.slice(0, pr.length - 5).forEach((x) => entries.splice(entries.indexOf(x), 1)); return { ok: true }; });
    } const row = await deps.getSetting(SRVF_SERVER_KEYS.ledger); const l = srvfParseLedger(row && row.text);
    const mine = body.mixKey ? (l ? l.entries.filter((e) => e.mixKey === body.mixKey && !e.kind).map((e) => ({ id: e.id, status: e.status, bytes: e.bytes, youtubeVideoId: e.youtubeVideoId || null, error: e.error || null })) : []) : undefined;
    return { status: 200, json: { ok: true, enabled: true, credentialSource: config.credentialSource, validationUntil: config.validationUntil, relaxed: !!config.allowNonPublicSources, channelConnected: !!conn, chunkBytes: SRVF_CHUNK_BYTES, maxBytes: config.maxBytes, entries: mine, ...(probe ? { probe } : {}) } };
  }

  if (op === 'upload_init') {
    const mix = body.mix || {}; const bytes = Number(body.bytes); const mime = String(body.mime || '').split(';')[0];
    if (!Number.isInteger(bytes) || bytes <= 0) return fail(400, 'bytes_invalid');
    const pkg = await deps.getMixPackage(String(body.packageId || '')); const appr = srvfCheckApproval(pkg, mix, bytes, mime);
    if (!appr.ok) return fail(409, 'mix_not_approved_or_not_matching', { problems: appr.problems });
    mix.title = appr.record.approved.title; mix.description = appr.record.approved.description; mix.tags = appr.record.approved.tags || []; mix.category = appr.record.category; mix.mood = appr.record.mood;   // what was approved is what is published
    if (bytes > config.maxBytes) return fail(413, 'file_too_large', { bytes, maxBytes: config.maxBytes });
    if (!/^video\/(webm|mp4)$/.test(mime)) return fail(400, 'type_invalid');
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel');
    const yt = await deps.ytFor(conn, config.credentialSource); deps.yt = yt; deps.channelId = conn.channel_id; deps.acceptPrivacy = config.allowNonPublicSources ? ['public', 'unlisted', 'private'] : ['public'];
    let owned = []; try { owned = await yt.myChannelIds(); } catch (e) { return fail(502, 'credential_check_failed', { detail: String((e && e.message) || e).replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>').slice(0, 160) }); }
    if (!owned.includes(config.channelId)) return fail(409, 'token_does_not_own_pinned_channel');       // the upload token must really belong to the exact SRV Farsi channel
    const ver = await srvfVerifyMix(deps, mix); if (!ver.ok) return fail(409, 'mix_not_valid', { problems: ver.problems.slice(0, 20) });
    let entryId = deps.newId(); let resume = null;
    const claim = await ledgerOp((entries) => {
      const dec = srvfUploadDecide(entries, mix.key, bytes); if (!dec.ok) return { error: dec.reason, youtubeVideoId: dec.youtubeVideoId };
      if (dec.resume) { resume = dec.resume; return { ok: true }; }
      entries.push({ id: entryId, mixKey: mix.key, packageId: String(body.packageId), status: 'pending', claimedAt: now(), by, bytes, mime, title: mix.title, category: mix.category, mood: mix.mood, lineage: mix.tracks.map((t) => t.pkgId), channelId: conn.channel_id, durationSec: Number(appr.record.build.durationSec) || null });
      return { ok: true };
    });
    if (claim.error) return fail(409, claim.error, claim.youtubeVideoId ? { youtubeVideoId: claim.youtubeVideoId } : undefined);
    if (resume && !resume.session) { entryId = resume.id; resume = null; }    // a claim whose session was never stored (the earlier call was cut off): reuse that entry and open the session now
    if (resume && resume.session) { // the same Mix was already started: continue it from YouTube's own offset
      let st; try { st = await yt.status(deps.unseal(resume.session), resume.bytes); } catch (e) { return fail(502, 'status_failed', { detail: String(e && e.message).slice(0, 200) }); }
      if (!st.expired) return { status: 200, json: { ok: true, resumed: true, entryId: resume.id, offset: st.complete ? resume.bytes : st.offset, total: resume.bytes, chunkBytes: SRVF_CHUNK_BYTES } };
      await ledgerOp((entries) => { const x = entries.find((y) => y.id === resume.id); if (x) Object.assign(x, { status: 'failed', error: 'session_expired', finishedAt: now() }); return { ok: true }; });
      return fail(409, 'session_expired_start_again');
    }
    let session;
    try { session = await yt.initResumable({ snippet: { title: mix.title, description: mix.description, tags: (mix.tags || []).slice(0, 40), categoryId: '10' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true } }, bytes, mime); }
    catch (e) { await ledgerOp((entries) => { const x = entries.find((y) => y.id === entryId); if (x) Object.assign(x, { status: 'failed', error: 'upload_init_failed', finishedAt: now() }); return { ok: true }; }); return fail(502, 'upload_init_failed', { detail: String(e && e.message).slice(0, 200) }); }
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === entryId); if (x) x.session = deps.seal(session); return { ok: true }; });
    return { status: 200, json: { ok: true, resumed: false, entryId, offset: 0, total: bytes, chunkBytes: SRVF_CHUNK_BYTES } };
  }

  // source_check: which of these songs' YouTube videos are acceptable sources RIGHT NOW (visibility is asked of YouTube itself, not guessed from our records) — lets the page refuse an unusable song BEFORE a long build. Read-only.
  if (op === 'source_check') {
    const ids = Array.isArray(body.videoIds) ? [...new Set(body.videoIds.map(String))].filter((x) => VID.test(x)).slice(0, 50) : []; if (!ids.length) return fail(400, 'video_ids_required');
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel'); const yt = await deps.ytFor(conn, config.credentialSource);
    let st; try { st = typeof yt.videosInfo === 'function' ? await yt.videosInfo(ids) : await yt.getVideosStatus(ids); } catch (e) { return fail(502, 'status_failed', { detail: String((e && e.message) || e).replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>').slice(0, 160) }); }
    const accepts = config.allowNonPublicSources ? ['public', 'unlisted', 'private'] : ['public'];
    return { status: 200, json: { ok: true, acceptsPrivacy: accepts, relaxed: !!config.allowNonPublicSources, statuses: Object.fromEntries(ids.map((i) => [i, st[i] ? { privacy: st[i].privacyStatus, onPinnedChannel: st[i].channelId === conn.channel_id, durationSec: st[i].durationSec || null } : null])) } };
  }

  // catalog: the authoritative picture of the SRV Farsi channel against MMMOS. The channel is DISCOVERED through the official YouTube Data API (uploads playlist, paginated, then batched video details) — not inferred from MMMOS records —
  // and reconciled with the MMMOS packages by YouTube video id (see srvfCatalogReconcile). Returns every song with its eligibility/reason, the YouTube totals, the MMMOS match counts, artist gaps and the discovery status (complete or not,
  // pages read, time). Read-only apart from a compact snapshot on the ledger (last 3) so the live numbers can be audited without a session.
  if (op === 'catalog') {
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel'); const yt = await deps.ytFor(conn, config.credentialSource);
    let pk; try { pk = await deps.listFarsiPackages(); } catch (e) { return fail(502, 'catalog_load_failed'); }
    let taskArtists = null; try { taskArtists = typeof deps.listTaskArtists === 'function' ? await deps.listTaskArtists() : null; } catch (_) { taskArtists = null; }
    const syncedAt = now(); let discovery = { ok: false, complete: false, pages: 0, uploads: 0, error: 'channel discovery not available', syncedAt }; let uploads = [];
    try {
      if (typeof yt.uploadsPlaylistId !== 'function' || typeof yt.listUploadIds !== 'function' || typeof yt.videosInfo !== 'function') throw new Error('discovery not supported');
      const pid = await yt.uploadsPlaylistId(); const list = await yt.listUploadIds(pid); const info = list.ids.length ? await yt.videosInfo(list.ids) : {};
      uploads = list.ids.filter((i) => info[i]).map((i) => ({ id: i, ...info[i] }));
      discovery = { ok: true, complete: !!list.complete, pages: list.pages, uploads: list.ids.length, unreadable: list.ids.length - uploads.length, error: list.error || '', syncedAt };
    } catch (e) { discovery = { ok: false, complete: false, pages: 0, uploads: 0, error: String((e && e.message) || e).replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>').slice(0, 140), syncedAt }; }
    // Without a successful discovery the MMMOS-side songs are still checked one by one (the older route) — but the result is marked incomplete.
    if (!discovery.ok) { const first = srvfMixCandidates(pk || [], { taskArtists }); const want = [...new Set(first.filter((c) => c.youtubeVideoId && VID.test(c.youtubeVideoId)).map((c) => c.youtubeVideoId))]; try { const info = typeof yt.videosInfo === 'function' ? await yt.videosInfo(want) : {}; uploads = want.filter((i) => info[i]).map((i) => ({ id: i, ...info[i] })); } catch (_) { uploads = []; } }
    const accepts = config.allowNonPublicSources ? ['public', 'unlisted', 'private'] : ['public'];
    let reg = { items: {} }; try { reg = await loadSources(); } catch (_) { reg = { items: {} }; }
    let rec = srvfCatalogReconcile({ uploads, discovery: discovery.ok ? discovery : { complete: false }, packages: pk || [], taskArtists, accepts, channelId: conn.channel_id, attachments: reg.items });
    // suggestions (WITH evidence) for every song that still needs a source; the title+date candidates are then checked for a stored file. Ambiguity is flagged, never resolved.
    const liveIds = new Set((uploads || []).map((u) => u.id)); const byPkg = new Map((pk || []).map((p) => [String(p.id), p])); const sugOf = new Map(); const claims = new Map();
    for (const song of rec.needSource) { const u = rec.uploadsById.get(song.youtubeVideoId); const list = srvfSourceSuggestions({ title: (u && u.title) || song.title, publishedAt: (u && u.publishedAt) || song.publishedAt }, pk || [], { taskArtists, liveIds }); const ok = [];
      for (const sg of list) { let src = sg.sourceUrl, bytes = null; if (!src && typeof deps.findStoredLong === 'function') { try { const f = await deps.findStoredLong(sg.pkgId); if (f) { src = f.url; bytes = f.size || null; } } catch (_) { src = null; } } if (!src) continue; ok.push({ ...sg, sourceUrl: src, sourceBytes: bytes }); }
      sugOf.set(song.youtubeVideoId, ok); for (const sg of ok) claims.set(sg.pkgId, (claims.get(sg.pkgId) || 0) + 1); }
    // AUTOMATIC registration (future production): a published song whose package merely lacks the YouTube id is linked by itself ONLY when everything is explicit — one unambiguous package, its RECORDED length within tolerance of YouTube's,
    // an explicit artist (package / mood / task), a source file — and never for a package marked test. Recorded as kind "auto" in the registry.
    let addedAuto = false; for (const song of rec.needSource) { const sgs = sugOf.get(song.youtubeVideoId) || []; if (sgs.length !== 1) continue; const sg = sgs[0]; if (sg.fuzzy || claims.get(sg.pkgId) !== 1 || !sg.artist || sg.markedTest || !sg.recordedSec || Math.abs(sg.recordedSec - song.durationSec) > SRVF_ATTACH_TOLERANCE_SEC) continue;
      try { const r = await sourcesOp((items) => { if (items[song.youtubeVideoId]) return { ok: true }; if (Object.values(items).some((x) => x && x.packageId === sg.pkgId)) return { ok: true }; items[song.youtubeVideoId] = { youtubeVideoId: song.youtubeVideoId, kind: 'auto', title: sg.title, sourceUrl: sg.sourceUrl, packageId: sg.pkgId, artist: sg.artist, artistBasis: 'package_record', measuredSec: sg.recordedSec, youtubeSec: song.durationSec, attachedBy: 'auto', attachedAt: now() }; reg.items[song.youtubeVideoId] = items[song.youtubeVideoId]; return { ok: true, added: true }; }); if (r.added) { addedAuto = true; sugOf.delete(song.youtubeVideoId); } } catch (_) { /* next catalog read retries */ } }
    if (addedAuto) rec = srvfCatalogReconcile({ uploads, discovery: discovery.ok ? discovery : { complete: false }, packages: pk || [], taskArtists, accepts, channelId: conn.channel_id, attachments: reg.items });
    const complete = !!(discovery.ok && discovery.complete);
    await ledgerOp((entries) => { entries.push({ id: 'catalog_' + deps.newId(), kind: 'catalog', at: syncedAt, by, relaxed: !!config.allowNonPublicSources, counts: rec.counts, packages: (pk || []).length, discovery, youtube: rec.youtube, mmmos: rec.mmmos, exclusions: rec.exclusions, artistGaps: rec.artistGaps.length, attached: rec.mmmos.attached, needSource: rec.needSource.length, suggested: [...sugOf.values()].filter((x) => x.length).length, recoverable: [...sugOf.values()].filter((x) => x.length === 1).length }); const cs = entries.filter((x) => x.kind === 'catalog'); if (cs.length > 3) cs.slice(0, cs.length - 3).forEach((x) => entries.splice(entries.indexOf(x), 1)); return { ok: true }; });
    return { status: 200, json: { ok: true, complete, acceptsPrivacy: accepts, relaxed: !!config.allowNonPublicSources, discovery, youtube: rec.youtube, mmmos: rec.mmmos, counts: rec.counts, exclusions: rec.exclusions, artistGaps: rec.artistGaps, songs: rec.songs.map((c) => ({ pkgId: c.pkgId, artist: c.artist, artistSource: c.artistSource || '', artistSuggestion: c.artistSuggestion || null, artistEvidence: c.artistEvidence || null, mood: c.mood, title: c.title, eligible: c.eligible, reason: c.reason, durationSec: c.durationSec, durationSource: c.durationSource, youtubeVideoId: c.youtubeVideoId, inMmmos: !!c.inMmmos, unverified: !!c.unverified, publishedAt: c.publishedAt || null, ...(c.attached ? { attached: true, attachedBy: c.attachedBy, attachedAt: c.attachedAt, attachKind: c.attachKind, sourceUrl: c.sourceUrl, finglish: c.finglish, finglishAuto: c.finglishAuto, packageId: c.attachedPackageId } : {}), ...(c.reason === 'not_in_mmmos' ? { suggestions: (sugOf.get(c.youtubeVideoId) || []).map((g) => ({ pkgId: g.pkgId, title: g.title, generatedAt: g.generatedAt, lagDays: g.lagDays, deadYoutubeId: g.deadYoutubeId, artist: g.artist, artistSource: g.artistSource, artistSuggestion: g.artistSuggestion, sourceUrl: g.sourceUrl, recordedSec: g.recordedSec, markedTest: g.markedTest, unique: (sugOf.get(c.youtubeVideoId) || []).length === 1 && claims.get(g.pkgId) === 1 && !g.fuzzy, fuzzy: !!g.fuzzy })) } : {}) })) } };
  }

  // ── source attachment: link ORIGINAL AUDIO that already lives in MMMOS storage (or a newly uploaded original) to an existing PUBLISHED YouTube song ──
  // Isolated by design: nothing is written to the packages table, no package is created, the published video is never touched (read-only YouTube calls). One registry row (srv_farsi_mix_sources), compare-and-set, every entry carries who/when/evidence.
  if (op === 'source_upload_url') {
    const id = String(body.youtubeVideoId || ''); if (!VID.test(id)) return fail(400, 'video_id_invalid'); const name = String(body.filename || ''); const ext = (/\.([A-Za-z0-9]{2,4})$/.exec(name) || [])[1]; const size = Number(body.size);
    const SRC_TYPES = { mp3: 'audio/mpeg', webm: 'video/webm', mp4: 'video/mp4' };   // exactly what the srv-assets bucket accepts (live check 2026-11-15: audio/mp4, audio/wav, audio/x-m4a and application/octet-stream are refused with HTTP 415)
    if (!ext || !Object.prototype.hasOwnProperty.call(SRC_TYPES, ext.toLowerCase())) return fail(400, 'source_file_type_not_allowed'); if (!Number.isFinite(size) || size < 100 * 1024 || size > 80 * 1024 * 1024) return fail(400, 'source_file_size_not_allowed');
    if (typeof deps.createSourceUpload !== 'function') return fail(501, 'source_upload_not_available'); const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel');
    const path = `srv-farsi-sources/${id}/${deps.now()}_${deps.newId().replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}.${ext.toLowerCase()}`;
    let up; try { up = await deps.createSourceUpload(path); } catch (e) { return fail(502, 'source_upload_failed', { detail: String((e && e.message) || e).slice(0, 120) }); }
    return { status: 200, json: { ok: true, uploadUrl: up.uploadUrl, publicUrl: up.publicUrl, path, contentType: SRC_TYPES[ext.toLowerCase()], maxBytes: 80 * 1024 * 1024 } };
  }

  if (op === 'source_attach') {
    const id = String(body.youtubeVideoId || ''); if (!VID.test(id)) return fail(400, 'video_id_invalid'); const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel'); const yt = await deps.ytFor(conn, config.credentialSource);
    const url = String(body.sourceUrl || ''); const base = String(deps.sourceBaseUrl || ''); if (!base || !url.startsWith(base) || /[?#]|\.\./.test(url.slice(base.length)) || url.length > 400 || /youtube\.com|youtu\.be|googlevideo/i.test(url)) return fail(400, 'source_url_not_allowed');
    let info; try { info = (await yt.videosInfo([id]))[id]; } catch (e) { return fail(502, 'status_failed', { detail: String((e && e.message) || e).replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>').slice(0, 120) }); }
    if (!info) return fail(409, 'video_not_found_on_channel'); if (info.channelId !== conn.channel_id) return fail(409, 'video_on_another_channel'); if (accepts().indexOf(info.privacyStatus) < 0) return fail(409, 'not_public_on_youtube'); if (!(info.durationSec >= 120)) return fail(409, 'too_short');
    const measured = Number(body.measuredSec); if (!(measured > 0) || Math.abs(measured - info.durationSec) > SRVF_ATTACH_TOLERANCE_SEC) return fail(409, 'source_duration_mismatch', { youtubeSec: info.durationSec, measuredSec: Number.isFinite(measured) ? measured : null });
    let pk; try { pk = await deps.listFarsiPackages(); } catch (_) { return fail(502, 'catalog_load_failed'); }
    const linked = (pk || []).find((p) => pkgYtIds(p).includes(id)); if (linked) return fail(409, 'already_in_mmmos', { packageId: String(linked.id) });                                                      // never a duplicate of an existing package
    let pkg = null; const pid = String(body.packageId || '');
    if (pid) { pkg = (pk || []).find((p) => String(p.id) === pid); if (!pkg || pkg.engine !== 'SRV Farsi' || pkg.farsiMix || (pkg.srvShortOf && pkg.srvShortOf.longPkgId) || pkg.contentType === 'Short' || pkg.contentFormat === 'short') return fail(409, 'package_not_usable');
      for (const old of pkgYtIds(pkg)) { let o = null; try { o = (await yt.videosInfo([old]))[old]; } catch (_) { o = null; } if (o && o.channelId === conn.channel_id) return fail(409, 'package_linked_to_a_live_video', { youtubeVideoId: old }); } }
    let taskArtists = null; try { taskArtists = typeof deps.listTaskArtists === 'function' ? await deps.listTaskArtists() : null; } catch (_) { taskArtists = null; }
    let explicit = ''; if (pkg) { const sug = srvfMixCandidates([pkg], { taskArtists })[0]; explicit = sug ? sug.artist : ''; }
    const artist = String(body.artist || ''); if (!['female', 'male', 'duet'].includes(artist)) return fail(400, 'artist_invalid'); if (explicit && explicit !== artist) return fail(409, 'artist_conflict', { recorded: explicit });
    if (!explicit && body.confirmArtist !== true) return fail(400, 'artist_confirmation_required');
    let chk; try { chk = await deps.checkSource(url); } catch (_) { chk = null; } if (!chk || !chk.ok || !(chk.size >= 100 * 1024)) return fail(409, 'source_file_missing');
    const rec = { youtubeVideoId: id, kind: 'attached', title: String(body.title || '').trim().slice(0, 120) || (pkg ? String(pkg.title || '').trim() : '') || srvfSongTitleFromYoutube(info.title), sourceUrl: url, sourceBytes: chk.size, packageId: pkg ? String(pkg.id) : null, artist, artistBasis: explicit ? 'package_record' : 'operator_confirmed', measuredSec: Math.round(measured * 10) / 10, youtubeSec: info.durationSec, attachedBy: by, attachedAt: now() };
    const res = await sourcesOp((items) => {
      const dupPkg = rec.packageId && Object.values(items).find((x) => x && x.packageId === rec.packageId && x.youtubeVideoId !== id); if (dupPkg) return { error: 'package_already_attached_elsewhere' };
      const cur = items[id]; if (cur && body.replace !== true) { if (cur.sourceUrl === url && cur.artist === artist) return { ok: true, already: true, rec: cur }; return { error: 'already_attached' }; }
      items[id] = rec; return { ok: true, rec };
    });
    if (res.error) return fail(409, res.error); return { status: 200, json: { ok: true, already: !!res.already, attachment: res.rec } };
  }

  if (op === 'source_remove') {
    const id = String(body.youtubeVideoId || ''); if (!VID.test(id)) return fail(400, 'video_id_invalid');
    const res = await sourcesOp((items) => { if (!items[id]) return { error: 'not_attached' }; const was = items[id]; delete items[id]; return { ok: true, removed: was }; }); if (res.error) return fail(res.error === 'not_attached' ? 404 : 409, res.error);
    return { status: 200, json: { ok: true, removed: true } };
  }

  if (op === 'upload_status') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e) return fail(404, 'upload_not_found');
    if (e.status === 'uploaded') return { status: 200, json: { ok: true, done: true, youtubeVideoId: e.youtubeVideoId, offset: e.bytes, total: e.bytes } };
    if (e.status !== 'pending' || !e.session) return fail(409, 'upload_not_resumable', { status: e.status });
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel');
    const yt = await deps.ytFor(conn, config.credentialSource); let st; try { st = await yt.status(deps.unseal(e.session), e.bytes); } catch (err) { return fail(502, 'status_failed', { detail: String(err && err.message).slice(0, 200) }); }
    if (st.expired) { await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) Object.assign(x, { status: 'failed', error: 'session_expired', finishedAt: now() }); return { ok: true }; }); return fail(409, 'session_expired_start_again'); }
    return { status: 200, json: { ok: true, done: !!st.complete, offset: st.complete ? e.bytes : st.offset, total: e.bytes } };
  }

  if (op === 'upload_chunk') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e) return fail(404, 'upload_not_found');
    if (e.status === 'uploaded') return { status: 200, json: { ok: true, done: true, youtubeVideoId: e.youtubeVideoId, offset: e.bytes, total: e.bytes } };
    if (e.status !== 'pending' || !e.session) return fail(409, 'upload_not_resumable', { status: e.status });
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel');
    const yt = await deps.ytFor(conn, config.credentialSource); const session = deps.unseal(e.session);
    let buf; try { buf = Buffer.from(String(body.data || ''), 'base64'); } catch (_) { buf = null; }
    const offset = Number(body.offset);
    if (!buf || !buf.length || !Number.isInteger(offset) || offset < 0) return fail(400, 'chunk_invalid');
    if (buf.length > SRVF_CHUNK_BYTES) return fail(413, 'chunk_too_large', { max: SRVF_CHUNK_BYTES });
    if (offset + buf.length > e.bytes) return fail(400, 'chunk_beyond_file');
    if (buf.length % (256 * 1024) !== 0 && offset + buf.length !== e.bytes) return fail(400, 'chunk_not_aligned');
    let st; try { st = await yt.status(session, e.bytes); } catch (err) { return fail(502, 'status_failed', { detail: String(err && err.message).slice(0, 200) }); }
    if (st.expired) { await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) Object.assign(x, { status: 'failed', error: 'session_expired', finishedAt: now() }); return { ok: true }; }); return fail(409, 'session_expired_start_again'); }
    let result = st.complete ? st : null;
    if (!result) {
      if (st.offset !== offset) return fail(409, 'offset_mismatch', { offset: st.offset });          // the client resumes from YouTube's real position
      try { result = await yt.putChunk(session, buf, offset, e.bytes); } catch (err) { return fail(502, 'chunk_failed_retry', { offset, detail: String(err && err.message).slice(0, 200) }); }
      if (!result.complete) return { status: 200, json: { ok: true, done: false, offset: result.offset, total: e.bytes } };
    }
    const v = result.video || {}; const verified = VID.test(String(v.id || '')) && v.channelId === e.channelId && v.privacyStatus === 'private';
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) Object.assign(x, verified ? { status: 'uploaded', youtubeVideoId: v.id, privacyStatus: v.privacyStatus, uploadedAt: now() } : { status: 'pending', youtubeVideoId: v.id || null, error: 'uploaded_but_unverified_channel_or_privacy' }); return { ok: true }; });
    if (!verified) return fail(502, 'uploaded_but_unverified_channel_or_privacy', { youtubeVideoId: v.id || null });
    return { status: 200, json: { ok: true, done: true, youtubeVideoId: v.id, offset: e.bytes, total: e.bytes, privacyStatus: 'private' } };
  }

  // thumbnail: only the verified upload of this Mix, a real JPEG ≤ 2 MB; a failure never undoes the upload (the VA can retry or set it in YouTube Studio)
  if (op === 'thumbnail') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e || e.status !== 'uploaded' || !VID.test(String(e.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    let buf; try { buf = Buffer.from(String(body.data || ''), 'base64'); } catch (_) { buf = null; }
    if (!buf || !buf.length) return fail(400, 'thumbnail_missing'); if (buf.length > 2 * 1024 * 1024) return fail(413, 'thumbnail_too_large');
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return fail(400, 'thumbnail_not_jpeg');
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel'); const yt = await deps.ytFor(conn, config.credentialSource);
    const vis = (await yt.getVideosStatus([e.youtubeVideoId]))[e.youtubeVideoId]; if (!vis || vis.channelId !== e.channelId) return fail(409, 'video_not_on_srv_farsi_channel');
    let thumbnail; try { await yt.setThumbnail(e.youtubeVideoId, buf); thumbnail = { status: 'set', at: now() }; } catch (err) { thumbnail = { status: 'failed', at: now(), error: String(err && err.message).slice(0, 160) }; }
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) x.thumbnail = thumbnail; return { ok: true }; });
    return thumbnail.status === 'set' ? { status: 200, json: { ok: true, thumbnail } } : fail(502, 'thumbnail_failed_retry', { thumbnail });
  }

  // A Mix goes ONLY to the dedicated "Silk Road Voices Mixes" playlist (exact id, set by the server — never chosen by the request, never a mood playlist). Idempotent: already a member = no second insert.
  const mixTarget = () => { const mp = deps.mixPlaylist; return mp && PLID.test(String(mp.id || '')) ? { id: mp.id, title: String(mp.title || '') } : null; };
  // Adds the video to the Mixes playlist — IDEMPOTENT and CONFIRMED. Order: (1) already a member (by the videoId filter AND a scan of the playlist)? done; (2) an item this correction inserted earlier (its id is kept on the ledger)? still there? done;
  // (3) otherwise insert once, keep the new item id on the ledger at once, then confirm with YouTube — by reading the item back by id and by membership, retrying briefly because YouTube's list reads can lag a moment behind an insert.
  // Never inserts a second time while an earlier item exists. Returns { confirmed, list, diag } where diag.stage says where it stopped: membership | insert | confirm.
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))); const CONFIRM_DELAYS = deps.confirmDelays || [0, 600, 1200, 2000, 3000];
  const addToMixes = async (e, yt) => {
    const mp = mixTarget(); const vid = e.youtubeVideoId; const diag = { stage: 'membership', insertedItemId: null, attempts: 0, confirmedBy: null };
    if (!mp) return { confirmed: false, list: [{ ok: false, key: 'mix', error: 'mix_playlist_not_configured' }], diag };
    const base = { key: 'mix', playlistId: mp.id, playlistName: mp.title };
    let ids = []; try { ids = await yt.playlistMembership(mp.id, vid); } catch (_) { ids = []; }
    if (ids.length) { diag.confirmedBy = 'already_member'; return { confirmed: true, list: [{ ok: true, ...base, alreadyMember: true, playlistItemId: ids[0] }], diag }; }
    if (e.mixItem && e.mixItem.id) { let it = null; try { it = await yt.playlistItemById(e.mixItem.id); } catch (_) { it = null; } if (it && it.playlistId === mp.id && it.videoId === vid) { diag.confirmedBy = 'ledger_item'; return { confirmed: true, list: [{ ok: true, ...base, alreadyMember: true, playlistItemId: it.id, recovered: true }], diag }; } }
    diag.stage = 'insert'; let r; try { r = await deps.addToMixPlaylist(vid, config.credentialSource); } catch (err) { return { confirmed: false, list: [{ ok: false, ...base, error: 'playlist_exception', message: String(err && err.message).slice(0, 160) }], diag }; }
    const first = (r || [])[0]; if (!first || !first.ok || !first.playlistItemId) return { confirmed: false, list: [{ ok: false, ...base, error: (first && first.error) || 'playlist_add_failed', ...(first && first.detail ? { detail: first.detail } : {}) }], diag };
    diag.insertedItemId = first.playlistItemId; await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) x.mixItem = { id: first.playlistItemId, at: now() }; return { ok: true }; });
    diag.stage = 'confirm';
    for (const d of CONFIRM_DELAYS) {
      if (d) await sleep(d); diag.attempts++;
      try { const it = await yt.playlistItemById(first.playlistItemId); if (it && it.playlistId === mp.id && it.videoId === vid) { diag.confirmedBy = 'item_by_id'; break; } } catch (_) { /* try the list route */ }
      try { const m = await yt.playlistMembership(mp.id, vid); if (m.length) { diag.confirmedBy = 'list'; break; } } catch (_) { /* retry */ }
    }
    if (!diag.confirmedBy) return { confirmed: false, list: [{ ok: false, ...base, error: 'mixes_membership_not_confirmed', playlistItemId: first.playlistItemId }], diag };
    return { confirmed: true, list: [{ ok: true, ...base, playlistItemId: first.playlistItemId, confirmedBy: diag.confirmedBy }], diag };
  };
  // One fresh read of everything from the YouTube API (never cached) -> stored on the ledger entry with the time it was taken.
  const runVerify = async (e, yt) => {
    const pkg = await deps.getMixPackage(e.packageId); const fm = (pkg && pkg.farsiMix) || {}; const ap = fm.approved || {}; const mp = mixTarget();
    const video = await yt.videoDetails(e.youtubeVideoId); let inMixes = false, individual = [];
    let mixIds = []; if (mp) { mixIds = await yt.playlistMembership(mp.id, e.youtubeVideoId); inMixes = mixIds.length > 0; }
    const indiv = typeof deps.individualPlaylistIds === 'function' ? deps.individualPlaylistIds().filter((id) => mp ? id !== mp.id : true) : [];
    for (const id of indiv) { try { if ((await yt.playlistMembership(id, e.youtubeVideoId)).length) individual.push(id); } catch (_) { /* unreadable = not claimed as absent */ individual.push(id + ' (unreadable)'); } }
    const res = srvfVerifyChecks({ video, playlist: inMixes, individual, exp: { channelId: e.channelId, title: ap.title, description: ap.description, tags: ap.tags || [], bytes: e.bytes, durationSec: e.durationSec || (fm.build && fm.build.durationSec), thumbnailStatus: (e.thumbnail && e.thumbnail.status) || null, playlistId: mp ? mp.id : null, playlistItemIds: mixIds } });
    const verification = { at: now(), checkedAtMs: deps.now(), by, source: 'youtube_api_live', overall: res.overall, integrityOk: !!res.integrityOk, pending: res.pending, processing: srvfProcessingInfo(video), checks: res.checks };
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) x.verification = verification; return { ok: true }; });
    return verification;
  };
  if (op === 'playlist') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e || e.status !== 'uploaded' || !VID.test(String(e.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel'); const yt = await deps.ytFor(conn, config.credentialSource);
    const res = await addToMixes(e, yt); const playlists = res.list;
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) x.playlists = playlists; return { ok: true }; });
    return { status: 200, json: { ok: true, playlists } };
  }

  // Correct an existing upload's playlist membership: (1) the target playlist must exist on the pinned channel with this exact id AND title, (2) add the video to it unless it is already a member (idempotent — see addToMixes),
  // (3) CONFIRM the membership with YouTube, (4) only then remove the video from the individual-song playlists (approved ids only) and drop any duplicate Mixes item. Never touches the video, its privacy or metadata; safe to repeat.
  // Every attempt is written to the ledger entry (stage, inserted item id, attempts) so a failure can be diagnosed afterwards without a session.
  if (op === 'playlist_fix') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e || e.status !== 'uploaded' || !VID.test(String(e.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    const mp = mixTarget(); if (!mp) return fail(500, 'mix_playlist_not_configured');
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel'); const yt = await deps.ytFor(conn, config.credentialSource);
    const note = (extra) => ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) { x.playlistFixAttempts = [...(x.playlistFixAttempts || []), { at: now(), by, ...extra }].slice(-5); } return { ok: true }; });
    let list; try { list = await yt.listPlaylists(); } catch (err) { await note({ outcome: 'playlist_list_failed' }); return fail(502, 'playlist_list_failed', { detail: String(err && err.message).slice(0, 120) }); }
    const hit = list.find((p) => p.id === mp.id); if (!hit) { await note({ outcome: 'mixes_playlist_not_on_channel' }); return fail(409, 'mixes_playlist_not_on_channel'); }
    if (hit.title !== mp.title) { await note({ outcome: 'mixes_playlist_title_mismatch' }); return fail(409, 'mixes_playlist_title_mismatch', { found: String(hit.title).slice(0, 80) }); }
    const fresh = await loadEntry(e.id, e.mixKey); const res = await addToMixes(fresh || e, yt);
    if (!res.confirmed) { const code = res.diag.stage === 'confirm' ? 'mixes_membership_not_confirmed' : 'mixes_add_failed'; await note({ outcome: code, stage: res.diag.stage, insertedItemId: res.diag.insertedItemId, attempts: res.diag.attempts }); return fail(502, code, { stage: res.diag.stage, insertedItemId: res.diag.insertedItemId, attempts: res.diag.attempts, playlists: res.list }); }
    // duplicates in Mixes (e.g. from an earlier retry) — keep one, delete the rest (this video only, Mixes only)
    const removedDup = []; let mixIds = []; try { mixIds = await yt.playlistMembership(mp.id, e.youtubeVideoId); } catch (_) { mixIds = []; }
    const keep = res.list[0].playlistItemId && mixIds.includes(res.list[0].playlistItemId) ? res.list[0].playlistItemId : mixIds[0]; for (const id of mixIds) { if (id === keep) continue; try { await yt.deletePlaylistItem(id); removedDup.push(id); } catch (_) { /* reported by the next verification */ } }
    const removed = [], failedRemovals = []; const indiv = typeof deps.individualPlaylistIds === 'function' ? deps.individualPlaylistIds().filter((id) => PLID.test(id) && id !== mp.id) : [];
    for (const plId of indiv) {
      let ids = []; try { ids = await yt.playlistMembership(plId, e.youtubeVideoId); } catch (err) { failedRemovals.push({ playlistId: plId, error: 'lookup_failed' }); continue; }
      for (const itemId of ids) { try { await yt.deletePlaylistItem(itemId); removed.push({ playlistId: plId, playlistItemId: itemId }); } catch (err) { failedRemovals.push({ playlistId: plId, playlistItemId: itemId, error: 'delete_failed' }); } }
    }
    const playlists = [{ ok: true, key: 'mix', playlistId: mp.id, playlistName: mp.title, alreadyMember: !!res.list[0].alreadyMember, ...(keep ? { playlistItemId: keep } : {}), confirmedBy: res.diag.confirmedBy }];
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) { x.playlists = playlists; x.playlistFix = { at: now(), by, confirmedIn: mp.id, confirmedBy: res.diag.confirmedBy, removed, failedRemovals, removedDuplicates: removedDup }; } return { ok: true }; });
    await note({ outcome: 'fixed', stage: res.diag.stage, confirmedBy: res.diag.confirmedBy, insertedItemId: res.diag.insertedItemId, attempts: res.diag.attempts, removed: removed.length });
    const verification = await runVerify(e, yt);
    return { status: 200, json: { ok: true, playlists, removed, removedDuplicates: removedDup, failedRemovals, verification } };
  }

  if (op === 'video_status') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e || !VID.test(String(e.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel');
    const vis = (await (await deps.ytFor(conn, config.credentialSource)).getVideosStatus([e.youtubeVideoId]))[e.youtubeVideoId] || null;
    return { status: 200, json: { ok: true, youtubeVideoId: e.youtubeVideoId, onYouTube: !!vis, privacyStatus: vis ? vis.privacyStatus : null, channelMatches: !!vis && vis.channelId === e.channelId } };
  }

  if (op === 'verify') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e || e.status !== 'uploaded' || !VID.test(String(e.youtubeVideoId || ''))) return fail(404, 'mix_not_uploaded');
    const conn = await channel(); if (!conn) return fail(409, 'wrong_or_missing_channel'); const yt = await deps.ytFor(conn, config.credentialSource);
    let verification; try { verification = await runVerify(e, yt); } catch (err) { return fail(502, 'verify_failed', { detail: String((err && err.message) || err).replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>').slice(0, 160) }); }
    return { status: 200, json: { ok: true, verification, youtubeVideoId: e.youtubeVideoId, packageId: e.packageId } };
  }

  if (op === 'abort') {
    const e = await loadEntry(String(body.entryId || ''), String(body.mixKey || '')); if (!e) return fail(404, 'upload_not_found'); if (e.status === 'uploaded') return fail(409, 'already_uploaded');
    await ledgerOp((entries) => { const x = entries.find((y) => y.id === e.id); if (x) Object.assign(x, { status: 'aborted', finishedAt: now(), session: null }); return { ok: true }; });
    return { status: 200, json: { ok: true, aborted: true } };
  }
  return fail(400, 'unknown_op');
}
export { srvfMixDescription };

// YouTube API reads used by the verification (owner-only parts need the connection's own token). Added to the shared mix adapter by api/ops.js; the tests use the same code against the in-memory YouTube.
export function srvfVerifyAdapter(token, fetchImpl = fetch) {
  const auth = { Authorization: 'Bearer ' + token };
  return {
    async myChannelIds() { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: auth }); if (!r.ok) throw new Error('channels.list HTTP ' + r.status); return ((await r.json()).items || []).map((x) => x.id); },
    async videoDetails(id) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/videos?part=snippet,status,fileDetails,processingDetails,contentDetails&id=' + encodeURIComponent(id), { headers: auth }); if (!r.ok) throw new Error('videos.list HTTP ' + r.status); return ((await r.json()).items || [])[0] || null; },
    // Authoritative facts about videos from YouTube itself (owner token): visibility, owning channel, length. Batches of 50.
    async videosInfo(ids) { const out = {}; for (let i = 0; i < ids.length; i += 50) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=' + ids.slice(i, i + 50).map(encodeURIComponent).join(',') + '&maxResults=50', { headers: auth }); if (!r.ok) throw new Error('videos.list HTTP ' + r.status); for (const v of (await r.json()).items || []) out[v.id] = { privacyStatus: v.status && v.status.privacyStatus, channelId: v.snippet && v.snippet.channelId, durationSec: srvfParseIsoDuration(v.contentDetails && v.contentDetails.duration), title: v.snippet && v.snippet.title, publishedAt: v.snippet && v.snippet.publishedAt }; } return out; },
    // Official channel discovery: the channel's uploads playlist (every upload, newest first), read page by page (50 per page). `complete:false` whenever a page failed or the page cap was hit — never silently partial.
    async uploadsPlaylistId() { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', { headers: auth }); if (!r.ok) throw new Error('channels.list HTTP ' + r.status); const it = ((await r.json()).items || [])[0]; const id = it && it.contentDetails && it.contentDetails.relatedPlaylists && it.contentDetails.relatedPlaylists.uploads; if (!id) throw new Error('uploads playlist not reported'); return id; },
    async listUploadIds(playlistId, maxPages = 60) { const ids = []; let tok = '', pages = 0, complete = false, error = ''; for (let i = 0; i < maxPages; i++) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=' + encodeURIComponent(playlistId) + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: auth }); if (!r.ok) { error = 'page ' + (i + 1) + ': HTTP ' + r.status; break; } const d = await r.json(); pages++; for (const x of d.items || []) { const v = x.contentDetails && x.contentDetails.videoId; if (v && !ids.includes(v)) ids.push(v); } if (!d.nextPageToken) { complete = true; break; } tok = d.nextPageToken; } if (!complete && !error) error = 'more than ' + maxPages + ' pages — stopped before the end'; return { ids, pages, complete, error }; },
    // Membership by BOTH routes — the videoId filter and a scan of the whole playlist — so one lagging read cannot hide an existing item (and cause a duplicate insert).
    async playlistMembership(playlistId, videoId) {
      const ids = new Set(); const f = await fetchImpl('https://www.googleapis.com/youtube/v3/playlistItems?part=id&maxResults=50&playlistId=' + encodeURIComponent(playlistId) + '&videoId=' + encodeURIComponent(videoId), { headers: auth }); if (!f.ok) throw new Error('playlistItems.list HTTP ' + f.status); for (const x of (await f.json()).items || []) ids.add(x.id);
      let tok = ''; for (let i = 0; i < 20; i++) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' + encodeURIComponent(playlistId) + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: auth }); if (!r.ok) break; const d = await r.json(); for (const x of d.items || []) if (x.snippet && x.snippet.resourceId && x.snippet.resourceId.videoId === videoId) ids.add(x.id); if (!d.nextPageToken) break; tok = d.nextPageToken; }
      return [...ids];
    },
    async playlistItemById(itemId) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&id=' + encodeURIComponent(itemId), { headers: auth }); if (!r.ok) return null; const it = ((await r.json()).items || [])[0]; return it ? { id: it.id, playlistId: it.snippet && it.snippet.playlistId, videoId: it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId } : null; },
    async listPlaylists() { const all = []; let tok = ''; for (let i = 0; i < 10; i++) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: auth }); if (!r.ok) throw new Error('playlists.list HTTP ' + r.status); const d = await r.json(); (d.items || []).forEach((p) => all.push({ id: p.id, title: p.snippet && p.snippet.title })); if (!d.nextPageToken) break; tok = d.nextPageToken; } return all; },
    async playlistItemIds(playlistId, videoId) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/playlistItems?part=id&maxResults=50&playlistId=' + encodeURIComponent(playlistId) + '&videoId=' + encodeURIComponent(videoId), { headers: auth }); if (!r.ok) throw new Error('playlistItems.list HTTP ' + r.status); return ((await r.json()).items || []).map((x) => x.id); },
    async deletePlaylistItem(itemId) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/playlistItems?id=' + encodeURIComponent(itemId), { method: 'DELETE', headers: auth }); if (!(r.status === 204 || r.ok)) throw new Error('playlistItems.delete HTTP ' + r.status); return true; },
    async playlistHas(playlistId, videoId) { const r = await fetchImpl('https://www.googleapis.com/youtube/v3/playlistItems?part=id&maxResults=1&playlistId=' + encodeURIComponent(playlistId) + '&videoId=' + encodeURIComponent(videoId), { headers: auth }); if (!r.ok) throw new Error('playlistItems.list HTTP ' + r.status); return ((await r.json()).items || []).length > 0; },
  };
}
