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
export async function srv2RunPilotUpload(deps, body, opts = {}) {
  return srv2RunAllowanceUpload(deps, body, opts, SRV2_PILOT_SPEC);
}
// The pilot and the VA allowance share one server-enforced runner; only the configuration, the ledger key and the
// decision differ (spec). Each has its own ledger, so neither can consume or reset the other's uploads.
export async function srv2RunAllowanceUpload(deps, body, { supabaseUrl } = {}, spec = SRV2_PILOT_SPEC) {
  const tag = spec.tag;
  const fail = (status, error, extra) => ({ status, json: { ok: false, [tag]: true, error, ...(extra || {}) } });
  if (!(await deps.flagOn())) return fail(403, 'srv_studio_v2_off');
  const cfgRow = await deps.getSetting(spec.configKey);
  const { config, error } = spec.parse(cfgRow && cfgRow.text, deps.now());
  if (!config) return fail(403, error);
  const st = await deps.engineState();
  const okStates = spec.engineStates || ['test'];
  if (!okStates.includes(st)) return fail(409, okStates.length === 1 && okStates[0] === 'test' ? 'engine_not_in_test' : 'engine_not_producing', { engineState: st });
  const bad = srv2PilotCheckRequest(body, supabaseUrl);
  if (bad) return fail(400, bad);
  if (spec.precheck) { const pc = await spec.precheck(deps, body, config); if (pc) return fail(pc.status || 409, pc.error, pc.extra); }
  const conn = await deps.lookupChannel();
  if (!conn || conn.channel_id !== config.channelId) return fail(409, 'wrong_channel', { channelId: conn ? conn.channel_id : null });

  // 1. claim (compare-and-set; retried on a concurrent write)
  const entryId = deps.newId();
  let claimed = null;
  for (let attempt = 0; attempt < 8 && !claimed; attempt++) {
    const row = await deps.getSetting(spec.ledgerKey);
    const ledger = srv2ParseLedger(row && row.text);
    if (!ledger) return fail(500, tag + '_ledger_unreadable');
    const d = spec.decide(config, ledger, body);
    if (!d.ok) return fail(409, d.reason, { uploads: ledger.entries.filter((e) => e.status === 'uploaded').length });
    const entry = { id: entryId, taskUid: body.taskUid, kind: body.kind, pkgId: body.pkgId, status: 'pending', claimedAt: new Date(deps.now()).toISOString(), title: body.title, ...(deps.by ? { by: deps.by } : {}) };
    const next = { rev: ledger.rev + 1, entries: ledger.entries.concat(entry) };
    if (await deps.casSetting(spec.ledgerKey, row ? row.text : null, JSON.stringify(next))) claimed = entry;
  }
  if (!claimed) return fail(409, tag + '_busy_try_again');

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
    const row = await deps.getSetting(spec.ledgerKey);
    const ledger = srv2ParseLedger(row && row.text);
    if (!ledger) break;
    const entries = ledger.entries.map((e) => (e.id === entryId ? { ...e, ...outcome, finishedAt: new Date(deps.now()).toISOString() } : e));
    if (await deps.casSetting(spec.ledgerKey, row ? row.text : null, JSON.stringify({ rev: ledger.rev + 1, entries }))) recorded = true;
  }
  if (outcome.status === 'uploaded') {
    return { status: 200, json: { ok: true, [tag]: true, youtubeVideoId: outcome.youtubeVideoId, videoId: outcome.youtubeVideoId, channelId: outcome.channelId, privacyStatus: outcome.privacyStatus, uploadedAt: outcome.uploadedAt, entryId, recorded, studioUrl: j.studioUrl || null } };
  }
  if (outcome.status === 'pending') return fail(502, outcome.error, { youtubeVideoId: outcome.youtubeVideoId, channelId: outcome.channelId, entryId, recorded });
  return fail(up && up.status >= 400 ? up.status : 502, 'upload_failed', { detail: outcome.error, entryId, recorded });
}

