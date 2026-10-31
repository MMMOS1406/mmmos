// SRV-STUDIO-V2-030 — SRV Studio playlists, related-video / end-screen eligibility, and the playlist sync runner.
// SRV Studio only. Playlists are addressed by their verified IDs (never looked up or created by title), and every
// playlist is checked to belong to the SRV Studio channel before anything is written. Nothing here changes a video's
// visibility, schedules a release, or touches another channel.
//
// Verified 2026-10-24 (public channel page + official playlist feeds, owner UC0nzWQX6AaUqlF5FozNpWPg):
//   Long  → "SRV Studio, the full Collection"   PLXCBPiF9p6SA
//   Short → "SRV Studio Full Short Collection"  PLATi-bbiaU30
//
// YouTube Data API facts this module relies on (official docs, checked 2026-10-24):
//   playlistItems.insert needs the youtube, youtube.force-ssl or youtubepartner scope (youtube.upload is not enough);
//   playlists.list / playlistItems.list / videos.list work with youtube.readonly;
//   there is no API for end screens or for a Short's "Related video" — both are YouTube Studio only.
import { srv2ParseLedger } from './srvStudioV2Pilot.mjs';

export const SRV2_CHANNEL = 'UC0nzWQX6AaUqlF5FozNpWPg';
export const SRV2_PLAYLISTS = Object.freeze({
  long: Object.freeze({ id: 'PLXCBPiF9p6SA', title: 'SRV Studio, the full Collection' }),
  short: Object.freeze({ id: 'PLATi-bbiaU30', title: 'SRV Studio Full Short Collection' }),
});
const VID_RE = /^[A-Za-z0-9_-]{11}$/;
const short = (e) => String((e && (e.code || e.message)) || e).slice(0, 200);

// yt adapter (server: real YouTube Data API calls with the SRV Studio token; tests: an in-memory fake)
//   getPlaylist(id) → { id, snippet:{channelId,title}, status:{privacyStatus} } | null
//   findItem(playlistId, videoId) → { id } | null
//   insertItem(playlistId, videoId) → { id }        (throws { code:'insufficient_scope' } when the token lacks the scope)
//   getVideo(id) → { id, snippet:{channelId,title}, status:{privacyStatus} } | null
export async function srv2CheckPlaylist(yt, kind) {
  const pl = SRV2_PLAYLISTS[kind];
  if (!pl) return { ok: false, error: 'unknown_kind' };
  let p;
  try { p = await yt.getPlaylist(pl.id); } catch (e) { return { ok: false, playlistId: pl.id, error: 'playlist_lookup_failed', detail: short(e) }; }
  if (!p) return { ok: false, playlistId: pl.id, error: 'playlist_not_found' };
  if (!p.snippet || p.snippet.channelId !== SRV2_CHANNEL) return { ok: false, playlistId: pl.id, error: 'playlist_not_srv_studio', channelId: p.snippet && p.snippet.channelId };
  return { ok: true, playlistId: pl.id, title: p.snippet.title || pl.title, privacyStatus: (p.status && p.status.privacyStatus) || null };
}

// Adds the video to its format's playlist once. Membership is read first (no duplicate entries) and re-read after
// an insert, so 'added' and 'already' are both API-verified. A failure never affects the upload itself.
export async function srv2EnsurePlaylist(yt, kind, videoId, now = Date.now()) {
  const at = new Date(now).toISOString();
  if (!VID_RE.test(String(videoId || ''))) return { status: 'failed', error: 'bad_video_id', at };
  const c = await srv2CheckPlaylist(yt, kind);
  if (!c.ok) return { status: 'failed', playlistId: c.playlistId || null, error: c.error, detail: c.detail || null, at };
  try {
    const it = await yt.findItem(c.playlistId, videoId);
    if (it) return { status: 'already', playlistId: c.playlistId, playlistTitle: c.title, itemId: it.id || null, verified: true, at };
  } catch (e) { return { status: 'failed', playlistId: c.playlistId, error: 'membership_check_failed', detail: short(e), at }; }
  try { await yt.insertItem(c.playlistId, videoId); } catch (e) {
    return { status: 'failed', playlistId: c.playlistId, playlistTitle: c.title, error: e && e.code === 'insufficient_scope' ? 'insufficient_scope' : 'insert_failed', detail: short(e), at };
  }
  try {
    const it = await yt.findItem(c.playlistId, videoId);
    if (it) return { status: 'added', playlistId: c.playlistId, playlistTitle: c.title, itemId: it.id || null, verified: true, at };
  } catch (_) { /* fall through */ }
  return { status: 'failed', playlistId: c.playlistId, error: 'not_verified_after_insert', at };
}

