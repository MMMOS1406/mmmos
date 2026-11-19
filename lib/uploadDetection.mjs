// Upload detection (R-C1 release A) — PURE helpers for the server's `youtube_sync_performance` action. No network, no database, no clock except values passed in.
// Replaces the per-minute `search.list` (own 100-call/day quota, 66% of calls refused over 30 days, failures swallowed) with the channel's UPLOADS PLAYLIST
// (`playlistItems.list`, 1 unit from the 10,000/day pool, no 100/day cap) + one batched `videos.list` (1 unit).
// Isolation rules (tested): channels come from the existing business records (youtube_channels.mmm_engine of the two retained businesses), never from the client;
// a video is only ever matched to packages of the SAME business engine; a playlist item whose channel id differs from the configured channel is dropped.
export const DETECTION_ENGINES = Object.freeze(['SRV Farsi', 'SRV English']);          // the two retained businesses; retired engines are never polled
export const DETECTION_DEFAULTS = Object.freeze({ throttleMs: 180000, warnEveryMs: 3600000, maxResults: 10, overlap: 0.7 });
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

// The uploads playlist id of a channel is its channel id with the "UC" prefix replaced by "UU". Returns null for anything that is not a channel id.
export function uploadsPlaylistId(channelId) { return CHANNEL_RE.test(String(channelId || '')) ? 'UU' + String(channelId).slice(2) : null; }

// Same title normalisation the existing detector used (keeps Persian/Arabic letters U+0600–U+06FF).
export function normalizeTitle(str) {
  if (!str) return [];
  return String(str).toLowerCase().replace(/[^\w\s؀-ۿ]/g, '').trim().split(/\s+/).filter((t) => t.length > 1);
}
// Same matching rule as before: best package with >= 70% token overlap. `packages` must already be restricted to the video's business.
export function bestPackageMatch(videoTitle, packages, overlap = DETECTION_DEFAULTS.overlap) {
  const vt = normalizeTitle(videoTitle); if (!vt.length) return null;
  let best = null, bestOverlap = 0;
  for (const pkg of packages || []) {
    const pt = normalizeTitle(pkg && pkg.title); if (!pt.length) continue;
    const shared = vt.filter((t) => pt.includes(t)).length, ov = shared / Math.max(vt.length, pt.length);
    if (ov >= overlap && ov > bestOverlap) { bestOverlap = ov; best = pkg; }
  }
  return best;
}
// Business isolation for matching: only packages whose engine equals the channel's engine (trimmed, case-insensitive). Packages with an empty or other engine are excluded.
export function packagesForEngine(packages, engine) {
  const e = String(engine || '').trim().toLowerCase(); if (!e) return [];
  return (packages || []).filter((p) => p && String(p.engine || '').trim().toLowerCase() === e);
}
// Channel configuration from the existing business records: only rows whose mmm_engine is one of the two retained businesses and whose id is a valid channel id.
export function selectChannels(channelRows, engines = DETECTION_ENGINES) {
  const seen = new Set(), out = [];
  for (const r of channelRows || []) {
    if (!r || !engines.includes(r.mmm_engine) || !CHANNEL_RE.test(String(r.channel_id || '')) || seen.has(r.channel_id)) continue;
    seen.add(r.channel_id); out.push({ channelId: r.channel_id, engine: r.mmm_engine, title: r.title || null });
  }
  return out;
}
// Map a Google error response to a visible status (never swallowed).
export function classifyError(status, json) {
  const reason = json && json.error && ((json.error.errors && json.error.errors[0] && json.error.errors[0].reason) || json.error.status) || null;
  const msg = String(json && json.error && json.error.message || '');
  if (status === 429 || (status === 403 && /quota|ratelimit|dailylimit/i.test(String(reason) + ' ' + msg))) return { status: 'quota_exceeded', reason: reason || 'rateLimitExceeded' };
  if (status === 404 || /playlistNotFound|notFound/i.test(String(reason))) return { status: 'not_found', reason: reason || 'notFound' };
  if (status === 403 || status === 401) return { status: 'forbidden', reason: reason || 'forbidden' };
  if (status === 400) return { status: 'bad_request', reason: reason || 'badRequest' };
  return { status: 'error', reason: reason || ('http_' + status) };
}
// Throttle + single-flight per key (per server instance; best effort). `now` is epoch ms.
export function createThrottle({ ttlMs = DETECTION_DEFAULTS.throttleMs } = {}) {
  const last = new Map(), busy = new Set();
  return {
    begin(key, now) { if (busy.has(key)) return { ok: false, reason: 'in_progress' }; const l = last.get(key); if (l !== undefined && now - l < ttlMs) return { ok: false, reason: 'throttled', retryAfterMs: ttlMs - (now - l) }; busy.add(key); return { ok: true }; },
    end(key, now, succeeded) { busy.delete(key); if (succeeded) last.set(key, now); },   // only a successful run starts the quiet period; a failed one may be retried on the next poll
  };
}
// Log a given (key, status) at most once per interval.
export function createWarnLimiter({ everyMs = DETECTION_DEFAULTS.warnEveryMs } = {}) {
  const at = new Map(); return (key, now) => { const l = at.get(key); if (l !== undefined && now - l < everyMs) return false; at.set(key, now); return true; };
}

