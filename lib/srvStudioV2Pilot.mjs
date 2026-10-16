// SRV Studio V2 — controlled two-video pilot (Checkpoint E3, order SRV-STUDIO-V2-015).
//
// A CEO-approved, time-boxed exception to TEST publishing: exactly two allow-listed SRV English tasks
// (one Long, one Short) may upload to the SRV Studio YouTube channel with their normal V2 titles (no
// "[TEST]" prefix). Everything else about TEST publishing stays: private, never scheduled, no shared
// publishing slot, the SRV English engine stays in "test", packages stay isTest.
//
// The limit is enforced HERE, on the server, against a ledger kept in app_settings and updated with
// compare-and-set writes, so double clicks, two tabs or concurrent requests cannot exceed it.
//
// Configuration (app_settings key `srv_studio_v2_pilot`, JSON text). Absent, unparsable or enabled:false →
// the pilot is OFF and every request is refused. Example:
//   {"enabled":true,"tasks":{"long":"srve_1791661440767_137","short":"srve_1791661404055_131"},
//    "maxUploads":2,"expires":"2026-10-22T18:00:00Z","channelId":"UC0nzWQX6AaUqlF5FozNpWPg"}
// Ledger (app_settings key `srv_studio_v2_pilot_ledger`, JSON text, written only by this module):
//   {"rev":n,"entries":[{id,taskUid,kind,pkgId,status:'pending'|'uploaded'|'failed',claimedAt,uploadedAt,
//     youtubeVideoId,channelId,title,privacyStatus,error}]}
// A 'pending' entry is never released automatically (an upload may have reached YouTube even if the
// request died); it blocks that task and counts toward the limit until an operator resolves it.

export const SRV2_PILOT_KEY = 'srv_studio_v2_pilot';
export const SRV2_PILOT_LEDGER_KEY = 'srv_studio_v2_pilot_ledger';
export const SRV2_PILOT_CHANNEL_ID = 'UC0nzWQX6AaUqlF5FozNpWPg'; // "SRV Studio" (YouTube)
export const SRV2_PILOT_MAX_UPLOADS = 2;
export const SRV2_PILOT_MAX_DAYS = 14; // an authorization can never be open-ended

const UID_RE = /^srve_\d{10,}_\d+$/;