// ── SRV-STUDIO-V2-023: VA upload allowance ───────────────────────────────────
// A separate, CEO-authorized allowance for the VA (a CEO session may use it too): at most maxUploads private,
// unscheduled uploads to SRV Studio with clean titles, at most perKind[format] per format (0 = format not allowed), any SRV
// English task, each task once. Its own ledger — the CEO pilot ledger is never read for limits or written.
// Configuration (app_settings key `srv_studio_v2_va_allowance`; only the server/admin can write it — M1):
//   {"enabled":true,"maxUploads":2,"perKind":{"long":1,"short":1},"expires":"…","channelId":"UC0nzWQX6AaUqlF5FozNpWPg"}
// Absent, unparsable or enabled:false → OFF: every VA allowance request is refused.
export const SRV2_VA_KEY = 'srv_studio_v2_va_allowance';
export const SRV2_VA_LEDGER_KEY = 'srv_studio_v2_va_ledger';
export const SRV2_VA_MAX_UPLOADS = 2;
export function srv2ParseVaConfig(raw, now = Date.now()) {
  if (raw == null || raw === '') return { error: 'va_allowance_not_configured' };
  let c; try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { error: 'va_allowance_unreadable' }; }
  if (!c || typeof c !== 'object') return { error: 'va_allowance_unreadable' };
  if (c.enabled !== true) return { error: 'va_allowance_disabled' };
  if (!Number.isInteger(c.maxUploads) || c.maxUploads < 1 || c.maxUploads > SRV2_VA_MAX_UPLOADS) return { error: 'va_allowance_max_invalid' };
  const pk = c.perKind || {};
  // per-format quota: 0 … maxUploads (026: SRV Studio is Long-only → {"long":2,"short":0} with one Long already in the ledger)
  if (!Number.isInteger(pk.long) || !Number.isInteger(pk.short) || pk.long < 0 || pk.short < 0 || pk.long > c.maxUploads || pk.short > c.maxUploads || pk.long + pk.short < 1) return { error: 'va_allowance_per_kind_invalid' };
  if (c.channelId !== SRV2_PILOT_CHANNEL_ID) return { error: 'va_allowance_channel_invalid' };
  const exp = Date.parse(c.expires || '');
  if (!isFinite(exp)) return { error: 'va_allowance_expiry_invalid' };
  if (exp <= now) return { error: 'va_allowance_expired' };
  if (exp - now > SRV2_PILOT_MAX_DAYS * 86400000) return { error: 'va_allowance_expiry_too_far' };
  return { config: { enabled: true, maxUploads: c.maxUploads, perKind: { long: pk.long, short: pk.short }, expires: new Date(exp).toISOString(), channelId: c.channelId } };
}
export function srv2VaDecide(config, ledger, req) {
  if (!UID_RE.test(String(req.taskUid || ''))) return { ok: false, reason: 'bad_task_uid' };
  if (req.kind !== 'long' && req.kind !== 'short') return { ok: false, reason: 'bad_kind' };
  const live = ledger.entries.filter((e) => e.status === 'pending' || e.status === 'uploaded');
  if (live.some((e) => e.taskUid === req.taskUid)) return { ok: false, reason: 'task_already_uploaded_or_in_progress' };
  if (!config.perKind[req.kind]) return { ok: false, reason: 'va_allowance_format_not_allowed' };
  if (live.length >= config.maxUploads) return { ok: false, reason: 'va_allowance_limit_reached' };
  if (live.filter((e) => e.kind === req.kind).length >= config.perKind[req.kind]) return { ok: false, reason: 'va_allowance_format_used' };
  return { ok: true, kind: req.kind };
}
export const SRV2_PILOT_SPEC = { tag: 'pilot', configKey: SRV2_PILOT_KEY, ledgerKey: SRV2_PILOT_LEDGER_KEY, parse: srv2ParsePilotConfig, decide: srv2PilotDecide };
export const SRV2_VA_SPEC = { tag: 'va', configKey: SRV2_VA_KEY, ledgerKey: SRV2_VA_LEDGER_KEY, parse: srv2ParseVaConfig, decide: srv2VaDecide };
export async function srv2RunVaUpload(deps, body, opts = {}) {
  return srv2RunAllowanceUpload(deps, body, opts, SRV2_VA_SPEC);
}