// A Short's Related video must be a public or unlisted video from the same channel (YouTube Help 14075157).
export async function srv2RelatedEligibility(yt, longVideoId) {
  if (!VID_RE.test(String(longVideoId || ''))) return { eligible: false, reason: 'no_long_video_id' };
  let v;
  try { v = await yt.getVideo(longVideoId); } catch (e) { return { eligible: false, longVideoId, reason: 'lookup_failed', detail: short(e) }; }
  if (!v) return { eligible: false, longVideoId, reason: 'long_not_found' };
  if (!v.snippet || v.snippet.channelId !== SRV2_CHANNEL) return { eligible: false, longVideoId, reason: 'long_not_srv_studio' };
  const privacy = (v.status && v.status.privacyStatus) || null;
  return { eligible: privacy === 'public' || privacy === 'unlisted', longVideoId, privacyStatus: privacy, reason: privacy === 'public' || privacy === 'unlisted' ? null : 'long_is_private' };
}

// An end-screen Playlist element can show a public or unlisted playlist (YouTube Help 6388789).
export async function srv2EndScreenEligibility(yt) {
  const c = await srv2CheckPlaylist(yt, 'long');
  if (!c.ok) return { eligible: false, playlistId: c.playlistId || SRV2_PLAYLISTS.long.id, reason: c.error };
  return { eligible: c.privacyStatus === 'public' || c.privacyStatus === 'unlisted', playlistId: c.playlistId, playlistTitle: c.title, privacyStatus: c.privacyStatus, reason: c.privacyStatus === 'public' || c.privacyStatus === 'unlisted' ? null : 'playlist_is_private' };
}

// srv_studio_v2_playlist_sync — for a package that production already uploaded: identity (video id, format) comes
// from the production ledger, never from the request. Ensures playlist membership, records the result on the ledger
// entry, and reports Related-video / end-screen eligibility for the VA steps.
//   deps: { flagOn, getSetting, casSetting, getPackage, lookupChannel, yt (adapter or null when no token), now }
export async function srv2RunPlaylistSync(deps, body, { ledgerKey = 'srv_studio_v2_production_ledger' } = {}) {
  const fail = (status, error, extra) => ({ status, json: { ok: false, playlistSync: true, error, ...(extra || {}) } });
  if (!(await deps.flagOn())) return fail(403, 'srv_studio_v2_off');
  const pkgId = String((body && body.pkgId) || '');
  if (!/^pkg_[A-Za-z0-9_]{4,60}$/.test(pkgId)) return fail(400, 'bad_package_id');
  const row = await deps.getSetting(ledgerKey);
  const ledger = srv2ParseLedger(row && row.text);
  if (!ledger) return fail(500, 'ledger_unreadable');
  const entry = ledger.entries.find((e) => e.pkgId === pkgId && e.status === 'uploaded' && VID_RE.test(String(e.youtubeVideoId || '')));
  if (!entry) return fail(404, 'not_uploaded_by_production');
  const conn = await deps.lookupChannel();
  if (!conn || conn.channel_id !== SRV2_CHANNEL) return fail(409, 'wrong_channel', { channelId: conn ? conn.channel_id : null });
  const yt = await deps.yt(conn);
  const playlist = await srv2EnsurePlaylist(yt, entry.kind, entry.youtubeVideoId, deps.now());
  // 031: the video's current visibility (read-only) — lets the checklist confirm the VA's manual public release.
  let visibility = null;
  try { const v = await yt.getVideo(entry.youtubeVideoId); visibility = v ? { privacyStatus: (v.status && v.status.privacyStatus) || null, verified: true, at: new Date(deps.now()).toISOString() } : { privacyStatus: null, reason: 'video_not_found' }; }
  catch (e) { visibility = { privacyStatus: null, reason: 'lookup_failed', detail: short(e) }; }
  let related = null, endScreen = null;
  if (entry.kind === 'short') {
    const p = await deps.getPackage(pkgId);
    const longId = p && p.srvShortOf && p.srvShortOf.longYoutubeVideoId;
    related = { ...(await srv2RelatedEligibility(yt, longId)), longTitle: (p && p.srvShortOf && p.srvShortOf.longTitle) || null };
  } else {
    endScreen = await srv2EndScreenEligibility(yt);
  }
  // record the playlist result on this entry (compare-and-set; the upload fields are never changed)
  let recorded = false;
  for (let attempt = 0; attempt < 8 && !recorded; attempt++) {
    const r = await deps.getSetting(ledgerKey); const l = srv2ParseLedger(r && r.text); if (!l) break;
    const entries = l.entries.map((e) => (e.id === entry.id ? { ...e, playlist } : e));
    if (await deps.casSetting(ledgerKey, r ? r.text : null, JSON.stringify({ rev: l.rev + 1, entries }))) recorded = true;
  }
  return { status: 200, json: { ok: true, playlistSync: true, kind: entry.kind, youtubeVideoId: entry.youtubeVideoId, playlist, related, endScreen, visibility, plannedRelease: entry.plannedRelease || null, recorded } };
}