// Validates the configuration row. Returns { config } or { error }.
export function srv2ParsePilotConfig(raw, now = Date.now()) {
  if (raw == null || raw === '') return { error: 'pilot_not_configured' };
  let c; try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { error: 'pilot_config_unreadable' }; }
  if (!c || typeof c !== 'object') return { error: 'pilot_config_unreadable' };
  if (c.enabled !== true) return { error: 'pilot_disabled' };
  const t = c.tasks || {};
  if (!UID_RE.test(String(t.long || '')) || !UID_RE.test(String(t.short || '')) || t.long === t.short || Object.keys(t).length !== 2) return { error: 'pilot_tasks_invalid' };
  if (c.maxUploads !== SRV2_PILOT_MAX_UPLOADS) return { error: 'pilot_max_uploads_invalid' };
  if (c.channelId !== SRV2_PILOT_CHANNEL_ID) return { error: 'pilot_channel_invalid' };
  const exp = Date.parse(c.expires || '');
  if (!isFinite(exp)) return { error: 'pilot_expiry_invalid' };
  if (exp <= now) return { error: 'pilot_expired' };
  if (exp - now > SRV2_PILOT_MAX_DAYS * 86400000) return { error: 'pilot_expiry_too_far' };
  return { config: { enabled: true, tasks: { long: t.long, short: t.short }, maxUploads: SRV2_PILOT_MAX_UPLOADS, expires: new Date(exp).toISOString(), channelId: c.channelId } };
}
export function srv2ParseLedger(raw) {
  if (raw == null || raw === '') return { rev: 0, entries: [] };
  try { const l = JSON.parse(raw); if (l && Array.isArray(l.entries)) return { rev: Number(l.rev) || 0, entries: l.entries }; } catch (_) { /* fall through */ }
  return null; // unreadable ledger → refuse (never guess)
}
// The kind ('long'|'short') a task is authorized for, or null.
export function srv2PilotKindFor(config, taskUid) {
  if (!config) return null;
  if (config.tasks.long === taskUid) return 'long';
  if (config.tasks.short === taskUid) return 'short';
  return null;
}
// Pure decision: may this task claim a pilot upload now?
export function srv2PilotDecide(config, ledger, req) {
  const kind = srv2PilotKindFor(config, req.taskUid);
  if (!kind) return { ok: false, reason: 'task_not_allowlisted' };
  if (req.kind !== kind) return { ok: false, reason: 'format_mismatch' };
  const live = ledger.entries.filter((e) => e.status === 'pending' || e.status === 'uploaded');
  if (live.some((e) => e.taskUid === req.taskUid)) return { ok: false, reason: 'task_already_uploaded_or_in_progress' };
  if (live.length >= config.maxUploads) return { ok: false, reason: 'pilot_limit_reached' };
  return { ok: true, kind };
}
// Request body validation (before anything is claimed).
export function srv2PilotCheckRequest(b, supabaseUrl) {
  const req = b || {};
  if (!UID_RE.test(String(req.taskUid || ''))) return 'bad_task_uid';
  if (req.kind !== 'long' && req.kind !== 'short') return 'bad_kind';
  if (!req.pkgId || !/^[A-Za-z0-9_-]{3,80}$/.test(String(req.pkgId))) return 'bad_package_id';
  const prefix = String(supabaseUrl || '').replace(/\/$/, '') + '/storage/v1/object/public/srv-assets/' + req.pkgId + '/';
  if (!String(req.videoUrl || '').startsWith(prefix) || !/\.(mp4|webm)$/i.test(String(req.videoUrl))) return 'video_not_from_this_package';
  const title = String(req.title || '');
  if (!title.trim() || title.length > 100 || /\[test\]/i.test(title) || /[<>]/.test(title)) return 'bad_title';
  if (String(req.description || '').length > 5000 || /[<>]/.test(String(req.description || ''))) return 'bad_description';
  if (!/ai[\s-]?generated/i.test(String(req.description || ''))) return 'missing_ai_disclosure';
  return null;
}