// ── SRV-STUDIO-V2-023: one-time title correction of an uploaded private video ─
// A metadata-only change (snippet.title; description, tags and category are sent back unchanged; privacy is not
// touched; nothing is uploaded and no allowance is consumed). It runs ONLY as a job the CEO authorized through the
// server/admin path: app_settings key `srv_studio_v2_retitle_job`, which the public roles cannot write (M1):
//   {"videoId":"vX_L0Z9kN-k","title":"…","expires":"…"}            → status set by the server: running → done | failed
// The video must be an uploaded entry of the pilot or VA ledger on the SRV Studio channel and still private.
export const SRV2_RETITLE_KEY = 'srv_studio_v2_retitle_job';
export function srv2ParseRetitleJob(raw, now = Date.now()) {
  if (raw == null || raw === '') return { error: 'no_retitle_job' };
  let j; try { j = JSON.parse(raw); } catch (_) { return { error: 'retitle_job_unreadable' }; }
  if (!j || typeof j !== 'object') return { error: 'retitle_job_unreadable' };
  if (j.status && j.status !== 'pending') return { error: 'retitle_job_already_' + String(j.status) };
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(j.videoId || ''))) return { error: 'retitle_bad_video_id' };
  const title = String(j.title || '');
  if (!title.trim() || title.length > 100 || /[<>]/.test(title) || /\[test\]/i.test(title)) return { error: 'retitle_bad_title' };
  const exp = Date.parse(j.expires || '');
  if (!isFinite(exp) || exp <= now || exp - now > SRV2_PILOT_MAX_DAYS * 86400000) return { error: 'retitle_job_expired_or_invalid' };
  return { job: { videoId: j.videoId, title, expires: new Date(exp).toISOString() } };
}
// deps: now, flagOn, getSetting, casSetting, lookupChannel, accessToken(conn), ytGetVideo(token,id), ytPutSnippet(token,id,snippet)
export async function srv2RunRetitleJob(deps) {
  const fail = (status, error, extra) => ({ status, json: { ok: false, retitle: true, error, ...(extra || {}) } });
  if (!(await deps.flagOn())) return fail(403, 'srv_studio_v2_off');
  const row = await deps.getSetting(SRV2_RETITLE_KEY);
  const { job, error } = srv2ParseRetitleJob(row && row.text, deps.now());
  if (!job) return fail(409, error);
  const inLedger = async (key) => { const r = await deps.getSetting(key); const l = srv2ParseLedger(r && r.text); return !!(l && l.entries.some((e) => e.status === 'uploaded' && e.youtubeVideoId === job.videoId && e.channelId === SRV2_PILOT_CHANNEL_ID)); };
  if (!(await inLedger(SRV2_PILOT_LEDGER_KEY)) && !(await inLedger(SRV2_VA_LEDGER_KEY))) return fail(409, 'video_not_in_upload_ledger');
  const conn = await deps.lookupChannel();
  if (!conn || conn.channel_id !== SRV2_PILOT_CHANNEL_ID) return fail(409, 'wrong_channel');
  // claim the job (compare-and-set) so it can never run twice
  const running = JSON.stringify({ ...JSON.parse(row.text), status: 'running', startedAt: new Date(deps.now()).toISOString() });
  if (!(await deps.casSetting(SRV2_RETITLE_KEY, row.text, running))) return fail(409, 'retitle_job_busy');
  const finish = async (extra) => deps.casSetting(SRV2_RETITLE_KEY, running, JSON.stringify({ ...JSON.parse(running), ...extra, finishedAt: new Date(deps.now()).toISOString() }));
  try {
    const token = await deps.accessToken(conn);
    const v = await deps.ytGetVideo(token, job.videoId);
    if (!v || !v.snippet) { await finish({ status: 'failed', error: 'video_not_found' }); return fail(404, 'video_not_found'); }
    if (v.snippet.channelId !== SRV2_PILOT_CHANNEL_ID) { await finish({ status: 'failed', error: 'video_on_other_channel' }); return fail(409, 'video_on_other_channel'); }
    if (!v.status || v.status.privacyStatus !== 'private') { await finish({ status: 'failed', error: 'video_not_private' }); return fail(409, 'video_not_private'); }
    const s = v.snippet; const snippet = { title: job.title, categoryId: s.categoryId || '10' };
    if (s.description != null) snippet.description = s.description;
    if (Array.isArray(s.tags)) snippet.tags = s.tags;
    if (s.defaultLanguage) snippet.defaultLanguage = s.defaultLanguage;
    if (s.defaultAudioLanguage) snippet.defaultAudioLanguage = s.defaultAudioLanguage;
    const out = await deps.ytPutSnippet(token, job.videoId, snippet);
    if (!out || !out.snippet || out.snippet.title !== job.title) { await finish({ status: 'failed', error: 'title_not_confirmed' }); return fail(502, 'title_not_confirmed'); }
    await finish({ status: 'done', previousTitle: s.title, newTitle: out.snippet.title });
    return { status: 200, json: { ok: true, retitle: true, videoId: job.videoId, previousTitle: s.title, title: out.snippet.title, privacyStatus: v.status.privacyStatus } };
  } catch (e) {
    await finish({ status: 'failed', error: String((e && e.message) || e).slice(0, 200) }).catch(() => {});
    return fail(502, 'retitle_failed', { detail: String((e && e.message) || e).slice(0, 200) });
  }
}