// The real adapter (used by api/ops.js). token → fetch-based YouTube Data API v3 calls.
export function srv2YouTubeAdapter(token, fetchImpl = fetch) {
  const api = 'https://www.googleapis.com/youtube/v3/';
  const get = async (path) => {
    const r = await fetchImpl(api + path, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('HTTP ' + r.status + ' ' + t.slice(0, 160)); e.code = r.status === 403 && /insufficient/i.test(t) ? 'insufficient_scope' : 'http_' + r.status; throw e; }
    return r.json();
  };
  return {
    getPlaylist: async (id) => ((await get('playlists?part=snippet,status&id=' + encodeURIComponent(id))).items || [])[0] || null,
    findItem: async (pl, vid) => ((await get('playlistItems?part=id&maxResults=5&playlistId=' + encodeURIComponent(pl) + '&videoId=' + encodeURIComponent(vid))).items || [])[0] || null,
    getVideo: async (id) => ((await get('videos?part=snippet,status&id=' + encodeURIComponent(id))).items || [])[0] || null,
    insertItem: async (pl, vid) => {
      const r = await fetchImpl(api + 'playlistItems?part=snippet', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ snippet: { playlistId: pl, resourceId: { kind: 'youtube#video', videoId: vid } } }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('HTTP ' + r.status + ' ' + t.slice(0, 160)); e.code = r.status === 403 && /insufficient/i.test(t) ? 'insufficient_scope' : 'http_' + r.status; throw e; }
      return r.json();
    },
  };
}

// SRV-STUDIO-V2-033 — same rules for a configured playlist ID (the "SRV Studio Mixes" playlist, set after the CEO
// authorises it): ownership checked before writing, membership read first and re-read after (no duplicates).
export async function srv2EnsurePlaylistId(yt, playlistId, videoId, now = Date.now()) {
  const at = new Date(now).toISOString();
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) return { status: 'failed', error: 'bad_video_id', at };
  if (!/^PL[A-Za-z0-9_-]{10,40}$/.test(String(playlistId || ''))) return { status: 'failed', error: 'bad_playlist_id', at };
  let p; try { p = await yt.getPlaylist(playlistId); } catch (e) { return { status: 'failed', playlistId, error: 'playlist_lookup_failed', detail: short(e), at }; }
  if (!p) return { status: 'failed', playlistId, error: 'playlist_not_found', at };
  if (!p.snippet || p.snippet.channelId !== SRV2_CHANNEL) return { status: 'failed', playlistId, error: 'playlist_not_srv_studio', at };
  try { const it = await yt.findItem(playlistId, videoId); if (it) return { status: 'already', playlistId, playlistTitle: p.snippet.title, verified: true, at }; } catch (e) { return { status: 'failed', playlistId, error: 'membership_check_failed', detail: short(e), at }; }
  try { await yt.insertItem(playlistId, videoId); } catch (e) { return { status: 'failed', playlistId, playlistTitle: p.snippet.title, error: e && e.code === 'insufficient_scope' ? 'insufficient_scope' : 'insert_failed', detail: short(e), at }; }
  try { const it = await yt.findItem(playlistId, videoId); if (it) return { status: 'added', playlistId, playlistTitle: p.snippet.title, verified: true, at }; } catch (_) { /* fall through */ }
  return { status: 'failed', playlistId, error: 'not_verified_after_insert', at };
}