// Runs one pilot upload. deps:
//   now()                         → ms
//   flagOn()                      → boolean (server-side V2 flag, fail closed)
//   getSetting(key)               → { text } (text null when the row is absent)
//   casSetting(key, oldText, newText) → boolean (true only if the row still held oldText; oldText null = insert)
//   engineState()                 → string (SRV English engine state from shared state)
//   lookupChannel()               → { channel_id } for the "SRV Studio" connection, or null
//   upload(body)                  → { status, json } from the existing youtube_upload_video handler
//   newId()                       → unique string
// Returns { status, json }.
export async function srv2RunPilotUpload(deps, body, { supabaseUrl } = {}) {
  const fail = (status, error, extra) => ({ status, json: { ok: false, pilot: true, error, ...(extra || {}) } });
  if (!(await deps.flagOn())) return fail(403, 'srv_studio_v2_off');
  const cfgRow = await deps.getSetting(SRV2_PILOT_KEY);
  const { config, error } = srv2ParsePilotConfig(cfgRow && cfgRow.text, deps.now());
  if (!config) return fail(403, error);
  const st = await deps.engineState();
  if (st !== 'test') return fail(409, 'engine_not_in_test', { engineState: st });
  const bad = srv2PilotCheckRequest(body, supabaseUrl);
  if (bad) return fail(400, bad);
  const conn = await deps.lookupChannel();
  if (!conn || conn.channel_id !== config.channelId) return fail(409, 'wrong_channel', { channelId: conn ? conn.channel_id : null });

  // 1. claim (compare-and-set; retried on a concurrent write)
  const entryId = deps.newId();
  let claimed = null;
  for (let attempt = 0; attempt < 8 && !claimed; attempt++) {
    const row = await deps.getSetting(SRV2_PILOT_LEDGER_KEY);
    const ledger = srv2ParseLedger(row && row.text);
    if (!ledger) return fail(500, 'pilot_ledger_unreadable');
    const d = srv2PilotDecide(config, ledger, body);
    if (!d.ok) return fail(409, d.reason, { uploads: ledger.entries.filter((e) => e.status === 'uploaded').length });
    const entry = { id: entryId, taskUid: body.taskUid, kind: body.kind, pkgId: body.pkgId, status: 'pending', claimedAt: new Date(deps.now()).toISOString(), title: body.title };
    const next = { rev: ledger.rev + 1, entries: ledger.entries.concat(entry) };
    if (await deps.casSetting(SRV2_PILOT_LEDGER_KEY, row ? row.text : null, JSON.stringify(next))) claimed = entry;
  }
  if (!claimed) return fail(409, 'pilot_busy_try_again');

  // 2. upload through the existing, unchanged youtube_upload_video handler — private, never scheduled
  let up;
  try {
    up = await deps.upload({
      videoUrl: body.videoUrl, engine: 'SRV English', title: body.title, description: body.description,
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 30) : [], categoryId: '10',
      privacyStatus: 'private', publishAt: null, madeForKids: false, containsSyntheticMedia: true,
    });
  } catch (e) { up = { status: 502, json: { ok: false, error: 'upload_exception', message: String(e && e.message) } }; }
  const j = (up && up.json) || {};
  const vid = j.youtubeVideoId || j.videoId || null;
  let outcome;
  if (j.ok && vid && j.channelId === config.channelId && j.privacyStatus === 'private') outcome = { status: 'uploaded', youtubeVideoId: vid, channelId: j.channelId, privacyStatus: j.privacyStatus, uploadedAt: j.uploadedAt || new Date(deps.now()).toISOString() };
  else if (j.ok && vid) outcome = { status: 'pending', youtubeVideoId: vid, channelId: j.channelId || null, privacyStatus: j.privacyStatus || null, error: 'uploaded_but_unverified_channel_or_privacy' }; // keep blocking; operator must check
  else outcome = { status: 'failed', error: String(j.error || 'upload_failed') + (j.message ? ': ' + String(j.message).slice(0, 200) : '') };

  // 3. record the outcome (compare-and-set on the same entry)
  let recorded = false;
  for (let attempt = 0; attempt < 8 && !recorded; attempt++) {
    const row = await deps.getSetting(SRV2_PILOT_LEDGER_KEY);
    const ledger = srv2ParseLedger(row && row.text);
    if (!ledger) break;
    const entries = ledger.entries.map((e) => (e.id === entryId ? { ...e, ...outcome, finishedAt: new Date(deps.now()).toISOString() } : e));
    if (await deps.casSetting(SRV2_PILOT_LEDGER_KEY, row ? row.text : null, JSON.stringify({ rev: ledger.rev + 1, entries }))) recorded = true;
  }
  if (outcome.status === 'uploaded') {
    return { status: 200, json: { ok: true, pilot: true, youtubeVideoId: outcome.youtubeVideoId, videoId: outcome.youtubeVideoId, channelId: outcome.channelId, privacyStatus: outcome.privacyStatus, uploadedAt: outcome.uploadedAt, entryId, recorded, studioUrl: j.studioUrl || null } };
  }
  if (outcome.status === 'pending') return fail(502, outcome.error, { youtubeVideoId: outcome.youtubeVideoId, channelId: outcome.channelId, entryId, recorded });
  return fail(up && up.status >= 400 ? up.status : 502, 'upload_failed', { detail: outcome.error, entryId, recorded });
}