// One channel: uploads playlist (1 unit) + batched stats (1 unit). `fetchImpl(url)` -> { status, json }. Returns { status, reason, videos, quotaUnits, uploadsPlaylist }.
// On a "playlist not found" the real uploads playlist id is read once from channels.list (1 unit) and the call retried once.
export async function detectChannel({ channel, fetchJson, apiKey, maxResults = DETECTION_DEFAULTS.maxResults, knownPlaylist = null }) {
  const base = 'https://www.googleapis.com/youtube/v3/';
  let units = 0, playlist = knownPlaylist || uploadsPlaylistId(channel.channelId);
  if (!playlist) return { status: 'bad_request', reason: 'invalid_channel_id', videos: [], quotaUnits: 0, uploadsPlaylist: null };
  const items = async (pl) => { units++; return fetchJson(`${base}playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(pl)}&maxResults=${maxResults}&key=${encodeURIComponent(apiKey)}`); };
  let r = await items(playlist);
  if (r.status === 404 || (r.json && r.json.error && /playlistNotFound/i.test(JSON.stringify(r.json.error)))) {
    units++; const c = await fetchJson(`${base}channels?part=contentDetails&id=${encodeURIComponent(channel.channelId)}&key=${encodeURIComponent(apiKey)}`);
    const real = c.json && c.json.items && c.json.items[0] && c.json.items[0].contentDetails && c.json.items[0].contentDetails.relatedPlaylists && c.json.items[0].contentDetails.relatedPlaylists.uploads;
    if (c.status >= 200 && c.status < 300 && real && real !== playlist) { playlist = real; r = await items(playlist); }
  }
  if (!(r.status >= 200 && r.status < 300)) { const e = classifyError(r.status, r.json); return { status: e.status, reason: e.reason, videos: [], quotaUnits: units, uploadsPlaylist: playlist }; }
  const raw = (r.json && r.json.items) || [];
  const ids = [], mismatched = []; 
  for (const it of raw) {
    const vid = it && it.contentDetails && it.contentDetails.videoId; const owner = it && it.snippet && it.snippet.channelId;
    if (!vid) continue;
    if (owner && owner !== channel.channelId) { mismatched.push(vid); continue; }       // never process a video the configured channel does not own
    ids.push(vid);
  }
  if (!ids.length) return { status: mismatched.length ? 'channel_mismatch' : 'ok', reason: null, videos: [], mismatched: mismatched.length, quotaUnits: units, uploadsPlaylist: playlist };
  units++; const v = await fetchJson(`${base}videos?part=statistics,snippet&id=${ids.map(encodeURIComponent).join(',')}&key=${encodeURIComponent(apiKey)}`);
  if (!(v.status >= 200 && v.status < 300)) { const e = classifyError(v.status, v.json); return { status: e.status, reason: e.reason, videos: [], quotaUnits: units, uploadsPlaylist: playlist }; }
  const videos = ((v.json && v.json.items) || []).filter((x) => x && x.snippet && x.statistics && (!x.snippet.channelId || x.snippet.channelId === channel.channelId));
  return { status: mismatched.length ? 'ok_with_mismatch' : 'ok', reason: null, videos, mismatched: mismatched.length, quotaUnits: units, uploadsPlaylist: playlist };
}