// ── SRV-STUDIO-V2-028: normal SRV Studio production uploads (CEO-approved handoff) ──
// Recurring VA (or CEO) uploads of ordinary SRV Studio Long productions — no per-song CEO authorization. Still
// server-enforced: a VA/CEO session (checked by the API before this runs), V2 on, this configuration enabled, engine
// in test or running (never paused/maintenance), Long only, a live (not cancelled/retired/closed) SRV English task,
// a package that belongs to that task with its video in that package's storage folder, clean title + AI disclosure,
// the verified SRV Studio channel, PRIVATE and never scheduled (forced by the runner), one upload per task across the
// production, pilot and VA ledgers, and a daily cap as a safety valve. Its own ledger; earlier ledgers are only read.
// Configuration (app_settings key `srv_studio_v2_production`; only the server/admin can write it — M1):
//   {"enabled":true,"format":"long","dailyCap":5,"channelId":"UC0nzWQX6AaUqlF5FozNpWPg"}
export const SRV2_PROD_KEY = 'srv_studio_v2_production';
export const SRV2_PROD_LEDGER_KEY = 'srv_studio_v2_production_ledger';
export function srv2ParseProductionConfig(raw) {
  if (raw == null || raw === '') return { error: 'production_not_configured' };
  let c; try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { error: 'production_config_unreadable' }; }
  if (!c || typeof c !== 'object') return { error: 'production_config_unreadable' };
  if (c.enabled !== true) return { error: 'production_disabled' };
  // 029: "formats" lists what production may upload — ["long"] or ["long","short"] (a Short is always a promotional
  // extract of an existing SRV Studio Long). The 028 form {"format":"long"} still means ["long"].
  let formats;
  if (c.formats !== undefined) {
    if (!Array.isArray(c.formats) || !c.formats.length || c.formats.some((f) => f !== 'long' && f !== 'short') || new Set(c.formats).size !== c.formats.length || !c.formats.includes('long')) return { error: 'production_format_invalid' };
    if (c.format !== undefined && c.format !== 'long') return { error: 'production_format_invalid' };
    formats = ['long', 'short'].filter((f) => c.formats.includes(f));
  } else {
    if (c.format !== 'long') return { error: 'production_format_invalid' };
    formats = ['long'];
  }
  if (!Number.isInteger(c.dailyCap) || c.dailyCap < 1 || c.dailyCap > 10) return { error: 'production_daily_cap_invalid' };
  if (c.channelId !== SRV2_PILOT_CHANNEL_ID) return { error: 'production_channel_invalid' };
  return { config: { enabled: true, format: 'long', formats, dailyCap: c.dailyCap, channelId: c.channelId } };
}
export function srv2ProductionDecide(config, ledger, req, now = Date.now()) {
  const formats = (config && config.formats) || ['long'];
  if (req.kind !== 'long' && req.kind !== 'short') return { ok: false, reason: 'bad_kind' };
  if (!formats.includes(req.kind)) return { ok: false, reason: 'production_long_only' }; // 028 code kept for a Long-only config
  // Identity is the task uid and the package id — never the song title (a Long and its Shorts share one title).
  const live = ledger.entries.filter((e) => e.status === 'pending' || e.status === 'uploaded');
  if (live.some((e) => e.taskUid === req.taskUid || (req.pkgId && e.pkgId === req.pkgId))) return { ok: false, reason: 'task_already_uploaded_or_in_progress' };
  const day = new Date(now).toISOString().slice(0, 10);
  if (live.filter((e) => String(e.claimedAt || '').slice(0, 10) === day).length >= config.dailyCap) return { ok: false, reason: 'production_daily_cap_reached' };
  return { ok: true, kind: req.kind };
}
const SRV2_CLOSED = new Set(['done', 'cancelled', 'canceled', 'discarded', 'archived', 'complete', 'completed']);
// deps.taskByUid(uid) → the SRV English task from shared state or null; deps.getPackage(pkgId) → full package or null
async function srv2ProductionPrecheck(deps, body, config) {
  const formats = (config && config.formats) || ['long'];
  if (body.kind !== 'long' && body.kind !== 'short') return { error: 'bad_kind' };
  if (!formats.includes(body.kind)) return { error: 'production_long_only' }; // a format production does not authorize
  for (const key of [SRV2_PILOT_LEDGER_KEY, SRV2_VA_LEDGER_KEY]) {
    const r = await deps.getSetting(key); const l = srv2ParseLedger(r && r.text);
    if (l && l.entries.some((e) => (e.status === 'uploaded' || e.status === 'pending') && (e.taskUid === body.taskUid || e.pkgId === body.pkgId))) return { error: 'task_already_uploaded_or_in_progress' };
  }
  const t = await deps.taskByUid(body.taskUid);
  if (!t || t.engine !== 'SRV English') return { status: 404, error: 'task_not_found' };
  if (t.srvRetired || t.cancelledAt) return { error: 'task_retired_or_cancelled' };
  if (SRV2_CLOSED.has(String(t.status || '').toLowerCase())) return { error: 'task_closed' };
  const taskIsLong = t.isLong === true || t.contentType === 'Long' || t.contentFormat === 'long';
  if (body.kind === 'long' && !taskIsLong) return { error: 'production_long_only' };
  if (body.kind === 'short' && (taskIsLong || t.srvPromo !== true)) return { error: 'short_task_not_promotional' };
  const p = await deps.getPackage(body.pkgId);
  if (!p || p.engine !== 'SRV English' || p.srvTaskUid !== body.taskUid) return { error: 'package_not_of_this_task' };
  if (body.kind === 'long' && p.srvShortOf) return { error: 'production_long_only' };
  if (body.kind === 'short') { const bad = await srv2PromoShortCheck(deps, body, p); if (bad) return { error: bad }; }
  return null;
}
// SRV-STUDIO-V2-029 — a production Short is a 25–35 s vertical extract of an existing SRV Studio Long: same song (title),
// the Long package belongs to SRV English and to a different task, and the rendered Short matches the recorded section.
export const SRV2_SHORT_MIN_SEC = 25;
export const SRV2_SHORT_MAX_SEC = 35;
async function srv2PromoShortCheck(deps, body, p) {
  const so = p.srvShortOf;
  if (!so || typeof so !== 'object' || !so.longPkgId) return 'short_without_source_long';
  if (String(so.longPkgId) === String(p.id || body.pkgId)) return 'short_source_long_invalid';
  const L = await deps.getPackage(String(so.longPkgId));
  if (!L || L.engine !== 'SRV English') return 'short_source_long_not_srv_studio';
  if (L.srvShortOf || L.srvTaskUid === body.taskUid) return 'short_source_long_invalid';
  if (!(L._srvLongVideoUrl || L._srvAudioUrl)) return 'short_source_long_not_built';
  if (String(L.title || '').trim() !== String(p.title || '').trim()) return 'short_title_differs_from_long';
  const want = Number(so.durationSec), got = Number(p.srvRender && p.srvRender.durationSec);
  if (!(want >= SRV2_SHORT_MIN_SEC && want <= SRV2_SHORT_MAX_SEC)) return 'short_duration_out_of_range';
  if (!(got >= SRV2_SHORT_MIN_SEC - 0.5 && got <= SRV2_SHORT_MAX_SEC + 0.5)) return 'short_render_duration_out_of_range';
  const r = p.srvRender || {};
  if (!(Number(r.width) === 1080 && Number(r.height) === 1920)) return 'short_not_vertical';
  if (!/^https?:\/\//.test(String(p._srvShortVideoUrl || '')) || p._srvShortVideoUrl !== body.videoUrl) return 'video_not_from_this_package';
  return null;
}
export const SRV2_PROD_SPEC = { tag: 'production', configKey: SRV2_PROD_KEY, ledgerKey: SRV2_PROD_LEDGER_KEY, parse: srv2ParseProductionConfig, engineStates: ['test', 'running'], precheck: srv2ProductionPrecheck,
  decide: (config, ledger, req) => srv2ProductionDecide(config, ledger, req) };
export async function srv2RunProductionUpload(deps, body, opts = {}) {
  return srv2RunAllowanceUpload(deps, body, opts, { ...SRV2_PROD_SPEC, decide: (c, l, r) => srv2ProductionDecide(c, l, r, deps.now()) });
}
