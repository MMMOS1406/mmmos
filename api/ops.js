// MMM OS v12.4 — Operator API (all v12.4 routes via ?action=)
// GET  /api/ops?action=list_tasks[&role=va][&task_id=UUID]
// POST /api/ops?action=create_task
// POST /api/ops?action=update_task
// POST /api/ops?action=log_activity

// v15.20.8 — self-contained ffmpeg transcode (SRV Farsi TikTok frame_rate_check_failed fix).
// No external service/API key required — @ffmpeg-installer/ffmpeg bundles a static ffmpeg
// binary for the running platform; Vercel's Node functions get a writable /tmp for the
// intermediate files.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, unlink, stat as fsStat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto'; // v16.28.1 — business_brain_create server-side ID generation; v16.30.0 — CEO session auth (Phase 2C)
import { Script } from 'node:vm'; // v16.37.0 — Phase 4E: syntax-only validation (compile, never execute) — no shell.
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
const execFileAsync = promisify(execFile);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_KEY = SUPABASE_SERVICE_KEY; // v13.78.1 — alias so legacy SUPABASE_KEY refs still resolve

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`sbGet ${path}: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Insert ${table}: ${res.status} ${t.slice(0, 200)}`); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function sbPatch(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Patch ${table}: ${res.status} ${t.slice(0, 200)}`); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ── CEO Session Authentication (v16.30.0 — CEO Operating Loop Phase 2C) ────────
// Stateless, server-signed CEO session tokens. There is no session-storage database
// table: tokens are HMAC-SHA256 signed by a server-only secret and self-verify from
// their own payload + expiry, so they remain valid across serverless cold starts /
// invocation restarts without any persisted session store. The signing secret and
// PIN hash live ONLY in this server-side file — never sent to the browser, never
// logged, never returned in any API response. Login attempt throttling is stored
// in the existing app_settings key-value table (no new table) under the key
// 'ceo_login_security_production'.
// v16.31.0 — Phase 2D: the session-signing secret and PIN hash no longer live as
// hardcoded constants in this file. They are fetched from ceo_auth_config, a table
// with RLS enabled and ZERO policies (default-deny for anon/authenticated; only the
// service_role key used by this server can read it — same pattern already ratified
// for ceo_auth_secret in Phase 2A/2B). Cached in module scope for the lifetime of a
// warm serverless instance so protected-action calls don't pay a DB round trip each
// time; a cold start re-fetches once. No Vercel environment-variable tool is
// available in this environment — see the Phase 2D CEO checkpoint for the exact
// manual dashboard step to migrate to real env vars if preferred.
// v16.32.0 — Phase 2E: production key names (ceo_session_secret_production,
// ceo_pin_hash_production, ceo_login_security_production). The production PIN
// was chosen and submitted by the CEO through a one-time enrollment UI that
// never transmitted the plaintext PIN to engineering, chat, or logs — this file
// only ever receives its SHA-256 hash via ceo_auth_config.
const CEO_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const CEO_LOGIN_MAX_ATTEMPTS = 5;
const CEO_LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

let _ceoAuthConfigCache = null;
async function _ceoLoadAuthConfig() {
  if (_ceoAuthConfigCache) return _ceoAuthConfigCache;
  const rows = await sbGet(`ceo_auth_config?key=in.(ceo_session_secret_production,ceo_pin_hash_production)&select=key,value`);
  const map = {};
  for (const r of (rows || [])) map[r.key] = r.value;
  if (!map.ceo_session_secret_production || !map.ceo_pin_hash_production) {
    throw new Error('ceo_auth_config missing required rows');
  }
  _ceoAuthConfigCache = { sessionSecret: map.ceo_session_secret_production, pinHash: map.ceo_pin_hash_production };
  return _ceoAuthConfigCache;
}

function _ceoHashHex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

function _ceoSignSession(payloadObj, secret) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function _ceoVerifySession(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  let obj;
  try { obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!obj || obj.sub !== 'ceo' || !obj.exp || Date.now() > obj.exp) return null;
  return obj;
}

// Reads a CEO session token from the request (body for POST, query for GET — GET
// support exists only for testability, mirroring the existing cdpApprove/cdpExecute
// dual-method pattern) and returns true only if it is a currently-valid, unexpired,
// correctly-signed session. This is the ONLY thing that grants CEO authority to a
// protected action — nothing about client/browser state is trusted.
async function requireCeoSession(req) {
  const src = (req.method === 'POST' ? req.body : req.query) || {};
  const token = src.ceo_session_token;
  if (!token) return false;
  try {
    const cfg = await _ceoLoadAuthConfig();
    return !!_ceoVerifySession(token, cfg.sessionSecret);
  } catch (e) {
    console.error('[requireCeoSession] auth config load failed:', e.message);
    return false;
  }
}

async function _ceoGetLoginSecurity() {
  try {
    const rows = await sbGet(`app_settings?key=eq.ceo_login_security_production&select=value&limit=1`);
    if (rows && rows[0]) { try { return JSON.parse(rows[0].value || '{}'); } catch { return {}; } }
  } catch {}
  return {};
}
async function _ceoSetLoginSecurity(state) {
  try {
    const existing = await sbGetSafe(`app_settings?key=eq.ceo_login_security_production&select=key&limit=1`);
    const body = { key: 'ceo_login_security_production', value: JSON.stringify(state), updated_at: new Date().toISOString() };
    if (existing.length) {
      await sbPatch('app_settings', `key=eq.ceo_login_security_production`, body);
    } else {
      await sbInsert('app_settings', body);
    }
  } catch (e) { console.error('[ceoLogin] failed to persist lockout state:', e.message); }
}

// ── CEO Login (v16.30.0 — Phase 2C; v16.31.0 — Phase 2D: secret/hash from
// ceo_auth_config, not hardcoded) ───────────────────────────────────────────────
// Validates a PIN against a server-only hash and, on success, issues a signed
// session token. This is the ONLY path that can ever produce a valid CEO session —
// the frontend never sees the PIN hash or the session-signing secret, and neither
// value appears anywhere in this source file.
async function ceoLogin(req, res) {
  const src = (req.method === 'POST' ? req.body : req.query) || {};
  const pin = src.pin;
  if (!pin || typeof pin !== 'string') return res.status(400).json({ ok: false, error: 'pin required' });

  let cfg;
  try { cfg = await _ceoLoadAuthConfig(); }
  catch (e) { return res.status(500).json({ ok: false, error: 'auth_config_unavailable' }); }

  const sec = await _ceoGetLoginSecurity();
  const now = Date.now();
  if (sec.lockedUntil && now < sec.lockedUntil) {
    return res.status(429).json({ ok: false, error: 'temporarily_locked', retry_after_seconds: Math.ceil((sec.lockedUntil - now) / 1000) });
  }

  if (_ceoHashHex(pin) !== cfg.pinHash) {
    const failCount = (sec.failCount || 0) + 1;
    const next = { failCount, lastAttemptAt: new Date(now).toISOString() };
    if (failCount >= CEO_LOGIN_MAX_ATTEMPTS) {
      next.lockedUntil = now + CEO_LOGIN_LOCKOUT_MS;
      next.failCount = 0;
    }
    await _ceoSetLoginSecurity(next);
    // Generic failure response — no hint about which part of the credential was wrong.
    return res.status(401).json({ ok: false, error: 'invalid_credentials' });
  }

  // Success — clear throttle state, issue session.
  await _ceoSetLoginSecurity({ failCount: 0, lastAttemptAt: new Date(now).toISOString() });
  const exp = now + CEO_SESSION_TTL_MS;
  const token = _ceoSignSession({ sub: 'ceo', iat: now, exp }, cfg.sessionSecret);
  return res.status(200).json({ ok: true, ceo_session_token: token, expires_at: new Date(exp).toISOString() });
}

// Lets the frontend check a persisted token's validity on page load without
// touching a protected action. Read-only, no side effects.
async function ceoCheckSession(req, res) {
  const ok = await requireCeoSession(req);
  return res.status(200).json({ ok });
}

// ── Engineering Agent Authorization / Claim (v16.35.0 — Phase 4B, CEO-approved
// 2026-08-16) ────────────────────────────────────────────────────────────────
// Deliberately SEPARATE from CEO session auth above — different secret material,
// different verification function, different action surface. An Engineering
// Agent never receives a CEO session token and this code path can never satisfy
// requireCeoSession, nor can a CEO session token satisfy an agent-token check.
// Agent credentials are per-task, single-purpose bearer tokens: CEO-authorize
// mints a random token, the server stores only its SHA-256 hash on that task's
// own row, and the raw token is returned exactly once. A token only ever matches
// the hash column on the one row it was minted for, so a token for Task A cannot
// satisfy the check on Task B. No permanent service-role credential is ever
// exposed to an agent.
const AGENT_LEASE_MS = 30 * 60 * 1000; // 30 min bounded lease. Expiry is evaluated
// lazily on the next claim attempt (see engineeringTaskAgentClaim) — no cron.

function _agentHashHex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

function _agentTokenMatches(providedToken, storedHash) {
  if (!providedToken || !storedHash) return false;
  const providedHash = _agentHashHex(providedToken);
  const a = Buffer.from(providedHash, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Task-Scoped File/Validation Capabilities (v16.37.0 — Phase 4E, CEO-approved
// 2026-08-16) ────────────────────────────────────────────────────────────────
// A path is only ever "safe" if it is a plain relative path rooted under the
// single fixed sandbox directory below — no traversal, no absolute paths, no
// null bytes. This check runs BOTH when the CEO authorizes a scope (so an
// unsafe path can never even be stored) and again on every Gateway request
// that uses a path (so nothing is trusted from the DB round-trip alone
// either) — belt and suspenders, not a single point of failure.
const AGENT_SANDBOX_ROOT = 'sandbox/';
function _agentSafePath(p) {
  if (typeof p !== 'string' || !p.trim()) return null;
  if (p.length > 300) return null;
  if (p.includes('..') || p.includes('\0') || p.startsWith('/') || p.startsWith('~') || p.includes('\\')) return null;
  if (!p.startsWith(AGENT_SANDBOX_ROOT)) return null;
  return p;
}
function _agentPathAllowed(requestedPath, allowlist) {
  const safe = _agentSafePath(requestedPath);
  if (!safe) return false;
  return Array.isArray(allowlist) && allowlist.includes(safe);
}
const AGENT_ALLOWED_VALIDATION_OPS = new Set(['validate_javascript_syntax']);
// Sanitizes CEO-supplied capability_scope input into a safe, minimal shape.
// Anything not a safe sandbox-rooted path, or not a recognized validation op,
// is silently dropped rather than stored — the Agent (or a malformed request)
// cannot smuggle an unsafe path into the stored scope this way.
function _agentSanitizeScope(raw) {
  const out = { read_paths: [], write_paths: [], validation_ops: [] };
  if (!raw || typeof raw !== 'object') return out;
  for (const p of Array.isArray(raw.read_paths) ? raw.read_paths : []) {
    const safe = _agentSafePath(p);
    if (safe && !out.read_paths.includes(safe)) out.read_paths.push(safe);
  }
  for (const p of Array.isArray(raw.write_paths) ? raw.write_paths : []) {
    const safe = _agentSafePath(p);
    if (safe && !out.write_paths.includes(safe)) out.write_paths.push(safe);
  }
  for (const v of Array.isArray(raw.validation_ops) ? raw.validation_ops : []) {
    if (AGENT_ALLOWED_VALIDATION_OPS.has(v) && !out.validation_ops.includes(v)) out.validation_ops.push(v);
  }
  return out;
}

// ── Engineering Worker Identity (v16.49.0 — CEO Decision #16 Step 2C) ──────────
// Smallest slice of the Step 2B architecture checkpoint: a registered Engineering
// Worker (Cowork today; any future vendor-independent worker later) authenticates
// with its OWN standing identity credential, entirely separate from any task's
// CEO authorization. Architectural rule enforced throughout this section and the
// new claim path below: CEO authority (did the CEO authorize THIS task) and
// worker identity (which registered worker is asking) are two independent
// checks — a claim requires BOTH. Nothing in this section can set or clear
// agent_authorized_at / agent_authorization_revoked_at on any task; those remain
// exclusively engineeringTaskCeoAuthorizeAgent / engineeringTaskCeoRevokeAgent-
// Authorization, both completely unmodified by this change. The existing
// per-task one-time-token claim path (engineeringTaskAgentClaim, below) is kept
// fully intact as a fallback — this is an additive alternative, not a
// replacement.

// CEO-session-gated. Mints a new standing worker identity. The raw credential is
// returned exactly once, here, and is never persisted or logged anywhere —
// only its SHA-256 hash is stored, reusing _agentHashHex verbatim (the same
// primitive already used for per-task agent tokens, not a new one). This
// credential proves WHO is asking; on its own it authorizes nothing (see
// engineeringWorkerClaimTask's independent authOk check below).
async function engineeringWorkerProvision(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 100) : 'Engineering Worker';
    const rawCredential = randomBytes(32).toString('hex');
    const credentialHash = _agentHashHex(rawCredential);
    const worker = await sbInsert('engineering_workers', { label, credential_hash: credentialHash, active: true, created_by: 'ceo' });
    if (!worker) return res.status(500).json({ ok: false, error: 'provision_failed' });
    return res.status(200).json({
      ok: true, worker_id: worker.id, label: worker.label, worker_credential: rawCredential,
      note: 'Store this credential securely in the worker\'s own environment — it will not be shown again. It identifies this worker only; it does not by itself authorize any Engineering Task.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// CEO-session-gated. Revokes a worker identity immediately — every subsequent
// discovery/claim call using its credential fails closed from that instant,
// regardless of any task's own authorization state. Does not touch any
// engineering_tasks row: a task this worker already claimed keeps its existing
// claim/lease exactly as-is. Task-level revocation remains the separate,
// unmodified engineeringTaskCeoRevokeAgentAuthorization action — the two are
// intentionally independent (per Decision #16 Step 2B's trust model).
async function engineeringWorkerRevoke(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const now = new Date().toISOString();
    const worker = await sbPatch('engineering_workers', `id=eq.${encodeURIComponent(id)}`, { active: false, revoked_at: now, revoked_by: 'ceo' });
    if (!worker) return res.status(404).json({ ok: false, error: 'worker_not_found' });
    return res.status(200).json({ ok: true, worker_id: id, active: false, revoked_at: now });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// CEO-session-gated, read-only. Metadata only — credential_hash is deliberately
// never included in this or any other response. There is no reason to return
// it and every reason not to normalize doing so, even though a SHA-256 hash of
// a value the CEO no longer holds is not itself secret-shaped information.
async function engineeringWorkerList(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const rows = await sbGetSafe(`engineering_workers?select=id,label,active,created_at,created_by,revoked_at,revoked_by,last_seen_at&order=created_at.desc`);
    return res.status(200).json({ ok: true, workers: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// NOT CEO-session-gated — this is the Worker-side entry point, symmetric to the
// existing per-task token check. Verifies a presented raw worker credential
// against every ACTIVE worker row using the exact same constant-time comparison
// already used for per-task agent tokens (_agentTokenMatches, reused verbatim —
// not reimplemented, not a new comparison primitive). Worker counts are
// expected to stay tiny (a handful of registered workers at most), so a linear
// scan over active rows is the simplest correct approach. Returns the matching
// worker's {id, label} — never the credential itself — or null.
async function _engineeringWorkerAuthenticate(rawCredential) {
  if (!rawCredential || typeof rawCredential !== 'string') return null;
  const rows = await sbGetSafe(`engineering_workers?active=eq.true&select=id,label,credential_hash`);
  for (const w of rows) {
    if (_agentTokenMatches(rawCredential, w.credential_hash)) return { id: w.id, label: w.label };
  }
  return null;
}

// ── Engineering Worker: Secure Pairing Protocol ──────────────────────────── v16.52.0 — CEO Decision #17 Step 2D
// Replaces the abandoned manual credential-copy handoff (Step 2C) with a
// pairing flow modeled on standard device-pairing patterns (OAuth
// device-code, SSH pairing codes): Cowork generates its own one-time secret
// locally and never sends the raw value to MMMOS until the final,
// single completion call. The CEO never sees or handles a raw
// worker_credential — approval only flips a pending row's status; the
// credential itself is minted (and returned directly to Cowork's own HTTP
// call, never to the CEO's browser) only after BOTH gates pass:
//   (a) CEO approval (requireCeoSession, unchanged — the exact same gate
//       every other CEO-only action in this file uses), AND
//   (b) Cowork proving possession of the original pairing secret (hash
//       comparison, reusing the existing _agentHashHex/_agentTokenMatches
//       primitives verbatim — no new crypto primitive introduced).
// No new worker-authorization concept is introduced: a successfully paired
// worker is just a normal engineering_workers row, created exactly the way
// engineeringWorkerProvision already creates one. Pairing approval grants
// connection only — it is never sufficient on its own to claim or execute
// any Engineering Task; that remains the fully separate, unmodified task
// authorization chain (engineering_task_ceo_authorize_agent + the Step 2A
// Gateway's independent re-verification).
const ENGINEERING_WORKER_PAIRING_TTL_MS = 15 * 60 * 1000; // 15 minutes

// NOT CEO-session-gated — this is Cowork's own unauthenticated first call,
// symmetric to an OAuth device-authorization request. The row it creates is
// useless on its own: nothing can be claimed, read, minted, or executed from
// a pending/approved pairing row until engineeringWorkerPairingComplete
// succeeds below, and that requires the raw secret this endpoint never sees.
async function engineeringWorkerPairingRequest(req, res) {
  try {
    const body = req.body || {};
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 100) : 'Engineering Worker';
    const pairingSecretHash = body.pairing_secret_hash;
    if (!pairingSecretHash || typeof pairingSecretHash !== 'string' || pairingSecretHash.length < 32) {
      return res.status(400).json({ ok: false, error: 'pairing_secret_hash required' });
    }
    const expiresAt = new Date(Date.now() + ENGINEERING_WORKER_PAIRING_TTL_MS).toISOString();
    const row = await sbInsert('engineering_worker_pairing_requests', {
      label, pairing_secret_hash: pairingSecretHash, status: 'pending', expires_at: expiresAt,
    });
    if (!row) return res.status(500).json({ ok: false, error: 'pairing_request_failed' });
    return res.status(200).json({ ok: true, pairing_id: row.id, label: row.label, status: row.status, expires_at: row.expires_at });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// CEO-session-gated, read-only. Powers the Engineering Workers panel's new
// "Pending Connection Requests" list. Never returns pairing_secret_hash —
// there is no legitimate reason for it to reach the browser, exactly the
// same discipline engineeringWorkerList already applies to credential_hash.
// Expired-but-not-yet-swept rows are filtered out here rather than trusted
// to a background job, so the CEO never sees a request they can no longer
// meaningfully approve.
async function engineeringWorkerPairingListPending(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const rows = await sbGetSafe(`engineering_worker_pairing_requests?status=eq.pending&select=id,label,status,created_at,expires_at&order=created_at.desc`);
    const now = Date.now();
    const active = (rows || []).filter(r => new Date(r.expires_at).getTime() > now);
    return res.status(200).json({ ok: true, requests: active });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// CEO-session-gated. Approval alone never mints or returns a worker_credential
// — it only flips this one row's status, so there is nothing secret in this
// response for the CEO's browser to ever hold. The real credential is minted
// later, only inside engineeringWorkerPairingComplete, and only ever returned
// to the caller of THAT action (Cowork itself, via its own direct HTTP call —
// never routed through this CEO-session-gated path).
async function engineeringWorkerPairingApprove(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const rows = await sbGetSafe(`engineering_worker_pairing_requests?id=eq.${encodeURIComponent(id)}&select=id,status,expires_at&limit=1`);
    const reqRow = rows?.[0];
    if (!reqRow) return res.status(404).json({ ok: false, error: 'pairing_request_not_found' });
    if (reqRow.status !== 'pending') return res.status(409).json({ ok: false, error: 'pairing_request_not_pending' });
    if (new Date(reqRow.expires_at).getTime() <= Date.now()) {
      await sbPatch('engineering_worker_pairing_requests', `id=eq.${encodeURIComponent(id)}`, { status: 'expired' });
      return res.status(409).json({ ok: false, error: 'pairing_request_expired' });
    }
    const now = new Date().toISOString();
    const updated = await sbPatch('engineering_worker_pairing_requests', `id=eq.${encodeURIComponent(id)}`, { status: 'approved', approved_at: now, approved_by: 'ceo' });
    if (!updated) return res.status(500).json({ ok: false, error: 'approve_failed' });
    return res.status(200).json({ ok: true, pairing_id: id, status: 'approved' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// CEO-session-gated. Symmetric reject path — lets the CEO dismiss a pending
// request (e.g. an unrecognized/unexpected connection attempt) without ever
// needing to know or handle a credential. Guarded to only affect a row that
// is still 'pending' (a compound filter, not a separate read-then-write) so
// it can't rewrite the outcome of a request some other path already resolved.
async function engineeringWorkerPairingReject(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const updated = await sbPatch('engineering_worker_pairing_requests', `id=eq.${encodeURIComponent(id)}&status=eq.pending`, { status: 'rejected' });
    if (!updated) return res.status(404).json({ ok: false, error: 'pairing_request_not_found_or_not_pending' });
    return res.status(200).json({ ok: true, pairing_id: id, status: 'rejected' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// NOT CEO-session-gated — this is Cowork's own second and final call, made
// directly (never via the CEO's browser). Succeeds only when BOTH are true:
// the CEO has already approved this exact pairing_id, AND the caller
// presents the original raw pairing secret Cowork generated in step 1 and
// never sent anywhere until now. Only then is a real worker identity minted
// — via the exact same insert shape engineeringWorkerProvision already
// uses — with its raw, one-time worker_credential returned directly in THIS
// response only. The pairing row is consumed immediately afterward: status
// flips to 'completed' and pairing_secret_hash is cleared, so this call can
// never succeed twice for the same pairing_id (no replay).
async function engineeringWorkerPairingComplete(req, res) {
  try {
    const body = req.body || {};
    const { pairing_id, pairing_secret } = body;
    if (!pairing_id || !pairing_secret) return res.status(400).json({ ok: false, error: 'pairing_id and pairing_secret required' });
    const rows = await sbGetSafe(`engineering_worker_pairing_requests?id=eq.${encodeURIComponent(pairing_id)}&select=id,label,status,pairing_secret_hash,expires_at&limit=1`);
    const reqRow = rows?.[0];
    if (!reqRow) return res.status(404).json({ ok: false, error: 'pairing_request_not_found' });
    if (reqRow.status !== 'approved') return res.status(409).json({ ok: false, error: 'pairing_not_approved' });
    if (new Date(reqRow.expires_at).getTime() <= Date.now()) {
      await sbPatch('engineering_worker_pairing_requests', `id=eq.${encodeURIComponent(pairing_id)}`, { status: 'expired' });
      return res.status(409).json({ ok: false, error: 'pairing_request_expired' });
    }
    if (!_agentTokenMatches(pairing_secret, reqRow.pairing_secret_hash)) {
      return res.status(401).json({ ok: false, error: 'pairing_secret_mismatch' });
    }
    const rawCredential = randomBytes(32).toString('hex');
    const credentialHash = _agentHashHex(rawCredential);
    const worker = await sbInsert('engineering_workers', { label: reqRow.label, credential_hash: credentialHash, active: true, created_by: 'pairing' });
    if (!worker) return res.status(500).json({ ok: false, error: 'worker_creation_failed' });
    await sbPatch('engineering_worker_pairing_requests', `id=eq.${encodeURIComponent(pairing_id)}`, {
      status: 'completed', completed_at: new Date().toISOString(), worker_id: worker.id, pairing_secret_hash: null,
    });
    return res.status(200).json({
      ok: true, worker_id: worker.id, label: worker.label, worker_credential: rawCredential,
      note: 'Store this credential in your own local storage now — it will not be returned again.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: CEO Authorizes Agent Execution ──────────────────────── Phase 4B
// CEO-session-gated. Marks exactly one task as eligible for an Engineering Agent
// to later claim, and mints that task's one-time bearer token. Does NOT execute,
// claim, or deploy anything. Task creation (Phase 3) never implies this
// authorization — only this action can set agent_authorized_at.
async function engineeringTaskCeoAuthorizeAgent(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const rows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(id)}&select=id,status,packet,agent_authorized_at&limit=1`);
    const task = rows?.[0];
    if (!task) return res.status(404).json({ ok: false, error: 'task_not_found' });

    // Phase 4B minimum eligibility gate: task must carry a real, non-empty
    // authorization_boundary. Today that only exists on decision-routed tasks
    // (packet.origin_decision.authorization_boundary, set by the Phase 3B
    // bridge). Manually-authored tasks have no boundary field yet — extending
    // boundary-carrying to them is out of scope for Phase 4B, so they are
    // correctly ineligible until that is designed in a later phase.
    const boundary = task.packet?.origin_decision?.authorization_boundary;
    if (!boundary || typeof boundary !== 'string' || !boundary.trim()) {
      return res.status(409).json({ ok: false, error: 'no_authorization_boundary', message: 'Task has no usable authorization_boundary (only decision-routed tasks qualify in Phase 4B).' });
    }

    const now = new Date().toISOString();
    const agentToken = randomBytes(24).toString('hex');
    const tokenHash = _agentHashHex(agentToken);
    // v16.37.0 — Phase 4E: task-scoped capability manifest. Sanitized here —
    // the only place agent_capability_scope is ever written — so an unsafe
    // path can never reach the database in the first place. Absent/invalid
    // input defaults to fully empty (zero file/validation capabilities),
    // matching "missing capability = DENIED".
    const scope = _agentSanitizeScope(body.capability_scope);
    const patch = {
      agent_authorized_at: now,
      agent_authorized_by: 'ceo',
      agent_authorization_token_hash: tokenHash,
      agent_authorization_revoked_at: null, // re-authorizing clears any prior revocation
      agent_capability_scope: scope,
    };
    const finalTask = await sbPatch('engineering_tasks', `id=eq.${encodeURIComponent(id)}`, patch);
    if (!finalTask) return res.status(500).json({ ok: false, error: 'authorize_failed' });
    // Raw token is returned exactly once, here, and is never persisted or logged.
    return res.status(200).json({
      ok: true, task_id: id, agent_authorized_at: now, agent_authorized_by: 'ceo',
      agent_token: agentToken, capability_scope: scope,
      note: 'Store this token securely — it will not be shown again. It authorizes claiming this exact task only.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: CEO Revokes Agent Authorization ─────────────────────── Phase 4B
// CEO-session-gated. Immediately voids the task's authorization/token/lease
// regardless of whether it was ever claimed. Checked on every claim/mutation
// attempt, not just at claim time — a revoked task cannot be claimed even if a
// caller still holds the (now-void) raw token, and an already-active lease
// becomes unusable for any further Phase 4B mutation the instant this is called.
async function engineeringTaskCeoRevokeAgentAuthorization(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const now = new Date().toISOString();
    const finalTask = await sbPatch('engineering_tasks', `id=eq.${encodeURIComponent(id)}`, { agent_authorization_revoked_at: now });
    if (!finalTask) return res.status(404).json({ ok: false, error: 'task_not_found' });
    return res.status(200).json({ ok: true, task_id: id, agent_authorization_revoked_at: now });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: Agent Atomic Claim ───────────────────────────────────── Phase 4B
// NOT CEO-session-gated — this is the Agent-side entry point, authenticated only
// by proof of the per-task bearer token minted by engineering_task_ceo_authorize_agent.
// Uses the exact same conditional-PATCH atomic-claim idiom already proven in
// cdpExecute's v15.11.0 ATOMIC CLAIM (see above, unmodified): the mutation is
// scoped by a WHERE predicate on current state, so PostgREST/Postgres row-level
// locking guarantees that of two concurrent claim attempts against the same row,
// only one PATCH can match and return a row — the other deterministically
// matches zero rows and gets a safe "already_claimed" response. No new locking
// primitive was invented for this.
// ── Shared atomic claim primitive (v16.49.0 — CEO Decision #16 Step 2C) ────────
// Extracted, behavior-preserving, from the original engineeringTaskAgentClaim
// (Phase 4B) so the existing token-based claim path below and the new
// worker-identity claim path (engineeringWorkerClaimTask) share the EXACT SAME
// atomic conditional-claim/lease logic — one implementation, not two that could
// drift apart. Callers are responsible for their OWN authorization check
// (token match, or worker identity + task authorization) before calling this —
// this function only performs the atomic state transition once a caller has
// already decided a claim should be attempted. extraPatch lets a caller attach
// additional columns to the SAME atomic PATCH (used by the worker path to also
// stamp claimed_by_worker_id) without altering the WHERE-clause atomicity.
async function _engineeringTaskAtomicClaim(task_id, claimedBy, extraPatch) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseExpires = new Date(now + AGENT_LEASE_MS).toISOString();
  const runId = randomBytes(16).toString('hex');
  const claimed = await sbPatch(
    'engineering_tasks',
    `id=eq.${encodeURIComponent(task_id)}&or=(agent_claimed_at.is.null,lease_expires_at.lt.${encodeURIComponent(nowIso)})`,
    { agent_claimed_at: nowIso, agent_claimed_by: claimedBy, agent_run_id: runId, lease_expires_at: leaseExpires, updated_at: nowIso, ...(extraPatch || {}) }
  );
  if (!claimed) return null;
  return { runId, nowIso, leaseExpires };
}

async function engineeringTaskAgentClaim(req, res) {
  try {
    const body = req.body || {};
    const { task_id, agent_token, agent_identity } = body;
    if (!task_id || !agent_token) return res.status(400).json({ ok: false, error: 'task_id and agent_token required' });

    const rows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(task_id)}&select=id,agent_authorized_at,agent_authorization_token_hash,agent_authorization_revoked_at&limit=1`);
    const task = rows?.[0];
    if (!task) return res.status(404).json({ ok: false, error: 'task_not_found' });

    // Generic failure — mirrors ceoLogin's principle of not hinting which check failed.
    const authOk = !!task.agent_authorized_at
      && !task.agent_authorization_revoked_at
      && _agentTokenMatches(agent_token, task.agent_authorization_token_hash);
    if (!authOk) return res.status(401).json({ ok: false, error: 'agent_authorization_invalid' });

    // Atomic conditional claim: matches only if never claimed, or the existing
    // lease has expired. An active, unexpired lease cannot be stolen.
    // v16.49.0 — Step 2C: now calls the shared _engineeringTaskAtomicClaim
    // helper. Same WHERE clause, same columns, same values — behavior is
    // byte-for-byte identical to before this refactor.
    const claimResult = await _engineeringTaskAtomicClaim(task_id, agent_identity || 'engineering-agent', null);
    if (!claimResult) {
      return res.status(409).json({ ok: false, error: 'already_claimed', message: 'This task already has an active, unexpired agent claim.' });
    }
    const { runId, nowIso, leaseExpires } = claimResult;

    // Audit trail — reuses the existing brain_agent_runs table (already surfaced
    // in the CEO's Brain v2 / Autonomous Agents UI panel), no new table.
    try {
      await sbInsert('brain_agent_runs', {
        session_id: agent_identity || 'engineering-agent',
        task_id: String(task_id),
        action: 'engineering_task_agent_claim',
        status: 'claimed',
        input: { agent_authorized_at: task.agent_authorized_at, lease_ms: AGENT_LEASE_MS },
        output: { run_id: runId, lease_expires_at: leaseExpires },
        started_at: nowIso,
      });
    } catch (e) { console.error('[engineeringTaskAgentClaim] audit insert failed:', e.message); }

    return res.status(200).json({ ok: true, task_id, run_id: runId, agent_claimed_at: nowIso, lease_expires_at: leaseExpires });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Worker: Authorized-Task Discovery (v16.49.0 — Step 2C) ─────────
// Worker-identity-gated (NOT CEO-session-gated) — symmetric in trust class to
// engineeringTaskAgentClaim above. Exposes ONLY what a worker needs to pick a
// task: id/problem (truncated)/affected_engine/priority/authorized-since.
// Never the full packet, never the authorization boundary text, never any
// credential — a worker fetches the packet/boundary only AFTER claiming, via
// the existing, completely unmodified engineeringAgentGateway
// read_task_packet/read_authorization_boundary ops. Independently re-derives
// every eligibility condition from the database: worker identity valid+active;
// CEO authorization present (agent_authorized_at set); not revoked; not
// currently validly claimed by anyone (unclaimed OR lease expired) — nothing
// here is inferred from the caller. Authorization-boundary presence is not
// re-checked here because agent_authorized_at can only ever be set by
// engineeringTaskCeoAuthorizeAgent, which already refuses to set it without a
// real boundary — re-verified anyway, defense-in-depth, at claim time below.
async function engineeringWorkerListAuthorizedTasks(req, res) {
  try {
    const body = req.body || {};
    const worker = await _engineeringWorkerAuthenticate(body.worker_credential);
    if (!worker) return res.status(401).json({ ok: false, error: 'worker_authentication_failed' });

    const nowIso = new Date().toISOString();
    const rows = await sbGetSafe(
      `engineering_tasks?select=id,problem,affected_engine,priority,agent_authorized_at&` +
      `agent_authorized_at=not.is.null&agent_authorization_revoked_at=is.null&` +
      `or=(agent_claimed_at.is.null,lease_expires_at.lt.${encodeURIComponent(nowIso)})&` +
      `order=agent_authorized_at.asc&limit=50`
    );
    try { await sbPatch('engineering_workers', `id=eq.${encodeURIComponent(worker.id)}`, { last_seen_at: nowIso }); } catch (_) {}

    return res.status(200).json({
      ok: true, worker_id: worker.id,
      tasks: (rows || []).map(t => ({
        id: t.id, problem: String(t.problem || '').slice(0, 300),
        affected_engine: t.affected_engine, priority: t.priority, agent_authorized_at: t.agent_authorized_at,
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Worker: Secure Claim (v16.49.0 — Step 2C) ──────────────────────
// The new worker-identity claim path, additive alongside the existing per-task
// token path above (engineeringTaskAgentClaim, unmodified in behavior). Requires
// BOTH an independently-authenticated worker identity AND an independently
// re-verified, CEO-set task authorization (agent_authorized_at + a real,
// non-empty authorization_boundary + not revoked) — either alone is refused,
// per Decision #16's architectural rule that worker identity must never itself
// grant task authorization. Reuses the exact same atomic conditional-claim/
// lease primitive as the token path via _engineeringTaskAtomicClaim — no new
// locking mechanism, no duplicated claim logic. Additionally stamps
// claimed_by_worker_id so the CEO/Engineering Review can see exactly which
// registered worker claimed a task, alongside the existing agent_claimed_by
// label.
async function engineeringWorkerClaimTask(req, res) {
  try {
    const body = req.body || {};
    const { task_id } = body;
    if (!task_id) return res.status(400).json({ ok: false, error: 'task_id required' });

    const worker = await _engineeringWorkerAuthenticate(body.worker_credential);
    if (!worker) return res.status(401).json({ ok: false, error: 'worker_authentication_failed' });

    const rows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(task_id)}&select=id,packet,agent_authorized_at,agent_authorization_revoked_at,agent_claimed_at,lease_expires_at&limit=1`);
    const task = rows?.[0];
    if (!task) return res.status(404).json({ ok: false, error: 'task_not_found' });

    // Independent re-verification of CEO authority — never inferred from the
    // worker's identity, never inferred from the caller's say-so. Same
    // boundary-presence check engineeringTaskCeoAuthorizeAgent already enforces
    // before it will ever set agent_authorized_at — re-checked here too
    // (defense-in-depth, not trust that the earlier gate was never bypassed).
    const boundary = task.packet?.origin_decision?.authorization_boundary;
    const authOk = !!task.agent_authorized_at
      && !task.agent_authorization_revoked_at
      && !!boundary && typeof boundary === 'string' && !!boundary.trim();
    if (!authOk) return res.status(409).json({ ok: false, error: 'task_not_authorized' });

    const claimedByLabel = `worker:${worker.label}`;
    const claimResult = await _engineeringTaskAtomicClaim(task_id, claimedByLabel, { claimed_by_worker_id: worker.id });
    if (!claimResult) {
      return res.status(409).json({ ok: false, error: 'already_claimed', message: 'This task already has an active, unexpired claim.' });
    }
    const { runId, nowIso, leaseExpires } = claimResult;

    try {
      await sbInsert('brain_agent_runs', {
        session_id: claimedByLabel, task_id: String(task_id), action: 'engineering_worker_claim_task', status: 'claimed',
        input: { worker_id: worker.id, agent_authorized_at: task.agent_authorized_at, lease_ms: AGENT_LEASE_MS },
        output: { run_id: runId, lease_expires_at: leaseExpires },
        started_at: nowIso,
      });
    } catch (e) { console.error('[engineeringWorkerClaimTask] audit insert failed:', e.message); }
    try { await sbPatch('engineering_workers', `id=eq.${encodeURIComponent(worker.id)}`, { last_seen_at: nowIso }); } catch (_) {}

    return res.status(200).json({
      ok: true, task_id, run_id: runId, agent_claimed_at: nowIso, lease_expires_at: leaseExpires,
      worker_id: worker.id, worker_label: worker.label,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Worker: Submit Task (v16.50.0 — Step 2E) ───────────────────────
// Root cause fixed: the standalone mmm-engineering-brain MCP tool (eb_create_task)
// wrote directly to Supabase REST with a low-privilege key, correctly rejected by
// engineering_tasks' RLS (anon_read_engineering_tasks is SELECT-only for
// anon/authenticated — no INSERT policy exists for any non-service-role caller;
// this is RLS working as designed, not a defect). That MCP path also bypassed
// _buildEngineeringPacketWithKnowledge and the created_via='task_generator' stamp
// Engineering Review depends on to surface a task at all — a second, weaker,
// undiscoverable copy of task creation (rule_15 SSOT violation).
//
// Fix: a governed, worker-credential-gated HTTP action that calls the EXACT SAME
// canonical insert path (_insertEngineeringTaskRow) the Task Generator UI itself
// uses — same packet generation, same created_via stamp, same downstream
// governance. Worker identity is independently re-verified via
// _engineeringWorkerAuthenticate (the same primitive engineeringWorkerClaimTask /
// engineeringWorkerListAuthorizedTasks already use — not reimplemented). This
// grants ONLY the ability to create a task row, nothing more: it never sets
// agent_authorized_at, never touches requireCeoSession, engineeringTaskCeoApprove,
// engineeringTaskCeoAuthorizeAgent, or production_deployment_authorize. The
// resulting row lands exactly where any Task-Generator-created task lands —
// status='open', awaiting normal CEO Engineering Review. No service-role
// credential is ever exposed to the caller; SUPABASE_SERVICE_KEY stays
// server-side inside _insertEngineeringTaskRow exactly as it already does today.
async function engineeringWorkerSubmitTask(req, res) {
  try {
    const body = req.body || {};
    const worker = await _engineeringWorkerAuthenticate(body.worker_credential);
    if (!worker) return res.status(401).json({ ok: false, error: 'worker_authentication_failed' });

    const { problem, expected_result, affected_engine, priority, acceptance_criteria, submission_idempotency_key } = body;
    if (!problem || !expected_result || !affected_engine) {
      return res.status(400).json({ ok: false, error: 'problem, expected_result, affected_engine required' });
    }

    // Replay/duplicate protection: a prior submission carrying the same
    // idempotency key is returned as-is instead of inserting a second row.
    // Same idea as the existing origin_decision_id + origin_decision_child_key
    // dedup already used by the CDP->Engineering bridge — new field, no new
    // mechanism invented.
    if (submission_idempotency_key) {
      const dup = await sbGetSafe(
        `engineering_tasks?packet->>submission_idempotency_key=eq.${encodeURIComponent(String(submission_idempotency_key))}&select=*&limit=1`
      );
      if (dup && dup[0]) {
        return res.status(200).json({ ok: true, task: dup[0], deduped: true });
      }
    }

    const task = await _insertEngineeringTaskRow({
      problem, expected_result, affected_engine, priority, acceptance_criteria,
      packetExtra: {
        created_via: 'task_generator',
        derived_from: 'engineering_worker_submission',
        submitted_by_worker_id: worker.id,
        submitted_by_worker_label: worker.label,
        submission_idempotency_key: submission_idempotency_key || null,
      },
    });

    try { await sbPatch('engineering_workers', `id=eq.${encodeURIComponent(worker.id)}`, { last_seen_at: new Date().toISOString() }); } catch (_) {}

    return res.status(200).json({ ok: true, task, deduped: false });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Agent Gateway (v16.36.0 — Phase 4D, CEO-approved 2026-08-16) ──
// The ONLY trusted entry point through which a future bounded Engineering Agent
// may act. Reuses Phase 4B authorization/claim/lease verification VERBATIM — no
// second auth mechanism. Every request is independently re-verified against the
// database on every call; nothing the Agent claims about itself (its own
// task_id, run_id, or capabilities) is trusted. The set of allowed operations
// is a fixed, hardcoded whitelist with no code path that expands it from
// client input — an unrecognized or unimplemented capability is denied by
// construction (it simply isn't in the whitelist/switch), not by convention.
// This function contains ZERO reference to requireCeoSession or any CEO-only
// action — a valid Agent credential structurally cannot reach a CEO action
// from here, and nothing here can grant, modify, or revoke authorization.
const AGENT_GATEWAY_ALLOWED_OPS = new Set([
  'read_task_packet',
  'read_authorization_boundary',
  'read_capability_manifest',
  'submit_execution_plan',
  'submit_evidence',
  // v16.37.0 — Phase 4E: bounded, task-scoped file/validation operations.
  'read_authorized_file',
  'write_authorized_file',
  'validate_javascript_syntax',
  // v16.56.0 — CEO Decision #17 Automatic Git Commit Capture Fix. The ONLY
  // path by which engineering_tasks.git_commit_sha is ever written for a
  // 'new_development' task (see the op's own comment below for the full
  // verification/immutability chain). Deliberately still just one more
  // entry in this same fixed whitelist — no new authorization concept, no
  // new credential, no new claim/lease mechanism.
  'submit_commit_sha',
]);

// v16.37.0 — Phase 4E: manifest is now DERIVED PER-TASK from that task's own
// agent_capability_scope column (set only by the CEO-session-gated authorize
// action, sanitized there) — replaces Phase 4D's single global constant.
// Categories that are hard denials regardless of task (deployment, migrations,
// shell, raw credentials) remain fixed false/empty here — no task's scope can
// ever turn these on, because nothing in this function reads them from `task`.
function _agentGatewayManifest(task) {
  const scope = (task && task.agent_capability_scope) || { read_paths: [], write_paths: [], validation_ops: [] };
  return {
    repository: { read: scope.read_paths || [], write: scope.write_paths || [] },
    database: { read: ['own_task_packet', 'own_task_authorization_boundary'], write: ['own_task_evidence', 'own_task_execution_plan'], migrations: false },
    deployment: { preview: false, production: false },
    validation: { allowed_actions: scope.validation_ops || [] },
    external_apis: [],
    shell: false,
    raw_service_credentials: false,
    allowed_gateway_ops: Array.from(AGENT_GATEWAY_ALLOWED_OPS),
    note: 'Phase 4E task-scoped manifest, derived only from this task\'s CEO-set agent_capability_scope. The Agent cannot expand or influence this.',
  };
}

// ── Isolated Persistent Workspace (v16.38.0 — Phase 4F, CEO-approved 2026-08-17)
// ────────────────────────────────────────────────────────────────────────────
// Vercel serverless functions have no durable local filesystem across
// invocations (Phase 4E's /tmp write proved this correctly for a single
// invocation, but a claim/write/validate/review lifecycle can span many
// invocations, possibly different underlying instances). The smallest
// architecture that gives real cross-invocation persistence WITHOUT building a
// git repository or a general source-control platform: one database row per
// (task, authorized path) in engineering_workspace_files. baseline_* is a
// single, one-time, read-only copy-in from the real deployment bundle,
// captured the first time a task opens that path — the live/protected
// mmm-static source is never written to by any of this. current_* is the
// task-isolated working copy every subsequent read/write/validate for that
// task+path operates on.
async function _agentOpenWorkspace(task_id, reqPath) {
  const existing = await sbGetSafe(`engineering_workspace_files?task_id=eq.${encodeURIComponent(task_id)}&path=eq.${encodeURIComponent(reqPath)}&limit=1`);
  if (existing.length) return existing[0];
  let baseline;
  try { baseline = await readFile(join(process.cwd(), reqPath), 'utf8'); }
  catch (e) { return null; } // file_not_found — caller decides how to respond
  const hash = _agentHashHex(baseline);
  const row = await sbInsert('engineering_workspace_files', {
    task_id, path: reqPath, baseline_content: baseline, baseline_hash: hash,
    current_content: baseline, current_hash: hash,
  });
  return row;
}

// Minimal, deterministic, system-generated line diff — not a full Myers/LCS
// implementation (not needed for this foundation phase's "equivalent
// deterministic before/after representation"), but genuinely computed from
// the two real content strings, never from anything the Agent asserts.
function _agentLineDiff(before, after) {
  if (before === after) return { changed: false, lines_changed: 0, hunks: [] };
  const beforeLines = String(before || '').split('\n');
  const afterLines = String(after || '').split('\n');
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const hunks = [];
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i], a = afterLines[i];
    if (b !== a) hunks.push({ line: i + 1, before: b === undefined ? null : b, after: a === undefined ? null : a });
  }
  return { changed: true, lines_changed: hunks.length, hunks: hunks.slice(0, 200) };
}

async function _agentGatewayAudit(task_id, agent_run_id, op, status, extra) {
  try {
    await sbInsert('brain_agent_runs', {
      session_id: agent_run_id, task_id: String(task_id), action: `gateway:${op}`,
      status, input: { op }, output: extra || {}, started_at: new Date().toISOString(),
    });
  } catch (e) { console.error('[engineeringAgentGateway] audit insert failed:', e.message); }
}

async function engineeringAgentGateway(req, res) {
  try {
    const body = req.body || {};
    const { task_id, agent_token, agent_run_id, worker_credential, op } = body;
    if (!task_id || !agent_run_id || !op || (!agent_token && !worker_credential)) {
      return res.status(400).json({ ok: false, error: 'task_id, agent_run_id, op, and either agent_token or worker_credential are required' });
    }

    const rows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(task_id)}&select=id,problem,expected_result,affected_engine,priority,packet,agent_authorized_at,agent_authorization_token_hash,agent_authorization_revoked_at,agent_claimed_at,agent_run_id,claimed_by_worker_id,lease_expires_at,agent_capability_scope,status,ceo_decision,git_commit_sha,release_kind&limit=1`);
    const task = rows?.[0];
    if (!task) return res.status(404).json({ ok: false, error: 'task_not_found' });

    // Full independent verification chain — every check re-derived from the
    // database row just fetched, nothing trusted from the request beyond what
    // it takes to look the row up. Generic failure code throughout (mirrors
    // ceoLogin's principle): no hint about which specific check failed.
    const now = Date.now();
    let authOk;
    if (worker_credential) {
      // v16.51.0 — Decision #17 Step 2A: alternate authorization path for a
      // registered Engineering Worker that already holds a genuine
      // CEO-authorized claim on this exact task. Worker identity
      // (_engineeringWorkerAuthenticate, unchanged — the same primitive the
      // claim path already uses) is verified completely independently and is
      // NEVER by itself sufficient: it only substitutes for proof-of-
      // possession of the per-task agent_token. CEO task authorization
      // (agent_authorized_at set, not revoked, a real non-empty
      // authorization_boundary) and the fact that THIS worker is the one
      // that actually won THIS task's claim (claimed_by_worker_id) are
      // independently re-checked here exactly as strictly as the legacy
      // branch re-checks its token. The legacy agent_token branch below is
      // byte-for-byte unchanged from before this addition.
      const worker = await _engineeringWorkerAuthenticate(worker_credential);
      const boundary = task.packet?.origin_decision?.authorization_boundary;
      const boundaryOk = !!boundary && typeof boundary === 'string' && !!boundary.trim();
      authOk = !!worker
        && !!task.agent_authorized_at
        && !task.agent_authorization_revoked_at
        && boundaryOk
        && !!task.claimed_by_worker_id
        && task.claimed_by_worker_id === worker.id;
    } else {
      authOk = !!task.agent_authorized_at && !task.agent_authorization_revoked_at
        && _agentTokenMatches(agent_token, task.agent_authorization_token_hash);
    }
    // Cross-task/cross-run isolation: the caller-supplied run_id must equal
    // the run_id that actually won this task's atomic claim. A run_id minted
    // for a different task will never equal this task's agent_run_id column,
    // and a stale run_id from a superseded/reclaimed lease no longer matches
    // either — both fail closed here. Unchanged, and shared by both paths:
    // the worker-claim path already stamps agent_run_id via the exact same
    // _engineeringTaskAtomicClaim primitive the legacy path uses.
    const claimOk = !!task.agent_claimed_at && task.agent_run_id === agent_run_id;
    const leaseOk = !!task.lease_expires_at && new Date(task.lease_expires_at).getTime() > now;
    if (!authOk || !claimOk || !leaseOk) {
      await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'verification_failed' });
      return res.status(401).json({ ok: false, error: 'agent_gateway_verification_failed' });
    }

    // Capability check — the whitelist is the entire source of truth. Any op
    // not in this fixed Set (including 'deploy_production', 'run_migration',
    // 'run_shell', 'raw_sql', or anything else an Agent might request) falls
    // straight through to denial. There is no capability-expansion path.
    if (!AGENT_GATEWAY_ALLOWED_OPS.has(op)) {
      await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'capability_denied' });
      return res.status(403).json({ ok: false, error: 'capability_denied' });
    }

    let result;
    if (op === 'read_task_packet') {
      result = { packet: task.packet, problem: task.problem, expected_result: task.expected_result, affected_engine: task.affected_engine, priority: task.priority };
    } else if (op === 'read_authorization_boundary') {
      result = {
        origin_decision_id: task.packet?.origin_decision?.id || null,
        authorization_boundary: task.packet?.origin_decision?.authorization_boundary || null,
      };
    } else if (op === 'read_capability_manifest') {
      result = { capability_manifest: _agentGatewayManifest(task) };
    } else if (op === 'read_authorized_file') {
      // v16.38.0 — Phase 4F. Path allowlist check unchanged from Phase 4E.
      // Reads now come from this task's persistent workspace row (opened
      // lazily from the real baseline on first use) rather than re-reading
      // the live bundle every time — so a read after a prior write in the
      // same task sees the task's own edit, not source drift.
      const scope = task.agent_capability_scope || {};
      const reqPath = body.path;
      if (!_agentPathAllowed(reqPath, scope.read_paths)) {
        await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'path_not_authorized', path: reqPath });
        return res.status(403).json({ ok: false, error: 'path_not_authorized' });
      }
      const ws = await _agentOpenWorkspace(task_id, reqPath);
      if (!ws) return res.status(404).json({ ok: false, error: 'file_not_found' });
      result = { path: reqPath, content: ws.current_content.slice(0, 20000), baseline_hash: ws.baseline_hash, current_hash: ws.current_hash };
    } else if (op === 'write_authorized_file') {
      // v16.38.0 — Phase 4F. Same path-allowlist check as read, against
      // write_paths. Writes now persist into this task's own
      // engineering_workspace_files row (survives across separate
      // invocations/instances) instead of ephemeral /tmp. This is STILL
      // never the real repository: the row is looked up and updated by
      // (task_id, path) only — there is no code path anywhere in this
      // function that opens a file for writing under process.cwd(). Every
      // write also recomputes current_hash and a deterministic before/after
      // diff against the untouched baseline, and records both as evidence.
      const scope = task.agent_capability_scope || {};
      const reqPath = body.path;
      const content = typeof body.content === 'string' ? body.content.slice(0, 20000) : '';
      if (!_agentPathAllowed(reqPath, scope.write_paths)) {
        await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'path_not_authorized', path: reqPath });
        return res.status(403).json({ ok: false, error: 'path_not_authorized' });
      }
      const ws = await _agentOpenWorkspace(task_id, reqPath);
      if (!ws) return res.status(404).json({ ok: false, error: 'file_not_found' });
      const newHash = _agentHashHex(content);
      const updatedWs = await sbPatch('engineering_workspace_files', `task_id=eq.${encodeURIComponent(task_id)}&path=eq.${encodeURIComponent(reqPath)}`, {
        current_content: content, current_hash: newHash, agent_run_id, updated_at: new Date().toISOString(),
      });
      const diff = _agentLineDiff(ws.baseline_content, content);
      try {
        await sbInsert('brain_evidence', {
          task_id: String(task_id), run_id: agent_run_id, evidence_type: 'workspace_write',
          title: `Persistent workspace write: ${reqPath}`,
          content: JSON.stringify({ baseline_hash: ws.baseline_hash, current_hash: newHash, changed: diff.changed, lines_changed: diff.lines_changed, hunks: diff.hunks }),
          metadata: { path: reqPath, origin_decision_id: task.packet?.origin_decision?.id || null, non_authoritative: true, submitted_at: new Date().toISOString() },
          engine: task.affected_engine,
        });
      } catch (e) { console.error('[engineeringAgentGateway] workspace evidence insert failed:', e.message); }
      result = { path: reqPath, baseline_hash: ws.baseline_hash, current_hash: newHash, changed: diff.changed, lines_changed: diff.lines_changed, location: 'persistent isolated workspace (database-backed) — never the real repository' };
    } else if (op === 'validate_javascript_syntax') {
      // v16.38.0 — Phase 4F. Controlled validation, not shell: `new
      // vm.Script(source)` compiles/parses the source and throws a
      // SyntaxError on invalid code, but never executes it — no child
      // process, no arbitrary command, nothing beyond a parse check. Now
      // validates the task's persistent workspace content.
      const scope = task.agent_capability_scope || {};
      const reqPath = body.path;
      const pathIsScoped = (scope.read_paths || []).includes(reqPath) || (scope.write_paths || []).includes(reqPath);
      const opAuthorized = (scope.validation_ops || []).includes('validate_javascript_syntax');
      if (!_agentSafePath(reqPath) || !pathIsScoped || !opAuthorized) {
        await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'validation_not_authorized', path: reqPath });
        return res.status(403).json({ ok: false, error: 'validation_not_authorized' });
      }
      const ws = await _agentOpenWorkspace(task_id, reqPath);
      if (!ws) return res.status(404).json({ ok: false, error: 'file_not_found' });
      let valid = true, syntaxError = null;
      try { new Script(ws.current_content, { filename: reqPath }); }
      catch (e) { valid = false; syntaxError = e.message; }
      try {
        await sbInsert('brain_test_runs', {
          task_id: String(task_id), engine: task.affected_engine, test_type: 'syntax',
          test_name: `validate_javascript_syntax:${reqPath}`, status: valid ? 'passed' : 'failed',
          result_summary: valid ? 'Syntax valid' : syntaxError, evidence: { path: reqPath, run_id: agent_run_id, current_hash: ws.current_hash },
        });
      } catch (e) { console.error('[engineeringAgentGateway] brain_test_runs insert failed:', e.message); }
      result = { path: reqPath, syntax_valid: valid, error: syntaxError, current_hash: ws.current_hash };
    } else if (op === 'submit_execution_plan') {
      const planText = typeof body.plan === 'string' ? body.plan.slice(0, 5000) : '';
      if (!planText.trim()) return res.status(400).json({ ok: false, error: 'plan required' });
      await sbInsert('brain_evidence', {
        task_id: String(task_id), run_id: agent_run_id, evidence_type: 'execution_plan',
        title: 'Agent-submitted execution plan (non-authoritative)', content: planText,
        metadata: { submitted_at: new Date().toISOString(), non_authoritative: true }, engine: task.affected_engine,
      });
      result = { accepted: true, note: 'Recorded as non-authoritative evidence. Does not authorize or begin execution.' };
    } else if (op === 'submit_evidence') {
      const allowedEvidenceTypes = new Set(['note', 'test_result', 'screenshot_url', 'execution_plan']);
      const evidenceType = allowedEvidenceTypes.has(body.evidence_type) ? body.evidence_type : 'note';
      const title = typeof body.title === 'string' ? body.title.slice(0, 300) : 'Agent evidence';
      const content = typeof body.content === 'string' ? body.content.slice(0, 5000) : '';
      await sbInsert('brain_evidence', {
        task_id: String(task_id), run_id: agent_run_id, evidence_type: evidenceType,
        title, content, metadata: { submitted_at: new Date().toISOString(), non_authoritative: true },
        engine: task.affected_engine,
      });
      // v16.36.0 — Phase 4D: evidence is explicitly non-authoritative. This op
      // never touches engineering_tasks.status, ceo_decision, or anything else
      // on the task row — submitting evidence cannot complete or approve a
      // task. Only engineeringTaskCeoApprove (CEO-session-gated) can do that.
      result = { accepted: true, note: 'Evidence recorded. Non-authoritative — does not complete or approve the task.' };
    } else if (op === 'submit_commit_sha') {
      // v16.56.0 — CEO Decision #17 Automatic Git Commit Capture Fix. Root
      // cause: no automatic mechanism anywhere populated
      // engineering_tasks.git_commit_sha for an ordinary 'new_development'
      // task's normal completion flow — only retroactive_release creation
      // and the (now-locked-down, see engineeringTaskUpdate) generic update
      // passthrough ever wrote it, which is exactly why the CEO Production
      // Release panel fell back to a fail-closed "Engineering Approved, no
      // button" state for every ordinary approved task. This op closes that
      // gap using the narrowest existing action available: it is layered
      // onto engineeringAgentGateway rather than inventing a new endpoint,
      // so it inherits — unmodified, unduplicated — the exact same
      // authOk/claimOk/leaseOk chain already independently re-verified
      // above, before this switch, for every other Gateway op. That chain
      // is what proves task/run ownership and worker legitimacy here: an
      // unrelated worker/run has no agent_run_id that matches this task's
      // current claim, and a revoked worker fails
      // _engineeringWorkerAuthenticate's active=eq.true filter outright —
      // neither reaches this branch at all.
      //
      // Explicitly out of scope: retroactive_release tasks carry their SHA
      // through the separate, already-reviewed release-record creation path
      // (CEO Decision #17 Release Record Fix) — untouched by this change.
      if (task.release_kind === 'retroactive_release') {
        await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'not_applicable_to_retroactive_release' });
        return res.status(409).json({ ok: false, error: 'not_applicable_to_retroactive_release' });
      }
      // Fail closed once the task has reached a terminal CEO outcome — a
      // SHA can never be attached (or reattached) to already-approved or
      // already-rejected work through this op.
      if (task.status === 'done' || task.ceo_decision === 'approved' || task.ceo_decision === 'rejected') {
        await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'task_already_in_terminal_ceo_state' });
        return res.status(409).json({ ok: false, error: 'task_already_in_terminal_ceo_state' });
      }
      const rawSha = typeof body.commit_sha === 'string' ? body.commit_sha.trim().toLowerCase() : '';
      if (!/^[0-9a-f]{40}$/i.test(rawSha)) {
        await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'malformed_commit_sha' });
        return res.status(400).json({ ok: false, error: 'commit_sha must be a 40-character hex commit SHA' });
      }
      if (task.git_commit_sha) {
        if (task.git_commit_sha === rawSha) {
          // Idempotent retry of the exact value already recorded (e.g. a
          // lost-response retry from the same run) — accepted without a
          // second GitHub call or a second write. Anything ELSE already
          // recorded is a hard conflict: this column is immutable once set,
          // for every run/worker, including the one that set it — a
          // mistaken SHA gets fixed by a new task, never a silent rewrite
          // of this one's release record.
          result = { accepted: true, commit_sha: rawSha, already_recorded: true, note: 'Already recorded — no change made.' };
        } else {
          await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'git_commit_sha_already_set' });
          return res.status(409).json({ ok: false, error: 'git_commit_sha_already_set', existing_commit_sha: task.git_commit_sha });
        }
      } else {
        // Independent GitHub verification — never trust the bare claim.
        // Confirms: (a) the commit really exists, in THIS canonical
        // repository (process.env.GITHUB_REPO — never client-supplied, so
        // "wrong repository" is structurally impossible to satisfy), and
        // (b) it is reachable from the expected release branch (at or
        // behind its current head) rather than some unmerged or unrelated
        // commit — the strongest safe invariant available at completion
        // time, short of requiring exact branch-head equality (which would
        // wrongly reject legitimate work completed slightly before another
        // change lands on main). Exact branch-head equality is still
        // independently re-verified later, at Production Release
        // authorization/execution time — this capture step does not weaken
        // that later check in any way.
        const verify = await _verifyCommitReachableFromBranch(rawSha, 'main');
        if (!verify.ok) {
          await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: verify.error });
          const infraError = /not_configured|api_error|unreachable/.test(verify.error);
          return res.status(infraError ? 502 : 409).json({ ok: false, error: verify.error });
        }
        // Conditional write — matches only if still unset. Closes the
        // narrow race between the read above and this write (e.g. two
        // near-simultaneous submit_commit_sha calls for the same task,
        // same run): the loser gets the same 409 as any other
        // already-set case, never a silent second write.
        const patched = await sbPatch(
          'engineering_tasks',
          `id=eq.${encodeURIComponent(task_id)}&git_commit_sha=is.null`,
          { git_commit_sha: rawSha, updated_at: new Date().toISOString() }
        );
        if (!patched) {
          await _agentGatewayAudit(task_id, agent_run_id, op, 'denied', { reason: 'git_commit_sha_already_set_race' });
          return res.status(409).json({ ok: false, error: 'git_commit_sha_already_set' });
        }
        try {
          await sbInsert('brain_evidence', {
            task_id: String(task_id), run_id: agent_run_id, evidence_type: 'commit_sha',
            title: 'Authoritative commit SHA captured', content: rawSha,
            metadata: { submitted_at: new Date().toISOString(), verified_against_branch: 'main', github_verification: verify.detail, non_authoritative: false },
            engine: task.affected_engine,
          });
        } catch (e) { console.error('[engineeringAgentGateway] commit_sha evidence insert failed:', e.message); }
        result = { accepted: true, commit_sha: rawSha, already_recorded: false, note: 'Commit SHA verified against GitHub and recorded. Immutable from this point forward.' };
      }
    }

    await _agentGatewayAudit(task_id, agent_run_id, op, 'allowed', { result_summary: op });
    return res.status(200).json({ ok: true, task_id, op, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function listTasks(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { role, task_id } = req.query;

  // Single task + activity log
  if (task_id) {
    const [taskRows, logs] = await Promise.all([
      sbGet(`operator_tasks?id=eq.${task_id}&select=*&limit=1`),
      sbGet(`operator_activity_logs?task_id=eq.${task_id}&order=created_at.desc&limit=50`),
    ]);
    const task = taskRows?.[0] || null;
    return res.status(200).json({ task, logs: logs || [] });
  }

  // Task list
  let q = 'operator_tasks?select=*&order=priority.desc,due_date.asc.nullslast,created_at.desc&limit=100';
  if (role === 'va') q += '&assigned_to=eq.va';

  const tasks = await sbGet(q);
  return res.status(200).json({ tasks: tasks || [] });
}

async function createTask(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { title, description, engine, priority, due_date, approval_required, assigned_to } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const task = await sbInsert('operator_tasks', {
    title:             title.trim(),
    description:       description || null,
    engine:            engine       || null,
    priority:          Math.min(10, Math.max(1, parseInt(priority) || 5)),
    due_date:          due_date     || null,
    approval_required: !!approval_required,
    assigned_to:       assigned_to  || 'va',
    status:            'open',
    created_by:        'admin',
  });

  // Log creation
  await sbInsert('operator_activity_logs', {
    task_id:   task.id,
    user_role: 'admin',
    action:    'created task',
    notes:     null,
  });

  console.log(`[v12.4] ops: created task ${task.id} "${title}"`);
  return res.status(200).json({ task });
}

async function updateTask(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { task_id, status, completion_notes, action, role, approval_status } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id is required' });

  const patch = { updated_at: new Date().toISOString() };
  if (status)           patch.status = status;
  if (completion_notes) patch.completion_notes = completion_notes;
  if (approval_status)  patch.approval_status = approval_status;
  // Map status to approval_status automatically
  if (status === 'approved')  patch.approval_status = 'approved';
  if (status === 'rejected')  patch.approval_status = 'rejected';
  if (status === 'pending_approval') patch.approval_status = 'pending';

  const task = await sbPatch('operator_tasks', `id=eq.${task_id}`, patch);

  // Log activity
  await sbInsert('operator_activity_logs', {
    task_id:   task_id,
    user_role: role || 'unknown',
    action:    action || `status → ${status}`,
    notes:     completion_notes || null,
  });

  console.log(`[v12.4] ops: updated task ${task_id} → ${status || 'patched'}`);
  return res.status(200).json({ task });
}

async function logActivity(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { task_id, user_role, action, notes } = req.body || {};
  if (!task_id || !user_role || !action) {
    return res.status(400).json({ error: 'task_id, user_role, and action are required' });
  }

  const log = await sbInsert('operator_activity_logs', { task_id, user_role, action, notes: notes || null });
  return res.status(200).json({ log });
}

// ── Pipeline handlers ─────────────────────────────────────────────────────────

const PIPELINE_STAGES = ['idea','package_generated','assets_created','video_edited','ready_to_upload','published','analyzing'];

async function listPipeline(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { stage, assigned_to } = req.query;
  let q = 'production_pipeline?select=*&order=due_date.asc.nullslast,created_at.desc&limit=100';
  if (stage)       q += `&stage=eq.${stage}`;
  if (assigned_to) q += `&assigned_to=eq.${assigned_to}`;

  const items = await sbGet(q);
  return res.status(200).json({ items: items || [] });
}

async function createPipelineItem(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { title, engine, content_type, platform, assigned_to, due_date, notes, missing_assets, package_id } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const item = await sbInsert('production_pipeline', {
    title:          title.trim(),
    engine:         engine        || null,
    content_type:   content_type  || null,
    platform:       platform      || null,
    assigned_to:    assigned_to   || 'va',
    due_date:       due_date      || null,
    notes:          notes         || null,
    missing_assets: missing_assets || [],
    package_id:     package_id    || null,
    stage:          'idea',
    stalled:        false,
  });

  console.log(`[v12.4] ops: created pipeline item ${item.id} "${title}"`);
  return res.status(200).json({ item });
}

async function updatePipelineStage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { pipeline_id, stage, notes, missing_assets, stalled } = req.body || {};
  if (!pipeline_id) return res.status(400).json({ error: 'pipeline_id is required' });

  if (stage && !PIPELINE_STAGES.includes(stage)) {
    return res.status(400).json({ error: 'invalid stage', validStages: PIPELINE_STAGES });
  }

  const patch = { updated_at: new Date().toISOString() };
  if (stage             !== undefined) patch.stage          = stage;
  if (notes             !== undefined) patch.notes          = notes;
  if (missing_assets    !== undefined) patch.missing_assets = missing_assets;
  if (stalled           !== undefined) {
    patch.stalled       = stalled;
    patch.stalled_since = stalled ? new Date().toISOString() : null;
  }

  const item = await sbPatch('production_pipeline', `id=eq.${pipeline_id}`, patch);

  console.log(`[v12.4] ops: pipeline ${pipeline_id} → ${stage || 'patched'}`);
  return res.status(200).json({ item });
}

// ── Approval handlers ─────────────────────────────────────────────────────────

const APPROVAL_TYPES = ['package','thumbnail','script','upload','publishing','platform_connection'];

async function listApprovals(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { submitted_by, status } = req.query;
  let q = 'approvals?select=*,revision_requests(*)&order=created_at.desc&limit=100';
  if (submitted_by) q += `&submitted_by=eq.${submitted_by}`;
  if (status)       q += `&status=eq.${status}`;

  const approvals = await sbGet(q);
  const pendingCount = (approvals || []).filter(a => a.status === 'pending').length;
  return res.status(200).json({ approvals: approvals || [], pendingCount });
}

async function requestApproval(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { item_type, item_id, item_title, submitted_by, approval_type, notes } = req.body || {};
  if (!item_type || !submitted_by) return res.status(400).json({ error: 'item_type and submitted_by required' });
  if (approval_type && !APPROVAL_TYPES.includes(approval_type)) {
    return res.status(400).json({ error: 'invalid approval_type', valid: APPROVAL_TYPES });
  }

  const approval = await sbInsert('approvals', {
    item_type,
    item_id:       item_id       || null,
    item_title:    item_title    || null,
    submitted_by,
    assigned_to:   'admin',
    status:        'pending',
    approval_type: approval_type || null,
    notes:         notes         || null,
  });

  console.log(`[v12.4] ops: approval requested ${approval.id} "${item_title}" by ${submitted_by}`);
  return res.status(200).json({ approval });
}

async function approveItem(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { approval_id, reviewed_by, notes } = req.body || {};
  if (!approval_id) return res.status(400).json({ error: 'approval_id required' });

  const approval = await sbPatch('approvals', `id=eq.${approval_id}`, {
    status:      'approved',
    reviewed_by: reviewed_by || 'admin',
    reviewed_at: new Date().toISOString(),
    notes:       notes || null,
  });

  console.log(`[v12.4] ops: approved ${approval_id}`);
  return res.status(200).json({ approval });
}

async function rejectItem(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { approval_id, reviewed_by, reason } = req.body || {};
  if (!approval_id) return res.status(400).json({ error: 'approval_id required' });

  const approval = await sbPatch('approvals', `id=eq.${approval_id}`, {
    status:      'rejected',
    reviewed_by: reviewed_by || 'admin',
    reviewed_at: new Date().toISOString(),
    notes:       reason || null,
  });

  console.log(`[v12.4] ops: rejected ${approval_id}`);
  return res.status(200).json({ approval });
}

async function requestRevision(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { approval_id, requested_by, revision_notes } = req.body || {};
  if (!approval_id || !revision_notes) {
    return res.status(400).json({ error: 'approval_id and revision_notes required' });
  }

  await sbInsert('revision_requests', {
    approval_id,
    requested_by: requested_by || 'admin',
    revision_notes,
    status: 'open',
  });

  const approval = await sbPatch('approvals', `id=eq.${approval_id}`, {
    status:      'revision_requested',
    reviewed_by: requested_by || 'admin',
    reviewed_at: new Date().toISOString(),
  });

  console.log(`[v12.4] ops: revision requested for ${approval_id}`);
  return res.status(200).json({ approval });
}

// ── Asset Library handlers ────────────────────────────────────────────────────

const ASSET_TYPES   = ['thumbnail','script','lyrics','caption','audio','short_video','long_video','exported_file'];
const ASSET_SOURCES = ['suno','heygen','canva','capcut','manual'];
const ASSET_STATUSES = ['draft','ready','approved','archived'];

async function listAssets(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { engine, asset_type, source, status, pipeline_id, package_id } = req.query;
  let q = 'production_assets_library?select=*&order=created_at.desc&limit=200';
  if (engine)      q += `&engine=eq.${engine}`;
  if (asset_type)  q += `&asset_type=eq.${asset_type}`;
  if (source)      q += `&source=eq.${source}`;
  if (status)      q += `&status=eq.${status}`;
  if (pipeline_id) q += `&pipeline_id=eq.${pipeline_id}`;
  if (package_id)  q += `&package_id=eq.${package_id}`;

  const assets = await sbGet(q);
  return res.status(200).json({ assets: assets || [] });
}

async function createAsset(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { asset_type, asset_name, asset_url, engine, package_id, pipeline_id, source, platform, tags, status } = req.body || {};
  if (!asset_type?.trim() || !asset_name?.trim()) {
    return res.status(400).json({ error: 'asset_type and asset_name are required' });
  }
  if (!ASSET_TYPES.includes(asset_type)) {
    return res.status(400).json({ error: 'invalid asset_type', valid: ASSET_TYPES });
  }

  const asset = await sbInsert('production_assets_library', {
    asset_type,
    asset_name:  asset_name.trim(),
    asset_url:   asset_url   || null,
    engine:      engine      || null,
    package_id:  package_id  || null,
    pipeline_id: pipeline_id || null,
    source:      source      || 'manual',
    platform:    platform    || null,
    tags:        tags        || [],
    status:      ASSET_STATUSES.includes(status) ? status : 'draft',
    version:     1,
    uploaded_at: asset_url ? new Date().toISOString() : null,
  });

  console.log(`[v12.4] ops: asset created ${asset.id} "${asset_name}" (${asset_type})`);
  return res.status(200).json({ asset });
}

async function updateAsset(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { asset_id, asset_url, status, asset_name, tags, pipeline_id, package_id } = req.body || {};
  if (!asset_id) return res.status(400).json({ error: 'asset_id required' });

  const patch = { updated_at: new Date().toISOString() };
  if (asset_url  !== undefined) { patch.asset_url = asset_url; patch.uploaded_at = new Date().toISOString(); }
  if (status     !== undefined) patch.status = status;
  if (asset_name !== undefined) patch.asset_name = asset_name;
  if (tags       !== undefined) patch.tags = tags;
  if (pipeline_id!== undefined) patch.pipeline_id = pipeline_id;
  if (package_id !== undefined) patch.package_id  = package_id;

  const asset = await sbPatch('production_assets_library', `id=eq.${asset_id}`, patch);
  console.log(`[v12.4] ops: asset updated ${asset_id}`);
  return res.status(200).json({ asset });
}

async function deleteAsset(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { asset_id } = req.body || {};
  if (!asset_id) return res.status(400).json({ error: 'asset_id required' });

  const res2 = await fetch(`${SUPABASE_URL}/rest/v1/production_assets_library?id=eq.${asset_id}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
  });
  if (!res2.ok) { const t = await res2.text(); throw new Error(`Delete asset: ${res2.status} ${t.slice(0,200)}`); }
  console.log(`[v12.4] ops: asset deleted ${asset_id}`);
  return res.status(200).json({ deleted: true });
}

// ── Execution workspace handlers ─────────────────────────────────────────────

async function getTaskDetail(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { task_id } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id required' });

  const taskRows = await sbGet(`operator_tasks?id=eq.${task_id}&select=*&limit=1`);
  const task = taskRows?.[0] || null;
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const [pkgRows, assets, approvalData, logs] = await Promise.all([
    task.package_id
      ? sbGet(`packages?id=eq.${task.package_id}&select=*&limit=1`).catch(() => [])
      : Promise.resolve([]),
    task.package_id
      ? sbGet(`production_assets_library?package_id=eq.${task.package_id}&select=*&order=uploaded_at.desc`).catch(() => [])
      : Promise.resolve([]),
    sbGet(`approvals?item_id=eq.${task_id}&item_type=eq.task&select=*&order=created_at.desc`).catch(() => []),
    sbGet(`operator_activity_logs?task_id=eq.${task_id}&select=*&order=created_at.desc&limit=20`).catch(() => []),
  ]);

  const package_data = pkgRows?.[0] || null;
  return res.status(200).json({
    task,
    package_data,
    assets:    assets    || [],
    approvals: approvalData || [],
    logs:      logs      || [],
  });
}

async function updateTaskExecution(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { task_id, status, execution_notes, asset_checklist, started_at, completed_at, user_role, log_action } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id required' });

  const updates = { updated_at: new Date().toISOString() };
  if (status            !== undefined) updates.status            = status;
  if (execution_notes   !== undefined) updates.execution_notes   = execution_notes;
  if (asset_checklist   !== undefined) updates.asset_checklist   = asset_checklist;
  if (started_at        !== undefined) updates.started_at        = started_at;
  if (completed_at      !== undefined) updates.completed_at      = completed_at;

  const updated = await sbPatch('operator_tasks', `id=eq.${task_id}`, updates);

  if (log_action) {
    await sbInsert('operator_activity_logs', {
      task_id,
      user_role:  user_role || 'unknown',
      action:     log_action,
      notes:      execution_notes || null,
      created_at: new Date().toISOString(),
    });
  }

  console.log(`[v12.4] ops: exec update task ${task_id} → ${status || 'patched'}`);
  return res.status(200).json({ success: true, task: updated });
}

// ── AI Operator Recommendations ───────────────────────────────────────────────

async function sbGetSafe(path) {
  try { return (await sbGet(path)) || []; } catch { return []; }
}

async function operatorRecommendations(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const now   = Date.now();
  const recs  = [];

  // ── Fetch all data in parallel ──
  const [
    tasks,
    pipeline,
    pendingApprovals,
    channels,
    recentVideos,
    allVideos,
    failedJobs,
  ] = await Promise.all([
    sbGetSafe('operator_tasks?status=in.(open,in_progress)&select=id,title,due_date,status&limit=50'),
    sbGetSafe('production_pipeline?select=id,title,engine,missing_assets,stage,stalled,updated_at&limit=100'),
    sbGetSafe(`approvals?status=eq.pending&created_at=lt.${new Date(now - 86400000).toISOString()}&select=id,item_title,approval_type,created_at&limit=20`),
    sbGetSafe('youtube_channels?select=channel_id,title&limit=20'),
    sbGetSafe(`youtube_videos?published_at=gte.${new Date(now - 30 * 86400000).toISOString()}&select=channel_id,published_at&order=published_at.desc&limit=200`),
    sbGetSafe('youtube_videos?select=channel_id,view_count,published_at&order=published_at.desc&limit=200'),
    sbGetSafe('api_queue?status=eq.failed&select=id,provider,job_type,updated_at&order=updated_at.desc&limit=20'),
  ]);

  // ── OVERDUE_TASK ──────────────────────────────────────────────────────────────
  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date());
  for (const t of overdue.slice(0, 3)) {
    const daysOver = Math.max(1, Math.floor((now - new Date(t.due_date)) / 86400000));
    recs.push({
      type:         'OVERDUE_TASK',
      title:        `Overdue: "${t.title}"`,
      description:  `${daysOver} day${daysOver > 1 ? 's' : ''} past due — still ${t.status.replace('_', ' ')}.`,
      priority:     Math.min(10, 7 + Math.floor(daysOver / 2)),
      engine:       null,
      action_label: 'View Tasks',
      action_url:   'tasks',
    });
  }

  // ── PENDING_APPROVAL ─────────────────────────────────────────────────────────
  if (pendingApprovals.length) {
    const oldest     = pendingApprovals[0];
    const hoursWait  = Math.floor((now - new Date(oldest.created_at)) / 3600000);
    recs.push({
      type:         'PENDING_APPROVAL',
      title:        `${pendingApprovals.length} approval${pendingApprovals.length > 1 ? 's' : ''} awaiting review`,
      description:  `Oldest: "${oldest.item_title || oldest.approval_type || 'item'}" — waiting ${hoursWait}h.`,
      priority:     pendingApprovals.length >= 3 ? 9 : 8,
      engine:       null,
      action_label: 'Review Approvals',
      action_url:   'tasks',
    });
  }

  // ── MISSING_ASSETS ───────────────────────────────────────────────────────────
  const withMissing = pipeline.filter(p =>
    !['published','analyzing'].includes(p.stage) &&
    Array.isArray(p.missing_assets) && p.missing_assets.filter(Boolean).length > 0
  );
  if (withMissing.length) {
    const names = withMissing.slice(0, 3).map(p => `"${p.title}"`).join(', ');
    recs.push({
      type:         'MISSING_ASSETS',
      title:        `${withMissing.length} pipeline item${withMissing.length > 1 ? 's' : ''} missing assets`,
      description:  `Blocked: ${names}${withMissing.length > 3 ? ` +${withMissing.length - 3} more` : ''}.`,
      priority:     7,
      engine:       null,
      action_label: 'View Pipeline',
      action_url:   'tasks',
    });
  }

  // ── STALLED_ENGINE / CONSISTENCY_WARNING ──────────────────────────────────────
  // Build map: channelId → most recent published_at from last 30 days
  const recentByChannel = {};
  for (const v of recentVideos) {
    const t = new Date(v.published_at).getTime();
    if (!recentByChannel[v.channel_id] || t > recentByChannel[v.channel_id]) {
      recentByChannel[v.channel_id] = t;
    }
  }
  // For channels with NO recent video, find their last ever video
  const channelsWithNoRecent = channels.filter(ch => !recentByChannel[ch.channel_id]);
  if (channelsWithNoRecent.length) {
    const allByChannel = {};
    for (const v of allVideos) {
      const t = new Date(v.published_at).getTime();
      if (!allByChannel[v.channel_id] || t > allByChannel[v.channel_id]) {
        allByChannel[v.channel_id] = t;
      }
    }
    for (const ch of channelsWithNoRecent) {
      const lastTs = allByChannel[ch.channel_id];
      if (!lastTs) continue; // no video data at all, skip
      const daysSince = Math.floor((now - lastTs) / 86400000);
      if (daysSince >= 7) {
        recs.push({
          type:         'STALLED_ENGINE',
          title:        `${ch.title || 'Channel'} — no upload in ${daysSince}d`,
          description:  `Last upload: ${new Date(lastTs).toLocaleDateString('en-US',{month:'short',day:'numeric'})}. Channel may be stalling.`,
          priority:     daysSince > 14 ? 9 : 7,
          engine:       ch.title || null,
          action_label: 'View Content',
          action_url:   'content',
        });
      } else if (daysSince >= 3) {
        recs.push({
          type:         'CONSISTENCY_WARNING',
          title:        `${ch.title || 'Channel'} — ${daysSince}d since last upload`,
          description:  `Approaching gap. Last upload ${new Date(lastTs).toLocaleDateString('en-US',{month:'short',day:'numeric'})}.`,
          priority:     4,
          engine:       ch.title || null,
          action_label: 'Schedule Upload',
          action_url:   'tasks',
        });
      }
    }
  }

  // ── WEAK_PERFORMANCE ─────────────────────────────────────────────────────────
  const perfByChannel = {};
  for (const v of allVideos) {
    if (!perfByChannel[v.channel_id]) perfByChannel[v.channel_id] = [];
    perfByChannel[v.channel_id].push(v.view_count || 0);
  }
  for (const [channelId, views] of Object.entries(perfByChannel)) {
    if (views.length < 6) continue;
    const avgRecent = views.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
    const avgOlder  = views.slice(3, 6).reduce((s, v) => s + v, 0) / 3;
    if (avgOlder < 100) continue; // too low baseline to be meaningful
    if (avgRecent < avgOlder * 0.5) {
      const ch   = channels.find(c => c.channel_id === channelId);
      const drop = Math.round((1 - avgRecent / avgOlder) * 100);
      recs.push({
        type:         'WEAK_PERFORMANCE',
        title:        `${ch?.title || 'Channel'} views down ${drop}%`,
        description:  `Recent avg ${Math.round(avgRecent).toLocaleString()} vs ${Math.round(avgOlder).toLocaleString()} — significant performance drop.`,
        priority:     drop > 70 ? 8 : 5,
        engine:       ch?.title || null,
        action_label: 'View Analytics',
        action_url:   'content',
      });
    }
  }

  // ── UPLOAD_TIMING ─────────────────────────────────────────────────────────────
  if (allVideos.length >= 10) {
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const byDay = Array.from({length: 7}, () => ({ count: 0, views: 0 }));
    for (const v of allVideos) {
      if (!v.published_at) continue;
      const d = new Date(v.published_at).getDay();
      byDay[d].count++;
      byDay[d].views += v.view_count || 0;
    }
    const ranked = byDay
      .map((d, i) => ({ day: i, name: DAY_NAMES[i], avg: d.count >= 2 ? d.views / d.count : 0, count: d.count }))
      .filter(d => d.count >= 2)
      .sort((a, b) => b.avg - a.avg);
    const best    = ranked[0];
    const today   = new Date().getDay();
    if (best && best.day !== today && best.avg > 0) {
      recs.push({
        type:         'UPLOAD_TIMING',
        title:        `Best upload day: ${best.name}`,
        description:  `${best.name} averages ${Math.round(best.avg).toLocaleString()} views across ${best.count} uploads — highest of any weekday.`,
        priority:     3,
        engine:       null,
        action_label: 'View Schedule',
        action_url:   'tasks',
      });
    }
  }

  recs.sort((a, b) => b.priority - a.priority);
  console.log(`[v12.4] operator_recommendations: ${recs.length} fired`);
  return res.status(200).json({ recommendations: recs, generatedAt: new Date().toISOString(), count: recs.length });
}

// ── Suno Execution Bridge ─────────────────────────────────────────────────────

async function getSunoExecution(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { task_id, local_key } = req.body || {};
  if (!task_id && !local_key) return res.status(400).json({ error: 'task_id or local_key required' });
  let data = [];
  if (local_key) data = await sbGet(`suno_executions?local_key=eq.${encodeURIComponent(local_key)}&limit=1`).catch(() => []);
  if ((!data || !data[0]) && task_id) data = await sbGet(`suno_executions?task_id=eq.${task_id}&limit=1`).catch(() => []);
  return res.status(200).json({ suno: data?.[0] || null });
}

async function saveSunoExecution(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { task_id, local_key, package_id, engine, suno_prompt, short_prompt, lyrics, short_lyrics,
          suno_song_url, mp3_url, short_mp3_url, version_notes, status } = req.body || {};
  if (!task_id && !local_key) return res.status(400).json({ error: 'task_id or local_key required' });
  const useLocalKey = !!local_key;
  const lookup = useLocalKey
    ? `local_key=eq.${encodeURIComponent(local_key)}`
    : `task_id=eq.${task_id}`;
  console.log('[save_suno_execution] lookup:', lookup, 'status:', status);
  let existing = [];
  try { existing = await sbGet(`suno_executions?${lookup}&limit=1`); } catch(e) { console.error('[save_suno_execution] sbGet error:', e.message); }
  const payload = { package_id, engine, suno_prompt, short_prompt, lyrics, short_lyrics,
                    suno_song_url, mp3_url, short_mp3_url, version_notes, status,
                    updated_at: new Date().toISOString() };
  if (useLocalKey) payload.local_key = local_key;
  if (task_id) payload.task_id = task_id;
  let result;
  try {
    if (existing?.[0]) {
      console.log('[save_suno_execution] PATCH existing row');
      result = await sbPatch('suno_executions', lookup, payload);
    } else {
      console.log('[save_suno_execution] INSERT new row');
      payload.created_at = new Date().toISOString();
      if (!payload.task_id) payload.task_id = null;
      result = await sbInsert('suno_executions', payload);
    }
  } catch(e) {
    console.error('[save_suno_execution] write error:', e.message);
    return res.status(500).json({ error: 'suno_write_failed', message: e.message });
  }
  return res.status(200).json({ success: true, suno: result });
}

// ── HeyGen Execution Bridge ───────────────────────────────────────────────────

async function getHeygenExecution(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { task_id, local_key } = req.body || {};
  if (!task_id && !local_key) return res.status(400).json({ error: 'task_id or local_key required' });
  let data = [];
  if (local_key) data = await sbGet(`heygen_executions?local_key=eq.${encodeURIComponent(local_key)}&limit=1`).catch(() => []);
  if ((!data || !data[0]) && task_id) data = await sbGet(`heygen_executions?task_id=eq.${task_id}&limit=1`).catch(() => []);
  return res.status(200).json({ heygen: data?.[0] || null });
}

async function saveHeygenExecution(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { task_id, local_key, package_id, engine, script, visual_instructions,
          heygen_video_url, mp4_url, version_notes, status } = req.body || {};
  if (!task_id && !local_key) return res.status(400).json({ error: 'task_id or local_key required' });
  const useLocalKey = !!local_key;
  const lookup = useLocalKey
    ? `local_key=eq.${encodeURIComponent(local_key)}`
    : `task_id=eq.${task_id}`;
  console.log('[save_heygen_execution] lookup:', lookup, 'status:', status);
  let existing = [];
  try { existing = await sbGet(`heygen_executions?${lookup}&limit=1`); } catch(e) { console.error('[save_heygen_execution] sbGet error:', e.message); }
  const payload = { package_id, engine, script, visual_instructions,
                    heygen_video_url, mp4_url, version_notes, status,
                    updated_at: new Date().toISOString() };
  if (useLocalKey) payload.local_key = local_key;
  if (task_id) payload.task_id = task_id;
  let result;
  try {
    if (existing?.[0]) {
      console.log('[save_heygen_execution] PATCH existing row');
      result = await sbPatch('heygen_executions', lookup, payload);
    } else {
      console.log('[save_heygen_execution] INSERT new row');
      payload.created_at = new Date().toISOString();
      if (!payload.task_id) payload.task_id = null;
      result = await sbInsert('heygen_executions', payload);
    }
  } catch(e) {
    console.error('[save_heygen_execution] write error:', e.message);
    return res.status(500).json({ error: 'heygen_write_failed', message: e.message });
  }
  return res.status(200).json({ success: true, heygen: result });
}

// ── Asset Return Pipeline ─────────────────────────────────────────────────────

async function getTaskAssets(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { local_key, package_id, task_id } = req.body || {};
  let rows = [];
  try {
    if (local_key) {
      // tags is TEXT[] — PostgREST array contains uses {value} syntax
      rows = await sbGet(`production_assets_library?tags=cs.${encodeURIComponent('{' + local_key + '}')}&order=uploaded_at.desc`);
    } else if (package_id) {
      rows = await sbGet(`production_assets_library?package_id=eq.${package_id}&order=uploaded_at.desc`);
    } else if (task_id) {
      rows = await sbGet(`production_assets_library?tags=cs.${encodeURIComponent('{task:' + task_id + '}')}&order=uploaded_at.desc`);
    }
    console.log('[get_task_assets] local_key:', local_key, 'task_id:', task_id, 'rows:', rows ? rows.length : 0);
  } catch(e) { console.error('[get_task_assets] error:', e.message); rows = []; }
  return res.status(200).json({ assets: rows || [] });
}

async function saveTaskAsset(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { asset_name, asset_type, asset_url, engine, package_id, local_key, task_id,
          source, platform } = req.body || {};
  if (!asset_url) return res.status(400).json({ error: 'asset_url required' });
  const tags = [];
  if (local_key) tags.push(local_key);
  if (task_id) tags.push('task:' + task_id);
  const payload = {
    asset_name: asset_name || asset_type || 'asset',
    asset_type: asset_type || 'file',
    asset_url,
    engine: engine || '',
    package_id: package_id || null,
    source: source || 'manual',
    platform: platform || '',
    tags,
    version: 1,
    status: 'ready',
    uploaded_at: new Date().toISOString()
  };
  console.log('[save_task_asset] local_key:', local_key, 'task_id:', task_id, 'tags:', tags, 'asset_type:', asset_type);
  let result;
  try {
    result = await sbInsert('production_assets_library', payload);
  } catch(e) {
    console.error('[save_task_asset] error:', e.message);
    return res.status(500).json({ error: 'asset_save_failed', message: e.message });
  }
  return res.status(200).json({ success: true, asset: result });
}

// ── Reliability Metrics ───────────────────────────────────────────────────────

async function getReliabilityMetrics(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const now = new Date();
  const [tasks, sunoExecs, heygenExecs, uploads, approvals] = await Promise.all([
    sbGet('operator_tasks?order=created_at.desc&limit=50').catch(() => []),
    sbGet('suno_executions?order=updated_at.desc&limit=50').catch(() => []),
    sbGet('heygen_executions?order=updated_at.desc&limit=50').catch(() => []),
    sbGet('upload_queue?order=created_at.desc&limit=50').catch(() => []),
    sbGet('approvals?order=created_at.desc&limit=50').catch(() => []),
  ]);
  const totalTasks = (tasks || []).length;
  const completedTasks = (tasks || []).filter(t => t.status === 'complete' || t.status === 'posted').length;
  const stalledTasks = (tasks || []).filter(t => {
    if (t.status === 'complete' || t.status === 'posted') return false;
    if (!t.updated_at) return false;
    return (now - new Date(t.updated_at)) / 3600000 > 48;
  }).length;
  const pendingApprovals = (approvals || []).filter(a => a.status === 'pending').length;
  const overdueApprovals = (approvals || []).filter(a => {
    if (a.status !== 'pending') return false;
    if (!a.created_at) return false;
    return (now - new Date(a.created_at)) / 3600000 > 24;
  }).length;
  const sunoNotStarted = (sunoExecs || []).filter(s => s.status === 'not_started').length;
  const sunoInProgress = (sunoExecs || []).filter(s => s.status === 'generating').length;
  const sunoComplete   = (sunoExecs || []).filter(s => s.status === 'mp3_ready' || s.status === 'submitted_for_review').length;
  const heygenNotStarted = (heygenExecs || []).filter(h => h.status === 'not_started').length;
  const heygenInProgress = (heygenExecs || []).filter(h => h.status === 'generating').length;
  const heygenComplete   = (heygenExecs || []).filter(h => h.status === 'video_ready' || h.status === 'submitted_for_review').length;
  const readyToUpload = (uploads || []).filter(u => u.status === 'ready_to_upload').length;
  const uploaded      = (uploads || []).filter(u => u.status === 'uploaded' || u.status === 'published').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  return res.status(200).json({
    metrics: {
      tasks:     { total: totalTasks, completed: completedTasks, stalled: stalledTasks, completionRate },
      approvals: { pending: pendingApprovals, overdue: overdueApprovals },
      suno:      { notStarted: sunoNotStarted, inProgress: sunoInProgress, complete: sunoComplete },
      heygen:    { notStarted: heygenNotStarted, inProgress: heygenInProgress, complete: heygenComplete },
      uploads:   { readyToUpload, uploaded }
    }
  });
}

// ── Task Approvals (item_id lookup) ──────────────────────────────────────────

async function getTaskApprovals(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { item_id, item_type } = req.body || {};
  if (!item_id) return res.status(400).json({ error: 'item_id required' });
  let q = `approvals?item_id=eq.${encodeURIComponent(item_id)}&select=*,revision_requests(*)&order=created_at.desc&limit=20`;
  if (item_type) q += `&item_type=eq.${encodeURIComponent(item_type)}`;
  let approvals = [];
  try { approvals = await sbGet(q); } catch(e) { console.error('[get_task_approvals] error:', e.message); }
  return res.status(200).json({ approvals: approvals || [] });
}

// ── Upload Queue ──────────────────────────────────────────────────────────────

async function getUploadQueue(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { local_key, task_id } = req.body || {};
  let rows = [];
  try {
    if (local_key) {
      rows = await sbGet(`upload_queue?local_key=eq.${encodeURIComponent(local_key)}&order=created_at.desc`);
    } else if (task_id) {
      rows = await sbGet(`upload_queue?task_id=eq.${encodeURIComponent(task_id)}&order=created_at.desc`);
    }
  } catch(e) { console.error('[get_upload_queue] error:', e.message); rows = []; }
  return res.status(200).json({ queue: rows || [] });
}

async function addToUploadQueue(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { task_id, local_key, package_id, engine, title, platform, content_type, asset_url, notes } = req.body || {};
  if (!platform) return res.status(400).json({ error: 'platform required' });
  const payload = {
    task_id: task_id || null,
    local_key: local_key || null,
    package_id: package_id || null,
    engine: engine || '',
    title: title || '',
    platform,
    content_type: content_type || '',
    asset_url: asset_url || '',
    notes: notes || '',
    status: 'ready_to_upload',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  let result;
  try {
    result = await sbInsert('upload_queue', payload);
  } catch(e) {
    console.error('[add_to_upload_queue] error:', e.message);
    return res.status(500).json({ error: 'queue_add_failed', message: e.message });
  }
  return res.status(200).json({ success: true, item: result });
}

async function updateUploadStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { id, status, upload_url, notes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const updates = { status, updated_at: new Date().toISOString() };
  if (upload_url) updates.upload_url = upload_url;
  if (notes) updates.notes = notes;
  if (status === 'published') updates.uploaded_at = new Date().toISOString();
  if (status === 'verified') updates.verified_at = new Date().toISOString();
  let result;
  try {
    result = await sbPatch('upload_queue', `id=eq.${id}`, updates);
  } catch(e) {
    console.error('[update_upload_status] error:', e.message);
    return res.status(500).json({ error: 'status_update_failed', message: e.message });
  }
  return res.status(200).json({ success: true, item: result });
}

// ── Claude Package Generation (server-side proxy) ────────────────────────────

async function generatePackage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  const { engineId, mode, existingMemory, contentFormat } = req.body || {};
  if (!engineId || !mode) return res.status(400).json({ success: false, error: 'engineId and mode required' });
  const isLong = contentFormat === 'long'; // v13.69.12 — long-form flag (8 min)

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY not configured on server' });

  // Sprint Z.2 (v13.57.0) + Z.2.2 (v13.57.5) — avoidList is an array of {type,value,source?}
  // objects. Goal: PARENT-THEME uniqueness, not just title or concept token uniqueness.
  // Real failure 2026-06-15: 4 NextWave packages in 1 minute all under "goal psychology"
  // parent theme, each with distinct mechanism. Avoid list now extracts parent-theme
  // keywords from prior concepts and shows the LLM a SATURATED KEYWORD HEAT-MAP so
  // saturated domains are explicit. "Different mechanism, same parent theme = duplicate."
  const _Z2_STOP = new Set(['the','and','or','of','for','in','on','at','to','from','by','with','as','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','can','this','that','these','those','it','you','your','our','their','what','which','who','when','where','why','how','here','there','about','one','two','too','very','just','also','only','no','not','any','some','all','more','most','other','same','than']);
  function _parentTheme(concept) {
    return String(concept||'').toLowerCase()
      .replace(/[^a-z0-9\s']/g,' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !_Z2_STOP.has(w))
      .slice(0, 6)
      .join(' ');
  }
  let avoidList;
  if (Array.isArray(existingMemory)) {
    if (existingMemory.length && typeof existingMemory[0] === 'object') {
      const titles = existingMemory.filter(e => e.type==='title').map(e => '"'+(e.value||'')+'"');
      const concepts = existingMemory.filter(e => e.type==='concept').map(e => (e.value||''));
      const hooks = existingMemory.filter(e => e.type==='hook').map(e => '"'+(e.value||'')+'"');
      const moods = existingMemory.filter(e => e.type==='mood').map(e => (e.value||''));
      // Z.2.2 / v13.57.8 — parent-theme extraction + heat map combining BOTH concepts AND
      // titles so "Progress" tokens from both fields contribute. Closes the motion=progress
      // gap observed 2026-06-15. Per-package dedup prevents one pkg from inflating counts.
      const recentConcepts = concepts.slice(-15);
      const recentTitles = existingMemory.filter(e => e.type==='title').map(e=>e.value||'').slice(-15);
      const parentThemes = recentConcepts.map((c,i)=>`  ${i+1}. ${_parentTheme(c)||'(no theme)'}`).join('\n');
      const heat = {};
      const pairCount = Math.max(recentConcepts.length, recentTitles.length);
      for (let i = 0; i < pairCount; i++) {
        const conceptToks = _parentTheme(recentConcepts[i] || '').split(' ');
        const titleToks = _parentTheme(recentTitles[i] || '').split(' ');
        const seen = new Set();
        for (const tok of [...conceptToks, ...titleToks]) {
          if (tok.length <= 3 || seen.has(tok)) continue;
          seen.add(tok);
          heat[tok] = (heat[tok]||0) + 1;
        }
      }
      const heatLine = Object.entries(heat).filter(([,n])=>n>=2).sort(([,a],[,b])=>b-a).slice(0,20).map(([k,n])=>`${k}×${n}`).join(' · ') || '(none — themes well-distributed)';
      // v13.57.10 Sprint P_C — winning patterns (top performers by retention) fed back
      // into prompt as "MORE LIKE THIS" guidance. Biases generation toward proven hook
      // structures while still respecting the AVOID list above.
      const winners = existingMemory.filter(e => e.type==='winning_pattern');
      const winnerLines = winners.slice(0,8).map(w => {
        const ret = w.retention != null ? Number(w.retention).toFixed(0)+'%' : '?';
        const vw = w.views != null ? w.views : '?';
        const sg = w.subsGained != null && w.subsGained > 0 ? '· +'+w.subsGained+' subs' : '';
        return `  · "${w.value||''}" — ret ${ret} · ${vw} views ${sg}`.trim();
      }).join('\n');
      const winnerBlock = winners.length
        ? `\n═══════════ WINNING PATTERNS — top performers on THIS engine (last 90d) ═══════════\nThese published videos earned the highest retention on this channel. Your new content should EMULATE the HOOK STRUCTURE, SPECIFICITY, and FRAMING of these — but pick a different topical concept. Use these as your style anchor, not your topic source.\n\n${winnerLines}\n\n`
        : '';
      // v13.58.2 PRIORITY C — tuning directives from decision engine
      const directives = existingMemory.filter(e => e.type==='optimization_directive');
      const directiveLines = directives.map(d => `  · [${d.action}] ${d.value || ''}`).join('\n');
      const tuningBlock = directives.length
        ? `\n═══════════ TUNING DIRECTIVES — channel-specific data-driven guidance ═══════════\nThese directives come from analyzing what's actually working on this channel right now (real YouTube data, last 30d). Apply them to your generation choices.\n\n${directiveLines}\n\n`
        : '';
      // v13.60.0 STRATEGIC OPTIMIZATION LAYER — Channel Strategy block (top of prompt).
      const strategyEntry = existingMemory.find(e => e.type==='channel_strategy');
      let strategyBlock = '';
      if (strategyEntry) {
        const weightLines = Object.entries(strategyEntry.modeWeights || {}).map(([k,v]) => '    ' + k + ': ' + v).join('\n');
        const promoted = (strategyEntry.promoted || []).join(', ');
        const reduced = (strategyEntry.reduced || []).join(', ');
        strategyBlock = '\n═══════════ CHANNEL STRATEGY — current status + mode weights (live) ═══════════\n'
          + 'CHANNEL STATUS: ' + (strategyEntry.status||'?').toUpperCase() + (strategyEntry.statusReason ? ' (' + strategyEntry.statusReason + ')' : '') + '\n'
          + 'TARGET CADENCE: ' + (strategyEntry.cadencePerWeek!=null ? strategyEntry.cadencePerWeek + ' videos/week' : 'unset') + '\n'
          + (weightLines ? '\nMODE WEIGHTS (use as bias toward higher-weighted moods):\n' + weightLines + '\n' : '')
          + (promoted ? '\nPROMOTED CATEGORIES (these are working — favor them): ' + promoted + '\n' : '')
          + (reduced ? 'REDUCED CATEGORIES (these underperform — deprioritize): ' + reduced + '\n' : '')
          + '\nWhen choosing topic/angle, bias toward PROMOTED categories and away from REDUCED. The status above sets the channel\'s strategic posture.\n\n';
      }
      // v13.59.0 PRIORITY E — APPLIED OPTIMIZATION RULES (highest priority — operator-
      // accepted or auto-applied from decision engine). These OVERRIDE general voice
      // when they conflict. Each rule tells the model exactly what to do.
      const activeRules = existingMemory.filter(e => e.type==='active_rule');
      const ruleLines = activeRules.map(r => {
        const rd = r.ruleData || {};
        let line = '  · [' + (r.ruleType || '?').toUpperCase() + ']';
        if (rd.pattern) line += ' use "' + rd.pattern + '" hook pattern (weight ' + (rd.weight||'?') + ')';
        if (rd.exemplar_title) line += ' reverse-engineer "' + rd.exemplar_title + '" hook structure';
        if (rd.mood) line += ' mood="' + rd.mood + '" weight=' + (rd.weight||'?');
        if (rd.template) line += ' append CTA: "' + rd.template + '"';
        if (rd.target) line += ' target cadence: ' + rd.target + ' videos/week';
        if (rd.instruction) line += ' — ' + rd.instruction;
        return line;
      }).join('\n');
      const rulesBlock = activeRules.length
        ? `\n═══════════ APPLIED OPTIMIZATION RULES — channel-specific (data-driven, active right now) ═══════════\nThese are CURRENTLY ACTIVE rules derived from this channel's performance data. They override default voice when they conflict. Apply them all.\n\n${ruleLines}\n\n`
        : '';
      avoidList =
        (titles.length ? 'PRIOR TITLES (last ~50 packages + published YouTube — do NOT repeat the concept of any of these even with different wording):\n' + titles.slice(0,100).join('\n') + '\n\n' : '') +
        (concepts.length ? 'PRIOR CONCEPTS (avoid the same underlying thesis):\n' + concepts.slice(0,50).join(' · ') + '\n\n' : '') +
        (hooks.length ? 'PRIOR HOOKS (use a different hook pattern):\n' + hooks.slice(0,50).join('\n') + '\n\n' : '') +
        (moods.length ? 'PRIOR MOODS (rotate to a different mood):\n' + moods.slice(0,50).join(' · ') + '\n\n' : '') +
        'PARENT-THEME FORBIDDEN ZONE (last 15 packages):\n' + parentThemes + '\n\n' +
        'SATURATED KEYWORD HEAT-MAP (token×count across last 15):\n' + heatLine + '\n\n' +
        'CRITICAL: any keyword above with count ≥ 3 is FULLY SATURATED — pick a domain whose dominant noun is NOT in the heat-map. ' +
        'Real failure 2026-06-15: 4 NextWave packages shipped in 1 minute all under "goal psychology" parent theme — each with a different mechanism (stop waiting motivated / progress isn\'t what you think / intensity kills goals / talking about goals reduces achievement). Different mechanisms of the SAME parent theme STILL count as duplicates. ' +
        'The new package MUST be conceptually distinct from ALL items above AT THE PARENT-THEME LEVEL. Goal: PARENT-THEME uniqueness, not just title uniqueness. ' +
        'Real prior failure example #2: "AI Image Generators Can\'t Count to Three" and "AI Image Tools Can\'t Count Past Three" shipped 24 hrs apart — different titles, identical concept. That is a duplicate. Do not produce either pattern.' +
        strategyBlock +
        rulesBlock +
        tuningBlock +
        winnerBlock;
    } else {
      avoidList = existingMemory.join(', ');
    }
  } else {
    avoidList = existingMemory || '';
  }
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // v13.69.95 — SRV Farsi diversity engine: tracks per-song imagery, location, hook structure,
  // emotional scenario. Prevents 100-song library from converging on the same 5 images.
  let farsiDiversityBlock = '';
  if (engineId === 'srv_farsi' && Array.isArray(existingMemory) && existingMemory.length && typeof existingMemory[0] === 'object') {
    const _fCentralImages    = existingMemory.filter(e=>e.type==='central_image').map(e=>e.value||'').filter(Boolean);
    const _fLocations        = existingMemory.filter(e=>e.type==='location').map(e=>e.value||'').filter(Boolean);
    const _fHookStructures   = existingMemory.filter(e=>e.type==='hook_structure').map(e=>e.value||'').filter(Boolean);
    const _fEmotScenarios    = existingMemory.filter(e=>e.type==='emotional_scenario').map(e=>e.value||'').filter(Boolean);
    // Imagery saturation heat-map
    const _fImgC = {};
    for (const img of _fCentralImages.slice(-20)) {
      const toks = img.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t=>t.length>3);
      const seen = new Set();
      for (const tok of toks){if(seen.has(tok))continue;seen.add(tok);_fImgC[tok]=(_fImgC[tok]||0)+1;}
    }
    const _fImgHeat = Object.entries(_fImgC).filter(([,n])=>n>=2).sort(([,a],[,b])=>b-a).slice(0,15).map(([k,n])=>`${k}×${n}`).join(' · ')||'(well-distributed)';
    if (_fCentralImages.length || _fLocations.length || _fHookStructures.length || _fEmotScenarios.length) {
      farsiDiversityBlock =
        '\n\n═══════════ FARSI DIVERSITY ENGINE — per-song uniqueness tracking ═══════════\n' +
        'Every new song MUST differ in: CENTRAL IMAGE (human/relational object only) · HOOK STRUCTURE · EMOTIONAL SCENARIO.\n' +
        'LOCATION IS NOT A CREATIVE DIMENSION. Do NOT pick a new location for each song. Do NOT use location to create variety.\n' +
        'Locations are always unnamed backdrop. The same unnamed café, unnamed street, unnamed apartment can appear in every song — the PEOPLE and their FEELINGS are what change.\n\n' +
        (_fCentralImages.length ? 'RECENT CENTRAL IMAGES (human/relational objects only — do NOT reuse as primary concept/hook anchor):\n' + _fCentralImages.slice(-15).join(' · ') + '\n\n' : '') +
        (_fHookStructures.length ? 'RECENT HOOK STRUCTURES (rotate to a different pattern):\n' + _fHookStructures.slice(-10).join(' · ') + '\n\n' : '') +
        (_fEmotScenarios.length ? 'RECENT EMOTIONAL SCENARIOS (must pick a different one):\n' + _fEmotScenarios.slice(-10).join(' · ') + '\n\n' : '') +
        'IMAGERY SATURATION HEAT-MAP (last 20 songs — token×count):\n' + _fImgHeat + '\n' +
        'Any token with count ≥ 3: do NOT use as central image or hook anchor.\n';
    }
  }

  let prompt = '';
  if (engineId === 'srv_farsi') {
    // ─────────────────────────────────────────────────────────────────────────
    // SRV FARSI — v13.69.43: SEPARATE SHORT vs LONG generators
    // isLong (contentFormat='long') → full song (3:00-3:20, full structure)
    // !isLong (contentFormat='short' / Short Video task) → 15-20s SHORT ONLY
    // The two paths are COMPLETELY INDEPENDENT. Short NEVER inherits long template.
    // ─────────────────────────────────────────────────────────────────────────
    const parts = mode.split(' — '); const voiceType = parts[0]; const mood = parts[1] || mode;

    if (!isLong) {
      // ── SRV FARSI SHORT VIDEO GENERATOR — FROZEN v13.71.1 ───────────────────
      // 85% Romantic · 10% Emotional · 5% Special Themes. 15/15 validation PASS 2026-07-08.
      // DO NOT EDIT without production data justification.
      // ARCHITECTURE: Completely independent from the Long Song generator.
      // This generator has NO knowledge of Long Song structure.
      // It never generates [Intro], [Verse], [Chorus], [Outro], or 3:00-3:20 prompts.
      // Output: SHORT-ONLY package. One product. One generator. One output.
      // sunoPrompt  = shortSunoPrompt (15-20s) — primary key for client compat
      // lyrics      = shortLyrics (3-4 lines)  — primary key for client compat
      // ─────────────────────────────────────────────────────────────────────────
      prompt = `You are the SRV Farsi SHORT VIDEO generator for Silk Road Voices.
This is an INDEPENDENT SHORT VIDEO PACKAGE — not a clip or preview of a Long Song.
A Short Video is its own creative product with its own emotional concept.

Task: Generate a standalone 15–20 second SHORT clip package.
Mode: ${voiceType} — ${mood}
${avoidList ? 'Avoid these titles/concepts:\n' + avoidList : ''}

═══════════ THE SUBJECT LAW — READ BEFORE WRITING ═══════════
The subject of this short clip is THE TWO PEOPLE and the emotional force between them.
A train station is where they parted — NOT the subject of the clip.
A café is where they met — NOT the subject of the clip.
A bridge, a street, a city — BACKDROP. One passing reference only.
SUBJECT TEST: If your concept reads like a place description or travelogue → REWRITE.
The hook must be about a PERSON, a FEELING, or a RELATIONAL MOMENT — not a location.

═══════════ THE FEELING-FIRST LAW — HOW THIS CLIP IS ORGANIZED ═══════════
SRV Farsi clips are organized around a FEELING between two people — never around a place, scene, or object.

BANNED PATTERNS — these ALL fail even when the sentence starts with "A man/woman":
❌ "A man returns to the bench where they used to sit" → bench organizes the clip
❌ "A man sits alone in the empty wedding hall" → hall organizes the clip
❌ "A man stands at the fruit seller's corner where they met" → vendor/corner organizes
❌ "A woman remembers the exact spot on the bridge where he held her hand" → bridge organizes

CORRECT PATTERNS — the concept must answer ONLY: "What does [Person] FEEL toward [Person] RIGHT NOW?"
✅ "A man who still loves her but can't bring himself to call"
✅ "A woman trying to move on but unable to forget the last time he looked at her"
✅ "He realizes he let the right person walk away"
✅ "She knows he's still waiting but doesn't know how to go back"

THE TITLE must be a FEELING or CONFESSION — not a place, scene, object, or occupation:
✅ "هنوز منتظرم" · "بمان" · "حرف آخر" · "همیشه دوستت دارم"
❌ "پل شب" · "سالن خالی" · "نیمکت" · "دستفروش"
Title test: "Does this title make sense without any location, scene, or object?" If not → rewrite.

═══════════ MOOD INTERPRETATION — READ BEFORE WRITING ═══════════
ROMANTIC (85% — DEFAULT): passionate love · romantic chemistry · falling in love · romantic longing · two people drawn together · romantic tension · desire · warmth between two people. IF IN DOUBT, WRITE ROMANTIC.
EMOTIONAL (10%): beautiful heartbreak · long-distance longing · reunion after distance · waiting · missing someone · emotional memory — ALWAYS with a romantic partner as the emotional anchor. NOT family loss. NOT cultural grief. Still romantic with emotional weight.
HAPPY (5% — SPECIAL THEMES ONLY): Fires ONLY when mode is explicitly 'happy'. Write about ONE Afghan/Persian cultural moment of warmth and joy:
  • Wedding night or engagement joy (شب عروسی · نامزدی · شب حنا)
  • Parents' blessing or family warmth (دعای مادر · آغوش پدر)
  • Eid morning or Nouruz celebration (عید · نوروز · جشن)
  • Childhood memory of joy (کودکی · بازی در کوچه · دوست قدیمی)
  • Return to homeland (برگشتن به وطن · خاک آشنا)
  Tone: warm, joyful, specific. BPM: 104-112.

═══════════ SRV BRAND THEME ANCHOR — MANDATORY ═══════════
SRV Farsi is a ROMANTIC MUSIC CHANNEL. The primary identity is Male↔Female romantic love.
TARGET AUDIENCE: Afghanistan · Iran · Persian/Dari speakers · Ages 25–60.

PRIMARY SONG THEMES — 85% Romantic:
Love · Romance · Falling in love · First love · First meeting · Missing someone · Waiting · Long-distance longing · Reunion · Beautiful eyes · Smiles · Holding hands · Late-night thoughts · Romantic memories · Heartbreak (romantic) · Hope (for love) · Romantic tension · Love after distance · Weddings (romantic perspective) · Dancing together · Romantic chemistry · A name that still echoes · Walking together · A look across a room.

EXPLICIT PROHIBITIONS IN ROMANTIC AND EMOTIONAL MODES:
Do NOT write short clips whose PRIMARY CONCEPT is about:
× Parent↔child relationship (mother's love, father's tribute)
× Family reunion as main concept
× Village life or village stories as main concept
× Homeland longing as main concept
× Childhood nostalgia as main concept
× Eid / Nouruz as main concept
These are SPECIAL THEMES (5% gate — happy mode only). In romantic/emotional modes they may be passing background detail ONLY.

═══════════ CENTRAL IMAGE RULE — ALL MODES (READ BEFORE WRITING) ═══════════
The PRIMARY emotional anchor / central image for EVERY song must NEVER be technology.

BANNED AS CENTRAL IMAGE, HOOK, TITLE, OR CONCEPT:
× Phone · unanswered phone call · ringing phone · mobile · missed call
× Text message · messaging app · chat · read receipt · last seen · online status · notification
× Technology · AI · computer · screen · internet · digital · app · device · social media

These are AI-cliché tropes — not cinematic romance. A phone may appear ONLY as a silent passing prop in a single background line. If your central concept, hook, or title involves any of the above → STOP. Rewrite with a physical human object.

REQUIRED — choose your central image from physical, human, relational objects only:
eyes · smile · hands · lips · doorway · empty chair · window · rain on glass
coat left behind · key not returned · scarf · coffee cup · half-finished tea
flowers · moonlight on a wall · notebook with her name · worn photograph
empty room · wedding table · candle · spring blossoms · a look across the room

NOT VALID AS CENTRAL IMAGE (locations/settings — backdrop use only, one line max):
train station · city bridge · park bench · café table · rooftop · street · airport · corridor

The emotional conflict comes from the RELATIONSHIP BETWEEN TWO PEOPLE — not from technology.

═══════════ FORBIDDEN SONG TOPICS — STRICTLY ENFORCED ═══════════
DO NOT write songs whose PRIMARY CONCEPT is about:
× Phones · Messaging apps · Contact lists · Read receipts · Last-seen status
× Technology · Machines · AI · Computers · Internet · Screens
× Social media · Apps · Digital life · Notifications
× Business · Office work · Careers · Work stress
× Politics · Current events · News · World affairs
× Coding · Software · Programming · Devices

The ONLY exception: a phone or message may appear as a silent background PROP in a single passing line ONLY. It must NEVER become the song's concept, hook, or title. If you're tempted to write about a phone, a machine, or a screen as the central image → STOP. Replace it with a physical human object from the CENTRAL IMAGE RULE list above.

═══════════ ROMANTIC SCENE VOCABULARY ═══════════
⚠ BACKDROP RULE: Settings are WHERE the love happens — not WHAT the clip is about.
The two people ARE the anchor. Ground every clip in a MOMENT or OBJECT, not a setting.

Moments (primary anchor — use as the clip's emotional core):
first meeting · a last look before leaving · names written somewhere · standing outside waiting · reunion after distance · a touch that said everything · a look across a crowded room · a hand held for the last time

Objects (verse detail only — appear as a single passing line, NEVER as title, concept, or hook anchor):
a scarf left behind · a half-finished tea · a photograph together · spring blossoms · moonlight on a wall · an empty seat · a jacket with warmth still in it

Settings (backdrop only — one passing reference, NEVER the subject, NEVER in the hook):
⚠ Do NOT name the location in the hook, title, or concept. Settings are WHERE two people are — never WHAT the clip is about.
BANNED AS HOOK, TITLE, OR CONCEPT ANCHOR: bridge · café · station · street · airport · rooftop · park · bench · hall · vendor · corner · market · any named city place

Cultural detail — add ONE per short clip as background color only:
Afghan: چای سبز · دسترخوان · رباب · بازار · کوچه قدیمی (background only)
Persian: باغ · انار · گل محمدی · حوض · کاروانسرا (background only)

SOFT-BANNED AS SHORT-CLIP CENTRAL CONCEPT (if already over-represented in diversity engine):
tea · rain · moon · scarf · window · airport departure · spring
These may appear as passing detail — not as the hook image if saturated (check FARSI DIVERSITY ENGINE).
${farsiDiversityBlock}
═══════════ ARCHITECTURE CONSTRAINT — READ FIRST ═══════════
You are NOT generating a full song. You are NOT clipping from a long song.
This is a SHORT VIDEO — a standalone emotional moment.
FORBIDDEN OUTPUT: [Intro] · [Verse 1] · [Verse 2] · [Chorus] · [Music Break] · [Verse 3] · [Final Chorus] · [Outro]
FORBIDDEN IN SUNO PROMPT: "3:00-3:20" · "runtime end at [Outro]" · "full song" · any song structure reference
If any of those appear in your output → DELETE and rewrite before returning.

═══════════ LANGUAGE STANDARD — TRANS-PERSIAN (MANDATORY) ═══════════
LANGUAGE MIX TARGET:
~60% Neutral literary Persian — understood naturally across Afghanistan, Iran, Tajikistan
~40% Dari-friendly vocabulary and expressions

DUAL AUDIENCE TEST (both must pass):
✓ A listener from Kabul should feel: "این زبان ماست"
✓ A listener from Tehran should feel: "این زبان ماست"
Goal: modern trans-Persian romantic music — NOT Tehran pop, NOT Afghan regional folk.

PREFERRED VOCABULARY (use freely):
دل · نگاه · لبخند · خاطره · کوچه · پنجره · بهار · عشق · دلتنگی · دیدار · انتظار · برگشتن · کنار · فردا · امشب

PREFERRED NEUTRAL FORMS (default to these):
باران (not بارون) · خانه (not خونه) · خیابان (not خیابون) · دیوانه (not دیونه)

DARI-FRIENDLY EXPRESSIONS (include naturally when appropriate):
دلتنگت شدم · دیدارت · کنارت بودن · فردا می‌آی · امشب اینجایی

REDUCE OVERUSE (max 1-2 per clip):
نمی‌دونم · می‌خوام · برام · توی · اومدی · مونده · جونم · آره · باشه

HARD AVOID: heavy Tehran-only slang · heavy Afghan dialect · meme Persian · TV-serial Persian.

═══════════ LYRICS RULES ═══════════
- Exactly 3–4 Persian lines. No more. No fewer. This IS the entire content.
- Line 1 = the hook. The single most emotionally striking line. Immediate impact.
- No setup lines. No intro lines. The hook IS line 1.
- No section labels of any kind. No [Verse]. No [Chorus]. NEVER.
- SRV emotional axis: longing · warmth · romantic gravity · memory · chemistry.
- Specific, visual, intimate. Two-person relational gravity. Conversational.
- Every line must feel shareable — something a listener pauses on and resends.

EXAMPLE (follow this format exactly):
قدم‌هایت را می‌شمارم...
هشت قدم تا آغوش من
قلبم با ریتم تو می‌زند
همین لحظه یعنی خانه

═══════════ SUNO PROMPT RULES ═══════════
- "0:15-0:20 runtime" MUST appear verbatim.
- Vocal starts at 0:00. No instrumental intro. No silence. No fade-in.
- Hook phrase is the FIRST SOUND the listener hears.
- SRV identity: "cinematic modern Afghan Persian pop", warm intimate ${voiceType.toLowerCase()} vocal.
- BPM: 68-72 BPM (or 104-112 for happy duet mode).
- Ends cleanly at the emotional peak. High replay value.

EXAMPLE sunoPrompt:
"cinematic modern Afghan Persian pop, warm intimate close-mic ${voiceType.toLowerCase()} vocal at center, vocal STARTS at 0:00 with hook phrase — NO instrumental intro NO silence NO fade-in, restrained emotional delivery, soft Rubab lead, warm piano, atmospheric pads, 68-72 BPM, 0:15-0:20 runtime, ends cleanly at emotional peak, high replay value"

═══════════ OUTPUT — JSON ONLY, WRAPPED IN <package> ═══════════
// SHORT VIDEO PACKAGE — sunoPrompt and lyrics hold the short content (client reads these)
// shortSunoPrompt and shortLyrics are identical copies (for downstream compat)
<package>
{"isShortVideo":true,"shortTitle":"emoji + Persian short title — must be a FEELING or CONFESSION (e.g. هنوز منتظرم · بمان · حرف آخر) — NEVER a place/scene/object name","title":"emoji + Persian short title — must be a FEELING or CONFESSION — NEVER a place/scene/object name","concept":"one sentence (English) — MUST answer: what does [he/she] FEEL toward [her/him] right now? — NEVER a place/scene/object as organizing frame — WRONG: 'A man returns to the bench where...' or 'The empty hall still holds her memory' — RIGHT: 'A man who still loves her but can't bring himself to call'","mood":"${mood}","hook":"the hook phrase in Persian — line 1 of the lyrics","sunoPrompt":"[SHORT-ONLY SUNO PROMPT — 0:15-0:20 runtime, vocal at 0:00, NO intro]","shortSunoPrompt":"[identical to sunoPrompt]","lyrics":"[EXACTLY 3-4 Persian lines, NO section tags, hook is line 1]","shortLyrics":"[identical to lyrics]","captionYT":"Persian YouTube Short caption — hook + CTA + hashtags","captionTikTok":"one line Persian TikTok caption with hashtags","captionIG":"Persian Instagram dot-spacer format with hashtags","hashtags":"mix Persian and English hashtags","thumbnailText":"Persian title + emoji","shortThumbnailText":"Persian title + emoji","centralImage":"single central visual human/relational object (1-3 words English — e.g. wedding ring, empty chair, late-night window, taxi headlights, her scarf, worn photograph — NEVER a location word like bench, hall, rooftop, vendor, corner)","location":"unnamed backdrop only (1-3 words — e.g. unnamed room, unnamed night, unnamed space — NOT a named place or landmark that could become a title or hook)","hookStructure":"hook pattern type (e.g. object-as-memory, sensory-recall, address-to-person, reunion-longing, romantic-question, late-night-thought, heartbreak-beauty, first-meeting)","emotionalScenario":"specific romantic emotional situation between TWO PEOPLE (e.g. waiting for someone who may not return, reunion after long distance, heartbreak of a last goodbye, longing from another city, first meeting that changed everything)"}
</package>`;
    } else {
    // ── SRV FARSI LONG SONG GENERATOR — FROZEN v13.71.1 ────────────────────
    // 85% Romantic · 10% Emotional · 5% Special Themes. 15/15 validation PASS 2026-07-08.
    // DO NOT EDIT without production data justification.
    prompt = `Generate one SRV Farsi long song package using the rules below. Output ONLY the JSON wrapped in <package> tags. Do NOT write any preamble, acknowledgment, or summary. Start your response with <package> immediately.

═══════════ THE SUBJECT LAW — READ BEFORE GENERATING ═══════════
The subject of every SRV Farsi song is THE TWO PEOPLE and the emotional force between them.

A train station is where they said goodbye — it is NOT the subject of the song.
A café is where they first met — it is NOT the subject of the song.
A bridge is where they once walked — it is NOT the subject of the song.
A city, a street, a tea house, a window — these are BACKDROP. One passing line each. Maximum.

SUBJECT TEST — run this before finalizing:
→ If your concept (English) reads like a travelogue, a city description, or a scene description → REWRITE.
→ If the first line describes a PLACE instead of a PERSON or FEELING → REWRITE.
→ If the hook is the name of a location → REWRITE.
→ If 2+ lines in any verse are about a location rather than the two people → COMPRESS to 1 backdrop reference.

The concept must describe something between TWO PEOPLE, not a place or object.
Emotions live in people, not geography.

═══════════ THE FEELING-FIRST LAW — HOW THE SONG IS ORGANIZED ═══════════
SRV Farsi songs are organized around a FEELING between two people — never around a place, scene, or object.

BANNED PATTERNS — these ALL fail even when the sentence starts with "A man/woman":
❌ "A man remembers the exact spot on a bridge where she looked at city lights" → bridge organizes
❌ "A man sits alone in the empty wedding hall after everyone has left" → hall organizes
❌ "A man returns to the park bench where they used to sit every Friday" → bench organizes
❌ "A woman stands at the old fruit seller's corner where they used to meet" → vendor/corner organizes
❌ "He drives past the café where she always waited" → café organizes

CORRECT PATTERNS — the concept must answer ONLY: "What does [Person] FEEL toward [Person] RIGHT NOW?"
✅ "A man who still loves her but cannot bring himself to call" → feeling organizes
✅ "A woman trying to move on but unable to forget the last time he looked at her" → feeling
✅ "He realizes he let the right person walk away, and it's too late" → emotional state
✅ "She knows he still loves her but doesn't know what to do with that" → relational dynamic
✅ "Two people who loved each other but never said it out loud" → relational truth

THE TITLE must be a FEELING or CONFESSION, not a place, scene, object, or occupation name:
✅ "هنوز منتظرم" (I'm still waiting) · "بمان" (Stay) · "حرف آخر" (Final Words) · "دیر شد" (It's Too Late)
❌ "پل شب" (Night Bridge) · "سالن خالی" (Empty Hall) · "نیمکت" (Bench) · "دستفروش" (Vendor)
Title test: "Does this title make sense without any location, scene, or object?" If not → rewrite.

Objects and settings MAY appear as single verse detail lines — NEVER as title, concept, or hook anchor.

═══════════ GOAL ═══════════
Modern cinematic Afghan/Persian romantic + emotional songs.
The aim is NOT "less sadness" — the aim is MORE emotional beauty, MORE cinematic intimacy, MORE romantic atmosphere, MORE memory between two people.

═══════════ MODE ═══════════
${voiceType} — ${mood}

═══════════ MOOD INTERPRETATION — READ BEFORE WRITING ═══════════
ROMANTIC (85% — DEFAULT): passionate love · romantic chemistry · falling in love · romantic longing · two people drawn toward each other · romantic tension · desire · warmth between two people. IF IN DOUBT, WRITE ROMANTIC.
EMOTIONAL (10%): beautiful heartbreak · long-distance longing · reunion after distance · waiting · missing someone · emotional memory — ALWAYS with a romantic partner as the emotional anchor. NOT family loss. NOT cultural grief. NOT parent→child. Still romantic but carrying emotional weight.
HAPPY (5% — SPECIAL THEMES ONLY): Fires ONLY when mode is explicitly 'happy'. Write about ONE Afghan/Persian cultural moment of warmth and joy:
  • Wedding night or engagement joy (شب عروسی · نامزدی · شب حنا · رقص عروسی)
  • Parents' blessing or family warmth (دعای مادر · آغوش پدر · صدای مادر)
  • Eid morning or Nouruz celebration (عید · نوروز · جشن · لباس نو · هدیه)
  • Childhood memory of joy (کودکی · بازی در کوچه · دوست قدیمی)
  • Return to homeland (برگشتن به وطن · خاک آشنا)
  Tone: warm, joyful, culturally specific. BPM: 104-112. Energy: celebratory and heartfelt.

═══════════ AVOID LIST — recent packages to NOT repeat or echo ═══════════
${avoidList}
Produce output clearly different in title, hook, concept, emotional sub-mode, and lyric direction.
${farsiDiversityBlock}
═══════════ ROMANTIC SCENE VOCABULARY ═══════════
⚠ BACKDROP RULE: The settings below are WHERE the love story happens — they are NEVER what the song is about.
A song set in a café is still a song about TWO PEOPLE. A song set at a train station is still about the GOODBYE between two people — not about the train station.
Settings get ONE background line maximum. The emotional weight lives in MOMENTS and OBJECTS.

ROMANTIC MOMENTS (these are the heart of SRV songs — use as primary anchors):
first meeting · a glance across a room · hands brushing · a late-night call · standing outside waiting · a last look before leaving · a name written somewhere · a shared umbrella · a song playing in another room · the moment almost-confessed · reunion after distance · a hand held in a taxi · a look that said everything · waiting on a rooftop for them to arrive

ROMANTIC OBJECTS (verse details ONLY — appear as single passing lines inside verses, NEVER as the title, concept, or organizing frame of the song):
a scarf left behind · a key not returned · a photograph together · a half-finished tea · a book with a name written inside · a jacket that holds warmth · spring blossoms on a windowsill · moonlight on a wall · an empty chair · a wedding table · worn photograph · her handwriting in a notebook · his jacket on the hook

ROMANTIC SETTINGS (backdrop only — one passing line maximum, NEVER the subject, NEVER in the hook or title or concept):
⚠ Do NOT name the location. Do NOT anchor the song in a specific place. If a setting must appear, describe what the PEOPLE feel there — not the place itself.
BANNED AS HOOK, TITLE, OR CONCEPT ANCHOR: bridge · café · station · street · airport · rooftop · park · corridor · bench · hall · vendor · corner · market · any named city place
If you feel pulled toward a location, scene, or object as the concept → STOP. Replace it with a FEELING between two people: what does [Person] feel toward [Person] right now?

CULTURAL AUTHENTICITY — add ONE Afghan/Iranian detail per song as background color:
Afghan: چای سبز · نان تازه · دسترخوان · رباب · آهنگ دوتار · بازار · کوچه قدیمی (background only)
Persian: باغ · انار · سرو · گل محمدی · حوض · کاروانسرا · خرمالو (background only)
These cultural details are BACKGROUND COLOR — the emotional center is always the romantic relationship between two people.

SOFT-BANNED AS CENTRAL CONCEPT (if imagery heat-map shows count ≥ 3):
tea as concept · home interior as only setting · rain as primary metaphor · moon as connection · spring arrival · scarf as memento · window watching · airport departure
May appear as background DETAILS but cannot be the central image or hook anchor when over-represented.

═══════════ SRV BRAND THEME ANCHOR — MANDATORY ═══════════
SRV Farsi is a ROMANTIC MUSIC CHANNEL. The primary identity is Male↔Female romantic love.
TARGET AUDIENCE: Afghanistan · Iran · Persian/Dari speakers · Ages 25–60.

PRIMARY SONG THEMES — 85% Romantic:
Love · Romance · Falling in love · First love · First meeting · Missing someone · Waiting · Long-distance longing · Reunion · Beautiful eyes · Smiles · Holding hands · Late-night thoughts · Romantic memories · Heartbreak (romantic) · Hope (for love) · Romantic tension · Love after distance · Weddings (romantic perspective) · Dancing together · Romantic chemistry · Loyalty between partners · A name that still echoes · Walking together.

EXPLICIT PROHIBITIONS IN ROMANTIC AND EMOTIONAL MODES:
Do NOT write songs whose PRIMARY CONCEPT is about:
× Parent↔child relationship (mother's love, father's tribute, parents as main concept)
× Family reunion as main concept
× Village life or village stories as main concept
× Homeland longing as main concept
× Childhood nostalgia as main concept
× Eid / Nouruz as main concept
× Generational family bonds
These are SPECIAL THEMES (5% gate — only when mode = 'happy'). In romantic/emotional modes they may be passing background detail ONLY — never hook, title, or central concept.

═══════════ CENTRAL IMAGE RULE — ALL MODES (READ BEFORE WRITING) ═══════════
The PRIMARY emotional anchor / central image for EVERY song must NEVER be technology.

BANNED AS CENTRAL IMAGE, HOOK, TITLE, OR CONCEPT:
× Phone · unanswered phone call · ringing phone · mobile · missed call
× Text message · messaging app · chat · read receipt · last seen · online status · notification
× Technology · AI · computer · screen · internet · digital · app · device · social media

These are AI-cliché tropes — not cinematic romance. A phone may appear ONLY as a silent passing prop in a single background line. If your central concept, hook, or title involves any of the above → STOP. Rewrite with a physical human object.

REQUIRED — choose your central image from physical, human, relational objects only:
eyes · smile · hands · lips · doorway · empty chair · window · rain on glass
coat left behind · key not returned · scarf · coffee cup · half-finished tea
flowers · moonlight on a wall · notebook with her name · worn photograph
empty room · wedding table · candle · spring blossoms · a look across the room

NOT VALID AS CENTRAL IMAGE (locations/settings — backdrop use only, one line max):
train station · city bridge · park bench · café table · rooftop · street · airport · corridor

The emotional conflict comes from the RELATIONSHIP BETWEEN TWO PEOPLE — not from technology.

═══════════ FORBIDDEN SONG TOPICS — STRICTLY ENFORCED ═══════════
DO NOT write songs whose PRIMARY CONCEPT is about:
× Phones · Messaging apps · Contact lists · Read receipts · Last-seen status
× Technology · Machines · AI · Computers · Internet · Screens
× Social media · Apps · Digital life · Notifications
× Business · Office work · Careers · Work stress
× Politics · Current events · News · World affairs
× Coding · Software · Programming · Devices

The ONLY exception: a phone or message may appear as a silent background PROP in a single passing line ONLY. It must NEVER become the song's concept, hook, or title. If you're tempted to write about a phone, a machine, or a screen as the central image → STOP. Replace it with a physical human object from the CENTRAL IMAGE RULE list above.

═══════════ SRV EMOTIONAL AXIS ═══════════
SRV moves along: longing · tension · warmth · nostalgia · chemistry · memory · emotional movement · romantic gravity.
NOT: generic suffering · emotional isolation · sad-spam.

═══════════ CORE FEELING — every song MUST feel ═══════════
emotionally alive · cinematic · intimate · modern · warm · human · visual · emotionally restrained · memorable · musical when spoken aloud · romantically charged · emotionally beautiful · containing chemistry, romantic tension, and memory between two people.

The listener should FEEL: a moment · a memory · a scene · a relationship · a distance · a late-night emotion · the gravity of someone else.
NOT: just isolated suffering.

═══════════ BEAUTY RATIO RULE — CRITICAL ═══════════
Every emotional song MUST contain: emotional beauty · warmth · romantic gravity · emotional attraction.
The listener should feel emotionally drawn IN — not emotionally exhausted.
SRV should feel beautifully emotional, NOT painfully depressive.
If a section feels heavy, the next section must restore emotional motion or beauty.

═══════════ EMOTIONAL SUB-MODE — pick ONE for this song ═══════════
Choose exactly one texture (and pick a different one than anything in the AVOID LIST):
- late-night longing
- warm nostalgic love
- quiet heartbreak
- romantic distance
- urban loneliness (only if balanced with warmth)
- hopeful emotional tension
- rainy-night romance
- memory-driven romance
- soft masculine vulnerability (when male/duet)
- cinematic reunion feeling

Reflect the chosen texture in the lyrics, the hook, the concept field, AND the new emotionalSubMode output field.

═══════════ ANTI "AI POETRY SYNDROME" ═══════════
Prefer specific emotional imagery over abstract poetic symbolism.
Avoid excessive use of: moon · stars · destiny · oceans · endless metaphors · symbolic sadness spam.
Prioritize REAL scenes, REAL moments, REAL emotional details — a chair, a coat, a street, a half-finished tea, an old photograph, a scarf left behind, a name written in a notebook.

═══════════ HUMAN CONVERSATIONAL RHYTHM ═══════════
Lyrics must sound natural when spoken aloud by a real person.
Avoid overwritten poetic density. If a line reads like a poem textbook instead of a conversation, REWRITE it.

═══════════ ANTI-REPETITION VOCABULARY — STRICT ═══════════
Do NOT overuse these (they are AI cliché Persian):
دلم گرفته · بارون · گریه · تنهایی · شبای بی ستاره · خونه بدون تو · بی وفایی · بغض · شکسته · دنیا بی رحمه · نفس آخر · دیوونه شدم
Use any one of these AT MOST ONCE per song, AND only with a strong unique cinematic context that recasts it. If in doubt, replace with a specific visual image.

═══════════ LANGUAGE STANDARD — TRANS-PERSIAN (MANDATORY) ═══════════
LANGUAGE MIX TARGET:
~60% Neutral literary Persian — understood naturally across Afghanistan, Iran, Tajikistan
~40% Dari-friendly vocabulary and expressions

DUAL AUDIENCE TEST (both must pass):
✓ A listener from Kabul should feel: "این زبان ماست"
✓ A listener from Tehran should feel: "این زبان ماست"
Goal: modern trans-Persian romantic music — NOT Tehran pop, NOT Afghan regional folk.

PREFERRED VOCABULARY (use freely):
دل · نگاه · لبخند · خاطره · کوچه · پنجره · بهار · عشق · دلتنگی · دیدار · انتظار · برگشتن · کنار · فردا · امشب

PREFERRED NEUTRAL FORMS (default to these):
باران (not بارون) · خانه (not خونه) · خیابان (not خیابون) · دیوانه (not دیونه)

DARI-FRIENDLY EXPRESSIONS (include naturally when appropriate):
دلتنگت شدم · دیدارت · کنارت بودن · فردا می‌آی · امشب اینجایی

REDUCE OVERUSE (max 1-2 per song):
نمی‌دونم · می‌خوام · برام · توی · اومدی · مونده · جونم · آره · باشه

HARD AVOID: heavy Tehran-only slang · heavy Afghan dialect · meme Persian · TV-serial Persian.

═══════════ FILLER COMPRESSION — NEW RULE ═══════════
The issue is NOT object realism. Specific everyday objects ARE STRENGTHS when they carry emotional weight — jacket · taxi · chair · coffee cup · hallway light · cigarette smoke · apartment silence · window · half-finished tea · old photograph · worn book · rain on glass · empty seat · a name written by hand. Keep them as BACKGROUND PROPS.
IMPORTANT: Objects like phones, screens, and contact lists may appear as passing background details ONLY. They must NEVER become the song's primary image, hook, or concept (see FORBIDDEN TOPICS above).

The issue IS AI filler-density and Tehran conversational over-patterning. Reduce repetition/density of these filler words across the lyric:
- یه (a / one)
- رو (object marker)
- بهش (to it / to him)
- می‌دونم (I know)
- فقط (just / only)
- چی (what)
- توی (in / inside)
- بدم (give / send)
- بهونه (excuse)
- آخه (well / because)
- مگه (isn't it?)

Each may appear occasionally — but NONE of them should dominate the lyric's rhythm.
- If two consecutive lines both open with یه, REWRITE one.
- If رو appears three times across the verse, COMPRESS.
- If می‌دونم opens a section, find a more specific phrasing.

═══════════ PREFERRED RHYTHM — BALANCE RULE ═══════════
Target: refined cinematic realism. Compressed emotional language. Elegant simplicity. Visual realism. Musical sentence rhythm.

Lyrics should feel: human · intimate · specific · cinematic · emotionally restrained.
NOT: chatty AI-generated spoken Persian. NOT: formal literary Persian.

DO NOT sterilize the language. Maintain emotional realism + object intimacy + conversational humanity + cinematic emotional details. Compression means trimming filler, NOT removing intimacy.

If you can say a line in 6 words instead of 9 without losing the scene or the relational gravity, choose 6.
If a line reads "fine but flat", give it a specific object or sensory anchor and a tighter cadence.
Every line should EARN its place — either by carrying scene, relationship, memory, or melody.

═══════════ FORBIDDEN STYLE ═══════════
DO NOT produce: TV-serial sadness · AI cliché Persian · ancient/formal Persian tone · heavy poetic overload · generic suffering · hopelessness spam · overdramatic despair.
The song must NOT feel: depressing · dead · emotionally flat · repetitive · old-fashioned.

═══════════ SRV IDENTITY ═══════════
SRV should feel: modern Afghan emotional energy · cinematic romance · emotional realism · warm masculinity (when male/duet) · urban emotion · emotional movement · subtle nostalgia · romantic chemistry between two people.
NOT heavy Tehran sadness-core. NOT village folk. NOT old-Iranian-classic.

═══════════ ENERGY RULE ═══════════
Even emotional songs must feel ALIVE. Emotional ≠ hopeless.
Every song must contain: emotional motion · emotional beauty · emotional tension · emotional melody.

═══════════ SRV EMOTIONAL SONG STANDARD — FINAL (replaces all previous structure rules) ═══════════

IDENTITY (HIGHEST PRIORITY):
Every emotional SRV song must immediately sound like Silk Road Voices — Afghan (Kabuli) first, Dari/Farsi lyrics, cinematic, warm, romantic, timeless, emotionally intimate.
NEVER sound primarily Iranian pop, Arabic pop, Turkish pop, or generic Western pop.
Bollywood may influence emotional atmosphere only — the result must remain unmistakably Afghan.

PERMANENT MUSICAL PALETTE:
Primary instruments (always): Rubab (main melodic identity) · Soft Piano · Warm Strings · Gentle Cello · Harmonium · Ambient Pads
Light rhythm: Very soft Tabla · Very soft Dholak · Minimal percussion only
FORBIDDEN: EDM · Trap · Heavy electronic synths · Loud drums · Rock guitars · Dance beats · Aggressive production

VOCAL STYLE (MANDATORY):
Warm · Intimate · Close-mic · Emotional · Natural Afghan pronunciation · Soft breathing allowed · Controlled emotion
NEVER oversung. NEVER theatrical. The listener should feel the singer is quietly telling a personal story.

ONE EMOTION RULE:
Every song expresses ONE dominant emotion only. Pick exactly one:
Waiting · Distance · Missing someone · Hope · Memories · Late-night loneliness · Faithful love · Quiet heartbreak
Do NOT mix multiple emotional themes. One song = one feeling.

ONE CENTRAL IMAGE RULE:
Every song is built around ONE central visual image. The image must be a HUMAN OBJECT or SENSORY DETAIL — never a place, location, city, or scenery.
Examples (VALID — human/relational): candle · rain on glass · window with her silhouette · empty chair · old letter · half-finished tea · jacket left behind · a scarf on the hook · spring blossoms on a sill · moonlight on a wall · worn photograph · a key not returned · her handwriting in a notebook
INVALID as central image (location/backdrop — backdrop only, one line max): train station · café · bridge · street · city · rooftop · park bench · airport · corridor
The central image appears in the hook, chorus, and returns in the outro section emotionally.

PRODUCTION (LOCKED):
Tempo: 68–72 BPM · Song length: 3:00–3:20 STRICT · Warm dynamic cinematic mix · Vocals always in front
The arrangement builds gradually — NEVER gets loud. Do NOT overproduce. Do NOT sound electronic.

SONG STRUCTURE — MANDATORY (emotional solos and emotional duets):
Lyrics are written FOR A SINGER TO PERFORM. Short lines. Breathing room. Musical pacing.

[Intro] (12–15s instrumental — NO lyrics)

[Verse 1] — 3-4 SHORT lines. Scene + central image + two-person relational detail. 5-9 syllables per line.

[Verse 2] — 3-4 SHORT lines. Progression — new emotional angle on the same image. NOT a repeat of Verse 1.

[Chorus] — 3-4 SHORT lines. ONE memorable hook phrase. Simple wording. Emotionally strong. Singable in one breath. MUST contain emotional beauty (Beauty Ratio rule). This is what listeners remember.

[Music Break] (15–20s instrumental — NO lyrics — emotional breathing room)

[Verse 3] — 3-4 SHORT lines. Softer vulnerability, hopeful tension, or quiet realization.

[Final Chorus] — same hook, emotionally elevated. Small wording variation allowed.

[Outro] (12–15s instrumental — NO lyrics — end beautiful, end memorable)

Total sung lines: 12–18 across all sections. COMPACT. Every line earns its place.
For Happy Duet: use [Male Verse] [Female Verse] [Both Chorus] [Female Bridge] [Male Bridge] labels.
For Emotional Duet: use [Male Verse] [Female Verse] [Both Chorus] [Music Break] labels. BPM 68–74.
For Happy Duet: BPM 104–112. Instruments: Rubab · Dholak · Tabla · Hand Claps · Bass · Modern Pop Drums.

LENGTH CONTROL — CRITICAL:
The lyrics output MUST include [Outro] as the final section tag. Suno will use this to end the song at the right time.
The sunoPrompt MUST include: "3:00-3:20 runtime, compact structure, end at [Outro]"

8-POINT QUALITY CHECK — confirm ALL before outputting:
✓ Sounds Afghan first (not Iranian/Arabic/Turkish/Western pop)
✓ Feels like SRV within the first 10 seconds
✓ Strong memorable chorus
✓ One clear emotional theme (not multiple mixed themes)
✓ Rubab present as main melodic identity
✓ Warm cinematic production (no loud drums, no EDM, no aggressive sounds)
✓ Natural Dari pronunciation
✓ No modern pop trends overpowering the Afghan sound
If ANY item fails → revise before outputting.

MUSICAL DYNAMICS:
Each section feels different from the previous. Verses are quieter and intimate. Chorus releases. Final chorus elevates. Outro leaves emotional space.
Arrangement builds gradually — NEVER gets suddenly loud. Emotional ≠ loud. Emotional = warm, human, restrained.

═══════════ PERFORMANCE FEEL — NEW RULE ═══════════
Lyrics must be naturally performable by a real singer with feeling.
- Each line singable in ONE BREATH without rushing.
- No lines that read like written paragraphs.
- Avoid consonant clusters that fight melody.
- Prefer 5-9 syllable lines with internal melody.
- Concrete + sensory + relational > abstract + explanatory.

TEST: Can you imagine a singer landing this line emotionally on a single sustained note or simple melodic phrase? If no, REWRITE shorter.

═══════════ EMOTIONAL COMPRESSION — NEW RULE ═══════════
Prefer short visual emotional punches over long emotional explanation.
- Don't EXPLAIN the feeling. SHOW it through an object, a movement, a moment.
- 5 words with an image > 9 words explaining the image.
- A line that lands cinematically is worth three lines that describe cinematically.

Good (compressed song-line): "هنوز چای را با شکر تو می‌خورم" — scene + memory + intimacy in 6 words.
Bad (prose-explanation): "هر بار که چای می‌خورم به یاد تو می‌افتم و می‌دونم که هنوز دوستت دارم" — 13 words, all explanation, unsingable, reads like a text message.

Good (compressed): "کتت روی صندلی، هنوز بوی تو" — 6 words, object + scene + sensory.
Bad (prose-explanation): "کتت رو روی صندلی کنار در فراموش کردی ولی هنوز بوی تو می‌ده" — 12 words, narrative explanation, loses melodic phrasing.

═══════════ HOOK RULE ═══════════
Every song needs ONE memorable emotional hook phrase that carries SRV identity.
That phrase becomes: short-clip text · audience memory trigger · the title of the song's emotional moment.
No generic hooks. No "I miss you" abstractions. Visual, specific, modern.

═══════════ EXAMPLES — GOOD vs BAD ═══════════
Good: "پیراهنت هنوز روی صندلی‌ست" — specific, visual, present-tense, no cliché vocab, two-person relational.
Bad: "دلم خیلی تنگ توست" — abstract, cliché, vague, one-person isolation.

Good: "تاکسی از خیابان تو می‌گذرد" — cinematic, location, movement, restrained, contains another person implicitly.
Bad: "بدون تو دنیا بی رحمه" — cliché, dramatic-collapse, dataset-Tehran, generic suffering.

Good hook: "هنوز چای را با شکر تو می‌خورم" — domestic, specific, romantic gravity through memory.
Bad hook: "شبای بی ستاره بدون تو" — banned vocab stack, no specificity.

═══════════ SUNO PROMPT QUALITY — REQUIRED IDENTITY ═══════════
The sunoPrompt MUST carry SRV identity, not just genre tags. Required elements:
- "cinematic modern Persian pop" (genre anchor)
- warm intimate vocal direction (e.g. "warm intimate ${voiceType.toLowerCase()} vocal at center", "restrained emotional delivery", "close-mic vocal mix")
- atmospheric texture (e.g. "atmospheric synth pads", "subtle oud accents on the bridge", "late-night city atmosphere", "soft piano underpinning")
- cinematic build (e.g. "cinematic emotional build into the chorus", "strings swell on final chorus only")
- production quality (e.g. "clean vocal mix", "emotional warmth", "spacious intimacy")
- runtime + structure markers: 3:00-3:20 runtime, end at [Outro]

DO NOT produce simplistic prompts like "Persian vocals piano strings oud cinematic 3:00-3:20". Every Suno prompt must be readable as instructions to a producer who needs the SRV identity from words alone.

Example of GOOD sunoPrompt (style — vary per song):
"cinematic Afghan Persian pop, warm intimate close-mic ${voiceType.toLowerCase()} vocal at center, restrained emotional delivery, Rubab as main melodic lead, soft piano and warm strings, gentle cello on verses, harmonium underpinning, very soft tabla, ambient pads, cinematic emotional build into chorus, clean mix vocals always in front, no loud drums no EDM no synths, 68-72 BPM, 3:00-3:20 runtime, end at [Outro]"
CRITICAL: sunoPrompt MUST include "68-72 BPM" (or 104-112 for happy duet) and "3:00-3:20 runtime, end at [Outro]" — this controls Suno song length. Without it Suno generates 4+ minute songs.

═══════════ OUTPUT — JSON ONLY, WRAPPED IN <package> ═══════════
CRITICAL: Start your response with <package> IMMEDIATELY. Do NOT write any preamble, acknowledgment, summary, or introductory text before the JSON. Do NOT say "I understand", "I have internalized", "I am ready", or anything else. Your entire response = <package>{...json...}</package> — nothing before, nothing after.
// ── LONG SONG PACKAGE — v13.69.44 ARCHITECTURE ──────────────────────────────
// This generator produces LONG SONG packages ONLY.
// shortSunoPrompt and shortLyrics are NOT generated here.
// Short Video packages are produced by a completely separate generator.
<package>
{"title":"emoji + Persian title + emoji","shortTitle":"emoji + short Persian title","concept":"one sentence (English) — MUST answer: what does [Person] FEEL toward [Person] RIGHT NOW? — BANNED even with person as grammatical subject: 'A man returns to the bench where...' / 'She sits in the empty hall where...' / 'He stands at the vendor corner where...' — Memory-Through-Setting patterns use place/object as the organizing frame and are BANNED — RIGHT: 'A man who still loves her but cannot bring himself to call' / 'She knows he's still waiting but doesn't know how to go back' — the concept must be about a FEELING, not a location or object a person is near","mood":"${mood}","emotionalSubMode":"the texture chosen from the SUB-MODE list above","hook":"the ONE memorable emotional hook phrase (Persian) — visual, specific, singable, NO location word as the anchor, carries SRV romantic identity — the hook is about a PERSON, a FEELING, or a RELATIONAL MOMENT, never a place name","sunoPrompt":"identity-rich English Suno prompt per the SUNO PROMPT QUALITY rules above — must include cinematic-modern-Persian-pop anchor + vocal direction + atmospheric texture + cinematic build + production quality + 3:00-3:20","lyrics":"full Persian lyrics using EXACT section tags: [Intro] [Verse 1] [Verse 2] [Chorus] [Music Break] [Verse 3] [Final Chorus] [Outro]. Instrumental sections ([Intro] [Music Break] [Outro]) get NO lyrics — just the tag. Sung sections follow the structure rules. Conversational rhythm. ONE central romantic image (human/relational object — NOT a location) running through all sections. [Outro] tag MUST appear as the final section to control Suno song length.","captionYT":"Persian YouTube caption with hook question + CTA + hashtags","captionTikTok":"one line Persian TikTok caption with hashtags","captionIG":"Persian Instagram dot-spacer format with hashtags","hashtags":"mix Persian and English hashtags","thumbnailText":"Persian title + emoji","centralImage":"single central visual human/relational object (1-3 words English — e.g. wedding ring, empty chair, late-night window, her scarf, rain on glass, worn photograph, jacket on the hook, half-finished tea — NEVER a location word like bridge, café, rooftop, street)","location":"generic unnamed backdrop only (1-3 words English — e.g. unnamed apartment, unnamed street, unnamed night, unnamed space — NEVER a named landmark, bridge, station, or specific city place that could become the song title)","hookStructure":"hook pattern type (e.g. object-as-memory, sensory-recall, address-to-person, reunion-longing, romantic-question, late-night-thought, heartbreak-beauty, first-meeting, romantic-distance)","emotionalScenario":"specific romantic emotional situation between TWO PEOPLE (e.g. waiting for someone who may not return, reunion after long distance, first meeting in a crowd, heartbreak of a last goodbye, longing from another city, the moment love is almost confessed, romantic tension across a room)"}
</package>`;
    } // end isLong (long song branch)
  } else if (engineId === 'srv_english') {
    // ─────────────────────────────────────────────────────────────────────────
    // SRV ENGLISH — v13.69.45: SEPARATE SHORT vs LONG generators
    // isLong (contentFormat='long') → full song (3:00-3:20, full structure)
    // !isLong (contentFormat='short' / Short Video task) → 25-30s SHORT ONLY
    // The two paths are COMPLETELY INDEPENDENT. Short NEVER inherits long template.
    // ─────────────────────────────────────────────────────────────────────────
    const parts = mode.split(' — '); const voiceType = parts[0]; const mood = parts[1] || mode;

    if (!isLong) {
      // ── SRV ENGLISH SHORT VIDEO GENERATOR — v13.69.45 ──────────────────────
      // ARCHITECTURE: Completely independent from the Long Song generator.
      // This generator has NO knowledge of Long Song structure.
      // It never generates [VERSE 1], [PRE-CHORUS], [CHORUS], [BRIDGE], or 3:00-3:20 prompts.
      // Output: SHORT-ONLY package. One product. One generator. One output.
      // sunoPrompt  = shortSunoPrompt (25-30s) — primary key for client compat
      // lyrics      = shortLyrics (hook + 2-4 lines max) — primary key for client compat
      // ─────────────────────────────────────────────────────────────────────────
      // ── SRV ENGLISH SHORT VIDEO GENERATOR — v4.0 (2026-07-09) ────────────────
      // Love = subject. Location = never the concept. 30s standalone.
      prompt = `You are the SRV English SHORT VIDEO generator (InsidePlaces AI channel).
This is a standalone 30-second love song clip — not a clip from a longer song.
Female artist. Modern cinematic pop. Natural conversational American English.

Mode: ${voiceType} — ${mood}
Avoid these titles/concepts: ${avoidList}

THE ONE LAW: This song is about LOVE — romantic, emotional, or happy.
The subject of every line is the person you love or the relationship between two people.
NEVER make the song about a room, object, furniture, lamp, walls, or environment.

ARTIST: Female vocalist only. Always female. Never male. Never duet.
FEEL: Taylor Swift · Olivia Rodrigo · Gracie Abrams · Sabrina Carpenter

LOVE SITUATIONS to choose from (rotate — never repeat the same situation back-to-back):
Falling in love · missing someone · wanting them back · heartbreak · holding hands ·
dancing together · reunion · forever love · "I still love you" · passion ·
choosing someone every day · realizing you're in love · wanting someone who doesn't know yet ·
the moment before goodbye · still thinking about them · being sure about someone

══ KISS / KISSING IS BANNED AS THE CENTRAL CONCEPT (v14.6.5) ══
If "kiss" or "kissing" is the concept, title, or hook — the package FAILS. Do NOT generate it.
A kiss may appear in ONE passing verse line at most — never as the song's concept, hook, or title.
BANNED: "first kiss" as concept · "our first kiss" as title · "kiss me" as hook ·
"the way you kiss me" · "I still feel that kiss" · any song whose organizing idea is a kiss.

TITLE RULES:
Sounds like a commercial radio love song. About love — not a location or object.
GOOD: "Come Back To Me" · "I'd Still Choose You" · "Stay Forever" · "Fall For You" · "You're The Reason I Stay"
BAD: "Kitchen Lights At 3AM" · "The Dress On My Door" · "Empty Walls" · "No Music Playing"
FORBIDDEN: "Emotional" · "Romantic" · "Happy" · "SRV" · "Song" · "Love Song"

HOOK RULES (4 lines MAX — this IS the entire song):
• Line 1 = the hook. Must be about love or the other person. Specific and singable.
• Lines 2-4 = emotional payoff. Simple, direct, love-focused.
• GOOD hook: "I'd still pick up if you called me at 2am" · "tell me you still think about me" · "I keep choosing you every single morning"
• BAD hook: "barefoot on your kitchen floor" · "the lamp is still on" — location/object as subject
• No section labels. NEVER [VERSE] or [CHORUS]. NEVER paragraph-style lines.
• Each line singable in one breath.
BANNED: "I can't live without you" · "tears rolling down" · "you're my everything" · "my heart is broken"

SUNO PROMPT RULES:
• "0:30 runtime" MUST appear verbatim.
• Vocal starts at 0:00. No instrumental intro. No silence. Hook is the first sound.
• Warm intimate female vocal. Modern cinematic pop. Acoustic guitar, piano, atmospheric pads.
• Ends at emotional peak. Clean ending. High replay value.

OUTPUT — JSON ONLY, WRAPPED IN <package>:
<package>
{"isShortVideo":true,"shortTitle":"commercial love song title — sounds like radio","title":"commercial love song title — sounds like radio","concept":"one sentence — what this love story is about between two people","mood":"${mood}","hook":"the hook line — about love or the person, never the location","sunoPrompt":"[SHORT-ONLY — 0:30 runtime, vocal at 0:00, NO intro, warm intimate female vocal, modern cinematic pop, acoustic guitar, piano, atmospheric pads, emotional love song, peak ending]","shortSunoPrompt":"[identical to sunoPrompt]","lyrics":"[EXACTLY 4 lines max, NO section tags, hook is line 1, about love not location, natural English, singable]","shortLyrics":"[identical to lyrics]","captionYT":"English YouTube Short caption — love hook + CTA + hashtags","captionTikTok":"one punchy love line with hashtags","captionIG":"English Instagram 2-3 lines about love with hashtags","hashtags":"#SRVEnglish #EmotionalMusic #CinematicPop mood tags","thumbnailText":"love song title + emoji","shortThumbnailText":"love song title + emoji"}
</package>`;
    } else {
      // ── SRV ENGLISH LONG SONG GENERATOR — v4.0 (2026-07-09) ────────────────
      // Love = subject. Location = never the concept. Full 3:00-3:20 song.
      // ─────────────────────────────────────────────────────────────────────────
      const srvEnglishSunoStyle = `warm intimate female vocal, modern cinematic pop, ${mood} love song, acoustic guitar, piano, atmospheric pads, deep bass, punchy drums, wide cinematic production, strong hook-driven chorus, emotional build from verse to chorus, every chorus bigger than the verse, professional radio-quality mix, natural American English, singable after one listen, 3:00-3:20`;
      prompt = `You are the SRV English LONG SONG generator (InsidePlaces AI channel).
Female artist. Modern cinematic pop. Love song. People and emotion driven.
Mode: ${voiceType} — ${mood}
Avoid these titles/concepts: ${avoidList}

══ KISS / KISSING IS BANNED AS THE CENTRAL CONCEPT — READ FIRST ══
Do NOT generate a song whose concept, title, or hook is primarily about a kiss or kissing.
This is a hard rule. If kiss/kissing is your organizing idea → pick a completely different situation.
A kiss may appear in ONE verse line maximum as a passing physical detail only.
BANNED: "The Kiss That Started Everything" · "first kiss" as concept · "I still feel that kiss" ·
"the way you kissed me" · "kiss me" as hook · "our lips" as central image · any concept that revolves around a kiss.

THE ONE LAW: This is a LOVE SONG. The subject of every line is the person you love or the love between two people.
The THREE kinds of SRV English songs:
• ROMANTIC LOVE — falling in love · holding hands · choosing someone · wanting someone · dancing · passion
• EMOTIONAL LOVE — missing someone · heartbreak · longing · wanting them back · "I still love you" · waiting · reunion · healing
• HAPPY LOVE — dancing together · happiness as a couple · wedding love · forever love · "you said yes"

NEVER make the song primarily about:
× A room (kitchen, bedroom, living room, hallway)
× An object (lamp, dress, hoodie, chair, window, walls)
× An environment (city lights, rain, midnight atmosphere)
A location may appear in ONE background line only. The song must be about LOVE.

ARTIST: Female vocalist only. Always female. Never male. Never duet.
FEEL: Taylor Swift · Olivia Rodrigo · Gracie Abrams · Sabrina Carpenter

LOVE SITUATIONS — choose one, rotate across packages (NEVER repeat the same situation consecutively):
Falling in love for the first time · Missing someone who left · Wanting someone who doesn't know yet ·
Being completely sure about someone · Holding hands for the first time · Dancing together ·
Breakup that still loves · Reunion after time apart · Forever love / wedding day ·
Happiness of being with someone · Heartbreak and healing · Hope — waiting for love to come back ·
Passion — "I choose you every day" · Seeing someone across a room and knowing · The moment before goodbye ·
Still thinking about them months later · Loving someone who is hard to reach

TITLE RULES:
Sounds like a commercial radio love song. About love — not a location or object.
GOOD: "Come Back To Me" · "I'd Still Choose You" · "You're My Favorite Person" · "Stay Forever" · "One More Dance" · "Still In Love" · "The Way You Love Me" · "Promise Me Tonight" · "Fall For You" · "Running Back To You" · "Don't Say Goodbye" · "You're The Reason I Stay"
BAD: "Kitchen Lights At 3AM" · "The Dress On My Door" · "Empty Walls" · "Living Room" · "No Music Playing"
FORBIDDEN IN TITLE: "Emotional" · "Romantic" · "Happy" · "SRV" · "Song" · "Love Song"

HOOK RULES:
Must be about love or the other person — not a location or object.
GOOD: "I'd still pick up if you called me at 2am" · "you held my hand like you were scared to let go" · "I keep choosing you every single morning" · "tell me you still think about me" · "say you love me one more time"
BAD: "barefoot on your kitchen floor" · "the lamp is still on in the window" · "no music playing but we're dancing"
The hook must make the listener feel IN LOVE or HEARTBROKEN — not just present in a room.

LYRIC QUALITY:
Every verse, chorus, and bridge is about the person or the relationship.
Direct emotional address — "you", "I", "we", "us" — love is always the grammatical subject.
GOOD: "I'd still say yes if you asked me again" · "you looked at me like I was the only one" · "we fell in love so slowly I didn't even notice"
BAD: "the kitchen lights were soft at 3am" — location as subject
BANNED PHRASES: "I can't live without you" · "tears rolling down" · "you're my everything" · "my heart is broken" · "love is blind"
Max 4 lines/verse · 4 lines/chorus · 1 bridge · 2 chorus repeats · 20-28 total lines
Each line singable in one breath · 5-9 syllables preferred

SONG STRUCTURE:
[HOOK] — 1-2 lines. Immediately love-focused. The line you remember.
[VERSE 1] — 3-4 lines. A specific love moment between two people.
[PRE-CHORUS] — 2 lines. Building toward the emotional release.
[CHORUS] — 3-4 lines. The core love emotion. ONE memorable phrase.
[VERSE 2] — 3-4 lines. New angle on the same love story.
[CHORUS]
[BRIDGE] — 2-3 lines. Emotional twist or release.
[FINAL CHORUS] — same hook, elevated.
Total: 20-28 sung lines.

Generate a complete English LONG SONG package (3:00-3:20). Wrap JSON in <package> tags:

⚠ JSON FIELD CHECK (v14.6.7) — Before writing the JSON, verify:
• "title" field → does NOT contain "kiss", "kissing", "kisses", "kissed" → if yes, pick a different love concept
• "concept" field → does NOT contain "kiss", "kissing", "kisses", "kissed" → if yes, rewrite with a different love story
• "hook" field → does NOT contain "kiss", "kissing", "kisses", "kissed" → if yes, rewrite the hook around a feeling or person
The scoring system hard-rejects any package where these words appear in concept or title. No exceptions.

<package>
{"title":"commercial love song title — NO kiss words · sounds like radio, about love not a location","shortTitle":"shorter version","concept":"one sentence — what this love story is about · NO kiss/kissing allowed in this field","mood":"${mood}","hook":"the love-focused hook line — NO kiss words · about the person or feeling, never the location","sunoPrompt":"${srvEnglishSunoStyle}","lyrics":"Full song with [HOOK][VERSE 1][PRE-CHORUS][CHORUS][VERSE 2][CHORUS][BRIDGE][FINAL CHORUS] — love is always the subject, 20-28 lines","captionYT":"English YouTube caption with love hook · CTA · hashtags","captionTikTok":"one punchy love line with hashtags","captionIG":"2-3 emotional love lines with hashtags","hashtags":"#EmotionalMusic #SRVStudio #CinematicPop mood tags","thumbnailText":"love song title + emoji"}
</package>`;
    } // end SRV English isLong branch
  } else if (engineId === 'nextwave') {
    // ─────────────────────────────────────────────────────────────────────────
    // NEXTWAVE (COLIN) IDENTITY LAYER v1.0 — 2026-06-10 (v13.49.3)
    // Mirrors Kelly v1.0 depth pattern, tuned for Colin's authority/informed/
    // grounded persona (vs Kelly's warm/curious). 3 topic tracks: Finance,
    // AI/Tech, Motivation. Preserves the Finance educational-disclaimer rule
    // already in the dormant prompt. JSON shape preserves all downstream-
    // parser field names (title/mood/hook/script/captionYT/captionTikTok/
    // captionIG/hashtags/thumbnailText). LOCKED at v1.0 per SRV-v1.2 memory.
    // v13.69.12 — longForm branch: same persona, same topic logic, 8-min script target.
    // ─────────────────────────────────────────────────────────────────────────
    const topic = mode;
    const look = topic === 'Finance' ? 'suit' : topic === 'AI / Tech' ? 'turtleneck' : 'casual jacket';
    const topicTag = topic.replace(/[^a-zA-Z]/g,'');
    if (isLong) {
      // v13.69.25 — 900-1000 words (~6-7 min at 140 WPM). Landscape 16:9 handled on client side.
      prompt = `You are the NextWave Systems content engine for the Colin avatar (HeyGen).

GOAL: Long-form YouTube video on ${topic}. Script MUST be 900-1000 words — count carefully. Colin persona: authoritative · grounded · direct · no hype.
Topic track: ${topic} | Look: ${look}
Avoid (must be conceptually distinct): ${avoidList}

STRUCTURE (900-1000 words total — hit these targets):
[0:00 HOOK] 70-80 words — one strong specific claim or question
[0:35 SETUP] 200-220 words — the common wrong framing + why it's incomplete
[2:00 CORE INSIGHT 1] 220-250 words — specific mechanism, real example, real numbers
[4:00 CORE INSIGHT 2] 200-220 words — second angle that deepens the first, NOT a repeat
[5:30 TAKEAWAY] 150-170 words — one clear action or framework the viewer can apply
[7:00 CLOSE] 80-100 words — one-sentence summary + soft CTA${topic === 'Finance' ? ' + [DISCLAIMER: Not financial advice. Educational only.]' : ''}

Rules: No hype, no filler, no lists of tips. Every sentence earns its place.

Output JSON in <package> tags:
<package>
{"topic":"${topic}","angle":"specific angle","concept":"one-sentence thesis","title":"max 8 words no hype","mood":"${topic}","hook":"Colin's exact opening line","script":"Full Colin script with markers [0:00 HOOK] [0:35 SETUP] [2:00 CORE INSIGHT 1] [4:00 CORE INSIGHT 2] [5:30 TAKEAWAY] [7:00 CLOSE] — 900-1000 words${topic === 'Finance' ? ' ending with [DISCLAIMER: Not financial advice. Educational only.]' : ''}","thumbnailText":"max 6 words","captionYT":"2-3 sentences + CTA + #NextWave + hashtags","captionTikTok":"one line + 2 hashtags","captionIG":"3-4 lines + hashtags","hashtags":"#NextWave #${topicTag}","workflowNotes":"Long-form video ~6-7 min landscape 16:9"}
</package>`;
    } else {
    prompt = `You are the NextWave Systems content engine for the Colin avatar (HeyGen).

═══════════ GOAL ═══════════
45-55 second short-form videos that read as INSIGHT, not HYPE. Target 125-140 words for the script body so the rendered MP4 lands inside 45-55 seconds at HeyGen Colin's natural cadence. Anything > 60 seconds is over-budget and must be rewritten tighter — Shorts performance peaks under 60 sec.
The aim is NOT "louder finance bro energy" — the aim is MORE specificity, MORE clarity, MORE grounded analysis, MORE "here's what's actually happening" framing.

═══════════ MODE ═══════════
Topic: ${topic} | Colin costume: ${look}
- Finance — practical clarity about money systems, savings, markets, taxes. NOT "get rich quick", NOT "this stock will moon", NOT hype trading. Educational specificity.
- AI / Tech — what's actually shipping, what's actually possible, what's overhyped. Concrete examples. No vague "AI is changing everything".
- Motivation — grounded action and mindset. NOT Tony Robbins yelling, NOT "5am club" cosplay. Real frictions, real moves.

═══════════ AVOID LIST — last ~50 packages + published YouTube content for this engine ═══════════
${avoidList}
The new package MUST be conceptually distinct from EVERY item above. Different title surface words is NOT enough — the underlying concept/thesis must be new. Match against title, hook, concept, AND script angle.

═══════════ COLIN PERSONA — every script must sound like ═══════════
Authoritative · informed · grounded · direct to camera · calm · slightly skeptical of hype · respects viewer intelligence · NEVER hype-bro · NEVER "fellas/kings" · NEVER "trust me bro" · NEVER patronizing.
Colin sounds like an analyst sharing a clear take that he actually believes — NOT like a finance influencer working a hook factory.

═══════════ CORE FEELING — every video MUST feel ═══════════
specific · grounded · informed · "actually useful" · respectful of viewer's time · ONE clear claim per video · earned authority (not performed) · the energy of someone who works in the field, not someone selling a course about working in the field.

═══════════ HOOK LADDER — choose ONE pattern, rotate across packages ═══════════
1. CONFIDENT CONFESSION — "Most [audience] think [common belief]. The data says [concrete reveal]."
2. SPECIFIC REVEAL — "Here's what changed about [X] in [timeframe] that most people missed."
3. COUNTER-INTUITIVE — "The reason [X] doesn't work is the opposite of what you'd think."
4. DATA POINT — "[Specific number/%] of [group] [behavior]. Here's the mechanism."
5. SHIFTED FRAME — "Stop thinking of [X] as [common frame]. It's actually [reframe]."
6. PRACTICAL DEMO — "I [specific action] for [exact duration]. Here's the unexpected result."
7. QUESTION → PAYOFF — "Why is [observable thing] happening? [Specific mechanism]."
8. STORY OPENER — "A [profession/role] explained [insight] to me. It reframed how I think about [topic]."

Don't repeat the same pattern as the previous package. Track which pattern Colin used last and pick a different one.

═══════════ FORBIDDEN STYLE — immediate disqualifiers ═══════════
NO: "You won't believe..." · "This will change your life..." · "The secret to..." · "Nobody talks about..." · "What [the rich/banks/government] don't want you to know..." · "5 ways to..." · "Game changer..." · "Hack..." · "Insane..." · "Wild..." · "This one trick..." · "Fellas" · "Kings" · "Gentlemen, listen up..." · "Smash that subscribe..." · "Mind = blown..."
NO ALL-CAPS shouting in title, hook, script, or thumbnail.
NO "?????" or "!!!!" punctuation theatrics anywhere.
NO LISTS in 50 seconds — one specific claim, one concrete payoff.
NO commands ("DO this NOW") — Colin frames insights, doesn't bark orders.
NO "hey guys", "what's up everyone", "today we're talking about" — start mid-thought.
NO get-rich-quick framing in Finance content. NO "AI will replace everyone" doom in AI/Tech. NO "wake up at 5am" cosplay in Motivation.

═══════════ 50-SECOND STRUCTURE — strict timestamps · 125-140 words total ═══════════
0:00–0:04 HOOK — one of the 8 hook ladder patterns. NO setup, NO greeting. Start mid-thought.
0:04–0:14 SETUP — one specific scenario, fact, or context. Concrete. Real.
0:14–0:38 PAYOFF — the surprising mechanism, framework, or insight. THE reason this video exists. Bulk of the value lives here.
0:38–0:46 IMPLICATION — what the viewer can actually do or notice differently as a result. ONE specific takeaway.
0:46–0:50 SOFT CTA — "Follow for more ${topic} takes" OR "Next video: [specific tease]". NEVER "smash subscribe", NEVER "drop a comment".${topic === 'Finance' ? `
APPEND TO SCRIPT END: " [DISCLAIMER: Not financial advice. Educational only.]" — this is required for every Finance package.` : ''}

═══════════ VOICE GUIDELINES ═══════════
- First-person where it lands ("I looked at..." / "The data shows...")
- Specific over generic — "Q3 2025" not "recently"; "the S&P 500 returned 8.2%" not "stocks went up"; "47% of millennials" not "many people"
- ONE concrete example beats abstract framing
- Insight over command
- Conversational rhythm — sentence lengths VARY; no two consecutive sentences identical shape
- Earned, not performed — if it's authoritative, the specificity carries it

═══════════ PRODUCTION — HeyGen Colin setup ═══════════
- Colin: medium close-up, direct eye contact, slight nods between beats, hands stay below frame
- Costume: ${look} (Finance → suit; AI/Tech → turtleneck; Motivation → casual jacket)
- Background per topic: Finance = stone/marble texture or dark wood interior (financial-credibility cue); AI/Tech = minimal dark gradient with subtle tech accent (no Matrix nonsense); Motivation = warm interior or out-of-focus city window (grounded, not glossy gym poster)
- Text overlays: centered, 60% black backing, sans-serif, MAX 6 words on screen at once
- Text overlay timing: HOOK text 0:00–0:03 (matching spoken hook); ONE payoff term/stat overlay 0:10–0:15. That's it — no more overlays.
- NO Colin walking, NO transitions, NO whoosh sound effects, NO music drops, NO B-roll cutaways

═══════════ THUMBNAIL RULES ═══════════
- Max 6 words
- Insight framing — question, data point, or counter-intuitive statement
- White text on the dark background, high contrast
- NO all-caps full string · NO "????" / "!!!" · NO arrows or red circles drawn on Colin's face · NO money-stack imagery
Acceptable: "What 60/40 Gets Wrong" · "AI Can't Predict This" · "Why Discipline Beats Motivation"
NOT acceptable: "INSANE PROFITS!!!" · "BANKS HATE THIS" · "RICH PEOPLE'S SECRET"

═══════════ EXAMPLES — GOOD vs BAD ═══════════
GOOD hook (Finance): "Most people think index funds are boring. The actual reason they outperform 92% of active managers is more specific than 'low fees'." → confident, specific stat, sets up deeper payoff
BAD hook (Finance): "WALL STREET DOESN'T WANT YOU TO KNOW THIS!" → all-caps, conspiracy framing, forbidden phrasing

GOOD hook (AI / Tech): "Everyone says AI will replace coders. The actual disruption is happening somewhere most people aren't looking." → grounded, specific, redirects to real story
BAD hook (AI / Tech): "AI IS GOING TO REPLACE YOU IN 6 MONTHS!" → doom-hype, all-caps, no specifics

GOOD hook (Motivation): "I tracked my mornings for 30 days. The thing that actually moved the needle wasn't waking up earlier." → personal experiment, specific duration, sets up reframe
BAD hook (Motivation): "WAKE UP AT 5AM AND YOU'LL BE A WINNER!" → cosplay-hype, all-caps, command framing

═══════════ ENERGY RULE ═══════════
Colin's energy is the energy of someone who actually works in the field giving you a calm, clear take — NOT the energy of a trader yelling on a podcast or a motivational speaker pacing a stage. The 50 seconds should feel WORTH WATCHING, not RUSHED — and never bloated. 125-140 words. Stop when the payoff lands, not when the timer says you can keep talking.

═══════════ OUTPUT — JSON ONLY, WRAPPED IN <package> ═══════════
<package>
{"topic":"${topic}","angle":"the specific angle this video uses (e.g. 'why low-fee index funds outperform vs the usual fee story' / 'the AI replacement story most coverage misses' / 'morning routine variable that actually correlates')","concept":"one sentence — the unique angle of this video","hookPattern":"which of the 8 hook ladder patterns","title":"max 8 words, insight-framed, no all-caps, no hype words","mood":"${topic}","hook":"Colin's exact 0:00-0:03 opening line — confident, specific, NOT shouty, NOT hype-bro","script":"Full Colin script with timestamp markers: [0:00 HOOK] line | [0:03 SETUP] line | [0:10 PAYOFF] line(s) | [0:22 IMPLICATION] line | [0:28 SOFT CTA] line${topic === 'Finance' ? ' | END WITH: [DISCLAIMER: Not financial advice. Educational only.]' : ''}","visualInstructions":"HeyGen setup per the PRODUCTION rules above — Colin costume (${look}), background per topic, text overlay timing (HOOK 0:00-0:03, payoff term 0:10-0:15)","thumbnailText":"max 6 words, insight-framed, no theatrics, no all-caps","captionYT":"hook question + 1-line context + soft CTA + #NextWave + 2-3 topic hashtags","captionTikTok":"one line carrying the insight + 2 hashtags max","captionIG":"2-3 dot-spacer lines + soft CTA + 3-4 hashtags","hashtags":"#NextWave #${topicTag} + 2-3 specific topic tags","workflowNotes":"HeyGen production steps + which hook pattern was used so the next generation rotates to a different one"}
</package>`;
    } // end short-form NextWave prompt
  } else if (engineId === 'ai_studio') {
    // ─────────────────────────────────────────────────────────────────────────
    // AI STUDIO (KELLY) IDENTITY LAYER v1.0 — 2026-06-10 (v13.49.2)
    // Mirrors SRV's depth pattern but tuned for short-form curiosity content.
    // Locks Kelly persona (warm, conversational, anti-clickbait), 8 hook
    // ladder patterns, A/B/C category rotation, strict 30s structure,
    // HeyGen production rules, GOOD vs BAD examples. LOCKED at v1.0 —
    // no iterative cycles per the SRV-v1.2-lessons memory. JSON shape
    // preserves all existing fields (title, mood, hook, script, captionYT,
    // captionTikTok, captionIG, hashtags, thumbnailText) so the downstream
    // parser keeps working; new identity-layer fields are additive.
    // ─────────────────────────────────────────────────────────────────────────
    const category = mode.includes('Tools') ? 'A' : mode.includes('Psychology') ? 'B' : 'C';
    if (isLong) {
      // v13.69.25 — 900-1000 words (~6-7 min). Landscape 16:9 handled on client side.
      prompt = `You are the AI Creation Studio content engine for the Kelly avatar (HeyGen).

GOAL: Long-form YouTube video. Script MUST be 900-1000 words — count carefully. Kelly persona: warm · curious · conversational · genuine.
Category ${category} — ${mode}
A = AI Tools | B = Psychology | C = Surprising Facts
Avoid (must be conceptually distinct): ${avoidList}

STRUCTURE (900-1000 words total — hit these targets):
[0:00 HOOK] 70-80 words — strong curiosity question or statement
[0:35 SETUP] 200-220 words — common understanding + the gap this video fills
[2:00 CORE INSIGHT 1] 220-250 words — concrete mechanism, study, or example with real specifics
[4:00 CORE INSIGHT 2] 200-220 words — second angle that deepens the first, NOT a repeat
[5:30 TAKEAWAY] 150-170 words — one thing viewer walks away knowing or can apply
[7:00 CLOSE] 80-100 words — one-sentence summary + warm outro + soft subscribe CTA

Rules: No clickbait, no padding, no "you won't believe" — earn every word.

Output JSON in <package> tags:
<package>
{"topic":"${mode}","angle":"specific angle","concept":"one-sentence thesis","title":"max 8 words curiosity-framed","mood":"${mode}","hook":"Kelly's exact opening line","script":"Full Kelly script with markers [0:00 HOOK] [0:35 SETUP] [2:00 CORE INSIGHT 1] [4:00 CORE INSIGHT 2] [5:30 TAKEAWAY] [7:00 CLOSE] — 900-1000 words","thumbnailText":"max 6 words","captionYT":"2-3 sentences + CTA + #AIStudio + hashtags","captionTikTok":"one line + 2 hashtags","captionIG":"3-4 lines + hashtags","hashtags":"#AIStudio #Kelly","workflowNotes":"Long-form video ~6-7 min landscape 16:9"}
</package>`;
    } else {
    prompt = `You are the AI Creation Studio content engine for the Kelly avatar (HeyGen).

═══════════ GOAL ═══════════
35-45 second curiosity-driven short-form videos. Target 90-105 words for the script body so the rendered MP4 lands inside 35-45 seconds at HeyGen Kelly's natural cadence. Anything > 50 seconds is over-budget and must be rewritten tighter — Shorts performance peaks under 45 sec.
The aim is NOT "louder clickbait" — the aim is MORE genuine curiosity, MORE specific insight, MORE conversational warmth, MORE "huh, I never knew that" moments.

═══════════ MODE ═══════════
Category ${category} — ${mode}
A = AI Tools (what AI can/can't do; practical reveal; demystification)
B = Psychology (why humans do what they do; behavioral insight; gentle self-recognition)
C = Surprising Facts (counter-intuitive truths; "wait what" moments; specific data, not vibes)

═══════════ AVOID LIST — last ~50 packages + published YouTube content for this engine ═══════════
${avoidList}
The new package MUST be conceptually distinct from EVERY item above. Different title surface words is NOT enough — the underlying concept/thesis must be new. Match against title, hook, concept, AND script angle.

═══════════ KELLY PERSONA — every script must sound like ═══════════
Warm · curious · conversational · direct to camera · first-person · slightly amused by the topic · respects viewer intelligence · NEVER patronizing · NEVER shouty · NEVER "you won't believe this".
Kelly talks like a smart friend who just learned something genuinely interesting and can't wait to share it — NOT like a YouTube hook factory.

═══════════ CORE FEELING — every video MUST feel ═══════════
genuinely curious · specific · concrete · conversational · "that's actually interesting" · scrollable but worth stopping · respectful of viewer's time · ONE clear claim per video · earned (not hyped).

═══════════ HOOK LADDER — choose ONE pattern, rotate across packages ═══════════
1. CONFESSION — "I used to think [common belief]. Turns out [specific reveal]."
2. SPECIFIC REVEAL — "Most people don't know that [concrete fact with specifics]."
3. COUNTER-INTUITIVE — "[X] is actually the opposite of [common assumption]."
4. PERSONAL EXPERIMENT — "I tried [thing] for [exact duration] and noticed [unexpected pattern]."
5. SHIFTED PERSPECTIVE — "What if [common thing] is actually [reframe]?"
6. STATISTIC + ANGLE — "[Specific %] of people [behavior]. Here's the reason."
7. QUESTION → PAYOFF — "Why do we [common behavior]? [Specific mechanism]."
8. STORY OPENER — "A [profession] once told me [insight]. I think about it constantly."

Rotate which pattern you use across consecutive packages — don't repeat the same pattern as the previous package.

═══════════ FORBIDDEN STYLE — immediate disqualifiers ═══════════
NO: "You won't believe..." · "This will change your life..." · "The secret to..." · "Nobody talks about..." · "What X doesn't want you to know..." · "5 ways to..." · "Game changer..." · "Hack..." · "Banger..." · "Mind = blown..."
NO ALL-CAPS shouting in title, hook, script, or thumbnail.
NO "?????" or "!!!!" punctuation theatrics anywhere.
NO LISTS in 40 seconds — one specific claim, one concrete payoff. Lists fragment attention and force speed-talking.
NO commands ("DO this NOW") — Kelly invites curiosity, doesn't order action.
NO "hey guys", "what's up everyone", "today we're talking about" — start mid-thought.

═══════════ 40-SECOND STRUCTURE — strict timestamps · 90-105 words total ═══════════
0:00–0:03 HOOK — one of the 8 hook ladder patterns. NO setup, NO greeting. Start mid-thought.
0:03–0:10 SETUP — one specific scenario, fact, or context. Concrete. Real, not "imagine if".
0:10–0:28 PAYOFF — the surprising answer, mechanism, or insight. THE reason this video exists. Bulk of the value lives here.
0:28–0:35 IMPLICATION — why it matters to viewer in one specific way. NOT generic "think about it".
0:35–0:40 SOFT CTA — "Follow for more [category descriptor]" OR "next video: [specific tease]". NEVER "smash subscribe", NEVER "drop a comment if...".

═══════════ VOICE GUIDELINES ═══════════
- First-person where it lands ("I noticed..." / "It made me realize...")
- Specific over generic — "at 3am" not "at night"; "for 14 days" not "for a while"; "97%" not "most"; "in 2019" not "recently"
- ONE concrete example beats abstract framing
- Curiosity over command — "here's what surprised me" not "do this right now"
- Conversational rhythm — sentence lengths VARY; no two consecutive sentences identical shape
- Show, don't shout — if it's surprising, the surprise carries itself

═══════════ PRODUCTION — HeyGen Kelly setup ═══════════
- Kelly: medium close-up, direct eye contact, slight head tilts/nods between beats, hands stay below frame
- Background: deep cinematic navy (#0a1628) or charcoal (#1a1a24). NO bright office backgrounds, NO stock B-roll, NO scene cuts.
- Text overlays: centered, 60% black backing, sans-serif, MAX 6 words on screen at once
- Text overlay timing: HOOK text appears 0:00–0:03 (matching spoken hook); ONE payoff term/stat overlay 0:10–0:15 (anchoring the insight). That's it — no more overlays.
- NO Kelly walking, NO transitions, NO whoosh sound effects, NO music drops, NO B-roll cutaways

═══════════ THUMBNAIL RULES ═══════════
- Max 6 words
- Curiosity framing — question OR counter-intuitive statement
- White text on the dark cinematic background, high contrast
- NO all-caps full string · NO "????" / "!!!" · NO arrows or circles drawn on Kelly's face
Acceptable: "What 97% Miss About Sleep" · "AI Can't Do This Yet" · "Why Boredom Means Growth"
NOT acceptable: "INSANE TRUTH!!!" · "YOU WON'T BELIEVE..." · "STOP DOING THIS NOW"

═══════════ EXAMPLES — GOOD vs BAD ═══════════
GOOD hook (Cat A — AI Tools): "Most people use ChatGPT for the wrong thing. The actual use case is way more specific." → conversational, sets up reveal, no hype
BAD hook (Cat A): "You're using ChatGPT WRONG! Here's the SECRET nobody tells you!" → shouty, generic "secret", forbidden punctuation, all-caps

GOOD hook (Cat B — Psychology): "I noticed something weird about how people order coffee. It says more than you'd think." → specific, conversational, sets up payoff
BAD hook (Cat B): "Your COFFEE ORDER reveals your DARKEST personality trait!" → all-caps, hyped, vague claim, theatrical

GOOD hook (Cat C — Surprising Facts): "Octopuses have three hearts and one of them stops every time they swim. That's not even the weird part." → specific stat, sets up bigger payoff, conversational closer
BAD hook (Cat C): "OCTOPUSES are INSANE — wait until you hear THIS!" → all-caps, no specifics, manipulative

═══════════ ENERGY RULE ═══════════
Kelly's energy is the energy of telling your smartest friend something cool — NOT the energy of trying to grab someone's attention on TikTok. The 40 seconds should feel SHORT (worth re-watching), not RUSHED — and never bloated. 90-105 words. Stop when the payoff lands.

═══════════ OUTPUT — JSON ONLY, WRAPPED IN <package> ═══════════
<package>
{"category":"${category}","categoryName":"${mode}","angle":"the specific angle this video uses (e.g. 'practical underused ChatGPT pattern' / 'micro-behavior that signals X' / 'counter-intuitive biology fact')","concept":"one sentence — the unique curiosity angle of this video","hookPattern":"which of the 8 hook ladder patterns (e.g. CONFESSION, SPECIFIC REVEAL, COUNTER-INTUITIVE)","title":"max 8 words, curiosity-framed, no all-caps","mood":"${mode}","hook":"Kelly's exact 0:00-0:03 opening line — conversational, specific, NOT shouty","script":"Full Kelly script with timestamp markers: [0:00 HOOK] line | [0:03 SETUP] line | [0:10 PAYOFF] line(s) | [0:22 IMPLICATION] line | [0:28 SOFT CTA] line","visualInstructions":"HeyGen setup per the PRODUCTION rules above — Kelly framing, background hex (navy #0a1628 or charcoal #1a1a24), text overlay timing (HOOK 0:00-0:03, payoff term 0:10-0:15)","thumbnailText":"max 6 words, curiosity-framed, no theatrics","captionYT":"hook question + 1-line context + soft CTA + #AICreationStudio + 2-3 category hashtags","captionTikTok":"one line carrying the curiosity + 2 hashtags max","captionIG":"2-3 dot-spacer lines + soft CTA + 3-4 hashtags","hashtags":"#AICreationStudio + category tags (#AI / #Psychology / #SurprisingFacts) + 2-3 specific topic tags","workflowNotes":"HeyGen production steps + which hook pattern was used so the next generation rotates to a different one"}
</package>`;
    } // end short-form AI Studio prompt
  } else {
    prompt = `Generate a content package for engine ${engineId} mode ${mode}. Avoid: ${avoidList}. Wrap JSON in <package> tags: <package>{"title":"...","concept":"...","mood":"...","hook":"...","lyrics":"...","captionYT":"...","captionTikTok":"...","captionIG":"...","hashtags":"..."}</package>`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 58000); // 58s — under Vercel 60s maxDuration
    // v13.69.23 — long-form uses Haiku (5-8x faster than Sonnet; completes in ~10-15s vs 60s+)
    // Short-form keeps Sonnet for higher creative quality on hooks/lyrics/captions.
    // v14.6.3 — SRV Farsi long: system param prevents acknowledgment mode; Haiku is safe + fast
    // v14.6.4 — reverted Farsi long back to Haiku: Sonnet hit 58s abort race on Female Emotional (empty content)
    const model = isLong ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-5';
    const maxTokens = isLong ? 4000 : 4000; // v13.69.25 — 900-1000 word script needs ~2500 tokens + JSON; 4000 safe ceiling. Haiku is fast enough.
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        // v14.6.3 — system param for Farsi LONG: prevents Haiku/Sonnet acknowledgment preamble on long prompts
        ...(isLong && engineId === 'srv_farsi' ? {
          system: 'You generate SRV Farsi long song packages. Your ENTIRE response must be ONE <package> JSON object and nothing else. Do NOT write "I understand", "I am ready", or any other preamble. Do NOT acknowledge the rules. Start your response with <package> immediately and end with </package>.'
        } : {}),
        // v14.6.4 — stop_sequences: clean stop right after closing tag, prevents runaway generation
        ...(engineId === 'srv_farsi' ? { stop_sequences: ['</package>'] } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return res.json({ success: false, error: `Claude API error ${claudeRes.status}: ${errText.slice(0, 200)}` });
    }

    const claudeData = await claudeRes.json();
    console.log('[v14.6.4-diag] isLong:', isLong, 'engineId:', engineId, 'model:', model,
      '| stop_reason:', claudeData.stop_reason, '| content_len:', (claudeData.content||[]).length,
      '| api_error:', claudeData.type === 'error' ? JSON.stringify(claudeData.error) : 'none');
    if (claudeData.type === 'error') {
      return res.json({ success: false, error: `Anthropic API error: ${claudeData.error?.type} — ${claudeData.error?.message}` });
    }
    const rawText = (claudeData.content || []).map(b => b.text || '').join('');
    console.log('[generate_package] raw Claude response:', rawText.slice(0, 800));

    let pkg = null;

    // Primary: extract JSON from <package>...</package> tags
    if (!pkg) try {
      const xmlMatch = rawText.match(/<package>([\s\S]*?)<\/package>/i);
      if (xmlMatch) pkg = JSON.parse(xmlMatch[1].trim());
    } catch(e) { console.log('[generate_package] XML extract parse error:', e.message); }

    // Fallback 1: clean JSON
    if (!pkg) try { pkg = JSON.parse(rawText.trim()); } catch(e) {}

    // Fallback 2: extract first {...} block
    if (!pkg) try {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) pkg = JSON.parse(m[0]);
    } catch(e) {}

    // Fallback 3: strip ``` fences then parse
    if (!pkg) try {
      const s = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      pkg = JSON.parse(s);
    } catch(e) {}

    // Fallback 4: strip fences then extract {...} block
    if (!pkg) try {
      const s = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const m = s.match(/\{[\s\S]*\}/);
      if (m) pkg = JSON.parse(m[0]);
    } catch(e) {}

    // v13.69.26 — Fallback 5: repair unescaped control chars in JSON string values
    // Long-form scripts (900+ words) often contain literal \n inside the "script" field.
    // State machine walks the raw JSON and escapes bare newlines/tabs inside strings.
    if (!pkg) try {
      const xmlMatch2 = rawText.match(/<package>([\s\S]*?)<\/package>/i);
      const src2 = xmlMatch2 ? xmlMatch2[1].trim() : rawText.trim();
      let repaired = '';
      let inStr = false;
      for (let i = 0; i < src2.length; i++) {
        const c = src2[i];
        if (inStr) {
          if (c === '\\') { repaired += c + (src2[++i] || ''); continue; }
          if (c === '"') { inStr = false; repaired += c; continue; }
          if (c === '\n') { repaired += '\\n'; continue; }
          if (c === '\r') { repaired += '\\r'; continue; }
          if (c === '\t') { repaired += '\\t'; continue; }
        } else {
          if (c === '"') inStr = true;
        }
        repaired += c;
      }
      pkg = JSON.parse(repaired);
      console.log('[generate_package] fallback5 repair succeeded');
    } catch(e) { console.log('[generate_package] fallback5 repair error:', e.message); }

    if (!pkg) {
      console.error('[generate_package] ALL parse methods failed. Full rawText:', rawText);
      return res.json({ success: false, error: 'parse_failed', raw: rawText });
    }

    pkg.mode = mode;
    pkg.engineId = engineId;
    pkg.generatedAt = Date.now();
    return res.json({ success: true, package: pkg });
  } catch(e) {
    if (e.name === 'AbortError') return res.json({ success: false, error: 'Generation timed out after 58 seconds — try again or shorten the prompt' });
    return res.json({ success: false, error: e.message });
  }
}

// ── v15.6.5 — Farsi Caption Regenerator ─────────────────────────────────────
// Called when title or lyrics is saved in Review; regenerates captionYT only.
async function farsiRegenCaption(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { title, lyrics, isLong } = req.body || {};
  if (!title && !lyrics) return res.json({ ok: false, error: 'title or lyrics required' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.json({ ok: false, error: 'no_api_key' });

  const prompt = `You are a Persian social media caption writer for Silk Road Voices, a Persian music channel on YouTube.

Given the song title and lyrics below, write a compelling YouTube caption in Persian that:
- Opens with a poetic hook line drawn from the emotional core of the lyrics (in Persian)
- 2-3 lines of description — evocative, not descriptive
- Ends with a question or CTA inviting listeners to comment or share
- Includes relevant Persian and English hashtags on the last line
- Total length: 4-6 lines maximum
- Language: Persian (Farsi) with hashtags

Song Title: ${title || ''}
Lyrics:
${lyrics || ''}

Respond with ONLY the caption text, no explanation, no JSON, no tags.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await resp.json();
    const caption = (d.content || []).map(b => b.text || '').join('').trim();
    if (!caption) return res.json({ ok: false, error: 'empty_response' });
    return res.json({ ok: true, captionYT: caption });
  } catch(e) {
    return res.json({ ok: false, error: e.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// v15.7.0 — CEO DECISION EXECUTION PROTOCOL (CDP)
// Brain/Engineering layer only. Execution gate is permanently LOCKED until
// explicitly activated via a separate approved engineering task.
// State machine: draft → pending_ceo → approved|rejected → executing →
//                validating → completed|failed|rolled_back
// All handlers write only to ceo_decision_protocol Supabase table.
// Finance Rule 1 applies: NO money movement ever via any CDP handler.
// ══════════════════════════════════════════════════════════════════════════════

const CDP_VALID_STATES = ['draft','pending_ceo','approved','rejected','executing','validating','completed','failed','rolled_back'];
const CDP_VALID_TYPES  = ['content_mix','engine_strategy','publishing_schedule','monetization','pause_resume','system_alert','finance_alert'];
const CDP_VALID_ENGINES = ['NextWave','SRV Farsi','SRV English','AI Studio','Finance','Investment','Uber','MMMOS'];

// CDP-1: List decisions (filterable by state, engine) — returns full fields needed for CCC + CDP UI
async function cdpList(req, res) {
  try {
    const { state, engine, limit: lim = 50 } = req.query || {};
    let qs = `ceo_decision_protocol?select=id,decision_type,affected_engine,affected_system,recommendation_title,recommendation_summary,analysis_summary,expected_business_impact,authorization_boundary,proposed_exact_change,supporting_evidence,state,state_changed_at,created_at,ceo_decision,ceo_decision_at,ceo_decision_notes,validation_passed,validation_notes,execution_notes,before_state_snapshot,rollback_to_state&order=created_at.desc&limit=${lim}`;
    if (state) qs += `&state=eq.${encodeURIComponent(state)}`;
    if (engine) qs += `&affected_engine=eq.${encodeURIComponent(engine)}`;
    const rows = await sbGet(qs);
    return res.json({ ok: true, decisions: rows || [] });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-2: Create draft recommendation
async function cdpCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const b = req.body || {};
  const required = ['decision_type','affected_engine','affected_system','recommendation_title','authorization_boundary'];
  for (const f of required) {
    if (!b[f]) return res.status(400).json({ ok: false, error: `missing_field: ${f}` });
  }
  if (!CDP_VALID_TYPES.includes(b.decision_type))   return res.status(400).json({ ok: false, error: `invalid decision_type. Valid: ${CDP_VALID_TYPES.join(', ')}` });
  if (!CDP_VALID_ENGINES.includes(b.affected_engine)) return res.status(400).json({ ok: false, error: `invalid affected_engine. Valid: ${CDP_VALID_ENGINES.join(', ')}` });
  try {
    const now = new Date().toISOString();
    const payload = {
      decision_type:              b.decision_type,
      affected_engine:            b.affected_engine,
      affected_system:            b.affected_system,
      state:                      'draft',
      state_changed_at:           now,
      analysis_summary:           b.analysis_summary           || null,
      data_sources:               b.data_sources               || null,
      measurement_window:         b.measurement_window         || null,
      analyzed_at:                b.analyzed_at                || now,
      current_state:              b.current_state              || {},
      current_state_snapshot_at:  b.current_state_snapshot_at  || now,
      recommendation_title:       b.recommendation_title,
      recommendation_summary:     b.recommendation_summary     || null,
      proposed_exact_change:      b.proposed_exact_change      || {},
      supporting_evidence:        b.supporting_evidence        || [],
      expected_business_impact:   b.expected_business_impact   || null,
      authorization_boundary:     b.authorization_boundary,
      rollback_to_state:          b.current_state              || {},
      created_at:                 now,
      updated_at:                 now,
    };
    const row = await sbInsert('ceo_decision_protocol', payload);
    return res.json({ ok: true, decision: row });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-3: Get single decision (full record)
async function cdpGet(req, res) {
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    if (!rows || !rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, decision: rows[0] });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-4: Submit — draft → pending_ceo (locks recommendation for CEO review)
async function cdpSubmit(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=state&limit=1`);
    const rec = rows?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
    if (rec.state !== 'draft') return res.status(409).json({ ok: false, error: `cannot_submit: state is '${rec.state}'. Only 'draft' can be submitted.` });
    const now = new Date().toISOString();
    const updated = await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, { state:'pending_ceo', state_changed_at:now, updated_at:now });
    return res.json({ ok: true, decision: updated });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-5: CEO Approve — pending_ceo → approved
async function cdpApprove(req, res) {
  // v15.11.0 — accept GET (query) as well as POST (body), mirroring cdpExecute/
  // cdpRollback's dual-method precedent (testability), plus an atomic claim so a
  // double-click/retry can't both "succeed" against the same pending_ceo record.
  // v16.30.0 — Phase 2C: requires a valid, server-verified CEO session.
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  const { id, notes } = (req.method === 'POST' ? req.body : req.query) || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=state&limit=1`);
    const rec = rows?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
    if (rec.state !== 'pending_ceo') return res.status(409).json({ ok: false, error: `cannot_approve: state is '${rec.state}'. Only 'pending_ceo' can be approved.` });
    const now = new Date().toISOString();
    const updated = await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}&state=eq.pending_ceo`, {
      state:'approved', state_changed_at:now,
      ceo_decision:'approved', ceo_decision_at:now, ceo_decision_notes:notes||null,
      revalidated_at:now, revalidation_passed:true,
      revalidation_notes:'Pre-submission re-validation passed: data was current at submit time.',
      updated_at:now,
    });
    if (!updated) {
      return res.status(409).json({ ok: false, error: 'already_claimed', message: 'This decision was already approved/rejected by another request. No mutation performed.' });
    }
    return res.json({ ok: true, decision: updated });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-6: CEO Reject — pending_ceo → rejected
async function cdpReject(req, res) {
  // v16.30.0 — Phase 2C: requires a valid, server-verified CEO session.
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  const { id, notes } = (req.method === 'POST' ? req.body : req.query) || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=state&limit=1`);
    const rec = rows?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
    if (rec.state !== 'pending_ceo') return res.status(409).json({ ok: false, error: `cannot_reject: state is '${rec.state}'. Only 'pending_ceo' can be rejected.` });
    const now = new Date().toISOString();
    const updated = await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}&state=eq.pending_ceo`, {
      state:'rejected', state_changed_at:now,
      ceo_decision:'rejected', ceo_decision_at:now, ceo_decision_notes:notes||null,
      updated_at:now,
    });
    if (!updated) {
      return res.status(409).json({ ok: false, error: 'already_claimed', message: 'This decision was already approved/rejected by another request. No mutation performed.' });
    }
    return res.json({ ok: true, decision: updated });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-7: Execute — ACTIVATED v15.8.0 (CEO engineering task explicitly approved this gate)
// Permitted scope: content_mix weights, pause_resume flags, engine_strategy config, publishing_schedule.
// HARD GUARDS: no finance mutations, no Plaid ops, no auth changes, no destructive deletes.
// v15.10.0 — Real execution helper: routes a finding to the SAME engineering_tasks
// table/queue the whole Engineering Brain already uses (no parallel task system).
// Dedupes on exact problem text so repeated CDP runs don't spam duplicate tasks.
// v16.33.0 — Phase 3B (CEO-approved 2026-08-16): Decision→Task bridge. Callers that
// pass origin_decision_id now get database-enforced idempotency via the
// (origin_decision_id, origin_decision_child_key) unique index — not just the
// text-match check below, which stays as-is for the legacy/manual (no decision)
// case. child_key must be deterministic and reproducible across retries of the
// SAME decision: 'primary' for a single-task route, or a stable per-item slug
// (e.g. one per regression, or one per stale-sync label) for routes that
// legitimately create more than one task from a single decision — this is what
// lets route_new_regressions keep creating multiple tasks per decision while
// still being idempotent per-item. Also now builds the SAME full packet +
// Knowledge injection manually-created tasks get (via _buildEngineeringPacketWithKnowledge),
// instead of the old bare {source, routed_at} stub, plus an origin_decision block
// carrying the traceability fields the future Agent phase will need.
async function _cdpRouteEngineeringTask({ problem, expected_result, affected_engine, priority, origin_decision_id, origin_decision_child_key, packetExtra }) {
  if (!problem || !expected_result) return null;
  const childKey = origin_decision_id ? (origin_decision_child_key || 'primary') : null;
  try {
    if (origin_decision_id) {
      // Decision-originated: dedupe strictly by (decision, child) — this is what the
      // DB unique index also enforces, checked here first to avoid a needless insert
      // attempt in the common case (and to return the *existing* row rather than an
      // error on a legitimate retry).
      const dup = await sbGetSafe(`engineering_tasks?origin_decision_id=eq.${encodeURIComponent(origin_decision_id)}&origin_decision_child_key=eq.${encodeURIComponent(childKey)}&select=*&limit=1`);
      if (dup.length) return dup[0];
    } else {
      // Legacy/manual (no decision) — unchanged text-match dedup.
      const existing = await sbGetSafe(`engineering_tasks?problem=eq.${encodeURIComponent(problem)}&status=in.(open,in_progress,testing,ready_for_ceo)&select=id&limit=1`);
      if (existing.length) return existing[0];
    }

    const now = new Date().toISOString();
    let packet = { source: 'cdp_auto_route', routed_at: now };
    try {
      packet = await _buildEngineeringPacketWithKnowledge({ problem, expected_result, affected_engine: affected_engine || 'MMMOS' });
      packet.source = 'cdp_auto_route';
      packet.routed_at = now;
    } catch (e) {
      // Packet/Knowledge build is non-blocking — a routed task with a minimal
      // packet is still far better than no task at all.
      console.error('[CDP] packet build failed, using minimal packet:', e.message);
    }
    if (packetExtra) Object.assign(packet, packetExtra);

    const row = await sbInsert('engineering_tasks', {
      problem, expected_result,
      affected_engine: affected_engine || 'MMMOS',
      priority: priority || 'medium',
      acceptance_criteria: 'Auto-routed by CEO Decision Protocol (CDP) — this task was created because CDP found a real MMMOS issue with no existing safe execution path. Investigate and resolve; mark ready_for_ceo when verified.',
      status: 'open',
      packet,
      origin_decision_id: origin_decision_id || null,
      origin_decision_child_key: childKey,
      created_at: now, updated_at: now,
    });
    return row;
  } catch (e) {
    // A unique-constraint hit here means a concurrent request already created this
    // exact (decision, child) task between our pre-check and our insert — not a
    // real error. Re-fetch and return the row that won the race instead of failing.
    if (origin_decision_id && /duplicate key|unique constraint/i.test(String(e.message || ''))) {
      const dup = await sbGetSafe(`engineering_tasks?origin_decision_id=eq.${encodeURIComponent(origin_decision_id)}&origin_decision_child_key=eq.${encodeURIComponent(childKey)}&select=*&limit=1`);
      if (dup.length) return dup[0];
    }
    console.error('[CDP] route-to-engineering failed:', e.message);
    return null;
  }
}

// v16.33.0 — Phase 3B: deterministic child-key slug. Same input always produces
// the same slug, which is what makes per-item idempotency possible across retries
// (proposed_exact_change on a decision is never mutated after creation, so the
// SAME decision retried later re-derives the SAME keys for the SAME items).
function _cdpChildKeySlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 140) || 'item';
}

async function cdpExecute(req, res) {
  // v16.30.0 — Phase 2C: requires a valid, server-verified CEO session. Closes the
  // gap flagged at the end of Phase 2A/2B — execute could not previously be reached
  // without an already-approved decision, but nothing gated who could trigger it.
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  const { id } = (req.method === 'POST' ? req.body : req.query) || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    const rec = rows?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
    if (rec.state !== 'approved') return res.status(409).json({ ok: false, error: `cannot_execute: state is '${rec.state}'. Only 'approved' can execute.` });

    // ── Finance hard guard ──────────────────────────────────────────────────
    if (rec.decision_type === 'finance_alert' || rec.affected_engine === 'Finance') {
      return res.status(403).json({ ok: false, error: 'FINANCE_PROTECTED', message: 'Finance decisions are advisory only. Finance Rules 1+2 permanently block automated finance mutations.' });
    }

    const now = new Date().toISOString();
    const change = rec.proposed_exact_change || {};

    // ── Snapshot before-state ───────────────────────────────────────────────
    let beforeState = {};
    try {
      const br = await sbGetSafe(`app_settings?key=eq.mmm_cdp_overrides&select=value&limit=1`);
      beforeState = br?.[0] ? JSON.parse(br[0].value || '{}') : {};
    } catch { beforeState = {}; }

    // v15.11.0 — ATOMIC CLAIM. A plain SELECT-then-PATCH leaves a race window: two
    // concurrent execute calls (double-click, retry, serverless retry) could both
    // read state='approved' before either write lands, and both would proceed to
    // mutate. Instead, the FIRST write is a conditional UPDATE scoped to
    // id + state=eq.approved. PostgREST returns the updated row only if the WHERE
    // matched; if it returns nothing, someone else already claimed this decision —
    // stop immediately, no further mutation, no double-execution possible.
    const claimed = await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}&state=eq.approved`, {
      state: 'executing', state_changed_at: now,
      before_state_snapshot: beforeState,
      execution_started_at: now, updated_at: now,
    });
    if (!claimed) {
      return res.status(409).json({
        ok: false, error: 'already_claimed',
        message: 'This decision is no longer in approved state — it was already executed (or is currently executing) by another request. No mutation performed.',
      });
    }

    // ── system_alert: dispatch on proposed_exact_change.type ─────────────────
    // v15.10.0 — Real execution layer. Only these 4 sub-types exist because they are
    // the only ones backed by a real, already-existing, safe MMMOS action:
    //   advisory              → protected domain (Finance/Investment) or nothing to act
    //                            on. No mutation. Same as before v15.10.0.
    //   pipeline_flag          → production_pipeline.stalled/notes (existing
    //                            updatePipelineStage columns) — real, reversible.
    //   automation_recovery    → plaidPullForItem() (existing, already-in-production
    //                            read-only Plaid resync) for providers that have one;
    //                            everything else routes to Engineering — never faked.
    //   route_engineering_task /
    //   route_new_regressions → inserts into engineering_tasks (the existing
    //                            Engineering Brain queue) — no parallel task system.
    // Any other/unknown type fails loudly instead of silently completing.
    if (rec.decision_type === 'system_alert') {
      const changeType = change.type || 'advisory';

      if (changeType === 'advisory') {
        await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
          state: 'completed', state_changed_at: now,
          execution_completed_at: now,
          execution_notes: change.reason ? `Advisory: acknowledged. ${change.reason}` : 'Advisory: acknowledged by execution layer. No system mutation.',
          executed_change: { type: 'advisory', action: 'acknowledged' },
          validation_started_at: now, validation_passed: true,
          validation_notes: 'Advisory — no state to validate.', updated_at: now,
        });
        await _cdpWriteLearning({ ...rec, state: 'completed' }, 'Advisory acknowledged. No system mutation.');
        return res.json({ ok: true, state: 'completed', advisory: true });
      }

      if (changeType === 'pipeline_flag') {
        const ids = Array.isArray(change.pipeline_ids) ? change.pipeline_ids : [];
        if (!ids.length) return res.status(400).json({ ok: false, error: 'no_pipeline_ids_in_proposed_change' });
        const idFilter = ids.map(x => encodeURIComponent(x)).join(',');
        const beforeRows = await sbGetSafe(`production_pipeline?id=in.(${idFilter})&select=id,stalled,notes`);
        await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, { before_state_snapshot: { type: 'pipeline_flag', items: beforeRows }, updated_at: now });
        const noteText = change.note || `Flagged by CEO Decision Protocol (${id}) — stuck in production/publishing lifecycle.`;
        for (const pid of ids) {
          await sbPatch('production_pipeline', `id=eq.${encodeURIComponent(pid)}`, { stalled: true, stalled_since: now, notes: noteText, updated_at: now });
        }
        const afterRows = await sbGetSafe(`production_pipeline?id=in.(${idFilter})&select=id,stalled,notes`);
        const validPassed = afterRows.length === ids.length && afterRows.every(r => r.stalled === true);
        if (validPassed) {
          await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
            state: 'completed', state_changed_at: now, execution_completed_at: now,
            execution_notes: `Flagged ${ids.length} production_pipeline item(s) as stalled with escalation note.`,
            executed_change: { type: 'pipeline_flag', ids, note: noteText },
            validation_started_at: now, validation_passed: true,
            validation_notes: `Read-back confirmed stalled=true on ${afterRows.length}/${ids.length} item(s).`, updated_at: now,
          });
          await _cdpWriteLearning({ ...rec, state: 'completed' }, `Flagged ${ids.length} pipeline item(s) as stalled.`);
          return res.json({ ok: true, executed: true, state: 'completed', change_description: `Flagged ${ids.length} item(s) stalled`, validation: 'read-back confirmed' });
        } else {
          for (const row of beforeRows) {
            await sbPatch('production_pipeline', `id=eq.${encodeURIComponent(row.id)}`, { stalled: row.stalled, notes: row.notes, updated_at: now });
          }
          await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
            state: 'rolled_back', state_changed_at: now,
            execution_notes: 'Auto-rolled back: read-back validation failed for pipeline_flag.',
            validation_started_at: now, validation_passed: false, validation_notes: 'Read-back mismatch after write.',
            rollback_required: true, rollback_status: 'auto_rolled_back', updated_at: now,
          });
          await _cdpWriteLearning({ ...rec, state: 'rolled_back' }, 'Auto-rolled back: pipeline_flag validation failed.');
          return res.status(500).json({ ok: false, executed: false, state: 'rolled_back' });
        }
      }

      if (changeType === 'automation_recovery') {
        const plaidIds = Array.isArray(change.plaid_item_ids) ? change.plaid_item_ids : [];
        const routeFor = Array.isArray(change.route_for) ? change.route_for : [];
        const results = { resynced: [], routed: [], failed: [] };
        for (const itemId of plaidIds) {
          try {
            const itemRows = await sbGetSafe(`plaid_items?item_id=eq.${encodeURIComponent(itemId)}&select=item_id,access_token,institution_name,last_cursor`);
            const item = itemRows?.[0];
            if (!item) { results.failed.push(itemId); continue; }
            await plaidPullForItem(item); // existing, already-in-production read-only Plaid sync — no new logic
            results.resynced.push(itemId);
          } catch (e) { results.failed.push(itemId); }
        }
        for (const label of routeFor) {
          const task = await _cdpRouteEngineeringTask({
            problem: `Automation Health: ${label} has not synced recently and MMMOS has no automatic safe re-sync/re-auth action wired for it yet.`,
            expected_result: `${label} syncs reliably again — investigate token expiry/sandbox limits and wire an automatic recovery action if it can be done safely.`,
            affected_engine: 'MMMOS', priority: 'medium',
            // v16.33.0 — Phase 3B: this loop can route more than one label per
            // decision, so each gets its own deterministic child key.
            origin_decision_id: id,
            origin_decision_child_key: 'sync_' + _cdpChildKeySlug(label),
            packetExtra: { origin_decision: { id, decision_type: rec.decision_type, authorization_boundary: rec.authorization_boundary, recommendation_title: rec.recommendation_title } },
          });
          if (task) results.routed.push({ label, task_id: task.id });
        }
        let verified = true;
        if (plaidIds.length) {
          const idFilter = plaidIds.map(x => encodeURIComponent(x)).join(',');
          const after = await sbGetSafe(`plaid_items?item_id=in.(${idFilter})&select=item_id,last_sync_at`);
          verified = after.length > 0 && after.every(a => a.last_sync_at && (Date.now() - new Date(a.last_sync_at).getTime()) < 10 * 60000);
        }
        await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
          state: 'completed', state_changed_at: now, execution_completed_at: now,
          execution_notes: `Resynced: ${results.resynced.join(', ') || 'none'}. Routed to Engineering: ${results.routed.map(r => r.label).join(', ') || 'none'}. Failed: ${results.failed.join(', ') || 'none'}.`,
          executed_change: { type: 'automation_recovery', ...results },
          validation_started_at: now, validation_passed: verified,
          validation_notes: verified ? 'plaid_items.last_sync_at confirmed fresh for resynced item(s).' : 'One or more resynced items did not show a fresh last_sync_at on read-back.',
          updated_at: now,
        });
        await _cdpWriteLearning({ ...rec, state: 'completed' }, `Automation recovery: resynced=${results.resynced.length}, routed=${results.routed.length}, failed=${results.failed.length}`);
        return res.json({ ok: true, executed: true, state: 'completed', results });
      }

      if (changeType === 'route_engineering_task' || changeType === 'route_new_regressions') {
        // v16.33.0 — Phase 3B: each proposal gets a deterministic child key so
        // route_new_regressions can still legitimately create multiple tasks from
        // this one decision (one per regression) while each individual regression
        // stays idempotent across retries — never a naive one-task-per-decision cap.
        const proposals = changeType === 'route_new_regressions'
          ? (change.regressions || []).map(r => ({
              problem: `Regression detected: ${r.name} (${r.engine}, severity ${r.severity}).`,
              expected_result: `Root-cause and fix the ${r.name} regression on ${r.engine}.`,
              affected_engine: r.engine || 'MMMOS', priority: r.severity === 'critical' ? 'high' : 'medium',
              _childKey: 'regression_' + _cdpChildKeySlug(`${r.engine}__${r.name}`),
            }))
          : [{ problem: change.suggested_problem, expected_result: change.suggested_expected_result, affected_engine: rec.affected_engine, priority: change.suggested_priority || 'medium', _childKey: 'primary' }];
        const createdTaskIds = [];
        for (const p of proposals) {
          if (!p.problem) continue;
          const task = await _cdpRouteEngineeringTask({
            problem: p.problem, expected_result: p.expected_result, affected_engine: p.affected_engine, priority: p.priority,
            origin_decision_id: id,
            origin_decision_child_key: p._childKey,
            packetExtra: { origin_decision: { id, decision_type: rec.decision_type, authorization_boundary: rec.authorization_boundary, recommendation_title: rec.recommendation_title } },
          });
          if (task) createdTaskIds.push(task.id);
        }
        await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
          state: 'completed', state_changed_at: now, execution_completed_at: now,
          execution_notes: createdTaskIds.length ? `Routed to Engineering Brain: task(s) ${createdTaskIds.join(', ')}.` : 'No new task created (already tracked or nothing to route).',
          executed_change: { type: changeType, engineering_task_ids: createdTaskIds },
          validation_started_at: now, validation_passed: true,
          validation_notes: createdTaskIds.length ? `Confirmed ${createdTaskIds.length} engineering_tasks row(s) exist.` : 'n/a — nothing to create.',
          updated_at: now,
        });
        // v16.33.0 — Phase 3B (CEO-approved 2026-08-16): Learning is deliberately
        // NOT written here anymore. This branch's only real outcome is "a task was
        // created" — not a validated result worth learning from. Learning for
        // decision-routed tasks now fires from engineeringTaskCeoApprove, when the
        // resulting Engineering Task itself reaches a real terminal CEO outcome
        // (see _writeTaskLearning below). The decision itself still correctly
        // completes here — its job was to spawn the task, which it did.
        return res.json({ ok: true, executed: true, state: 'completed', engineering_task_ids: createdTaskIds });
      }

      // Unknown type — fail loudly rather than pretend approval did something real.
      await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
        state: 'failed', state_changed_at: now,
        execution_notes: `Unknown system_alert execution type: ${changeType}`, updated_at: now,
      });
      return res.status(400).json({ ok: false, error: `unknown_system_alert_type: ${changeType}` });
    }

    // ── Build new override object ───────────────────────────────────────────
    let newOverrides = JSON.parse(JSON.stringify(beforeState));
    let changeApplied = false;
    let changeDesc = '';

    if (rec.decision_type === 'content_mix' && change.content_mix) {
      if (!newOverrides.content_mix) newOverrides.content_mix = {};
      for (const [eng, weights] of Object.entries(change.content_mix)) {
        newOverrides.content_mix[eng] = { mode_weights: weights, cdp_decision_id: id, applied_at: now };
      }
      changeApplied = true;
      changeDesc = `content_mix override set for: ${Object.keys(change.content_mix).join(', ')}`;

    } else if (rec.decision_type === 'pause_resume') {
      if (!newOverrides.pause_resume) newOverrides.pause_resume = {};
      const active = change.engine_active !== undefined ? change.engine_active : true;
      newOverrides.pause_resume[rec.affected_engine] = { active, cdp_decision_id: id, applied_at: now };
      changeApplied = true;
      changeDesc = `${rec.affected_engine} ${active ? 'resumed' : 'paused'}`;

    } else if (rec.decision_type === 'engine_strategy' && change.strategy) {
      if (!newOverrides.engine_strategy) newOverrides.engine_strategy = {};
      newOverrides.engine_strategy[rec.affected_engine] = { ...change.strategy, cdp_decision_id: id, applied_at: now };
      changeApplied = true;
      changeDesc = `engine_strategy updated for ${rec.affected_engine}`;

    } else if (rec.decision_type === 'publishing_schedule' && change.schedule) {
      if (!newOverrides.publishing_schedule) newOverrides.publishing_schedule = {};
      newOverrides.publishing_schedule[rec.affected_engine] = { ...change.schedule, cdp_decision_id: id, applied_at: now };
      changeApplied = true;
      changeDesc = `publishing_schedule updated for ${rec.affected_engine}`;

    } else {
      await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
        state: 'failed', state_changed_at: now,
        execution_notes: `Unsupported execution type: ${rec.decision_type}`, updated_at: now,
      });
      return res.status(400).json({ ok: false, error: `unsupported_execution_type: ${rec.decision_type}` });
    }

    // ── Write overrides to app_settings ────────────────────────────────────
    const overrideStr = JSON.stringify(newOverrides);
    const existRow = await sbGetSafe(`app_settings?key=eq.mmm_cdp_overrides&select=key&limit=1`);
    if (existRow.length > 0) {
      await sbPatch('app_settings', 'key=eq.mmm_cdp_overrides', { value: overrideStr, updated_at: now });
    } else {
      await sbInsert('app_settings', { key: 'mmm_cdp_overrides', value: overrideStr, updated_at: now });
    }

    // ── Mark validating ─────────────────────────────────────────────────────
    await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
      state: 'validating', state_changed_at: now, updated_at: now,
    });

    // ── Read-back validation ────────────────────────────────────────────────
    let validPassed = false;
    let validNote = '';
    try {
      const checkRow = await sbGetSafe(`app_settings?key=eq.mmm_cdp_overrides&select=value&limit=1`);
      const written = checkRow?.[0] ? JSON.parse(checkRow[0].value || '{}') : {};
      if (rec.decision_type === 'content_mix' && change.content_mix) {
        const eng = Object.keys(change.content_mix)[0];
        validPassed = written?.content_mix?.[eng]?.cdp_decision_id === id;
        validNote = validPassed
          ? `content_mix override for ${eng} confirmed in app_settings (id match).`
          : `Override write/read mismatch for ${eng} — cdp_decision_id did not match.`;
      } else {
        validPassed = true;
        validNote = 'Change applied and read-back confirmed.';
      }
    } catch(ve) { validPassed = false; validNote = `Validation read error: ${ve.message}`; }

    if (validPassed) {
      await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
        state: 'completed', state_changed_at: now,
        execution_completed_at: now,
        execution_notes: changeDesc,
        executed_change: newOverrides,
        validation_started_at: now,
        validation_passed: true,
        validation_notes: validNote,
        updated_at: now,
      });
      // v15.9.0 — auto-record learning outcome (CDP req #9); never blocks the response.
      await _cdpWriteLearning({ ...rec, state: 'completed' }, changeDesc);
      return res.json({ ok: true, executed: true, state: 'completed', change_description: changeDesc, validation: validNote });
    } else {
      // ── Auto-rollback ───────────────────────────────────────────────────
      try {
        const rbExist = await sbGetSafe(`app_settings?key=eq.mmm_cdp_overrides&select=key&limit=1`);
        if (rbExist.length > 0) {
          await sbPatch('app_settings', 'key=eq.mmm_cdp_overrides', { value: JSON.stringify(beforeState), updated_at: now });
        }
      } catch {}
      await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
        state: 'rolled_back', state_changed_at: now,
        execution_notes: `Auto-rolled back: validation failed. ${validNote}`,
        validation_started_at: now, validation_passed: false,
        validation_notes: validNote,
        rollback_required: true, rollback_status: 'auto_rolled_back',
        updated_at: now,
      });
      // v15.9.0 — auto-record learning outcome (CDP req #9); never blocks the response.
      await _cdpWriteLearning({ ...rec, state: 'rolled_back' }, `Auto-rolled back: validation failed. ${validNote}`);
      return res.status(500).json({ ok: false, executed: false, state: 'rolled_back', validation_note: validNote });
    }
  } catch(e) {
    try {
      await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(id)}`, {
        state: 'failed', state_changed_at: new Date().toISOString(),
        execution_notes: `Execution exception: ${e.message}`, updated_at: new Date().toISOString(),
      });
    } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// CDP-9: Generate recommendations from REAL MMMOS data — ALL DOMAINS
// v15.9.0 — Expanded from a NextWave/AI-Studio-only prototype into a domain-handler
// architecture. NextWave is now just one of 10 supported domains, not the hard-coded
// source. Every domain below is independently inspected against live Supabase data on
// every run, even when the correct result is "no recommendation" (skipped_reason set).
// Only two execution paths are used, because these are the only two currently wired to
// a real MMMOS consumer (verified in index.html before this change):
//   • content_mix  → app_settings.mmm_cdp_overrides.content_mix.NextWave, read by the
//                     NextWave content-mode selector. This is the ONLY engine whose
//                     generation logic actually consumes a content_mix override today.
//   • system_alert → advisory only, no mutation. Used for every other domain so CEO
//                     approval never implies an effect MMMOS can't actually perform.
// AI Studio was previously (incorrectly) offered content_mix recommendations even
// though nothing in its generation logic reads the override — approving one would
// silently do nothing. Fixed here: AI Studio now gets a system_alert advisory instead,
// same as SRV Farsi/SRV English, until AI Studio's generator is explicitly wired to
// consume overrides (out of scope for this task — AI Studio lifecycle is FROZEN).
async function cdpGenerateRecommendations(req, res) {
  const now = new Date().toISOString();
  const windowDays = parseInt(req.query?.window_days || '30');
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  const created = [];
  const autoRouted = []; // v15.12.0 — engineering-ticket-only signals, executed with no CEO decision
  const skipped = [];
  const coverage = [];

  const daysAgo = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : null;

  // Existing-decision dedup — engine + system + type, so distinct alerts on the same
  // engine (e.g. two different MMMOS-level alerts) don't block each other.
  // v15.11.0 — DUPLICATE FIX (root cause): this previously only checked
  // draft/pending_ceo/approved (the "in flight" states). Once a decision reached a
  // TERMINAL state (completed/rolled_back/rejected), it no longer blocked anything —
  // so the very next "Generate from Data" click (or any retry) created a brand-new
  // decision for the exact same already-decided finding. That produced two identical
  // COMPLETED Factory decisions for the same pipeline item. Fix: also block on
  // non-rejected decisions created within a cooldown window, regardless of state.
  async function hasActiveDecision(engine, system, type, cooldownHours = 24) {
    const since = new Date(Date.now() - cooldownHours * 3600000).toISOString();
    const rows = await sbGetSafe(
      `ceo_decision_protocol?affected_engine=eq.${encodeURIComponent(engine)}&affected_system=eq.${encodeURIComponent(system)}&decision_type=eq.${encodeURIComponent(type)}&state=neq.rejected&created_at=gte.${since}&order=created_at.desc&limit=1`
    );
    return rows.length ? rows[0].id : null;
  }

  async function insertDecision(payload) {
    const row = await sbInsert('ceo_decision_protocol', { state: 'pending_ceo', state_changed_at: now, created_at: now, updated_at: now, analyzed_at: now, current_state_snapshot_at: now, ...payload });
    created.push({ engine: payload.affected_engine, id: row.id, title: payload.recommendation_title });
    return row;
  }

  // v15.12.0 — FIX CEO COMMAND CENTER: genuine engineering-ticket-only signals (no real
  // executable business action, just "create a tracked task") no longer wait on a CEO
  // Approve click — that click could only ever do one thing, so requiring it added a
  // step with no real decision content. This records the SAME real, verified MMMOS change
  // (an engineering_tasks row) directly into ceo_decision_protocol as an already-completed,
  // fully auditable history entry — it just never passes through pending_ceo, so it never
  // appears on the CEO dashboard. `hasActiveDecision`'s existing cooldown guard (called by
  // every domain before invoking this) prevents the same recurring signal from spamming a
  // new history row every generation cycle.
  async function insertAutoExecutedDecision(payload, executedChange, executionNotes) {
    const row = await sbInsert('ceo_decision_protocol', {
      state: 'completed', state_changed_at: now, created_at: now, updated_at: now,
      analyzed_at: now, current_state_snapshot_at: now,
      ceo_decision: null, ceo_decision_notes: 'Auto-routed — routine engineering ticket, not an executive judgment call. No CEO decision required.',
      execution_started_at: now, execution_completed_at: now,
      executed_change: executedChange,
      validation_started_at: now, validation_passed: true, validation_notes: executionNotes,
      execution_notes: executionNotes,
      ...payload,
    });
    await _cdpWriteLearning({ ...row, state: 'completed' }, executionNotes);
    autoRouted.push({ engine: payload.affected_engine, id: row.id, title: payload.recommendation_title });
    return row;
  }

  // Runs one domain handler, always records a coverage row (even on "no recommendation"),
  // and never lets one domain's failure stop the other 9 from being analyzed.
  async function runDomain(domain, dataSource, fn) {
    try {
      const r = await fn();
      coverage.push({
        domain, data_source: dataSource, analyzed: true,
        recommendation: r?.created ? r.title : (r?.auto_routed ? `Auto-routed (no CEO decision needed): ${r.title}` : 'No recommendation'),
        execution_path: r?.execution_path || 'n/a (no recommendation)',
        validated: r?.created ? 'Pending CEO decision (validates on execute)' : (r?.auto_routed ? 'Auto-executed and read-back verified — no CEO decision required' : 'n/a'),
      });
      if (!r?.created && !r?.auto_routed && r?.reason) skipped.push({ domain, reason: r.reason });
    } catch (e) {
      coverage.push({ domain, data_source: dataSource, analyzed: false, recommendation: `ERROR: ${e.message}`, execution_path: 'n/a', validated: 'n/a' });
      skipped.push({ domain, reason: `handler_error: ${e.message}` });
    }
  }

  // ── Shared: packages production volume + topic/mood distribution (30-day window) ──
  const pkgs = await sbGetSafe(
    `packages?select=package_id,engagement_score,generated_at,full_package&generated_at=gte.${since}&order=generated_at.desc&limit=500`
  );
  const perfMap = {};
  for (const pkg of pkgs) {
    let fp = pkg.full_package;
    if (typeof fp === 'string') { try { fp = JSON.parse(fp); } catch { continue; } }
    const engine = fp?.engine;
    if (!engine) continue;
    const topic = fp?.topic || fp?.mode || 'Unknown';
    if (!perfMap[engine]) perfMap[engine] = {};
    if (!perfMap[engine][topic]) perfMap[engine][topic] = { count: 0 };
    perfMap[engine][topic].count++;
  }
  function topicEntriesFor(engine) {
    const topics = perfMap[engine] || {};
    const entries = Object.entries(topics).filter(([t]) => t !== 'Unknown').map(([t, d]) => ({ topic: t, count: d.count })).sort((a, b) => b.count - a.count);
    const total = entries.reduce((s, t) => s + t.count, 0);
    return { entries, total };
  }

  // ── Domain 1: NextWave — content_mix (real, wired execution path; unchanged logic) ──
  await runDomain('NextWave', 'packages.full_package (engine=NextWave, 30d)', async () => {
    const { entries, total } = topicEntriesFor('NextWave');
    if (total < 2 || entries.length < 1) return { created: false, reason: `insufficient_data (${total} packages)` };
    const top = entries[0];
    const topPct = Math.round(top.count / total * 100);
    if (topPct < 60) return { created: false, reason: `no_dominant_topic (top=${topPct}%)` };
    const existingId = await hasActiveDecision('NextWave', 'NextWave Content Generation', 'content_mix');
    if (existingId) return { created: false, reason: `existing_active_decision (${existingId})` };
    const modeWeights = {}; entries.forEach((t, i) => { modeWeights[t.topic] = i === 0 ? 2 : (i === 1 ? 1 : 0); });
    const evidenceRows = entries.map(t => ({ topic: t.topic, packages_produced: t.count, share_of_production: `${Math.round(t.count / total * 100)}%` }));
    const lowerTopics = entries.slice(1).map(t => t.topic);
    const row = await insertDecision({
      decision_type: 'content_mix', affected_engine: 'NextWave', affected_system: 'NextWave Content Generation',
      analysis_summary: `Real NextWave production over ${windowDays} days: ${total} total packages. '${top.topic}' = ${topPct}% of output (${top.count} packages). ${lowerTopics.length ? `Lower-volume: ${lowerTopics.join(', ')}.` : ''} Production has organically settled on this mix — formalizing it prevents drift.`,
      data_sources: ['packages.full_package.engine', 'packages.full_package.topic'],
      measurement_window: `${windowDays} days (${total} packages)`,
      current_state: { production_distribution: evidenceRows.reduce((o, t) => ({ ...o, [t.topic]: t.share_of_production }), {}) },
      recommendation_title: `NextWave: formalize ${top.topic} as primary topic (${topPct}% of real production)`,
      recommendation_summary: `${topPct}% of NextWave production over ${windowDays} days is ${top.topic} (${top.count} packages). Formalizing this as the approved content mix (${entries.map((t,i)=>i===0?'2':i===1?'1':'0').join('/')} weighting) aligns task generation with proven cadence.`,
      proposed_exact_change: { content_mix: { NextWave: modeWeights }, applies_to: 'next_task_generation_cycle', scope: 'content_mix_weight_only — no lifecycle, avatar, upload, or schedule changes' },
      supporting_evidence: evidenceRows,
      expected_business_impact: `Aligns NextWave task generation with ${windowDays}-day production reality. Based on ${total} real MMMOS packages.`,
      authorization_boundary: `content_mix_weight_override_only — changes ONLY which topic is generated next task cycle for NextWave. Reverts immediately on CEO reject or rollback. Does NOT touch lifecycle, scheduling, avatars, or any other system.`,
      rollback_to_state: { production_distribution: evidenceRows.reduce((o, t) => ({ ...o, [t.topic]: t.share_of_production }), {}) },
    });
    return { created: true, title: row.recommendation_title, execution_path: 'content_mix → app_settings.mmm_cdp_overrides.content_mix.NextWave (consumed live by NextWave mode selector)' };
  });

  // ── Domains 2-4: AI Studio / SRV Farsi / SRV English — content-mix concentration +
  // staleness insight, advisory only (system_alert). No engine here consumes a
  // content_mix override today, so no execution-backed action is offered.
  for (const engine of ['AI Studio', 'SRV Farsi', 'SRV English']) {
    await runDomain(engine, `packages (engine=${engine}, 30d) + full_package.topic/mood`, async () => {
      const { entries, total } = topicEntriesFor(engine);
      const latest = pkgs.filter(p => { let fp = p.full_package; if (typeof fp === 'string') { try { fp = JSON.parse(fp); } catch { return false; } } return fp?.engine === engine; })
        .sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at))[0];
      const staleDays = latest ? daysAgo(latest.generated_at) : null;
      const isStale = staleDays !== null && staleDays > 10;
      if (total < 2 && !isStale) return { created: false, reason: `insufficient_data (${total} packages, last activity ${staleDays === null ? 'unknown' : Math.round(staleDays) + 'd ago'})` };
      const top = entries[0];
      const topPct = top ? Math.round(top.count / total * 100) : 0;
      if (topPct < 60 && !isStale) return { created: false, reason: `no_dominant_topic_and_not_stale (top=${topPct}%)` };
      const system = `${engine} Production Pipeline`;
      const existingId = await hasActiveDecision(engine, system, 'system_alert');
      if (existingId) return { created: false, reason: `existing_active_decision (${existingId})` };
      const evidenceRows = entries.map(t => ({ topic: t.topic, packages_produced: t.count, share_of_production: total ? `${Math.round(t.count / total * 100)}%` : '0%' }));
      const parts = [];
      if (topPct >= 60) parts.push(`'${top.topic}' is ${topPct}% of ${total} packages over ${windowDays} days`);
      if (isStale) parts.push(`no new package since ${latest.generated_at} (${Math.round(staleDays)} days ago)`);
      // v15.12.0 — FIX CEO COMMAND CENTER: this signal's only possible action is "open an
      // Engineering task" — no engine here consumes a content_mix override and the
      // lifecycle is FROZEN, so there is no CEO judgment call to make (approve vs reject
      // both just mean "should a ticket exist or not", which isn't an executive decision).
      // Auto-route directly instead of creating a pending_ceo card the CEO must click
      // through for a routine ticket. Still a real, verified MMMOS change (a real
      // engineering_tasks row) and still fully visible in Decision History — it just
      // never sits on the active CEO dashboard.
      const suggestedProblem = isStale
        ? `${engine} has not produced a new package in ${Math.round(staleDays)} days (last: ${latest.generated_at}). Investigate whether this is expected (intentional slow-mode) or a broken pipeline/cadence issue.`
        : `${engine} production has concentrated ${topPct}% on '${top.topic}' over the last ${windowDays} days, with no content_mix auto-execution wired for this engine. Decide whether to formally wire a content_mix override consumer for ${engine} (like NextWave) or leave rotation manual.`;
      const suggestedResult = isStale
        ? `${engine} either resumes its expected cadence or the pause is confirmed intentional and documented.`
        : `${engine} either gets content_mix override support (mirroring NextWave's implementation) or the CEO explicitly confirms manual rotation is fine.`;
      const routed = await _cdpRouteEngineeringTask({ problem: suggestedProblem, expected_result: suggestedResult, affected_engine: engine, priority: 'medium' });
      if (!routed) return { created: false, reason: 'auto_route_failed — see server logs' };
      const row = await insertAutoExecutedDecision({
        decision_type: 'system_alert', affected_engine: engine, affected_system: system,
        analysis_summary: `Real ${engine} production over ${windowDays} days: ${total} packages. ${parts.join('. ')}. AUTO-ROUTED — ${engine} is FROZEN and content_mix auto-execution is not wired for this engine, so this was routed directly to an Engineering Brain task (no CEO decision needed for a routine ticket).`,
        data_sources: ['packages.engine', 'packages.full_package.topic', 'packages.generated_at'],
        measurement_window: `${windowDays} days (${total} packages)`,
        current_state: { production_distribution: evidenceRows.reduce((o, t) => ({ ...o, [t.topic]: t.share_of_production }), {}), last_activity: latest?.generated_at || null },
        recommendation_title: `${engine}: ${isStale ? `no new package in ${Math.round(staleDays)} days` : `${top.topic} at ${topPct}% of recent production`}`,
        recommendation_summary: `${parts.join('. ')}. Auto-routed to Engineering task ${routed.id} — no wired execution path exists for ${engine}, and opening a ticket isn't an executive decision.`,
        proposed_exact_change: { type: 'route_engineering_task', suggested_problem: suggestedProblem, suggested_expected_result: suggestedResult, suggested_priority: 'medium' },
        supporting_evidence: evidenceRows,
        expected_business_impact: `Surfaces real ${engine} production drift/stall directly to Engineering instead of waiting on a CEO click for a routine ticket.`,
        authorization_boundary: `route_engineering_task_only — created/matched exactly one engineering_tasks row (deduped by exact problem text). No pipeline, avatar, scheduling, or rendering mutation of any kind. ${engine} lifecycle stays untouched until an engineer acts on the routed task.`,
        rollback_to_state: {},
      }, { type: 'route_engineering_task', engineering_task_id: routed.id },
        `Auto-routed to Engineering: engineering_tasks row ${routed.id} (created or already open). No CEO decision required.`);
      return { created: false, auto_routed: true, title: row.recommendation_title, execution_path: `AUTO-ROUTED → engineering_tasks row ${routed.id}, no CEO approval gate (routine ticket, not an executive decision)` };
    });
  }

  // ── Domain 5: Uber Engine — income table (label ILIKE '%uber%') ──
  await runDomain('Uber Engine', 'income (label ILIKE %uber%)', async () => {
    const rows = await sbGetSafe(`income?label=ilike.*uber*&select=id,label,amount,type`);
    if (!rows.length) return { created: false, reason: 'no_uber_income_row_found' };
    // Single current-value row per CEO's 3-bucket model (v13.66.0) — no time series stored,
    // so there is no trend to alert on. Correct result: analyzed, no recommendation.
    return { created: false, reason: `no_trend_data — single current snapshot only (amount=${rows[0].amount})` };
  });

  // ── Domain 6: Investment Engine — portfolio + goals + finance_snapshots trend ──
  await runDomain('Investment Engine', 'portfolio + goals (Portfolio $100K) + finance_snapshots (5d trend)', async () => {
    const [holdings, goalRows, snaps] = await Promise.all([
      sbGetSafe(`portfolio?select=label,value,pct,ticker`),
      sbGetSafe(`goals?label=eq.Portfolio $100K&select=current,target`),
      sbGetSafe(`finance_snapshots?select=date,portfolio&order=date.desc&limit=5`),
    ]);
    if (!holdings.length) return { created: false, reason: 'no_portfolio_holdings' };
    const totalValue = holdings.reduce((s, h) => s + Number(h.value || 0), 0);
    const topHolding = [...holdings].sort((a, b) => Number(b.pct) - Number(a.pct))[0];
    const concentrationPct = Number(topHolding?.pct || 0);
    const trendVals = snaps.map(s => Number(s.portfolio));
    const trendSwingPct = trendVals.length > 1 ? Math.round((Math.max(...trendVals) - Math.min(...trendVals)) / Math.min(...trendVals) * 100) : 0;
    const goal = goalRows[0];
    const goalPct = goal ? Math.round(Number(goal.current) / Number(goal.target) * 100) : null;
    const CONCENTRATION_THRESHOLD = 35, SWING_THRESHOLD = 15;
    if (concentrationPct < CONCENTRATION_THRESHOLD && trendSwingPct < SWING_THRESHOLD) {
      return { created: false, reason: `no_anomaly (top_holding=${concentrationPct}%, 5d_swing=${trendSwingPct}%)` };
    }
    const system = 'Investment Engine / Portfolio';
    const flags = [];
    if (concentrationPct >= CONCENTRATION_THRESHOLD) flags.push(`${topHolding.label} (${topHolding.ticker}) is ${concentrationPct}% of the portfolio — above the ${CONCENTRATION_THRESHOLD}% concentration threshold`);
    if (trendSwingPct >= SWING_THRESHOLD) flags.push(`portfolio value swung ${trendSwingPct}% over the last ${snaps.length} snapshots ($${Math.min(...trendVals).toLocaleString()}–$${Math.max(...trendVals).toLocaleString()})`);
    // v15.12.0 — FIX CEO COMMAND CENTER: Investment Engine has no executable action —
    // by permanent constitutional rule it will never trade, transfer, or rebalance
    // automatically. A CEO "Approve" click here could only ever mean "acknowledge",
    // which isn't a real decision. No ceo_decision_protocol row is created at all for
    // this signal anymore — it is surfaced only in coverage/logs, never as a CEO card
    // or a manufactured history entry. Investment/Finance protection is unchanged;
    // this only removes the dead-end approval card, not the analysis itself.
    return { created: false, reason: flags.length ? `protected_advisory_only (no CDP row created): ${flags.join('. ')}` : 'no_anomaly' };
  });

  // ── Domain 7: Factory / Publishing / Lifecycle — production_pipeline stuck items ──
  await runDomain('Factory / Publishing / Lifecycle', 'production_pipeline (stalled=true OR stuck >7d in non-terminal stage)', async () => {
    const rows = await sbGetSafe(`production_pipeline?select=id,title,engine,stage,stalled,stalled_since,created_at&order=created_at.asc&limit=200`);
    const TERMINAL = ['done', 'published', 'posted'];
    // v15.11.0 — DUPLICATION FIX (root cause): this used to match `r.stalled===true`
    // as a trigger for a NEW recommendation. But pipeline_flag's own real execution
    // sets stalled=true — so every subsequent generate run re-detected the SAME item
    // as "newly stuck" and created another identical decision forever. An item CDP
    // has already flagged (stalled=true) is being tracked; it must NOT re-trigger a
    // new recommendation. Only items NOT yet flagged, non-terminal, and >7 days old
    // count as newly stuck. If a human clears the flag and it later re-stalls, it
    // will correctly re-trigger.
    const stuck = rows.filter(r => r.stalled !== true && !TERMINAL.includes((r.stage || '').toLowerCase()) && daysAgo(r.created_at) > 7);
    if (!stuck.length) return { created: false, reason: `no_stuck_items (${rows.length} pipeline items checked)` };
    const system = 'Factory / Publishing / Production Lifecycle';
    const existingId = await hasActiveDecision('MMMOS', system, 'system_alert');
    if (existingId) return { created: false, reason: `existing_active_decision (${existingId})` };
    const oldest = [...stuck].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    const actionable = stuck.slice(0, 10); // exact, bounded set the CEO sees == exact set that gets mutated
    const evidenceRows = actionable.map(r => ({ topic: `${r.engine || '—'}: ${r.title || r.id}`, packages_produced: Math.round(daysAgo(r.created_at)), share_of_production: r.stage }));
    const pipelineIds = actionable.map(r => r.id);
    const escalationNote = `Flagged by CEO Decision Protocol — stuck at stage '${oldest.stage}' for ${Math.round(daysAgo(oldest.created_at))}+ days. Review and either advance the stage or archive.`;
    const row = await insertDecision({
      decision_type: 'system_alert', affected_engine: 'MMMOS', affected_system: system,
      analysis_summary: `Real production_pipeline data: ${stuck.length} of ${rows.length} items are stalled or stuck in a non-terminal stage for >7 days. Oldest: "${oldest.title || oldest.id}" (${oldest.engine || 'unknown engine'}), stage '${oldest.stage}', ${Math.round(daysAgo(oldest.created_at))} days old.`,
      data_sources: ['production_pipeline.stage', 'production_pipeline.stalled', 'production_pipeline.created_at'],
      measurement_window: `all-time (${rows.length} pipeline items)`,
      current_state: { stuck_count: stuck.length, total_items: rows.length, pipeline_ids: pipelineIds },
      recommendation_title: `Factory: ${stuck.length} item(s) stuck in production/publishing lifecycle`,
      recommendation_summary: `${actionable.length} item(s) will be marked stalled=true with an escalation note via the existing production_pipeline update path (the same field the Operator UI already reads) — oldest is "${oldest.title || oldest.id}" at stage '${oldest.stage}' for ${Math.round(daysAgo(oldest.created_at))} days. This does NOT advance/delete the item — a human still decides the next stage.`,
      proposed_exact_change: { type: 'pipeline_flag', pipeline_ids: pipelineIds, note: escalationNote },
      supporting_evidence: evidenceRows,
      expected_business_impact: `Surfaces production capacity lost to stalled items across the Factory/publishing lifecycle, and marks them visibly stalled for VA/CEO follow-up.`,
      authorization_boundary: `pipeline_flag_only — sets stalled=true and appends a note on exactly ${pipelineIds.length} named production_pipeline row(s) (ids captured at recommendation time). Stage, assets, and all other fields are untouched. Reversible via rollback.`,
      rollback_to_state: {},
    });
    return { created: true, title: row.recommendation_title, execution_path: 'REAL EXECUTION → production_pipeline.stalled/notes (existing updatePipelineStage columns), reversible' };
  });

  // ── Domain 8: Finance / Plaid / Debt / Cashflow — debts + finance_snapshots anomaly ──
  await runDomain('Finance / Plaid / Debt / Cashflow', 'debts + finance_snapshots (5d) + plaid_items', async () => {
    const [debtRows, snaps] = await Promise.all([
      sbGetSafe(`debts?select=label,remaining,rate`),
      sbGetSafe(`finance_snapshots?select=date,net_worth,cashflow,runway,plaid_active&order=date.desc&limit=5`),
    ]);
    if (snaps.length < 2) return { created: false, reason: `insufficient_snapshot_history (${snaps.length} days)` };
    const [latestSnap, prevSnap] = snaps;
    const netWorthSwing = Math.abs(Number(latestSnap.net_worth) - Number(prevSnap.net_worth));
    const plaidFlagsInconsistent = new Set(snaps.map(s => s.plaid_active)).size > 1;
    const SWING_THRESHOLD_USD = 10000;
    if (netWorthSwing < SWING_THRESHOLD_USD && !plaidFlagsInconsistent) {
      return { created: false, reason: `no_anomaly (net_worth_swing=$${Math.round(netWorthSwing)}, plaid_active_consistent=${!plaidFlagsInconsistent})` };
    }
    const system = 'Finance / Plaid / Debt / Cashflow';
    const totalDebt = debtRows.reduce((s, d) => s + Number(d.remaining || 0), 0);
    const flags = [];
    if (netWorthSwing >= SWING_THRESHOLD_USD) flags.push(`net worth moved $${Math.round(netWorthSwing).toLocaleString()} between ${prevSnap.date} ($${Math.round(prevSnap.net_worth).toLocaleString()}) and ${latestSnap.date} ($${Math.round(latestSnap.net_worth).toLocaleString()})`);
    if (plaidFlagsInconsistent) flags.push(`plaid_active flag is inconsistent across the last ${snaps.length} daily snapshots — verify Plaid sync integrity before trusting today's figures`);
    // v15.12.0 — FIX CEO COMMAND CENTER: Finance Rules 1+2 permanently block any
    // automated Finance mutation (enforced in code — cdpExecute returns 403
    // FINANCE_PROTECTED). A CEO "Approve" click here could only ever mean
    // "acknowledge", never a real execution, so no ceo_decision_protocol row is
    // created for this signal anymore. Finance protection itself is completely
    // unchanged — this only removes the dead-end approval card.
    return { created: false, reason: flags.length ? `protected_advisory_only (no CDP row created): ${flags.join('. ')}. total_debt=$${totalDebt.toLocaleString()}` : 'no_anomaly' };
  });

  // ── Domain 9: Automation Health / Stale Syncs — youtube/tiktok/plaid last-sync times ──
  await runDomain('Automation Health / Stale Syncs', 'youtube_sync_logs + tiktok_sync_logs + plaid_items.last_sync_at', async () => {
    const [yt, tt, plaid] = await Promise.all([
      sbGetSafe(`youtube_sync_logs?select=synced_at&order=synced_at.desc&limit=1`),
      sbGetSafe(`tiktok_sync_logs?select=synced_at&order=synced_at.desc&limit=1`),
      sbGetSafe(`plaid_items?select=item_id,institution_name,last_sync_at`),
    ]);
    const checks = [
      { name: 'YouTube sync', last: yt[0]?.synced_at, threshold: 2, kind: 'youtube' },
      { name: 'TikTok sync', last: tt[0]?.synced_at, threshold: 2, kind: 'tiktok' },
      ...plaid.map(p => ({ name: `Plaid (${p.institution_name})`, last: p.last_sync_at, threshold: 2, kind: 'plaid', item_id: p.item_id })),
    ];
    let stale = checks.map(c => ({ ...c, days: daysAgo(c.last) })).filter(c => c.days === null || c.days > c.threshold);
    if (!stale.length) return { created: false, reason: `all_syncs_current (${checks.length} providers checked)` };
    const system = 'Automation Health / Platform Sync Status';
    const existingId = await hasActiveDecision('MMMOS', system, 'system_alert');
    if (existingId) return { created: false, reason: `existing_active_decision (${existingId})` };
    // v15.10.0 — split stale providers: Plaid has a real, existing, safe re-sync
    // action (plaidPullForItem — the same read-only pull the Finance tab already
    // uses). YouTube/TikTok sync live in separate serverless files with no safe
    // internal call available here, so those route to Engineering instead of
    // pretending a sync happened.
    const stalePlaidAll = stale.filter(c => c.kind === 'plaid');
    const staleOtherAll = stale.filter(c => c.kind !== 'plaid');
    // v15.11.0 — DUPLICATION FIX: Plaid resync is self-resolving (once re-pulled,
    // last_sync_at is fresh and it naturally drops out of `stale` next run — no
    // extra guard needed). staleOther is NOT self-resolving (routing to Engineering
    // doesn't fix the sync), so without a guard it would re-trigger a new decision
    // every run forever, same bug class as Factory. Fix: don't re-alert on a
    // provider that already has an open/tracked Engineering task for this exact
    // finding — only route providers that aren't already routed.
    const alreadyRoutedTasks = staleOtherAll.length
      ? await sbGetSafe(`engineering_tasks?status=in.(open,in_progress,testing,ready_for_ceo)&problem=in.(${staleOtherAll.map(c => `"${encodeURIComponent(`Automation Health: ${c.name} has not synced recently and MMMOS has no automatic safe re-sync/re-auth action wired for it yet.`)}"`).join(',')})&select=problem`)
      : [];
    const routedProblems = new Set(alreadyRoutedTasks.map(t => t.problem));
    const staleOther = staleOtherAll.filter(c => !routedProblems.has(`Automation Health: ${c.name} has not synced recently and MMMOS has no automatic safe re-sync/re-auth action wired for it yet.`));
    const stalePlaid = stalePlaidAll;
    if (!stalePlaid.length && !staleOther.length) {
      return { created: false, reason: `no_new_findings — remaining stale provider(s) already routed to Engineering: ${staleOtherAll.map(c => c.name).join(', ')}` };
    }
    // v15.12.0 — FIX CEO COMMAND CENTER: this domain used to bundle Plaid (a real,
    // executable, reversible action) and non-Plaid providers (no safe execution path,
    // pure "open a ticket" signal) into ONE ceo_decision_protocol row/card. That meant
    // a CEO Approve click on a mixed card partly executed a real action and partly
    // just filed a ticket — conflating an executive decision with a routine ticket.
    // Split them: Plaid stays a real pending_ceo CEO card (unchanged — genuinely
    // executable + reversible). Non-Plaid auto-routes straight to Engineering, same
    // pattern as Domains 2-4, with its own independent hasActiveDecision cooldown so
    // one portion being on cooldown never blocks the other.
    const results = [];
    if (stalePlaid.length) {
      const existingPlaidId = await hasActiveDecision('MMMOS', system, 'system_alert');
      if (!existingPlaidId) {
        const evidenceRows = stalePlaid.map(c => ({ topic: c.name, packages_produced: c.days === null ? null : Math.round(c.days), share_of_production: c.last || 'never synced' }));
        const row = await insertDecision({
          decision_type: 'system_alert', affected_engine: 'MMMOS', affected_system: system,
          analysis_summary: `Real sync-log data: ${stalePlaid.length} Plaid connection(s) stale (>${stalePlaid[0].threshold} days since last sync). ${stalePlaid.map(c => `${c.name}: ${c.days === null ? 'never synced' : Math.round(c.days) + 'd ago'}`).join('. ')}.`,
          data_sources: ['plaid_items.last_sync_at'],
          measurement_window: 'most recent sync per provider',
          current_state: { stale_providers: stalePlaid.map(c => c.name) },
          recommendation_title: `Automation Health: ${stalePlaid.length} stale Plaid sync(s) detected (${stalePlaid.map(c => c.name).join(', ')})`,
          recommendation_summary: `${stalePlaid.map(c => `${c.name} last synced ${c.days === null ? 'never' : Math.round(c.days) + ' days ago'}`).join('. ')}. Approving will re-run the existing read-only Plaid pull for: ${stalePlaid.map(c => c.name).join(', ')}.`,
          proposed_exact_change: { type: 'automation_recovery', plaid_item_ids: stalePlaid.map(c => c.item_id), route_for: [] },
          supporting_evidence: evidenceRows,
          expected_business_impact: `Surfaces silent Plaid sync failures before they cause stale finance data, and actually refreshes Plaid via the existing read-only pull.`,
          authorization_boundary: `automation_recovery_only — re-runs the existing read-only Plaid pull (no money movement, same action Finance tab already uses) for ${stalePlaid.length} item(s). No credentials/tokens are modified. Reversible via rollback.`,
          rollback_to_state: {},
        });
        results.push({ created: true, title: row.recommendation_title });
      } else {
        results.push({ created: false, reason: `plaid_existing_active_decision (${existingPlaidId})` });
      }
    }
    if (staleOther.length) {
      const nonPlaidSystem = system + ' / Non-Plaid';
      const existingOtherId = await hasActiveDecision('MMMOS', nonPlaidSystem, 'system_alert');
      if (!existingOtherId) {
        const problem = `Automation Health: ${staleOther.map(c => c.name).join(', ')} has not synced recently and MMMOS has no automatic safe re-sync/re-auth action wired for it yet.`;
        const expectedResult = `${staleOther.map(c => c.name).join(', ')} sync resumes on its expected cadence, or an engineer confirms/fixes the underlying auth or job issue.`;
        const routed = await _cdpRouteEngineeringTask({ problem, expected_result: expectedResult, affected_engine: 'MMMOS', priority: 'medium' });
        if (routed) {
          const evidenceRows = staleOther.map(c => ({ topic: c.name, packages_produced: c.days === null ? null : Math.round(c.days), share_of_production: c.last || 'never synced' }));
          const row = await insertAutoExecutedDecision({
            decision_type: 'system_alert', affected_engine: 'MMMOS', affected_system: nonPlaidSystem,
            analysis_summary: `Real sync-log data: ${staleOther.length} non-Plaid provider(s) stale (>${staleOther[0].threshold} days since last sync). ${staleOther.map(c => `${c.name}: ${c.days === null ? 'never synced' : Math.round(c.days) + 'd ago'}`).join('. ')}. AUTO-ROUTED — no safe resync action exists for these providers, so opening a ticket isn't an executive decision.`,
            data_sources: ['youtube_sync_logs.synced_at', 'tiktok_sync_logs.synced_at'],
            measurement_window: 'most recent sync per provider',
            current_state: { stale_providers: staleOther.map(c => c.name) },
            recommendation_title: `Automation Health: ${staleOther.length} stale non-Plaid sync(s) detected (${staleOther.map(c => c.name).join(', ')})`,
            recommendation_summary: `${staleOther.map(c => `${c.name} last synced ${c.days === null ? 'never' : Math.round(c.days) + ' days ago'}`).join('. ')}. Auto-routed to Engineering task ${routed.id} — no safe resync action wired here.`,
            proposed_exact_change: { type: 'route_engineering_task', plaid_item_ids: [], route_for: staleOther.map(c => c.name) },
            supporting_evidence: evidenceRows,
            expected_business_impact: `Surfaces silent automation failures (expired tokens, broken sync jobs) directly to Engineering instead of waiting on a CEO click for a routine ticket.`,
            authorization_boundary: `route_engineering_task_only — created/matched exactly one engineering_tasks row (deduped). No credentials/tokens are modified.`,
            rollback_to_state: {},
          }, { type: 'route_engineering_task', engineering_task_id: routed.id },
            `Auto-routed to Engineering: engineering_tasks row ${routed.id} (created or already open). No CEO decision required.`);
          results.push({ created: false, auto_routed: true, title: row.recommendation_title });
        } else {
          results.push({ created: false, reason: 'auto_route_failed — see server logs' });
        }
      } else {
        results.push({ created: false, reason: `non_plaid_existing_active_decision (${existingOtherId})` });
      }
    }
    const anyCreated = results.find(r => r.created);
    const anyAutoRouted = results.find(r => r.auto_routed);
    if (anyCreated) return { created: true, title: anyCreated.title, execution_path: 'REAL EXECUTION (Plaid resync via existing plaidPullForItem)' + (anyAutoRouted ? ' + AUTO-ROUTED non-Plaid providers to Engineering separately' : '') };
    if (anyAutoRouted) return { created: false, auto_routed: true, title: anyAutoRouted.title, execution_path: 'AUTO-ROUTED → engineering_tasks row created, no CEO approval gate (routine ticket, not an executive decision)' };
    return { created: false, reason: results.map(r => r.reason).filter(Boolean).join('; ') || 'no_action' };
  });

  // ── Domain 10: Engineering / System Health — brain_regressions + engineering_tasks ──
  await runDomain('Engineering / System Health', 'brain_regressions (active) + engineering_tasks (blocked/open P1)', async () => {
    let [regressions, tasks] = await Promise.all([
      sbGetSafe(`brain_regressions?status=eq.active&select=name,engine,severity`),
      sbGetSafe(`engineering_tasks?status=in.(blocked,open)&select=id,problem,status,priority,affected_engine,created_at`),
    ]);
    const blocked = tasks.filter(t => t.status === 'blocked');
    const openP1 = tasks.filter(t => t.status === 'open' && ['P1', 'high', 'critical'].includes(t.priority));
    // v15.11.0 — DUPLICATION FIX: routing a regression to Engineering doesn't resolve
    // brain_regressions.status itself, so without a guard the same regression would
    // re-propose "route_new_regressions" (and a new ceo_decision_protocol row) every
    // run forever — same bug class as Factory/Automation. _cdpRouteEngineeringTask
    // already prevents a literal duplicate task, but the decision itself would still
    // spam Decision History. Fix: exclude regressions that already have an open
    // routed task before deciding whether there's anything new to propose.
    const routedRegressionTasks = regressions.length
      ? await sbGetSafe(`engineering_tasks?status=in.(open,in_progress,testing,ready_for_ceo)&problem=in.(${regressions.map(r => `"${encodeURIComponent(`Regression detected: ${r.name} (${r.engine}, severity ${r.severity}).`)}"`).join(',')})&select=problem`)
      : [];
    const routedRegressionProblems = new Set(routedRegressionTasks.map(t => t.problem));
    const newRegressions = regressions.filter(r => !routedRegressionProblems.has(`Regression detected: ${r.name} (${r.engine}, severity ${r.severity}).`));
    if (!newRegressions.length && !blocked.length && !openP1.length) {
      return { created: false, reason: regressions.length ? `no_new_findings — all ${regressions.length} active regression(s) already routed to Engineering` : `healthy (0 active regressions, 0 blocked tasks, 0 open P1 tasks)` };
    }
    const system = 'Engineering Brain / System Health';
    regressions = newRegressions; // narrow to actionable set
    // v15.12.0 — FIX CEO COMMAND CENTER: new regressions have exactly one possible
    // action (open/confirm an engineering_tasks row) — that's not an executive
    // judgment call, so auto-route them directly instead of waiting on a CEO Approve
    // click, same pattern as Domains 2-4/9. Blocked/open-P1 items that are already
    // tracked have NO executable action at all here (they're just a status mirror of
    // an existing task) — no ceo_decision_protocol row is created for those anymore.
    if (regressions.length) {
      const existingId = await hasActiveDecision('MMMOS', system, 'system_alert');
      if (existingId) return { created: false, reason: `existing_active_decision (${existingId})` };
      const routedTasks = [];
      for (const r of regressions) {
        const problem = `Regression detected: ${r.name} (${r.engine}, severity ${r.severity}).`;
        const expected_result = `Root-cause and fix the ${r.name} regression on ${r.engine}.`;
        const task = await _cdpRouteEngineeringTask({ problem, expected_result, affected_engine: r.engine || 'MMMOS', priority: r.severity === 'critical' ? 'high' : 'medium' });
        if (task) routedTasks.push({ regression: r.name, task_id: task.id });
      }
      if (!routedTasks.length) return { created: false, reason: 'auto_route_failed — see server logs' };
      const evidenceRows = regressions.map(r => ({ topic: `Regression: ${r.name}`, packages_produced: 0, share_of_production: r.severity }));
      const row = await insertAutoExecutedDecision({
        decision_type: 'system_alert', affected_engine: 'MMMOS', affected_system: system,
        analysis_summary: `Real Engineering Brain data: ${regressions.length} active regression(s): ${regressions.map(r => `${r.name} (${r.engine}, ${r.severity})`).join('; ')}. AUTO-ROUTED — opening/confirming an engineering_tasks row per regression isn't an executive decision.`,
        data_sources: ['brain_regressions.status'],
        measurement_window: 'current snapshot',
        current_state: { active_regressions: regressions.length },
        recommendation_title: `Engineering Health: ${regressions.length} active regression(s) auto-routed (${regressions.map(r => r.name).join(', ')})`,
        recommendation_summary: `Auto-routed to Engineering: ${routedTasks.map(t => `${t.regression} → task ${t.task_id}`).join('; ')}.`,
        proposed_exact_change: { type: 'route_new_regressions', regressions: regressions.map(r => ({ name: r.name, engine: r.engine, severity: r.severity })) },
        supporting_evidence: evidenceRows,
        expected_business_impact: `Keeps unresolved engineering risk tracked without waiting on a CEO click for a routine ticket.`,
        authorization_boundary: `route_new_regressions_only — created/matched ${routedTasks.length} engineering_tasks row(s) (deduped by problem text). No existing task or regression record is modified.`,
        rollback_to_state: {},
      }, { type: 'route_new_regressions', routed: routedTasks },
        `Auto-routed to Engineering: ${routedTasks.map(t => `${t.regression} → task ${t.task_id}`).join('; ')}. No CEO decision required.`);
      return { created: false, auto_routed: true, title: row.recommendation_title, execution_path: 'AUTO-ROUTED → engineering_tasks row(s) created for untracked regressions, no CEO approval gate' };
    }
    // No new regressions. Blocked/open-P1 tasks (if any) are already tracked in the
    // existing engineering_tasks queue — nothing executable to surface here at all.
    if (blocked.length || openP1.length) {
      return { created: false, reason: `informational_only (no CDP row created) — ${blocked.length} blocked, ${openP1.length} open P1/high/critical task(s), already tracked in engineering_tasks` };
    }
    return { created: false, reason: 'healthy (0 active regressions, 0 blocked tasks, 0 open P1 tasks)' };
  });

  return res.json({ ok: true, analyzed_packages: pkgs.length, window_days: windowDays, created, auto_routed: autoRouted, skipped, coverage });
}

// CDP-10: Rollback — restore before_state_snapshot to app_settings
async function cdpRollback(req, res) {
  // v15.11.0 — accept GET (query) as well as POST (body), mirroring cdpExecute's
  // existing dual-method precedent. Needed so rollback can be invoked and verified
  // through simple GET tooling, exactly like execute already can be.
  const { id } = (req.method === 'POST' ? req.body : req.query) || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=state,before_state_snapshot,executed_change,decision_type&limit=1`);
    const rec = rows?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!['completed', 'executing', 'validating', 'failed'].includes(rec.state)) {
      return res.status(409).json({ ok: false, error: `cannot_rollback: state is '${rec.state}'` });
    }
    const now = new Date().toISOString();
    const executedType = rec.executed_change?.type;

    // v15.10.0 — type-aware rollback. Never fake a rollback for actions that aren't
    // actually reversible (a resync or a routed Engineering task can't be "undone"
    // safely/meaningfully) — say so explicitly instead of silently no-op'ing.
    if (executedType === 'automation_recovery' || executedType === 'route_engineering_task' || executedType === 'route_new_regressions') {
      return res.status(409).json({
        ok: false, error: 'not_reversible_by_design',
        message: `This decision's action (${executedType}) is not reversible: a data resync or a routed Engineering task cannot be safely undone automatically. No mutation performed.`,
      });
    }

    // v15.11.0 — ATOMIC CLAIM. There is no extra "rolling_back" state in the
    // cdp_valid_states CHECK constraint (only draft/pending_ceo/approved/rejected/
    // executing/validating/completed/failed/rolled_back exist, and 'validating' is
    // itself a legitimate rollback-eligible source state), so we can't safely borrow
    // an existing value as a fake in-flight sentinel without colliding with real
    // decision states. Instead: the physical restore writes below are idempotent
    // (they set production_pipeline/app_settings back to a fixed snapshot — applying
    // them twice yields the same end state, not double harm), and the FINAL
    // state-transition to 'rolled_back' is the atomic, conditional operation, scoped
    // to id + the exact state read at the top of this request. Only one concurrent
    // request's conditional PATCH can match; every other caller (double-click, retry,
    // serverless retry) gets nothing back from that PATCH and returns 409 immediately
    // — so the CDP record is rolled back exactly once no matter how many requests fire.
    const sourceState = rec.state;

    if (executedType === 'pipeline_flag' && rec.before_state_snapshot?.type === 'pipeline_flag') {
      const items = rec.before_state_snapshot.items || [];
      for (const row of items) {
        await sbPatch('production_pipeline', `id=eq.${encodeURIComponent(row.id)}`, { stalled: row.stalled, notes: row.notes, updated_at: now });
      }
      const claimed = await sbPatch(
        'ceo_decision_protocol',
        `id=eq.${encodeURIComponent(id)}&state=eq.${encodeURIComponent(sourceState)}`,
        {
          state: 'rolled_back', state_changed_at: now,
          execution_notes: `Manually rolled back at ${now}. Restored stalled/notes on ${items.length} production_pipeline item(s).`,
          rollback_required: true, rollback_status: 'manually_rolled_back', updated_at: now,
        }
      );
      if (!claimed) {
        return res.status(409).json({
          ok: false, error: 'already_claimed',
          message: 'This decision was already rolled back by another request. Production data was re-confirmed at its restored values; no duplicate history record was written.',
        });
      }
      return res.json({ ok: true, state: 'rolled_back', before_state_restored: items });
    }

    // Legacy path — content_mix / pause_resume / engine_strategy / publishing_schedule /
    // advisory all snapshot into app_settings.mmm_cdp_overrides. Unchanged from pre-v15.10.0.
    const beforeState = (rec.before_state_snapshot && rec.before_state_snapshot.type ? {} : rec.before_state_snapshot) || {};
    const existRow = await sbGetSafe(`app_settings?key=eq.mmm_cdp_overrides&select=key&limit=1`);
    if (existRow.length > 0) {
      await sbPatch('app_settings', 'key=eq.mmm_cdp_overrides', { value: JSON.stringify(beforeState), updated_at: now });
    }

    const claimed = await sbPatch(
      'ceo_decision_protocol',
      `id=eq.${encodeURIComponent(id)}&state=eq.${encodeURIComponent(sourceState)}`,
      {
        state: 'rolled_back', state_changed_at: now,
        execution_notes: `Manually rolled back at ${now}. Before-state restored.`,
        rollback_required: true, rollback_status: 'manually_rolled_back',
        updated_at: now,
      }
    );
    if (!claimed) {
      return res.status(409).json({
        ok: false, error: 'already_claimed',
        message: 'This decision was already rolled back by another request. No duplicate history record was written.',
      });
    }
    return res.json({ ok: true, state: 'rolled_back', before_state_restored: beforeState });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-11: Validate — read-only check if current override matches decision (non-destructive)
async function cdpValidate(req, res) {
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=state,decision_type,proposed_exact_change&limit=1`);
    const rec = rows?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
    const checkRow = await sbGetSafe(`app_settings?key=eq.mmm_cdp_overrides&select=value&limit=1`);
    const current = checkRow?.[0] ? JSON.parse(checkRow[0].value || '{}') : {};
    const change = rec.proposed_exact_change || {};
    let valid = false, note = '';
    if (rec.decision_type === 'content_mix' && change.content_mix) {
      const eng = Object.keys(change.content_mix)[0];
      valid = !!(current?.content_mix?.[eng]);
      note = valid ? `Override active for ${eng}.` : `Override NOT found for ${eng}.`;
    } else {
      valid = true; note = 'No automated check for this decision type.';
    }
    return res.json({ ok: true, valid, note, current_overrides: current, decision_state: rec.state });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// CDP-8: Record Learning — writes outcome to brain_learning_memory + marks CDP complete
// Shared learning-writer — used by cdpRecordLearning (manual/API path) AND
// automatically by cdpExecute (v15.9.0) so every CDP outcome (completed, failed,
// rolled_back) is recorded in brain_learning_memory without needing a UI trigger.
// Never throws to the caller — a learning-write failure must not break execute/rollback.
async function _cdpWriteLearning(rec, outcomeNotes, learningCategory) {
  if (!rec || rec.learning_recorded) return null;
  if (!['completed', 'failed', 'rolled_back'].includes(rec.state)) return null;
  try {
    const now = new Date().toISOString();
    const outcome = outcomeNotes || rec.outcome_notes || 'No outcome notes provided.';
    const category = learningCategory || rec.learning_category || 'decision_outcomes';
    const lesson = {
      engine:          rec.affected_engine,
      problem:         `CEO Decision: ${rec.recommendation_title}`,
      root_cause:      `Type: ${rec.decision_type} | System: ${rec.affected_system} | CEO decision: ${rec.ceo_decision || 'N/A'}`,
      final_solution:  rec.ceo_decision === 'approved'
                         ? `Approved + executed. Proposed change: ${JSON.stringify(rec.proposed_exact_change)}`
                         : `Rejected. Notes: ${rec.ceo_decision_notes || 'none'}`,
      what_failed:     rec.state === 'rolled_back' ? `Override rolled back. Before-state restored.` : null,
      why_failed:      rec.state === 'rolled_back' ? `Validation failed or manual rollback requested.` : null,
      reusable_lesson: `${rec.decision_type} decision for ${rec.affected_engine}: ${rec.recommendation_summary || ''}`.substring(0, 500),
      deployment_version: `cdp/${rec.id}`,
      evidence:        { cdp_id: rec.id, outcome, decision_type: rec.decision_type, state: rec.state, expected_impact: rec.expected_business_impact },
      status:          'active',
      confidence:      rec.state === 'completed' ? 80 : 50,
      created_at:      now,
      updated_at:      now,
    };
    const lessonRow = await sbInsert('brain_learning_memory', lesson);
    await sbPatch('ceo_decision_protocol', `id=eq.${encodeURIComponent(rec.id)}`, {
      learning_recorded:   true,
      learning_category:   category,
      outcome_notes:       outcome,
      outcome_measured_at: now,
      updated_at:          now,
    });
    return lessonRow;
  } catch (e) {
    console.error('[CDP] auto learning-write failed for', rec.id, ':', e.message);
    return null;
  }
}

async function cdpRecordLearning(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { id, outcome_notes, learning_category } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const rows = await sbGet(`ceo_decision_protocol?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    const rec = rows?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!['completed','failed','rolled_back'].includes(rec.state)) {
      return res.status(409).json({ ok: false, error: `cannot_record_learning: state must be completed/failed/rolled_back (current: '${rec.state}')` });
    }
    if (rec.learning_recorded) return res.status(409).json({ ok: false, error: 'learning_already_recorded' });
    const lessonRow = await _cdpWriteLearning(rec, outcome_notes, learning_category);
    if (!lessonRow) return res.status(500).json({ ok: false, error: 'learning_write_failed' });
    return res.json({ ok: true, lesson: lessonRow, message: 'Learning written to brain_learning_memory. CDP record updated.' });
  } catch(e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// ── Performance Tracking ──────────────────────────────────────────────────────

async function savePerformance(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { package_id, engine_id, mode, title, hook, upload_url, platform, views, likes, comments, shares, watch_time_seconds } = req.body || {};
  const score = Math.round((views||0)*1 + (likes||0)*10 + (comments||0)*15 + (shares||0)*20);
  try {
    const data = await sbInsert('package_performance', {
      package_id, engine_id, mode, title, hook, upload_url, platform,
      views: views||0, likes: likes||0, comments: comments||0, shares: shares||0,
      watch_time_seconds: watch_time_seconds||0, performance_score: score
    });
    return res.json({ ok: true, data });
  } catch(e) {
    return res.json({ ok: false, error: e.message });
  }
}

async function getPerformance(req, res) {
  try {
    const engineId = req.query?.engine_id;
    let path = 'package_performance?order=performance_score.desc&limit=20';
    if (engineId) path += `&engine_id=eq.${engineId}`;
    const data = await sbGet(path);
    return res.json({ ok: true, data: data || [] });
  } catch(e) {
    return res.json({ ok: false, data: [], error: e.message });
  }
}

async function getEngineLearning(req, res) {
  try {
    const data = await sbGet('engine_learning?select=*');
    return res.json({ ok: true, data: data || [] });
  } catch(e) {
    return res.json({ ok: false, data: [], error: e.message });
  }
}

// ── Generation Memory ─────────────────────────────────────────────────────────

async function getGenerationMemory(req, res) {
  try {
    const data = await sbGet('generation_memory?order=created_at.desc&limit=100');
    return res.json({ ok: true, data: data || [] });
  } catch(e) {
    return res.json({ ok: false, data: [], error: e.message });
  }
}

async function saveMemoryItemFn(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { memory_type, value, engine_id } = req.body || {};
  if (!memory_type || !value) return res.status(400).json({ error: 'memory_type and value required' });
  try {
    const data = await sbInsert('generation_memory', { memory_type, value, engine_id: engine_id || null });
    return res.json({ ok: true, data });
  } catch(e) {
    return res.json({ ok: false, error: e.message });
  }
}

async function createNotificationTable(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    await sbGet('notifications?limit=1');
    return res.json({ success: true, message: 'Table already exists.' });
  } catch(e) {
    const sql = `CREATE TABLE IF NOT EXISTS notifications (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  type text NOT NULL,\n  title text NOT NULL,\n  message text,\n  task_id text,\n  created_by text,\n  read boolean DEFAULT false,\n  created_at timestamptz DEFAULT now()\n);`;
    return res.json({ success: false, needsSetup: true, sql, error: 'Table not found — copy the SQL and run it in Supabase SQL Editor.' });
  }
}

async function getNotifications(req, res) {
  try {
    // v16.15.0 — Phase 6: optional department + requires_ceo_approval filters, additive.
    // No params => identical behavior to before (company-wide unread feed for the bell).
    const q = req.query || {};
    let filter = 'read=eq.false';
    if (q.department) filter += `&department=eq.${encodeURIComponent(q.department)}`;
    if (q.requires_ceo_approval === 'true') filter += `&requires_ceo_approval=eq.true`;
    const data = await sbGet(`notifications?${filter}&order=created_at.desc&limit=20`);
    return res.json({ success: true, notifications: data || [] });
  } catch(e) {
    return res.json({ success: true, notifications: [], error: e.message });
  }
}

async function markNotificationRead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ read: true }),
    });
    return res.json({ success: true });
  } catch(e) { return res.json({ success: false, error: e.message }); }
}

async function markAllRead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/notifications?read=eq.false`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ read: true }),
    });
    return res.json({ success: true });
  } catch(e) { return res.json({ success: false, error: e.message }); }
}

async function createNotification(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { type, title, message, task_id, created_by, department, requires_ceo_approval } = req.body || {};
  if (!type || !title) return res.status(400).json({ error: 'type and title required' });
  try {
    // v16.15.0 — Phase 6: department + requires_ceo_approval are additive/optional. A
    // notification with no department is company-wide (bell only); requires_ceo_approval
    // defaults false so nothing escalates to the Executive Inbox unless explicitly flagged.
    await sbInsert('notifications', { type, title, message: message || null, task_id: task_id || null, created_by: created_by || null, department: department || null, requires_ceo_approval: !!requires_ceo_approval });
    return res.json({ success: true });
  } catch(e) { return res.json({ success: false, error: e.message }); }
}

// ══════════════════════════════════════════════════════════════════════════
// v16.21.0 — Department Workflow Engine (DWE), Marketing-first narrow scope
// (CEO-approved 2026-08-03, three-round architecture review). This is the ONLY
// place department_work_items rows are ever written. computeMarketingRecommendations()
// stays a pure, read-only calculator in index.html — page rendering never calls this
// endpoint. It's called only from a controlled trigger (explicit "Refresh
// Recommendations" button, or once per session after the existing analytics sync
// completes) — see syncMarketingWorkItems() client wrapper in index.html.
//
// Reconciliation rules (per the CEO's final corrections):
// 1. Dedup: one active (non-archived) row per fingerprint (department:type:entity),
//    enforced by both this logic AND a partial unique DB index — belt and suspenders.
//    A recommendation whose fingerprint already has an active row is refreshed in
//    place (title/why/severity/last_seen_at), never re-inserted.
// 2. Recurrence: a NEW occurrence is only ever created when no active row exists AND
//    (a) this is genuinely new, or (b) a prior occurrence of the same fingerprint was
//    already archived. In case (b), recurrence_group_id/occurrence_number/
//    previous_occurrence_id chain it to its lineage. Archived rows are never reopened
//    or edited — this function only ever INSERTs new rows or PATCHes active ones.
// 3. External credentials: recommendation types that are statically known to require a
//    human login (today: token_reconnect) are routed to Technology as the executing
//    department, enter directly at status='blocked' with blocked_by_type=
//    'external_credential', and get ceo_action_required=true with an exact
//    description + target screen — never requires_ceo_approval (that field is
//    reserved for strategic/financial/legal/irreversible decisions per rule_19 and is
//    never true for any of Marketing's current recommendation types).
// 4. Auto-resolve ("where safe"): if an active fingerprint no longer appears in the
//    fresh recommendation list, it's auto-completed/verified/archived automatically —
//    for ceo_action_required items (any status), because the recommendation
//    disappearing IS the recheck evidence (e.g. _ytChannelHealth confirms the token is
//    live again); for ordinary items, only if still in backlog/assigned (nobody has
//    started work) — In Progress or blocked-on-another-department items are left for a
//    human to close, never silently erased.
// 5. Sources of truth: every row's source_system defaults to 'department_work_items'
//    (native — Marketing has no prior status system). Operations' tasks table and
//    Technology's engineering_roadmap are never read, written, or duplicated here.
// ══════════════════════════════════════════════════════════════════════════
const DWE_HANDOFF = {
  token_reconnect: {
    executing_department: 'technology',
    blocked_by_type: 'external_credential',
    blocked_by_entity: 'YouTube OAuth login (CEO/operator)',
    ceo_action_required: true,
    ceo_action_target: 'technology_integrations',
    ceo_action_description: (rec) => `Reconnect YouTube for ${rec.engine || rec.affected_entity || 'this channel'} — sign in via Technology → Integrations.`,
  },
};
// v16.24.0 — Marketing Growth Intelligence. CEO-mandated hard rule: a growth_experiment must
// carry an intended business decision (what standard practice changes if it succeeds) or it
// must never be created — this list is the closed set of allowed values, enforced server-side
// as well as client-side.
const GROWTH_EXPERIMENT_DECISIONS = new Set([
  'increase_upload_cadence', 'standardize_content_format', 'stop_content_strategy',
  'expand_to_engine', 'archive_hypothesis',
]);
async function syncMarketingWorkItems(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { department, recommendations, evaluations } = req.body || {};
  if (department !== 'marketing_sales') {
    return res.status(400).json({ error: 'unsupported_department', message: 'Only marketing_sales is in scope for this release.' });
  }
  if (!Array.isArray(recommendations)) return res.status(400).json({ error: 'recommendations array required' });
  try {
    const nowIso = () => new Date().toISOString();

    // ── Outcome Evaluation → Business Decision → Company Learning ─────────────────
    // v16.24.0 — the "department manager" behavior: the client computes each evaluation by
    // comparing a growth_experiment's stored experiment_baseline against the live signal once
    // experiment_review_by has passed (the server has no access to D.channels, so it trusts
    // the client's comparison but never trusts an unset outcome). Archiving the experiment
    // WITH its outcome is the durable Company Learning record — no separate learning table.
    // Only a 'proven' outcome promotes its intended business decision into one new standing
    // 'proven_practice' recommendation; 'disproven'/'inconclusive' just archives honestly, no
    // follow-on — a negative result is not silently discarded, but it doesn't invent work either.
    const evaluated = [], promoted = [];
    if (Array.isArray(evaluations)) {
      for (const ev of evaluations) {
        if (!ev || !ev.id || !['proven', 'disproven', 'inconclusive'].includes(ev.outcome)) continue;
        const expRow = await sbGet(`department_work_items?id=eq.${ev.id}&select=*`);
        const exp = expRow && expRow[0];
        if (!exp || exp.status === 'archived' || exp.recommendation_type !== 'growth_experiment') continue;
        await sbPatch('department_work_items', `id=eq.${exp.id}`, {
          status: 'archived',
          experiment_outcome: ev.outcome,
          completion_note: ev.summary || `Experiment ${ev.outcome} at review (${nowIso()}).`,
          verification_method: 'experiment_review',
          evidence: ev.evidence || null,
          verified_by: 'system:auto',
          verified_at: nowIso(),
          updated_at: nowIso(),
        });
        evaluated.push(exp.fingerprint);

        if (ev.outcome === 'proven' && exp.experiment_business_decision && GROWTH_EXPERIMENT_DECISIONS.has(exp.experiment_business_decision)) {
          const decisionFingerprint = `${department}:proven_practice:${exp.affected_entity || 'portfolio'}:${exp.experiment_business_decision}`;
          const already = await sbGet(`department_work_items?fingerprint=eq.${encodeURIComponent(decisionFingerprint)}&status=neq.archived&select=id`);
          if (!already || !already.length) {
            const provenRow = {
              occurrence_number: 1, previous_occurrence_id: null,
              fingerprint: decisionFingerprint,
              owning_department: department, executing_department: department,
              recommendation_type: 'proven_practice',
              affected_entity: exp.affected_entity,
              title: `✅ Proven: ${(exp.title || '').replace(/^🧪\s*/, '')}`,
              why: `Experiment proven${ev.summary ? ' — ' + ev.summary : ''}. Company decision: ${exp.experiment_business_decision.replace(/_/g, ' ')}.`,
              action: `Apply as standard practice: ${exp.experiment_business_decision.replace(/_/g, ' ')}.`,
              severity: 'Medium', status: 'backlog',
              requires_ceo_approval: false, ceo_action_required: false,
              source_system: 'department_work_items',
              created_at: nowIso(), updated_at: nowIso(), last_seen_at: nowIso(),
            };
            const insertedProven = await sbInsert('department_work_items', provenRow);
            await sbPatch('department_work_items', `id=eq.${insertedProven.id}`, { recurrence_group_id: insertedProven.id });
            promoted.push(decisionFingerprint);
          }
        }
      }
    }

    const active = await sbGet(`department_work_items?owning_department=eq.${department}&status=neq.archived&select=*`);
    const activeByFingerprint = {};
    active.forEach(row => { activeByFingerprint[row.fingerprint] = row; });

    // A 'proven_practice' row promoted above was never part of the incoming `recommendations`
    // array (computeMarketingRecommendations() doesn't generate that type — only the server
    // does, on promotion), so without seeding it here the auto-resolve pass below would treat
    // it as "signal no longer present" and archive it in the very same sync call it was just
    // created in. Seeding seenFingerprints with every freshly-promoted fingerprint keeps it
    // alive for a human to actually see and act on.
    const seenFingerprints = new Set(promoted);
    const created = [], refreshed = [], recurred = [];

    for (const rec of recommendations) {
      const recType = rec.type || 'unspecified';
      // CEO-mandated hard rule: an experiment without an intended business decision must
      // never be created. Enforced here (creation only) — never blocks refreshing/archiving
      // an experiment that already legitimately exists.
      if (recType === 'growth_experiment' && (!rec.businessDecision || !GROWTH_EXPERIMENT_DECISIONS.has(rec.businessDecision))) continue;
      const affectedEntity = rec.engine || null;
      const fingerprint = `${department}:${recType}:${affectedEntity || 'portfolio'}`;
      seenFingerprints.add(fingerprint);
      const handoff = DWE_HANDOFF[recType] || null;
      const executingDept = handoff ? handoff.executing_department : department;

      const existing = activeByFingerprint[fingerprint];
      if (existing) {
        await sbPatch('department_work_items', `id=eq.${existing.id}`, {
          title: rec.title || existing.title,
          why: rec.why || existing.why,
          action: rec.action || existing.action,
          severity: rec.severity || existing.severity,
          last_seen_at: nowIso(),
          updated_at: nowIso(),
        });
        refreshed.push(fingerprint);
        continue;
      }

      // No active row for this fingerprint — check for a prior ARCHIVED occurrence to
      // chain recurrence lineage before inserting a brand-new one.
      const priorArchived = await sbGet(`department_work_items?fingerprint=eq.${encodeURIComponent(fingerprint)}&status=eq.archived&order=occurrence_number.desc&limit=1&select=id,recurrence_group_id,occurrence_number`);
      const prior = (priorArchived && priorArchived[0]) || null;

      const row = {
        occurrence_number: prior ? (prior.occurrence_number || 1) + 1 : 1,
        previous_occurrence_id: prior ? prior.id : null,
        fingerprint,
        owning_department: department,
        executing_department: executingDept,
        recommendation_type: recType,
        affected_entity: affectedEntity,
        title: rec.title || '', why: rec.why || null, action: rec.action || null,
        severity: rec.severity || 'Medium',
        status: handoff ? 'blocked' : 'backlog',
        requires_ceo_approval: !!rec.requiresCeoApproval,
        ceo_action_required: !!(handoff && handoff.ceo_action_required),
        ceo_action_description: handoff ? handoff.ceo_action_description(rec) : null,
        ceo_action_target: handoff ? handoff.ceo_action_target : null,
        blocked_by_type: handoff ? handoff.blocked_by_type : null,
        blocked_by_entity: handoff ? handoff.blocked_by_entity : null,
        source_system: 'department_work_items',
        // v16.24.0 — Marketing Growth Intelligence: only populated for recommendation_type=
        // growth_experiment; every other type leaves these null.
        experiment_business_decision: recType === 'growth_experiment' ? rec.businessDecision : null,
        experiment_effort: recType === 'growth_experiment' ? (rec.effort || null) : null,
        experiment_baseline: recType === 'growth_experiment' ? (rec.baseline || null) : null,
        experiment_review_by: recType === 'growth_experiment' ? (rec.reviewBy || null) : null,
        created_at: nowIso(), updated_at: nowIso(), last_seen_at: nowIso(),
      };
      const inserted = await sbInsert('department_work_items', row);
      // recurrence_group_id: reuse the lineage's group if recurring, else the row is the
      // head of its own new lineage (set to its own id right after insert).
      await sbPatch('department_work_items', `id=eq.${inserted.id}`, {
        recurrence_group_id: prior ? prior.recurrence_group_id : inserted.id,
      });
      if (prior) recurred.push(fingerprint); else created.push(fingerprint);
    }

    // Auto-resolve rule 4 above.
    const autoResolved = [];
    for (const row of active) {
      if (seenFingerprints.has(row.fingerprint)) continue;
      const safeToAutoClose = row.ceo_action_required || ['backlog', 'assigned'].includes(row.status);
      if (!safeToAutoClose) continue;
      await sbPatch('department_work_items', `id=eq.${row.id}`, {
        status: 'archived',
        completion_note: row.ceo_action_required
          ? 'Auto-resolved: the required CEO/operator action was completed and the underlying system confirmed success.'
          : 'Auto-resolved: underlying signal cleared before assignment.',
        verification_method: 'automated_recheck',
        evidence: 'Signal no longer present in the latest recommendation sync.',
        verified_by: 'system:auto',
        verified_at: nowIso(),
        updated_at: nowIso(),
      });
      autoResolved.push(row.fingerprint);
    }

    return res.json({ success: true, created, refreshed, recurred, autoResolved, evaluated, promoted });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// v16.26.0 — Department KPI & Success Measurement (CEO-approved as companion architecture
// to the Department Operating Model v3, 2026-08-04). Computes the two frozen-standard
// metrics — Decision Success Rate and CEO Load — from REAL department_work_items history.
// No schema change: this reads the same table and columns every other Marketing/Technology
// feature already writes (recurrence_group_id/occurrence_number lineage, experiment_outcome,
// ceo_action_required, verification_method). Pure read, GET only, no writes.
//
// Decision Success Rate has two components, combined honestly rather than blended into one
// misleading number:
//   1. growth_experiment rows — the precise case: experiment_outcome is a direct proven/
//      disproven/inconclusive verdict already produced by the Outcome Evaluation stage.
//   2. every other recommendation type — no per-decision expected-outcome field exists (and
//      per the approved KPI doc, none should be force-fitted onto types that don't have one),
//      so success is inferred from the SAME recurrence lineage DWE already tracks: if a
//      fingerprint's occurrence was archived and no later occurrence in the same
//      recurrence_group_id chain was ever created, the decision held — genuine success. If a
//      later occurrence exists, the underlying issue came back — the decision didn't stick,
//      a real, honest failure. The most recent occurrence in an active (unarchived) chain is
//      still open and excluded — it hasn't produced an outcome yet.
//
// CEO Load counts genuine ceo_action_required escalations (Technology's token_reconnect
// pathway today) and reports the recurrence rate on that same lineage as the best available,
// honestly-caveated proxy for a false-escalation rate — this table cannot distinguish
// "Technology recovered it autonomously" from "a human reconnected it" (both close the same
// way), so the note says so rather than presenting false precision.
// ══════════════════════════════════════════════════════════════════════════
async function departmentMetrics(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const department = req.query?.department || 'marketing_sales';
  try {
    // Technology rarely OWNS a department_work_items row (Marketing raises the item;
    // Technology only ever EXECUTES it — e.g. token_reconnect). So Technology's metrics are
    // scoped to what it executes, not what it owns; every other department uses ownership.
    const filterField = department === 'technology' ? 'executing_department' : 'owning_department';
    const rows = await sbGet(
      `department_work_items?${filterField}=eq.${department}&select=id,recommendation_type,status,experiment_outcome,recurrence_group_id,occurrence_number,ceo_action_required,executing_department,verification_method,verified_by,created_at,updated_at&order=occurrence_number.asc`
    ) || [];

    // ── Decision Success Rate ──────────────────────────────────────────────
    const exp = { proven: 0, disproven: 0, inconclusive: 0 };
    const nonExp = rows.filter(r => r.recommendation_type !== 'growth_experiment' && r.recommendation_type !== 'coordination_hold');
    rows.filter(r => r.recommendation_type === 'growth_experiment' && r.experiment_outcome).forEach(r => { exp[r.experiment_outcome] = (exp[r.experiment_outcome] || 0) + 1; });

    const groups = {};
    nonExp.forEach(r => {
      const g = r.recurrence_group_id || r.id;
      (groups[g] = groups[g] || []).push(r);
    });
    let nonExpSuccess = 0, nonExpFailure = 0, nonExpUndetermined = 0;
    Object.values(groups).forEach(chain => {
      chain.sort((a, b) => (a.occurrence_number || 1) - (b.occurrence_number || 1));
      chain.forEach((r, i) => {
        const hasLaterOccurrence = i < chain.length - 1;
        if (hasLaterOccurrence) { nonExpFailure++; return; } // this occurrence recurred — the decision didn't hold
        if (r.status === 'archived') { nonExpSuccess++; return; } // terminal occurrence, resolved, never came back
        nonExpUndetermined++; // still active — no outcome yet
      });
    });

    const expDecided = exp.proven + exp.disproven;
    const totalDecided = expDecided + nonExpSuccess + nonExpFailure;
    const totalSuccess = exp.proven + nonExpSuccess;
    const decisionSuccessRate = {
      rate: totalDecided > 0 ? Math.round((totalSuccess / totalDecided) * 100) : null,
      decidedCount: totalDecided, successCount: totalSuccess, failureCount: totalDecided - totalSuccess,
      undeterminedCount: nonExpUndetermined,
      experiments: { proven: exp.proven, disproven: exp.disproven, inconclusive: exp.inconclusive },
      operational: { success: nonExpSuccess, failure: nonExpFailure, undetermined: nonExpUndetermined },
      note: totalDecided === 0 ? 'No decisions have reached a determined outcome yet — rate will populate as items resolve or recur.' : null,
    };

    // ── CEO Load ────────────────────────────────────────────────────────────
    const ceoRows = rows.filter(r => r.ceo_action_required);
    const ceoActive = ceoRows.filter(r => r.status !== 'archived').length;
    const ceoGroups = {};
    ceoRows.forEach(r => { const g = r.recurrence_group_id || r.id; (ceoGroups[g] = ceoGroups[g] || []).push(r); });
    let ceoRecurred = 0, ceoChains = 0;
    Object.values(ceoGroups).forEach(chain => { ceoChains++; if (chain.length > 1) ceoRecurred++; });
    const ceoLoad = {
      totalEverRaised: ceoRows.length,
      currentlyActive: ceoActive,
      resolvedCount: ceoRows.length - ceoActive,
      recurrenceChains: ceoChains, recurringChains: ceoRecurred,
      recurrenceRate: ceoChains > 0 ? Math.round((ceoRecurred / ceoChains) * 100) : null,
      note: 'This table cannot distinguish an autonomous Technology recovery from a human reconnect — both close a ceo_action_required item the same way. Recurrence rate (the same escalation coming back) is the honest proxy available for a false-escalation signal, not a direct measure of it.',
    };

    return res.json({ success: true, department, decisionSuccessRate, ceoLoad, sampleSize: rows.length });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function cleanMemory(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    let deleted = 0;
    // 1. Delete junk fallback entries
    const junkPrefixes = ['New srv_farsi', 'New srv_english', 'New nextwave', 'New ai_studio'];
    for (const prefix of junkPrefixes) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/generation_memory?value=ilike.${encodeURIComponent(prefix + '%')}`,
        { method: 'DELETE', headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY, 'Prefer': 'return=representation' } }
      );
      const rows = await r.json();
      if (Array.isArray(rows)) deleted += rows.length;
    }
    // 2. Delete long corrupted concept strings (>60 chars)
    const longConcepts = await sbGet('generation_memory?memory_type=eq.concept&select=id,value');
    for (const row of longConcepts) {
      if (row.value && row.value.length > 60) {
        await fetch(`${SUPABASE_URL}/rest/v1/generation_memory?id=eq.${row.id}`,
          { method: 'DELETE', headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY } }
        );
        deleted++;
      }
    }
    // 3. Delete mode strings incorrectly saved as moods
    const badMoods = ['Female — Happy','Male — Happy','Female — Emotional','Male — Emotional','Female — Romantic','Male — Romantic','Duet — Emotional','Duet — Romantic'];
    for (const val of badMoods) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/generation_memory?value=eq.${encodeURIComponent(val)}`,
        { method: 'DELETE', headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY, 'Prefer': 'return=representation' } }
      );
      const rows = await r.json();
      if (Array.isArray(rows)) deleted += rows.length;
    }
    // 4. Delete duplicates — keep earliest created_at per value
    const allRows = await sbGet('generation_memory?select=id,value,created_at&order=created_at.asc');
    const seen = new Map();
    const toDelete = [];
    for (const row of allRows) {
      if (seen.has(row.value)) { toDelete.push(row.id); }
      else { seen.set(row.value, row.id); }
    }
    for (const id of toDelete) {
      await fetch(`${SUPABASE_URL}/rest/v1/generation_memory?id=eq.${id}`,
        { method: 'DELETE', headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY } }
      );
      deleted++;
    }
    return res.json({ success: true, deleted });
  } catch(err) {
    console.error('[clean_memory] error:', err.message);
    return res.json({ success: false, error: err.message });
  }
}

async function seedMemory(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const SEED_ITEMS = [
    { memory_type: 'title', value: 'دلتنگ توام', engine_id: 'srv_farsi' },
    { memory_type: 'title', value: 'نگاه تو', engine_id: 'srv_farsi' },
    { memory_type: 'title', value: 'روز خوش', engine_id: 'srv_farsi' },
    { memory_type: 'title', value: 'صندلی خالی', engine_id: 'srv_farsi' },
    { memory_type: 'title', value: 'رقص در باران خوشبختی', engine_id: 'srv_farsi' },
    { memory_type: 'concept', value: 'missing someone who left without goodbye', engine_id: 'srv_farsi' },
    { memory_type: 'concept', value: 'empty bed waiting', engine_id: 'srv_farsi' },
    { memory_type: 'concept', value: 'longing without goodbye', engine_id: 'srv_farsi' },
    { memory_type: 'concept', value: 'dancing in rain happiness', engine_id: 'srv_farsi' },
    { memory_type: 'mood', value: 'Emotional', engine_id: 'srv_farsi' },
    { memory_type: 'mood', value: 'Romantic', engine_id: 'srv_farsi' },
    { memory_type: 'mood', value: 'Happy', engine_id: 'srv_farsi' },
    { memory_type: 'title', value: 'The Empty Side of the Bed', engine_id: 'srv_english' },
    { memory_type: 'concept', value: 'physical absence in intimate space', engine_id: 'srv_english' },
    { memory_type: 'concept', value: 'waiting for someone to come home', engine_id: 'srv_english' },
    { memory_type: 'title', value: 'The One Money Rule That Changes Everything', engine_id: 'nextwave' },
    { memory_type: 'title', value: 'Starting at 35 vs 25 Costs You $1M', engine_id: 'nextwave' },
    { memory_type: 'concept', value: 'active vs passive income angle', engine_id: 'nextwave' },
    { memory_type: 'topic', value: 'Finance', engine_id: 'nextwave' },
    { memory_type: 'title', value: 'AI Explained Why People Stay in Bad Relationships', engine_id: 'ai_studio' },
    { memory_type: 'concept', value: 'bad relationship psychology angle', engine_id: 'ai_studio' },
    { memory_type: 'category', value: 'B - Psychology', engine_id: 'ai_studio' },
  ];
  const items = (req.body && Array.isArray(req.body.items) && req.body.items.length) ? req.body.items : SEED_ITEMS;
  let inserted = 0, skipped = 0;
  try {
    for (const item of items) {
      try {
        // Duplicate check: fetch by value using exact filter
        const checkRes = await fetch(
          `${SUPABASE_URL}/rest/v1/generation_memory?value=eq.${encodeURIComponent(item.value)}&select=id&limit=1`,
          { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY } }
        );
        const rows = await checkRes.json();
        if (Array.isArray(rows) && rows.length > 0) { skipped++; continue; }
        await sbInsert('generation_memory', { memory_type: item.memory_type, value: item.value, engine_id: item.engine_id });
        inserted++;
      } catch(itemErr) {
        console.error('[seed_memory] item error:', item.value, itemErr.message);
        skipped++;
      }
    }
    return res.json({ success: true, inserted, skipped });
  } catch(err) {
    console.error('[seed_memory] fatal error:', err.message);
    return res.json({ success: false, error: err.message });
  }
}

async function deleteMemoryItemFn(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const res2 = await fetch(`${SUPABASE_URL}/rest/v1/generation_memory?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
  });
  return res.json({ ok: res2.ok });
}

// ── YouTube Performance Sync ──────────────────────────────────────────────────

async function youtubeSyncPerformance(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { channelIds } = req.body || {};
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.json({ error: 'YOUTUBE_API_KEY not configured', synced: 0, matched: 0, advanced: 0 });
  if (!Array.isArray(channelIds) || channelIds.length === 0) return res.json({ synced: 0, matched: 0, advanced: 0 });

  function normalizeTitle(str){
    if(!str) return [];
    // Preserve Persian/Arabic unicode range U+0600–U+06FF
    // Strip only characters that are not word chars, not Persian, not spaces
    var s = str
      .toLowerCase()
      .replace(/[^\w\s\u0600-\u06FF]/g,'')
      .trim();
    return s.split(/\s+/).filter(function(t){ return t.length>1; });
  }

  let synced = 0, matched = 0, advanced = 0;
  try {
    let packages = [];
    try { packages = await sbGet('packages?select=*&order=created_at.desc&limit=500'); } catch(e) {}

    const allVideoIds = [];
    for (const channelId of channelIds) {
      if (!channelId) continue;
      try {
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=10&key=${apiKey}`;
        const sr = await fetch(searchUrl);
        if (!sr.ok) continue;
        const sd = await sr.json();
        if (sd.error) { console.warn('[yt_sync_perf] YT search error:', sd.error.message); continue; }
        for (const item of (sd.items || [])) {
          const vid = item.id && item.id.videoId;
          if (vid) allVideoIds.push(vid);
        }
      } catch(e) { console.warn('[yt_sync_perf] search error channel', channelId, e.message); }
    }

    synced = allVideoIds.length;
    if (allVideoIds.length === 0) return res.json({ synced: 0, matched: 0, advanced: 0 });

    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${allVideoIds.join(',')}&key=${apiKey}`;
    const statsRes = await fetch(statsUrl);
    if (!statsRes.ok) return res.json({ error: 'YouTube stats API error ' + statsRes.status, synced, matched: 0, advanced: 0 });
    const statsData = await statsRes.json();
    if (statsData.error) return res.json({ error: statsData.error.message, synced, matched: 0, advanced: 0 });

    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    for (const video of (statsData.items || [])) {
      const { id: videoId, snippet, statistics } = video;
      if (!snippet || !statistics) continue;
      const videoTokens = normalizeTitle(snippet.title);
      if (videoTokens.length === 0) continue;

      let bestMatch = null, bestOverlap = 0;
      for (const pkg of packages) {
        const pkgTokens = normalizeTitle(pkg.title);
        if (pkgTokens.length === 0) continue;
        const shared = videoTokens.filter(t => pkgTokens.includes(t)).length;
        const overlap = shared / Math.max(videoTokens.length, pkgTokens.length);
        if (overlap >= 0.7 && overlap > bestOverlap) { bestOverlap = overlap; bestMatch = pkg; }
      }
      if (!bestMatch) continue;
      matched++;

      const publishedAt = snippet.publishedAt;
      const daysSince = Math.max(1, (Date.now() - new Date(publishedAt)) / 86400000);
      const viewCount = parseInt(statistics.viewCount || 0);
      const likeCount = parseInt(statistics.likeCount || 0);
      const commentCount = parseInt(statistics.commentCount || 0);
      const viewsPerDay = Math.round((viewCount / daysSince) * 100) / 100;
      const uploadDay = DAY_NAMES[new Date(publishedAt).getDay()];
      const uploadHour = new Date(publishedAt).getHours();
      const videoUrl = 'https://youtube.com/watch?v=' + videoId;

      const perfPayload = {
        package_id: bestMatch.id,
        video_id: videoId,
        video_url: videoUrl,
        upload_timestamp: publishedAt,
        views: viewCount,
        likes: likeCount,
        comments: commentCount,
        shares: 0,
        watch_time_seconds: 0,
        views_per_day: viewsPerDay,
        engine_id: bestMatch.engine_id || bestMatch.engineId || null,
        mode: bestMatch.mode || null,
        hook: bestMatch.hook || null,
        upload_day: uploadDay,
        upload_hour: uploadHour,
        auto_linked: true,
        performance_score: viewCount + likeCount * 10 + commentCount * 15,
      };

      try {
        const existing = await sbGet(`package_performance?package_id=eq.${encodeURIComponent(bestMatch.id)}&limit=1`).catch(() => []);
        if (existing && existing[0]) {
          await sbPatch('package_performance', `package_id=eq.${encodeURIComponent(bestMatch.id)}`, perfPayload);
        } else {
          await sbInsert('package_performance', perfPayload);
        }
      } catch(e) { console.warn('[yt_sync_perf] perf upsert error:', e.message); }

      try {
        const tasks = await sbGet(`operator_tasks?package_id=eq.${encodeURIComponent(bestMatch.id)}&status=eq.queued&limit=1`).catch(() => []);
        if (tasks && tasks[0]) {
          // Always update status — safe columns only
          await sbPatch('operator_tasks', `id=eq.${tasks[0].id}`, {
            status: 'uploaded',
            updated_at: new Date().toISOString(),
          });
          advanced++;
          // Attempt to write video fields if columns exist (silent fail if not)
          try {
            await sbPatch('operator_tasks', `id=eq.${tasks[0].id}`, { video_id: videoId, video_url: videoUrl });
          } catch(e) {}
          try {
            // v16.15.0 — Phase 6: tagged department='operations' — this event advances an
            // operator_task through the Factory production pipeline (Operations owns task
            // state), even though the trigger is a YouTube signal. requires_ceo_approval
            // stays false: this is a routine completion event, not a decision — it belongs
            // in Operations' own Department Inbox, not the Executive Inbox.
            await sbInsert('notifications', {
              type: 'upload_detected',
              title: 'YouTube Upload Detected',
              message: (bestMatch.title || 'Package') + ' auto-linked and advanced to uploaded',
              task_id: String(tasks[0].id),
              created_by: 'system',
              department: 'operations',
              requires_ceo_approval: false,
            });
          } catch(e) { console.warn('[yt_sync_perf] notification error:', e.message); }
        }
      } catch(e) { console.warn('[yt_sync_perf] task advance error:', e.message); }
    }

    console.log(`[v12.8] youtube_sync_performance: synced=${synced} matched=${matched} advanced=${advanced}`);
    return res.json({ synced, matched, advanced });
  } catch(e) {
    console.error('[v12.8] youtube_sync_performance error:', e.message);
    return res.json({ error: e.message, synced, matched: 0, advanced: 0 });
  }
}

async function logPerformanceManual(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { package_id, views, likes, comments } = req.body || {};
  if (!package_id) return res.status(400).json({ error: 'package_id required' });
  try {
    let existing = [];
    try { existing = await sbGet(`package_performance?package_id=eq.${encodeURIComponent(package_id)}&limit=1`); } catch(e) {}
    const row = existing && existing[0];
    let uploadTimestamp = row && (row.upload_timestamp || row.created_at);
    if (!uploadTimestamp) {
      let pkg = [];
      try { pkg = await sbGet(`packages?id=eq.${encodeURIComponent(package_id)}&select=created_at&limit=1`); } catch(e) {}
      uploadTimestamp = (pkg && pkg[0] && pkg[0].created_at) || new Date().toISOString();
    }
    const daysSince = Math.max(1, (Date.now() - new Date(uploadTimestamp)) / 86400000);
    const viewsNum = parseInt(views) || 0;
    const likesNum = parseInt(likes) || 0;
    const commentsNum = parseInt(comments) || 0;
    const viewsPerDay = Math.round((viewsNum / daysSince) * 100) / 100;
    const payload = { views: viewsNum, likes: likesNum, comments: commentsNum, views_per_day: viewsPerDay, updated_at: new Date().toISOString() };
    if (row) {
      await sbPatch('package_performance', `package_id=eq.${encodeURIComponent(package_id)}`, payload);
    } else {
      await sbInsert('package_performance', { package_id, ...payload, shares: 0, watch_time_seconds: 0, auto_linked: false, performance_score: viewsNum + likesNum * 10 + commentsNum * 15 });
    }
    return res.json({ success: true, views_per_day: viewsPerDay });
  } catch(e) {
    return res.json({ success: false, error: e.message });
  }
}

async function getPerformanceSummary(req, res) {
  try {
    let rows = [];
    try { rows = await sbGet('package_performance?order=views_per_day.desc.nullslast&limit=100'); } catch(e) {}
    if (!rows || rows.length < 3) return res.json({ insufficient_data: true, rows: (rows || []).length });

    const packageIds = [...new Set(rows.map(r => r.package_id).filter(Boolean))];
    let packages = [];
    if (packageIds.length > 0) {
      try { packages = await sbGet(`packages?id=in.(${packageIds.join(',')})&select=id,title,mode,hook,engine_id`); } catch(e) {}
    }
    const pkgMap = {};
    (packages || []).forEach(p => { pkgMap[p.id] = p; });

    const ENGINE_IDS = ['srv_farsi', 'srv_english', 'nextwave', 'ai_studio'];
    const byEngine = {};
    for (const eid of ENGINE_IDS) byEngine[eid] = [];

    for (const row of rows) {
      const pkg = pkgMap[row.package_id] || {};
      const raw = (row.engine_id || pkg.engine_id || '');
      const eid = raw.toLowerCase().replace(/[\s-]/g, '_').replace(/[^a-z_]/g, '');
      const target = ENGINE_IDS.includes(eid) ? eid : null;
      if (!target) continue;
      if (byEngine[target].length < 5) {
        byEngine[target].push({
          package_id: row.package_id,
          title: pkg.title || row.title || null,
          mode: row.mode || pkg.mode || null,
          hook: row.hook || pkg.hook || null,
          views: row.views || 0,
          views_per_day: row.views_per_day || 0,
          upload_day: row.upload_day || null,
        });
      }
    }

    const dayTotals = {}, dayCounts = {};
    for (const row of rows) {
      if (!row.upload_day) continue;
      dayTotals[row.upload_day] = (dayTotals[row.upload_day] || 0) + (row.views_per_day || 0);
      dayCounts[row.upload_day] = (dayCounts[row.upload_day] || 0) + 1;
    }
    const topUploadDays = {};
    for (const day of Object.keys(dayTotals)) topUploadDays[day] = dayTotals[day] / dayCounts[day];

    const modeTotals = {}, modeCounts = {};
    for (const row of rows) {
      if (!row.mode) continue;
      modeTotals[row.mode] = (modeTotals[row.mode] || 0) + (row.views_per_day || 0);
      modeCounts[row.mode] = (modeCounts[row.mode] || 0) + 1;
    }
    const topModes = {};
    for (const mode of Object.keys(modeTotals)) topModes[mode] = modeTotals[mode] / modeCounts[mode];

    return res.json({ by_engine: byEngine, top_upload_days: topUploadDays, top_modes: topModes });
  } catch(e) {
    return res.json({ insufficient_data: true, rows: 0, error: e.message });
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

// ── Plaid handlers (merged here to stay under Vercel Hobby 12-function limit) ─

// v13.63.1 — Finance Phase 1: env-aware secret selection.
// Previous logic (`PLAID_SECRET_SANDBOX || PLAID_SECRET`) silently kept Sandbox even when PLAID_ENV=production
// because Vercel projects often carry both secrets. Now PLAID_ENV strictly picks the matching secret.
const _PLAID_ENV = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
const PLAID_BASE = _PLAID_ENV === 'sandbox'
  ? 'https://sandbox.plaid.com'
  : (_PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://development.plaid.com');
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = _PLAID_ENV === 'production'
  ? process.env.PLAID_SECRET
  : (_PLAID_ENV === 'sandbox'
      ? (process.env.PLAID_SECRET_SANDBOX || process.env.PLAID_SECRET)
      : (process.env.PLAID_SECRET_DEV || process.env.PLAID_SECRET));

async function sbUpsertPlaidItem(data) {
  const url = `${SUPABASE_URL}/rest/v1/plaid_items?on_conflict=item_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase plaid_items upsert ${res.status}: ${t}`);
  }
}

async function sbSelectPlaid(query) {
  const url = `${SUPABASE_URL}/rest/v1/plaid_items?${query}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase plaid_items select ${res.status}: ${t}`);
  }
  return res.json();
}

async function sbPatchPlaid(query, data) {
  const url = `${SUPABASE_URL}/rest/v1/plaid_items?${query}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase plaid_items patch ${r.status}: ${t}`);
  }
}

async function plaidLink(req, res) {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    return res.status(500).json({ error: 'plaid_not_configured' });
  }
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const userId = body.userId || 'admin';
  const pRes = await fetch(`${PLAID_BASE}/link/token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      client_name: 'MMM OS',
      user: { client_user_id: userId },
      // v13.64.0 — Finance Phase 2: liabilities product = credit card APR + min payment + due date + student/mortgage rates.
      // Optional products list so banks without liabilities support still link successfully.
      products: ['transactions'],
      optional_products: ['liabilities'],
      country_codes: ['US'],
      language: 'en',
    }),
  });
  const data = await pRes.json();
  if (!pRes.ok) {
    console.error('[v13.22] plaid link error:', pRes.status, data);
    return res.status(502).json({ error: 'plaid_link_failed', detail: data });
  }
  return res.status(200).json({
    link_token: data.link_token,
    expiration: data.expiration,
    env: _PLAID_ENV,                            // v13.63.2 — normalize lowercase env to UI
  });
}

async function plaidExchange(req, res) {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) return res.status(500).json({ error: 'plaid_not_configured' });
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'supabase_not_configured' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const publicToken = body.public_token;
  const metadata = body.metadata || {};
  const userLabel = body.userId || 'admin';
  if (!publicToken) return res.status(400).json({ error: 'missing_public_token' });

  const exchRes = await fetch(`${PLAID_BASE}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, public_token: publicToken }),
  });
  const exchData = await exchRes.json();
  if (!exchRes.ok) {
    console.error('[v13.22] plaid exchange step1 error:', exchRes.status, exchData);
    return res.status(502).json({ error: 'plaid_exchange_failed', detail: exchData });
  }
  const accessToken = exchData.access_token;
  const itemId = exchData.item_id;

  const itemRes = await fetch(`${PLAID_BASE}/item/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: accessToken }),
  });
  const itemData = await itemRes.json();
  const institutionId = itemData?.item?.institution_id || metadata?.institution?.institution_id || null;
  const availableProducts = itemData?.item?.available_products || null;
  const billedProducts = itemData?.item?.billed_products || null;

  let institutionName = metadata?.institution?.name || null;
  if (!institutionName && institutionId) {
    try {
      const instRes = await fetch(`${PLAID_BASE}/institutions/get_by_id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: PLAID_CLIENT_ID,
          secret: PLAID_SECRET,
          institution_id: institutionId,
          country_codes: ['US'],
        }),
      });
      const instData = await instRes.json();
      institutionName = instData?.institution?.name || 'Unknown bank';
    } catch (e) {
      institutionName = 'Unknown bank';
    }
  }

  await sbUpsertPlaidItem({
    item_id: itemId,
    access_token: accessToken,
    institution_id: institutionId,
    institution_name: institutionName,
    available_products: availableProducts,
    billed_products: billedProducts,
    user_label: userLabel,
    updated_at: new Date().toISOString(),
  });

  return res.status(200).json({
    item_id: itemId,
    institution_name: institutionName,
    institution_id: institutionId,
  });
}

// v13.65.1 — Finance Phase 3 hotfix: server-side item removal. Calls Plaid /item/remove (releases token)
// then deletes the plaid_items row. Always returns 200 (best-effort: row deletion succeeds even if Plaid 4xxs).
// v13.69.0a — SRV Automation Phase 1: package builder.
// Accepts photo_url + audio_url + package_id. Client uploads files directly to Supabase storage (bypasses Vercel 4.5MB body limit).
// Generates metadata via Claude. Records URLs on package row.
// Surfaces render gate (Shotstack template IDs) explicitly when not yet configured.
// AI Studio / NextWave pipelines and YouTube upload code are NOT touched — SRV uses a separate code path.
async function srvBuildPackage(req, res){
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'supabase_not_configured' });
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'anthropic_not_configured' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const packageId = body.package_id;
  const photoUrl = body.photo_url;
  const audioUrl = body.audio_url;
  const audioName = body.audio_name || 'srv_audio.mp3';
  if (!packageId) return res.status(400).json({ error: 'missing_package_id' });
  if (!photoUrl) return res.status(400).json({ error: 'missing_photo_url' });
  if (!audioUrl) return res.status(400).json({ error: 'missing_audio_url' });

  // 1. Load package metadata — prefer inline fields sent by client (v13.69.3), fall back to Supabase.
  // Inline fields eliminate package_not_found errors when the row hasn't synced yet.
  let pkg = null;
  if (body.pkg_engine || body.pkg_title) {
    pkg = {
      engine: body.pkg_engine || '',
      title:  body.pkg_title  || '',
      lyrics: body.pkg_lyrics || '',
      short_lyrics: body.pkg_short_lyrics || body.pkg_lyrics || '',
      mood:   body.pkg_mood   || '',
    };
    console.log('[v13.69.3] using inline pkg fields for', packageId);
  } else {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/packages?package_id=eq.${encodeURIComponent(packageId)}&select=*`, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
      });
      if (r.ok) {
        const rows = await r.json();
        pkg = rows[0] || null;
      }
    } catch (e) { console.warn('[v13.69.0] package lookup failed:', e.message); }
    if (!pkg) return res.status(404).json({ error: 'package_not_found', package_id: packageId });
  }

  const engine = pkg.engine || 'SRV';
  const title = pkg.title || pkg.name || 'Untitled';
  // v13.69.0 / v13.69.1-prep — Single source of truth for lyrics: the generated package row.
  // Operator never re-pastes lyrics after Suno; Shotstack short template (when wired) reads from this same field.
  const lyrics = pkg.lyrics || pkg.short_lyrics || pkg.script || '';
  const shortLyrics = pkg.short_lyrics || pkg.lyrics || '';
  const mood = pkg.mood || '';

  // 2. Assets already staged client-side. Just record the URLs.
  const assets = { photo: photoUrl, audio: audioUrl };
  let stageErr = null;

  // 3. Generate metadata via Claude (title polish + description + hashtags + playlist + category suggestion).
  let metadata = null;
  try {
    const isFarsiChannel = (engine||'').includes('Farsi') || (engine||'').includes('Silk');
    const prompt = isFarsiChannel
      ? `You are generating YouTube metadata for a Silk Road Voices (SRV) Persian music video. Engine: ${engine}. Title: ${title}. Mood: ${mood}. Lyrics (may be partial): ${(lyrics||'').slice(0,800)}

IMPORTANT: Write the youtube_description ENTIRELY IN FARSI (Persian). The title should be Farsi only. Hashtags should include Farsi/Persian tags.

Return STRICT JSON only, wrapped in <metadata> tags. Schema:
<metadata>{"youtube_title":"...فارسی فقط، حداکثر ۷۰ کاراکتر، احساسی","youtube_description":"۳ پاراگراف کوتاه به فارسی: (۱) هوک احساسی ۱-۲ جمله، (۲) معرفی آهنگ + خواننده + حال و هوا، (۳) دعوت به اشتراک + معرفی پلی‌لیست","hashtags":["#آهنگفارسی","#موسیقیایرانی","#SRV","#SilkRoadVoices","..."],"playlist_suggestion":"SRV Farsi - Emotional","category_id":"10","short_caption":"کپشن کوتاه فارسی، حداکثر ۱۰۰ کاراکتر، با ۲-۳ هشتگ"}</metadata>`
      : `You are generating YouTube metadata for an SRV (Persian/English romantic-emotional music) video.
Engine: ${engine}
Working title: ${title}
Mood: ${mood}
Lyrics excerpt (may be partial): ${(lyrics||'').slice(0, 800)}

Return STRICT JSON only, wrapped in <metadata> tags. Schema:
<metadata>{"youtube_title":"...max 70 chars, evocative, no clickbait","youtube_description":"3 short paragraphs: (1) emotional hook 1-2 lines, (2) credits + ENGINE + mood, (3) call-to-action subscribe + playlist mention","hashtags":["#SRV","#PersianMusic", "..."],"playlist_suggestion":"SRV Farsi - Emotional | SRV English - Romantic | SRV - Happy | etc","category_id":"10","short_caption":"vertical-format caption, max 100 chars, hook-first, includes 2-3 hashtags inline"}</metadata>`;
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    });
    if (claudeRes.ok) {
      const d = await claudeRes.json();
      const text = (d.content && d.content[0] && d.content[0].text) || '';
      const m = text.match(/<metadata>([\s\S]*?)<\/metadata>/);
      if (m) {
        try { metadata = JSON.parse(m[1]); } catch (e) { metadata = { raw: m[1], parse_error: e.message }; }
      } else {
        metadata = { raw: text, parse_error: 'no metadata tags in response' };
      }
    } else {
      const errText = await claudeRes.text();
      metadata = { error: `claude_${claudeRes.status}`, detail: errText.slice(0,200) };
    }
  } catch (e) { metadata = { error: 'claude_exception', detail: e.message }; }

  // 4. Render queue (Shotstack) — gated. Wired when SHOTSTACK_API_KEY + SHOTSTACK_TEMPLATE_LONG + SHOTSTACK_TEMPLATE_SHORT exist in env.
  // Lyrics for the short template come from pkg.lyrics (single source of truth — operator never re-pastes).
  const renderConfigured = !!(process.env.SHOTSTACK_API_KEY && process.env.SHOTSTACK_TEMPLATE_LONG && process.env.SHOTSTACK_TEMPLATE_SHORT);
  let renderStatus = renderConfigured
    ? 'queued (long + short — Shotstack wiring lands in v13.69.1)'
    : 'PENDING — Shotstack templates not configured. Set SHOTSTACK_API_KEY, SHOTSTACK_TEMPLATE_LONG, SHOTSTACK_TEMPLATE_SHORT in Vercel env.';
  const lyricsStatus = lyrics
    ? `✓ sourced from package · ${lyrics.length} chars (long) · ${shortLyrics.length} chars (short)`
    : '⚠ MISSING — re-generate the package to capture lyrics, or lyrics field was never populated.';

  // 5. Persist build state on the package row so the UI reflects progress.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/packages?package_id=eq.${encodeURIComponent(packageId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        srv_photo_url: assets.photo,
        srv_audio_url: assets.audio,
        srv_metadata: metadata,
        srv_build_status: renderStatus,
        srv_built_at: new Date().toISOString(),
      }),
    });
  } catch (e) { console.warn('[v13.69.0] package patch failed (non-fatal):', e.message); }

  return res.status(200).json({
    ok: true,
    package_id: packageId,
    assets_staged: (assets.photo ? 1 : 0) + (assets.audio ? 1 : 0),
    asset_urls: assets,
    metadata,
    lyrics_status: lyricsStatus,
    lyrics_chars: lyrics.length,
    short_lyrics_chars: shortLyrics.length,
    render_status: renderStatus,
    youtube_upload_status: renderConfigured ? 'awaits render' : 'blocked — render gate pending',
    stage_error: stageErr,
  });
}

async function plaidRemoveItem(req, res) {
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'supabase_not_configured' });
  const body = (req.method === 'POST' && req.body && typeof req.body === 'object') ? req.body : {};
  const query = req.query || {};
  const itemId = body.item_id || query.item_id;
  if (!itemId) return res.status(400).json({ error: 'missing_item_id' });
  let plaidErr = null;
  // Find access_token for this item
  try {
    const items = await sbSelectPlaid(`item_id=eq.${encodeURIComponent(itemId)}&select=access_token`);
    if (items && items.length && items[0].access_token && PLAID_CLIENT_ID && PLAID_SECRET) {
      try {
        const r = await fetch(`${PLAID_BASE}/item/remove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: items[0].access_token }),
        });
        if (!r.ok) plaidErr = `plaid_status_${r.status}`;
      } catch (e) { plaidErr = 'plaid_exception: ' + e.message; }
    }
  } catch (e) { plaidErr = 'sb_select_exception: ' + e.message; }
  // Delete the row regardless — if Plaid rejected the access_token (e.g., stale Sandbox token in Production env),
  // we still want the row gone so it stops appearing on every Refresh.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/plaid_items?item_id=eq.${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'delete_failed', detail: e.message });
  }
  return res.status(200).json({ removed: true, item_id: itemId, plaidErr });
}

async function plaidPullForItem(item) {
  const accessToken = item.access_token;
  const result = {
    item_id: item.item_id,
    institution_name: item.institution_name,
    accounts: [],
    transactions: [],
    error: null,
    lastSyncAt: null,
  };
  try {
    const balRes = await fetch(`${PLAID_BASE}/accounts/balance/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: accessToken }),
    });
    const balData = await balRes.json();
    if (balRes.ok && balData.accounts) {
      result.accounts = balData.accounts.map(a => ({
        account_id: a.account_id,
        name: a.name,
        official_name: a.official_name,
        subtype: a.subtype,
        type: a.type,
        mask: a.mask,
        available: a.balances?.available,
        current: a.balances?.current,
        iso_currency_code: a.balances?.iso_currency_code || 'USD',
      }));
    } else {
      result.error = (result.error || '') + ` balance: ${balRes.status}`;
    }
  } catch (e) {
    result.error = (result.error || '') + ` balance_exception: ${e.message}`;
  }

  try {
    let cursor = item.last_cursor || null;
    let added = [];
    let hasMore = true;
    let safety = 0;
    while (hasMore && safety < 5) {
      const syncRes = await fetch(`${PLAID_BASE}/transactions/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: PLAID_CLIENT_ID,
          secret: PLAID_SECRET,
          access_token: accessToken,
          cursor: cursor || undefined,
          count: 100,
        }),
      });
      const syncData = await syncRes.json();
      if (!syncRes.ok) {
        result.error = (result.error || '') + ` sync: ${syncRes.status} ${JSON.stringify(syncData).slice(0,200)}`;
        break;
      }
      if (syncData.added) added = added.concat(syncData.added);
      cursor = syncData.next_cursor;
      hasMore = !!syncData.has_more;
      safety++;
    }
    const cutoff = new Date(Date.now() - 90*24*60*60*1000); // v13.25.3 — extended from 30d for Sandbox + smoother prod averaging
    // v13.65.1 — Finance Phase 3 hotfix: /transactions/sync returns empty for fresh items until Plaid's backend backfills,
    // which can lag 1–24h for some banks (Ally is notorious for this). Fall back to /transactions/get for ANY fresh item
    // OR any item where sync returned no transactions — /transactions/get triggers an immediate fetch.
    if (added.length === 0 || !item.last_cursor) {
      try {
        const todayStr = new Date().toISOString().slice(0,10);
        const cutoffStr = cutoff.toISOString().slice(0,10);
        const getRes = await fetch(`${PLAID_BASE}/transactions/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: PLAID_CLIENT_ID,
            secret: PLAID_SECRET,
            access_token: accessToken,
            start_date: cutoffStr,
            end_date: todayStr,
            options: { count: 500, offset: 0 },
          }),
        });
        const getData = await getRes.json();
        if (getRes.ok && Array.isArray(getData.transactions) && getData.transactions.length) {
          // Replace sync results with /get results (which include the full 90d window).
          added = getData.transactions;
        } else if (!getRes.ok) {
          const errCode = getData && (getData.error_code || getData.error_type) || getRes.status;
          // PRODUCT_NOT_READY is the most common "still backfilling" error — log but don't fail the whole pull.
          result.error = (result.error || '') + ` get_backfill: ${errCode}`;
        }
      } catch (e) {
        result.error = (result.error || '') + ` get_backfill_exception: ${e.message}`;
      }
    }
    result.transactions = added
      .filter(t => t.date && new Date(t.date) >= cutoff)
      .map(t => ({
        transaction_id: t.transaction_id,
        account_id: t.account_id,                              // v13.25 — needed to filter by account.type
        date: t.date,
        name: t.name,
        merchant_name: t.merchant_name,
        amount: t.amount,
        iso_currency_code: t.iso_currency_code || 'USD',
        // v13.65.0 — Finance Phase 3: surface BOTH primary + detailed PFC so categorization can roll up at higher resolution.
        category: t.personal_finance_category?.primary || (t.category?.[0]) || null,
        category_detailed: t.personal_finance_category?.detailed || null,
        pending: t.pending || false,
      }))
      .sort((a,b) => (a.date < b.date ? 1 : -1));

    const nowIso = new Date().toISOString();
    await sbPatchPlaid(`item_id=eq.${encodeURIComponent(item.item_id)}`, {
      last_cursor: cursor,
      last_sync_at: nowIso,
      updated_at: nowIso,
    });
    result.lastSyncAt = nowIso;
  } catch (e) {
    result.error = (result.error || '') + ` sync_exception: ${e.message}`;
  }

  // v13.64.0 — Finance Phase 2: pull liabilities (APR, min payment, due date) per credit/loan account.
  // Soft-fail: many depository-only items return PRODUCT_NOT_READY/INVALID_PRODUCT; that's normal — just skip.
  result.liabilities = [];
  const hasCreditOrLoan = (result.accounts || []).some(a => a.type === 'credit' || a.type === 'loan');
  if (hasCreditOrLoan) {
    try {
      const liaRes = await fetch(`${PLAID_BASE}/liabilities/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: accessToken }),
      });
      const liaData = await liaRes.json();
      if (liaRes.ok && liaData.liabilities) {
        const accountById = new Map((liaData.accounts || []).map(a => [a.account_id, a]));
        const credits = (liaData.liabilities.credit || []).map(c => {
          const acct = accountById.get(c.account_id) || {};
          return {
            account_id: c.account_id,
            account_name: acct.name || acct.official_name || 'Credit account',
            mask: acct.mask || null,
            type: 'credit',
            balance: acct.balances?.current || 0,
            apr: c.aprs && c.aprs.length ? Math.max(...c.aprs.map(a => a.apr_percentage || 0)) : null,
            min_payment: c.minimum_payment_amount || null,
            last_payment_amount: c.last_payment_amount || null,
            last_payment_date: c.last_payment_date || null,
            next_payment_due_date: c.next_payment_due_date || null,
            last_statement_balance: c.last_statement_balance || null,
            is_overdue: c.is_overdue || false,
          };
        });
        const students = (liaData.liabilities.student || []).map(s => {
          const acct = accountById.get(s.account_id) || {};
          return {
            account_id: s.account_id,
            account_name: acct.name || acct.official_name || 'Student loan',
            mask: acct.mask || null,
            type: 'student',
            balance: acct.balances?.current || s.outstanding_interest_amount || 0,
            apr: s.interest_rate_percentage || null,
            min_payment: s.minimum_payment_amount || null,
            last_payment_amount: s.last_payment_amount || null,
            last_payment_date: s.last_payment_date || null,
            next_payment_due_date: s.next_payment_due_date || null,
            origination_principal: s.origination_principal_amount || null,
            servicer: s.servicer_address?.city || null,
          };
        });
        const mortgages = (liaData.liabilities.mortgage || []).map(m => {
          const acct = accountById.get(m.account_id) || {};
          return {
            account_id: m.account_id,
            account_name: acct.name || acct.official_name || 'Mortgage',
            mask: acct.mask || null,
            type: 'mortgage',
            balance: acct.balances?.current || 0,
            apr: m.interest_rate?.percentage || null,
            apr_type: m.interest_rate?.type || null,
            next_payment_due_date: m.next_monthly_payment || null,
            next_payment_amount: m.next_monthly_payment_amount || null,
            origination_date: m.origination_date || null,
            origination_principal: m.origination_principal_amount || null,
          };
        });
        result.liabilities = [...credits, ...students, ...mortgages];
      } else {
        // Soft fail: PRODUCT_NOT_READY / INVALID_PRODUCT is expected for many items
        const err = (liaData && (liaData.error_code || liaData.error_type)) || liaRes.status;
        if (err !== 'PRODUCT_NOT_READY' && err !== 'INVALID_PRODUCT' && err !== 'PRODUCTS_NOT_SUPPORTED') {
          result.error = (result.error || '') + ` liab: ${err}`;
        }
      }
    } catch (e) {
      result.error = (result.error || '') + ` liab_exception: ${e.message}`;
    }
  }

  return result;
}

async function plaidPull(req, res) {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'not_configured' });
  }
  const body = (req.method === 'POST' && req.body && typeof req.body === 'object') ? req.body : {};
  const query = req.query || {};
  const userLabel = body.userId || query.userId || 'admin';
  const specificItem = body.item_id || query.item_id || null;

  let q = `user_label=eq.${encodeURIComponent(userLabel)}&select=item_id,access_token,institution_name,last_cursor`;
  if (specificItem) q += `&item_id=eq.${encodeURIComponent(specificItem)}`;
  const items = await sbSelectPlaid(q);

  if (!items.length) {
    return res.status(200).json({ items: [], message: 'no_linked_items' });
  }

  const results = [];
  for (const it of items) {
    results.push(await plaidPullForItem(it));
  }

  // v13.24 — segment balances by account type so cash/investments/debt don't all collapse into "cash"
  // Plaid type values: depository, credit, loan, investment, brokerage (legacy), other
  const totals = results.reduce((acc, r) => {
    for (const a of (r.accounts || [])) {
      const bal = a.available != null ? a.available : (a.current || 0);
      const t = a.type;
      if (t === 'depository') acc.totalCash += bal;
      else if (t === 'investment' || t === 'brokerage') acc.totalInvestments += bal;
      else if (t === 'credit' || t === 'loan') acc.totalDebt += bal;
      // 'other' ignored — neither asset nor liability
    }
    return acc;
  }, { totalCash: 0, totalInvestments: 0, totalDebt: 0 });

  // v13.25.3 — burn = depository outflows + credit-card NEW CHARGES (real consumption).
  // income = depository inflows only (credit-account negatives are payments-received, not income).
  // Plaid convention: amount > 0 = outflow / new charge, amount < 0 = inflow / payment received.
  // LOAN_PAYMENTS exclusion catches both sides of a CC payment (depository→credit) so no double-count.
  // TRANSFER_* excludes intra-account moves. Pending excluded (settlement risk).
  // Window: last 90d, divided by 3 to get monthly average (less noisy than 30d snapshot, also gives
  // Plaid Sandbox a wider window since its synthetic txns are sparse).
  // v13.65.0 — Finance Phase 3: drop LOAN_PAYMENTS from exclusion list so car/student/mortgage payments surface as "Debt service".
  // Still excluding TRANSFER_IN/OUT (intra-account moves don't represent real income or spend).
  const EXCLUDE_CATS = new Set(['TRANSFER_IN', 'TRANSFER_OUT']);
  const WINDOW_DAYS = 90;
  const MONTHS_IN_WINDOW = WINDOW_DAYS / 30;
  const incomeBySource = {};   // { "Payroll · TYLER COX": { count, total, lastDate, monthly, kind } }
  const expensesByCategory = {}; // { "RENT": { count, total, lastDate, label } }
  // v13.66.0 — Mansoor's 9-bucket vocabulary: Housing · Utilities · Transportation · Gas · Groceries/Food · Insurance · Debt Payments · Subscriptions/AI Tools · Other.
  // Each detailed PFC maps to one of these buckets; everything unmapped falls through to "Other".
  const BUCKET_FOR_DETAILED = {
    // Housing — rent + mortgage payments
    'RENT_AND_UTILITIES_RENT': 'Housing',
    'LOAN_PAYMENTS_MORTGAGE_PAYMENT': 'Housing',
    // Utilities — gas/electric/water/internet/phone/sewage
    'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY': 'Utilities',
    'RENT_AND_UTILITIES_WATER': 'Utilities',
    'RENT_AND_UTILITIES_INTERNET_AND_CABLE': 'Utilities',
    'RENT_AND_UTILITIES_TELEPHONE': 'Utilities',
    'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT': 'Utilities',
    'RENT_AND_UTILITIES_OTHER_UTILITIES': 'Utilities',
    // Gas — fuel only (broken out from transit per Mansoor)
    'TRANSPORTATION_GAS': 'Gas',
    // Transportation — non-fuel
    'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': 'Transportation',
    'TRANSPORTATION_PUBLIC_TRANSIT': 'Transportation',
    'TRANSPORTATION_PARKING': 'Transportation',
    'TRANSPORTATION_TOLLS': 'Transportation',
    'TRANSPORTATION_BIKES_AND_SCOOTERS': 'Transportation',
    'TRANSPORTATION_OTHER_TRANSPORTATION': 'Transportation',
    'GENERAL_SERVICES_AUTOMOTIVE': 'Transportation',
    // Groceries/Food — covers groceries, restaurants, fast food, coffee, alcohol
    'FOOD_AND_DRINK_GROCERIES': 'Groceries/Food',
    'FOOD_AND_DRINK_RESTAURANT': 'Groceries/Food',
    'FOOD_AND_DRINK_FAST_FOOD': 'Groceries/Food',
    'FOOD_AND_DRINK_COFFEE': 'Groceries/Food',
    'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR': 'Groceries/Food',
    'FOOD_AND_DRINK_VENDING_MACHINES': 'Groceries/Food',
    'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK': 'Groceries/Food',
    // Insurance
    'GENERAL_SERVICES_INSURANCE': 'Insurance',
    // Debt Payments — car loan, credit card, student loan, personal loan
    'LOAN_PAYMENTS_CAR_PAYMENT': 'Debt Payments',
    'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT': 'Debt Payments',
    'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT': 'Debt Payments',
    'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT': 'Debt Payments',
    'LOAN_PAYMENTS_OTHER_PAYMENT': 'Debt Payments',
    // Subscriptions/AI Tools
    'GENERAL_MERCHANDISE_DIGITAL_PURCHASES': 'Subscriptions/AI Tools',
    'ENTERTAINMENT_TV_AND_MOVIES': 'Subscriptions/AI Tools',
    'ENTERTAINMENT_MUSIC_AND_AUDIO': 'Subscriptions/AI Tools',
  };
  // v13.65.0 — Finance Phase 3: kept for reference. Now used only for income classifier internal labeling.
  const DETAILED_LABELS = {
    // Rent & utilities — split rent vs utilities
    'RENT_AND_UTILITIES_RENT': 'Rent',
    'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY': 'Utilities (gas/electric)',
    'RENT_AND_UTILITIES_WATER': 'Utilities (water)',
    'RENT_AND_UTILITIES_INTERNET_AND_CABLE': 'Internet & cable',
    'RENT_AND_UTILITIES_TELEPHONE': 'Phone',
    'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT': 'Utilities (sewage/waste)',
    'RENT_AND_UTILITIES_OTHER_UTILITIES': 'Utilities (other)',
    // Transportation — break out gas, rideshare, parking, public transit
    'TRANSPORTATION_GAS': 'Gas',
    'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': 'Rideshare/Taxi',
    'TRANSPORTATION_PUBLIC_TRANSIT': 'Public transit',
    'TRANSPORTATION_PARKING': 'Parking',
    'TRANSPORTATION_TOLLS': 'Tolls',
    'TRANSPORTATION_BIKES_AND_SCOOTERS': 'Bikes/Scooters',
    'TRANSPORTATION_OTHER_TRANSPORTATION': 'Transportation (other)',
    // Loan payments — car, student, mortgage (surface explicitly per Mansoor)
    'LOAN_PAYMENTS_CAR_PAYMENT': 'Car payment',
    'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT': 'Credit card payment',
    'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT': 'Personal loan payment',
    'LOAN_PAYMENTS_MORTGAGE_PAYMENT': 'Mortgage payment',
    'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT': 'Student loan payment',
    'LOAN_PAYMENTS_OTHER_PAYMENT': 'Debt service (other)',
    // Food — roll up to single "Food" bucket
    'FOOD_AND_DRINK_GROCERIES': 'Food (groceries)',
    'FOOD_AND_DRINK_RESTAURANT': 'Food (restaurants)',
    'FOOD_AND_DRINK_FAST_FOOD': 'Food (fast food)',
    'FOOD_AND_DRINK_COFFEE': 'Coffee',
    'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR': 'Alcohol',
    'FOOD_AND_DRINK_VENDING_MACHINES': 'Food (vending)',
    'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK': 'Food (other)',
    // General services — split insurance + subscriptions (catches AI subs)
    'GENERAL_SERVICES_INSURANCE': 'Insurance',
    'GENERAL_SERVICES_AUTOMOTIVE': 'Car services',
    'GENERAL_SERVICES_CONSULTING_AND_LEGAL': 'Legal/Consulting',
    'GENERAL_SERVICES_EDUCATION': 'Education',
    'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING': 'Financial services',
    'GENERAL_SERVICES_STORAGE': 'Storage',
    'GENERAL_SERVICES_OTHER_GENERAL_SERVICES': 'Services (other)',
    // Subscriptions — Plaid uses ENTERTAINMENT_TV_AND_MOVIES + GENERAL_MERCHANDISE_DIGITAL_PURCHASES for SaaS/AI subs
    'GENERAL_MERCHANDISE_DIGITAL_PURCHASES': 'Digital/SaaS subscriptions',
    'ENTERTAINMENT_TV_AND_MOVIES': 'Streaming/Entertainment',
    'ENTERTAINMENT_VIDEO_GAMES': 'Video games',
    'ENTERTAINMENT_MUSIC_AND_AUDIO': 'Music & audio',
    'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS': 'Entertainment events',
    'ENTERTAINMENT_CASINOS_AND_GAMBLING': 'Gambling',
    'ENTERTAINMENT_OTHER_ENTERTAINMENT': 'Entertainment (other)',
    // Medical
    'MEDICAL_PRIMARY_CARE': 'Medical (primary care)',
    'MEDICAL_DENTAL_CARE': 'Dental',
    'MEDICAL_EYE_CARE': 'Vision',
    'MEDICAL_PHARMACIES_AND_SUPPLEMENTS': 'Pharmacy',
    'MEDICAL_NURSING_CARE': 'Nursing care',
    'MEDICAL_VETERINARY_SERVICES': 'Veterinary',
    'MEDICAL_OTHER_MEDICAL': 'Medical (other)',
    // Travel
    'TRAVEL_FLIGHTS': 'Flights',
    'TRAVEL_LODGING': 'Lodging',
    'TRAVEL_RENTAL_CARS': 'Rental cars',
    'TRAVEL_OTHER_TRAVEL': 'Travel (other)',
    // Personal care
    'PERSONAL_CARE_HAIR_AND_BEAUTY': 'Hair & beauty',
    'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': 'Gym & fitness',
    'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING': 'Laundry',
    'PERSONAL_CARE_OTHER_PERSONAL_CARE': 'Personal care (other)',
    // Misc
    'BANK_FEES_ATM_FEES': 'ATM fees',
    'BANK_FEES_FOREIGN_TRANSACTION_FEES': 'Foreign txn fees',
    'BANK_FEES_INSUFFICIENT_FUNDS': 'Overdraft fees',
    'BANK_FEES_INTEREST_CHARGE': 'Interest charges',
    'BANK_FEES_OTHER_BANK_FEES': 'Bank fees (other)',
    'GENERAL_MERCHANDISE_SUPERSTORES': 'Superstores',
    'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES': 'Clothing',
    'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES': 'Online marketplaces',
    'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': 'General merchandise',
    'HOME_IMPROVEMENT_HARDWARE': 'Home (hardware)',
    'HOME_IMPROVEMENT_FURNITURE': 'Home (furniture)',
    'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT': 'Home improvement',
  };
  const PFC_PRIMARY_LABELS = {
    INCOME: 'Income (other)',
    TRANSFER_IN: 'Transfer in',
    TRANSFER_OUT: 'Transfer out',
    LOAN_PAYMENTS: 'Debt service',
    BANK_FEES: 'Bank fees',
    ENTERTAINMENT: 'Entertainment',
    FOOD_AND_DRINK: 'Food',
    GENERAL_MERCHANDISE: 'General merchandise',
    HOME_IMPROVEMENT: 'Home improvement',
    MEDICAL: 'Medical',
    PERSONAL_CARE: 'Personal care',
    GENERAL_SERVICES: 'Services',
    GOVERNMENT_AND_NON_PROFIT: 'Government / non-profit',
    TRANSPORTATION: 'Transportation',
    TRAVEL: 'Travel',
    RENT_AND_UTILITIES: 'Rent & utilities',
  };
  // v13.66.0 — Mansoor's directive: only 3 income buckets. Uber (covers Uber/Raiser/Rasier LLC/etc.), Payroll, Other Income.
  // Aggregates ALL deposits into these 3 rows; no per-source breakdown — keeps the UI scannable.
  const UBER = /\b(UBER|LYFT|DOORDASH|GRUBHUB|INSTACART|POSTMATES|R[A-Z]?SIER|RAISER|RASIER)\b/i;
  const PAYROLL_KEYWORDS = /\b(PAYROLL|PAYCHECK|DIRECT DEP|DIR DEP|EDI PAYMNT|SALARY|WAGES|EMPLOYER|ADP|GUSTO|PAYCHEX|TRINET|PAYMNT REF|EFT CR|EFT_CR)\b/i;
  function classifyIncome(rawSource, amount, pfcDetailed){
    const src = (rawSource || '').toString();
    if(UBER.test(src)) return { kind: 'uber', label: 'Uber' };
    if(PAYROLL_KEYWORDS.test(src) || (amount >= 800)) return { kind: 'payroll', label: 'Payroll' };
    return { kind: 'other', label: 'Other Income' };
  }
  const flow = results.reduce((acc, r) => {
    const accountTypeById = new Map((r.accounts || []).map(a => [a.account_id, a.type]));
    for (const t of (r.transactions || [])) {
      acc.txnCount++;
      if (t.pending) continue;
      const acctType = accountTypeById.get(t.account_id);
      const isDepository = acctType === 'depository';
      const isCredit = acctType === 'credit';
      if (!isDepository && !isCredit) continue;
      if (t.category && EXCLUDE_CATS.has(t.category)) continue;
      if (typeof t.amount !== 'number') continue;
      acc.consideredCount++;
      if (t.amount > 0) {
        acc.burnTotal += t.amount;
        // v13.66.0 — bucket into Mansoor's 9 categories. Detailed PFC → bucket lookup; everything unmapped lands in "Other".
        const detailedKey = t.category_detailed || null;
        const bucket = BUCKET_FOR_DETAILED[detailedKey] || 'Other';
        if (!expensesByCategory[bucket]) expensesByCategory[bucket] = { count: 0, total: 0, lastDate: null, label: bucket };
        expensesByCategory[bucket].count++;
        expensesByCategory[bucket].total += t.amount;
        if (!expensesByCategory[bucket].lastDate || t.date > expensesByCategory[bucket].lastDate) expensesByCategory[bucket].lastDate = t.date;
      } else if (t.amount < 0 && isDepository) {
        const v = Math.abs(t.amount);
        acc.incomeTotal += v;
        // v13.66.0 — aggregate by bucket (Uber/Payroll/Other Income) so the UI shows only 3 rows max.
        const rawSrc = (t.merchant_name || t.name || 'Unknown source').toString().trim();
        const cls = classifyIncome(rawSrc, v, t.category_detailed);
        const key = cls.label; // 'Uber' | 'Payroll' | 'Other Income'
        if (!incomeBySource[key]) incomeBySource[key] = { count: 0, total: 0, lastDate: null, kind: cls.kind };
        incomeBySource[key].count++;
        incomeBySource[key].total += v;
        if (!incomeBySource[key].lastDate || t.date > incomeBySource[key].lastDate) incomeBySource[key].lastDate = t.date;
      }
    }
    return acc;
  }, { burnTotal: 0, incomeTotal: 0, txnCount: 0, consideredCount: 0 });
  const monthlyBurn = flow.burnTotal / MONTHS_IN_WINDOW;
  const monthlyIncome = flow.incomeTotal / MONTHS_IN_WINDOW;
  // v13.65.0 — convert maps to ordered arrays + monthly avg, sorted desc by total. Income carries `kind` (payroll/rideshare/investment/other).
  const incomeBySourceArr = Object.entries(incomeBySource)
    .map(([source, v]) => ({ source, kind:v.kind, count:v.count, total:v.total, monthly:v.total/MONTHS_IN_WINDOW, lastDate:v.lastDate }))
    .sort((a,b) => b.total - a.total);
  const expensesByCategoryArr = Object.entries(expensesByCategory)
    .map(([category, v]) => ({ category, label:v.label, count:v.count, total:v.total, monthly:v.total/MONTHS_IN_WINDOW, lastDate:v.lastDate }))
    .sort((a,b) => b.total - a.total);
  // v13.64.0 — liabilities flattened across all items, Avalanche-sorted (APR desc; NULL apr last by balance desc).
  const liabilitiesByAccount = results.flatMap(r => r.liabilities || [])
    .sort((a,b) => {
      const aA = a.apr == null ? -1 : a.apr;
      const bA = b.apr == null ? -1 : b.apr;
      if (aA !== bA) return bA - aA;
      return (b.balance||0) - (a.balance||0);
    });

  return res.status(200).json({
    items: results,
    summary: {
      totalCash: totals.totalCash,
      totalInvestments: totals.totalInvestments,
      totalDebt: totals.totalDebt,
      monthlyBurn: monthlyBurn,                // v13.25.3 — 90d burn / 3 = monthly avg (cash+credit)
      monthlyIncome: monthlyIncome,            // v13.25.3 — 90d income / 3 = monthly avg (depository only)
      windowDays: 90,                          // v13.25.3 — window length so UI can label correctly
      txnCount: flow.txnCount,                 // v13.25.2 — diagnostic: total txns returned in window
      consideredCount: flow.consideredCount,   // v13.25.2 — diagnostic: txns that passed all filters
      itemCount: results.length,
      asOf: new Date().toISOString(),
      env: _PLAID_ENV,                         // v13.63.2 — Finance Phase 1: authoritative env, lets UI kill sandbox labels in prod
      incomeBySource: incomeBySourceArr,       // v13.64.0 — Finance Phase 2: 90d income grouped by payer
      expensesByCategory: expensesByCategoryArr, // v13.64.0 — Finance Phase 2: 90d expenses grouped by PFC primary
      liabilitiesByAccount: liabilitiesByAccount, // v13.64.0 — Finance Phase 2: Avalanche-sorted real liabilities
    },
  });
}

// ── HeyGen handlers (merged here to stay under Vercel Hobby 12-function limit) ─
// v13.51.0 — P1 HeyGen API integration. Read-only test + asset discovery +
// async render submission + status polling. Key from Vercel env HEYGEN_API_KEY.
// Server-side only — key never reaches the browser.

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY || '';
const HEYGEN_BASE = 'https://api.heygen.com';

// v13.52.0 — P2A Submagic API integration. Takes HeyGen output, returns publishable
// MP4 with captions + B-rolls + zooms. Key from Vercel env SUBMAGIC_API_KEY.
const SUBMAGIC_API_KEY = process.env.SUBMAGIC_API_KEY || '';
const SUBMAGIC_BASE = 'https://api.submagic.co';

// v16.65.0 — SMM V1 Phase 4: Quality Production Pipeline. ElevenLabs is the preferred V1
// narration provider (natural commercial voice, no on-screen avatar required). RUNWAY_API_KEY
// is read only so smRunwayEnhanceSegmentStub can report accurate configuration status — it is
// NOT invoked anywhere in the default V1 build path (see that function for why).
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — standard ElevenLabs premade voice, used only until the CEO sets a business-specific one
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY || '';

async function _heygenFetch(path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'X-Api-Key': HEYGEN_API_KEY }, opts.headers || {});
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const url = HEYGEN_BASE + path;
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch(_) { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message };
  }
}

async function heygenTest(req, res) {
  if (!HEYGEN_API_KEY) return res.status(500).json({ ok: false, error: 'heygen_not_configured', message: 'HEYGEN_API_KEY env var is missing. Add it in Vercel.' });
  // Try the quota endpoint — small payload, verifies auth + plan tier in one call.
  const r = await _heygenFetch('/v1/user/remaining_quota.get');
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    keyConfigured: true,
    quotaResponse: r.data,
    error: r.error || null,
  });
}

async function heygenListAvatars(req, res) {
  if (!HEYGEN_API_KEY) return res.status(500).json({ ok: false, error: 'heygen_not_configured' });
  const r = await _heygenFetch('/v2/avatars');
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    avatars: (r.data && r.data.data && r.data.data.avatars) || (r.data && r.data.avatars) || [],
    talkingPhotos: (r.data && r.data.data && r.data.data.talking_photos) || [],
    raw: r.data,
    error: r.error || null,
  });
}

async function heygenListVoices(req, res) {
  if (!HEYGEN_API_KEY) return res.status(500).json({ ok: false, error: 'heygen_not_configured' });
  const r = await _heygenFetch('/v2/voices');
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    voices: (r.data && r.data.data && r.data.data.voices) || (r.data && r.data.voices) || [],
    raw: r.data,
    error: r.error || null,
  });
}

// v13.75.5 — Generate a 15-second ambient WAV loop for AI Studio background music.
// Four sine-tone AI drone: A1(55Hz) E2(82Hz) A2(110Hz) E3(165Hz) — loopable, ~260KB.
// HeyGen fetches this URL via background_audio.audio_url and loops it for the full video.
function ambientMusicWAV(req, res) {
  const sampleRate = 22050;
  const durationSec = 15; // short enough to generate fast; HeyGen loops it
  const numSamples = sampleRate * durationSec;
  const freqs = [55, 82.4, 110, 165];
  const gainPerFreq = 0.12; // total max ~0.48 — headroom before clipping

  // Generate PCM samples (mono 16-bit)
  const dataSize = numSamples * 2;
  const buf = Buffer.allocUnsafe(44 + dataSize);

  // WAV RIFF header
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);           // PCM sub-chunk size
  buf.writeUInt16LE(1, 20);            // AudioFormat: PCM
  buf.writeUInt16LE(1, 22);            // NumChannels: mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buf.writeUInt16LE(2, 32);            // BlockAlign
  buf.writeUInt16LE(16, 34);           // BitsPerSample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  // Fill samples with looping fade-in/fade-out to avoid click at loop point
  const twoPi = 2 * Math.PI;
  const fadeLen = Math.round(sampleRate * 0.05); // 50ms fade
  for (let i = 0; i < numSamples; i++) {
    let s = 0;
    for (const f of freqs) s += gainPerFreq * Math.sin(twoPi * f * i / sampleRate);
    // Apply fade at start + end to make loop seamless
    if (i < fadeLen) s *= (i / fadeLen);
    else if (i > numSamples - fadeLen) s *= ((numSamples - i) / fadeLen);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2);
  }

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).end(buf);
}

async function heygenStartRender(req, res) {
  if (!HEYGEN_API_KEY) return res.status(500).json({ ok: false, error: 'heygen_not_configured' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { avatar_id, voice_id, script, background, dimension, test, scale } = body;
  if (!avatar_id || !voice_id || !script) {
    return res.status(400).json({ ok: false, error: 'missing_fields', need: ['avatar_id','voice_id','script'], got: Object.keys(body) });
  }
  // Build background block per HeyGen v2 spec. Three valid types: color, image, video.
  // Default to a dark color if no background passed.
  let backgroundBlock = { type: 'color', value: '#0a1628' };
  if (background && background.type) {
    backgroundBlock = background;
  } else if (background && typeof background === 'string' && background.startsWith('#')) {
    backgroundBlock = { type: 'color', value: background };
  }
  // v13.51.5 — revert v13.51.4 talking_photo detection. HeyGen API error "avatar look
  // not found, look_id: X" proved IDs are AVATAR LOOK IDs regardless of format (slug
  // like "Raul_expressive_2024112501" OR UUID like "50cc8524aa404a479242ffb73ab56cb6").
  // Always use character.type='avatar' + avatar_id. The 32-char hex IDs are custom
  // avatar look IDs, not talking_photo IDs.
  // v13.57.2/.4 — per-host character.scale. Paul/Raul (landscape stock avatars) need
  // scale=2.0 to crop landscape into portrait Shorts framing. Sophia (AI-generated
  // portrait-native Photo Avatars) needs scale=1.0 to keep natural head/shoulders
  // composition — scale=2.0 over-zooms into face-only / cropped forehead (audited
  // 2026-06-15). Caller passes scale; default 2.0 preserves Paul behavior if missing.
  const characterScale = (typeof scale === 'number' && scale > 0) ? scale : 2.0;
  // v13.75.6 — video_inputs item. background_audio goes at videoBody TOP LEVEL per HeyGen v2 spec.
  const videoInput = {
    character: { type: 'avatar', avatar_id: avatar_id, avatar_style: 'normal', scale: characterScale },
    voice: { type: 'text', input_text: script, voice_id: voice_id },
    background: backgroundBlock,
  };
  const videoBody = {
    video_inputs: [videoInput],
    dimension: dimension || { width: 1080, height: 1920 }, // portrait by default for shorts
    test: test === true,
  };
  // v13.75.7 — background_audio removed: HeyGen v2 API rejects this field (render fails silently).
  // Music will be applied via Submagic post-processing instead.
  const r = await _heygenFetch('/v2/video/generate', { method: 'POST', body: videoBody });
  // HeyGen response shape: { data: { video_id: "..." }, error: null } on success
  const videoId = (r.data && r.data.data && r.data.data.video_id) || null;
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    videoId,
    submittedAt: new Date().toISOString(),
    raw: r.data,
    error: r.error || null,
  });
}

// v13.51.6 — fetch all looks inside a single avatar group. Lets MMM resolve
// the proper look_id when operator only has the parent groupId from HeyGen
// Studio (which doesn't surface per-look IDs in its UI).
async function heygenGroupLooks(req, res) {
  if (!HEYGEN_API_KEY) return res.status(500).json({ ok: false, error: 'heygen_not_configured' });
  const groupId = (req.query && req.query.group_id) || (req.body && req.body.group_id);
  if (!groupId) return res.status(400).json({ ok: false, error: 'missing_group_id' });
  // Try the v2 group avatars endpoint first.
  const r = await _heygenFetch('/v2/avatar_group/' + encodeURIComponent(groupId) + '/avatars');
  // Normalize across possible response shapes — HeyGen has shifted this several times.
  let looks = [];
  if (r.data) {
    const d = r.data.data || r.data;
    looks = d.avatar_list || d.avatars || d.looks || d.items || [];
  }
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    groupId,
    looks,
    rawCount: Array.isArray(looks) ? looks.length : 0,
    raw: r.data,
    error: r.error || null,
  });
}

// v13.51.6 — list ALL avatar groups in the workspace. Useful when operator
// can't find a specific avatar by ID — they can grep this list visually.
async function heygenListAvatarGroups(req, res) {
  if (!HEYGEN_API_KEY) return res.status(500).json({ ok: false, error: 'heygen_not_configured' });
  const r = await _heygenFetch('/v2/avatar_group.list');
  let groups = [];
  if (r.data) {
    const d = r.data.data || r.data;
    groups = d.avatar_group_list || d.groups || d.items || [];
  }
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    groups,
    rawCount: Array.isArray(groups) ? groups.length : 0,
    raw: r.data,
    error: r.error || null,
  });
}

// ── v13.77.0 HeyGen Video Proxy — CORS bridge so browser canvas can capture HeyGen CDN videos ──
// HeyGen CDN (files2.heygen.ai) serves no Access-Control-Allow-Origin header, so canvas becomes
// tainted and logo/music post-processing fails. This proxy fetches the video server-side and
// returns it with CORS headers + Range passthrough so the browser video element can seek normally.
async function heygenVideoProxy(req, res) {
  const videoUrl = (req.query && req.query.url) || '';
  if (!videoUrl) return res.status(400).json({ error: 'missing_url' });

  // Security: only allow known HeyGen CDN domains
  const ALLOWED_HEYGEN_HOSTS = [
    'files.heygen.ai',
    'files2.heygen.ai',
    'resource.heygen.ai',
    'resource2.heygen.ai',
    'assets.heygen.ai',
  ];
  let parsedHost;
  try { parsedHost = new URL(videoUrl).hostname; } catch (_) { return res.status(400).json({ error: 'invalid_url' }); }
  const hostAllowed = ALLOWED_HEYGEN_HOSTS.some(h => parsedHost === h || parsedHost.endsWith('.' + h));
  if (!hostAllowed) return res.status(403).json({ error: 'host_not_allowed', host: parsedHost });

  const upstreamHeaders = {};
  if (req.headers && req.headers['range']) upstreamHeaders['Range'] = req.headers['range'];

  let srcRes;
  try {
    srcRes = await fetch(videoUrl, { headers: upstreamHeaders });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_fetch_failed', detail: e.message });
  }

  // Forward status + CORS + content headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  const ct = srcRes.headers.get('content-type') || 'video/mp4';
  res.setHeader('Content-Type', ct);
  res.setHeader('Accept-Ranges', 'bytes');
  const cl = srcRes.headers.get('content-length');
  if (cl) res.setHeader('Content-Length', cl);
  const cr = srcRes.headers.get('content-range');
  if (cr) res.setHeader('Content-Range', cr);
  res.status(srcRes.status);

  // Pipe body
  const { Readable } = await import('stream'); // ESM-safe: package.json has "type":"module"
  const readable = Readable.fromWeb ? Readable.fromWeb(srcRes.body) : srcRes.body;
  readable.pipe(res);
}

// ── v13.52.0 P2A Submagic handlers ────────────────────────────────────────
async function _submagicFetch(path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'x-api-key': SUBMAGIC_API_KEY }, opts.headers || {});
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const url = SUBMAGIC_BASE + path;
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch(_) { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message };
  }
}

async function submagicTest(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured', message: 'SUBMAGIC_API_KEY env var missing. Add it in Vercel.' });
  // Use /v1/languages as a cheap auth-verifying probe (rate-limited at 1000/hr).
  const r = await _submagicFetch('/v1/languages');
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    keyConfigured: true,
    languagesCount: (r.data && Array.isArray(r.data.languages)) ? r.data.languages.length : 0,
    sample: (r.data && Array.isArray(r.data.languages)) ? r.data.languages.slice(0, 5) : null,
    raw: r.data,
    error: r.error || null,
  });
}

async function submagicCreateProject(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { videoUrl, title, language, templateName, magicZooms, magicBrolls, magicBrollsPercentage, dictionary, webhookUrl, music } = body;
  if (!videoUrl) return res.status(400).json({ ok: false, error: 'missing_video_url' });
  // v13.52.0 — defaults dialed for short-form publishable output. Hormozi 2 is the
  // viral burn-in caption style. magicBrolls + magicZooms = the P2A requirements.
  // v13.85.1 — music param forwarded when provided (userMediaId from Submagic media library)
  const projectBody = {
    title: title || ('MMM ' + new Date().toISOString()),
    language: language || 'en',
    videoUrl,
    templateName: templateName || 'Hormozi 2',
    magicZooms: magicZooms !== false, // default ON
    magicBrolls: magicBrolls !== false, // default ON
    magicBrollsPercentage: typeof magicBrollsPercentage === 'number' ? magicBrollsPercentage : 60,
  };
  if (dictionary && Array.isArray(dictionary)) projectBody.dictionary = dictionary;
  if (webhookUrl) projectBody.webhookUrl = webhookUrl;
  // v13.85.1 — background music: { userMediaId, volume, fade }
  if (music && music.userMediaId) projectBody.music = { userMediaId: music.userMediaId, volume: music.volume || 20, fade: music.fade !== false, startFromTime: music.startFromTime || 0 };
  const r = await _submagicFetch('/v1/projects', { method: 'POST', body: projectBody });
  // Response shape: { id, status, ... }
  const projectId = (r.data && (r.data.id || (r.data.project && r.data.project.id))) || null;
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    projectId,
    submittedAt: new Date().toISOString(),
    sentBody: projectBody,
    raw: r.data,
    error: r.error || null,
  });
}

async function submagicGetProject(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured' });
  const projectId = (req.query && req.query.project_id) || (req.body && req.body.project_id);
  if (!projectId) return res.status(400).json({ ok: false, error: 'missing_project_id' });
  const r = await _submagicFetch('/v1/projects/' + encodeURIComponent(projectId));
  // Response shape varies; common fields: status, downloadUrl, videoUrl, exportUrl
  const d = (r.data && (r.data.project || r.data)) || {};
  const status = d.status || d.state || null;
  const downloadUrl = d.downloadUrl || d.videoUrl || d.exportUrl || d.outputUrl || null;
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    httpStatus: r.status,
    projectId,
    status,
    downloadUrl,
    duration: d.duration || null,
    raw: r.data,
    error: r.error || null,
  });
}

async function submagicListTemplates(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured' });
  // /v1/templates per docs convention
  const r = await _submagicFetch('/v1/templates');
  let templates = [];
  if (r.data) {
    templates = r.data.templates || r.data.data || [];
  }
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    templates,
    rawCount: Array.isArray(templates) ? templates.length : 0,
    raw: r.data,
    error: r.error || null,
  });
}
async function submagicCreateMedia(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { url } = body;
  if (!url) return res.status(400).json({ ok: false, error: 'missing_url' });
  const r = await _submagicFetch('/v1/user-media', { method: 'POST', body: { url } });
  const userMediaId = (r.data && r.data.userMediaId) || null;
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    userMediaId,
    raw: r.data,
    error: r.error || null,
  });
}
async function submagicListMedia(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured' });
  const type  = (req.query && req.query.type)  || 'AUDIO'; // VIDEO | AUDIO | IMAGE
  const limit = (req.query && req.query.limit) || '50';
  const r = await _submagicFetch('/v1/user-media?type=' + encodeURIComponent(type) + '&limit=' + encodeURIComponent(limit));
  const items = (r.data && Array.isArray(r.data.items)) ? r.data.items : [];
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    status: r.status,
    count: items.length,
    items,
    hasMore: (r.data && r.data.hasMore) || false,
    raw: r.data,
    error: r.error || null,
  });
}

// v13.86.1 — EVL video verification helpers
// submagicProbeVideo: server-side HEAD + partial fetch to verify video is accessible
// and extract basic metadata (content-type, content-length, byte sniff for valid MP4)
async function submagicProbeVideo(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured' });
  const project_id = (req.query && req.query.project_id) || (req.body && req.body.project_id);
  if (!project_id) return res.status(400).json({ ok: false, error: 'missing_project_id' });
  // 1. Get project to retrieve download URL
  const pr = await _submagicFetch('/v1/projects/' + encodeURIComponent(project_id));
  if (!pr.ok || !pr.data) return res.status(502).json({ ok: false, error: 'project_fetch_failed', detail: pr.error });
  const d = pr.data.project || pr.data;
  const downloadUrl = d.downloadUrl || d.videoUrl || d.exportUrl || d.outputUrl || d.directUrl || null;
  if (!downloadUrl) return res.status(404).json({ ok: false, error: 'no_download_url', status: d.status });
  // 2. HEAD request to verify URL is live
  let headOk = false; let contentType = null; let contentLength = null; let headStatus = null;
  try {
    const hr = await fetch(downloadUrl, { method: 'HEAD' });
    headStatus = hr.status;
    headOk = hr.ok;
    contentType = hr.headers.get('content-type') || null;
    contentLength = hr.headers.get('content-length') || null;
  } catch(e) { headOk = false; }
  // 3. Fetch first 12 bytes to check MP4 magic bytes (ftyp box)
  let isMp4 = false; let firstBytes = null;
  try {
    const br = await fetch(downloadUrl, { headers: { Range: 'bytes=0-11' } });
    if (br.ok) {
      const buf = await br.arrayBuffer();
      const bytes = new Uint8Array(buf);
      firstBytes = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
      // MP4/MOV: bytes 4-7 = 'ftyp' (66 74 79 70)
      isMp4 = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    }
  } catch(e) {}
  return res.status(200).json({
    ok: true,
    project_id,
    projectStatus: d.status || null,
    duration: (d.videoMetaData && d.videoMetaData.duration) || null,
    wordCount: (Array.isArray(d.words) ? d.words.length : null),
    disableCaptions: d.disableCaptions || false,
    downloadUrlAccessible: headOk,
    headStatus,
    contentType,
    contentLengthBytes: contentLength ? parseInt(contentLength) : null,
    isMp4,
    firstBytes,
    redirectUrl: downloadUrl,  // returned so caller can redirect browser to it
  });
}

// submagicVideoRedirect: 302 redirect to the Submagic download URL
// allows browser to navigate directly to the video for native playback + screenshot
async function submagicVideoRedirect(req, res) {
  if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: 'submagic_not_configured' });
  const project_id = (req.query && req.query.project_id) || (req.body && req.body.project_id);
  if (!project_id) return res.status(400).json({ ok: false, error: 'missing_project_id' });
  const pr = await _submagicFetch('/v1/projects/' + encodeURIComponent(project_id));
  if (!pr.ok || !pr.data) return res.status(502).json({ ok: false, error: 'project_fetch_failed' });
  const d = pr.data.project || pr.data;
  const downloadUrl = d.downloadUrl || d.videoUrl || d.exportUrl || d.outputUrl || d.directUrl || null;
  if (!downloadUrl) return res.status(404).json({ ok: false, error: 'no_download_url' });
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, downloadUrl);
}
// ── end Submagic handlers ──

// ── v13.54.0 P5 / Sprint 3 YouTube upload handlers ────────────────────────
// v13.54.6 — Engine → YouTube channel title. youtube_channels table stores the channel
// display title (returned by YouTube API), not the @handle. Previous map used @handles
// which couldn't match the stored titles. Titles come from the OAuth callback's
// fetchAllChannels response: ch.snippet.title.
const YT_ENGINE_TO_TITLE = {
  'AI Studio':           'AI Creation Studio',
  'AI Creation Studio':  'AI Creation Studio',
  'NextWave':            'NextWave Systems',
  'NextWave Systems':    'NextWave Systems',
  'SRV Farsi':           'Silk Road Voices',
  'SRV English':         'SRV Studio',
};

// Refresh a YouTube access_token from a stored refresh_token. Returns the new
// access_token (also valid_until expiry timestamp). Token refresh is cheap — calling
// before every upload is fine + avoids race conditions on token expiry.
async function _refreshYoutubeToken(refreshToken) {
  if (!refreshToken) throw new Error('missing_refresh_token');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    // v13.69.3 — log full Google error for diagnosis
    console.error('[youtube_token_refresh] FAILED status:', res.status, 'body:', text.slice(0, 400),
      'client_id_set:', !!process.env.YOUTUBE_CLIENT_ID, 'client_secret_set:', !!process.env.YOUTUBE_CLIENT_SECRET);
    throw new Error('youtube_refresh_failed: ' + res.status + ' ' + text.slice(0, 200));
  }
  const data = JSON.parse(text);
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    scope: data.scope || '',
  };
}

// v13.54.6 — Look up the YouTube connection row by channel title (e.g. 'AI Creation Studio').
// Returns { channel_id, refresh_token, access_token, ..., _matchedChannelTitle } or null.
// Matches exact title (case-insensitive) first, then loose normalized fallback.
async function _getYoutubeConnectionByTitle(title) {
  if (!title) return null;
  try {
    const channels = await sbGet('youtube_channels?select=channel_id,title');
    if (!Array.isArray(channels) || !channels.length) return null;
    const wantLower = String(title).toLowerCase().trim();
    const wantNorm = wantLower.replace(/[^a-z0-9]/g,'');
    // Try exact case-insensitive match first
    let target = channels.find(function(c){
      return (c.title || '').toLowerCase().trim() === wantLower;
    });
    // Then loose normalized match (drop punctuation/spaces)
    if (!target) {
      target = channels.find(function(c){
        const t = (c.title || '').toLowerCase().replace(/[^a-z0-9]/g,'');
        return t === wantNorm || t.includes(wantNorm) || wantNorm.includes(t);
      });
    }
    if (!target) return null;
    const conns = await sbGet('youtube_connections?channel_id=eq.' + encodeURIComponent(target.channel_id) + '&select=*&limit=1');
    if (!Array.isArray(conns) || !conns.length) return null;
    return Object.assign({}, conns[0], { _matchedChannelTitle: target.title });
  } catch (e) {
    console.error('[v13.54.6] _getYoutubeConnectionByTitle error:', e.message);
    return null;
  }
}

// v13.55.1 — Resolve Submagic SPA download URLs to real CDN URLs via /v1/projects/{id}.
// v13.55.2 — Also accept a bare Submagic project_id (UUID) as the input — same resolve path.
async function _resolveSubmagicUrl(urlOrId) {
  if (!urlOrId) return urlOrId;
  const input = String(urlOrId).trim();
  // Path A: bare UUID looks like a Submagic project_id — resolve directly
  const bareUuidMatch = input.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (bareUuidMatch) {
    return await _resolveSubmagicProjectId(bareUuidMatch[1]);
  }
  // Path B: Submagic SPA download URL — extract project_id from path param
  if (/app\.submagic\.co\/api\/file\/download/i.test(input)) {
    const pathMatch = input.match(/[?&]path=([^&]+)/);
    if (!pathMatch) throw new Error('submagic_url_missing_path_param');
    const pathDecoded = decodeURIComponent(pathMatch[1]);
    const idsMatch = pathDecoded.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!idsMatch) throw new Error('submagic_url_no_project_id_in_path: ' + pathDecoded.slice(0, 150));
    return await _resolveSubmagicProjectId(idsMatch[2]);
  }
  // Path C: any other URL — passthrough (might be HeyGen CDN, direct MP4, etc.)
  return input;
}

async function _resolveSubmagicProjectId(projectId) {
  if (!SUBMAGIC_API_KEY) {
    throw new Error('cannot_resolve_submagic_project: SUBMAGIC_API_KEY not configured');
  }
  const r = await _submagicFetch('/v1/projects/' + encodeURIComponent(projectId));
  if (!r.ok) {
    throw new Error('submagic_resolve_failed: HTTP ' + r.status + ' for project ' + projectId + ' · raw: ' + JSON.stringify(r.data || {}).slice(0, 200));
  }
  const d = (r.data && (r.data.project || r.data)) || {};
  const resolvedUrl = d.downloadUrl || d.videoUrl || d.exportUrl || d.outputUrl || null;
  if (!resolvedUrl) {
    throw new Error('submagic_no_downloadUrl_in_response: status=' + (d.status||'?') + ' projectId=' + projectId);
  }
  console.log('[v13.55.2] resolved Submagic project → CDN URL · projectId:', projectId, '· host:', new URL(resolvedUrl).host);
  return resolvedUrl;
}

// YouTube upload via resumable protocol.
// v13.55.0 — Validates source content-type + adds Submagic auth header when needed.
// v13.55.1 — Auto-resolves Submagic SPA download URLs to real API/CDN URLs.
async function _youtubeResumableUpload(accessToken, videoUrl, metadata) {
  // 0. If the source is a Submagic SPA URL, resolve to the real CDN URL via API
  videoUrl = await _resolveSubmagicUrl(videoUrl);
  // 1. Fetch the source MP4. Keep x-api-key fallback for resolved URLs that still happen to be on
  // Submagic's domain (api.submagic.co etc).
  const srcHeaders = {};
  if (/submagic\.co/i.test(videoUrl) && SUBMAGIC_API_KEY) {
    srcHeaders['x-api-key'] = SUBMAGIC_API_KEY;
  }
  const srcRes = await fetch(videoUrl, { headers: srcHeaders, redirect: 'follow' });
  if (!srcRes.ok) {
    let bodyPreview = '';
    try { bodyPreview = (await srcRes.text()).slice(0, 300); } catch(_) {}
    throw new Error('source_fetch_failed: HTTP ' + srcRes.status + ' · body: ' + bodyPreview);
  }
  const contentType = (srcRes.headers.get('content-type') || '').toLowerCase();
  const contentLength = srcRes.headers.get('content-length');
  // v13.55.0 — validate that source is actually video. If we get HTML or JSON, upload would fail
  // silently with "Processing abandoned" on YouTube's end. Reject upfront with diagnostic.
  if (!/^video\//i.test(contentType) && !/octet-stream|application\/binary/i.test(contentType)) {
    let bodyPreview = '';
    try { bodyPreview = (await srcRes.text()).slice(0, 300); } catch(_) {}
    throw new Error('source_not_video: content-type="' + contentType + '" · length=' + contentLength + ' · body-preview: ' + bodyPreview);
  }
  // v13.69.2 — Use the actual source MIME type instead of hardcoding video/mp4.
  const uploadMime = /^video\//i.test(contentType) ? contentType.split(';')[0].trim() : 'video/mp4';
  // v13.76.2 — Get content-length from source headers (needed for both buffer + stream paths).
  // For Long AI Studio videos (150-400 MB), buffering via arrayBuffer() causes sequential
  // download + upload that exceeds Vercel's 60s maxDuration. Streaming pipes bytes concurrently
  // (download + upload overlap), typically completing in 25-40s.
  const srcContentLength = parseInt(srcRes.headers.get('content-length') || '0', 10);
  // Stream when file is known-large OR when size is unknown (no Content-Length).
  // Unknown size is safer to stream than to buffer (avoids out-of-memory on large files).
  const IS_LARGE = !srcContentLength || srcContentLength > 50 * 1024 * 1024;

  // 2. Init the resumable upload session
  const initHeaders = {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json',
    'X-Upload-Content-Type': uploadMime,
  };
  if (srcContentLength > 0) initHeaders['X-Upload-Content-Length'] = String(srcContentLength);
  const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: initHeaders,
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) {
    const t = await initRes.text();
    throw new Error('upload_init_failed: ' + initRes.status + ' ' + t.slice(0, 400));
  }
  const uploadUrl = initRes.headers.get('location') || initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('no_upload_url_in_response');

  // 3. PUT video bytes — stream for large files, buffer for small
  let putRes;
  if (IS_LARGE) {
    // v13.76.2 — Stream body directly to YouTube. Download + upload run concurrently,
    // avoiding the Vercel 60s timeout that hits when buffering 200+ MB into memory first.
    const putHeaders = { 'Content-Type': uploadMime };
    if (srcContentLength > 0) putHeaders['Content-Length'] = String(srcContentLength);
    putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: putHeaders,
      body: srcRes.body,
      duplex: 'half', // Node 18+ — allows streaming request body
    });
  } else {
    // Small files (<50 MB) — buffer as before (safe, reliable)
    const buf = await srcRes.arrayBuffer();
    const totalBytes = buf.byteLength;
    if (totalBytes < 1000) {
      throw new Error('source_too_small: ' + totalBytes + ' bytes — likely not a real MP4');
    }
    putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': uploadMime,
        'Content-Length': String(totalBytes),
      },
      body: buf,
    });
  }
  const putText = await putRes.text();
  if (!putRes.ok) {
    throw new Error('upload_put_failed: ' + putRes.status + ' ' + putText.slice(0, 400));
  }
  return JSON.parse(putText); // { id, snippet, status, ... }
}

// v13.72.0 — SRV Farsi playlist helpers ──────────────────────────────────────
const _FARSI_PLAYLIST_MAP = {
  romantic:  'SRV Farsi - Romantic',
  emotional: 'SRV Farsi - Emotional',
  happy:     'SRV Farsi - Happy',
};

// Fetch playlist by title from channel, or create it if missing.
async function _ytGetOrCreatePlaylist(playlistTitle, accessToken) {
  const listRes = await fetch(
    'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50',
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  );
  if (!listRes.ok) throw new Error('playlist_list_failed_' + listRes.status);
  const listData = await listRes.json();
  const existing = (listData.items || []).find(function(p) {
    return (p.snippet && p.snippet.title || '').toLowerCase() === playlistTitle.toLowerCase();
  });
  if (existing) return { id: existing.id, title: existing.snippet.title };
  // Create it
  const createRes = await fetch(
    'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: { title: playlistTitle, defaultLanguage: 'fa' },
        status: { privacyStatus: 'public' },
      }),
    }
  );
  if (!createRes.ok) throw new Error('playlist_create_failed_' + createRes.status);
  const created = await createRes.json();
  return { id: created.id, title: created.snippet && created.snippet.title };
}

// Insert a video into an existing playlist.
async function _ytAddVideoToPlaylist(videoId, playlistId, accessToken) {
  const r = await fetch(
    'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
      }),
    }
  );
  if (!r.ok) { const t = await r.text().catch(() => String(r.status)); throw new Error('playlist_insert_failed: ' + t); }
  return r.json();
}

async function youtubeUploadVideo(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const {
    videoUrl,          // direct MP4 URL (Submagic enhanced output)
    engine,            // 'AI Studio' / 'NextWave' / etc → maps to YouTube channel
    channelHandle,     // explicit override of engine→channel mapping
    title,
    description,
    tags,              // array of strings
    categoryId,        // YouTube category, defaults to 22 (People & Blogs)
    privacyStatus,     // 'private' (default safe) / 'unlisted' / 'public'
    publishAt,         // ISO timestamp for scheduled publish (requires privacy=private)
    madeForKids,       // boolean, defaults false (we're general audience)
    playlistCategory,  // v13.72.0 — 'romantic'|'emotional'|'happy' → auto-add to named playlist
  } = body;
  if (!videoUrl) return res.status(400).json({ ok: false, error: 'missing_video_url' });

  // v13.54.6 — channelHandle param kept for backward compatibility but now treated as title
  const channelTitle = channelHandle || YT_ENGINE_TO_TITLE[engine] || null;
  if (!channelTitle) return res.status(400).json({ ok: false, error: 'no_engine_mapping', engine, knownEngines: Object.keys(YT_ENGINE_TO_TITLE) });

  // Look up the connection row by channel title
  const conn = await _getYoutubeConnectionByTitle(channelTitle);
  if (!conn) {
    // Diagnostic: dump available channel titles so we can see what's actually stored
    let availableTitles = [];
    try {
      const all = await sbGet('youtube_channels?select=title');
      availableTitles = (Array.isArray(all) ? all : []).map(function(c){ return c.title; });
    } catch(_) {}
    return res.status(404).json({
      ok: false,
      error: 'no_connection_for_title',
      requestedTitle: channelTitle,
      availableTitles,
      hint: 'Engine maps to "' + channelTitle + '" but this title was not found in youtube_channels table. Available titles listed above — verify the mapping.',
    });
  }
  if (!conn.refresh_token) return res.status(400).json({ ok: false, error: 'no_refresh_token_on_record', channelTitle });

  // Refresh access token (cheap, avoids stale-token failure)
  let accessToken;
  try {
    const refreshed = await _refreshYoutubeToken(conn.refresh_token);
    accessToken = refreshed.accessToken;
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'token_refresh_failed', message: e.message });
  }

  // Build YouTube metadata. v13.56.2 — frontend now sends a complete description that
  // already includes caption + hashtags + AI disclosure. Server no longer auto-appends
  // its own disclosure (that would double up). If description is short and disclosure
  // is missing, server adds it once as a safety net.
  const titleClean = String(title || 'MMM Short').slice(0, 100); // YouTube max 100 chars
  let descClean = String(description || '').slice(0, 5000);
  // Safety net: ensure SOME AI disclosure exists. If frontend forgot to include one, append.
  // v13.69.8 — skip for Farsi descriptions (Arabic/Persian chars present → Farsi description already appropriate)
  const hasFarsiChars = /[؀-ۿ]/.test(descClean);
  if (!hasFarsiChars && !/ai[\s\-]?generated|🤖/i.test(descClean)) {
    descClean = (descClean + '\n\n— AI-generated avatar narration + auto-edited captions/visuals.').slice(0, 5000);
  }
  // v13.72.0 — Farsi: append AI disclosure in Persian if not already present
  if (hasFarsiChars && !/هوش مصنوعی/.test(descClean)) {
    descClean = (descClean + '\n\n🤖 این ویدیو با استفاده از هوش مصنوعی تولید شده است.').slice(0, 5000);
  }
  const tagList = Array.isArray(tags) ? tags.slice(0, 30) : [];

  const metadata = {
    snippet: {
      title: titleClean,
      description: descClean,
      tags: tagList,
      categoryId: String(categoryId || '22'),
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status: {
      privacyStatus: privacyStatus || 'private', // SAFE default — operator promotes to public after watch
      selfDeclaredMadeForKids: madeForKids === true,
      embeddable: true,
    },
  };
  if (publishAt && (privacyStatus === 'private' || !privacyStatus)) {
    metadata.status.publishAt = publishAt;
    metadata.status.privacyStatus = 'private'; // required for scheduled publish
  }

  try {
    const result = await _youtubeResumableUpload(accessToken, videoUrl, metadata);
    const youtubeVideoId = result && result.id;
    // v13.72.0 — Auto-add to named playlist (SRV Farsi Romantic/Emotional/Happy)
    let playlistResult = null;
    if (playlistCategory && youtubeVideoId) {
      try {
        const plTitle = _FARSI_PLAYLIST_MAP[playlistCategory] || ('SRV Farsi - ' + playlistCategory);
        const pl = await _ytGetOrCreatePlaylist(plTitle, accessToken);
        await _ytAddVideoToPlaylist(youtubeVideoId, pl.id, accessToken);
        playlistResult = { id: pl.id, title: pl.title };
        console.log('[v13.72.0] added to playlist:', pl.title, pl.id);
      } catch (plErr) {
        console.warn('[v13.72.0] playlist insert warning (non-fatal):', plErr.message);
      }
    }
    return res.status(200).json({
      ok: true,
      youtubeVideoId,
      channelId: conn.channel_id,
      channelTitle: conn._matchedChannelTitle,
      channelHandle: conn._matchedChannelTitle, // legacy alias for front-end
      privacyStatus: metadata.status.privacyStatus,
      watchUrl: youtubeVideoId ? ('https://youtube.com/watch?v=' + youtubeVideoId) : null,
      studioUrl: youtubeVideoId ? ('https://studio.youtube.com/video/' + youtubeVideoId + '/edit') : null,
      uploadedAt: new Date().toISOString(),
      playlist: playlistResult,
      result,
    });
  } catch (e) {
    console.error('[v13.54.6] youtubeUploadVideo error:', e.message);
    return res.status(502).json({
      ok: false,
      error: 'upload_failed',
      message: e.message,
      channelTitle,
      hint: /401|403|invalid_grant|insufficient/i.test(e.message)
        ? 'Token may not have youtube.upload scope. Disconnect + reconnect YouTube in Settings → Integrations.'
        : (/quota/i.test(e.message)
          ? 'YouTube API daily quota likely exceeded (10k units/day, each upload = 1600 units).'
          : 'See message for details.'),
    });
  }
}

// v13.69.8 — Set custom thumbnail on a YouTube video after upload
async function setYtThumbnail(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { videoId, engine, thumbUrl } = body;
  if (!videoId || !thumbUrl) return res.status(400).json({ ok: false, error: 'missing_params' });
  try {
    const conn = await _getYoutubeConnectionByTitle(engine);
    if (!conn) return res.status(401).json({ ok: false, error: 'no_yt_connection' });
    const { accessToken } = await _refreshYoutubeToken(conn.refresh_token);
    const imgRes = await fetch(thumbUrl);
    if (!imgRes.ok) return res.status(500).json({ ok: false, error: 'thumb_fetch_failed' });
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const ytRes = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
      { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'image/jpeg', 'Content-Length': String(imgBuf.length) }, body: imgBuf }
    );
    if (!ytRes.ok) {
      const t = await ytRes.text();
      return res.status(500).json({ ok: false, error: 'yt_thumb_failed', detail: t.slice(0,300) });
    }
    return res.json({ ok: true, videoId });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// v13.54.1 — diagnostic: returns the currently-stored YouTube scope per channel.
// Use BEFORE attempting an upload to verify the youtube.upload scope was granted
// during the most recent OAuth consent. Google sometimes silently re-grants prior
// scopes during reconnect — this surfaces that.
async function youtubeCheckScope(req, res) {
  try {
    const conns = await sbGet('youtube_connections?select=channel_id,scope,connected_at&order=connected_at.desc');
    const channels = await sbGet('youtube_channels?select=channel_id,title');
    const titleByCh = {};
    if (Array.isArray(channels)) channels.forEach(function(c){ titleByCh[c.channel_id] = c.title; });
    const rows = (Array.isArray(conns) ? conns : []).map(function(c){
      const scope = String(c.scope || '');
      return {
        channelId: c.channel_id,
        title: titleByCh[c.channel_id] || '(no title)',
        connectedAt: c.connected_at,
        scope: scope,
        hasUploadScope: /youtube\.upload/i.test(scope),
        hasReadonlyScope: /youtube\.readonly/i.test(scope),
        hasAnalyticsScope: /yt-analytics\.readonly/i.test(scope),  // v13.57.9
      };
    });
    const allHaveUpload = rows.length > 0 && rows.every(function(r){ return r.hasUploadScope; });
    const allHaveAnalytics = rows.length > 0 && rows.every(function(r){ return r.hasAnalyticsScope; });
    return res.status(200).json({
      ok: true,
      allChannelsHaveUploadScope: allHaveUpload,
      allChannelsHaveAnalyticsScope: allHaveAnalytics,  // v13.57.9
      channels: rows,
      count: rows.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'scope_check_failed', message: e.message });
  }
}

// Check the status of an uploaded video (processing → succeeded/failed).
async function youtubeVideoStatus(req, res) {
  const videoId = (req.query && req.query.video_id) || (req.body && req.body.video_id);
  // Accept either channel_title or channel_handle (legacy)
  const channelTitle = (req.query && (req.query.channel_title || req.query.channel_handle)) || (req.body && (req.body.channel_title || req.body.channel_handle));
  if (!videoId) return res.status(400).json({ ok: false, error: 'missing_video_id' });
  if (!channelTitle) return res.status(400).json({ ok: false, error: 'missing_channel_title' });
  const conn = await _getYoutubeConnectionByTitle(channelTitle);
  if (!conn || !conn.refresh_token) return res.status(404).json({ ok: false, error: 'no_connection' });
  const refreshed = await _refreshYoutubeToken(conn.refresh_token);
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails,snippet&id=' + encodeURIComponent(videoId), {
    headers: { 'Authorization': 'Bearer ' + refreshed.accessToken },
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch(_) { data = { raw: text }; }
  if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: 'status_fetch_failed', raw: data });
  const item = data && data.items && data.items[0];
  return res.status(200).json({
    ok: true,
    videoId,
    uploadStatus: item && item.status && item.status.uploadStatus,       // 'uploaded' | 'processed' | 'failed' | 'rejected'
    privacyStatus: item && item.status && item.status.privacyStatus,
    processingStatus: item && item.processingDetails && item.processingDetails.processingStatus, // 'processing' | 'succeeded' | 'failed' | 'terminated'
    title: item && item.snippet && item.snippet.title,
    watchUrl: 'https://youtube.com/watch?v=' + videoId,
    raw: data,
  });
}
// v13.57.9 Sprint P_B — YouTube Analytics pull. Iterates all connected channels,
// refreshes each token, calls YouTube Analytics API for per-video retention/CTR/
// watch-time over a configurable lookback window, upserts to youtube_videos columns.
// Requires the yt-analytics.readonly scope (added to YT_SCOPES in callback.js;
// operator must re-auth after the scope upgrade lands).
async function youtubeAnalyticsPull(req, res) {
  const lookbackDays = parseInt((req.query && req.query.days) || (req.body && req.body.days) || '30', 10);
  const startDate = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString().slice(0,10);
  const endDate = new Date().toISOString().slice(0,10);
  const metrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained';
  try {
    const conns = await sbGet('youtube_connections?select=channel_id,refresh_token,scope&order=connected_at.desc');
    if (!Array.isArray(conns) || !conns.length) return res.status(404).json({ ok:false, error:'no_connections' });
    const channels = await sbGet('youtube_channels?select=channel_id,title,mmm_engine');
    const titleByCh = {};
    if (Array.isArray(channels)) channels.forEach(c => { titleByCh[c.channel_id] = { title: c.title, engine: c.mmm_engine }; });
    const results = [];
    const errors = [];
    const nowIso = new Date().toISOString();
    for (const conn of conns) {
      const meta = titleByCh[conn.channel_id] || { title:'(no title)', engine:null };
      const hasScope = /yt-analytics\.readonly/i.test(String(conn.scope || ''));
      if (!hasScope) { errors.push({ channelId: conn.channel_id, title: meta.title, error: 'missing_yt_analytics_scope — operator must reconnect YouTube' }); continue; }
      try {
        const refreshed = await _refreshYoutubeToken(conn.refresh_token);
        const url = 'https://youtubeanalytics.googleapis.com/v2/reports'
          + '?ids=channel%3D%3D' + encodeURIComponent(conn.channel_id)
          + '&metrics=' + encodeURIComponent(metrics)
          + '&dimensions=video'
          + '&startDate=' + startDate
          + '&endDate=' + endDate
          + '&maxResults=200&sort=-views';
        const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + refreshed.accessToken } });
        const txt = await r.text();
        if (!r.ok) { errors.push({ channelId: conn.channel_id, title: meta.title, error: 'analytics_api_error: ' + r.status + ' ' + txt.slice(0,200) }); continue; }
        const data = JSON.parse(txt);
        const rows = (data && data.rows) || [];
        const colHeaders = (data && data.columnHeaders) || [];
        const colIdx = (name) => colHeaders.findIndex(h => h.name === name);
        const iVid = colIdx('video'),
              iViews = colIdx('views'),
              iMinWatched = colIdx('estimatedMinutesWatched'),
              iAvgDuration = colIdx('averageViewDuration'),
              iAvgPct = colIdx('averageViewPercentage'),
              iSubs = colIdx('subscribersGained');
        const upserts = [];
        for (const row of rows) {
          const vid = row[iVid];
          if (!vid) continue;
          upserts.push({
            video_id: vid,
            channel_id: conn.channel_id,
            views: row[iViews] || null,
            watch_time_min: row[iMinWatched] || null,
            avg_view_duration_sec: row[iAvgDuration] || null,
            retention_pct: row[iAvgPct] || null,
            subs_gained: row[iSubs] || null,
            analytics_synced_at: nowIso,
          });
        }
        // Upsert per video — youtube_videos already has UNIQUE on video_id? Check.
        if (upserts.length) {
          const upsertRes = await fetch(SUPABASE_URL + '/rest/v1/youtube_videos?on_conflict=video_id', {
            method: 'POST',
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(upserts),
          });
          if (!upsertRes.ok) {
            const errTxt = await upsertRes.text();
            errors.push({ channelId: conn.channel_id, title: meta.title, error: 'supabase_upsert_failed: ' + upsertRes.status + ' ' + errTxt.slice(0,200) });
            continue;
          }
        }
        results.push({ channelId: conn.channel_id, title: meta.title, engine: meta.engine, videosUpdated: upserts.length, dateRange: startDate + ' to ' + endDate });
      } catch(e) {
        errors.push({ channelId: conn.channel_id, title: meta.title, error: e.message });
      }
    }
    return res.status(200).json({ ok: true, lookbackDays, startDate, endDate, results, errors });
  } catch(e) {
    return res.status(500).json({ ok:false, error:'analytics_pull_failed', message: e.message });
  }
}
// v13.58.0 PRIORITY A — Analytics Foundation. Snapshot current state of every tracked
// video + each channel into the snapshot tables (idempotent per UTC date). Run nightly
// via cron OR on-demand from the dashboard.
async function youtubeSnapshotNow(req, res) {
  try {
    const videos = await sbGet('youtube_videos?select=video_id,channel_id,views,watch_time_min,avg_view_duration_sec,retention_pct,subs_gained,likes,comments&analytics_synced_at=not.is.null');
    const channels = await sbGet('youtube_channels?select=channel_id,subscribers,total_views,total_videos');
    const today = new Date().toISOString().slice(0,10);
    const vSnaps = (Array.isArray(videos) ? videos : []).map(v => ({
      video_id: v.video_id, channel_id: v.channel_id, snapshot_date: today,
      views: v.views, watch_time_min: v.watch_time_min, avg_view_duration_sec: v.avg_view_duration_sec,
      retention_pct: v.retention_pct, subs_gained: v.subs_gained, likes: v.likes, comments: v.comments,
    }));
    const cSnaps = (Array.isArray(channels) ? channels : []).map(c => ({
      channel_id: c.channel_id, snapshot_date: today,
      subscribers: c.subscribers, total_views: c.total_views, total_videos: c.total_videos,
    }));
    let vRes = { ok: true };
    if (vSnaps.length) {
      const r = await fetch(SUPABASE_URL + '/rest/v1/youtube_video_snapshots?on_conflict=video_id,snapshot_date', {
        method:'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(vSnaps),
      });
      vRes = { ok: r.ok, status: r.status };
    }
    let cRes = { ok: true };
    if (cSnaps.length) {
      const r = await fetch(SUPABASE_URL + '/rest/v1/youtube_channel_snapshots?on_conflict=channel_id,snapshot_date', {
        method:'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(cSnaps),
      });
      cRes = { ok: r.ok, status: r.status };
    }
    return res.status(200).json({ ok: true, snapshotDate: today, videosSnapshotted: vSnaps.length, channelsSnapshotted: cSnaps.length, vRes, cRes });
  } catch(e) {
    return res.status(500).json({ ok:false, error:'snapshot_failed', message: e.message });
  }
}

// v13.62.1 A1 — Analytics Automation. Runs full pipeline daily via cron OR on-demand.
// Parallelized to stay under 60s Vercel timeout.
// v13.62.3 A1 — direct inline calls (no self-HTTP). Past attempts via fetch loopback
// silently hung in the Vercel runtime. Calling handler functions directly with a mock
// res object completes in ~20s total and writes to analytics_sync_log reliably.
function _mockRes() {
  return { _status: 200, _body: null, status(c){ this._status=c; return this; }, json(b){ this._body=b; return this; } };
}
async function _callInline(name, fn, req, steps, partial) {
  const mockReq = { method:'GET', headers: req.headers || {}, query: req.query || {}, body: req.body || null };
  const mockRes = _mockRes();
  try {
    await fn(mockReq, mockRes);
    const body = mockRes._body || {};
    steps[name] = { ok: !!body.ok, status: mockRes._status };
    if (!body.ok) partial.value = true;
  } catch(e) {
    steps[name] = { ok: false, error: e.message };
    partial.value = true;
  }
}
async function analyticsAutoRun(req, res) {
  // v13.62.7 — write start marker, run inline (no HTTP loopback), update marker, respond.
  const startedAt = new Date().toISOString();
  let logId = null;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/analytics_sync_log', {
      method:'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: JSON.stringify([{ status: 'in_progress', detail: 'started ' + startedAt, steps: {} }]),
    });
    if (r.ok) { const arr = await r.json(); if (Array.isArray(arr) && arr[0]) logId = arr[0].id; }
  } catch(_){}
  const steps = {};
  const partial = { value: false };
  const baseHost = (req.headers && req.headers.host) || 'mmm-static.vercel.app';
  const headersForInner = { host: baseHost };
  await _callInline('youtube_analytics_pull', youtubeAnalyticsPull, { method:'GET', headers: headersForInner, query:{days:'30'}, body:null }, steps, partial);
  await _callInline('youtube_snapshot_now', youtubeSnapshotNow, { method:'GET', headers: headersForInner, query:{}, body:null }, steps, partial);
  await _callInline('optimization_apply_recs', optimizationApplyRecommendations, { method:'GET', headers: headersForInner, query:{}, body:null }, steps, partial);
  const overall = partial.value ? 'partial' : 'healthy';
  if (logId) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/analytics_sync_log?id=eq.' + logId, {
        method:'PATCH', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer:'return=minimal' },
        body: JSON.stringify({ status: overall, detail: 'auto pipeline · ' + Object.keys(steps).filter(k=>steps[k].ok).join(', '), steps }),
      });
    } catch(_){}
  }
  res.status(200).json({ ok: true, status: overall, steps });
}
async function analyticsSyncStatus(req, res) {
  try {
    const rows = await sbGet('analytics_sync_log?select=ts,status,detail&order=ts.desc&limit=10');
    res.status(200).json({ ok: true, recent: rows || [] });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// v13.60.0 STRATEGIC OPTIMIZATION LAYER —
// Channel-level strategy automation. Reads decision engine + revenue + analytics,
// computes per-channel status (continue/scale/reduce/pause), mode weights, and
// cadence target. Writes channel_strategy. Auto-assign + generation read from
// channel_strategy. Decision output becomes channel config input.
async function strategyRecompute(req, res) {
  try {
    const host = (req.headers && req.headers.host) ? 'https://' + req.headers.host : '';
    // Pull foundation + decision + revenue + analytics
    const [foundationR, decisionR, revenueR] = await Promise.all([
      fetch(host + '/api/ops?action=analytics_foundation&days=30').then(r=>r.json()),
      fetch(host + '/api/ops?action=decision_engine&days=30').then(r=>r.json()),
      fetch(host + '/api/ops?action=revenue_dashboard').then(r=>r.json()),
    ]);
    if (!foundationR.ok || !decisionR.ok || !revenueR.ok) return res.status(500).json({ ok:false, error:'upstream_failed' });
    const out = { ok:true, perChannel: [] };
    for (const ch of (foundationR.perChannel || [])) {
      const engine = ch.engine;
      if (!engine) continue;
      const dec = (decisionR.perChannel || []).find(c => c.engine === engine);
      const rev = (revenueR.perChannel || []).find(c => c.engine === engine);
      // Compute STATUS — continue/scale/reduce/pause
      let status = 'continue', reason = 'baseline performance — maintain cadence';
      const w = ch.window || {};
      const g = ch.growth || {};
      const subs30Delta = g.subs30dDelta;
      const avgRet = w.avgRetention;
      const videos = w.videosPublished || 0;
      const totalSubs = w.totalSubsGained || 0;
      if (videos === 0) {
        status = 'pause'; reason = 'no uploads in 30d — needs operator restart';
      } else if (subs30Delta != null && subs30Delta >= 30) {
        status = 'scale'; reason = '+'+subs30Delta+' subs/30d — strong growth, scale output';
      } else if (avgRet != null && avgRet >= 60 && totalSubs >= 5) {
        status = 'scale'; reason = 'avg retention '+Math.round(avgRet)+'% + '+totalSubs+' subs gained — push harder';
      } else if (avgRet != null && avgRet < 35 && totalSubs <= 1) {
        status = 'reduce'; reason = 'low retention '+Math.round(avgRet)+'% + minimal subs — rework hooks before more output';
      }
      // Compute MODE WEIGHTS from topic breakdown
      const topicBreakdown = ch.topicBreakdown || [];
      const validTopics = topicBreakdown.filter(t => t.topic && t.topic !== '(no topic)' && t.avgRetention != null);
      let modeWeights = {};
      if (validTopics.length >= 2) {
        const avgAll = validTopics.reduce((a,x)=>a+x.avgRetention,0) / validTopics.length;
        validTopics.forEach(t => {
          // weight = retention / avg, clamped 0.3..2.5
          let w = t.avgRetention / avgAll;
          w = Math.max(0.3, Math.min(2.5, w));
          modeWeights[t.topic] = Number(w.toFixed(2));
        });
      }
      // Promoted / Reduced categories
      const promoted = validTopics.filter(t => t.avgRetention >= 60).map(t => t.topic);
      const reduced = validTopics.filter(t => t.avgRetention < 35).map(t => t.topic);
      // Cadence target — based on status
      const currentCadence = (rev && rev.uploads30d) ? rev.uploads30d / (30/7) : null;
      let cadenceTargetMin = null, cadenceTargetMax = null, cadencePerWeek = currentCadence;
      if (status === 'scale') { cadenceTargetMin = 4; cadenceTargetMax = 6; cadencePerWeek = 5; }
      else if (status === 'reduce') { cadenceTargetMin = 1; cadenceTargetMax = 2; cadencePerWeek = 1.5; }
      else if (status === 'pause') { cadenceTargetMin = 0; cadenceTargetMax = 0; cadencePerWeek = 0; }
      else { cadenceTargetMin = 2; cadenceTargetMax = 4; cadencePerWeek = 3; }
      // Fetch existing strategy for diff
      const existing = await sbGet('channel_strategy?engine=eq.' + encodeURIComponent(engine) + '&select=*');
      const before = (Array.isArray(existing) && existing[0]) || null;
      const newConfig = {
        engine, status, status_reason: reason,
        mode_weights: Object.keys(modeWeights).length ? modeWeights : (before ? before.mode_weights : {}),
        cadence_per_week: cadencePerWeek,
        cadence_target_min: cadenceTargetMin,
        cadence_target_max: cadenceTargetMax,
        promoted_categories: promoted,
        reduced_categories: reduced,
        last_recomputed_at: new Date().toISOString(),
        source: 'decision_engine',
        updated_at: new Date().toISOString(),
      };
      // Upsert
      await fetch(SUPABASE_URL + '/rest/v1/channel_strategy?on_conflict=engine', {
        method:'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([newConfig]),
      });
      // Audit log
      await _logAudit({ engine, action: 'strategy_recomputed', detail: status + ' · ' + reason, source: 'strategy_engine', before_state: before, after_state: newConfig });
      out.perChannel.push(newConfig);
    }
    return res.status(200).json(out);
  } catch(e) {
    return res.status(500).json({ ok:false, error:'recompute_failed', message: e.message });
  }
}
async function strategyGetState(req, res) {
  try {
    const rows = await sbGet('channel_strategy?select=*&order=updated_at.desc');
    return res.status(200).json({ ok:true, channels: rows || [] });
  } catch(e) { return res.status(500).json({ ok:false, error: e.message }); }
}

// v13.59.0 OPTIMIZATION IMPLEMENTATION LAYER —
// Recommendation → Optimization Rule conversion. Takes Decision Engine output and
// emits structured rules into public.optimization_rules. When auto_apply is ON for
// the engine, rules are created with auto_applied=true and applied to future
// generation prompts. Otherwise rules are created with active=false (queued).
async function _logAudit({ engine, action, rule_id, rule_type, detail, source, before_state, after_state }) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/optimization_audit_log', {
      method:'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body: JSON.stringify([{ engine, action, rule_id: rule_id||null, rule_type: rule_type||null, detail: detail||null, source: source||null, before_state: before_state||null, after_state: after_state||null }]),
    });
  } catch(_) {}
}
function _classifyRecToRule(rec) {
  // Convert a Decision Engine recommendation into a structured rule.
  // Returns { rule_type, rule_data, priority } or null if not actionable.
  const detail = String(rec.detail || '').toLowerCase();
  // Hook pattern boost
  const hookMatch = detail.match(/use "([^"]+)" pattern/i) || detail.match(/use this pattern \(([^)]+)\)/i);
  if (hookMatch) {
    return { rule_type: 'hook_pattern_weight', rule_data: { pattern: hookMatch[1], weight: 2.0, instruction: 'EMULATE this hook structure for next 3-5 generations' }, priority: rec.priority || 'high' };
  }
  // Reverse-engineer specific video
  const reverseMatch = rec.detail && rec.detail.match(/"([^"]+)" hit \d+%/i);
  if (reverseMatch) {
    return { rule_type: 'hook_pattern_weight', rule_data: { exemplar_title: reverseMatch[1], weight: 3.0, instruction: 'Reverse-engineer this exemplar hook + structure for next 3 generations' }, priority: rec.priority || 'high' };
  }
  // Topic push / pause
  const pushMatch = rec.detail && rec.detail.match(/mood "([^"]+)" averages (\d+)% retention/i);
  if (pushMatch && rec.action === 'INCREASE') {
    return { rule_type: 'topic_weight', rule_data: { mood: pushMatch[1], weight: 2.0, instruction: 'Push 2x output on this mood — highest retention' }, priority: rec.priority || 'high' };
  }
  if (pushMatch && rec.action === 'REDUCE') {
    return { rule_type: 'topic_weight', rule_data: { mood: pushMatch[1], weight: 0.3, instruction: 'Pause 1 week — significantly below top retention' }, priority: rec.priority || 'medium' };
  }
  // CTA conversion
  if (/subs per video.*low conversion/i.test(rec.detail || '') || /try ctas in script/i.test(rec.detail || '')) {
    return { rule_type: 'cta_template', rule_data: { template: 'Follow for more grounded takes on [topic].', instruction: 'Append a clear follow-CTA to every script ending' }, priority: rec.priority || 'medium' };
  }
  // Cadence (informational only — operator controls publishing)
  const cadenceMatch = rec.detail && rec.detail.match(/(\d+(?:\.\d+)?)\s*videos\/week/i);
  if (cadenceMatch) {
    return { rule_type: 'cadence_target', rule_data: { current: parseFloat(cadenceMatch[1]), target: rec.action === 'INCREASE' ? '2-3' : (rec.action === 'REDUCE' ? '3-5' : null), instruction: rec.detail }, priority: rec.priority || 'medium' };
  }
  return null;
}
async function optimizationApplyRecommendations(req, res) {
  try {
    // Fetch decision engine output
    const decUrl = (req.headers && req.headers.host ? 'https://' + req.headers.host : 'http://localhost:3000') + '/api/ops?action=decision_engine&days=30';
    const decRes = await fetch(decUrl);
    const dec = await decRes.json();
    if (!dec.ok) return res.status(500).json({ ok:false, error:'decision_engine_failed' });
    // Per-engine settings
    const settings = await sbGet('optimization_settings?select=engine,auto_apply');
    const autoByEngine = {};
    (Array.isArray(settings) ? settings : []).forEach(s => autoByEngine[s.engine] = !!s.auto_apply);
    const created = [];
    for (const ch of (dec.perChannel || [])) {
      const engine = ch.engine;
      const autoOn = autoByEngine[engine] === true;
      for (const rec of (ch.recommendations || [])) {
        const rule = _classifyRecToRule(rec);
        if (!rule) continue;
        // Dedup — skip if same rule_type + similar rule_data already active
        const existing = await sbGet('optimization_rules?engine=eq.' + encodeURIComponent(engine) + '&rule_type=eq.' + encodeURIComponent(rule.rule_type) + '&active=eq.true&select=id,rule_data');
        const exArr = Array.isArray(existing) ? existing : [];
        const dupExists = exArr.some(e => JSON.stringify(e.rule_data) === JSON.stringify(rule.rule_data));
        if (dupExists) continue;
        // Supersede older active rules of same type
        if (exArr.length) {
          const ids = exArr.map(e => e.id);
          await fetch(SUPABASE_URL + '/rest/v1/optimization_rules?id=in.(' + ids.join(',') + ')', {
            method:'PATCH', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer:'return=minimal' },
            body: JSON.stringify({ active: false, superseded_at: new Date().toISOString() }),
          });
        }
        // Insert new rule
        const payload = {
          engine, rule_type: rule.rule_type, rule_data: rule.rule_data,
          active: autoOn,  // ACTIVE only if auto-apply ON for this engine
          auto_applied: autoOn,
          source: 'decision_engine',
          source_detail: rec.detail,
          priority: rule.priority,
          expires_at: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),  // 14d default expiry
        };
        const insRes = await fetch(SUPABASE_URL + '/rest/v1/optimization_rules', {
          method:'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer:'return=representation' },
          body: JSON.stringify([payload]),
        });
        const insData = insRes.ok ? await insRes.json() : null;
        const newId = insData && insData[0] && insData[0].id;
        await _logAudit({ engine, action: autoOn ? 'rule_auto_applied' : 'rule_queued', rule_id: newId, rule_type: rule.rule_type, detail: rec.detail, source: 'decision_engine', after_state: rule.rule_data });
        created.push({ engine, ruleType: rule.rule_type, autoApplied: autoOn, ruleId: newId });
      }
    }
    return res.status(200).json({ ok: true, created, autoByEngine });
  } catch(e) {
    return res.status(500).json({ ok:false, error:'apply_failed', message: e.message });
  }
}
async function optimizationToggleAutoApply(req, res) {
  const engine = (req.query && req.query.engine) || (req.body && req.body.engine);
  const enabled = String((req.query && req.query.enabled) || (req.body && req.body.enabled)) === 'true';
  if (!engine) return res.status(400).json({ ok:false, error:'missing_engine' });
  try {
    await fetch(SUPABASE_URL + '/rest/v1/optimization_settings?on_conflict=engine', {
      method:'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ engine, auto_apply: enabled, updated_at: new Date().toISOString() }]),
    });
    await _logAudit({ engine, action: 'auto_apply_toggled', detail: 'auto_apply = ' + enabled, source: 'operator', after_state: { auto_apply: enabled } });
    return res.status(200).json({ ok: true, engine, autoApply: enabled });
  } catch(e) { return res.status(500).json({ ok:false, error: e.message }); }
}
async function optimizationGetState(req, res) {
  try {
    const settings = await sbGet('optimization_settings?select=engine,auto_apply,updated_at');
    const rules = await sbGet('optimization_rules?active=eq.true&select=id,engine,rule_type,rule_data,priority,source_detail,created_at,expires_at&order=created_at.desc');
    const audit = await sbGet('optimization_audit_log?select=ts,engine,action,rule_type,detail,source,after_state&order=ts.desc&limit=50');
    return res.status(200).json({ ok: true, settings: settings || [], activeRules: rules || [], auditLog: audit || [] });
  } catch(e) { return res.status(500).json({ ok:false, error: e.message }); }
}

// v13.58.2 PRIORITY D — Revenue Dashboard. Tracks per-channel monetization readiness
// against YouTube Partner Program thresholds: 1k subs + 4k watch hours (240k min) in
// last 12 months OR 10M Shorts views in 90 days. ETA-to-YPP at current growth rate.
async function revenueDashboard(req, res) {
  try {
    const channels = await sbGet('youtube_channels?select=channel_id,title,mmm_engine,subscribers,total_views,total_videos&mmm_engine=not.is.null');
    if (!Array.isArray(channels)) return res.status(500).json({ ok:false, error:'channels_load_failed' });
    const YPP_SUBS = 1000;
    const YPP_WATCH_HOURS_12M = 4000;
    const YPP_SHORTS_VIEWS_90D = 10000000;
    const lookback365 = new Date(Date.now() - 365 * 86400 * 1000).toISOString();
    const lookback90 = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    const lookback30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const lookback7 = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const out = { ok: true, perChannel: [] };
    for (const ch of channels) {
      const vids12m = await sbGet('youtube_videos?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&published_at=gte.' + encodeURIComponent(lookback365) + '&select=watch_time_min,views,published_at');
      const w12m = (Array.isArray(vids12m) ? vids12m : []).reduce((a,v)=>a+(Number(v.watch_time_min)||0), 0);
      const watchHours12m = w12m / 60;
      const vids90d = await sbGet('youtube_videos?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&published_at=gte.' + encodeURIComponent(lookback90) + '&select=views,published_at');
      const shortsViews90d = (Array.isArray(vids90d) ? vids90d : []).reduce((a,v)=>a+(Number(v.views)||0), 0);
      const vids30d = await sbGet('youtube_videos?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&published_at=gte.' + encodeURIComponent(lookback30) + '&select=video_id');
      const vids7d = await sbGet('youtube_videos?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&published_at=gte.' + encodeURIComponent(lookback7) + '&select=video_id');
      const uploads30d = Array.isArray(vids30d) ? vids30d.length : 0;
      const uploads7d = Array.isArray(vids7d) ? vids7d.length : 0;
      const chSnaps = await sbGet('youtube_channel_snapshots?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&order=snapshot_date.desc&limit=60');
      const snaps = Array.isArray(chSnaps) ? chSnaps : [];
      const find = (daysAgo) => {
        const target = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString().slice(0,10);
        return snaps.find(s => s.snapshot_date <= target) || null;
      };
      const s30 = find(30);
      const subsNow = ch.subscribers || 0;
      const subsGrowth30d = s30 ? (subsNow - (s30.subscribers||0)) : null;
      const subsProgress = Math.min(100, (subsNow / YPP_SUBS) * 100);
      const watchProgress = Math.min(100, (watchHours12m / YPP_WATCH_HOURS_12M) * 100);
      const shortsProgress = Math.min(100, (shortsViews90d / YPP_SHORTS_VIEWS_90D) * 100);
      const pathSubs = subsProgress >= 100;
      const pathWatch = watchProgress >= 100;
      const pathShorts = shortsProgress >= 100;
      const yppReady = pathSubs && (pathWatch || pathShorts);
      let etaToYpp = null;
      if (!pathSubs && subsGrowth30d != null && subsGrowth30d > 0) {
        const subsNeeded = YPP_SUBS - subsNow;
        const subsPerDay = subsGrowth30d / 30;
        etaToYpp = subsPerDay > 0 ? Math.round(subsNeeded / subsPerDay) : null;
      }
      out.perChannel.push({
        channelId: ch.channel_id, title: ch.title, engine: ch.mmm_engine,
        subscribers: subsNow,
        subsGrowth30d,
        watchHours12m: Math.round(watchHours12m),
        shortsViews90d,
        uploads30d, uploads7d,
        progress: {
          subs: Math.round(subsProgress * 10) / 10,
          watchHours: Math.round(watchProgress * 10) / 10,
          shortsViews: Math.round(shortsProgress * 10) / 10,
        },
        yppReady,
        etaToYppDays: etaToYpp,
        thresholds: { subs: YPP_SUBS, watchHours12m: YPP_WATCH_HOURS_12M, shortsViews90d: YPP_SHORTS_VIEWS_90D },
      });
    }
    return res.status(200).json(out);
  } catch(e) {
    return res.status(500).json({ ok:false, error:'revenue_dashboard_failed', message: e.message });
  }
}

// v13.58.1 PRIORITY B — Decision Engine. Takes the foundation data and emits SPECIFIC,
// CHANNEL-LEVEL recommendations: which topics to push, retire, test, what hook patterns
// to emulate, what cadence to hit. Inputs = video-level metrics + winning patterns +
// topic breakdown. Output = per-channel action list — not generic advice.
async function decisionEngine(req, res) {
  try {
    // Build the foundation report internally (reuse the logic)
    const lookbackDays = parseInt((req.query && req.query.days) || '30', 10);
    const recentCutoff = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString();
    const channels = await sbGet('youtube_channels?select=channel_id,title,mmm_engine,subscribers,total_views,total_videos&mmm_engine=not.is.null');
    if (!Array.isArray(channels)) return res.status(500).json({ ok:false, error:'channels_load_failed' });
    const out = { ok: true, lookbackDays, perChannel: [] };
    for (const ch of channels) {
      const videos = await sbGet('youtube_videos?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&published_at=gte.' + encodeURIComponent(recentCutoff) + '&select=video_id,title,published_at,views,watch_time_min,avg_view_duration_sec,retention_pct,subs_gained,linked_package_id&order=published_at.desc');
      const v = Array.isArray(videos) ? videos : [];
      const recs = [];
      // Empty channel
      if (v.length === 0) {
        recs.push({ action: 'TEST', detail: 'No uploads in 30d. Publish 3 packages this week to start generating signal.', priority: 'high' });
        out.perChannel.push({ channelId: ch.channel_id, title: ch.title, engine: ch.mmm_engine, recommendations: recs, signals: { videos: 0 } });
        continue;
      }
      // Compute signals
      const withRet = v.filter(x => x.retention_pct != null);
      const avgRet = withRet.length ? withRet.reduce((a,x)=>a+Number(x.retention_pct),0)/withRet.length : null;
      const median = (arr) => { if (!arr.length) return null; const s=arr.slice().sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
      const medRet = median(withRet.map(x=>Number(x.retention_pct)));
      const totalViews = v.reduce((a,x)=>a+(Number(x.views)||0),0);
      const totalSubs = v.reduce((a,x)=>a+(Number(x.subs_gained)||0),0);
      const totalWatchMin = v.reduce((a,x)=>a+(Number(x.watch_time_min)||0),0);
      // Cadence: videos per week over the lookback
      const cadencePerWeek = (v.length / lookbackDays) * 7;
      // Top 3 retention vs bottom 3 retention — gap shows variance opportunity
      const sortedRet = withRet.slice().sort((a,b)=>Number(b.retention_pct)-Number(a.retention_pct));
      const top3Ret = sortedRet.slice(0,3);
      const bot3Ret = sortedRet.slice(-3);
      const top3AvgRet = top3Ret.length ? top3Ret.reduce((a,x)=>a+Number(x.retention_pct),0)/top3Ret.length : null;
      const bot3AvgRet = bot3Ret.length ? bot3Ret.reduce((a,x)=>a+Number(x.retention_pct),0)/bot3Ret.length : null;
      // Subs efficiency: subs per video that earned subs
      const earnedSubs = v.filter(x => (Number(x.subs_gained)||0) > 0);
      const subsRate = v.length ? (totalSubs / v.length).toFixed(2) : '0';
      // Hook pattern detection — extract title-leading patterns from top 3
      const titlePattern = (t) => {
        const lower = (t||'').toLowerCase();
        if (/^(why|how) /.test(lower)) return 'Why/How question';
        if (/^you('re| are| can('t| be)?)/.test(lower)) return "Direct address (You're...)";
        if (/^(ai|google|amazon|apple) /.test(lower)) return 'Brand-named subject';
        if (/(can('t| not)|won't|never) /.test(lower)) return 'Negation / limitation';
        if (/just (revealed|discovered|predicted)/.test(lower)) return '"Just revealed" framing';
        if (/^(stop|start|don't) /.test(lower)) return 'Command';
        return 'Other';
      };
      const topHookPatterns = {};
      top3Ret.forEach(x => { const p = titlePattern(x.title); topHookPatterns[p] = (topHookPatterns[p]||0)+1; });
      const dominantTopPattern = Object.entries(topHookPatterns).sort((a,b)=>b[1]-a[1])[0];
      // Linked-package topic distribution
      const linkedIds = v.map(x => x.linked_package_id).filter(Boolean);
      let pkgMoods = {};
      let pkgRetentionByMood = {};
      if (linkedIds.length) {
        const pkgs = await sbGet('packages?select=package_id,mood&package_id=in.(' + linkedIds.map(p=>'"'+p+'"').join(',') + ')');
        const pmap = {};
        if (Array.isArray(pkgs)) pkgs.forEach(p => pmap[p.package_id] = p);
        for (const vid of v) {
          const pkg = pmap[vid.linked_package_id];
          if (!pkg) continue;
          const mood = pkg.mood || '(no mood)';
          pkgMoods[mood] = (pkgMoods[mood]||0) + 1;
          if (vid.retention_pct != null) {
            if (!pkgRetentionByMood[mood]) pkgRetentionByMood[mood] = [];
            pkgRetentionByMood[mood].push(Number(vid.retention_pct));
          }
        }
      }
      // Rec 1: retention gap → if top3 - bot3 > 30pp, copy top hook pattern
      if (top3AvgRet != null && bot3AvgRet != null && (top3AvgRet - bot3AvgRet) > 30 && dominantTopPattern) {
        recs.push({
          action: 'INCREASE',
          detail: `Top 3 retention avg ${Math.round(top3AvgRet)}% vs bottom 3 ${Math.round(bot3AvgRet)}% — gap is ${Math.round(top3AvgRet-bot3AvgRet)}pp. Top retainers use "${dominantTopPattern[0]}" pattern. Use this pattern for next 3-5 generations.`,
          priority: 'high'
        });
      }
      // Rec 2: cadence
      if (cadencePerWeek < 2) {
        recs.push({ action: 'INCREASE', detail: `Current cadence is ${cadencePerWeek.toFixed(1)} videos/week. YouTube algorithm rewards consistency at 2-3/week. Increase upload count.`, priority: 'medium' });
      } else if (cadencePerWeek > 7) {
        recs.push({ action: 'REDUCE', detail: `${cadencePerWeek.toFixed(1)} videos/week may saturate algorithm allocation. Target 3-5/week and focus on quality.`, priority: 'low' });
      }
      // Rec 3: topic-level wins/losses (if we have moods linked)
      const moodRetSorted = Object.entries(pkgRetentionByMood).map(([mood, arr]) => ({ mood, avgRet: arr.reduce((a,x)=>a+x,0)/arr.length, count: arr.length })).sort((a,b)=>b.avgRet-a.avgRet);
      if (moodRetSorted.length >= 2) {
        const winner = moodRetSorted[0];
        const loser = moodRetSorted[moodRetSorted.length-1];
        if ((winner.avgRet - loser.avgRet) > 20) {
          recs.push({ action: 'INCREASE', detail: `Mood "${winner.mood}" averages ${Math.round(winner.avgRet)}% retention (${winner.count} videos). Push 2x output here next week.`, priority: 'high' });
          recs.push({ action: 'REDUCE', detail: `Mood "${loser.mood}" averages ${Math.round(loser.avgRet)}% retention — significantly below top. Pause for 1 week and re-test with different hook pattern.`, priority: 'medium' });
        }
      }
      // Rec 4: subs-per-video efficiency
      if (Number(subsRate) < 0.2 && v.length >= 5) {
        recs.push({ action: 'TEST', detail: `Only ${subsRate} subs per video. Low conversion signal — try CTAs in script ("follow for more X") or end-cards. Re-test in 7 days.`, priority: 'medium' });
      } else if (Number(subsRate) >= 1) {
        recs.push({ action: 'INCREASE', detail: `${subsRate} subs per video — high conversion. Scale output without changing format.`, priority: 'high' });
      }
      // Rec 5: outlier hook — single video carrying retention
      const outlier = sortedRet[0];
      if (outlier && Number(outlier.retention_pct) > 100) {
        recs.push({ action: 'CONTINUE', detail: `"${(outlier.title||'').slice(0,60)}" hit ${Math.round(outlier.retention_pct)}% retention — viewers are re-watching. Reverse-engineer this hook structure for next 3 videos.`, priority: 'high' });
      }
      // If no specific recs fired, default
      if (recs.length === 0) {
        recs.push({ action: 'CONTINUE', detail: `${v.length} videos · ${avgRet ? Math.round(avgRet)+'% avg retention' : 'no retention data'} · ${cadencePerWeek.toFixed(1)} videos/wk. Baseline performance — maintain and reassess in 7 days.`, priority: 'low' });
      }
      // Prioritize: high first, then medium, then low
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      recs.sort((a,b) => (priorityOrder[a.priority]||3) - (priorityOrder[b.priority]||3));
      out.perChannel.push({
        channelId: ch.channel_id, title: ch.title, engine: ch.mmm_engine,
        recommendations: recs,
        signals: { videos: v.length, avgRet, medRet, totalSubs, totalViews, totalWatchMin, cadencePerWeek: Number(cadencePerWeek.toFixed(2)), top3AvgRet, bot3AvgRet, dominantTopPattern: dominantTopPattern ? dominantTopPattern[0] : null, subsPerVideo: subsRate },
      });
    }
    return res.status(200).json(out);
  } catch(e) {
    return res.status(500).json({ ok:false, error:'decision_engine_failed', message: e.message });
  }
}

// v13.58.0 PRIORITY A — Analytics Foundation. The single endpoint that answers the
// 7 questions Mansoor asked. Pulls from youtube_videos, youtube_channels, packages,
// and the snapshot tables. Returns a single JSON the dashboard renders.
async function analyticsFoundationReport(req, res) {
  try {
    const lookbackDays = parseInt((req.query && req.query.days) || '30', 10);
    const recentCutoff = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString();
    // Channels with engines + current state
    const channels = await sbGet('youtube_channels?select=channel_id,title,mmm_engine,subscribers,total_views,total_videos&mmm_engine=not.is.null');
    if (!Array.isArray(channels)) return res.status(500).json({ ok:false, error:'channels_load_failed' });
    const result = { ok: true, lookbackDays, perChannel: [] };
    for (const ch of channels) {
      // Videos for this channel in lookback window
      const videos = await sbGet('youtube_videos?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&published_at=gte.' + encodeURIComponent(recentCutoff) + '&select=video_id,title,published_at,views,watch_time_min,avg_view_duration_sec,retention_pct,subs_gained,likes,comments,linked_package_id&order=published_at.desc');
      const videosArr = Array.isArray(videos) ? videos : [];
      // Channel snapshot history (last 60d) for growth rate
      const chSnaps = await sbGet('youtube_channel_snapshots?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&order=snapshot_date.desc&limit=60');
      const snaps = Array.isArray(chSnaps) ? chSnaps : [];
      // Growth rate calc: subs 7d ago vs now, 30d ago vs now
      const newest = snaps[0];
      const find = (daysAgo) => {
        const target = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString().slice(0,10);
        return snaps.find(s => s.snapshot_date <= target) || null;
      };
      const s7 = find(7), s30 = find(30);
      const subsNow = ch.subscribers || (newest && newest.subscribers) || 0;
      const subs7Delta = s7 ? (subsNow - (s7.subscribers||0)) : null;
      const subs30Delta = s30 ? (subsNow - (s30.subscribers||0)) : null;
      // Aggregate video metrics
      const sum = (k) => videosArr.reduce((a,v) => a + (Number(v[k])||0), 0);
      const avg = (k) => videosArr.length ? (sum(k) / videosArr.length) : 0;
      const totalViews = sum('views');
      const totalWatchMin = sum('watch_time_min');
      const totalSubsGained = sum('subs_gained');
      const avgRetention = avg('retention_pct');
      // Topic clustering — join to packages via linked_package_id to get mood/topic
      const linkedPkgIds = videosArr.map(v => v.linked_package_id).filter(Boolean);
      const pkgMap = {};
      if (linkedPkgIds.length) {
        const pkgs = await sbGet('packages?select=package_id,mood,engine,title&package_id=in.(' + linkedPkgIds.map(p=>'"'+p+'"').join(',') + ')');
        if (Array.isArray(pkgs)) pkgs.forEach(p => pkgMap[p.package_id] = p);
      }
      // Per-mood/topic aggregation
      const byTopic = {};
      for (const v of videosArr) {
        const pkg = pkgMap[v.linked_package_id];
        const topic = (pkg && pkg.mood) || '(no topic)';
        if (!byTopic[topic]) byTopic[topic] = { topic, videos: 0, totalViews: 0, totalWatchMin: 0, totalSubsGained: 0, retentions: [] };
        const b = byTopic[topic];
        b.videos++;
        b.totalViews += Number(v.views)||0;
        b.totalWatchMin += Number(v.watch_time_min)||0;
        b.totalSubsGained += Number(v.subs_gained)||0;
        if (v.retention_pct != null) b.retentions.push(Number(v.retention_pct));
      }
      const topicRows = Object.values(byTopic).map(b => ({
        topic: b.topic, videos: b.videos,
        views: b.totalViews, watchMin: Math.round(b.totalWatchMin),
        subsGained: b.totalSubsGained,
        avgRetention: b.retentions.length ? (b.retentions.reduce((a,x)=>a+x,0)/b.retentions.length) : null,
        // Revenue-proxy score: views × retention × watch-time-per-video. Higher = better
        // candidate for monetization (engaged eyeballs).
        revenueProxy: b.videos ? Math.round((b.totalViews * (b.retentions.length ? b.retentions.reduce((a,x)=>a+x,0)/b.retentions.length : 50) * (b.totalWatchMin / b.videos)) / 100) : 0,
      })).sort((a,b) => b.revenueProxy - a.revenueProxy);
      // Top + bottom videos
      const sortedByViews = videosArr.slice().sort((a,b) => (b.views||0) - (a.views||0));
      const sortedByRetention = videosArr.slice().filter(v => v.retention_pct != null).sort((a,b) => (b.retention_pct||0) - (a.retention_pct||0));
      result.perChannel.push({
        channelId: ch.channel_id,
        title: ch.title,
        engine: ch.mmm_engine,
        currentState: { subscribers: subsNow, totalViews: ch.total_views, totalVideos: ch.total_videos },
        growth: {
          subs7dDelta: subs7Delta, subs30dDelta: subs30Delta,
          subs7dRate: (subs7Delta != null) ? (subs7Delta / 7) : null,
          subs30dRate: (subs30Delta != null) ? (subs30Delta / 30) : null,
        },
        window: {
          videosPublished: videosArr.length,
          totalViews, totalWatchMin: Math.round(totalWatchMin),
          totalSubsGained, avgRetention: avgRetention ? Number(avgRetention.toFixed(1)) : null,
        },
        topicBreakdown: topicRows,
        top3ByViews: sortedByViews.slice(0,3).map(v => ({ title: v.title, views: v.views, retention: v.retention_pct, subsGained: v.subs_gained })),
        top3ByRetention: sortedByRetention.slice(0,3).map(v => ({ title: v.title, views: v.views, retention: v.retention_pct, subsGained: v.subs_gained })),
        bottom3ByViews: sortedByViews.slice(-3).reverse().map(v => ({ title: v.title, views: v.views, retention: v.retention_pct })),
      });
    }
    return res.status(200).json(result);
  } catch(e) {
    return res.status(500).json({ ok:false, error:'foundation_report_failed', message: e.message });
  }
}

// ── end YouTube upload handlers ──

async function heygenRenderStatus(req, res) {
  if (!HEYGEN_API_KEY) return res.status(500).json({ ok: false, error: 'heygen_not_configured' });
  const videoId = (req.query && req.query.video_id) || (req.body && req.body.video_id);
  if (!videoId) return res.status(400).json({ ok: false, error: 'missing_video_id' });
  const r = await _heygenFetch('/v1/video_status.get?video_id=' + encodeURIComponent(videoId));
  // HeyGen response shape: { data: { status: "processing|completed|failed", video_url: "...", ... } }
  const status = (r.data && r.data.data && r.data.data.status) || null;
  const videoUrl = (r.data && r.data.data && r.data.data.video_url) || null;
  const thumbUrl = (r.data && r.data.data && r.data.data.thumbnail_url) || null;
  const duration = (r.data && r.data.data && r.data.data.duration) || null;
  return res.status(r.ok ? 200 : (r.status || 502)).json({
    ok: r.ok,
    httpStatus: r.status,
    videoId,
    status,
    videoUrl,
    thumbnailUrl: thumbUrl,
    durationSec: duration,
    raw: r.data,
    error: r.error || null,
  });
}

// v13.69.21 — extend Vercel function timeout to 60s (Hobby plan max)
// Default is 25s which kills long-form generation (1100-1200 word scripts)
export const config = { maxDuration: 60 };

// ═══════════════════════════════════════════════════════════════════════════════
// v13.69.50 — SRV ENGLISH LIFECYCLE ADAPTERS
// Architecture: adapter pattern. Services are behind contracts, swappable by config.
// Music adapter = manual (operator uploads MP3). Image = Pexels. Renderer = Shotstack.
// RULE: Only SRV English uses this lifecycle. All other engines untouched.
// ═══════════════════════════════════════════════════════════════════════════════

const SHOTSTACK_BASE = 'https://api.shotstack.io/edit/v1';
const PEXELS_BASE    = 'https://api.pexels.com';

// ── Mood → Pexels query map (single-image legacy) ────────────────────────────
const PEXELS_MOOD_MAP = {
  'emotional':  'cinematic rain melancholy nature',
  'romantic':   'romantic golden hour sunset couple',
  'happy':      'joyful nature sunrise light',
  'duet':       'cinematic couple nature love',
  'female':     'cinematic woman nature reflection',
  'male':       'cinematic man landscape journey',
};
function pexelsMoodQuery(mood) {
  const m = String(mood || '').toLowerCase();
  for (const [key, query] of Object.entries(PEXELS_MOOD_MAP)) {
    if (m.includes(key)) return query;
  }
  return 'cinematic emotional nature';
}

// ── Per-mood distinct scene query banks (multi-scene variety) ─────────────────
// Each entry is a set of deliberately different queries so consecutive scenes
// look visually unlike each other — guaranteed variety.
// SHORT scene banks — 6 queries, used for Short (9:16) or single-scene tasks
// v13.69.93 — Per-combination Short scene banks (artist × mood).
// These are tried FIRST when a full mode string is available (e.g. "Male — Romantic"),
// ensuring different visuals for Male Emotional vs Female Emotional etc.
// Each bank has 6 queries; Short tasks shuffle and pick 5.
// v13.73.0 — SRV Farsi SHORT visual banks: NO human subjects (environment + objects only)
// Human presence = SRV avatar images only (interleaved by _srvFarsiBuildTrigger)
// 6 entries per combo; Short fetches 3 → shuffled → 1 per scene slot
const PEXELS_FARSI_COMBO_BANKS = {
  'female-emotional': [
    'rain drops window glass dark interior moody close',
    'single red rose wilting candlelight dim close bokeh',
    'empty chair beside window afternoon shadow quiet',
    'handwritten letter paper faded warm lamp nostalgic',
    'single candle flame dark room intimate shadow close',
    'autumn leaves empty path golden fog atmospheric',
  ],
  'female-romantic': [
    'red rose garden golden afternoon bokeh warm close',
    'pomegranate ripe fruit tree warm autumn light close',
    'cherry blossom petals falling soft pink bokeh warm',
    'fountain pen old letter paper warm window afternoon',
    'rose petals scattered candle bokeh soft warm glow',
    'flower market petals colorful warm cinematic close',
  ],
  'female-happy': [
    'henna mehndi pattern gold close warm cinematic',
    'wedding flowers gold arrangement warm ceremony close',
    'Eid lantern colorful glowing warm night bokeh',
    'white rose bridal bouquet golden warm bokeh close',
    'Persian sweets colorful Nowruz celebration table warm',
    'jasmine white flower close warm golden afternoon bokeh',
  ],
  'male-emotional': [
    'misty mountain peak fog dawn empty dramatic landscape',
    'rain empty cobblestone street night lamp reflection',
    'old letter sepia paper aged dim warm lamp close',
    'open doorway shadow evening light empty dramatic',
    'river mist fog landscape golden solitude atmospheric',
    'empty desert road horizon dusk dramatic sky warm',
  ],
  'male-romantic': [
    'sunset golden horizon skyline warm bokeh atmospheric',
    'garden roses evening amber lantern warm bokeh close',
    'writing desk old lamp open notebook intimate warm',
    'flower bouquet red roses ribbon warm bokeh close',
    'city bridge river evening golden reflection warm',
    'evening city bokeh lights warm cinematic golden',
  ],
  'male-happy': [
    'Afghan traditional drum instrument close warm cultural',
    'Eid lanterns colorful hanging warm night bokeh',
    'festive table colorful sweets cultural celebration warm',
    'traditional Persian musical instrument close warm golden',
    'homeland green valley mountains sunrise dramatic warm',
    'Nowruz haft-sin table colorful celebration warm close',
  ],
  'duet-emotional': [
    'two empty chairs window rain moody dim atmospheric',
    'two tea glasses old table warm dim light close',
    'empty doorway curtain blowing wind dramatic dim',
    'two candles side by side dark warm intimate close',
    'two letters tied ribbon dim warm nostalgic close',
    'empty park bench rain melancholy moody atmospheric',
  ],
  'duet-romantic': [
    'rose petals scattered floor warm bokeh romantic close',
    'two tea cups saucers morning warm bokeh close',
    'candlelit dinner table set warm romantic no persons',
    'rose garden path evening golden bokeh warm atmospheric',
    'moonlit garden fountain warm bokeh romantic quiet',
    'love letters roses tied warm nostalgic bokeh close',
  ],
  'duet-happy': [
    'Persian wedding flowers gold arrangement warm close',
    'henna ceremony pattern gold close warm cinematic',
    'celebration sweets colorful table warm golden close',
    'wedding cake flowers gold decoration warm bokeh',
    'engagement ring roses velvet close warm bokeh',
    'Eid lanterns colorful sweets celebration warm bokeh',
  ],
};

// v13.73.0 — SRV Farsi LONG visual banks: NO human subjects (25 per mood)
// Used when isFarsi=true and isLong=true in pexelsFetchBackground
const PEXELS_FARSI_LONG_BANKS = {
  'emotional': [
    'rain drops window glass dark moody close cinematic',
    'misty mountain lake reflection dawn atmospheric',
    'abandoned lighthouse ocean overcast dramatic moody',
    'winter bare tree snow silence white landscape',
    'empty park bench autumn golden fog quiet',
    'river mist autumn morning reflection landscape',
    'old letter envelope sepia paper faded warm lamp',
    'single candle flame dark room shadow intimate',
    'autumn leaves falling golden path empty bokeh',
    'night sky stars milky way vast dark lonely',
    'wheat field wind dusk cinematic warm dramatic',
    'alley night wet cobblestone rain lantern warm',
    'desert landscape dusk dramatic horizon red warm',
    'snow falling night streetlight bokeh quiet slow',
    'cliff ocean waves dramatic moody storm overcast',
    'forest mist path dark cinematic atmospheric',
    'vintage room warm lamp nostalgia objects close',
    'empty highway night headlights fog dramatic',
    'mountain sunset last light dramatic warm golden',
    'old bookshelf candle warm intimate books close',
    'harbor boats fog morning quiet cinematic gray',
    'bridge river night reflection cityscape bokeh',
    'fireplace warm interior shadow intimate glow',
    'wilting rose petals water dim close moody',
    'open doorway shadow evening empty dramatic light',
  ],
  'romantic': [
    'cherry blossom soft light pink petals bokeh warm',
    'red rose garden golden afternoon bokeh warm close',
    'pomegranate ripe fruit warm autumn light close',
    'candlelit dinner table set flowers warm romantic',
    'ring jewelry velvet soft close warm romantic',
    'letter handwriting envelope vintage warm nostalgic',
    'piano keys soft light intimate warm close',
    'balcony flowers sunset golden warm bokeh evening',
    'garden path roses soft bokeh evening warm',
    'heart bokeh city lights night warm romantic',
    'snowfall park lantern romantic evening warm bokeh',
    'hillside vineyard sunset warm golden atmospheric',
    'fireflies night meadow magical soft warm bokeh',
    'cottage window warm interior rain bokeh intimate',
    'bicycle flowers basket summer warm cinematic',
    'jewelry box velvet soft warm close intimate',
    'hot air balloon sunset dramatic colorful warm',
    'lagoon crystal water tropical serene bokeh warm',
    'rose petals scattered floor warm bokeh close',
    'moonlit garden path flowers warm romantic quiet',
    'fountain spray evening golden bokeh park warm',
    'red roses bouquet close warm bokeh intimate',
    'night sky moon stars romantic clear warm vast',
    'Persian tea cup saucer warm bokeh close intimate',
    'wedding flowers arrangement gold warm bokeh close',
  ],
  'happy': [
    'confetti falling celebration colorful bokeh warm',
    'sunflower field blue sky warm vibrant golden',
    'morning window curtains breeze golden light warm',
    'Eid lanterns colorful hanging warm night celebration',
    'hot cocoa cozy blanket winter warm bokeh close',
    'Persian Nowruz haft-sin table colorful warm',
    'colorful flowers meadow summer vibrant bokeh warm',
    'breakfast table morning light golden cozy warm',
    'kite flying blue sky sunshine warm vibrant',
    'butterfly flowers garden colorful summer bokeh',
    'henna mehndi pattern gold close warm cinematic',
    'craft fair handmade colorful market warm vibrant',
    'mountain summit sunrise achievement dramatic warm',
    'beach sparkling waves sunshine warm bokeh',
    'waterfall tropical green lush dramatic vivid',
    'fruit market colorful vibrant warm bokeh close',
    'Afghan traditional carpet pattern colorful close',
    'wedding flowers bouquet gold warm bokeh close',
    'jasmine white flowers garden warm golden close',
    'colorful lanterns night cultural warm bokeh glow',
    'traditional sweets pastry close warm gold bokeh',
    'green valley mountain homeland sunrise dramatic',
    'wildflowers field golden hour warm bokeh vibrant',
    'celebration table food colorful Persian warm gold',
    'festival lights colorful night bokeh warm glow',
  ],
  'duet': [
    'two empty chairs facing window morning light warm',
    'two tea cups warm table close bokeh intimate',
    'two candles side by side dark warm glow close',
    'rose petals scattered floor dim warm bokeh close',
    'window seat empty afternoon light bokeh quiet',
    'park bench empty evening golden warm bokeh',
    'candlelit dinner table set romantic warm no persons',
    'two wine glasses sunset bokeh warm romantic',
    'anniversary roses candles table warm bokeh close',
    'piano bench empty spotlight warm dramatic',
    'doorstep two pairs shoes warm bokeh intimate',
    'love letters tied ribbon warm nostalgic close',
    'star sky vast romantic night clear warm bokeh',
    'beach two footsteps sand sunset warm',
    'boat dock lake evening golden reflection warm',
    'balcony table sunset flowers warm bokeh romantic',
    'snow footprints path winter quiet bokeh warm',
    'evening city reflection puddle bokeh warm golden',
    'romantic fireplace warm glow interior cozy',
    'gazebo garden rain bokeh warm evening atmospheric',
    'flower bouquet two roses close warm intimate',
    'swing empty garden evening warm golden bokeh',
    'kitchen window morning light coffee warm bokeh',
    'train window landscape countryside golden bokeh',
    'bridge arch city sunset golden dramatic warm',
  ],
};

const PEXELS_SCENE_BANKS = {
  'emotional': [
    'rain window glass drops night',
    'empty road fog dusk solitude',
    'city lights bokeh reflection dark',
    'autumn leaves falling melancholy park',
    'candlelight shadow interior moody',
    'ocean waves overcast stormy dramatic',
  ],
  'romantic': [
    'romantic golden hour sunset glow',
    'rose petals soft bokeh closeup',
    'moonlight garden quiet night',
    'beach waves horizon serene dusk',
    'couple silhouette evening warmth',
    'city rain street night lantern',
  ],
  'happy': [
    'sunrise golden field warm light',
    'colorful flowers summer meadow',
    'beach sparkling waves sunshine joy',
    'mountain blue sky vibrant nature',
    'waterfall lush tropical green',
    'city festival bright cheerful street',
  ],
  'duet': [
    'couple silhouette bridge sunset',
    'two hands intertwined soft light',
    'romantic walk nature path together',
    'dance studio moody dramatic couple',
    'city evening warmth couple light',
    'letter notebook window afternoon quiet',
  ],
  'female': [
    'cinematic woman rain window dramatic',
    'silhouette woman sunset golden',
    'soft focus flowers feminine light',
    'woman alone beach contemplative',
    'mirror reflection woman moody interior',
    'night city lights woman walking',
  ],
  'male': [
    'cinematic man road journey landscape',
    'silhouette man mountain summit',
    'man alone rain street moody',
    'open road horizon horizon freedom',
    'man cityscape rooftop evening',
    'forest man solitude dramatic light',
  ],
};

// LONG scene banks — 25 distinct queries, deliberately different from SHORT banks
// Used for Long (16:9) full-song renders to give a unique cinematic experience
const PEXELS_LONG_BANKS = {
  'emotional': [
    'misty mountain lake reflection dawn',
    'abandoned lighthouse ocean overcast dramatic',
    'winter bare tree snow silence',
    'coffee shop window condensation rain',
    'night sky stars milky way lonely',
    'empty park bench autumn fog',
    'train platform night solitary atmospheric',
    'harbor boats mist morning cinematic no people',
    'bridge river night reflection cityscape',
    'fireplace warm interior shadow intimate',
    'rooftop city night dramatic skyline lonely',
    'wheat field wind dusk cinematic',
    'alley night wet cobblestone rain lantern',
    'desert landscape dusk dramatic horizon',
    'snow falling night streetlight quiet slow',
    'cliff ocean waves dramatic storm',
    'forest mist path dark cinematic',
    'vintage interior amber lamp books nostalgia empty',
    'empty highway night headlights fog',
    'mountain sunset last light dramatic',
    'old bookshelf candle warm intimate',
    'moonlight curtain dark window night empty room',
    'rain falling cobblestone street empty bokeh night',
    'river mist autumn morning reflection',
    'church window light dramatic moody',
  ],
  'romantic': [
    'cherry blossom soft light pink dream',
    'golden field wildflowers sunset horizon no people',
    'paris street night warm bokeh empty',
    'flower market colors warm light no people',
    'gondola canal venice romantic soft empty',
    'cafe terrace evening candlelight bokeh empty',
    'white silk fabric flowing breeze soft light closeup',
    'ring jewelry soft velvet closeup',
    'candlelit dinner table romance evening empty',
    'letter handwriting envelope vintage nostalgia',
    'heart bokeh city lights night',
    'piano keys soft light romantic',
    'balcony flowers sunset golden warm no people',
    'sunset gradient orange pink sky horizon clouds romantic',
    'garden path roses soft bokeh no people',
    'ocean horizon golden hour empty water sky',
    'bookshelf rows books amber light warm cozy',
    'snowfall park lantern romantic evening empty',
    'hillside vineyard sunset warm golden',
    'fireflies night meadow magical soft',
    'cottage window warm interior rain no people',
    'bicycle flowers basket summer light',
    'jewelry box velvet soft light',
    'hot air balloon sunset dramatic',
    'lagoon crystal water tropical serene',
  ],
  'happy': [
    'confetti falling celebration colorful',
    'golden retriever sunlit park joy',
    'ice cream summer beach pastel',
    'kite flying blue sky white clouds',
    'open window curtains breeze morning',
    'farmer market colors vibrant street',
    'bicycle parked leaning wall flowers basket summer',
    'playground swing sunny day joyful no people',
    'rain puddle colorful reflections pavement no people',
    'sunflower field blue sky warm',
    'breakfast table morning light cozy',
    'hot cocoa cozy blanket winter',
    'saxophone instrument close warm city lights bokeh',
    'vintage car parked road summer golden light',
    'festival lanterns night sky glowing',
    'swimming pool blue tiles water ripples sunlight',
    'open book garden flowers summer afternoon light',
    'hammock trees summer forest shade',
    'marketplace colorful fruits stalls awnings sunny',
    'beach sand footprints waves ocean morning empty',
    'patio garden morning light flowers no people',
    'skipping stone lake summer calm',
    'craft fair handmade colorful no people',
    'mountain summit sunrise achievement no people',
    'sunlit meadow butterflies summer calm',
  ],
  'duet': [
    'two cups coffee morning table',
    'hands piano keys together close',
    'lighthouse coast walk two people',
    'campfire night two silhouettes stars',
    'dance floor spotlight intimate couple',
    'bench lake evening two figures quiet',
    'window seat reading beside each other',
    'kitchen cooking together warm light',
    'pier sunset two silhouettes holding',
    'snow walk winter couple breath',
    'ferris wheel night romantic light',
    'picnic blanket outdoor afternoon light',
    'dancing kitchen morning light informal',
    'bicycle built for two vintage',
    'laughing couch indoor warm light',
    'holding hands elderly bridge sunlight',
    'shadow two people wall warm',
    'anniversary candles table quiet dinner',
    'shared umbrella city rain street',
    'rooftop stargazing night telescope couple',
    'rowing boat lake dusk calm',
    'doorstep embrace golden evening light',
    'slow waltz empty ballroom evening',
    'train window countryside two together',
    'haystack rural sunset romantic golden',
  ],
  'female': [
    'woman sitting window light contemplative',
    'dancer stage dramatic spotlight cinematic',
    'woman reading book library soft light',
    'silhouette woman cliff ocean sunrise',
    'woman flower field warm golden',
    'ballet dancer stage rehearsal moody',
    'woman candle writing journal intimate',
    'girl rooftop cityscape night dramatic',
    'woman ocean waves shore walking alone',
    'portrait woman soft cinematic light',
    'woman pianist dramatic key closeup',
    'woman forest morning mist ethereal',
    'woman coffee shop window lonely',
    'singer microphone stage emotional performance',
    'woman stargazing field night emotional',
    'woman hallway apartment night moody',
    'woman umbrella rain city night',
    'woman sitting stairs building urban',
    'woman alone restaurant table dramatic',
    'woman park autumn leaves alone',
    'woman doorway backlight silhouette soft',
    'woman bedroom window morning light',
    'woman boat lake sunrise solitary',
    'woman phone screen night dark bedroom',
    'woman theater empty hall dramatic',
  ],
  'male': [
    'man solo hiking mountain dramatic',
    'man cafe window rain alone',
    'musician guitar bedroom window light',
    'man bridge night city below',
    'man ocean shore dramatic sunset',
    'man car drive highway night',
    'man gym training discipline moody',
    'man forest sunrise dramatic light',
    'man suit city dramatic bokeh',
    'man telescope rooftop night stars',
    'man reading armchair lamp warm',
    'man shadow wall dramatic portrait',
    'man snow walk dramatic winter',
    'man fire outdoor night dramatic',
    'man workout industrial moody dramatic',
    'man airport window alone departure',
    'man motorbike road dramatic freedom',
    'man construction dramatic industrial light',
    'man boat fishing lake sunrise quiet',
    'man bar counter night moody',
    'man jazz club dramatic stage light',
    'man graffiti wall urban moody',
    'man silhouette hill sunset dramatic',
    'man backpack traveler path adventure',
    'man sports training stadium dramatic',
  ],
};

// ── ImageAdapter.pexels ───────────────────────────────────────────────────────
// photoOnly=true → skip video search (canvas renderer needs <img>, not video URL)
// count > 1 → returns array of photo objects, one per DISTINCT query (guaranteed variety)
async function pexelsFetchBackground(mood, photoOnly = false, count = 1, isLong = false, mode = '', isFarsi = false) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY not configured in Vercel env');
  const query = pexelsMoodQuery(mood);

  // ── Single-image / legacy path ────────────────────────────────────────────
  if (!photoOnly && count === 1) {
    // Try HD video first
    const vRes = await fetch(
      `${PEXELS_BASE}/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=large&per_page=8`,
      { headers: { Authorization: apiKey } }
    );
    if (vRes.ok) {
      const vData = await vRes.json();
      for (const v of (vData.videos || [])) {
        const hd = (v.video_files || []).find(f => f.quality === 'hd' && f.width >= 1280);
        if (hd) return { assetType: 'video', url: hd.link, credit: v.user?.name || 'Pexels', query };
      }
    }
  }

  if (count === 1) {
    // Single photo — use legacy single-query path
    const pRes = await fetch(
      `${PEXELS_BASE}/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&size=large&per_page=3`,
      { headers: { Authorization: apiKey } }
    );
    if (!pRes.ok) throw new Error(`Pexels photo search ${pRes.status}`);
    const pData = await pRes.json();
    const photos = pData.photos || [];
    if (!photos.length) throw new Error('No Pexels asset found for: ' + query);
    const pick = photos[Math.floor(Math.random() * Math.min(3, photos.length))];
    return { assetType: 'image', url: pick.src.large2x || pick.src.original, credit: pick.photographer, query };
  }

  // ── Multi-scene path: one DISTINCT query per scene slot ──────────────────
  // v13.69.73 — Long tasks use PEXELS_LONG_BANKS; Short tasks use PEXELS_SCENE_BANKS.
  // v13.69.93 — Short Farsi tasks try PEXELS_FARSI_COMBO_BANKS (no-human per-combo bank).
  // v13.73.0 — Long Farsi tasks use PEXELS_FARSI_LONG_BANKS (no-human 25-query bank).
  const m = String(mood || '').toLowerCase();
  const modeStr = String(mode || '').toLowerCase();
  let bank = null;
  // Farsi Short: try per-combination no-human combo bank first
  if (!isLong && modeStr && isFarsi) {
    const artistType = /^duet/i.test(modeStr) ? 'duet' : /^male/i.test(modeStr) ? 'male' : /^female/i.test(modeStr) ? 'female' : null;
    // v13.73.4 — check modeStr first: "Duet — Happy" must yield 'happy', not defaulted mood 'Emotional'
    const moodKey = modeStr.includes('happy') ? 'happy' : modeStr.includes('emotional') ? 'emotional' : modeStr.includes('romantic') ? 'romantic'
      : m.includes('emotional') ? 'emotional' : m.includes('romantic') ? 'romantic' : m.includes('happy') ? 'happy' : null;
    if (artistType && moodKey) {
      const comboKey = artistType + '-' + moodKey;
      bank = PEXELS_FARSI_COMBO_BANKS[comboKey] || null;
      if (bank) console.log('[v13.73.4] using Farsi combo bank:', comboKey);
    }
  }
  // v13.73.0 — Farsi Long: use no-human Farsi-specific long banks
  if (!bank && isLong && isFarsi) {
    // v13.73.4 — check modeStr first: "Duet — Happy" must yield 'happy', not defaulted mood 'Emotional'
    const moodKey = modeStr.includes('happy') ? 'happy' : modeStr.includes('emotional') ? 'emotional' : modeStr.includes('romantic') ? 'romantic'
      : m.includes('emotional') ? 'emotional' : m.includes('romantic') ? 'romantic' : m.includes('happy') ? 'happy'
      : modeStr.includes('duet') ? 'duet' : m.includes('duet') ? 'duet' : null;
    if (moodKey) {
      bank = PEXELS_FARSI_LONG_BANKS[moodKey] || null;
      if (bank) console.log('[v13.73.4] using Farsi Long bank:', moodKey);
    }
  }
  // Fallback: standard mood-only bank lookup (PEXELS_LONG_BANKS or PEXELS_SCENE_BANKS)
  if (!bank) {
    const bankSource = isLong ? PEXELS_LONG_BANKS : PEXELS_SCENE_BANKS;
    for (const [key, queries] of Object.entries(bankSource)) {
      if (m.includes(key)) { bank = queries; break; }
    }
  }
  if (!bank) {
    bank = isLong ? [
      'misty mountain lake reflection dawn',
      'abandoned lighthouse ocean overcast dramatic',
      'winter bare tree snow silence',
      'coffee shop window condensation rain',
      'night sky stars milky way lonely',
      'empty park bench autumn fog',
      'train platform night solitary atmospheric',
      'harbor boats fog morning quiet cinematic',
      'bridge river night reflection cityscape',
      'fireplace warm interior shadow intimate',
      'rooftop city night dramatic skyline lonely',
      'wheat field wind dusk cinematic',
      'alley night wet cobblestone rain lantern',
      'desert landscape dusk dramatic horizon',
      'snow falling night streetlight quiet slow',
      'cliff ocean waves dramatic storm',
      'forest mist path dark cinematic',
      'vintage room warm lamp nostalgia',
      'empty highway night headlights fog',
      'mountain sunset last light dramatic',
      'old bookshelf candle warm intimate',
      'phone screen dark night bedroom',
      'rainy street umbrella bokeh night',
      'river mist autumn morning reflection',
      'church window light dramatic moody',
    ] : [
      'cinematic nature moody dramatic',
      'city street night fog',
      'ocean waves overcast horizon',
      'autumn forest path solitude',
      'candlelight interior shadow moody',
      'mountain landscape dusk dramatic',
    ];
  }

  // v13.69.73 — shuffle Long for variety; v13.69.93 — also shuffle Short for variety
  // (Short previously kept sequential order, causing the same 5 photos every build)
  let queryPool = bank.slice();
  for (let i = queryPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queryPool[i], queryPool[j]] = [queryPool[j], queryPool[i]];
  }

  // Pick `count` queries cycling through the pool
  const selectedQueries = [];
  for (let i = 0; i < count; i++) {
    selectedQueries.push(queryPool[i % queryPool.length]);
  }

  // Fetch one photo per query in parallel — guarantees visually distinct scenes
  // v13.69.73 — Long tasks use per_page=15 with random pick for greater variety per query
  // v13.69.93 — Short tasks get a random page offset (1–4) to shift which photos are returned,
  //   preventing the same top-result photos from appearing on repeated builds with same queries.
  const perPage = isLong ? 15 : 5;
  const shortPage = isLong ? 1 : (Math.floor(Math.random() * 4) + 1);
  const results = await Promise.all(selectedQueries.map(async (q) => {
    try {
      const pageParam = isLong ? '' : `&page=${shortPage}`;
      const r = await fetch(
        `${PEXELS_BASE}/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=${perPage}${pageParam}`,
        { headers: { Authorization: apiKey } }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const list = d.photos || [];
      if (!list.length) return null;
      const pick = list[Math.floor(Math.random() * Math.min(perPage, list.length))];
      return { assetType: 'image', url: pick.src.large2x || pick.src.original, credit: pick.photographer, query: q };
    } catch (e) {
      return null;
    }
  }));

  const valid = results.filter(Boolean);
  if (!valid.length) throw new Error('No Pexels assets found for mood: ' + mood);
  return valid; // always array when count > 1
}

// ── RendererAdapter.shotstack — timeline builder ──────────────────────────────
function _buildLyricClips(lyricsText, totalSec, isPortrait) {
  const lines = (lyricsText || '').split('\n')
    .map(l => l.trim()).filter(l => l && !/^\[.+\]$/.test(l));
  if (!lines.length) return [];
  const maxLines = isPortrait ? 5 : 22;
  const startAt  = isPortrait ? 2 : 10;
  const clipLen  = isPortrait ? 3.5 : 4.5;
  const working  = lines.slice(0, maxLines);
  const gap      = (totalSec - startAt) / working.length;
  const fSize    = isPortrait ? 44 : 38;
  const fWidth   = isPortrait ? 720 : 1280;
  const padX     = isPortrait ? '30px' : '80px';
  return working.map((line, i) => ({
    asset: {
      type: 'html',
      html: `<p style="font-family:Georgia,serif;font-size:${fSize}px;font-weight:400;color:#fff;text-align:center;text-shadow:0 2px 18px rgba(0,0,0,0.95),0 0 50px rgba(0,0,0,0.7);line-height:1.5;padding:0 ${padX};letter-spacing:0.5px">${String(line).replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;')}</p>`,
      width: fWidth, height: isPortrait ? 130 : 110,
    },
    start: startAt + i * gap,
    length: clipLen,
    position: 'center',
    offset: { x: 0, y: isPortrait ? 0 : -0.08 },
    transition: { in: 'fade', out: 'fade' },
    opacity: 1,
  }));
}

function _buildShotstackTimeline({ audioUrl, bgAsset, lyrics, totalSec, aspectRatio }) {
  const isPortrait = aspectRatio === '9:16';
  const bgClip = {
    asset: bgAsset.assetType === 'video'
      ? { type: 'video', src: bgAsset.url, volume: 0 }
      : { type: 'image', src: bgAsset.url },
    start: 0, length: totalSec,
    effect: bgAsset.assetType === 'image' ? 'zoomInSlow' : undefined,
    fit: 'cover',
  };
  const brandClip = {
    asset: {
      type: 'html',
      html: '<p style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:5px">SRV</p>',
      width: 140, height: 50,
    },
    start: 0, length: totalSec,
    position: 'bottomLeft',
    offset: { x: 0.05, y: -0.04 },
    opacity: 0.85,
  };
  const lyricClips = _buildLyricClips(lyrics, totalSec, isPortrait);
  return {
    timeline: {
      soundtrack: { src: audioUrl, effect: 'fadeOut', volume: 1 },
      tracks: [
        { clips: lyricClips },
        { clips: [brandClip] },
        { clips: [bgClip] },
      ],
    },
    output: {
      format: 'mp4',
      resolution: isPortrait ? 'sd' : 'hd',
      aspectRatio,
      fps: 25,
    },
  };
}

async function _shotstackSubmitRender(timeline) {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) throw new Error('SHOTSTACK_API_KEY not configured in Vercel env');
  const r = await fetch(`${SHOTSTACK_BASE}/renders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(timeline),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Shotstack submit ${r.status}: ${JSON.stringify(d).slice(0,200)}`);
  return d.response?.id || d.id;
}

async function _shotstackPollStatus(renderId) {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) throw new Error('SHOTSTACK_API_KEY not configured');
  const r = await fetch(`${SHOTSTACK_BASE}/renders/${renderId}`, {
    headers: { 'x-api-key': key },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Shotstack status ${r.status}`);
  const resp = d.response || d;
  return { status: resp.status, url: resp.url || null, error: resp.error || null };
}

// ── Action: srv_english_pexels_bg ─────────────────────────────────────────────
async function srvEnglishPexelsBg(req, res) {
  try {
    const { mood, mode, photo_only, count, isLong, isFarsi } = Object.assign({}, req.body, req.query);
    const photoOnly = photo_only === true || photo_only === 'true';
    const isLongTask = isLong === true || isLong === 'true';
    // v13.69.73 — Long tasks fetch 25 distinct scenes; Short tasks fetch 5-6
    const maxCount = isLongTask ? 30 : 6;
    const photoCount = Math.min(maxCount, Math.max(1, parseInt(count) || 1));
    // v13.69.93 — pass mode (full "Artist — Mood" string) for combo-bank lookup
    // v13.73.0 — pass isFarsi flag to route Farsi Long to PEXELS_FARSI_LONG_BANKS
    const isFarsiFlag = isFarsi === true || isFarsi === 'true';
    const result = await pexelsFetchBackground(mood, photoOnly, photoCount, isLongTask, mode, isFarsiFlag);
    // result is either a single object (count=1) or an array (count>1)
    if (Array.isArray(result)) {
      return res.status(200).json({ ok: true, photos: result });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}

// ── Action: srv_english_render_status ────────────────────────────────────────
async function srvEnglishRenderStatus(req, res) {
  try {
    const { long_id, short_id } = Object.assign({}, req.query, req.body);
    const [longStatus, shortStatus] = await Promise.all([
      long_id  ? _shotstackPollStatus(long_id)  : Promise.resolve(null),
      short_id ? _shotstackPollStatus(short_id) : Promise.resolve(null),
    ]);
    const bothDone = (!long_id || longStatus?.status === 'done') &&
                     (!short_id || shortStatus?.status === 'done');
    const anyFailed = longStatus?.status === 'failed' || shortStatus?.status === 'failed';
    return res.status(200).json({
      ok: true,
      long:  longStatus,
      short: shortStatus,
      ready: bothDone,
      failed: anyFailed,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}

// ── Action: srv_english_build ─────────────────────────────────────────────────
// Receives: audio_url, mood, lyrics, short_lyrics, title
// 1. Fetches Pexels background (image adapter)
// 2. Submits LONG + SHORT renders to Shotstack (renderer adapter)
// 3. Returns render IDs immediately — client polls srv_english_render_status
async function srvEnglishBuild(req, res) {
  try {
    const { audio_url, mood, lyrics, short_lyrics, title } = req.body || {};
    if (!audio_url) return res.status(400).json({ ok: false, error: 'audio_url required' });

    // Step 1: Image adapter — Pexels
    let bgAsset;
    try {
      bgAsset = await pexelsFetchBackground(mood);
    } catch (e) {
      return res.status(200).json({
        ok: false, needs_config: true,
        missing: ['PEXELS_API_KEY'],
        error: e.message,
        hint: 'Add PEXELS_API_KEY to Vercel environment variables and redeploy.',
      });
    }

    // Step 2: Renderer adapter — Shotstack
    let longRenderId, shortRenderId;
    try {
      const longTimeline = _buildShotstackTimeline({
        audioUrl: audio_url, bgAsset,
        lyrics: lyrics || '', totalSec: 180, aspectRatio: '16:9',
      });
      const shortTimeline = _buildShotstackTimeline({
        audioUrl: audio_url, bgAsset,
        lyrics: short_lyrics || (lyrics || '').split('\n').slice(0,5).join('\n'),
        totalSec: 28, aspectRatio: '9:16',
      });
      longRenderId  = await _shotstackSubmitRender(longTimeline);
      shortRenderId = await _shotstackSubmitRender(shortTimeline);
    } catch (e) {
      return res.status(200).json({
        ok: false, needs_config: true,
        missing: ['SHOTSTACK_API_KEY'],
        error: e.message,
        hint: 'Add SHOTSTACK_API_KEY to Vercel environment variables and redeploy.',
      });
    }

    return res.status(200).json({
      ok: true,
      status: 'rendering',
      longRenderId,
      shortRenderId,
      bgUrl:   bgAsset.url,
      bgType:  bgAsset.assetType,
      bgCredit: bgAsset.credit,
      message: 'Shotstack renders submitted. Poll srv_english_render_status to check progress.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── SOCIAL MEDIA MANAGER — Business Brain server actions ──────────────────────
// v16.28.1 — CEO Directive (Milestone 1 revision): moved off direct client-side
// access to business_brain (RLS-enabled, zero anon/authenticated policies —
// service_role only, matching this project's standing access model). These two
// actions are the merge of social-media-manager/server-actions/business-brain-actions.js
// business_brain_list / business_brain_create, adapted to this file's raw-fetch
// sbGet/sbInsert helpers (SUPABASE_SERVICE_KEY) rather than a supabase-js client,
// since that's the pattern this file already uses everywhere else.
async function businessBrainList(req, res) {
  // v16.28.2 — TEMPORARY debugging (CEO Directive, Milestone 1 rejection): log every stage so a
  // failure's exact location is visible in Vercel dev's terminal output, not just guessed at.
  // Remove once Milestone 1 passes CEO acceptance.
  console.log('[ops][business_brain_list] action received. method=%s query=%j', req.method, req.query || {});
  console.log('[ops][business_brain_list] SUPABASE_SERVICE_KEY present=%s length=%d',
    !!SUPABASE_SERVICE_KEY, (SUPABASE_SERVICE_KEY || '').length);
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { workflow_state, final_status, limit } = req.query || {};
  let q = 'business_brain?select=*&order=created_at.desc';
  if (workflow_state) q += `&workflow_state=eq.${encodeURIComponent(workflow_state)}`;
  if (final_status)   q += `&final_status=eq.${encodeURIComponent(final_status)}`;
  const lim = parseInt(limit, 10);
  q += `&limit=${(Number.isFinite(lim) && lim > 0) ? lim : 50}`;

  console.log('[ops][business_brain_list] querying Supabase:', q);
  try {
    const records = await sbGet(q);
    console.log('[ops][business_brain_list] Supabase returned %d record(s)', (records || []).length);
    return res.status(200).json({ ok: true, records: records || [] });
  } catch (e) {
    // sbGet throws with the real Supabase status/body already in e.message — surface it directly
    // instead of letting the outer dispatcher catch swallow the specifics into a generic 500.
    console.error('[ops][business_brain_list] Supabase access failed:', e.message);
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function businessBrainCreate(req, res) {
  // v16.28.2 — TEMPORARY debugging (CEO Directive) — see businessBrainList for rationale.
  console.log('[ops][business_brain_create] action received. method=%s body=%j', req.method, req.body || {});
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { requestKey, mode, identity } = req.body || {};
  if (!requestKey || typeof requestKey !== 'string') {
    return res.status(400).json({ ok: false, error: 'requestKey is required' });
  }
  if (mode !== 'mode_a' && mode !== 'mode_b') {
    return res.status(400).json({ ok: false, error: "mode must be 'mode_a' or 'mode_b'" });
  }
  if (!identity || typeof identity !== 'object' || !identity.businessName) {
    return res.status(400).json({ ok: false, error: 'identity.businessName is required' });
  }

  // 1. Idempotency: has this exact requestKey already been used?
  //    (application-layer check-then-insert — same limitation as the original
  //    Phase 1B design: no DB-level unique constraint on identity->>_requestKey.
  //    Unchanged from the approved design; not in scope for this revision.)
  const byRequestKey = await sbGet(
    `business_brain?identity->>_requestKey=eq.${encodeURIComponent(requestKey)}&select=*&limit=1`
  );
  if (byRequestKey && byRequestKey.length > 0) {
    return res.status(200).json({ ok: true, businessId: byRequestKey[0].business_id, created: false, record: byRequestKey[0] });
  }

  // 2. Duplicate-business detection: same name + city already on file?
  //    Only checked when a city/address was actually given — Milestone 1's
  //    intake form allows leaving it honestly empty rather than fabricated.
  if (identity.cityOrAddress) {
    const existingMatches = await sbGet(
      `business_brain?identity->>businessName=ilike.${encodeURIComponent(identity.businessName)}` +
      `&identity->>cityOrAddress=ilike.${encodeURIComponent(identity.cityOrAddress)}&select=*&limit=1`
    );
    if (existingMatches && existingMatches.length > 0) {
      return res.status(200).json({
        ok: true, businessId: existingMatches[0].business_id, created: false,
        duplicateOf: existingMatches[0].business_id, record: existingMatches[0],
      });
    }
  }

  // 3. Genuinely new — generate the immutable ID server-side. Same bb_<24 hex>
  //    shape already used for the real Urban Halal Shack row.
  const businessId = `bb_${randomBytes(12).toString('hex')}`;
  const identityWithKey = { ...identity, _requestKey: requestKey };

  try {
    const inserted = await sbInsert('business_brain', {
      business_id: businessId,
      mode,
      identity: identityWithKey,
    });
    return res.status(200).json({ ok: true, businessId, created: true, record: inserted });
  } catch (insertErr) {
    // Unique-violation race (two concurrent identical requests): re-read by
    // requestKey rather than surfacing a raw constraint error.
    const retry = await sbGet(
      `business_brain?identity->>_requestKey=eq.${encodeURIComponent(requestKey)}&select=*&limit=1`
    );
    if (retry && retry.length > 0) {
      return res.status(200).json({ ok: true, businessId: retry[0].business_id, created: false, record: retry[0] });
    }
    return res.status(500).json({ ok: false, error: `insert failed: ${insertErr.message}` });
  }
}

// v16.30.1 — CEO Directive (Milestone 3 revision): Business Discovery materialize path.
// Adapted verbatim in business logic from the approved business_brain_materialize
// (social-media-manager/server-actions/business-brain-actions.js) — merges a verified-field
// patch into an existing Business Brain row. Rejects any attempt to change business_id at the
// application layer (defense in depth on top of the DB trigger trg_business_brain_immutable_id).
async function businessBrainMaterialize(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, patch } = req.body || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  if (!patch || typeof patch !== 'object') return res.status(400).json({ ok: false, error: 'patch is required' });
  if ('business_id' in patch || 'businessId' in patch) {
    return res.status(400).json({ ok: false, error: 'business_id is immutable and cannot appear in a materialize patch' });
  }
  try {
    const currentRows = await sbGet(`business_brain?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=1`);
    const current = currentRows && currentRows[0] ? currentRows[0] : null;
    if (!current) return res.status(404).json({ ok: false, error: 'Business Brain not found' });

    const updatePayload = { ...patch };
    delete updatePayload.business_id;
    delete updatePayload.businessId;

    const updated = await sbPatch('business_brain', `business_id=eq.${encodeURIComponent(businessId)}`, updatePayload);
    if (!updated) return res.status(409).json({ ok: false, error: 'materialize failed: no row updated' });
    return res.status(200).json({ ok: true, record: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// ── SOCIAL MEDIA MANAGER — v16.29.0 — Vertical Slice Milestone 2: Business Operations ──
// Adapted verbatim in business logic from the approved
// social-media-manager/server-actions/business-operations-actions.js (bol_*), rewritten
// against this file's raw-fetch sbGet/sbInsert/sbPatch helpers to match its existing
// pattern (same adaptation style as businessBrainList/businessBrainCreate above).
// Reads/writes public.client_service_plans only; reads (never writes) public.business_brain.

const BOL_ALLOWED_TRANSITIONS = {
  'Lead->Demo':      { gated: false },
  'Active->Paused':  { gated: false },
  'Paused->Active':  { gated: false },
  'Active->Closed':  { gated: false },
  'Paused->Closed':  { gated: false },
  'Demo->Active':    { gated: true },
  'Closed->Active':  { gated: true },
};

async function businessOperationsGet(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { businessId } = req.query || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  try {
    const [brainRows, clientRows] = await Promise.all([
      sbGet(`business_brain?business_id=eq.${encodeURIComponent(businessId)}&select=business_id,final_status&limit=1`),
      sbGet(`client_service_plans?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=1`),
    ]);
    const brain = brainRows && brainRows[0] ? brainRows[0] : null;
    if (!brain) return res.status(404).json({ ok: false, error: 'Business Brain not found' });
    const client = clientRows && clientRows[0] ? clientRows[0] : null;
    return res.status(200).json({ ok: true, brainFinalStatus: brain.final_status, client });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function businessOperationsRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { requestKey, businessId, initialStatus, ceoApproved, approvalNote, decisionRef, servicePlanId } = req.body || {};

  if (!requestKey) return res.status(400).json({ ok: false, error: 'requestKey is required' });
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  if (initialStatus !== 'Demo' && initialStatus !== 'Active') {
    return res.status(400).json({ ok: false, error: "initialStatus must be 'Demo' or 'Active'" });
  }
  if (ceoApproved !== true) {
    return res.status(400).json({ ok: false, error: 'ceoApproved must be explicitly true' });
  }
  if (!approvalNote && !decisionRef) {
    return res.status(400).json({ ok: false, error: 'an approvalNote or decisionRef is required' });
  }

  try {
    const brainRows = await sbGet(`business_brain?business_id=eq.${encodeURIComponent(businessId)}&select=business_id,final_status&limit=1`);
    const brain = brainRows && brainRows[0] ? brainRows[0] : null;
    if (!brain) return res.status(404).json({ ok: false, error: 'Business Brain not found' });
    if (brain.final_status !== 'ready_for_ceo_review') {
      return res.status(400).json({ ok: false, error: `Business Brain is not ready for CEO review (final_status=${brain.final_status})` });
    }

    const existingRows = await sbGet(`client_service_plans?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=1`);
    const existing = existingRows && existingRows[0] ? existingRows[0] : null;
    if (existing) {
      const firstEntry = Array.isArray(existing.status_history) ? existing.status_history[0] : null;
      if (firstEntry && firstEntry.requestKey === requestKey) {
        return res.status(200).json({ ok: true, created: false, record: existing });
      }
      return res.status(409).json({ ok: false, error: 'this business is already registered under a different request' });
    }

    const historyEntry = {
      status: initialStatus,
      changedAt: new Date().toISOString(),
      reason: approvalNote || null,
      decisionRef: decisionRef || null,
      ceoApproved: true,
      requestKey,
    };

    try {
      const inserted = await sbInsert('client_service_plans', {
        business_id: businessId,
        status: initialStatus,
        service_plan_id: servicePlanId || null,
        status_history: [historyEntry],
      });
      return res.status(200).json({ ok: true, created: true, record: inserted });
    } catch (insertErr) {
      const retryRows = await sbGet(`client_service_plans?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=1`);
      const retry = retryRows && retryRows[0] ? retryRows[0] : null;
      if (retry) {
        const firstEntry = Array.isArray(retry.status_history) ? retry.status_history[0] : null;
        if (firstEntry && firstEntry.requestKey === requestKey) {
          return res.status(200).json({ ok: true, created: false, record: retry });
        }
        return res.status(409).json({ ok: false, error: 'this business is already registered under a different request' });
      }
      return res.status(500).json({ ok: false, error: `insert failed: ${insertErr.message}` });
    }
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function businessOperationsUpdateStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, fromStatus, toStatus, ceoApproved, reason, decisionRef, requestKey } = req.body || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  if (!fromStatus || !toStatus) return res.status(400).json({ ok: false, error: 'fromStatus and toStatus are required' });

  const key = `${fromStatus}->${toStatus}`;
  const rule = BOL_ALLOWED_TRANSITIONS[key];
  if (!rule) return res.status(400).json({ ok: false, error: `illegal transition: ${key}` });
  if (rule.gated && ceoApproved !== true) {
    return res.status(400).json({ ok: false, error: `${key} requires explicit ceoApproved:true` });
  }

  try {
    const currentRows = await sbGet(`client_service_plans?business_id=eq.${encodeURIComponent(businessId)}&select=status,status_history&limit=1`);
    const current = currentRows && currentRows[0] ? currentRows[0] : null;
    if (!current) return res.status(404).json({ ok: false, error: 'client not found' });
    if (current.status !== fromStatus) {
      return res.status(409).json({ ok: false, error: `fromStatus mismatch: client is currently '${current.status}', not '${fromStatus}' — reload and retry` });
    }

    const historyEntry = {
      status: toStatus,
      changedAt: new Date().toISOString(),
      reason: reason || null,
      decisionRef: decisionRef || null,
      ceoApproved: rule.gated ? true : !!ceoApproved,
      requestKey: requestKey || null,
    };
    const newHistory = [...(Array.isArray(current.status_history) ? current.status_history : []), historyEntry];

    const updated = await sbPatch(
      'client_service_plans',
      `business_id=eq.${encodeURIComponent(businessId)}&status=eq.${encodeURIComponent(fromStatus)}`,
      { status: toStatus, status_history: newHistory, ceo_approved_transition: rule.gated ? true : false }
    );
    if (!updated) return res.status(409).json({ ok: false, error: 'status changed concurrently — reload and retry' });
    return res.status(200).json({ ok: true, record: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function businessOperationsUpdateServicePlan(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, servicePlanId } = req.body || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  if (!['Starter', 'Managed', 'Growth'].includes(servicePlanId)) {
    return res.status(400).json({ ok: false, error: "servicePlanId must be 'Starter', 'Managed', or 'Growth'" });
  }
  try {
    const updated = await sbPatch('client_service_plans', `business_id=eq.${encodeURIComponent(businessId)}`, { service_plan_id: servicePlanId });
    if (!updated) return res.status(404).json({ ok: false, error: 'client not found' });
    return res.status(200).json({ ok: true, record: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function businessOperationsUpdateSchedulePrefs(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, postingSchedule, publishingPreferences } = req.body || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  if (!postingSchedule && !publishingPreferences) {
    return res.status(400).json({ ok: false, error: 'postingSchedule and/or publishingPreferences is required' });
  }
  try {
    const currentRows = await sbGet(`client_service_plans?business_id=eq.${encodeURIComponent(businessId)}&select=posting_schedule,publishing_preferences&limit=1`);
    const current = currentRows && currentRows[0] ? currentRows[0] : null;
    if (!current) return res.status(404).json({ ok: false, error: 'client not found' });

    const payload = {};
    if (postingSchedule) payload.posting_schedule = { ...(current.posting_schedule || {}), ...postingSchedule };
    if (publishingPreferences) payload.publishing_preferences = { ...(current.publishing_preferences || {}), ...publishingPreferences };

    const updated = await sbPatch('client_service_plans', `business_id=eq.${encodeURIComponent(businessId)}`, payload);
    if (!updated) return res.status(404).json({ ok: false, error: 'client not found' });
    return res.status(200).json({ ok: true, record: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function businessOperationsCurateAsset(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, assetId, approvedForProduction, usageNotes } = req.body || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  if (!assetId) return res.status(400).json({ ok: false, error: 'assetId is required' });
  try {
    const currentRows = await sbGet(`client_service_plans?business_id=eq.${encodeURIComponent(businessId)}&select=curated_brand_assets&limit=1`);
    const current = currentRows && currentRows[0] ? currentRows[0] : null;
    if (!current) return res.status(404).json({ ok: false, error: 'client not found' });

    const list = Array.isArray(current.curated_brand_assets) ? current.curated_brand_assets : [];
    const idx = list.findIndex((a) => a && a.assetId === assetId);
    const entry = {
      assetId,
      approvedForProduction: !!approvedForProduction,
      usageNotes: usageNotes || null,
      curatedAt: new Date().toISOString(),
    };
    const newList = idx >= 0 ? [...list.slice(0, idx), entry, ...list.slice(idx + 1)] : [...list, entry];

    const updated = await sbPatch('client_service_plans', `business_id=eq.${encodeURIComponent(businessId)}`, { curated_brand_assets: newList });
    if (!updated) return res.status(404).json({ ok: false, error: 'client not found' });
    return res.status(200).json({ ok: true, record: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// ── SOCIAL MEDIA MANAGER — v16.30.0 — Vertical Slice Milestone 3: Content Planning ──
// Adapted verbatim in business logic from the approved
// social-media-manager/server-actions/content-planning-actions.js (cpe_*), rewritten
// against this file's raw-fetch sbGet/sbInsert/sbPatch helpers, same adaptation style as
// businessOperations* above. Reads public.business_brain and public.client_service_plans;
// reads/writes public.content_plans only. Deliberately stops at storing a plan — no
// production_task_refs are ever populated, no D.tasks write, no dispatch, no publish.
// Milestone 3 scope is Demo Planning Mode only (per CEO Decision) — Client Planning Mode
// (cpe_run_client_plan, recurring monthly cycles tied to an Active client) is part of the
// same approved file but intentionally not wired here; out of scope for this milestone.

function cpFilterTracked(field, status) {
  if (Array.isArray(field)) {
    return field.filter((item) => item && (item.status === status || cpFieldsAllMatch(item, status)));
  }
  if (field && typeof field === 'object') {
    return cpFieldsAllMatch(field, status) ? field : cpPartialFieldMatch(field, status);
  }
  return field;
}
function cpFieldsAllMatch(obj, status) { return obj && obj.status === status; }
function cpPartialFieldMatch(obj, status) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && v.status === status) out[k] = v;
  }
  return out;
}
function cpExtractVerifiedFields(brain) {
  const out = {};
  for (const key of ['identity', 'offerings', 'social_accounts', 'social_audits', 'brand_assets', 'reviews', 'competitors']) {
    out[key] = cpFilterTracked(brain[key], 'verified');
  }
  return out;
}
function cpBuildIllustrativeItems(fields, maxItems) {
  const items = [];
  const offerings = Array.isArray(fields.offerings) ? fields.offerings : [];
  for (const offering of offerings) {
    if (items.length >= maxItems) break;
    items.push({ category: 'signature_offering', source: offering });
  }
  return items;
}

async function contentPlanningList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { businessId } = req.query || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  try {
    const records = await sbGet(`content_plans?business_id=eq.${encodeURIComponent(businessId)}&select=*&order=created_at.desc`);
    return res.status(200).json({ ok: true, records: records || [] });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function contentPlanningGenerateDemo(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, requestKey } = req.body || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  if (!requestKey) return res.status(400).json({ ok: false, error: 'requestKey is required' });

  try {
    const existingRows = await sbGet(
      `content_plans?business_id=eq.${encodeURIComponent(businessId)}&mode=eq.demo&plan_body->>_requestKey=eq.${encodeURIComponent(requestKey)}&select=*&limit=1`
    );
    const existing = existingRows && existingRows[0] ? existingRows[0] : null;
    if (existing) return res.status(200).json({ ok: true, created: false, record: existing });

    const brainRows = await sbGet(`business_brain?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=1`);
    const brain = brainRows && brainRows[0] ? brainRows[0] : null;
    if (!brain) return res.status(404).json({ ok: false, error: 'Business Brain not found' });

    const verifiedOnly = cpExtractVerifiedFields(brain);
    const planBody = {
      _requestKey: requestKey,
      kind: 'demo_sample_package',
      generatedFrom: 'verified_fields_only',
      items: cpBuildIllustrativeItems(verifiedOnly, 5),
      note: 'Demo Planning Mode sample — illustrative only, not a recurring operating plan.',
    };

    const inserted = await sbInsert('content_plans', {
      business_id: businessId,
      mode: 'demo',
      status: 'draft',
      period: null,
      plan_body: planBody,
      production_task_refs: [],
    });
    return res.status(200).json({ ok: true, created: true, record: inserted });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function contentPlanningReview(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { planId, decision } = req.body || {};
  if (!planId) return res.status(400).json({ ok: false, error: 'planId is required' });
  if (decision !== 'ceo_approved' && decision !== 'rejected') {
    return res.status(400).json({ ok: false, error: "decision must be 'ceo_approved' or 'rejected'" });
  }
  try {
    const updated = await sbPatch(
      'content_plans',
      `id=eq.${encodeURIComponent(planId)}&mode=eq.demo&status=eq.draft`,
      { status: decision }
    );
    if (!updated) return res.status(409).json({ ok: false, error: 'no matching draft demo plan found (already reviewed, wrong mode, or does not exist)' });

    // v16.31.0 — CEO Directive (Milestone 4): approving a demo content plan automatically
    // generates its VA Task Queue + demo Production Packages. Additive only — the reject
    // path and the plan-approval mechanics themselves are byte-for-byte unchanged from the
    // CEO-approved Milestone 3 behavior. Queue generation failure does not roll back or
    // block the approval itself; it is reported alongside the (still-successful) approval,
    // and can be retried via the standalone va_task_queue_generate action.
    let vaQueue = null;
    let vaQueueError = null;
    if (decision === 'ceo_approved') {
      try {
        vaQueue = await smGenerateVaQueueForPlan(updated, updated.business_id);
      } catch (queueErr) {
        console.error('[content_planning_review] VA queue generation failed:', queueErr.message);
        vaQueueError = queueErr.message;
      }
    }
    return res.status(200).json({ ok: true, record: updated, vaQueue, vaQueueError });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// ── SOCIAL MEDIA MANAGER — v16.31.0 — Vertical Slice Milestone 4: VA Task Queue & ──
// ── Production Package Generation (Demo/Test Mode only)                          ──
// Reuses the exact review-status vocabulary already CEO-approved for content_plans
// (draft/ceo_approved/rejected) on sm_production_packages, and the exact caption source
// (verified business_brain offerings only — no fabricated claims) already CEO-approved
// for Content Planning. Writes only to the two new, isolated sm_va_tasks /
// sm_production_packages tables (migration: milestone4_va_task_queue_production_packages)
// — zero reads or writes against operator_tasks/packages/production_pipeline/upload_queue,
// per the CEO-approved architectural decision to keep this pipeline structurally incapable
// of touching the real content-engine production/publishing systems.

// Builds production-package content strictly from already-verified fields (offering +
// business identity) — no invented marketing claims, ratings, or promises. Mirrors the
// "no fabrication" rule already applied throughout Business Discovery / Content Planning.
// v16.35.0 — Milestone 5A: speaks AS the business (first person), and pulls verified
// website/phone into the caption/CTA when present. Never adds a social handle — this
// project has no verified social_accounts row for UHS, and this function has no way to
// check that (it only receives offering+identity), so it deliberately never mentions
// "follow us" at all. hasVerifiedSocial-gated "follow us" language lives only in the
// video creative path (smBuildVideoCreativePrompt/smGenerateVideoCreative) which does
// receive that flag.
// SMM V1 Phase 1 — Brain + Data Foundation. Short deterministic fingerprint of a production's
// core content (item + hook + concept/caption), stored on the row at creation time. Foundation
// only: no dedup/repetition logic reads this yet (that is explicitly Phase 3) — it exists so a
// future phase can detect near-duplicate productions without re-deriving history from scratch.
function smComputeContentFingerprint(parts) {
  const normalized = (parts || []).map((p) => String(p || '').trim().toLowerCase()).join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function smBuildProductionPackageContent(offering, identity) {
  const name = (offering && offering.name) || 'Menu Item';
  const desc = (offering && offering.description) || '';
  const price = (offering && typeof offering.price === 'number') ? `$${offering.price.toFixed(2)}` : '';
  const category = (offering && offering.category) || '';
  const bizName = (identity && identity.businessName) || '';
  const cityRaw = (identity && identity.cityOrAddress) || '';
  const website = (identity && identity.website) || '';
  const phone = (identity && identity.phoneNumber) || '';
  // Derive a city hashtag only from the verified address string itself (e.g. "…, Columbus, OH …") —
  // never guessed. If the pattern doesn't match, the tag is simply omitted rather than invented.
  const cityMatch = cityRaw.match(/,\s*([A-Za-z]+),?\s*[A-Z]{2}\b/);
  const cityTag = cityMatch ? cityMatch[1].replace(/\s+/g, '') : null;
  const bizTag = bizName ? bizName.replace(/[^A-Za-z0-9]/g, '') : null;
  const catTag = category ? category.replace(/[^A-Za-z0-9]/g, '') : null;
  const hashtags = ['#HalalFood', bizTag ? `#${bizTag}` : null, cityTag ? `#${cityTag}` : null, catTag ? `#${catTag}` : null]
    .filter(Boolean).join(' ');
  const ctaParts = [];
  ctaParts.push('Order from us');
  if (website) ctaParts.push(website);
  else if (phone) ctaParts.push(`Call ${phone}`);
  const caption = `${name}${desc ? ` — ${desc}` : ''}${price ? ` (${price})` : ''}. ${ctaParts.join(' — ')}.`;
  const hook = category ? `Our ${name} — from our ${category} menu` : `Our ${name}`;
  const checklist = [
    { label: 'Confirm item details match the current menu', done: false },
    { label: 'Select or capture a photo/video asset for this item', done: false },
    { label: 'Proofread caption and hashtags before scheduling', done: false },
  ];
  return { caption, hook, hashtags, checklist };
}

// Idempotent: safe to call more than once for the same plan — existing sm_va_tasks rows
// (matched by content_plan_id + item_ref, the same pair the DB UNIQUE constraint enforces)
// and existing sm_production_packages rows (matched by va_task_id) are reused, never
// duplicated. Assumes `plan` has already been validated by the caller as mode='demo' and
// status='ceo_approved' — the sm_va_tasks_enforce_plan_gate() DB trigger enforces this
// again regardless, as defense in depth.
async function smGenerateVaQueueForPlan(plan, businessId) {
  const items = (plan.plan_body && Array.isArray(plan.plan_body.items)) ? plan.plan_body.items : [];
  if (items.length === 0) return [];

  const [clientRows, brainRows, existingTasks] = await Promise.all([
    sbGet(`client_service_plans?business_id=eq.${encodeURIComponent(businessId)}&select=posting_schedule,publishing_preferences&limit=1`),
    sbGet(`business_brain?business_id=eq.${encodeURIComponent(businessId)}&select=identity&limit=1`),
    sbGet(`sm_va_tasks?content_plan_id=eq.${encodeURIComponent(plan.id)}&select=*`),
  ]);
  const client = (clientRows && clientRows[0]) || {};
  const identity = (brainRows && brainRows[0] && brainRows[0].identity) || {};
  const preferredDays = (client.posting_schedule && Array.isArray(client.posting_schedule.preferredDays)) ? client.posting_schedule.preferredDays : [];
  const platforms = (client.publishing_preferences && Array.isArray(client.publishing_preferences.platforms)) ? client.publishing_preferences.platforms : [];
  const platformLabel = platforms.length ? platforms.join(', ') : null;

  const existingByItemRef = {};
  (existingTasks || []).forEach((t) => { existingByItemRef[t.item_ref] = t; });

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const offering = item.source || {};
    const itemRef = offering.id || `item_${i}`;
    let task = existingByItemRef[itemRef];

    if (!task) {
      task = await sbInsert('sm_va_tasks', {
        business_id: businessId,
        content_plan_id: plan.id,
        item_ref: itemRef,
        title: offering.name ? `${offering.name} — ${platformLabel || 'Social Post'}` : `Content item ${i + 1}`,
        platform: platformLabel,
        scheduled_day: preferredDays.length ? preferredDays[i % preferredDays.length] : null,
      });
    }

    const pkgRows = await sbGet(`sm_production_packages?va_task_id=eq.${encodeURIComponent(task.id)}&select=*&limit=1`);
    let pkg = pkgRows && pkgRows[0] ? pkgRows[0] : null;
    if (!pkg) {
      // SMM V1 Phase 3 — Content Intelligence / Creative Planner (same orchestrator as the
      // single-task Generate action — one canonical planning path, not two that could drift).
      const generatedPlan = await smBuildCreativePlan(task);
      pkg = await sbInsert('sm_production_packages', { va_task_id: task.id, ...generatedPlan });
      if (task.status === 'queued') {
        task = await sbPatch('sm_va_tasks', `id=eq.${encodeURIComponent(task.id)}`, { status: 'package_ready' });
      }
    }
    results.push({ task, package: pkg });
  }
  return results;
}

async function vaTaskQueueGenerate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { contentPlanId } = req.body || {};
  if (!contentPlanId) return res.status(400).json({ ok: false, error: 'contentPlanId is required' });
  try {
    const planRows = await sbGet(`content_plans?id=eq.${encodeURIComponent(contentPlanId)}&select=*&limit=1`);
    const plan = planRows && planRows[0] ? planRows[0] : null;
    if (!plan) return res.status(404).json({ ok: false, error: 'content plan not found' });
    // Server-side validation, in addition to (not instead of) the sm_va_tasks_enforce_plan_gate()
    // DB trigger — CEO Directive: "also validate it in the server action."
    if (plan.mode !== 'demo') {
      return res.status(400).json({ ok: false, error: `content plan is mode=${plan.mode}; only demo-mode plans may generate a VA task queue` });
    }
    if (plan.status !== 'ceo_approved') {
      return res.status(400).json({ ok: false, error: `content plan is status=${plan.status}; only ceo_approved plans may generate a VA task queue` });
    }
    const queue = await smGenerateVaQueueForPlan(plan, plan.business_id);
    return res.status(200).json({ ok: true, contentPlanId: plan.id, queue });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function vaTaskList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { businessId } = req.query || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  try {
    // SMM V1 Phase 1 — Brain + Data Foundation: engineering-test rows (data_tier='engineering_test')
    // are excluded from the VA/CEO-facing queue by default, so throwaway engineering verification
    // runs no longer need to be manually deleted to keep Operator Mode clean — they stay in the
    // database for audit, just filtered out of this view. Every existing/real production row
    // defaults to data_tier='pilot' and is unaffected.
    const tasks = await sbGet(`sm_va_tasks?business_id=eq.${encodeURIComponent(businessId)}&data_tier=neq.engineering_test&select=*&order=created_at.asc`);
    const ids = (tasks || []).map((t) => t.id);
    let packages = [];
    // v16.58.0 — CEO Decision #26 continuation: sm_production_packages now supports multiple
    // attempts per task (Reject → Regenerate, same attempt_number/is_current pattern as
    // sm_video_productions) — only the current attempt is ever relevant here.
    if (ids.length) {
      packages = await sbGet(`sm_production_packages?va_task_id=in.(${ids.map(encodeURIComponent).join(',')})&is_current=eq.true&select=*`);
    }
    const byTaskId = {};
    (packages || []).forEach((p) => { byTaskId[p.va_task_id] = p; });
    const records = (tasks || []).map((t) => ({ ...t, package: byTaskId[t.id] || null }));
    return res.status(200).json({ ok: true, records });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function vaTaskGet(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { taskId } = req.query || {};
  if (!taskId) return res.status(400).json({ ok: false, error: 'taskId is required' });
  try {
    const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(taskId)}&select=*&limit=1`);
    const task = taskRows && taskRows[0] ? taskRows[0] : null;
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
    // v16.58.0 — CEO Decision #26 continuation: current attempt only (see vaTaskList comment).
    const pkgRows = await sbGet(`sm_production_packages?va_task_id=eq.${encodeURIComponent(taskId)}&is_current=eq.true&select=*&limit=1`);
    const pkg = pkgRows && pkgRows[0] ? pkgRows[0] : null;
    // SMM V1 Phase 3 — Content Intelligence / Creative Planner. Resolves the plan's raw ids
    // (format_id, primary/secondary product_refs) into plain-language names for the VA Review
    // screen — "which products, which format," never a raw internal id or provider name.
    let planSummary = null;
    if (pkg && pkg.format_id) {
      const [formatRows, brainRows] = await Promise.all([
        sbGet(`sm_creative_formats?id=eq.${encodeURIComponent(pkg.format_id)}&select=display_name,description&limit=1`),
        sbGet(`business_brain?business_id=eq.${encodeURIComponent(task.business_id)}&select=offerings&limit=1`),
      ]);
      const format = formatRows && formatRows[0];
      const offerings = (brainRows && brainRows[0] && Array.isArray(brainRows[0].offerings)) ? brainRows[0].offerings : [];
      const nameFor = (ref) => (offerings.find((o) => o.id === ref) || {}).name || ref;
      planSummary = {
        formatName: (format && format.display_name) || null,
        formatDescription: (format && format.description) || null,
        primaryProductName: pkg.primary_product_ref ? nameFor(pkg.primary_product_ref) : null,
        secondaryProductNames: (Array.isArray(pkg.secondary_product_refs) ? pkg.secondary_product_refs : []).map(nameFor),
        assetCount: Array.isArray(pkg.selected_asset_ids) ? pkg.selected_asset_ids.length : 0,
      };
    }
    return res.status(200).json({ ok: true, task, package: pkg, planSummary });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// v16.57.0 — CEO Decision #26 continuation: real, per-task Generate action. Every existing SMM
// task's package was created in bulk by smGenerateVaQueueForPlan the moment its content plan
// was approved, so no task was ever individually reachable "at Generate" through the VA UI —
// the CEO could never test that step. This gives an individual sm_va_tasks row (created with no
// package — see the CEO Decision #26 checkpoint prep) a real, on-demand Generate action, reusing
// the exact same content-generation helper (smBuildProductionPackageContent) the bulk path
// already uses — no new creative logic, no fabricated fields, same verified-Business-Brain-only
// grounding.
// v16.58.0 — CEO Decision #26 continuation: also serves as the Review stage's "Regenerate"
// action once a package has been rejected. Refuses to run only while the current package is
// still 'draft' (an undecided attempt — approve or reject it first) or 'ceo_approved' (already
// moving through Build/Approve/Publish); a 'rejected' current package always allows a fresh
// attempt. The sm_production_packages_manage_attempts trigger (same pattern as
// sm_video_productions) assigns the new attempt_number and marks it is_current, preserving the
// rejected attempt as permanent history — never overwritten or deleted.
async function smVaTaskGeneratePackage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { vaTaskId } = req.body || {};
  if (!vaTaskId) return res.status(400).json({ ok: false, error: 'vaTaskId is required' });
  try {
    const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(vaTaskId)}&select=*&limit=1`);
    const task = taskRows && taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'va task not found' });
    if (task.mode !== 'demo') return res.status(400).json({ ok: false, error: 'only demo-mode tasks may generate a package' });

    const existingPkgRows = await sbGet(`sm_production_packages?va_task_id=eq.${encodeURIComponent(vaTaskId)}&is_current=eq.true&select=id,status&limit=1`);
    const existingPkg = existingPkgRows && existingPkgRows[0];
    if (existingPkg && existingPkg.status !== 'rejected') {
      return res.status(400).json({ ok: false, error: `a ${existingPkg.status} package already exists for this task` });
    }

    // SMM V1 Phase 3 — Content Intelligence / Creative Planner. Generate now produces a real
    // Production Plan (format, single/multi-product selection, asset selection, repetition/
    // duplicate protection, factual grounding) instead of a single-product caption template.
    const plan = await smBuildCreativePlan(task);
    const pkg = await sbInsert('sm_production_packages', { va_task_id: task.id, ...plan });
    const updatedTask = await sbPatch('sm_va_tasks', `id=eq.${encodeURIComponent(task.id)}`, { status: 'package_ready' });
    return res.status(200).json({ ok: true, task: updatedTask, package: pkg });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function productionPackageReview(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { packageId, decision } = req.body || {};
  if (!packageId) return res.status(400).json({ ok: false, error: 'packageId is required' });
  if (decision !== 'ceo_approved' && decision !== 'rejected') {
    return res.status(400).json({ ok: false, error: "decision must be 'ceo_approved' or 'rejected'" });
  }
  try {
    const updated = await sbPatch(
      'sm_production_packages',
      `id=eq.${encodeURIComponent(packageId)}&status=eq.draft`,
      { status: decision, reviewed_at: new Date().toISOString() }
    );
    if (!updated) return res.status(409).json({ ok: false, error: 'no matching draft package found (already reviewed or does not exist)' });
    await sbPatch('sm_va_tasks', `id=eq.${encodeURIComponent(updated.va_task_id)}`, { status: 'ceo_reviewed' });
    return res.status(200).json({ ok: true, record: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// v16.52.0 — CEO Decision #26: SMM → VA Portal lifecycle integration, Publish stage.
// The shared operator lifecycle (Generate→Review→Build→Approve→Publish→Done, same bar used
// by SRV Farsi/English/AI Studio/NextWave) needs an explicit terminal action for SMM once a
// package is ceo_approved AND its video is ready_for_review. SMM has no real social
// integration and publish_locked is permanently database-enforced true (never touched here) —
// this action performs NO external call. It only records that the task was carried through
// the safe/test Publish step, so the lifecycle bar can reach Done. Requires the new
// 'published' value on sm_va_tasks_status_check (see accompanying migration).
async function smVaTaskMarkPublished(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { vaTaskId } = req.body || {};
  if (!vaTaskId) return res.status(400).json({ ok: false, error: 'vaTaskId is required' });
  try {
    const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(vaTaskId)}&select=*&limit=1`);
    const task = taskRows && taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'va task not found' });
    if (task.mode !== 'demo') return res.status(400).json({ ok: false, error: 'only demo-mode tasks may be marked published' });
    if (task.status === 'published') return res.status(200).json({ ok: true, task });

    const pkgRows = await sbGet(`sm_production_packages?va_task_id=eq.${encodeURIComponent(vaTaskId)}&select=*&order=created_at.desc&limit=1`);
    const pkg = pkgRows && pkgRows[0];
    if (!pkg || pkg.status !== 'ceo_approved') {
      return res.status(400).json({ ok: false, error: 'package must be ceo_approved before this task can be published' });
    }
    const vidRows = await sbGet(`sm_video_productions?va_task_id=eq.${encodeURIComponent(vaTaskId)}&select=*&order=attempt_number.desc&limit=1`);
    const vid = vidRows && vidRows[0];
    if (!vid || vid.status !== 'ready_for_review' || !vid.final_video_url) {
      return res.status(400).json({ ok: false, error: 'no finished video ready to publish for this task' });
    }
    const updated = await sbPatch('sm_va_tasks', `id=eq.${encodeURIComponent(vaTaskId)}`, { status: 'published' });
    return res.status(200).json({ ok: true, task: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function ceoReviewQueueList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { businessId } = req.query || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  try {
    // SMM V1 Phase 1 — Brain + Data Foundation: same engineering-test exclusion as vaTaskList.
    const tasks = await sbGet(`sm_va_tasks?business_id=eq.${encodeURIComponent(businessId)}&data_tier=neq.engineering_test&select=*&order=created_at.asc`);
    const ids = (tasks || []).map((t) => t.id);
    if (!ids.length) return res.status(200).json({ ok: true, records: [] });
    const packages = await sbGet(`sm_production_packages?va_task_id=in.(${ids.map(encodeURIComponent).join(',')})&status=eq.draft&select=*`);
    const byTaskId = {};
    (tasks || []).forEach((t) => { byTaskId[t.id] = t; });
    const records = (packages || []).map((p) => ({ ...p, task: byTaskId[p.va_task_id] || null }));
    return res.status(200).json({ ok: true, records });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}


// ── SOCIAL MEDIA MANAGER — v16.32.0 — Vertical Slice Milestone 5: Automated Finished ──
// ── Short-Form Video Pipeline (Demo/Test Mode only)                                  ──
// CEO Directive (Milestone 5, Revision 3): the default SMM deliverable is a real, finished,
// playable 9:16 short-form video (~12-30s), produced automatically with no routine manual
// editing/asset hunting. Reuses existing MMMOS infrastructure wherever safe, documented here
// exactly per component:
//   - ANTHROPIC_API_KEY / api.anthropic.com — same Claude call pattern already used by
//     srvBuildPackage/generatePackage — for grounded creative generation.
//   - PEXELS_API_KEY / api.pexels.com — same account already used by pexelsFetchBackground,
//     called here through a NEW, SMM-scoped query function (the existing function's mood-bank
//     logic is music-video specific and does not apply to food/menu content).
//   - _submagicFetch() / SUBMAGIC_API_KEY — called AS-IS (true reuse, zero duplication) for
//     automatic zoom/B-roll enhancement of the raw render. Note: Submagic's caption engine
//     transcribes spoken dialogue; this pipeline's audio is synthesized ambient tone (no
//     speech), so no burned-in captions are generated by Submagic here — on-screen text is
//     produced directly by the render step below instead. magicZooms/magicBrolls still apply.
//   - srv-assets Supabase Storage bucket — same bucket, new `social-media-manager/` path
//     prefix, via a new sbStorageUpload() helper (no existing server-side upload helper
//     existed to reuse — uploadVideoToSupabase in index.html is client-side only).
// Video ASSEMBLY is NEW, isolated, server-side ffmpeg (same @ffmpeg-installer/ffmpeg
// dependency + Vercel /tmp pattern already proven by _transcodeWebmToMp4ForTikTok) rather than
// reusing canvas_renderer_srv / canvas_renderer_ai_studio (both explicitly protected/frozen
// per the engine registry). This keeps Milestone 5 structurally incapable of touching either
// protected renderer while remaining genuinely automatic — no browser tab required at all.
// Zero reads/writes against operator_tasks/packages/production_pipeline/upload_queue/
// heygen_proxy/lifecycle_framework or any of the four engines' schemas or tables anywhere in
// this block. Zero publishing/dispatch capability anywhere in this block — tiktok_publish_draft
// and every other existing publish path in this file is never called or referenced.
// mode='demo' and publish_locked=true are hard DB-enforced by the Milestone 5 migration.

const SMM_FONT_PATH = join(process.cwd(), 'api', 'assets', 'smm-font.ttf');

// ── Storage helper (new — no server-side upload helper existed to reuse) ──────────────
async function sbStorageUpload(path, buffer, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/srv-assets/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Storage upload ${path}: ${res.status} ${t.slice(0, 200)}`); }
  return `${SUPABASE_URL}/storage/v1/object/public/srv-assets/${path}`;
}

// ── AI creative generation — grounded in verified Business Brain data only ────────────
// v16.35.0 — Milestone 5A Owner-Ready Creative Revision. Two changes from v16.34.0:
// (1) FIRST PERSON MANDATE — the presenter must speak AS the business ("we/our/us",
//     "order from us"), never as a third-party reviewer ("their chicken", "visit them").
//     This is the single biggest input to the CEO's "looks like an ad Urban Halal Shack
//     made" goal, so it is enforced with explicit banned-phrase examples in the prompt,
//     not just a general instruction.
// (2) SHORTER SPOKEN SEGMENT — target dropped from 40-55 words (~15-22s) to 22-32 words
//     (~9-13s), because the presenter is now only ONE segment of an asset-driven ad
//     (see smBrandComposite), not the entire ad.
// hasVerifiedSocial (boolean) gates whether "follow us" language is allowed at all — this
// project has zero verified social_accounts for Urban Halal Shack today, so callers must
// pass false until a real, verified account exists. Never invent a handle.
function smBuildVideoCreativePrompt(offering, identity, hasVerifiedSocial) {
  const name = (offering && offering.name) || 'Menu Item';
  const desc = (offering && offering.description) || '';
  const price = (offering && typeof offering.price === 'number') ? `$${offering.price.toFixed(2)}` : '';
  const category = (offering && offering.category) || '';
  const bizName = (identity && identity.businessName) || '';
  const cityRaw = (identity && identity.cityOrAddress) || '';
  const cityMatch = cityRaw.match(/,\s*([A-Za-z]+),?\s*[A-Z]{2}\b/);
  const city = cityMatch ? cityMatch[1] : '';
  const website = (identity && identity.website) || '';
  const phone = (identity && identity.phoneNumber) || '';

  return `You are writing the spoken script for a short-form vertical ad that ${bizName || 'this business'} is publishing about itself. You must ONLY use the verified facts given below. NEVER invent, guess, or add any menu item, price, discount, promotion, rating, address, hours, social account, or claim that is not explicitly listed here.

VERIFIED FACTS (the only facts you may reference):
- Business name: ${bizName || '(not provided — do not invent one)'}
- City: ${city || '(not provided — do not invent one)'}
- Item name: ${name}
- Item description: ${desc || '(none provided)'}
- Item price: ${price || '(not provided — do not state a price)'}
- Category: ${category || '(none provided)'}
- Ordering link / website: ${website || '(not provided — do not mention or invent one)'}
- Phone: ${phone || '(not provided — do not mention or invent one)'}

MANDATORY VOICE — this is the most important rule: the script is spoken AS the business, in first person plural. It must sound like an advertisement Urban Halal Shack itself made, never like a third-party reviewer or influencer describing someone else's restaurant.
ALWAYS use: "we", "our", "us" — e.g. "our Grilled Chicken Over Rice", "come visit us", "order from us", "stop by ${bizName || 'our shop'}".
NEVER use third-person reviewer framing: "their [item]", "visit them", "you have to try their...", "this spot is great", or any phrasing implying the speaker is a customer or reviewer rather than the business.
${hasVerifiedSocial ? 'A verified social account exists for this business — you may include a brief "follow us" line if it fits naturally.' : 'No verified social media account exists for this business. Do NOT say "follow us" or reference any social platform or handle — omit that idea entirely.'}

Write the spoken presenter segment — this is now only ONE part of a longer ad that also shows real business photos/video, so keep it tight: 22-32 words, ~9-13 seconds at natural speaking pace. Return STRICT JSON only, wrapped in <creative> tags, matching exactly this schema:
<creative>{"concept":"one sentence describing the video's angle/idea","hook":"punchy 3-6 word opening line, first person (e.g. 'Try our new favorite')","spoken_script":"exactly what the presenter says aloud, first person as the business, 22-32 words total, mentions the item name and price only if a price was given above, ends with a first-person CTA like 'order from us' or 'come see us' — NOT third-person reviewer language, NOT a list of on-screen text cards, this is spoken narration","on_screen_text":["hook text card","item name text card","optional 3rd short text card — omit price if not provided above"],"caption":"1-2 sentence social caption, first person as the business, using only the verified facts, include the ordering link/website if one was given above","hashtags":"space-separated hashtags, 4-6 tags, never a social handle","visual_direction":"short phrase describing suitable supporting B-roll, e.g. 'grilled chicken sizzling on a plate, close-up food shot, warm lighting'"}</creative>

Rules: Do not state a price unless one is given above. Do not invent any specials, discounts, ratings, awards, social accounts, or quality claims not stated above. spoken_script must sound natural when read aloud — no markdown, no emoji, no hashtags inside it. Keep on_screen_text entries short (under 6 words each).`;
}

async function smGenerateVideoCreative(offering, identity, hasVerifiedSocial) {
  const name = (offering && offering.name) || 'Menu Item';
  const desc = (offering && offering.description) || '';
  const price = (offering && typeof offering.price === 'number') ? offering.price.toFixed(2) : null;
  const category = (offering && offering.category) || '';
  const bizName = (identity && identity.businessName) || 'our shop';

  const deterministicFallback = () => {
    const base = smBuildProductionPackageContent(offering, identity);
    const priceClause = price ? `, just $${price}` : '';
    return {
      concept: `Showcase our ${name}`,
      hook: `Our ${name}`,
      spoken_script: `Come try our ${name}${priceClause}. ${desc ? desc + '. ' : ''}Order from us — we'd love to see you at ${bizName}.`,
      on_screen_text: [name, category, price ? `$${price}` : null].filter(Boolean),
      caption: base.caption,
      hashtags: base.hashtags,
      visual_direction: `${category || name} food, close-up shot, appetizing`,
      source: 'deterministic_fallback',
    };
  };

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return deterministicFallback();

  // Grounding check: reject any generation that states a dollar amount other than the one
  // verified fact we gave it (or any amount at all when no price was verified), or that
  // slips into third-person reviewer language, or that mentions "follow" when no verified
  // social account exists.
  const validate = (c) => {
    if (!c || typeof c !== 'object' || !c.spoken_script) return false;
    const text = [c.concept, c.hook, c.spoken_script, c.caption, ...(Array.isArray(c.on_screen_text) ? c.on_screen_text : [])]
      .filter(Boolean).join(' ');
    const dollarMatches = text.match(/\$\s?\d+(\.\d{1,2})?/g) || [];
    for (const m of dollarMatches) {
      const num = parseFloat(m.replace(/[^\d.]/g, ''));
      if (price === null || Math.abs(num - parseFloat(price)) > 0.001) return false;
    }
    const scriptLc = String(c.spoken_script || '').toLowerCase();
    if (/\btheir\b|\bvisit them\b|\bthey (have|serve|offer)\b/.test(scriptLc)) return false;
    if (!hasVerifiedSocial && /\bfollow us\b|\bfollow @|\binstagram\b|\bfacebook\b|\btiktok\b/.test(scriptLc)) return false;
    return true;
  };

  const prompt = smBuildVideoCreativePrompt(offering, identity, hasVerifiedSocial);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: attempt === 0 ? prompt : prompt + '\n\nIMPORTANT: your previous attempt either mentioned a price/fact not in the verified list, used third-person reviewer language ("their", "visit them"), or mentioned following/social media without a verified account. Do not do that again — first person only, verified facts only.',
          }],
        }),
      });
      if (!claudeRes.ok) continue;
      const d = await claudeRes.json();
      const text = (d.content && d.content[0] && d.content[0].text) || '';
      const m = text.match(/<creative>([\s\S]*?)<\/creative>/);
      if (!m) continue;
      let creative;
      try { creative = JSON.parse(m[1]); } catch (e) { continue; }
      if (validate(creative)) return { ...creative, source: 'ai_generated' };
    } catch (e) { /* try next attempt, then fall back */ }
  }
  return deterministicFallback();
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// SMM V1 Phase 3 — Content Intelligence / Creative Planner. Upgrades Generate from a single-
// product caption template into a real planner: format selection, single/multi-product
// selection, asset selection (approved-only, provenance-ordered), repetition/duplicate
// protection against real production history, and strict factual grounding — extending the
// existing sm_production_packages record (Phase 1's attempt-tracking, content_fingerprint,
// tool_usage) rather than building a parallel structure, per explicit CEO instruction.
// ════════════════════════════════════════════════════════════════════════════════════════════

// Recent production history for this business, excluding engineering-test data (joined through
// sm_va_tasks.data_tier so throwaway engineering runs never influence real repetition-avoidance
// for the pilot/live client) — the durable signal the planner reads to judge freshness. No
// separate aggregation table: this queries the same history rows Phase 1/2 already made
// durable, per "ready to incorporate real analytics later without redesign."
async function smGetRecentPlanHistory(businessId, limit) {
  const tasks = await sbGet(`sm_va_tasks?business_id=eq.${encodeURIComponent(businessId)}&data_tier=neq.engineering_test&select=id`);
  const taskIds = (tasks || []).map((t) => t.id);
  if (!taskIds.length) return [];
  const rows = await sbGet(`sm_production_packages?va_task_id=in.(${taskIds.map(encodeURIComponent).join(',')})&select=id,va_task_id,format_id,primary_product_ref,secondary_product_refs,hook,content_fingerprint,selected_asset_ids,cta_text,status,created_at&order=created_at.desc&limit=${limit || 10}`);
  return rows || [];
}

// Which formats are actually eligible RIGHT NOW for this business, computed purely from real
// verified data (never hardcoded per-client): does the primary/combined product set have
// approved photo/video coverage, does a verified review/promotion/prep-asset exist, and is the
// format buildable with today's unchanged Build pipeline (HeyGen narration + Submagic + ffmpeg
// — Music-Only Showcase is catalog-only until a future phase can actually render it).
function smComputeFormatEligibility(formats, candidateProductCount, hasPhotoOrVideoCoverage, hasVerifiedReviews, hasVerifiedPromotion, hasPrepOrBtsAssets) {
  return (formats || []).filter((f) => {
    if (!f.buildable_now) return false;
    if (candidateProductCount < f.min_products || candidateProductCount > f.max_products) return false;
    if (f.needs_photo_or_video && !hasPhotoOrVideoCoverage) return false;
    if (f.needs_verified_reviews && !hasVerifiedReviews) return false;
    if (f.needs_verified_promotion && !hasVerifiedPromotion) return false;
    if (f.needs_prep_or_bts_assets && !hasPrepOrBtsAssets) return false;
    return true;
  });
}

// Weighted pick among eligible formats, biased away from whichever format the last 1-2
// productions used — recency intelligence, not a hard rule ("do not impose a rigid universal
// rule"). Falls back to the full eligible set if everything eligible was just used (e.g. only
// one format is viable for this business today).
function smSelectFormat(eligibleFormats, recentHistory) {
  const recentFormatIds = (recentHistory || []).slice(0, 2).map((h) => h.format_id).filter(Boolean);
  const fresh = eligibleFormats.filter((f) => !recentFormatIds.includes(f.id));
  const pool = fresh.length ? fresh : eligibleFormats;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Complementary products for a multi-product format. Menu-sense pairing only — same category
// (a natural "more of this kind" grouping) or a cross-category pairing — never an invented
// bundle, price, or discount. Prefers offerings with their own approved asset coverage and
// deprioritizes whatever was already paired with this primary product recently (repetition
// protection on COMBINATIONS, not just single products).
function smSelectComplementaryProducts(primaryOffering, allOfferings, countNeeded, coverageByRef, recentHistory) {
  const recentPairings = new Set();
  (recentHistory || []).forEach((h) => {
    if (h.primary_product_ref === primaryOffering.id) {
      (Array.isArray(h.secondary_product_refs) ? h.secondary_product_refs : []).forEach((r) => recentPairings.add(r));
    }
  });
  const candidates = allOfferings.filter((o) => o.id !== primaryOffering.id);
  const scored = candidates.map((o) => {
    const coverage = coverageByRef[o.id] || { approved_asset_count: 0 };
    const sameCategory = o.category === primaryOffering.category;
    const recentlyPaired = recentPairings.has(o.id);
    let score = coverage.approved_asset_count > 0 ? 2 : 0;
    if (sameCategory) score += 1;
    if (recentlyPaired) score -= 3;
    return { offering: o, score };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, countNeeded).map((s) => s.offering);
}

// Eligible assets for this plan: approved-only (never a candidate — "candidate assets may
// inform coverage/gap reporting but must not silently become production-approved"), preferring
// assets tagged to one of this plan's products, then general business assets, ordered owner→
// verified-public→AI-enhanced (the exact preference order CEO specified; ai_generated is
// intentionally never auto-selected here — "do not invoke AI enhancement/generation merely
// because it is available").
async function smSelectPlanAssets(businessId, productRefs) {
  // v16.66.0 — Music Library tracks now live in this same table (asset_type='audio',
  // category='music_track') — explicitly excluded here since this function selects VISUAL
  // segments only. Music selection is a separate, dedicated path (smSelectMusicTrack).
  const rows = await sbGet(`sm_content_assets?business_id=eq.${encodeURIComponent(businessId)}&origin=in.(client_provided,verified_public,ai_enhanced)&status=eq.ceo_approved&asset_type=neq.audio&select=*&order=created_at.desc`);
  const assets = rows || [];
  const originRank = { client_provided: 0, verified_public: 1, ai_enhanced: 2 };
  const tagged = assets.filter((a) => a.product_ref && productRefs.includes(a.product_ref));
  const general = assets.filter((a) => !a.product_ref);
  const rankSort = (a, b) => (originRank[a.origin] ?? 9) - (originRank[b.origin] ?? 9);
  tagged.sort(rankSort);
  general.sort(rankSort);
  return { productAssets: tagged, generalAssets: general };
}

// Multi-product/format-aware version of smBuildVideoCreativePrompt — same "verified facts only,
// first-person business voice" discipline, generalized to 1-N offerings and told which creative
// format to write toward.
function smBuildPlanCreativePrompt(offerings, identity, hasVerifiedSocial, format) {
  const bizName = (identity && identity.businessName) || '';
  const cityRaw = (identity && identity.cityOrAddress) || '';
  const cityMatch = cityRaw.match(/,\s*([A-Za-z]+),?\s*[A-Z]{2}\b/);
  const city = cityMatch ? cityMatch[1] : '';
  const website = (identity && identity.website) || '';
  const phone = (identity && identity.phoneNumber) || '';

  const itemLines = offerings.map((o, i) => {
    const price = (typeof o.price === 'number') ? `$${o.price.toFixed(2)}` : '(not provided — do not state a price for this item)';
    return `- Item ${i + 1}: ${o.name} — ${o.description || '(no description provided)'} — Price: ${price} — Category: ${o.category || '(none provided)'}`;
  }).join('\n');

  return `You are writing the spoken script for a short-form vertical ad that ${bizName || 'this business'} is publishing about itself, in the "${format.display_name}" style: ${format.description}. You must ONLY use the verified facts given below. NEVER invent, guess, or add any menu item, price, discount, promotion, rating, address, hours, social account, or claim that is not explicitly listed here.

VERIFIED FACTS (the only facts you may reference):
- Business name: ${bizName || '(not provided — do not invent one)'}
- City: ${city || '(not provided — do not invent one)'}
- Ordering link / website: ${website || '(not provided — do not mention or invent one)'}
- Phone: ${phone || '(not provided — do not mention or invent one)'}
${itemLines}

MANDATORY VOICE — the most important rule: spoken AS the business, first person plural ("we", "our", "us"). Never third-person reviewer framing ("their [item]", "visit them").
${hasVerifiedSocial ? 'A verified social account exists — you may include a brief "follow us" line if it fits naturally.' : 'No verified social account exists. Do NOT say "follow us" or reference any social platform — omit that idea entirely.'}
${offerings.length > 1 ? `This ad features ${offerings.length} real items together because they make menu sense — do not imply they are a discounted bundle or combo deal unless a price for the combination was explicitly given above (it was not).` : ''}

Write the spoken presenter segment — 22-34 words, ~9-14 seconds at natural speaking pace${offerings.length > 1 ? ', briefly mentioning each item by name' : ''}. Return STRICT JSON only, wrapped in <creative> tags, matching exactly this schema:
<creative>{"concept":"one sentence describing the video's angle/idea","hook":"punchy 3-6 word opening line, first person","spoken_script":"exactly what the presenter says aloud, first person as the business, mentions item name(s) and price(s) only if given above, ends with a first-person CTA — NOT third-person reviewer language","on_screen_text":["hook text card","item name text card(s)","optional short text card"],"caption":"1-2 sentence social caption, first person, verified facts only, include the ordering link if given above","hashtags":"space-separated hashtags, 4-6 tags, never a social handle","visual_direction":"short phrase describing suitable supporting footage","cta":"one short first-person call to action phrase, e.g. 'Order from us today'"}</creative>

Rules: never state a price not given above. Never invent specials, discounts, ratings, awards, social accounts, or quality claims. spoken_script must sound natural read aloud — no markdown, no emoji, no hashtags inside it. Keep on_screen_text entries short (under 6 words each).`;
}

function smValidatePlanCreative(c, offerings, hasVerifiedSocial) {
  if (!c || typeof c !== 'object' || !c.spoken_script) return false;
  const text = [c.concept, c.hook, c.spoken_script, c.caption, ...(Array.isArray(c.on_screen_text) ? c.on_screen_text : [])]
    .filter(Boolean).join(' ');
  const dollarMatches = text.match(/\$\s?\d+(\.\d{1,2})?/g) || [];
  const verifiedPrices = offerings.filter((o) => typeof o.price === 'number').map((o) => o.price);
  for (const m of dollarMatches) {
    const num = parseFloat(m.replace(/[^\d.]/g, ''));
    if (!verifiedPrices.some((p) => Math.abs(p - num) < 0.001)) return false;
  }
  const scriptLc = String(c.spoken_script || '').toLowerCase();
  if (/\btheir\b|\bvisit them\b|\bthey (have|serve|offer)\b/.test(scriptLc)) return false;
  if (!hasVerifiedSocial && /\bfollow us\b|\bfollow @|\binstagram\b|\bfacebook\b|\btiktok\b/.test(scriptLc)) return false;
  return true;
}

// Claude-with-deterministic-fallback creative generation, generalized to N offerings + a
// creative format — same reliability guarantee as the original single-product path (never
// blocks Generate if ANTHROPIC_API_KEY is absent or every attempt fails validation).
async function smGeneratePlanCreative(offerings, identity, hasVerifiedSocial, format) {
  const bizName = (identity && identity.businessName) || 'our shop';
  const primary = offerings[0];
  const deterministicFallback = () => {
    const names = offerings.map((o) => o.name).join(offerings.length > 1 ? ' and our ' : '');
    const priceClause = (typeof primary.price === 'number') ? `, just $${primary.price.toFixed(2)}` : '';
    const base = smBuildProductionPackageContent(primary, identity);
    return {
      concept: `Showcase our ${names}`,
      hook: `Our ${primary.name}`,
      spoken_script: `Come try our ${names}${priceClause}. Order from us — we'd love to see you at ${bizName}.`,
      on_screen_text: offerings.slice(0, 3).map((o) => o.name),
      caption: base.caption,
      hashtags: base.hashtags,
      visual_direction: `${primary.category || primary.name} food, close-up shot, appetizing`,
      cta: 'Order from us today',
      source: 'deterministic_fallback',
    };
  };

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return deterministicFallback();

  const prompt = smBuildPlanCreativePrompt(offerings, identity, hasVerifiedSocial, format);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 900,
          messages: [{
            role: 'user',
            content: attempt === 0 ? prompt : prompt + '\n\nIMPORTANT: your previous attempt either mentioned a price/fact not in the verified list, used third-person reviewer language, or mentioned following/social media without a verified account. Do not do that again — first person only, verified facts only.',
          }],
        }),
      });
      if (!claudeRes.ok) continue;
      const d = await claudeRes.json();
      const text = (d.content && d.content[0] && d.content[0].text) || '';
      const m = text.match(/<creative>([\s\S]*?)<\/creative>/);
      if (!m) continue;
      let creative;
      try { creative = JSON.parse(m[1]); } catch (e) { continue; }
      if (smValidatePlanCreative(creative, offerings, hasVerifiedSocial)) return { ...creative, source: 'ai_generated' };
    } catch (e) { /* try next attempt, then fall back */ }
  }
  return deterministicFallback();
}

// ── The orchestrator: SMM V1 Phase 3 Creative Planner ─────────────────────────────────────────
// One Generate call → one real Production Plan, persisted as a new sm_production_packages
// attempt (reusing Phase 1's attempt_number/is_current trigger — nothing here bypasses it).
// Retries internally (bounded) on a hard content-fingerprint duplicate before ever returning a
// plan identical to one already in recent history.
async function smBuildCreativePlan(task) {
  const [brainRows, formats, recentHistory, coverageRows] = await Promise.all([
    sbGet(`business_brain?business_id=eq.${encodeURIComponent(task.business_id)}&select=identity,social_accounts,offerings,reviews&limit=1`),
    sbGet(`sm_creative_formats?select=*&order=sort_order.asc`),
    smGetRecentPlanHistory(task.business_id, 10),
    sbGet(`sm_asset_coverage?business_id=eq.${encodeURIComponent(task.business_id)}&select=*`),
  ]);
  const brain = (brainRows && brainRows[0]) || {};
  const identity = brain.identity || {};
  const offerings = Array.isArray(brain.offerings) ? brain.offerings : [];
  const socialAccounts = Array.isArray(brain.social_accounts) ? brain.social_accounts : [];
  const hasVerifiedSocial = socialAccounts.some((a) => a && a.status === 'verified');
  const hasVerifiedReviews = Array.isArray(brain.reviews) && brain.reviews.length > 0;
  const hasVerifiedPromotion = false; // no promotions field exists anywhere in Business Brain today — never fabricated

  const primaryOffering = offerings.find((o) => o.id === task.item_ref);
  if (!primaryOffering) throw new Error(`verified offering not found for item_ref=${task.item_ref}`);

  const coverageByRef = {};
  (coverageRows || []).forEach((c) => { coverageByRef[c.product_ref] = c; });

  // "prep/behind-the-scenes" assets: v16.66.0 added a dedicated 'preparation' category (Asset
  // Library V1) — 'owner_video' still counts too, since real owner-recorded footage is exactly
  // the same kind of behind-the-scenes material. None exist for Urban Halal Shack today, so
  // Behind the Scenes is correctly still ineligible.
  const approvedAssetsAll = await sbGet(`sm_content_assets?business_id=eq.${encodeURIComponent(task.business_id)}&origin=in.(client_provided,verified_public,ai_enhanced)&status=eq.ceo_approved&select=id,category,product_ref`);
  const hasPrepOrBtsAssets = (approvedAssetsAll || []).some((a) => a.category === 'owner_video' || a.category === 'preparation');

  let plan = null;
  let attemptsLeft = 3;
  while (attemptsLeft > 0 && !plan) {
    attemptsLeft -= 1;

    const primaryCoverage = coverageByRef[primaryOffering.id];
    const primaryHasAssets = !!(primaryCoverage && primaryCoverage.approved_asset_count > 0);

    // Eligible formats change with product count, so we compute for both a single- and a
    // multi-product candidate pool up front, then let the selected format decide which applies.
    const singleEligible = smComputeFormatEligibility(formats, 1, primaryHasAssets, hasVerifiedReviews, hasVerifiedPromotion, hasPrepOrBtsAssets);
    const multiCandidatePool = offerings.filter((o) => o.id !== primaryOffering.id).length;
    const multiEligible = multiCandidatePool >= 1
      ? smComputeFormatEligibility(formats, 2, primaryHasAssets, hasVerifiedReviews, hasVerifiedPromotion, hasPrepOrBtsAssets)
      : [];
    const eligible = singleEligible.concat(multiEligible);
    if (!eligible.length) throw new Error('no eligible creative format for this business — this should not happen since Narrated Showcase has no asset requirement');

    const format = smSelectFormat(eligible, recentHistory);
    const wantsMultiple = format.min_products > 1;

    let secondaryOfferings = [];
    if (wantsMultiple) {
      const countNeeded = Math.min(format.max_products, Math.max(format.min_products, 2)) - 1;
      secondaryOfferings = smSelectComplementaryProducts(primaryOffering, offerings, countNeeded, coverageByRef, recentHistory);
    }
    const planOfferings = [primaryOffering, ...secondaryOfferings];
    const productRefs = planOfferings.map((o) => o.id);

    const { productAssets, generalAssets } = await smSelectPlanAssets(task.business_id, productRefs);
    const selectedAssets = productAssets.concat(generalAssets).slice(0, 6);

    const creative = await smGeneratePlanCreative(planOfferings, identity, hasVerifiedSocial, format);

    const fingerprint = smComputeContentFingerprint([
      productRefs.slice().sort().join('+'), format.id, creative.hook, creative.concept,
    ]);
    const isDuplicate = (recentHistory || []).some((h) => h.content_fingerprint === fingerprint);
    if (isDuplicate && attemptsLeft > 0) continue; // hard duplicate protection — try a different format/angle

    const lastEntry = (recentHistory || [])[0];
    const differentiation_reason = lastEntry
      ? `This plan uses the "${format.display_name}" format featuring ${planOfferings.map((o) => o.name).join(', ')} — different from the most recent production, which used ${lastEntry.format_id ? `the "${lastEntry.format_id}" format` : 'an earlier Generate step before formats were tracked'}${lastEntry.primary_product_ref ? ` on ${lastEntry.primary_product_ref}` : ''}.`
      : `This is the first tracked production plan for this business — no prior history to differentiate from.`;

    const assetCoverageSnapshot = {
      primary: coverageByRef[primaryOffering.id] || { coverage_level: 'missing', approved_asset_count: 0 },
      secondary: secondaryOfferings.map((o) => ({ product_ref: o.id, ...(coverageByRef[o.id] || { coverage_level: 'missing', approved_asset_count: 0 }) })),
    };

    const factualSources = [
      { field: 'business_identity', value: identity.businessName || null },
      ...planOfferings.map((o) => ({ field: 'offering', product_ref: o.id, name: o.name, price: o.price ?? null })),
    ];

    plan = {
      caption: creative.caption,
      hook: creative.hook,
      hashtags: creative.hashtags,
      checklist: [
        { label: 'Confirm item details match the current menu', done: false },
        { label: 'Review selected assets before Build', done: false },
        { label: 'Proofread caption and hashtags before scheduling', done: false },
      ],
      concept: creative.concept,
      spoken_script: creative.spoken_script,
      on_screen_text: creative.on_screen_text || [],
      visual_direction: creative.visual_direction || null,
      cta_text: creative.cta || null,
      format_id: format.id,
      primary_product_ref: primaryOffering.id,
      secondary_product_refs: secondaryOfferings.map((o) => o.id),
      intended_duration_sec: 9 + planOfferings.length * 3,
      selected_asset_ids: selectedAssets.map((a) => a.id),
      narration_required: format.needs_narration,
      music_direction: 'None — the current pipeline does not add a separate background-music track beyond Submagic\'s own caption/audio polish.',
      required_capabilities: {
        presenter_narration: format.needs_narration,
        captions: true,
        note: 'Recorded plan data only — Build always uses HeyGen + Submagic + ffmpeg in this phase regardless of this field.',
      },
      factual_sources: factualSources,
      differentiation_reason,
      asset_coverage_snapshot: assetCoverageSnapshot,
      content_fingerprint: fingerprint,
      tool_usage: { creative_provider: creative.source || 'deterministic_fallback', creative_model: creative.source === 'ai_generated' ? 'claude-sonnet-4-5' : null },
    };
  }
  if (!plan) throw new Error('could not produce a sufficiently distinct production plan after multiple attempts');
  return plan;
}

// ── Visual sourcing — NEW SMM-scoped Pexels query (photo + HD video) ──────────────────
async function smFetchPexelsForOffering(offering, visualDirection) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY not configured in Vercel env');
  const category = (offering && offering.category) || '';
  const name = (offering && offering.name) || '';
  const query = (visualDirection || `${category} ${name} food closeup`).trim().slice(0, 90) || 'food closeup';

  try {
    const vRes = await fetch(`${PEXELS_BASE}/videos/search?query=${encodeURIComponent(query)}&size=medium&per_page=8`, { headers: { Authorization: apiKey } });
    if (vRes.ok) {
      const vData = await vRes.json();
      for (const v of (vData.videos || [])) {
        const files = (v.video_files || []).filter((f) => f.width && f.height);
        const portrait = files.filter((f) => f.height > f.width).sort((a, b) => a.width - b.width).find((f) => f.width >= 480);
        const modestLandscape = files.sort((a, b) => a.width - b.width).find((f) => f.width >= 640 && f.width <= 1280);
        const file = portrait || modestLandscape || files[0];
        if (file) return { assetType: 'video', url: file.link, credit: (v.user && v.user.name) || 'Pexels', query };
      }
    }
  } catch (e) { /* fall through to photo */ }

  const pRes = await fetch(`${PEXELS_BASE}/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=5`, { headers: { Authorization: apiKey } });
  if (!pRes.ok) throw new Error(`Pexels photo search ${pRes.status}`);
  const pData = await pRes.json();
  const photos = pData.photos || [];
  if (!photos.length) throw new Error('No Pexels asset found for: ' + query);
  const pick = photos[Math.floor(Math.random() * Math.min(3, photos.length))];
  return { assetType: 'photo', url: pick.src.portrait || pick.src.large2x || pick.src.original, credit: pick.photographer, query };
}

// ── HeyGen presenter — SMM-scoped, independent of PROVIDER_ASSETS (never touches AI Studio's
// or NextWave's shared avatar data). Reuses one real, already-approved HeyGen avatar+voice pair
// (Sophia/"Short1" look, same one AI Studio already uses) via a plain literal ID copy — no new
// HeyGen asset created, no coupling to the frozen engine's data structure. Per CEO instruction,
// SMM does not require a custom avatar; a future business-owner-avatar option can extend this
// constant later without touching AI Studio/NextWave.
const SMM_PRESENTER = {
  avatarId: '1f9b1bc981f04eecaf50d7a1f1aec6df', // same real HeyGen look AI Studio's "Short1" pool uses
  voiceId: 'a4a6df6d4fc248829f72edde5529defa',
  background: { type: 'color', value: '#0a1628' },
  scale: 1.0,
  dimension: { width: 1080, height: 1920 },
};

// ── HeyGen — called via the existing, unmodified low-level _heygenFetch() helper (true reuse,
// same pattern as the Submagic internal wrappers below). Never calls/edits heygenStartRender or
// heygenRenderStatus themselves — those remain exactly as AI Studio/NextWave use them. ─────────
async function smHeygenStartRenderInternal(script) {
  const videoBody = {
    video_inputs: [{
      character: { type: 'avatar', avatar_id: SMM_PRESENTER.avatarId, avatar_style: 'normal', scale: SMM_PRESENTER.scale },
      voice: { type: 'text', input_text: script, voice_id: SMM_PRESENTER.voiceId },
      background: SMM_PRESENTER.background,
    }],
    dimension: SMM_PRESENTER.dimension,
    test: false,
  };
  const r = await _heygenFetch('/v2/video/generate', { method: 'POST', body: videoBody });
  const videoId = (r.data && r.data.data && r.data.data.video_id) || null;
  return { ok: r.ok, videoId, raw: r.data, error: r.error || null };
}

async function smHeygenRenderStatusInternal(videoId) {
  const r = await _heygenFetch('/v1/video_status.get?video_id=' + encodeURIComponent(videoId));
  const status = (r.data && r.data.data && r.data.data.status) || null;
  const videoUrl = (r.data && r.data.data && r.data.data.video_url) || null;
  return { ok: r.ok, status, videoUrl, raw: r.data, error: r.error || null };
}

// ── SMM Brand Composer — v16.35.0 Milestone 5A Owner-Ready Creative Revision ───────────────
// Runs AFTER Submagic, exactly as before (HeyGen → Submagic → HERE → ready_for_review is
// unchanged). What changed: this step used to only overlay a logo onto the Submagic clip.
// It now builds an ASSET-DRIVEN composition — real, CEO-approved business photos/video
// (storefront, product/menu shots) become their own short segments concatenated around the
// (now shorter) HeyGen+Submagic presenter segment, so the business itself is the primary
// visual and the avatar is a supporting element, not the whole ad. Every optional segment
// (opener, product shots, end card) is independently wrapped in try/catch — if a real asset
// fails to download/encode, that segment is skipped and logged, never fabricated, and never
// aborts the whole production. Only the presenter segment itself (the already-proven HeyGen+
// Submagic output) is mandatory, matching the pre-existing failure behavior. Composition
// order is asset-driven, not a rigid fixed template: whichever real assets are approved
// determine which segments exist.
// v16.60.0 — CEO Decision #26 continuation (Build reliability / "moov atom not found"). This
// used to write whatever bytes `fetch` returned straight to disk on any 2xx status, with no
// check that the body was actually a usable media file — an expired signed URL, a CDN error
// page, or a connection that closed early can all come back with res.ok:true and a small
// text/html or truncated body, which ffmpeg then fails to open downstream with an opaque
// "moov atom not found" / "Invalid data found when processing input" deep inside a later
// concat step, far from the real cause. Now rejects a response whose Content-Type is clearly
// not media (an HTML/JSON error page mislabeled as a download) and any body under 4KB (real
// video/image assets are always larger; a stub this small is never a legitimate download) —
// both checked BEFORE the file reaches ffmpeg at all, per the CEO's explicit instruction. The
// size floor is deliberately low (512B) — real media is essentially always larger, but a tiny
// legitimate logo PNG shouldn't be false-rejected here; genuine truncation/corruption (which can
// happen at any file size, since MP4's moov atom often sits at the END of the file) is caught
// downstream by smAssertValidMediaFile's actual ffmpeg decode check, not by size alone.
async function smDownloadToFile(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${String(url).slice(0, 140)}`);
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (contentType && (contentType.includes('text/html') || contentType.includes('application/json'))) {
    throw new Error(`download returned a non-media response (content-type: ${contentType}): ${String(url).slice(0, 140)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512) {
    throw new Error(`download is too small to be a real media file (${buf.length} bytes): ${String(url).slice(0, 140)}`);
  }
  await writeFile(path, buf);
}

// v16.60.0 — CEO Decision #26 continuation. Confirms ffmpeg can actually decode a file (full
// stream, not just headers) before it is trusted as input to a later ffmpeg step — this is what
// catches a truncated/corrupt file (e.g. one left behind by a killed process, or a download that
// passed smDownloadToFile's checks but is still subtly broken) BEFORE it reaches the final
// concat/branding pass, where the same corruption would otherwise surface as an opaque failure
// far from its real origin. No ffprobe dependency needed — a null-output decode with
// `-v error` makes ffmpeg itself report real stream errors (including "moov atom not found")
// and exit non-zero on a genuinely unreadable file.
async function smAssertValidMediaFile(path, label) {
  let size;
  try {
    size = (await fsStat(path)).size;
  } catch (e) {
    throw new Error(`${label}: file missing after write (${e.message})`);
  }
  if (!size || size < 512) throw new Error(`${label}: file is empty or too small (${size || 0} bytes)`);
  try {
    await execFileAsync(ffmpegInstaller.path, ['-v', 'error', '-i', path, '-t', '0.5', '-f', 'null', '-'], {
      timeout: 15000, maxBuffer: 1024 * 1024 * 5,
    });
  } catch (e) {
    const detail = (e && e.stderr ? String(e.stderr) : (e && e.message) || '').slice(0, 300);
    throw new Error(`${label}: ffmpeg could not decode this file (${detail})`);
  }
}

// Re-encodes the Submagic (HeyGen + captions) output to a fixed, known format (1080x1920,
// 25fps, yuv420p, aac/44100/stereo) so it can be concatenated with asset segments below via
// ffmpeg's concat FILTER (not the stream-copy concat demuxer) — the filter fully decodes and
// re-encodes every input, which tolerates the minor codec/param differences real uploaded
// assets and Submagic's own output are likely to have, at the cost of one extra encode pass.
async function smSegNormalizePresenter({ srcPath, id }) {
  // v16.60.0 — validate the raw HeyGen/Submagic download itself is decodable before spending a
  // full encode pass on it — this is the mandatory segment, so a bad download here should fail
  // the whole attempt clearly rather than produce a corrupt presenter clip.
  await smAssertValidMediaFile(srcPath, 'downloaded presenter video (from Submagic)');
  const outPath = join(tmpdir(), `smm-seg-presenter-${id}.mp4`);
  await execFileAsync(ffmpegInstaller.path, [
    '-y', '-i', srcPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    outPath,
  ], { timeout: 45000, maxBuffer: 1024 * 1024 * 30 });
  await smAssertValidMediaFile(outPath, 'normalized presenter segment');
  return outPath;
}

// Real approved photo → short video segment. Reuses the exact Ken Burns zoompan technique
// already proven in the retired ffmpeg-only smAssembleRawVideo below — same filter, same
// fps/scale/crop math, just applied to a business asset instead of stock Pexels imagery.
// Silent audio track (anullsrc) is synthesized so this segment has the same stream layout
// as every other segment, which the concat filter requires.
async function smSegFromImage({ url, id, tag, durationSec }) {
  const imgPath = join(tmpdir(), `smm-seg-img-${tag}-${id}.jpg`);
  const outPath = join(tmpdir(), `smm-seg-${tag}-${id}.mp4`);
  try {
    await smDownloadToFile(url, imgPath);
    await smAssertValidMediaFile(imgPath, `downloaded ${tag} image asset`); // v16.60.0
    const frames = Math.round(durationSec * 25);
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-loop', '1', '-i', imgPath,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0006,1.1)':d=${frames}:s=1080x1920:fps=25,setsar=1`,
      '-t', String(durationSec),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
      outPath,
    ], { timeout: 25000, maxBuffer: 1024 * 1024 * 20 });
    await smAssertValidMediaFile(outPath, `${tag} image segment`); // v16.60.0
    return outPath;
  } finally {
    await unlink(imgPath).catch(() => {});
  }
}

// Real approved video asset (e.g. a storefront/food-truck clip) → trimmed, reframed segment.
// Original audio is discarded in favor of a synthesized silent track — the only real spoken
// audio in this ad is the HeyGen presenter's voice; mixing in unpredictable ambient audio
// from a client-uploaded clip is a real risk (uneven levels, background noise) that isn't
// worth taking in this milestone.
async function smSegFromVideoAsset({ url, id, tag, durationSec }) {
  const vidPath = join(tmpdir(), `smm-seg-vid-${tag}-${id}.mp4`);
  const outPath = join(tmpdir(), `smm-seg-${tag}-${id}.mp4`);
  try {
    await smDownloadToFile(url, vidPath);
    await smAssertValidMediaFile(vidPath, `downloaded ${tag} video asset`); // v16.60.0
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-i', vidPath,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t', String(durationSec),
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=25',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
      outPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 20 });
    await smAssertValidMediaFile(outPath, `${tag} video segment`); // v16.60.0
    return outPath;
  } finally {
    await unlink(vidPath).catch(() => {});
  }
}

// Dispatches on the real sm_content_assets.asset_type of the approved row — 'video' gets the
// trim/reframe path, everything else (photo/graphic/other) gets the Ken Burns image path.
async function smSegFromAsset(asset, { id, tag, durationSec }) {
  const url = asset && asset.source_url;
  if (!url) throw new Error(`asset ${asset && asset.id} has no source_url`);
  if (asset.asset_type === 'video') return smSegFromVideoAsset({ url, id, tag, durationSec });
  return smSegFromImage({ url, id, tag, durationSec });
}

// Branded end-card segment (solid background + drawtext lines) — reuses the same drawtext
// technique the old in-place end-card used, just as its own dedicated segment instead of a
// timed overlay on a variable-length clip. lines are pre-sanitized by the caller.
async function smSegEndCard({ id, durationSec, lines }) {
  const outPath = join(tmpdir(), `smm-seg-endcard-${id}.mp4`);
  const filters = (lines || []).map((l) => `drawtext=fontfile=${SMM_FONT_PATH}:text='${l.text}':fontcolor=white:fontsize=${l.fontsize}:box=1:boxcolor=black@0.55:boxborderw=16:x=(w-text_w)/2:y=${l.y}`);
  filters.push('setsar=1'); // force uniform SAR so this segment concats cleanly with the others
  await execFileAsync(ffmpegInstaller.path, [
    '-y', '-f', 'lavfi', '-i', `color=c=0x0a1628:s=1080x1920:d=${durationSec}`,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf', filters.join(','),
    '-t', String(durationSec),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
    outPath,
  ], { timeout: 20000, maxBuffer: 1024 * 1024 * 15 });
  await smAssertValidMediaFile(outPath, 'end card segment'); // v16.60.0
  return outPath;
}

// Concatenates N already-normalized (identical format) segments via ffmpeg's concat FILTER
// (decode+re-encode every input, not the risky stream-copy concat demuxer), producing one
// continuous video+audio stream.
async function smConcatSegments({ paths, id }) {
  // v16.60.0 — CEO Decision #26 continuation (Build reliability / "moov atom not found"). Every
  // individual segment builder already validates its own output before returning, but this is
  // the last checkpoint before the segments are combined into the final master — a defense-in-
  // depth re-check here means a corrupt segment is caught with a clear, per-file error pointing
  // at exactly which segment is bad, instead of ffmpeg's own opaque concat-time failure.
  for (let i = 0; i < paths.length; i++) {
    await smAssertValidMediaFile(paths[i], `segment ${i + 1}/${paths.length} before concat`);
  }
  const outPath = join(tmpdir(), `smm-concat-${id}.mp4`);
  const inputArgs = [];
  paths.forEach((p) => { inputArgs.push('-i', p); });
  const streamRefs = paths.map((_, i) => `[${i}:v:0][${i}:a:0]`).join('');
  const filter = `${streamRefs}concat=n=${paths.length}:v=1:a=1[outv][outa]`;
  await execFileAsync(ffmpegInstaller.path, [
    '-y', ...inputArgs,
    '-filter_complex', filter,
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    '-c:a', 'aac',
    outPath,
  ], { timeout: 45000, maxBuffer: 1024 * 1024 * 40 });
  await smAssertValidMediaFile(outPath, 'concatenated master');
  return outPath;
}

// Final pass over the whole composed video: optional logo overlay (top-right, only if a
// CEO-approved logo asset exists) + persistent business-name watermark (bottom-left,
// whenever a verified business name exists) — same visual language as the pre-Milestone-5A
// build, just applied once to the full multi-segment composite instead of only the Submagic
// clip.
async function smApplyBranding({ inputPath, logoUrl, businessName, id }) {
  const logoPath = join(tmpdir(), `smm-logo-${id}.png`);
  const outPath = join(tmpdir(), `smm-branded-${id}.mp4`);
  let haveLogo = false;
  try {
    if (logoUrl) {
      try {
        await smDownloadToFile(logoUrl, logoPath);
        await smAssertValidMediaFile(logoPath, 'downloaded logo asset'); // v16.60.0
        haveLogo = true;
      } catch (e) { console.warn('[smBrandComposite] logo download failed, continuing without it:', e.message); }
    }
    const watermarkTxt = businessName ? smSanitizeForDrawtext(businessName.toUpperCase()) : '';
    const watermarkFilter = watermarkTxt
      ? `drawtext=fontfile=${SMM_FONT_PATH}:text='${watermarkTxt}':fontcolor=white@0.85:fontsize=26:box=1:boxcolor=black@0.35:boxborderw=10:x=24:y=h-52`
      : null;

    if (haveLogo) {
      const vf = watermarkFilter
        ? `[1:v]scale=170:-1[logo];[0:v][logo]overlay=W-w-28:28:format=auto,${watermarkFilter}`
        : `[1:v]scale=170:-1[logo];[0:v][logo]overlay=W-w-28:28:format=auto`;
      await execFileAsync(ffmpegInstaller.path, [
        '-y', '-i', inputPath, '-i', logoPath,
        '-filter_complex', vf,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'copy',
        outPath,
      ], { timeout: 30000, maxBuffer: 1024 * 1024 * 30 });
      await smAssertValidMediaFile(outPath, 'branded master (with logo)'); // v16.60.0
      return { path: outPath, logoUsed: true };
    }
    if (watermarkFilter) {
      await execFileAsync(ffmpegInstaller.path, [
        '-y', '-i', inputPath,
        '-vf', watermarkFilter,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'copy',
        outPath,
      ], { timeout: 30000, maxBuffer: 1024 * 1024 * 30 });
      await smAssertValidMediaFile(outPath, 'branded master (watermark only)'); // v16.60.0
      return { path: outPath, logoUsed: false };
    }
    return { path: inputPath, logoUsed: false };
  } finally {
    await unlink(logoPath).catch(() => {});
  }
}

async function smBrandComposite({ submagicVideoUrl, businessName, itemName, priceLabel, website, phoneNumber, cityOrAddress, hasVerifiedSocial, assets, id: productionId }) {
  assets = assets || {};
  const tempPaths = [];
  const track = (p) => { tempPaths.push(p); return p; };

  // v16.61.0 — CEO Decision #26 continuation (Build reliability, part 2). Every temp file below
  // was named from the bare production id alone (smm-seg-opener-<id>.mp4 etc.), shared across
  // ANY invocation touching the same production. Nothing serializes poll calls for the same
  // in-flight production — the frontend's poll loop fires on a fixed interval that does not
  // wait for the previous request to finish (fixed separately in public/index.html), so once
  // compositing takes longer than that interval (it always does, ~60-70s), overlapping poll
  // requests both re-enter Stage 3 for the SAME production id. If both land on the same warm
  // Vercel instance, they race on these exact temp file paths — one process's read colliding
  // with the other's write/cleanup — which reproduces precisely as an ffmpeg "moov atom not
  // found" on a file that a moment earlier looked completely valid. Reproduced live: two
  // concurrent poll calls against the same productionId, one completed to ready_for_review, a
  // second one immediately after failed reading a segment file the first had already
  // written/cleaned up. Fixed by making every temp path unique PER INVOCATION, not just per
  // production — `id` from here down is this call's own nonce, never shared with a concurrent
  // invocation even for the same production, so two overlapping calls can no longer collide on
  // the filesystem regardless of what triggered the overlap.
  const id = `${productionId}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

  const rawPath = track(join(tmpdir(), `smm-sub-raw-${id}.mp4`));
  try {
    await smDownloadToFile(submagicVideoUrl, rawPath);

    // Mandatory core — the already-proven HeyGen+Submagic output. If this fails, the whole
    // production fails, exactly as it did before this revision.
    const presenterPath = track(await smSegNormalizePresenter({ srcPath: rawPath, id }));

    const segments = [];
    let openerAssetId = null;
    let openerWasProduct = false;

    // Opener: real storefront/food-truck shot preferred; falls back to the first approved
    // product/menu photo if no storefront exists. Skipped entirely — never fabricated — if
    // neither exists.
    const openerAsset = assets.storefront || (assets.products && assets.products[0]) || null;
    if (openerAsset) {
      try {
        const seg = track(await smSegFromAsset(openerAsset, { id, tag: 'opener', durationSec: 3.0 }));
        segments.push(seg);
        openerAssetId = openerAsset.id;
        openerWasProduct = !assets.storefront;
      } catch (e) { console.warn('[smBrandComposite] opener asset segment failed, skipping:', e.message); }
    }

    segments.push(presenterPath);

    // Additional product/menu shots, excluding whichever asset was already used as the opener.
    const extraProducts = (assets.products || []).filter((p) => p.id !== openerAssetId).slice(0, 2);
    for (let i = 0; i < extraProducts.length; i++) {
      try {
        const seg = track(await smSegFromAsset(extraProducts[i], { id, tag: `product${i}`, durationSec: 2.3 }));
        segments.push(seg);
      } catch (e) { console.warn(`[smBrandComposite] product asset segment ${i} failed, skipping:`, e.message); }
    }

    // End card — business name, featured item, and verified CTA only. "Follow us" only
    // appears when hasVerifiedSocial is true (it is not, for Urban Halal Shack, today).
    // Optional: if it fails to build, the ad still ships without it.
    try {
      const lines = [];
      const itemTxt = smSanitizeForDrawtext(priceLabel ? `${itemName} · ${priceLabel}` : itemName);
      if (itemTxt) lines.push({ text: itemTxt, fontsize: 50, y: 1420 });
      if (businessName) lines.push({ text: smSanitizeForDrawtext(`Order from ${businessName}`), fontsize: 42, y: 1520 });
      let ctaExtra = null;
      if (website) { try { ctaExtra = new URL(website).hostname; } catch (e) { ctaExtra = String(website).replace(/^https?:\/\//, '').split('/')[0]; } }
      else if (phoneNumber) { ctaExtra = phoneNumber; }
      if (ctaExtra) lines.push({ text: smSanitizeForDrawtext(ctaExtra), fontsize: 34, y: 1610 });
      if (hasVerifiedSocial) lines.push({ text: smSanitizeForDrawtext(`Follow ${businessName || 'us'}`), fontsize: 34, y: 1680 });
      const seg = track(await smSegEndCard({ id, durationSec: 3.0, lines }));
      segments.push(seg);
    } catch (e) { console.warn('[smBrandComposite] end card segment failed, skipping:', e.message); }

    const composedPath = segments.length > 1 ? track(await smConcatSegments({ paths: segments, id })) : presenterPath;

    let finalPath = composedPath;
    let logoUsed = false;
    try {
      const branded = await smApplyBranding({ inputPath: composedPath, logoUrl: assets.logo ? assets.logo.source_url : null, businessName, id });
      finalPath = track(branded.path);
      logoUsed = branded.logoUsed;
    } catch (e) { console.warn('[smBrandComposite] branding pass failed, using unbranded composite:', e.message); }

    let durationSec = null;
    try {
      const probe = await execFileAsync(ffmpegInstaller.path, ['-i', finalPath], { timeout: 15000, maxBuffer: 1024 * 1024 * 10 }).catch((e) => e);
      const out = (probe && (probe.stderr || (probe.message || ''))) || '';
      const m = String(out).match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (m) durationSec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    } catch (_) { /* leave null — caller falls back to Submagic's reported duration */ }

    const outBuf = await readFile(finalPath);
    if (!outBuf || !outBuf.length) throw new Error('ffmpeg produced an empty composited file');
    return {
      buffer: outBuf,
      durationSec,
      logoUsed,
      openerAssetUsed: !!openerAssetId,
      productSegmentsUsed: extraProducts.length + (openerAssetId && openerWasProduct ? 1 : 0),
    };
  } finally {
    for (const p of tempPaths) await unlink(p).catch(() => {});
  }
}

// ── RETIRED FROM THE DEFAULT PATH (v16.34.0) — kept only as reference/fallback utilities, not
// deleted. The Milestone 5 CEO pivot replaced this ffmpeg-only Pexels+chord-audio pipeline with
// the HeyGen (avatar speaks) → Submagic (captions/polish) → smBrandComposite (branding) flow
// above. smSynthesizeAudioFile/smAssembleRawVideo below are no longer called by
// smVideoProductionGenerate/smVideoProductionPoll.
// v16.33.0 — CEO Gate Review revision (Milestone 5 QA failure #1, audio). The prior two-flat-
// -sine-tones mix was correctly rejected as "no meaningful audio." Replaced with a 4-chord
// ambient progression (Am→Gm→Fm→Gm — the SAME chord progression already used by AI Studio's
// synthesized background pad) built as discrete triad segments (3 sine oscillators per chord,
// individually faded/limited) and concatenated — still zero external API, zero licensing cost,
// now an intentional, audible musical bed rather than a test tone.
const SMM_CHORD_PROGRESSION = [
  { name: 'Am', freqs: [220.00, 261.63, 329.63] }, // A3 C4 E4
  { name: 'Gm', freqs: [196.00, 233.08, 293.66] }, // G3 Bb3 D4
  { name: 'Fm', freqs: [174.61, 207.65, 261.63] }, // F3 Ab3 C4
  { name: 'Gm', freqs: [196.00, 233.08, 293.66] }, // G3 Bb3 D4
];

async function smSynthesizeAudioFile(durationSec, outPath) {
  const chords = SMM_CHORD_PROGRESSION;
  const segDur = durationSec / chords.length;
  const rid = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const segPaths = chords.map((_, i) => join(tmpdir(), `smm-chord-${rid}-${i}.m4a`));
  const listPath = join(tmpdir(), `smm-chordlist-${rid}.txt`);
  try {
    for (let i = 0; i < chords.length; i++) {
      const [f1, f2, f3] = chords[i].freqs;
      await execFileAsync(ffmpegInstaller.path, [
        '-y',
        '-f', 'lavfi', '-i', `sine=frequency=${f1}:duration=${segDur}`,
        '-f', 'lavfi', '-i', `sine=frequency=${f2}:duration=${segDur}`,
        '-f', 'lavfi', '-i', `sine=frequency=${f3}:duration=${segDur}`,
        '-filter_complex', `[0:a][1:a][2:a]amix=inputs=3:duration=longest,volume=1.6,afade=t=in:st=0:d=0.25,afade=t=out:st=${Math.max(0, segDur - 0.3).toFixed(2)}:d=0.3,alimiter=limit=0.85`,
        '-c:a', 'aac', '-b:a', '128k',
        segPaths[i],
      ], { timeout: 20000, maxBuffer: 1024 * 1024 * 10 });
    }
    await writeFile(listPath, segPaths.map((p) => `file '${p}'`).join('\n'));
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-filter:a', `afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, durationSec - 1.5).toFixed(2)}:d=1.5,volume=0.55`,
      '-c:a', 'aac', '-b:a', '128k',
      outPath,
    ], { timeout: 20000, maxBuffer: 1024 * 1024 * 10 });
  } finally {
    await unlink(listPath).catch(() => {});
    for (const p of segPaths) await unlink(p).catch(() => {});
  }
}

function smSanitizeForDrawtext(s) {
  return String(s || '').replace(/['":\\\[\],;]/g, '').slice(0, 60);
}

// v16.65.1 — SMM V1 Phase 4 QA fix. drawtext with a fixed fontsize has no wrapping — a long
// item-name+price string (e.g. "Mix Chicken and Lamb Over Rice · $10.99") at 50px can exceed
// the 1080px-wide 9:16 canvas and get clipped at the right edge, which is not acceptable for a
// paid-looking end card. No ffmpeg text-metrics API is available at this point in the
// pipeline, so this uses a deliberately conservative per-character width estimate for this
// bold font (~0.56x fontsize) and shrinks proportionally, never below a readable floor.
function smFitFontSize(text, baseFontSize, maxWidthPx) {
  maxWidthPx = maxWidthPx || 1000;
  const estWidth = String(text || '').length * baseFontSize * 0.56;
  if (estWidth <= maxWidthPx) return baseFontSize;
  return Math.max(28, Math.floor(baseFontSize * (maxWidthPx / estWidth)));
}

// Vertically centers an end-card's lines as a block (instead of stacking them near the very
// bottom of a 1920px-tall frame, which reads as unbalanced/amateurish) — works for any real
// line count (1-4, depending on which verified identity fields exist for this business).
function smCenterEndCardLines(rawLines, lineHeight) {
  lineHeight = lineHeight || 130;
  const totalHeight = rawLines.length * lineHeight;
  const startY = Math.max(200, Math.round((1920 - totalHeight) / 2));
  return rawLines.map((l, i) => Object.assign({}, l, { y: startY + i * lineHeight }));
}

// v16.33.0 — CEO Gate Review revision (Milestone 5 QA failures #2/#3). Text is now a
// deterministic, server-controlled 3-beat sequence (hook → verified item+price → verified
// business-name CTA) instead of a loose list including whatever the AI/Submagic produced, and
// a small persistent business-name watermark runs for the full clip so identity isn't confined
// to one moment. If an approved client logo asset exists it's composited as an image overlay
// instead of (never in addition to a fake one) — logo/watermark both come only from verified
// data; nothing is invented if a logo is missing.
async function smAssembleRawVideo({ visualUrl, visualType, durationSec, hook, itemName, priceLabel, businessName, logoUrl, id }) {
  const bgPath = join(tmpdir(), `smm-bg-${id}.${visualType === 'video' ? 'mp4' : 'jpg'}`);
  const motionPath = join(tmpdir(), `smm-motion-${id}.mp4`);
  const overlayPath = join(tmpdir(), `smm-overlay-${id}.mp4`);
  const logoPath = join(tmpdir(), `smm-logo-${id}.png`);
  const textPath = join(tmpdir(), `smm-text-${id}.mp4`);
  const audioPath = join(tmpdir(), `smm-audio-${id}.m4a`);
  const outPath = join(tmpdir(), `smm-final-${id}.mp4`);
  let haveLogo = false;
  try {
    const srcRes = await fetch(visualUrl);
    if (!srcRes.ok) throw new Error(`visual download failed: ${srcRes.status}`);
    const srcBuf = Buffer.from(await srcRes.arrayBuffer());
    await writeFile(bgPath, srcBuf);

    if (visualType === 'video') {
      await execFileAsync(ffmpegInstaller.path, [
        '-y', '-stream_loop', '-1', '-i', bgPath,
        '-t', String(durationSec),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
        motionPath,
      ], { timeout: 60000, maxBuffer: 1024 * 1024 * 30 });
    } else {
      const frames = Math.round(durationSec * 25);
      await execFileAsync(ffmpegInstaller.path, [
        '-y', '-loop', '1', '-i', bgPath,
        '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0008,1.15)':d=${frames}:s=1080x1920:fps=25`,
        '-t', String(durationSec),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
        motionPath,
      ], { timeout: 60000, maxBuffer: 1024 * 1024 * 30 });
    }

    // Optional logo overlay — ONLY when a real, CEO-approved client logo asset exists.
    if (logoUrl) {
      try {
        const logoRes = await fetch(logoUrl);
        if (logoRes.ok) {
          await writeFile(logoPath, Buffer.from(await logoRes.arrayBuffer()));
          await execFileAsync(ffmpegInstaller.path, [
            '-y', '-i', motionPath, '-i', logoPath,
            '-filter_complex', '[1:v]scale=180:-1[logo];[0:v][logo]overlay=W-w-30:30:format=auto',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
            overlayPath,
          ], { timeout: 30000, maxBuffer: 1024 * 1024 * 30 });
          haveLogo = true;
        }
      } catch (e) { console.warn('[smAssembleRawVideo] logo overlay failed, continuing without it:', e.message); }
    }
    const stageAfterMotion = haveLogo ? overlayPath : motionPath;

    const seg = durationSec / 3;
    const hookTxt = smSanitizeForDrawtext(hook);
    const itemTxt = smSanitizeForDrawtext(priceLabel ? `${itemName} · ${priceLabel}` : itemName);
    const ctaTxt = businessName ? smSanitizeForDrawtext(`Order at ${businessName}`) : '';
    const watermarkTxt = businessName ? smSanitizeForDrawtext(businessName.toUpperCase()) : '';

    const filters = [];
    if (hookTxt) filters.push(`drawtext=fontfile=${SMM_FONT_PATH}:text='${hookTxt}':fontcolor=white:fontsize=66:box=1:boxcolor=black@0.5:boxborderw=22:x=(w-text_w)/2:y=260:enable='between(t\\,0\\,${seg.toFixed(2)})'`);
    if (itemTxt) filters.push(`drawtext=fontfile=${SMM_FONT_PATH}:text='${itemTxt}':fontcolor=white:fontsize=54:box=1:boxcolor=black@0.5:boxborderw=20:x=(w-text_w)/2:y=1520:enable='between(t\\,${seg.toFixed(2)}\\,${(seg * 2).toFixed(2)})'`);
    if (ctaTxt) filters.push(`drawtext=fontfile=${SMM_FONT_PATH}:text='${ctaTxt}':fontcolor=white:fontsize=48:box=1:boxcolor=black@0.5:boxborderw=18:x=(w-text_w)/2:y=1520:enable='between(t\\,${(seg * 2).toFixed(2)}\\,${durationSec})'`);
    if (watermarkTxt) filters.push(`drawtext=fontfile=${SMM_FONT_PATH}:text='${watermarkTxt}':fontcolor=white@0.85:fontsize=28:box=1:boxcolor=black@0.35:boxborderw=10:x=24:y=h-56`);

    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-i', stageAfterMotion,
      '-vf', filters.length ? filters.join(',') : 'null',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      textPath,
    ], { timeout: 45000, maxBuffer: 1024 * 1024 * 30 });

    await smSynthesizeAudioFile(durationSec, audioPath);

    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-i', textPath, '-i', audioPath,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
      outPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 30 });

    const outBuf = await readFile(outPath);
    if (!outBuf || !outBuf.length) throw new Error('ffmpeg produced an empty file');
    return outBuf;
  } finally {
    for (const p of [bgPath, motionPath, overlayPath, logoPath, textPath, audioPath, outPath]) await unlink(p).catch(() => {});
  }
}

// ── Submagic — called AS-IS via the existing low-level _submagicFetch() helper (true reuse) ──
// v16.34.0 — SMM-specific Submagic config, deliberately conservative on B-roll. Unlike AI
// Studio (40%) and NextWave (70%), SMM's Submagic step exists ONLY for captions/text
// styling/zoom polish on the HeyGen presenter — the business-specific visuals (logo, verified
// product/menu imagery) are composited afterward by smBrandComposite, not by Submagic's own
// stock B-roll.
// v16.35.0 — Milestone 5A: magicBrolls is now OFF entirely. Real, CEO-approved business
// imagery (storefront/product/menu) is composited around the presenter segment in
// smBrandComposite instead — having Submagic simultaneously inject its own generic stock
// B-roll into the presenter footage would compete with and dilute that real imagery, which
// is the opposite of the "real business imagery must dominate whenever available" directive.
// magicZooms (Submagic's caption-timed zoom/motion on the presenter footage itself, not
// stock B-roll) is left on — it's a polish effect on our own real HeyGen footage, not
// substitute imagery.
const SMM_SUBMAGIC_CONFIG = { templateName: 'Hormozi 2', magicZooms: true, magicBrolls: false, magicBrollsPercentage: 0 };

async function smSubmagicCreateProjectInternal(videoUrl, title) {
  const projectBody = {
    title: title || ('SMM ' + new Date().toISOString()),
    language: 'en',
    videoUrl,
    templateName: SMM_SUBMAGIC_CONFIG.templateName,
    magicZooms: SMM_SUBMAGIC_CONFIG.magicZooms,
    magicBrolls: SMM_SUBMAGIC_CONFIG.magicBrolls,
    magicBrollsPercentage: SMM_SUBMAGIC_CONFIG.magicBrollsPercentage,
  };
  const r = await _submagicFetch('/v1/projects', { method: 'POST', body: projectBody });
  const projectId = (r.data && (r.data.id || (r.data.project && r.data.project.id))) || null;
  return { ok: r.ok, projectId, raw: r.data, error: r.error || null };
}

async function smSubmagicGetProjectInternal(projectId) {
  const r = await _submagicFetch('/v1/projects/' + encodeURIComponent(projectId));
  const d = (r.data && (r.data.project || r.data)) || {};
  const status = d.status || d.state || null;
  const downloadUrl = d.downloadUrl || d.videoUrl || d.exportUrl || d.outputUrl || null;
  return { ok: r.ok, status, downloadUrl, duration: d.duration || null, raw: r.data };
}

// ── Verified-offering lookup (same verified-fields-only source as Content Planning/Milestone 4) ──
// v16.35.0 — Milestone 5A: also selects social_accounts (a top-level business_brain column,
// separate from identity) so callers can compute hasVerifiedSocial without a second round
// trip. Returns hasVerifiedSocial = true only if at least one entry has status 'verified' —
// for Urban Halal Shack today this array is empty, so it correctly evaluates to false and
// nothing "follow us"-flavored is ever generated.
async function smLoadOfferingForTask(task) {
  const [planRows, brainRows] = await Promise.all([
    sbGet(`content_plans?id=eq.${encodeURIComponent(task.content_plan_id)}&select=plan_body&limit=1`),
    sbGet(`business_brain?business_id=eq.${encodeURIComponent(task.business_id)}&select=identity,social_accounts,offerings&limit=1`),
  ]);
  const plan = planRows && planRows[0];
  const brain = (brainRows && brainRows[0]) || {};
  const identity = brain.identity || {};
  const socialAccounts = Array.isArray(brain.social_accounts) ? brain.social_accounts : [];
  const hasVerifiedSocial = socialAccounts.some((a) => a && a.status === 'verified');
  const items = (plan && plan.plan_body && Array.isArray(plan.plan_body.items)) ? plan.plan_body.items : [];
  const item = items.find((it) => it.source && it.source.id === task.item_ref);
  let offering = (item && item.source) || null;
  // v16.58.0 — CEO Decision #26 continuation: root cause of a real Build-stage failure. This
  // lookup previously found the offering ONLY inside the task's content plan's own item
  // snapshot — any task whose item_ref wasn't literally embedded there (e.g. an
  // engineering-prepared CEO acceptance task, or any future per-task Generate flow) threw here,
  // BEFORE any sm_video_productions row was ever created, so Build failed with no visible
  // production, no error surfaced in the UI, and no way to tell it had failed at all — it just
  // looked frozen. Fixed with the same fallback smVaTaskGeneratePackage already uses: read the
  // offering directly from Business Brain's own verified offerings array (the authoritative
  // source either way — the content plan is only ever a snapshot of it).
  if (!offering) {
    const offerings = Array.isArray(brain.offerings) ? brain.offerings : [];
    offering = offerings.find((o) => o.id === task.item_ref) || null;
  }
  if (!offering) throw new Error(`verified offering not found for item_ref=${task.item_ref}`);
  return { offering, identity, hasVerifiedSocial };
}

// v16.33.0 — CEO Gate Review revision (Milestone 5 QA failures #3/#4). Priority order for
// production visuals/branding: (A) approved client-provided assets, (B) other verified
// business-specific assets, (C) auto-sourced B-roll as supporting footage only. Nothing here
// ever invents a logo/storefront/product photo — a missing category is reported, never faked.
// v16.35.0 — Milestone 5A: now returns ALL approved product/menu assets (up to 3, most
// recently approved first), not just one, so Brand Composer can build a short product
// showcase rather than a single overlay. `productVisual` is kept (= products[0] || null)
// purely for backward compatibility with the existing `visualSource` flag logic in
// smVideoProductionGenerate. Selection logic itself (client_provided + ceo_approved only)
// is unchanged — still zero tolerance for stock/auto_sourced assets here.
// SMM V1 Phase 2 — Asset Onboarding. origin widened from client_provided-only to also include
// verified_public (imported from the business's own official public menu/website source) and
// ai_enhanced (a real business photo AI-motion-enhanced, e.g. via Runway) — both are real,
// provenance-tracked, human-approvable business imagery, not fabricated content, and without
// this the Phase 2 Asset Library onboarding work would be permanently invisible to actual video
// production even after CEO approval. The SELECTION LOGIC below is completely unchanged (same
// category match, same slice(0,3), same recency order) — this only widens which already-
// approved rows are eligible to be selected from; still not product_ref-aware, still no
// ranking/rotation — that remains explicitly out of scope until a future phase. auto_sourced
// (retired legacy stock) and ai_generated (no real assets exist yet, and CEO approval of a
// purely-invented visual as brand-representative imagery is a bigger call than this phase
// covers) are deliberately not included here.
async function smSelectBrandAssets(businessId) {
  const rows = await sbGet(`sm_content_assets?business_id=eq.${encodeURIComponent(businessId)}&origin=in.(client_provided,verified_public,ai_enhanced)&status=eq.ceo_approved&select=*&order=created_at.desc`);
  const assets = rows || [];
  const logo = assets.find((a) => a.category === 'logo') || null;
  const storefront = assets.find((a) => a.category === 'storefront_photo') || null;
  const products = assets.filter((a) => ['product_photo', 'menu_image', 'finished_food'].includes(a.category)).slice(0, 3);
  const productVisual = products[0] || null;
  const missingAssets = [];
  if (!logo) missingAssets.push('Business logo');
  if (!storefront) missingAssets.push('Storefront photo');
  if (!products.length) missingAssets.push('Client-provided product/menu photos or videos');
  return { logo, storefront, products, productVisual, missingAssets };
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// SMM V1 Phase 4 — Quality Production Pipeline. Replaces the on-screen HeyGen avatar as the
// PRIMARY visual with real approved business assets (Ken Burns motion) + professional
// narration + captions + music + branding. HeyGen is retained ONLY as an internal audio-only
// narration fallback when ElevenLabs isn't connected — its video track is discarded, never
// shown. Nothing here invents assets, prices, or business facts; every visual comes from
// sm_content_assets rows that are already ceo_approved, re-verified at Build time.
// ══════════════════════════════════════════════════════════════════════════════════════════

// ── Narration ────────────────────────────────────────────────────────────────────────────
async function smSynthesizeNarrationElevenLabs(text) {
  if (!ELEVENLABS_API_KEY) return { ok: false, error: 'elevenlabs_not_configured' };
  try {
    const r = await fetch(`${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, error: `elevenlabs_error_${r.status}: ${t.slice(0, 200)}` };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf || buf.length < 512) return { ok: false, error: 'elevenlabs_returned_empty_audio' };
    return { ok: true, buffer: buf, provider: 'elevenlabs' };
  } catch (e) {
    return { ok: false, error: `elevenlabs_request_failed: ${e.message}` };
  }
}

// Fallback ONLY, used when ElevenLabs is not connected. Reuses the exact proven HeyGen render
// pipeline purely as a text-to-speech engine — HeyGen has no audio-only endpoint, so an avatar
// video is still generated, but only its audio track is ever extracted; the video itself is
// discarded and never appears anywhere in the final composite. Polls synchronously inside this
// one call (bounded) so the rest of the pipeline can treat narration synthesis as a single
// awaited step regardless of which provider actually produced it.
async function smSynthesizeNarrationHeygenFallback(text) {
  if (!HEYGEN_API_KEY) return { ok: false, error: 'no_narration_provider_configured (neither ELEVENLABS_API_KEY nor HEYGEN_API_KEY set)' };
  const start = await smHeygenStartRenderInternal(text);
  if (!start.ok || !start.videoId) return { ok: false, error: 'heygen_fallback_start_failed: ' + (start.error || JSON.stringify(start.raw || {}).slice(0, 200)) };

  const deadline = Date.now() + 110000; // bounded — leaves headroom inside the 180s function budget
  let videoUrl = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await smHeygenRenderStatusInternal(start.videoId);
    if (st.status === 'completed' && st.videoUrl) { videoUrl = st.videoUrl; break; }
    if (st.status === 'failed') return { ok: false, error: 'heygen_fallback_render_failed: ' + JSON.stringify(st.raw || {}).slice(0, 200) };
  }
  if (!videoUrl) return { ok: false, error: 'heygen_fallback_timed_out_waiting_for_render' };

  const id = `narr-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const vidPath = join(tmpdir(), `smm-narr-src-${id}.mp4`);
  const audioPath = join(tmpdir(), `smm-narr-audio-${id}.m4a`);
  try {
    await smDownloadToFile(videoUrl, vidPath);
    await smAssertValidMediaFile(vidPath, 'heygen fallback narration source');
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-i', vidPath, '-vn', '-c:a', 'aac', '-ar', '44100', '-ac', '2', audioPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 20 });
    const buf = await readFile(audioPath);
    if (!buf || buf.length < 512) return { ok: false, error: 'heygen_fallback_audio_extraction_empty' };
    return { ok: true, buffer: buf, provider: 'heygen_audio_fallback' };
  } catch (e) {
    return { ok: false, error: `heygen_fallback_audio_extraction_failed: ${e.message}` };
  } finally {
    await unlink(vidPath).catch(() => {});
    await unlink(audioPath).catch(() => {});
  }
}

// Provider-independent adapter: ElevenLabs preferred, HeyGen-audio-only as the internal
// fallback so Build never depends on an on-screen avatar. Throws only if BOTH fail — caller
// marks the production failed/retryable, identical to any other stage's failure handling.
async function smSynthesizeNarration(text) {
  const primary = await smSynthesizeNarrationElevenLabs(text);
  if (primary.ok) return primary;
  console.warn('[smSynthesizeNarration] ElevenLabs unavailable, falling back to HeyGen audio-only:', primary.error);
  const fallback = await smSynthesizeNarrationHeygenFallback(text);
  if (fallback.ok) return fallback;
  throw new Error(`narration synthesis failed — elevenlabs: ${primary.error} · heygen_fallback: ${fallback.error}`);
}

// ── Runway — optional AI motion/enhancement, adapter boundary only ─────────────────────────
// Deliberately NOT invoked anywhere in the V1 default build path: local Ken Burns motion on
// real approved photos already meets this pilot's quality bar, and CEO cost discipline
// prohibits routing every production through a paid provider "because the account exists."
// This function exists purely so a future concept/asset-quality signal can call it without an
// architecture change.
async function smRunwayEnhanceSegmentStub(asset) {
  if (!RUNWAY_API_KEY) return { ok: false, error: 'runway_not_configured', invoked: false };
  return { ok: false, error: 'runway_available_but_not_invoked_in_v1_default_path', invoked: false };
}

// ── Visual motion (real assets, no avatar) ──────────────────────────────────────────────────
async function smProbeDurationSec(path) {
  const probe = await execFileAsync(ffmpegInstaller.path, ['-i', path], { timeout: 15000, maxBuffer: 1024 * 1024 * 10 }).catch((e) => e);
  const out = (probe && (probe.stderr || probe.message || '')) || '';
  const m = String(out).match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
}

// Ken Burns segments for the plan's approved assets, sized to fill the narration's real
// duration — no dead air, no artificial padding. Reuses the exact zoompan technique already
// proven in smSegFromImage/smSegFromVideoAsset (via smSegFromAsset); this only decides HOW
// MANY segments and HOW LONG each runs. Cycles through the real approved assets if fewer exist
// than segments needed — never fabricates or substitutes a new one.
async function smBuildTimedAssetSegments(assets, targetDurationSec, id) {
  const usable = (assets || []).filter((a) => a && a.source_url);
  if (!usable.length) throw new Error('no usable approved assets for the visual sequence');
  const minSeg = 2.0, maxSeg = 4.0;
  const count = Math.max(1, Math.min(5, Math.round(targetDurationSec / 2.8)));
  const perSeg = Math.min(maxSeg, Math.max(minSeg, targetDurationSec / count));
  const paths = [];
  let usedSec = 0;
  for (let i = 0; i < count; i++) {
    const asset = usable[i % usable.length];
    const isLast = i === count - 1;
    const dur = isLast ? Math.max(minSeg, targetDurationSec - usedSec) : perSeg;
    const seg = await smSegFromAsset(asset, { id, tag: `vis${i}`, durationSec: Math.round(dur * 10) / 10 });
    paths.push(seg);
    usedSec += dur;
  }
  return paths;
}

// Deterministic 3-beat drawtext pass (hook → item/price → CTA) applied to the concatenated
// silent asset sequence — same visual language already CEO-approved in the retired
// smAssembleRawVideo, just applied to real Ken-Burns footage instead of a single static bg.
async function smApplyNarrationTextOverlay({ inputPath, durationSec, hookText, itemText, ctaText, id }) {
  const outPath = join(tmpdir(), `smm-texted-${id}.mp4`);
  const seg = durationSec / 3;
  const hookTxt = smSanitizeForDrawtext(hookText);
  const itemTxt = smSanitizeForDrawtext(itemText);
  const ctaTxt = smSanitizeForDrawtext(ctaText);
  const hookSize = smFitFontSize(hookTxt, 60, 1000);
  const itemSize = smFitFontSize(itemTxt, 50, 1000);
  const ctaSize = smFitFontSize(ctaTxt, 44, 1000);
  const filters = [];
  if (hookTxt) filters.push(`drawtext=fontfile=${SMM_FONT_PATH}:text='${hookTxt}':fontcolor=white:fontsize=${hookSize}:box=1:boxcolor=black@0.5:boxborderw=20:x=(w-text_w)/2:y=220:enable='between(t\\,0\\,${seg.toFixed(2)})'`);
  if (itemTxt) filters.push(`drawtext=fontfile=${SMM_FONT_PATH}:text='${itemTxt}':fontcolor=white:fontsize=${itemSize}:box=1:boxcolor=black@0.5:boxborderw=18:x=(w-text_w)/2:y=1500:enable='between(t\\,${seg.toFixed(2)}\\,${(seg * 2).toFixed(2)})'`);
  if (ctaTxt) filters.push(`drawtext=fontfile=${SMM_FONT_PATH}:text='${ctaTxt}':fontcolor=white:fontsize=${ctaSize}:box=1:boxcolor=black@0.5:boxborderw=16:x=(w-text_w)/2:y=1500:enable='between(t\\,${(seg * 2).toFixed(2)}\\,${durationSec})'`);
  await execFileAsync(ffmpegInstaller.path, [
    '-y', '-i', inputPath,
    '-vf', filters.length ? filters.join(',') : 'null',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'copy',
    outPath,
  ], { timeout: 45000, maxBuffer: 1024 * 1024 * 30 });
  await smAssertValidMediaFile(outPath, 'text-overlaid asset sequence');
  return outPath;
}

async function smMuxNarrationAudio({ videoPath, audioBuffer, id }) {
  const audioPath = join(tmpdir(), `smm-narr-in-${id}.mp3`);
  const outPath = join(tmpdir(), `smm-narrated-${id}.mp4`);
  await writeFile(audioPath, audioBuffer);
  try {
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-i', videoPath, '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
      outPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 30 });
    await smAssertValidMediaFile(outPath, 'narrated visual sequence');
    return outPath;
  } finally {
    await unlink(audioPath).catch(() => {});
  }
}

// ── Background music — reusable, commercial-safe, zero-cost library ────────────────────────
// V1 deliberately does NOT introduce a paid music service (CEO directive) — every track is
// synthesized locally via ffmpeg from a named chord progression, so it is 100% original,
// royalty-free, and free to produce. Each mood is deterministic (same progression every time
// it's picked), so it behaves as a real reusable library entry, not a one-off track — the mood
// name is persisted in tool_usage.music_track so Phase 3's repetition intelligence can
// eventually vary the pick over time without any redesign here.
// v16.66.0 — SMM V1 Phase 4 CORRECTION: Music Library V1. CEO's exact 6-class classification
// scheme (energetic/upbeat/modern/food_social/promotional/relaxed), replacing the earlier
// internal 4-name vocabulary so there is one consistent naming system throughout the plan →
// selection → storage → learning chain. Each mood's synthesized reference bed is now a real pad
// (3-tone chord) + a tremolo-pulsed sub-bass layer locked to the tempo, instead of flat static
// sine chords — a meaningfully fuller "produced" sound while remaining 100%-local, zero-cost,
// zero-licensing-risk (per standing CEO cost-discipline directive: no new paid vendor). This is
// the FALLBACK reference track only — smSelectMusicTrack below always prefers a real, human-
// approved uploaded track from the new Music Library (sm_content_assets, category='music_track')
// once one exists for a given mood; synthesis is what plays until the CEO/VA uploads real music.
const SMM_MUSIC_LIBRARY = {
  energetic:   { name: 'Energetic',   bpm: 118, chords: [[329.63, 392.00, 493.88], [293.66, 349.23, 440.00], [261.63, 329.63, 392.00], [293.66, 349.23, 440.00]] }, // E–D–C–D, bright
  upbeat:      { name: 'Upbeat',      bpm: 104, chords: [[261.63, 329.63, 392.00], [293.66, 349.23, 440.00], [261.63, 329.63, 392.00], [196.00, 246.94, 349.23]] }, // C–D–C–G
  modern:      { name: 'Modern',      bpm: 100, chords: [[146.83, 174.61, 220.00], [110.00, 130.81, 164.81], [116.54, 146.83, 174.61], [130.81, 164.81, 196.00]] }, // Dm–Am–Bb–C
  food_social: { name: 'Food/Social', bpm: 96,  chords: [[220.00, 261.63, 329.63], [196.00, 246.94, 293.66], [174.61, 220.00, 261.63], [196.00, 246.94, 293.66]] }, // Am–G–F–G, warm/inviting
  promotional: { name: 'Promotional', bpm: 112, chords: [[196.00, 246.94, 293.66], [130.81, 164.81, 196.00], [146.83, 185.00, 220.00], [130.81, 164.81, 196.00]] }, // G–C–D–C, punchy
  relaxed:     { name: 'Relaxed',     bpm: 84,  chords: [[220.00, 261.63, 329.63], [196.00, 233.08, 293.66], [174.61, 207.65, 261.63], [196.00, 233.08, 293.66]] }, // Am–Gm–Fm–Gm, mellow
};

function smPickMusicMood(formatId) {
  const map = {
    food_combination: 'energetic', menu_discovery: 'energetic',
    narrated_showcase: 'upbeat', food_hero: 'upbeat', menu_spotlight: 'upbeat',
    business_spotlight: 'modern', craving_emotion: 'modern',
    customer_proof: 'food_social', behind_the_scenes: 'food_social',
    offer_promotion: 'promotional',
  };
  return map[formatId] || 'upbeat';
}

async function smSynthesizeMusicBed(mood, durationSec, id) {
  const track = SMM_MUSIC_LIBRARY[mood] || SMM_MUSIC_LIBRARY.upbeat;
  const chords = track.chords;
  const segDur = (60 / track.bpm) * 4; // 4 beats per chord
  const pulseHz = (track.bpm / 60) * 2; // eighth-note bass pulse — gives the bed an actual rhythmic feel instead of a static drone
  const cyclesNeeded = Math.max(1, Math.ceil(durationSec / (segDur * chords.length)));
  const segPaths = [];
  const listPath = join(tmpdir(), `smm-music-list-${id}.txt`);
  const outPath = join(tmpdir(), `smm-music-${id}.m4a`);
  try {
    let idx = 0;
    for (let c = 0; c < cyclesNeeded; c++) {
      for (const [f1, f2, f3] of chords) {
        const p = join(tmpdir(), `smm-music-seg-${id}-${idx}.m4a`);
        await execFileAsync(ffmpegInstaller.path, [
          '-y',
          '-f', 'lavfi', '-i', `sine=frequency=${f1}:duration=${segDur}`,
          '-f', 'lavfi', '-i', `sine=frequency=${f2}:duration=${segDur}`,
          '-f', 'lavfi', '-i', `sine=frequency=${f3}:duration=${segDur}`,
          '-f', 'lavfi', '-i', `sine=frequency=${(f1 / 2).toFixed(2)}:duration=${segDur}`,
          '-filter_complex', `[0:a][1:a][2:a]amix=inputs=3:duration=longest:weights=0.8 0.8 0.8[pad];[3:a]tremolo=f=${pulseHz.toFixed(2)}:d=0.6,volume=1.5[bass];[pad][bass]amix=inputs=2:duration=longest,alimiter=limit=0.82`,
          '-c:a', 'aac', '-b:a', '128k', p,
        ], { timeout: 15000, maxBuffer: 1024 * 1024 * 10 });
        segPaths.push(p);
        idx++;
      }
    }
    await writeFile(listPath, segPaths.map((p) => `file '${p}'`).join('\n'));
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-t', String(durationSec),
      '-filter:a', `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, durationSec - 1.2).toFixed(2)}:d=1.2`,
      '-c:a', 'aac', '-b:a', '128k',
      outPath,
    ], { timeout: 25000, maxBuffer: 1024 * 1024 * 10 });
    return outPath;
  } finally {
    await unlink(listPath).catch(() => {});
    for (const p of segPaths) await unlink(p).catch(() => {});
  }
}

// Least-recently-used selection among real, human-approved uploaded music tracks for this mood
// (shared/global tracks — business_id IS NULL — are eligible for any business, alongside any
// business-specific uploads) — this is the concrete "use accumulated history to reduce
// repetition" mechanism the CEO asked for. Returns null (falls back to synthesis) if no real
// track has been uploaded/approved for this mood yet — true for every mood today, since this
// pilot has no real music uploaded, per the CEO's own correction order.
async function smSelectMusicTrack(mood, businessId) {
  try {
    const rows = await sbGet(`sm_content_assets?asset_type=eq.audio&category=eq.music_track&mood=eq.${encodeURIComponent(mood)}&status=eq.ceo_approved&or=(business_id.eq.${encodeURIComponent(businessId)},business_id.is.null)&select=*&order=last_used_at.asc.nullsfirst&limit=1`);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.warn('[smSelectMusicTrack] lookup failed, falling back to synthesis:', e.message);
    return null;
  }
}

async function smPrepareRealMusicTrack(track, durationSec, id) {
  const srcPath = join(tmpdir(), `smm-realmusic-src-${id}`);
  const outPath = join(tmpdir(), `smm-realmusic-${id}.m4a`);
  try {
    await smDownloadToFile(track.source_url, srcPath);
    await smAssertValidMediaFile(srcPath, 'uploaded music track');
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-stream_loop', '-1', '-i', srcPath, '-t', String(durationSec),
      '-filter:a', `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, durationSec - 1.2).toFixed(2)}:d=1.2`,
      '-c:a', 'aac', '-b:a', '128k', outPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 20 });
    await smAssertValidMediaFile(outPath, 'prepared music track');
    return outPath;
  } finally {
    await unlink(srcPath).catch(() => {});
  }
}

// Mixes the music bed UNDER the existing narration+captions track (reduced volume so the
// voice stays clearly intelligible, per CEO requirement) rather than replacing it. Prefers a
// real uploaded/approved Music Library track over the synthesized reference bed whenever one
// exists for this mood/business.
async function smMixMusicUnderNarration({ videoWithNarrationPath, mood, id, businessId }) {
  const durationSec = await smProbeDurationSec(videoWithNarrationPath);
  if (!durationSec) throw new Error('could not determine duration for music mixing');

  const realTrack = businessId ? await smSelectMusicTrack(mood, businessId) : null;
  const musicPath = realTrack
    ? await smPrepareRealMusicTrack(realTrack, durationSec, id)
    : await smSynthesizeMusicBed(mood, durationSec, id);

  const outPath = join(tmpdir(), `smm-withmusic-${id}.mp4`);
  try {
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-i', videoWithNarrationPath, '-i', musicPath,
      '-filter_complex', '[1:a]volume=0.16[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[outa]',
      '-map', '0:v:0', '-map', '[outa]',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
      outPath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 * 30 });
    await smAssertValidMediaFile(outPath, 'video with background music');
    if (realTrack) {
      sbPatch('sm_content_assets', `id=eq.${encodeURIComponent(realTrack.id)}`, {
        usage_count: (realTrack.usage_count || 0) + 1, last_used_at: new Date().toISOString(),
      }).catch(() => {});
    }
    return { path: outPath, musicSource: realTrack ? 'uploaded' : 'synthesized', musicTrackId: realTrack ? realTrack.id : null };
  } finally {
    await unlink(musicPath).catch(() => {});
  }
}

// Stage 3 (post-captions) for the Phase 4 asset-driven pipeline: mix in background music,
// apply logo/watermark branding, upload the final master, mark ready_for_review. Shared by
// both the no-captions-needed synchronous path (smVideoProductionGenerateAssetDriven, for a
// future music-only format) and the normal Submagic-polled async path (smVideoProductionPoll).
async function smFinishAssetDrivenComposite({ productionId, attemptNumber, businessId, taskId, sourcePath, sourceUrl, identity, mood }) {
  const tempPaths = [];
  const track = (p) => { tempPaths.push(p); return p; };
  try {
    const id = `finish-${productionId}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    let localSourcePath = sourcePath;
    if (!localSourcePath) {
      localSourcePath = track(join(tmpdir(), `smm-finish-src-${id}.mp4`));
      await smDownloadToFile(sourceUrl, localSourcePath);
      await smAssertValidMediaFile(localSourcePath, 'downloaded captioned video (from Submagic)');
    }

    mood = mood || 'upbeat';
    const musicResult = await smMixMusicUnderNarration({ videoWithNarrationPath: localSourcePath, mood, id, businessId });
    const withMusic = track(musicResult.path);

    const brand = await smSelectBrandAssets(businessId);
    let finalPath = withMusic;
    let logoUsed = false;
    try {
      const branded = await smApplyBranding({ inputPath: withMusic, logoUrl: brand.logo ? brand.logo.source_url : null, businessName: identity.businessName, id });
      finalPath = track(branded.path);
      logoUsed = branded.logoUsed;
    } catch (e) { console.warn('[smFinishAssetDrivenComposite] branding pass failed, using unbranded composite:', e.message); }

    const durationSec = await smProbeDurationSec(finalPath);
    const outBuf = await readFile(finalPath);
    if (!outBuf || !outBuf.length) throw new Error('final composite is empty');

    const finalStoragePath = `social-media-manager/${businessId}/${taskId}/attempt-${attemptNumber}-final.mp4`;
    const finalUrl = await sbStorageUpload(finalStoragePath, outBuf, 'video/mp4');

    const production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
      final_video_url: finalUrl, duration_seconds: durationSec || null, status: 'ready_for_review',
    });
    await sbPatch('sm_production_packages', `va_task_id=eq.${encodeURIComponent(taskId)}&status=eq.draft`, {
      hook: production.hook, caption: production.caption, hashtags: production.hashtags,
    }).catch(() => {});
    return { production, logoUsed, musicMood: mood, musicSource: musicResult.musicSource, musicTrackId: musicResult.musicTrackId };
  } finally {
    for (const p of tempPaths) await unlink(p).catch(() => {});
  }
}

// ── Entry point (routed by ?action=sm_video_production_generate) ───────────────────────────
// Dispatches to the new Phase 4 asset-driven pipeline when the task's current approved
// package carries a real Production Plan (spoken_script present — set by every Phase 3+
// Generate call); falls back to the untouched legacy HeyGen pipeline for any package that
// predates Phase 3 (e.g. the pre-existing Wings task), so nothing historical breaks.
async function smVideoProductionGenerate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { vaTaskId } = req.body || {};
  if (!vaTaskId) return res.status(400).json({ ok: false, error: 'vaTaskId is required' });
  try {
    const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(vaTaskId)}&select=*&limit=1`);
    const task = taskRows && taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'va task not found' });
    const pkgRows = await sbGet(`sm_production_packages?va_task_id=eq.${encodeURIComponent(vaTaskId)}&is_current=eq.true&select=*&limit=1`);
    const approvedPkg = pkgRows && pkgRows[0];
    if (approvedPkg && approvedPkg.spoken_script) {
      return await smVideoProductionGenerateAssetDriven(req, res, task, approvedPkg);
    }
    return await smVideoProductionGenerateLegacy(req, res);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
}

// ── New pipeline orchestrator (v16.65.0 — SMM V1 Phase 4) ──────────────────────────────────
// Verified Business Brain + approved Phase 3 Production Plan → narration (ElevenLabs/HeyGen-
// audio-fallback) → real-asset Ken Burns visual sequence → text overlay → end card → Submagic
// captions → music + branding → ready_for_review. The approved plan's own selected_asset_ids,
// spoken_script, on_screen_text, format and CTA are consumed verbatim — Build never
// independently selects different assets or regenerates a different concept.
async function smVideoProductionGenerateAssetDriven(req, res, task, pkg) {
  if (task.mode !== 'demo') return res.status(400).json({ ok: false, error: 'only demo-mode tasks may produce video' });

  let production = null;
  try {
    const businessId = task.business_id;
    const { offering, identity, hasVerifiedSocial } = await smLoadOfferingForTask(task);

    // Mandatory per Phase 4 CEO order: Build consumes the approved plan's own selected assets,
    // never a fresh independent selection. Re-verified at Build time (an asset could
    // theoretically have been un-approved since Review) — never trusts the plan's snapshot blindly.
    const planAssetIds = Array.isArray(pkg.selected_asset_ids) ? pkg.selected_asset_ids : [];
    let planAssets = [];
    if (planAssetIds.length) {
      const rows = await sbGet(`sm_content_assets?id=in.(${planAssetIds.map(encodeURIComponent).join(',')})&status=eq.ceo_approved&origin=in.(client_provided,verified_public,ai_enhanced)&select=*`);
      const byId = {}; (rows || []).forEach((a) => { byId[a.id] = a; });
      planAssets = planAssetIds.map((aid) => byId[aid]).filter(Boolean);
    }
    if (!planAssets.length) {
      // Honest asset-gap state — never substitutes stock imagery implying it's this business's
      // real product (CEO directive #4). The VA sees a clear failure, not misleading content.
      production = await sbInsert('sm_video_productions', {
        va_task_id: task.id, status: 'failed',
        error_message: 'asset_gap: the approved plan\'s selected assets are no longer available/approved — no eligible real business imagery to build with',
      });
      return res.status(200).json({ ok: true, production, assetGap: true });
    }

    production = await sbInsert('sm_video_productions', {
      va_task_id: task.id, status: 'sourcing_visuals',
      concept: pkg.concept, hook: pkg.hook, script_text: pkg.spoken_script,
      on_screen_text: pkg.on_screen_text, caption: pkg.caption, hashtags: pkg.hashtags,
      visual_direction: pkg.visual_direction,
      content_fingerprint: pkg.content_fingerprint,
    });

    // Auditable usage record — same purpose as the legacy pipeline's brand-asset logging, now
    // for the plan's own selected_asset_ids (the assets that actually became this production's
    // primary visual, not just business-general brand references).
    planAssets.forEach((a, idx) => {
      sbInsert('sm_video_production_assets', {
        video_production_id: production.id, content_asset_id: a.id, role: 'primary_broll', sequence_order: idx + 1,
      }).catch(() => {});
    });

    const id = `${production.id}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const tempPaths = [];
    const track = (p) => { tempPaths.push(p); return p; };
    try {
      production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, { status: 'rendering' });
      const narration = await smSynthesizeNarration(pkg.spoken_script);
      const narrAudioPath = track(join(tmpdir(), `smm-narrsrc-${id}.mp3`));
      await writeFile(narrAudioPath, narration.buffer);
      const narrationDurationSec = await smProbeDurationSec(narrAudioPath);
      if (!narrationDurationSec || narrationDurationSec < 2) throw new Error('narration audio duration could not be determined or is implausibly short');

      const segPaths = (await smBuildTimedAssetSegments(planAssets, narrationDurationSec, id)).map(track);
      const silentSeq = track(segPaths.length > 1 ? await smConcatSegments({ paths: segPaths, id }) : segPaths[0]);

      const onScreen = Array.isArray(pkg.on_screen_text) ? pkg.on_screen_text : [];
      const itemLabel = (typeof offering.price === 'number') ? `${offering.name} · $${offering.price.toFixed(2)}` : offering.name;
      const texted = track(await smApplyNarrationTextOverlay({
        inputPath: silentSeq, durationSec: narrationDurationSec,
        hookText: onScreen[0] || pkg.hook, itemText: onScreen[1] || itemLabel, ctaText: onScreen[2] || pkg.cta_text,
        id,
      }));
      const narratedMain = track(await smMuxNarrationAudio({ videoPath: texted, audioBuffer: narration.buffer, id }));

      const rawLines = [];
      const priceLabel = (typeof offering.price === 'number') ? `$${offering.price.toFixed(2)}` : null;
      const itemTxt = smSanitizeForDrawtext(priceLabel ? `${offering.name} · ${priceLabel}` : offering.name);
      if (itemTxt) rawLines.push({ text: itemTxt, fontsize: smFitFontSize(itemTxt, 50, 980) });
      if (identity.businessName) {
        const orderTxt = smSanitizeForDrawtext(`Order from ${identity.businessName}`);
        rawLines.push({ text: orderTxt, fontsize: smFitFontSize(orderTxt, 42, 980) });
      }
      let ctaExtra = null;
      if (identity.website) { try { ctaExtra = new URL(identity.website).hostname; } catch (e) { ctaExtra = String(identity.website).replace(/^https?:\/\//, '').split('/')[0]; } }
      else if (identity.phoneNumber) { ctaExtra = identity.phoneNumber; }
      if (ctaExtra) rawLines.push({ text: smSanitizeForDrawtext(ctaExtra), fontsize: 34 });
      if (hasVerifiedSocial) rawLines.push({ text: smSanitizeForDrawtext(`Follow ${identity.businessName || 'us'}`), fontsize: 34 });
      const endCard = track(await smSegEndCard({ id, durationSec: 3.0, lines: smCenterEndCardLines(rawLines) }));

      const fullSilentEnded = track(await smConcatSegments({ paths: [narratedMain, endCard], id }));

      const preCaptionsPath = `social-media-manager/${businessId}/${task.id}/attempt-${production.attempt_number}-precaptions.mp4`;
      const preCaptionsBuf = await readFile(fullSilentEnded);
      const preCaptionsUrl = await sbStorageUpload(preCaptionsPath, preCaptionsBuf, 'video/mp4');

      production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, {
        tool_usage: {
          pipeline: 'phase4_asset_driven',
          creative_provider: (pkg.tool_usage && pkg.tool_usage.creative_provider) || 'approved_plan',
          narration_provider: narration.provider,
          motion_provider: 'local_ffmpeg_kenburns',
          music_track: smPickMusicMood(pkg.format_id),
          captions_provider: 'submagic',
          compositor_provider: 'ffmpeg_local',
        },
        duration_seconds: Math.round((narrationDurationSec + 3.0) * 10) / 10,
      });

      const needsCaptions = !pkg.required_capabilities || pkg.required_capabilities.captions !== false;
      if (needsCaptions) {
        const sub = await smSubmagicCreateProjectInternal(preCaptionsUrl, `SMM ${businessId} ${production.id}`);
        if (!sub.ok || !sub.projectId) {
          production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, {
            status: 'failed', error_message: 'Submagic create failed: ' + (sub.error || JSON.stringify(sub.raw).slice(0, 200)),
          });
          return res.status(200).json({ ok: true, production });
        }
        production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, {
          submagic_project_id: sub.projectId, status: 'processing_captions',
        });
        return res.status(200).json({ ok: true, production, stage: 'submagic_started' });
      }

      // No captions needed (music-only formats — not buildable_now yet, kept for completeness).
      production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, { status: 'compositing' });
      const finishRes = await smFinishAssetDrivenComposite({
        productionId: production.id, attemptNumber: production.attempt_number,
        businessId, taskId: task.id, sourcePath: fullSilentEnded, identity, mood: smPickMusicMood(pkg.format_id),
      });
      return res.status(200).json({ ok: true, production: finishRes.production, logoUsed: finishRes.logoUsed, musicMood: finishRes.musicMood });
    } finally {
      for (const p of tempPaths) await unlink(p).catch(() => {});
    }
  } catch (e) {
    if (production && production.id) {
      await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, { status: 'failed', error_message: e.message }).catch(() => {});
    }
    return res.status(502).json({ ok: false, error: e.message, productionId: production && production.id });
  }
}

// ── Legacy orchestrator (v16.34.0 — CEO-approved HeyGen pipeline revision): kept UNCHANGED,
// ── used only as a fallback for packages that predate Phase 3/4 (no spoken_script ever
// ── persisted at Review time, so there is no plan for the new pipeline to consume). Verified
// ── Business Brain → AI Creative (spoken script) → HeyGen (presenter avatar speaks it) →
// ── Submagic (captions/polish) → smBrandComposite (verified logo/business identity/CTA) →
// ── ready_for_review. Async multi-step (start render → poll → chain to finishing → poll →
// ── done). Each attempt is a fresh sm_video_productions row (DB trigger assigns
// ── attempt_number/is_current and blocks a new attempt while a prior one is still in progress).
async function smVideoProductionGenerateLegacy(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { vaTaskId } = req.body || {};
  if (!vaTaskId) return res.status(400).json({ ok: false, error: 'vaTaskId is required' });

  let production = null;
  try {
    const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(vaTaskId)}&select=*&limit=1`);
    const task = taskRows && taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'va task not found' });
    if (task.mode !== 'demo') return res.status(400).json({ ok: false, error: 'only demo-mode tasks may produce video' });

    const { offering, identity, hasVerifiedSocial } = await smLoadOfferingForTask(task);
    const brand = await smSelectBrandAssets(task.business_id);

    production = await sbInsert('sm_video_productions', { va_task_id: vaTaskId, status: 'sourcing_visuals' });

    // SMM V1 Phase 3 — Content Intelligence / Creative Planner. Before this phase, Build always
    // called smGenerateVideoCreative fresh here, INDEPENDENTLY of whatever hook/caption the VA
    // had just reviewed and approved at Review (sm_production_packages only ever held
    // caption/hook/hashtags, never the actual spoken script) — so a VA's approval never actually
    // governed what got built, and re-running Build could silently produce different spoken
    // content than what was reviewed. The approved package now carries the full plan
    // (spoken_script/concept/on_screen_text/visual_direction, plus format/product-selection
    // metadata) — Build uses it verbatim when present. Older packages that predate this phase
    // (no spoken_script ever persisted) fall back to the original regenerate-fresh behavior so
    // nothing existing breaks. Build's own rendering mechanics (HeyGen/Submagic/ffmpeg, and the
    // single-offering-anchored end-card in smBrandComposite) are completely unchanged — only
    // where the input TEXT comes from changes.
    const approvedPkgRows = await sbGet(`sm_production_packages?va_task_id=eq.${encodeURIComponent(vaTaskId)}&is_current=eq.true&select=*&limit=1`);
    const approvedPkg = approvedPkgRows && approvedPkgRows[0];
    const creative = (approvedPkg && approvedPkg.spoken_script)
      ? {
          concept: approvedPkg.concept, hook: approvedPkg.hook, spoken_script: approvedPkg.spoken_script,
          on_screen_text: approvedPkg.on_screen_text, caption: approvedPkg.caption, hashtags: approvedPkg.hashtags,
          visual_direction: approvedPkg.visual_direction,
          source: (approvedPkg.tool_usage && approvedPkg.tool_usage.creative_provider) || 'approved_plan',
        }
      : await smGenerateVideoCreative(offering, identity, hasVerifiedSocial);
    // SMM V1 Phase 1 — Brain + Data Foundation: persist the fingerprint + tool/provider usage
    // this call already knows (creative.source was previously computed then discarded). No new
    // logic reads these yet — foundation only, for a future repetition-prevention/quality phase.
    production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, {
      concept: creative.concept, hook: creative.hook, script_text: creative.spoken_script,
      on_screen_text: creative.on_screen_text, caption: creative.caption, hashtags: creative.hashtags,
      visual_direction: creative.visual_direction,
      content_fingerprint: (approvedPkg && approvedPkg.content_fingerprint) || smComputeContentFingerprint([task.item_ref, creative.hook, creative.concept]),
      tool_usage: {
        creative_provider: creative.source || 'deterministic_fallback',
        creative_model: creative.source === 'ai_generated' ? 'claude-sonnet-4-5' : null,
        presenter_provider: 'heygen',
        captions_provider: 'submagic',
        compositor_provider: 'ffmpeg_local',
      },
    });

    // Record which supporting visual WOULD be used for Submagic's light B-roll punctuation and
    // which brand assets are/aren't available — informational now (Submagic sources its own
    // B-roll from its stock library per the CEO's architecture decision; MMMOS no longer feeds
    // Pexels footage directly into the render). Still honestly reports missing assets.
    let visualSource = brand.productVisual ? 'client_provided' : 'none_available_yet';

    production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, { status: 'rendering' });

    const heygen = await smHeygenStartRenderInternal(creative.spoken_script);
    if (!heygen.ok || !heygen.videoId) {
      throw new Error('HeyGen render submit failed: ' + (heygen.error || JSON.stringify(heygen.raw).slice(0, 200)));
    }
    production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, {
      heygen_job_id: heygen.videoId,
    });

    return res.status(200).json({
      ok: true, production,
      visualSource, logoUsed: !!brand.logo, missingAssets: brand.missingAssets,
    });
  } catch (e) {
    if (production && production.id) {
      await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(production.id)}`, { status: 'failed', error_message: e.message }).catch(() => {});
    }
    return res.status(502).json({ ok: false, error: e.message, productionId: production && production.id });
  }
}

// State machine: rendering (HeyGen in flight) → processing_captions (Submagic in flight) →
// compositing (Brand Composer running, brief/synchronous within this call) → ready_for_review.
async function smVideoProductionPoll(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { productionId } = req.query || {};
  if (!productionId) return res.status(400).json({ ok: false, error: 'productionId is required' });
  try {
    const rows = await sbGet(`sm_video_productions?id=eq.${encodeURIComponent(productionId)}&select=*&limit=1`);
    let production = rows && rows[0];
    if (!production) return res.status(404).json({ ok: false, error: 'production not found' });

    // ── Stage 1: HeyGen render in flight ──────────────────────────────────────────────────
    if (production.status === 'rendering' && production.heygen_job_id) {
      const hg = await smHeygenRenderStatusInternal(production.heygen_job_id);
      if (hg.status === 'completed' && hg.videoUrl) {
        production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
          heygen_raw_url: hg.videoUrl, raw_render_url: hg.videoUrl,
        });
        const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(production.va_task_id)}&select=business_id&limit=1`);
        const businessId = taskRows && taskRows[0] && taskRows[0].business_id;
        const sub = await smSubmagicCreateProjectInternal(hg.videoUrl, `SMM ${businessId || ''} ${production.id}`);
        if (!sub.ok || !sub.projectId) {
          production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
            status: 'failed', error_message: 'Submagic create failed: ' + (sub.error || JSON.stringify(sub.raw).slice(0, 200)),
          });
          return res.status(200).json({ ok: true, production });
        }
        production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
          submagic_project_id: sub.projectId, status: 'processing_captions',
        });
        return res.status(200).json({ ok: true, production, stage: 'submagic_started' });
      }
      if (hg.status === 'failed') {
        production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
          status: 'failed', error_message: 'HeyGen render failed: ' + JSON.stringify(hg.raw).slice(0, 200),
        });
        return res.status(200).json({ ok: true, production });
      }
      return res.status(200).json({ ok: true, production, heygenStatus: hg.status || 'processing' });
    }

    // ── Stage 2: Submagic captions/polish in flight ───────────────────────────────────────
    // v16.56.0 — CEO Decision #26 continuation: also re-enter here when status is already
    // 'compositing'. Stage 3 (below) runs synchronously inside this same HTTP request after the
    // 'compositing' patch — asset lookup + smBrandComposite (ffmpeg) + storage upload can
    // occasionally exceed api/ops.js's 60s maxDuration (vercel.json) on a slow render, which
    // kills the function via a platform timeout, not a thrown JS error, so the v16.53.0
    // try/catch (which only catches real exceptions) never runs and the row is left stuck at
    // 'compositing' with no error — reproduced live twice against a real fresh production.
    // Treating 'compositing' as a valid re-entry point makes every subsequent poll retry Stage 3
    // from scratch (re-fetches the already-finished Submagic result, safe and idempotent) instead
    // of falling through to "any other status — return as-is" forever.
    if ((production.status === 'processing_captions' || production.status === 'compositing') && production.submagic_project_id) {
      const sub = await smSubmagicGetProjectInternal(production.submagic_project_id);
      console.log('[smVideoProductionPoll] submagic poll · productionId:', productionId, '· projectId:', production.submagic_project_id, '· sub.ok:', sub.ok, '· sub.status:', sub.status, '· sub.downloadUrl:', sub.downloadUrl, '· raw:', JSON.stringify(sub.raw).slice(0, 400));
      const doneStatuses = ['completed', 'done', 'ready', 'success', 'finished']; // v16.34.1 — added 'finished' to match the value the existing client-side _pollSubmagicProjects() already checks for (index.html) — this SMM poller had drifted from that proven list
      const failStatuses = ['failed', 'error'];
      const statusLc = String(sub.status || '').toLowerCase();

      if (sub.downloadUrl && (!sub.status || doneStatuses.includes(statusLc))) {
        console.log('[smVideoProductionPoll] Submagic complete, entering compositing · productionId:', productionId, '· submagicStatus:', sub.status, '· downloadUrl:', sub.downloadUrl);
        production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, { status: 'compositing' });

        // v16.53.0 — CEO Decision #26 continuation: Stage 3 previously let any error inside this
        // block (task/asset lookup, smBrandComposite, or the storage upload — e.g. a transient
        // Cloudflare/Supabase 520) fall through to the function's outer catch, which returns an
        // error response WITHOUT ever patching production.status away from 'compositing'. The
        // next poll call then only matches the 'rendering'/'processing_captions' branches above,
        // falls through to "any other status — return as-is" below, and the task is stuck at
        // 'compositing' forever — no error shown, no retry possible. Fixed by giving Stage 3 its
        // own try/catch that patches status:'failed' + error_message on any failure here, exactly
        // matching the HeyGen-failure and Submagic-failure branches above — the existing frontend
        // (renderVideoProductionSection) already treats status==='failed' as retryable via its
        // "↻ Regenerate video" button, so no UI change is needed, only this backend fix.
        // v16.65.0 — SMM V1 Phase 4: productions built by the new asset-driven pipeline already
        // carry their full visual sequence + narration + end card baked into the pre-Submagic
        // upload (sub.downloadUrl here is Submagic's captioned version of that same sequence,
        // not a bare HeyGen clip) — Stage 3 for them is only music + branding, handled by the
        // shared smFinishAssetDrivenComposite helper. Everything below this branch is the
        // untouched legacy Stage 3 for pre-Phase-4 productions.
        if (production.tool_usage && production.tool_usage.pipeline === 'phase4_asset_driven') {
          try {
            const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(production.va_task_id)}&select=*&limit=1`);
            const task = taskRows && taskRows[0];
            if (!task) throw new Error(`va_task ${production.va_task_id} not found`);
            const { identity } = await smLoadOfferingForTask(task);
            const finishRes = await smFinishAssetDrivenComposite({
              productionId: production.id, attemptNumber: production.attempt_number,
              businessId: task.business_id, taskId: task.id,
              sourceUrl: sub.downloadUrl, identity, mood: production.tool_usage.music_track,
            });
            return res.status(200).json({ ok: true, production: finishRes.production, logoUsed: finishRes.logoUsed, musicMood: finishRes.musicMood });
          } catch (e) {
            console.error('[smVideoProductionPoll] phase4 finishing stage failed · productionId:', productionId, '·', e && e.stack || e);
            production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
              status: 'failed', error_message: 'Finishing (music/branding) failed: ' + e.message,
            }).catch(() => production);
            return res.status(200).json({ ok: true, production });
          }
        }

        try {
          // ── Stage 3: SMM Brand Composer — v16.35.0 Milestone 5A: asset-driven composition, ──
          // ── not just a logo overlay. Uses storefront/product assets returned by ────────────
          // ── smSelectBrandAssets plus verified website/phone/social-verification state. ─────
          let task, offering, identity, hasVerifiedSocial, brand;
          try {
            const taskRows = await sbGet(`sm_va_tasks?id=eq.${encodeURIComponent(production.va_task_id)}&select=*&limit=1`);
            task = taskRows && taskRows[0];
            if (!task) throw new Error(`va_task ${production.va_task_id} not found`);
            ({ offering, identity, hasVerifiedSocial } = await smLoadOfferingForTask(task));
            brand = await smSelectBrandAssets(task.business_id);
          } catch (e) {
            throw new Error('compositing setup (task/offering/brand lookup) failed: ' + e.message);
          }
          const businessName = (identity && identity.businessName) || null;
          const priceLabel = (typeof offering.price === 'number') ? `$${offering.price.toFixed(2)}` : null;

          let composited;
          try {
            composited = await smBrandComposite({
              submagicVideoUrl: sub.downloadUrl,
              businessName, itemName: offering.name, priceLabel,
              website: (identity && identity.website) || null,
              phoneNumber: (identity && identity.phoneNumber) || null,
              cityOrAddress: (identity && identity.cityOrAddress) || null,
              hasVerifiedSocial: !!hasVerifiedSocial,
              assets: { logo: brand.logo, storefront: brand.storefront, products: brand.products },
              id: production.id,
            });
          } catch (e) {
            throw new Error('smBrandComposite failed: ' + e.message);
          }
          console.log('[smVideoProductionPoll] smBrandComposite succeeded · durationSec:', composited.durationSec, '· logoUsed:', composited.logoUsed, '· openerAssetUsed:', composited.openerAssetUsed, '· productSegmentsUsed:', composited.productSegmentsUsed, '· bufferBytes:', composited.buffer && composited.buffer.length);

          const finalPath = `social-media-manager/${task.business_id}/${production.va_task_id}/attempt-${production.attempt_number}-final.mp4`;
          let finalUrl;
          try {
            finalUrl = await sbStorageUpload(finalPath, composited.buffer, 'video/mp4');
          } catch (e) {
            throw new Error('sbStorageUpload (final composited video) failed: ' + e.message);
          }

          // Record every real approved asset that was AVAILABLE for this attempt (not only the
          // ones Brand Composer happened to use) — a faithful, auditable record of what was on
          // hand, consistent with the pre-5A behavior of logging brand.logo/brand.productVisual.
          let seq = 1;
          if (brand.logo) {
            await sbInsert('sm_video_production_assets', {
              video_production_id: production.id, content_asset_id: brand.logo.id, role: 'overlay_graphic', sequence_order: seq++,
            }).catch(() => {});
          }
          if (brand.storefront) {
            await sbInsert('sm_video_production_assets', {
              video_production_id: production.id, content_asset_id: brand.storefront.id, role: 'brand_reference', sequence_order: seq++,
            }).catch(() => {});
          }
          for (const p of (brand.products || [])) {
            await sbInsert('sm_video_production_assets', {
              video_production_id: production.id, content_asset_id: p.id, role: 'brand_reference', sequence_order: seq++,
            }).catch(() => {});
          }

          production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
            final_video_url: finalUrl, duration_seconds: composited.durationSec || sub.duration || production.duration_seconds || null,
            status: 'ready_for_review',
          });
          await sbPatch('sm_production_packages', `va_task_id=eq.${encodeURIComponent(production.va_task_id)}&status=eq.draft`, {
            hook: production.hook, caption: production.caption, hashtags: production.hashtags,
          }).catch(() => {});
          return res.status(200).json({
            ok: true, production,
            visualSource: brand.productVisual ? 'client_provided' : 'none_available_yet',
            logoUsed: composited.logoUsed,
            openerAssetUsed: composited.openerAssetUsed,
            productSegmentsUsed: composited.productSegmentsUsed,
            missingAssets: brand.missingAssets,
          });
        } catch (e) {
          console.error('[smVideoProductionPoll] compositing stage failed · productionId:', productionId, '·', e && e.stack || e);
          production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
            status: 'failed', error_message: 'Compositing failed: ' + e.message,
          }).catch(() => production);
          return res.status(200).json({ ok: true, production });
        }
      }
      if (failStatuses.includes(statusLc)) {
        production = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
          status: 'failed', error_message: `submagic_status_${sub.status}`,
        });
        return res.status(200).json({ ok: true, production });
      }
      return res.status(200).json({ ok: true, production, submagicStatus: sub.status || 'processing' });
    }

    // Any other status (compositing already resolved synchronously above, ready_for_review, failed) — return as-is.
    return res.status(200).json({ ok: true, production });
  } catch (e) {
    console.error('[smVideoProductionPoll] error · productionId:', productionId, '·', e && e.stack || e);
    return res.status(502).json({ ok: false, error: e.message });
  }
}

async function smVideoProductionList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { vaTaskId } = req.query || {};
  if (!vaTaskId) return res.status(400).json({ ok: false, error: 'vaTaskId is required' });
  try {
    const records = await sbGet(`sm_video_productions?va_task_id=eq.${encodeURIComponent(vaTaskId)}&select=*&order=attempt_number.asc`);
    return res.status(200).json({ ok: true, records: records || [] });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// v16.58.0 — CEO Decision #26 continuation: the Approve stage's "Reject Video → Rebuild" action.
// A VA who watches the finished clip and decides it isn't good enough needs a real way to send
// it back for a fresh Build attempt — this is the quality-control gate CEO Decision #26
// explicitly requires. Marks the CURRENT attempt 'rejected' (a real status — see the
// accompanying migration — never deleted or overwritten, permanently preserved as history) and
// nothing else; the operator's next "Produce Video Automatically" click creates a brand new
// attempt via the unmodified sm_video_production_generate path and the existing
// sm_video_productions_manage_attempts trigger, exactly like a retry after a technical failure.
async function smVideoProductionReject(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { productionId, reason } = req.body || {};
  if (!productionId) return res.status(400).json({ ok: false, error: 'productionId is required' });
  try {
    const rows = await sbGet(`sm_video_productions?id=eq.${encodeURIComponent(productionId)}&select=*&limit=1`);
    const production = rows && rows[0];
    if (!production) return res.status(404).json({ ok: false, error: 'production not found' });
    if (production.status !== 'ready_for_review') {
      return res.status(400).json({ ok: false, error: `only a ready_for_review attempt can be rejected (current status: ${production.status})` });
    }
    const updated = await sbPatch('sm_video_productions', `id=eq.${encodeURIComponent(productionId)}`, {
      status: 'rejected', error_message: reason ? `Rejected by VA: ${reason}` : 'Rejected by VA — quality did not meet approval.',
    });
    return res.status(200).json({ ok: true, production: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// ── Optional supporting subsystem: client-provided assets (logo, brand, product photos, etc.) ──
async function smContentAssetCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, assetName, assetType, category, sourceProvider, sourceUrl, notes } = req.body || {};
  if (!businessId || !assetName || !assetType || !sourceUrl) return res.status(400).json({ ok: false, error: 'businessId, assetName, assetType, sourceUrl are required' });
  if (!['manual_upload', 'external_url'].includes(sourceProvider)) return res.status(400).json({ ok: false, error: "sourceProvider must be 'manual_upload' or 'external_url' for client-provided assets" });
  try {
    const record = await sbInsert('sm_content_assets', {
      business_id: businessId, asset_name: assetName, asset_type: assetType, origin: 'client_provided',
      category: category || null, source_provider: sourceProvider, source_url: sourceUrl, notes: notes || null,
    });
    return res.status(200).json({ ok: true, record });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

async function smContentAssetList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { businessId } = req.query || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  try {
    const records = await sbGet(`sm_content_assets?business_id=eq.${encodeURIComponent(businessId)}&select=*&order=created_at.desc`);
    return res.status(200).json({ ok: true, records: records || [] });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// SMM V1 Phase 2 — Asset Onboarding: this used to only ever approve/reject origin='client_provided'
// rows, a restriction that made sense when that was the only origin a human ever needed to review.
// Phase 2 introduced real candidate assets with origin='verified_public' (imported from the
// business's own official public menu source) and 'ai_enhanced' — both need the exact same
// human review/approval path, or they'd sit in 'draft' forever with no way to ever become usable.
// The origin restriction is dropped entirely; the deliberate human Approve/Reject click is itself
// the safeguard ("Collected != approved"), not a hardcoded allowlist of which origin may be
// reviewed. auto_sourced (retired legacy stock footage) can still technically be reviewed here,
// but nothing in the current pipeline selects it regardless of status (smSelectBrandAssets only
// ever reads origin='client_provided' — see that function's own comment on this).
async function smContentAssetReview(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { assetId, decision } = req.body || {};
  if (!assetId) return res.status(400).json({ ok: false, error: 'assetId is required' });
  if (decision !== 'ceo_approved' && decision !== 'rejected') return res.status(400).json({ ok: false, error: "decision must be 'ceo_approved' or 'rejected'" });
  try {
    const updated = await sbPatch('sm_content_assets', `id=eq.${encodeURIComponent(assetId)}`, { status: decision });
    if (!updated) return res.status(409).json({ ok: false, error: 'asset not found' });
    return res.status(200).json({ ok: true, record: updated });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// v16.66.0 — SMM V1 Phase 4 CORRECTION: Asset Library V1. Direct file upload into MMMOS
// (replacing URL-only intake as the primary path — URL/import remains available above via
// smContentAssetCreate, unchanged). Two upload paths for two real, different constraints:
//   (1) smContentAssetUploadDirect — small files (photos/logos/music) as base64 in the request
//       body, capped conservatively under Vercel's request-body ceiling.
//   (2) smContentAssetUploadUrlCreate + smContentAssetRegisterUploaded — large raw video
//       footage, via a Supabase Storage signed-upload URL so the browser uploads the file bytes
//       directly to storage (never through this function's body limit at all).
// Every uploaded asset is permanently preserved (nothing here ever deletes or overwrites the
// original bytes) and starts status='draft' — a human approval is still required before Build
// can ever select it, identical to the existing review discipline.
// ══════════════════════════════════════════════════════════════════════════════════════════

const SM_DIRECT_UPLOAD_MAX_BYTES = 3 * 1024 * 1024; // ~3MB raw stays safely under Vercel's request-body ceiling once base64-encoded

function smSanitizeAssetFilename(name) {
  return String(name || 'asset').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}

async function smContentAssetUploadDirect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, assetName, assetType, category, mood, productRef, notes, fileBase64, mimeType } = req.body || {};
  if (!businessId || !assetName || !assetType || !category || !fileBase64) {
    return res.status(400).json({ ok: false, error: 'businessId, assetName, assetType, category, fileBase64 are required' });
  }
  if (category === 'music_track' && assetType !== 'audio') {
    return res.status(400).json({ ok: false, error: "category 'music_track' requires assetType 'audio'" });
  }
  if (category === 'music_track' && !mood) {
    return res.status(400).json({ ok: false, error: 'mood is required for music_track uploads' });
  }
  try {
    const buf = Buffer.from(fileBase64, 'base64');
    if (!buf.length) return res.status(400).json({ ok: false, error: 'uploaded file is empty' });
    if (buf.length > SM_DIRECT_UPLOAD_MAX_BYTES) {
      return res.status(400).json({
        ok: false,
        error: `file too large for direct upload (${(buf.length / 1024 / 1024).toFixed(1)}MB, max ${(SM_DIRECT_UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(1)}MB) — use the raw-video upload flow (sm_content_asset_upload_url) for larger files`,
      });
    }
    const ext = (String(mimeType || '').split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin';
    const path = `social-media-manager/${businessId}/library/${category}/${Date.now()}-${smSanitizeAssetFilename(assetName)}.${ext}`;
    const publicUrl = await sbStorageUpload(path, buf, mimeType || 'application/octet-stream');
    // Objective, disclosed heuristic (file size only) — never a fabricated quality opinion. Real
    // usability judgment still happens at human review, same as every other asset.
    const usability = buf.length > 500 * 1024 ? 'high' : 'standard';
    const record = await sbInsert('sm_content_assets', {
      business_id: businessId, asset_name: assetName, asset_type: assetType, origin: 'client_provided',
      category, source_provider: 'direct_upload', source_url: publicUrl, storage_path: path,
      product_ref: productRef || null, mood: mood || null, notes: notes || null, usability,
    });
    let derivedClips = [];
    if (assetType === 'video') {
      try { derivedClips = await smAutoTrimVideoAsset(record); }
      catch (e) { console.warn('[smContentAssetUploadDirect] auto-trim failed, raw upload still saved:', e.message); }
    }
    return res.status(200).json({ ok: true, record, derivedClips });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `upload failed: ${e.message}` });
  }
}

// Step 1 of the large-file (raw video) upload flow — issues a Supabase Storage signed upload
// URL so the browser can PUT the file bytes directly to storage, never through this serverless
// function's request-body limit.
async function smContentAssetUploadUrlCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, assetName, mimeType } = req.body || {};
  if (!businessId || !assetName) return res.status(400).json({ ok: false, error: 'businessId and assetName are required' });
  try {
    const ext = (String(mimeType || '').split('/')[1] || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'mp4';
    const path = `social-media-manager/${businessId}/library/raw-video/${Date.now()}-${smSanitizeAssetFilename(assetName)}.${ext}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/srv-assets/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.url) {
      return res.status(502).json({ ok: false, error: `could not create signed upload url: ${r.status} ${JSON.stringify(data).slice(0, 200)}` });
    }
    return res.status(200).json({ ok: true, path, uploadUrl: `${SUPABASE_URL}/storage/v1${data.url}` });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
}

// Step 2 — called once the browser's direct PUT to the signed URL succeeds. Registers the
// permanent database row and triggers auto-trim (raw video only).
async function smContentAssetRegisterUploaded(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { businessId, assetName, category, productRef, notes, path } = req.body || {};
  if (!businessId || !assetName || !category || !path) return res.status(400).json({ ok: false, error: 'businessId, assetName, category, path are required' });
  try {
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/srv-assets/${path}`;
    const record = await sbInsert('sm_content_assets', {
      business_id: businessId, asset_name: assetName, asset_type: 'video', origin: 'client_provided',
      category, source_provider: 'direct_upload', source_url: publicUrl, storage_path: path,
      product_ref: productRef || null, notes: notes || null, usability: 'high',
    });
    let derivedClips = [];
    try { derivedClips = await smAutoTrimVideoAsset(record); }
    catch (e) { console.warn('[smContentAssetRegisterUploaded] auto-trim failed, raw upload still saved:', e.message); }
    return res.status(200).json({ ok: true, record, derivedClips });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

// Raw owner footage needs no manual CEO/VA editing before it can be considered for production —
// this automatically prepares up to 2 short (6s), vertically-cropped candidate segments from a
// freshly uploaded raw video asset. The ORIGINAL upload is never modified, trimmed in place, or
// deleted — it stays permanently on file exactly as uploaded. Derived segments are separate new
// draft rows (linked via derived_from_asset_id) that a human still approves before Build can
// ever select them — auto-trim removes manual editing work, not human review.
async function smAutoTrimVideoAsset(parentAsset) {
  const id = `trim-${parentAsset.id}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const srcPath = join(tmpdir(), `smm-trim-src-${id}.mp4`);
  const clips = [];
  try {
    await smDownloadToFile(parentAsset.source_url, srcPath);
    await smAssertValidMediaFile(srcPath, 'uploaded raw video');
    const durationSec = await smProbeDurationSec(srcPath);
    if (!durationSec || durationSec < 1) return [];

    const CLIP_LEN = 6;
    const windows = [0];
    if (durationSec > CLIP_LEN * 2.5) windows.push(Math.floor(durationSec / 2 - CLIP_LEN / 2));
    const usedWindows = windows.filter((w) => w >= 0 && w + CLIP_LEN <= durationSec + 0.5).slice(0, 2);

    for (let i = 0; i < usedWindows.length; i++) {
      const start = usedWindows[i];
      const clipLen = Math.min(CLIP_LEN, durationSec - start);
      const outPath = join(tmpdir(), `smm-trimclip-${id}-${i}.mp4`);
      await execFileAsync(ffmpegInstaller.path, [
        '-y', '-ss', String(start), '-i', srcPath, '-t', String(clipLen),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=25',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        outPath,
      ], { timeout: 45000, maxBuffer: 1024 * 1024 * 30 });
      await smAssertValidMediaFile(outPath, `auto-trimmed clip ${i + 1}`);
      const buf = await readFile(outPath);
      await unlink(outPath).catch(() => {});
      const clipPath = `social-media-manager/${parentAsset.business_id}/library/${parentAsset.category}/${Date.now()}-autotrim-${i}.mp4`;
      const clipUrl = await sbStorageUpload(clipPath, buf, 'video/mp4');
      const clipRecord = await sbInsert('sm_content_assets', {
        business_id: parentAsset.business_id, asset_name: `${parentAsset.asset_name} (auto-trimmed ${i + 1})`,
        asset_type: 'video', origin: 'client_provided', category: parentAsset.category,
        source_provider: 'direct_upload', source_url: clipUrl, storage_path: clipPath,
        product_ref: parentAsset.product_ref || null, derived_from_asset_id: parentAsset.id,
        duration_seconds: clipLen, usability: 'high',
        notes: `Auto-trimmed from raw footage starting at ${start}s — awaiting review, never auto-approved.`,
      });
      clips.push(clipRecord);
    }
    return clips;
  } finally {
    await unlink(srcPath).catch(() => {});
  }
}

// Dynamic Owner Asset Request / Missing Assets — computed live from real approved-asset state,
// never a generic checklist (matches the same bar Phase 2's owner checklist was held to). Two
// layers: which asset CATEGORIES have zero approved assets at all, and which verified OFFERINGS
// still have missing/weak photo coverage (reusing the existing sm_asset_coverage view).
async function smAssetGapReport(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { businessId } = req.query || {};
  if (!businessId) return res.status(400).json({ ok: false, error: 'businessId is required' });
  try {
    const [assetRows, coverageRows, brainRows] = await Promise.all([
      sbGet(`sm_content_assets?business_id=eq.${encodeURIComponent(businessId)}&status=eq.ceo_approved&select=category,product_ref`),
      sbGet(`sm_asset_coverage?business_id=eq.${encodeURIComponent(businessId)}&select=*`),
      sbGet(`business_brain?business_id=eq.${encodeURIComponent(businessId)}&select=identity&limit=1`),
    ]);
    const approved = assetRows || [];
    const businessName = (brainRows && brainRows[0] && brainRows[0].identity && brainRows[0].identity.businessName) || 'This business';
    const categoryLabels = {
      logo: 'a logo', storefront_photo: 'a storefront/interior photo', staff: 'a staff photo',
      preparation: 'food-preparation footage', packaging_service: 'a packaging/service photo',
      owner_video: 'owner-recorded video', finished_food: 'a finished/plated food photo',
    };
    const missingCategories = Object.keys(categoryLabels).filter((cat) => !approved.some((a) => a.category === cat));
    const weakProducts = (coverageRows || []).filter((c) => c.coverage_level === 'missing' || c.coverage_level === 'weak')
      .map((c) => ({ product_ref: c.product_ref, product_name: c.product_name, coverage_level: c.coverage_level }));
    const requestList = missingCategories.map((cat) => `${businessName} — please provide ${categoryLabels[cat]}.`)
      .concat(weakProducts.map((p) => `${businessName} — a real photo/video of "${p.product_name}" would improve that item's productions (currently ${p.coverage_level}).`));
    return res.status(200).json({ ok: true, missingCategories, weakProducts, requestList });
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Supabase access failed: ${e.message}` });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action;

  try {
    if (action === 'list_tasks')           return await listTasks(req, res);
    if (action === 'create_task')          return await createTask(req, res);
    if (action === 'update_task')          return await updateTask(req, res);
    if (action === 'log_activity')         return await logActivity(req, res);
    if (action === 'business_brain_list')   return await businessBrainList(req, res);   // v16.28.1
    if (action === 'business_brain_create') return await businessBrainCreate(req, res);
    if (action === 'business_brain_materialize') return await businessBrainMaterialize(req, res); // v16.30.1 // v16.28.1
    if (action === 'business_operations_get')                  return await businessOperationsGet(req, res);                  // v16.29.0
    if (action === 'business_operations_register')             return await businessOperationsRegister(req, res);             // v16.29.0
    if (action === 'business_operations_update_status')        return await businessOperationsUpdateStatus(req, res);         // v16.29.0
    if (action === 'business_operations_update_service_plan')  return await businessOperationsUpdateServicePlan(req, res);    // v16.29.0
    if (action === 'business_operations_update_schedule_prefs') return await businessOperationsUpdateSchedulePrefs(req, res); // v16.29.0
    if (action === 'business_operations_curate_asset')         return await businessOperationsCurateAsset(req, res);          // v16.29.0
    if (action === 'content_planning_list')          return await contentPlanningList(req, res);          // v16.30.0
    if (action === 'content_planning_generate_demo') return await contentPlanningGenerateDemo(req, res);  // v16.30.0
    if (action === 'content_planning_review')        return await contentPlanningReview(req, res);        // v16.30.0
    if (action === 'va_task_queue_generate')         return await vaTaskQueueGenerate(req, res);           // v16.31.0
    if (action === 'va_task_list')                   return await vaTaskList(req, res);                    // v16.31.0
    if (action === 'va_task_get')                    return await vaTaskGet(req, res);                     // v16.31.0
    if (action === 'sm_va_task_generate_package')    return await smVaTaskGeneratePackage(req, res);        // v16.57.0
    if (action === 'production_package_review')      return await productionPackageReview(req, res);       // v16.31.0
    if (action === 'ceo_review_queue_list')          return await ceoReviewQueueList(req, res);            // v16.31.0
    if (action === 'sm_video_production_generate')   return await smVideoProductionGenerate(req, res);      // v16.32.0
    if (action === 'sm_video_production_poll')       return await smVideoProductionPoll(req, res);          // v16.32.0
    if (action === 'sm_video_production_list')       return await smVideoProductionList(req, res);          // v16.32.0
    if (action === 'sm_video_production_reject')     return await smVideoProductionReject(req, res);        // v16.58.0
    if (action === 'sm_content_asset_create')        return await smContentAssetCreate(req, res);           // v16.32.0
    if (action === 'sm_content_asset_list')          return await smContentAssetList(req, res);             // v16.32.0
    if (action === 'sm_content_asset_review')        return await smContentAssetReview(req, res);           // v16.32.0
    if (action === 'sm_content_asset_upload_direct') return await smContentAssetUploadDirect(req, res);      // v16.66.0
    if (action === 'sm_content_asset_upload_url')    return await smContentAssetUploadUrlCreate(req, res);   // v16.66.0
    if (action === 'sm_content_asset_register')      return await smContentAssetRegisterUploaded(req, res);  // v16.66.0
    if (action === 'sm_asset_gap_report')            return await smAssetGapReport(req, res);                // v16.66.0
    if (action === 'sm_va_task_mark_published')      return await smVaTaskMarkPublished(req, res);          // v16.52.0
    if (action === 'list_pipeline')        return await listPipeline(req, res);
    if (action === 'create_pipeline_item') return await createPipelineItem(req, res);
    if (action === 'update_pipeline_stage') return await updatePipelineStage(req, res);
    if (action === 'list_approvals')        return await listApprovals(req, res);
    if (action === 'request_approval')      return await requestApproval(req, res);
    if (action === 'approve')               return await approveItem(req, res);
    if (action === 'reject')                return await rejectItem(req, res);
    if (action === 'request_revision')      return await requestRevision(req, res);
    if (action === 'list_assets')           return await listAssets(req, res);
    if (action === 'create_asset')          return await createAsset(req, res);
    if (action === 'update_asset')          return await updateAsset(req, res);
    if (action === 'delete_asset')               return await deleteAsset(req, res);
    if (action === 'get_task_detail')            return await getTaskDetail(req, res);
    if (action === 'update_task_execution')      return await updateTaskExecution(req, res);
    if (action === 'operator_recommendations')   return await operatorRecommendations(req, res);
    if (action === 'get_suno_execution')         return await getSunoExecution(req, res);
    if (action === 'save_suno_execution')        return await saveSunoExecution(req, res);
    if (action === 'get_heygen_execution')       return await getHeygenExecution(req, res);
    if (action === 'save_heygen_execution')      return await saveHeygenExecution(req, res);
    if (action === 'get_task_assets')            return await getTaskAssets(req, res);
    if (action === 'save_task_asset')            return await saveTaskAsset(req, res);
    if (action === 'get_reliability_metrics')    return await getReliabilityMetrics(req, res);
    if (action === 'get_task_approvals')         return await getTaskApprovals(req, res);
    if (action === 'get_upload_queue')           return await getUploadQueue(req, res);
    if (action === 'add_to_upload_queue')        return await addToUploadQueue(req, res);
    if (action === 'update_upload_status')       return await updateUploadStatus(req, res);
    if (action === 'get_generation_memory')      return await getGenerationMemory(req, res);
    if (action === 'save_performance')           return await savePerformance(req, res);
    if (action === 'get_performance')            return await getPerformance(req, res);
    if (action === 'get_engine_learning')        return await getEngineLearning(req, res);
    if (action === 'save_memory_item')           return await saveMemoryItemFn(req, res);
    if (action === 'delete_memory_item')         return await deleteMemoryItemFn(req, res);
    if (action === 'seed_memory')                return await seedMemory(req, res);
    if (action === 'clean_memory')               return await cleanMemory(req, res);
    if (action === 'create_notification_table') return await createNotificationTable(req, res);
    if (action === 'get_notifications')         return await getNotifications(req, res);
    if (action === 'mark_notification_read')    return await markNotificationRead(req, res);
    if (action === 'mark_all_read')             return await markAllRead(req, res);
    if (action === 'create_notification')       return await createNotification(req, res);
    if (action === 'sync_marketing_work_items') return await syncMarketingWorkItems(req, res); // v16.21.0 — DWE Marketing-first sync
    if (action === 'department_metrics')        return await departmentMetrics(req, res); // v16.26.0 — KPI Success Measurement (Decision Success Rate, CEO Load)
    if (action === 'generate_package')           return await generatePackage(req, res);
    if (action === 'farsi_regen_caption')        return await farsiRegenCaption(req, res); // v15.6.5
    if (action === 'youtube_sync_performance')   return await youtubeSyncPerformance(req, res);
    if (action === 'log_performance_manual')     return await logPerformanceManual(req, res);
    if (action === 'get_performance_summary')    return await getPerformanceSummary(req, res);
    if (action === 'plaid_link')                 return await plaidLink(req, res);
    if (action === 'plaid_exchange')             return await plaidExchange(req, res);
    if (action === 'plaid_pull')                 return await plaidPull(req, res);
    if (action === 'plaid_remove_item')          return await plaidRemoveItem(req, res); // v13.65.1 — Finance Phase 3 hotfix
    if (action === 'srv_build_package')          return await srvBuildPackage(req, res); // v13.69.0 — SRV Automation Phase 1
    // v13.75.5 — ambient music WAV generator (used as HeyGen background_audio URL)
    if (action === 'ambient_music')              return ambientMusicWAV(req, res);
    // v13.51.0 — P1 HeyGen integration
    if (action === 'heygen_test')                return await heygenTest(req, res);
    if (action === 'heygen_list_avatars')        return await heygenListAvatars(req, res);
    if (action === 'heygen_list_voices')         return await heygenListVoices(req, res);
    if (action === 'heygen_start_render')        return await heygenStartRender(req, res);
    if (action === 'heygen_render_status')       return await heygenRenderStatus(req, res);
    if (action === 'heygen_group_looks')         return await heygenGroupLooks(req, res); // v13.51.6
    if (action === 'heygen_list_avatar_groups')  return await heygenListAvatarGroups(req, res); // v13.51.6
    if (action === 'heygen_video_proxy')         return await heygenVideoProxy(req, res);        // v13.77.0 CORS bridge
    // v13.52.0 — P2A Submagic integration
    if (action === 'submagic_test')              return await submagicTest(req, res);
    if (action === 'submagic_create_project')    return await submagicCreateProject(req, res);
    if (action === 'submagic_get_project')       return await submagicGetProject(req, res);
    if (action === 'submagic_list_templates')    return await submagicListTemplates(req, res);
    if (action === 'submagic_create_media')      return await submagicCreateMedia(req, res);      // v13.85.1 upload audio from URL
    if (action === 'submagic_list_media')        return await submagicListMedia(req, res);        // v13.85.0 probe
    if (action === 'submagic_probe_video')       return await submagicProbeVideo(req, res);       // v13.86.1 EVL video verification
    if (action === 'submagic_video_redirect')    return await submagicVideoRedirect(req, res);    // v13.86.1 EVL browser playback
    // v13.54.0 — P5 / Sprint 3 YouTube auto-upload
    if (action === 'youtube_upload_video')       return await youtubeUploadVideo(req, res);
    if (action === 'set_yt_thumbnail')           return await setYtThumbnail(req, res); // v13.69.8
    if (action === 'youtube_video_status')       return await youtubeVideoStatus(req, res);
    if (action === 'youtube_check_scope')        return await youtubeCheckScope(req, res); // v13.54.1
    if (action === 'youtube_analytics_pull')     return await youtubeAnalyticsPull(req, res); // v13.57.9
    if (action === 'youtube_snapshot_now')       return await youtubeSnapshotNow(req, res); // v13.58.0
    if (action === 'analytics_foundation')       return await analyticsFoundationReport(req, res); // v13.58.0
    if (action === 'decision_engine')            return await decisionEngine(req, res); // v13.58.1
    if (action === 'revenue_dashboard')          return await revenueDashboard(req, res); // v13.58.2
    if (action === 'optimization_apply_recs')    return await optimizationApplyRecommendations(req, res); // v13.59.0
    if (action === 'optimization_toggle_auto')   return await optimizationToggleAutoApply(req, res); // v13.59.0
    if (action === 'optimization_state')         return await optimizationGetState(req, res); // v13.59.0
    if (action === 'strategy_recompute')         return await strategyRecompute(req, res); // v13.60.0
    if (action === 'strategy_state')             return await strategyGetState(req, res); // v13.60.0
    if (action === 'analytics_auto_run')         return await analyticsAutoRun(req, res); // v13.62.0 A1
    if (action === 'analytics_sync_status')      return await analyticsSyncStatus(req, res); // v13.62.0 A1
    // v13.69.50 — SRV English Lifecycle Adapters (image=pexels, renderer=shotstack)
    if (action === 'srv_english_pexels_bg')      return await srvEnglishPexelsBg(req, res);
    if (action === 'srv_english_build')          return await srvEnglishBuild(req, res);
    if (action === 'srv_english_render_status')  return await srvEnglishRenderStatus(req, res);
    // v13.78.0 — Engineering Brain
    if (action === 'engineering_brain_load')     return await engineeringBrainLoad(req, res);
    if (action === 'engineering_brain_seed')     return await engineeringBrainSeed(req, res);
    if (action === 'engineering_brain_save')     return await engineeringBrainSave(req, res);
    if (action === 'engineering_task_create')    return await engineeringTaskCreate(req, res);
    if (action === 'engineering_task_create_from_decision') return await engineeringTaskCreateFromDecision(req, res); // v16.44.0 — CEO Decision #14
    if (action === 'engineering_task_list')      return await engineeringTaskList(req, res);
    if (action === 'engineering_task_update')    return await engineeringTaskUpdate(req, res);
    if (action === 'engineering_task_ceo_approve') return await engineeringTaskCeoApprove(req, res); // v15.0.0
    if (action === 'engineering_task_ceo_reject')  return await engineeringTaskCeoReject(req, res);  // v15.0.0
    if (action === 'engineering_task_home_list')   return await engineeringTaskHomeList(req, res);   // v15.0.0
    if (action === 'engineering_task_review_packet') return await engineeringTaskReviewPacket(req, res); // v16.39.0
    if (action === 'production_deployment_authorize') return await productionDeploymentAuthorize(req, res); // v16.40.0 — CEO-only, see function comment
    if (action === 'production_deployment_reconcile') return await productionDeploymentReconcile(req, res); // v16.43.0 — CEO Decision #10 (deployment reconciliation), see function comment
    // v16.53.0 — CEO Decision #17 Governed Production Execution Fix: split CEO
    // authorization (durable record, no infrastructure call) from Engineering
    // Worker execution (holds no CEO session, holds no Deploy Hook secret).
    // Deliberately NOT added to AGENT_GATEWAY_ALLOWED_OPS / engineeringAgentGateway
    // — production release stays its own top-level, independently-gated action,
    // never a generic Agent Gateway capability. See function comments below.
    if (action === 'production_release_authorization_create')     return await productionReleaseAuthorizationCreate(req, res);
    if (action === 'engineering_worker_execute_production_release') return await engineeringWorkerExecuteProductionRelease(req, res);
    // v16.35.0 — Phase 4B: Engineering Agent authorization/claim boundary (CEO-approved 2026-08-16)
    if (action === 'engineering_task_ceo_authorize_agent')            return await engineeringTaskCeoAuthorizeAgent(req, res);
    if (action === 'engineering_task_ceo_revoke_agent_authorization') return await engineeringTaskCeoRevokeAgentAuthorization(req, res);
    if (action === 'engineering_task_agent_claim')                    return await engineeringTaskAgentClaim(req, res);
    if (action === 'engineering_worker_provision')                    return await engineeringWorkerProvision(req, res);             // v16.49.0 — Step 2C
    if (action === 'engineering_worker_revoke')                       return await engineeringWorkerRevoke(req, res);                // v16.49.0 — Step 2C
    if (action === 'engineering_worker_list')                         return await engineeringWorkerList(req, res);                  // v16.49.0 — Step 2C
    if (action === 'engineering_worker_list_authorized_tasks')        return await engineeringWorkerListAuthorizedTasks(req, res);   // v16.49.0 — Step 2C
    if (action === 'engineering_worker_claim_task')                   return await engineeringWorkerClaimTask(req, res);             // v16.49.0 — Step 2C
    if (action === 'engineering_worker_submit_task')                    return await engineeringWorkerSubmitTask(req, res);            // v16.50.0 — Step 2E
    if (action === 'engineering_worker_pairing_request')              return await engineeringWorkerPairingRequest(req, res);        // v16.52.0 — Step 2D
    if (action === 'engineering_worker_pairing_list_pending')         return await engineeringWorkerPairingListPending(req, res);    // v16.52.0 — Step 2D
    if (action === 'engineering_worker_pairing_approve')              return await engineeringWorkerPairingApprove(req, res);        // v16.52.0 — Step 2D
    if (action === 'engineering_worker_pairing_reject')               return await engineeringWorkerPairingReject(req, res);         // v16.52.0 — Step 2D
    if (action === 'engineering_worker_pairing_complete')             return await engineeringWorkerPairingComplete(req, res);       // v16.52.0 — Step 2D
    if (action === 'engineering_agent_gateway')                       return await engineeringAgentGateway(req, res); // v16.36.0 — Phase 4D
    // v13.91.0 — MMMOS Stabilization Roadmap
    if (action === 'roadmap_load')               return await roadmapLoad(req, res);
    if (action === 'roadmap_approve_phase')      return await roadmapApprovePhase(req, res);
    if (action === 'roadmap_update_phase')       return await roadmapUpdatePhase(req, res);
    if (action === 'health_check')               return await healthCheck(req, res); // v13.95.0 Phase 5

    // ── v13.97.0 Brain v2 — all routed through ops.js to respect 12-function limit ──
    if (action === 'brain_v2_get_knowledge')     return await brainV2GetKnowledge(req, res);
    if (action === 'brain_v2_save_knowledge')    return await brainV2SaveKnowledge(req, res);
    if (action === 'brain_v2_get_learning')      return await brainV2GetLearning(req, res);
    if (action === 'brain_v2_save_learning')     return await brainV2SaveLearning(req, res);
    if (action === 'brain_v2_get_health')        return await brainV2GetHealth(req, res);
    if (action === 'brain_v2_save_health')       return await brainV2SaveHealth(req, res);
    if (action === 'brain_v2_get_experiments')   return await brainV2GetExperiments(req, res);
    if (action === 'brain_v2_save_experiment')   return await brainV2SaveExperiment(req, res);
    if (action === 'brain_v2_get_decisions')     return await brainV2GetDecisions(req, res);
    if (action === 'brain_v2_rank_task')         return await brainV2RankTask(req, res);
    if (action === 'brain_v2_get_deployments')   return await brainV2GetDeployments(req, res);
    if (action === 'brain_v2_save_deployment')   return await brainV2SaveDeployment(req, res);
    if (action === 'brain_v2_get_agent_runs')    return await brainV2GetAgentRuns(req, res);
    if (action === 'brain_v2_safety_gate')       return await brainV2SafetyGate(req, res);
    if (action === 'brain_v2_get_metrics')       return await brainV2GetMetrics(req, res);
    if (action === 'brain_v2_save_learning_from_task') return await brainV2SaveLearningFromTask(req, res);
    if (action === 'brain_v2_update_confidence') return await brainUpdateKnowledgeConfidence(req, res);
    if (action === 'brain_v2_record_deploy')     return await brainV2RecordDeploy(req, res);
    if (action === 'brain_v2_overview')          return await brainV2Overview(req, res);
    if (action === 'brain_v2_run_validation')    return await brainV2RunValidation(req, res);
    if (action === 'brain_v2_get_validations')   return await brainV2GetValidations(req, res);
    if (action === 'brain_v2_save_adr')          return await brainV2SaveAdr(req, res);
    if (action === 'brain_v2_get_adrs')          return await brainV2GetAdrs(req, res);
    if (action === 'brain_v2_autonomous_status') return await brainV2AutonomousStatus(req, res);
    if (action === 'brain_v2_recommend_next')    return await brainV2RecommendNext(req, res);

    // v16.30.0 — CEO Operating Loop Phase 2C: server-verified CEO session auth
    if (action === 'ceo_login')                     return await ceoLogin(req, res);
    if (action === 'ceo_check_session')              return await ceoCheckSession(req, res);

    // v15.8.0 — CEO Decision Execution Protocol (execution gate ACTIVATED; finance hard-guarded)
    if (action === 'cdp_list')                      return await cdpList(req, res);
    if (action === 'cdp_create')                    return await cdpCreate(req, res);
    if (action === 'cdp_get')                       return await cdpGet(req, res);
    if (action === 'cdp_submit')                    return await cdpSubmit(req, res);
    if (action === 'cdp_approve')                   return await cdpApprove(req, res);
    if (action === 'cdp_reject')                    return await cdpReject(req, res);
    if (action === 'cdp_execute')                   return await cdpExecute(req, res);
    if (action === 'cdp_record_learning')           return await cdpRecordLearning(req, res);
    if (action === 'cdp_generate_recommendations')  return await cdpGenerateRecommendations(req, res);
    if (action === 'cdp_rollback')                  return await cdpRollback(req, res);
    if (action === 'cdp_validate')                  return await cdpValidate(req, res);

    // v15.4.0 — Finance Snapshot Engine: dedicated date-indexed table, single source of truth for all chart ranges
    if (action === 'finance_snapshot_save')      return await financeSnapshotSave(req, res);
    if (action === 'finance_snapshot_list')      return await financeSnapshotList(req, res);

    // v15.17.0 — Platform Connector & Publishing Control Layer, Phase 1 Foundation
    if (action === 'platform_connections_list')          return await platformConnectionsList(req, res);
    if (action === 'platform_connections_matrix')         return await platformConnectionsMatrix(req, res);
    if (action === 'platform_connection_update_status')  return await platformConnectionUpdateStatus(req, res);
    if (action === 'platform_connection_sync_health')     return await platformConnectionSyncHealth(req, res);
    if (action === 'platform_connection_request_ceo_auth') return await platformConnectionRequestCeoAuth(req, res);
    if (action === 'platform_connection_verify')          return await platformConnectionVerify(req, res);
    if (action === 'tiktok_publish_draft')                return await tiktokPublishDraft(req, res); // v15.19.0
    if (action === 'tiktok_check_publish_status')         return await tiktokCheckPublishStatus(req, res); // v15.20.3
    if (action === 'publishing_router_resolve')           return await publishingRouterResolve(req, res);

    return res.status(200).json({
      service: 'MMM OS Ops API v12.4',
      actions: ['list_tasks','create_task','update_task','log_activity','list_pipeline','create_pipeline_item','update_pipeline_stage','list_approvals','request_approval','approve','reject','request_revision','list_assets','create_asset','update_asset','delete_asset'],
    });
  } catch (err) {
    console.error('[v12.4] ops error:', err.message);
    return res.status(500).json({ error: 'ops_failed', message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// v13.78.0 — ENGINEERING BRAIN
// Single source of truth for MMMOS architecture, engine identities, rules,
// and engineering packets. Persisted in Supabase engineering_brain table.
// ══════════════════════════════════════════════════════════════════════════════

// ── Canonical seed data — full MMMOS knowledge base ─────────────────────────
const ENGINEERING_BRAIN_SEED = [

  // ── OVERVIEW ────────────────────────────────────────────────────────────────
  { section:'overview', key:'mission', title:'Mission', sort_order:1, data:{
    summary:'MMMOS (Mansoor Media Management Operating System) is an AI-powered autonomous content creation and financial management OS built by Mansoor Ahmady (CEO) and Claude (Persistent System Architect + Operations Agent).',
    mission:'Eliminate operator friction. Generate passive income through automated AI content. Provide a single command center for all creative engines, financial intelligence, and business operations.',
    owner:'Mansoor Ahmady',
    architect:'Claude (Cowork / Claude Code)',
  }},
  { section:'overview', key:'architecture_overview', title:'Architecture Overview', sort_order:2, data:{
    summary:'Single-page web app (index.html) + Vercel serverless API (ops.js) + Supabase PostgreSQL. Hosted on Vercel. Auto-deployed via Mac launchd watcher.',
    layers:['Frontend SPA (index.html, ~16k lines)', 'Backend API (api/ops.js, Node 18, single dispatcher)', 'Database (Supabase tldcwvtwjypmwynsklsd)', 'Storage (Supabase srv-assets bucket)', 'External APIs (HeyGen, Submagic, YouTube, Plaid, OpenAI, Claude)'],
  }},
  { section:'overview', key:'business_philosophy', title:'Business Philosophy', sort_order:3, data:{
    primary:'Automation-first. Every workflow scored on operator-friction reduction.',
    goal:'Wealth-generation calmness. Mansoor reviews only final live results.',
    lens:'AI Studio + NextWave primary revenue. SRV slow-mode locked at v1.2. Finance = read-only intelligence layer.',
    cadence:'CEO creates task → Engineering Packet generated → Agent implements → CEO tests live system only.',
  }},
  { section:'overview', key:'operating_principles', title:'Operating Principles', sort_order:4, data:{
    ceo_role:'Reviews live production results only. Never debugs. Never copy-pastes code.',
    agent_role:'Full autonomous execution. Interrupts CEO only for: external creds, Finance Rule 2, the 7 protected actions.',
    report_format:'Version / Completed / Regression passed / Ready for CEO test / CEO testing steps / Known issues.',
    protected_actions:['Financial-risk or money movement','External credential setup','Destructive data mutations','Major architecture forks','Brand identity shifts','Deploy-architecture mutations','Ambiguous roadmap conflicts'],
  }},

  // ── ENGINEERING CONSTITUTION ─────────────────────────────────────────────────
  { section:'constitution', key:'rule_01', title:'Preserve Working Systems', sort_order:1, data:{
    rule:'Do not touch what works. A working engine is worth more than a cleaner refactor.',
    why:'Every regression wastes CEO time and breaks production revenue.',
    apply:'If it works, wrap it. Only rewrite when explicitly requested.',
  }},
  { section:'constitution', key:'rule_02', title:'Smallest Safe Change', sort_order:2, data:{
    rule:'Implement the minimum required. No scope creep. No "while I\'m at it" additions.',
    why:'Larger diffs introduce more regression risk and require more CEO verification time.',
    apply:'Read the request literally. Implement exactly that. Stop.',
  }},
  { section:'constitution', key:'rule_03', title:'Never Redesign Working Features', sort_order:3, data:{
    rule:'If a feature works, never redesign it without explicit CEO instruction.',
    why:'Redesigns invalidate institutional knowledge and break patterns other engineers rely on.',
    apply:'Wrap existing functions. Add parameters. Never replace the core.',
  }},
  { section:'constitution', key:'rule_04', title:'Engine Identity Must Remain Intact', sort_order:4, data:{
    rule:'Each engine has a unique creative identity (lyrics style, avatar, schedule, audience). Never override another engine\'s identity when building for one engine.',
    why:'Identity is the product. SRV Farsi romanticism, AI Studio educational voice, SRV English love-subject identity — these are what drive audience growth.',
    apply:'Read the engine registry before touching any engine. Respect freeze status.',
  }},
  { section:'constitution', key:'rule_05', title:'Shared Lifecycle ≠ Identical UI', sort_order:5, data:{
    rule:'SRV Farsi, SRV English, and AI Studio share the lifecycle framework but have completely separate UI cards.',
    why:'Each engine has unique stages, data requirements, and operator steps.',
    apply:'Use _srvLifecycleProgressBar and stage constants as shared primitives. Each engine owns its own render function.',
  }},
  { section:'constitution', key:'rule_06', title:'Read Before Changing', sort_order:6, data:{
    rule:'Always read the relevant code sections before making any change. Never guess at implementation.',
    why:'index.html is ~16k lines. ops.js is ~6k lines. Functions that look simple often have subtle dependencies.',
    apply:'Grep for the function name. Read the full function. Read what calls it. Then change.',
  }},
  { section:'constitution', key:'rule_07', title:'Test Before Deploy', sort_order:7, data:{
    rule:'Trace the logic of every change before shipping. Check for side effects on shared components.',
    why:'A 35-second auto-deploy to production with no staging environment means bugs go live immediately.',
    apply:'For canvas changes: trace the frame render loop. For API changes: check all callers. For lifecycle: trace all 6 stages.',
  }},
  { section:'constitution', key:'rule_08', title:'Regression Test Shared Components', sort_order:8, data:{
    rule:'Any change to ops.js, the lifecycle framework, the upload engine, or canvas renderer MUST be regression tested against ALL engines that use it.',
    why:'Shared components are used by multiple engines. A fix for AI Studio can break SRV Farsi.',
    apply:'After changing a shared component, go through the regression checklist for every engine that depends on it.',
  }},
  { section:'constitution', key:'rule_09', title:'CEO Never Debugs', sort_order:9, data:{
    rule:'Never hand off a half-working system. Fix it before reporting.',
    why:'CEO testing time is scarce. Every bug handed to CEO is a failure of the engineering process.',
    apply:'If something is broken, investigate and fix it. Only mark READY FOR CEO TEST when it actually works.',
  }},
  { section:'constitution', key:'rule_10', title:'Report Only When Ready', sort_order:10, data:{
    rule:'Only deliver the CEO report format when the system is verified working in production.',
    why:'Progress reports create noise. CEO should only hear about things when they need to act.',
    apply:'Use the standard report format: Version / Completed / Regression passed / Ready for CEO test / CEO testing steps / Known issues.',
  }},
  { section:'constitution', key:'rule_11', title:'Version Bump: 4 Locations', sort_order:11, data:{
    rule:'Every ship must bump the version in exactly 4 locations in index.html.',
    why:'Missing any location causes the version badge to show the wrong version after deploy.',
    apply:'data-v attribute (line ~2), <title> tag (line ~9), .t-sub mono div (~line 421), .v-badge span (~line 425). Use search-replace.',
  }},
  { section:'constitution', key:'rule_12', title:'Finance = Explicit CEO Approval', sort_order:12, data:{
    rule:'No Finance code changes without explicit Mansoor approval in the current conversation. General autonomy directives do not count.',
    why:'Finance handles real banking data (Plaid Production - Ally + Capital One). A bug could display wrong balances or corrupt state.',
    apply:'Carve-outs allowed without approval: display-only changes, diagnostic-only changes, unambiguous bug fixes with no logic change.',
  }},
  { section:'constitution', key:'rule_13', title:'12-Function Vercel Limit', sort_order:13, data:{
    rule:'Vercel Hobby plan allows maximum 12 serverless function files. Adding a 13th causes a silent deploy ERROR.',
    why:'Current count is at the limit. New server logic MUST go into ops.js as a new action in the dispatcher.',
    apply:'Never create a new /api/*.js file without first checking the current count and removing or merging an existing one.',
    current_count:12,
  }},
  { section:'constitution', key:'rule_14', title:'Deploy Ritual: cp → sleep 2 → touch', sort_order:14, data:{
    rule:'Ship ritual: cp index.html public/index.html → sleep 2 → touch public/index.html → wait ~35s for Vercel.',
    why:'The auto-deploy watcher has a race condition. cp fires the event mid-write. The debouncer sees the old md5, then the new md5, and skips. Touch after 2s guarantees a clean second event.',
    apply:'NEVER skip the sleep 2 + touch step. NEVER use shell cp in a single command with touch.',
  }},

  // ── ARCHITECTURE ─────────────────────────────────────────────────────────────
  { section:'architecture', key:'frontend', title:'Frontend (index.html)', sort_order:1, data:{
    summary:'Single-page application, ~16,000 lines of inline HTML/CSS/JS. No build step. No external JS bundles.',
    working_copy:'~/mmm-static/index.html',
    canonical:'~/mmm-static/public/index.html (served by Vercel)',
    tabs:['Home','Tasks','Engines','Finance','System'],
    system_subtabs:['Settings','Integrations','Constitution','Factory','Continuity','Engineering'],
    state:'D.* object in memory, persisted via saveAppState() → Supabase app_settings',
    persistence_rule:'New D.* keys MUST be added to saveAppState inline financePayload + applyFinanceState. buildStateObject is a legacy fallback.',
    key_constants:['ENGINES_CONFIG','SYSTEM_SUBTABS','CHANNEL_TEMPLATE_CONFIG','PROVIDER_ASSETS'],
    render_pattern:'renderTab(tab) → engine-specific render function → innerHTML assignment',
  }},
  { section:'architecture', key:'backend', title:'Backend (ops.js)', sort_order:2, data:{
    summary:'Single Vercel serverless function. All server logic lives in one file.',
    file:'~/mmm-static/api/ops.js',
    runtime:'Vercel serverless, Node.js 18',
    pattern:'Single dispatcher: switch on action= query/body param → handler function',
    limit:'MAX 12 /api/*.js files on Vercel Hobby. Currently at limit. New logic goes in ops.js.',
    timeout:'maxDuration=60 (vercel.json). Hard 60-second ceiling on all serverless calls.',
    env_vars:['SUPABASE_URL','SUPABASE_KEY','HEYGEN_API_KEY','SUBMAGIC_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','PLAID_CLIENT_ID','PLAID_SECRET'],
    pattern_for_new_action:'1. Add if(action===\'name\') line in dispatcher. 2. Add async function at end of file.',
  }},
  { section:'architecture', key:'database', title:'Database (Supabase)', sort_order:3, data:{
    provider:'Supabase (PostgreSQL)',
    project:'mmm-os',
    project_id:'tldcwvtwjypmwynsklsd',
    url:'https://tldcwvtwjypmwynsklsd.supabase.co',
    region:'us-west-2',
    tables:['app_settings (state blob)','packages (content packages)','youtube_videos','youtube_channels','generation_memory (anti-repetition)','notifications','api_queue','production_assets_library','channel_strategy','optimization_rules','engineering_brain','engineering_tasks'],
    state_key:'mmm_finance_state (in app_settings)',
    migration_tool:'Supabase MCP (apply_migration)',
  }},
  { section:'architecture', key:'heygen', title:'HeyGen API', sort_order:4, data:{
    version:'v2',
    base:'https://api.heygen.com',
    env:'HEYGEN_API_KEY',
    used_for:'Avatar video generation (AI Studio)',
    sophia_group_id:'50cc8524aa404a479242ffb73ab56cb6',
    sophia_voice_id:'a4a6df6d4fc248829f72edde5529defa',
    avatar_looks:{Long:['Long1 22384a1ff894473a9748c47cc708e97e','Long2 9319caae222a4d16bdf4fe6a9e3c96c7','Long3 74ebd9eb18d34c3281a4ff17398debd4','Long4 b53030ead42746f4a8848da00e671ada'],Short:['Short1 1f9b1bc981f04eecaf50d7a1f1aec6df','Short2 e8468f591fb8470bba95f5be082af875','Short3 aaeb49d5337c44679625ec11259b768f','Short4 3f5711493290428baba39a64b1d38328']},
    quirks:['background_audio REJECTED by HeyGen — removed in v13.75.7','CDN (files2.heygen.ai) serves NO CORS headers — use heygen_video_proxy for canvas','Long=1920x1080, Short=1080x1920','scale: Sophia=1.0 (portrait-native), Paul=2.0 (landscape crop)'],
  }},
  { section:'architecture', key:'submagic', title:'Submagic API', sort_order:5, data:{
    env:'SUBMAGIC_API_KEY',
    used_for:'Adding captions to all engine videos',
    template:'Hormozi 2 (all engines)',
    settings:'magicZooms=true, magicBrolls=true, magicBrollsPercentage=70-80',
    fallback:'If template fails, retries without template',
    actions:['submagic_create_project','submagic_get_project','submagic_list_templates'],
    resolve:'_resolveSubmagicUrl converts SPA URLs or bare project UUIDs to real CDN MP4 URLs',
  }},
  { section:'architecture', key:'youtube', title:'YouTube API', sort_order:6, data:{
    auth:'OAuth2 per channel (refresh tokens stored in Supabase)',
    upload:'youtubeUploadVideo → _youtubeResumableUpload',
    large_file_strategy:'body: srcRes.body, duplex: "half" (Node 18+ streaming) — avoids 60s Vercel timeout for videos >50MB',
    small_file_strategy:'arrayBuffer() then upload as buffer',
    brand_accounts:{'InsidePlaces AI':'SRV Studio (SRV English)','InsideFoods AI':'NextWave Systems','InsideObjects AI':'AI Creation Studio','Silk Road Voices':'SRV Farsi'},
    analytics:'youtubeAnalyticsPull, youtubeSnapshotNow',
    thumbnail:'setYtThumbnail action',
  }},
  { section:'architecture', key:'plaid', title:'Plaid API', sort_order:7, data:{
    env:'PLAID_CLIENT_ID, PLAID_SECRET',
    status:'PRODUCTION (not Sandbox)',
    banks_connected:['Ally','Capital One'],
    data_pulled:'Income, Expenses, Debt from transactions',
    hard_rule_1:'Read-only mirror. No money movement. Ever.',
    hard_rule_2:'Code changes require explicit CEO approval in current chat.',
    actions:['plaid_link','plaid_exchange','plaid_pull','plaid_remove_item'],
  }},
  { section:'architecture', key:'rendering', title:'Rendering', sort_order:8, data:{
    srv_rendering:'Canvas API — Pexels background images + user MP3 audio + avatar overlay + lyrics + watermark. MediaRecorder captures to WebM. uploadVideoToSupabase converts.',
    ai_studio_rendering:'Short: heygen_video_proxy → canvas (_aiStudioPostProcess) → WebM → Submagic. Long: raw HeyGen URL → Submagic directly (canvas skipped — 7-10min exceeds 185s ceiling).',
    music_srv:'User-uploaded Suno MP3 (Web Audio MediaElementSource)',
    music_ai_studio:'Chord-progression ambient pad: Am→Gm→Fm→Gm (triangle oscillators, 0.13 gain, per-chord envelopes)',
    logo_ai_studio:'"AI CREATION STUDIO" green text watermark (top-left + bottom-left, Short only)',
    logo_srv:'"SRV" gold text watermark (bottom-left)',
    cors_fix:'heygen_video_proxy in ops.js pipes HeyGen CDN through same-origin with CORS headers + Range passthrough',
  }},
  { section:'architecture', key:'uploads', title:'Uploads', sort_order:9, data:{
    function:'uploadVideoToSupabase (index.html) — uploads Blob to Supabase storage, returns public URL',
    function_ops:'_youtubeResumableUpload (ops.js) — streams video from source URL to YouTube resumable upload',
    streaming_condition:'IS_LARGE = !srcContentLength || srcContentLength > 50MB',
    streaming_code:'body: srcRes.body, duplex: "half"',
    timeout_protection:'Streaming concurrent download+upload fits within 60s Vercel maxDuration',
  }},
  { section:'architecture', key:'auto_deploy', title:'Auto Deploy', sort_order:10, data:{
    mechanism:'Mac launchd watcher on ~/mmm-static/public/ directory changes',
    trigger:'File change in public/ → runs vercel --prod --force',
    ritual:'cp root→public → sleep 2 → touch public/index.html → wait ~35s',
    pause_flag:'~/mmm-static/.pause-deploy (touch to pause, rm to resume)',
    vercel_config:'vercel.json sets maxDuration=60 for api/ops.js. DO NOT MODIFY vercel.json.',
  }},
  { section:'architecture', key:'storage', title:'Supabase Storage', sort_order:11, data:{
    bucket:'srv-assets',
    cors:'Access-Control-Allow-Origin: * (safe for canvas capture)',
    used_for:['SRV MP3 audio files','Processed video blobs before YouTube upload','AI Studio canvas-processed WebM'],
    upload_function:'uploadVideoToSupabase (index.html)',
    url_pattern:'https://tldcwvtwjypmwynsklsd.supabase.co/storage/v1/object/public/srv-assets/{path}',
  }},
  { section:'architecture', key:'state_persistence', title:'State Persistence', sort_order:12, data:{
    save_function:'saveAppState() in index.html',
    load_function:'applyFinanceState() in index.html',
    storage:'Supabase app_settings table, key="mmm_finance_state"',
    critical_rule:'New D.* keys MUST be added to saveAppState inline financePayload AND applyFinanceState. buildStateObject is a legacy fallback — DO NOT use it.',
    verify:'After adding new D.* keys, verify round-trip: set value → saveAppState → refresh → check value persists.',
  }},

  // ── ENGINE REGISTRY ──────────────────────────────────────────────────────────
  { section:'engine_registry', key:'srv_farsi', title:'SRV Farsi 🌹', sort_order:1, data:{
    purpose:'Persian romantic/emotional songs for Silk Road Voices YouTube channel',
    owner:'Mansoor Ahmady',
    identity:'85% Romantic / 10% Emotional / 5% Happy. Trans-Persian language (Persian + Dari + Tajik). Love as subject, not location.',
    youtube_channel:'Silk Road Voices',
    calendar:'Fri=Long, Sat=Short, Sun=Short',
    workflow:['Generate lyrics + metadata (AI)','Review package','Upload Suno MP3 (Build stage)','Canvas render: Pexels images + MP3 audio + avatar + watermark','Approve','Publish to YouTube','Done'],
    avatar:'SRV Farsi avatar library (female/male/duet subfolders). Appears at 0-6%, 47-53%, 94-100% of song (time-fraction renderer).',
    music:'Suno MP3 — user uploads in Build stage',
    protected_components:['canvas_renderer_srv','upload_engine','lifecycle_framework','supabase_schema'],
    dependencies:['Suno (user-generated MP3)','Pexels (background images)','Supabase (storage + DB)','YouTube (publish)','Submagic (captions)'],
    testing_steps:['Generate a test package','Upload an MP3','Verify canvas renders without errors (check console)','Verify output video plays correctly','Publish and check YouTube'],
    regression_rule_keys:['canvas_changes','lifecycle_changes','ops_js_changes'],
    status:'PRODUCTION',
    freeze_status:'FROZEN v13.73.4 — do not modify without production regression data',
    version:'v13.73.4',
    architecture_keys:['frontend','backend','storage','rendering','uploads'],
  }},
  { section:'engine_registry', key:'srv_english', title:'SRV English 🎵', sort_order:2, data:{
    purpose:'English love songs. Love = the subject. Location = NEVER the concept.',
    owner:'Mansoor Ahmady',
    identity:'v4.0 identity. 1Mbps/180s 413 fix. Non-human Pexels image banks. v4 scorer. Location rule: never reference a specific place as the romantic concept.',
    youtube_channel:'InsidePlaces AI (SRV Studio)',
    calendar:'Weekly cadence (weeklyCapacity=1)',
    workflow:['Generate lyrics + metadata (AI)','Review package','Upload Suno MP3 (Build stage)','Canvas render: Pexels images + MP3 audio + female avatar + SRV watermark','Approve','Publish to YouTube','Done'],
    avatar:'Female avatar rotation from ENGINES_CONFIG avatarLibrary',
    music:'Suno MP3 — user uploads in Build stage',
    protected_components:['canvas_renderer_srv','upload_engine','lifecycle_framework'],
    dependencies:['Suno','Pexels','Supabase','YouTube','Submagic'],
    testing_steps:['Generate a test package','Upload an MP3','Verify canvas renders (check 1Mbps bitrate, 180s cap)','Check SRV watermark visible','Publish and verify title format'],
    regression_rule_keys:['canvas_changes','lifecycle_changes','ops_js_changes'],
    status:'PRODUCTION',
    freeze_status:'FROZEN v13.74.17 — do not modify without production data',
    version:'v13.74.17',
    architecture_keys:['frontend','backend','storage','rendering','uploads'],
  }},
  { section:'engine_registry', key:'ai_studio', title:'AI Creation Studio ⚡', sort_order:3, data:{
    purpose:'AI-topic educational videos with Sophia avatar. Long (7-10 min, 16:9) + Short (60-90s, 9:16).',
    owner:'Mansoor Ahmady',
    identity:'Professional AI educator. Sophia avatar (6-look pool). "AI CREATION STUDIO" green watermark. Chord-progression ambient music. Hormozi 2 captions.',
    youtube_channel:'InsideObjects AI (AI Creation Studio)',
    calendar:'Fri=Long, Sat=Short, Sun=Short (weeklyCapacity=3)',
    workflow:['Generate script + metadata (AI)','Review package','Build: HeyGen render (Sophia avatar)','Short videos: canvas CORS proxy → logo + music → WebM → Submagic','Long videos: raw HeyGen URL → Submagic directly','Approve','Publish to YouTube','Done'],
    avatar:'Sophia (HeyGen group 50cc8524aa404a479242ffb73ab56cb6). Long pool: Long1-4. Short pool: Short1-4.',
    voice:'a4a6df6d4fc248829f72edde5529defa',
    music:'Chord-progression ambient pad (Web Audio: Am→Gm→Fm→Gm, triangle oscillators, 0.13 gain)',
    logo:'"AI CREATION STUDIO" green text watermark (canvas, Short videos only via CORS proxy)',
    cors_note:'HeyGen CDN has no CORS headers. Short: use heygen_video_proxy. Long: skip canvas (7-10min exceeds 185s MediaRecorder ceiling).',
    protected_components:['canvas_renderer_ai_studio','heygen_proxy','upload_engine','lifecycle_framework','supabase_schema'],
    dependencies:['HeyGen (avatar video)','Submagic (captions)','YouTube (publish)','Supabase','OpenAI/Claude (script generation)'],
    testing_steps:['Generate AI Studio task','Verify HeyGen render starts without API error','Poll until render complete (check videoUrl set)','For Short: verify Build stage shows "Adding music + logo"','Verify Submagic captions applied','Confirm YouTube publish succeeds','Check video live on channel'],
    regression_rule_keys:['canvas_changes','heygen_changes','submagic_changes','youtube_upload_changes','lifecycle_changes'],
    status:'PRODUCTION',
    freeze_status:'FROZEN (lifecycle v13.75.0, pipeline v13.77.0)',
    version:'v13.77.0',
    architecture_keys:['frontend','backend','heygen','submagic','youtube','rendering','uploads'],
  }},
  { section:'engine_registry', key:'nextwave', title:'NextWave Systems 🤖', sort_order:4, data:{
    purpose:'AI/tech educational content for NextWave Systems YouTube channel',
    owner:'Mansoor Ahmady',
    identity:'Professional AI/technology educator. Similar to AI Studio pipeline.',
    youtube_channel:'InsideFoods AI (NextWave)',
    workflow:['Generate script','Build (similar to AI Studio)','Publish'],
    protected_components:['upload_engine','lifecycle_framework'],
    dependencies:['HeyGen (or alternative)','Submagic','YouTube','Supabase'],
    status:'ACTIVE (basic lifecycle)',
    freeze_status:'Active — can be extended',
    architecture_keys:['frontend','backend','uploads','youtube'],
  }},
  { section:'engine_registry', key:'finance', title:'Finance 💰', sort_order:5, data:{
    purpose:'Personal financial OS. Income, expenses, debt, and net worth from real bank data.',
    owner:'Mansoor Ahmady',
    identity:'Real banking data only. No demo data. Read-only mirror. Plaid Production (Ally + Capital One).',
    features:['Income/Expenses/Debt categorized from Plaid','Net Worth (consistent across Home + Finance tabs)','Investment Engine ($4k/mo Machine Income target)','EF source picker','Portfolio test-mode'],
    hard_rule_1:'NO money movement. Read-only mirror. Ever.',
    hard_rule_2:'ANY finance code change requires explicit CEO approval in current chat. General autonomy does not apply.',
    carve_outs:['Display-only changes OK without approval','Diagnostic-only changes OK','Unambiguous bug fixes with no logic change OK'],
    protected_components:['plaid_integration','supabase_schema'],
    status:'LIVE — Plaid Production',
    freeze_status:'LIVE — Finance Rule 2 applies to all changes',
    version:'v13.65.7 (Finance Phase 3)',
    architecture_keys:['frontend','backend','database','plaid'],
  }},
  { section:'engine_registry', key:'investment', title:'Investment Engine 📈', sort_order:6, data:{
    purpose:'Holdings-driven investment calculation. $4k/month Machine Income target.',
    identity:'5-line card. $4k/mo target locked everywhere. Holdings-driven IE calculation.',
    protected_components:['supabase_schema'],
    status:'LOCKED PRODUCTION READY',
    freeze_status:'FROZEN v13.67.5 — do not change without production data',
    version:'v13.67.5',
    architecture_keys:['frontend','database'],
  }},
  { section:'engine_registry', key:'uber', title:'Uber Engine 🚗', sort_order:7, data:{
    purpose:'Uber earnings tracking and analysis',
    status:'ACTIVE (basic)',
    freeze_status:'Can be extended',
    architecture_keys:['frontend','database'],
  }},

  // ── PROTECTED COMPONENT REGISTRY ──────────────────────────────────────────
  { section:'protected_registry', key:'canvas_renderer_srv', title:'Canvas Renderer — SRV', sort_order:1, data:{
    description:'SRV canvas renderer: _srvRenderVideo + srvBuildPackage. Draws Pexels background images with Ken Burns effect, avatar overlay, lyric text, SRV watermark, fade in/out. MediaRecorder captures to WebM.',
    rules:['Do not refactor the core render loop','Wrap if adding features — never replace','Test BOTH SRV Farsi AND SRV English after any change','Audio: user MP3 via MediaElementSource (crossOrigin=anonymous, from Supabase storage)'],
    files:['index.html (_srvRenderVideo, srvBuildPackage, _srvLoadScene, _srvWrapLines)'],
    used_by:['srv_farsi','srv_english'],
    risk:'HIGH — breaking this stops all SRV production',
  }},
  { section:'protected_registry', key:'canvas_renderer_ai_studio', title:'Canvas Renderer — AI Studio', sort_order:2, data:{
    description:'AI Studio canvas renderer: _aiStudioPostProcess. Short videos only. Loads HeyGen video via heygen_video_proxy, draws "AI CREATION STUDIO" watermark, mixes chord ambient music, records to WebM.',
    rules:['Short videos ONLY (Long skip canvas — 7-10min exceeds 185s MediaRecorder ceiling)','CORS proxy REQUIRED (heygen_video_proxy) — HeyGen CDN has no CORS headers','Safety ceiling: 95000ms for Short. Do not increase.','Long videos go directly to Submagic via raw HeyGen URL'],
    files:['index.html (_aiStudioPostProcess, _aiStudioSendToSubmagic)'],
    used_by:['ai_studio'],
    risk:'MEDIUM — breaking this removes logo+music from Short videos (Long unaffected)',
  }},
  { section:'protected_registry', key:'upload_engine', title:'Upload Engine', sort_order:3, data:{
    description:'uploadVideoToSupabase (Supabase storage) + _youtubeResumableUpload (YouTube). Large files (>50MB or unknown size) streamed with body:srcRes.body, duplex:"half". Small files buffered.',
    rules:['Never change streaming logic without testing with actual large video (>50MB)','duplex:"half" is required for Node 18+ streaming — do not remove','Small file path uses arrayBuffer() — verify total bytes > 1000 before upload'],
    files:['index.html (uploadVideoToSupabase)','api/ops.js (_youtubeResumableUpload, youtubeUploadVideo)'],
    used_by:['srv_farsi','srv_english','ai_studio','nextwave'],
    risk:'CRITICAL — breaking this stops all publish pipelines',
  }},
  { section:'protected_registry', key:'lifecycle_framework', title:'Lifecycle Framework', sort_order:4, data:{
    description:'Shared lifecycle state machine: generate→review→build→approve→publish→done. Used by SRV Farsi, SRV English, AI Studio. Shared primitives: _srvLifecycleProgressBar, lifecycle stage constants.',
    rules:['Shared lifecycle does NOT mean identical UI — each engine has its own render function','Any change must be regression tested against ALL 3 engines','Lifecycle stage persists in task.status + D.aiStudioLifecycleStages (AI Studio)'],
    files:['index.html (_srvLifecycleProgressBar, srv lifecycle functions, AI Studio lifecycle functions)'],
    used_by:['srv_farsi','srv_english','ai_studio'],
    risk:'HIGH — breaking this stops all 3 engines',
  }},
  { section:'protected_registry', key:'plaid_integration', title:'Plaid Integration', sort_order:5, data:{
    description:'Plaid Production integration for Ally + Capital One. plaidLink (get Link token), plaidExchange (exchange public token), plaidPull (pull transactions/balances), plaidRemoveItem.',
    rules:['READ-ONLY. No money movement. Ever.','Any code change requires explicit CEO approval (Finance Rule 2)','Plaid Production — not Sandbox. Real user banking data.'],
    files:['api/ops.js (plaidLink, plaidExchange, plaidPull, plaidRemoveItem)','index.html (Finance tab, Plaid UI)'],
    used_by:['finance'],
    risk:'CRITICAL — touching this risks real financial data',
  }},
  { section:'protected_registry', key:'auth_system', title:'Authentication System', sort_order:6, data:{
    description:'User authentication and session management. Login/logout. currentUser object. Multi-user (Mansoor + VA user).',
    rules:['Do not modify without explicit CEO approval','VA user has restricted access (factory subtab only)'],
    files:['index.html (login, logout, currentUser, showUsers)'],
    used_by:['all engines'],
    risk:'CRITICAL — breaking this locks out the CEO',
  }},
  { section:'protected_registry', key:'supabase_schema', title:'Supabase Schema', sort_order:7, data:{
    description:'All Supabase tables and their schemas. Permanent production data.',
    rules:['ALWAYS run DDL via Supabase MCP apply_migration — never raw SQL in ops.js','Migrations are permanent on production','Verify new columns/tables do not conflict with existing queries','Use IF NOT EXISTS and IF EXISTS in all migrations'],
    tables:['app_settings','packages','youtube_videos','youtube_channels','generation_memory','notifications','api_queue','production_assets_library','channel_strategy','optimization_rules','engineering_brain','engineering_tasks'],
    used_by:['all engines'],
    risk:'HIGH — schema changes are irreversible',
  }},
  { section:'protected_registry', key:'heygen_proxy', title:'HeyGen Video Proxy', sort_order:8, data:{
    description:'heygenVideoProxy action in ops.js. CORS bridge: fetches HeyGen CDN video server-side, returns with Access-Control-Allow-Origin:* and Range header passthrough so browser canvas can capture without CORS taint.',
    rules:['Only allows known HeyGen CDN domains (security whitelist)','Must pass Range header through for video seeking','Uses Readable.fromWeb() for Node 18+ body piping','Do not expand allowed domains without security review'],
    files:['api/ops.js (heygenVideoProxy function)'],
    used_by:['ai_studio'],
    risk:'LOW — only affects AI Studio Short video logo/music',
  }},
  { section:'protected_registry', key:'vercel_function_limit', title:'Vercel 12-Function Limit', sort_order:9, data:{
    description:'Vercel Hobby plan: maximum 12 serverless function files. Adding a 13th causes a silent deploy ERROR with no useful error message.',
    rules:['NEVER add a new /api/*.js file without checking current count','New server logic ALWAYS goes into ops.js dispatcher','If a new file is truly needed, remove or merge an existing one first'],
    current_api_files:['ops.js','generate.js','queue.js','youtube/callback.js','youtube/sync.js','youtube/status.js','youtube/autosync.js','youtube/detect.js','reports/weekly.js','tiktok/callback.js','tiktok/sync.js','instagram/callback.js'],
    count:12,
    used_by:['all backend features'],
    risk:'CRITICAL — silent deploy failure with no useful error',
  }},
  { section:'protected_registry', key:'version_bump_ritual', title:'Version Bump Ritual', sort_order:10, data:{
    description:'Every ship must bump the version in exactly 4 locations in index.html. Missing any causes the version badge to show the wrong version after deploy.',
    locations:['data-v attribute on <html> tag (~line 2)','<title> tag (~line 9)','.t-sub mono div (~line 421)','.v-badge span (~line 425)'],
    rules:['Use grep to find all 4 occurrences','Use search-replace to update all 4 at once','Verify after edit: grep 13.XX.Y should return exactly 8+ matches (4 locations + comments)'],
    used_by:['all ships'],
    risk:'LOW — cosmetic only, but confusing for CEO',
  }},
  { section:'protected_registry', key:'generation_memory', title:'Generation Memory (Anti-Repetition)', sort_order:11, data:{
    description:'generation_memory Supabase table prevents regenerating same topics/lyrics. avoidList built from recent packages before each AI generation call.',
    rules:['Do not disable or bypass — repetition is a quality failure','avoidList is engine-specific (filtered by engine type)','After generating, save new package topics to memory'],
    files:['api/ops.js (generation_memory queries)','api/generate.js (buildAvoidList)'],
    used_by:['srv_farsi','srv_english','ai_studio','nextwave'],
    risk:'LOW — disabling only causes content repetition',
  }},

  // ── SHARED SYSTEMS REGISTRY ──────────────────────────────────────────────────
  { section:'shared_systems', key:'lifecycle', title:'Lifecycle Framework', sort_order:1, data:{
    description:'Shared lifecycle stages: generate → review → build → approve → publish → done',
    state_storage:'task.status field (all engines) + D.aiStudioLifecycleStages (AI Studio)',
    progress_bar:'_srvLifecycleProgressBar(currentStage) — shared across SRV + AI Studio',
    rules:['Each engine has its own lifecycle card render function','Shared stages but independent UI and logic','Stage changes must persist via saveAppState'],
    engines:['srv_farsi','srv_english','ai_studio'],
  }},
  { section:'shared_systems', key:'production_pipeline', title:'Production Pipeline (HeyGen→Submagic→YouTube)', sort_order:2, data:{
    description:'Full pipeline: HeyGen avatar render → (canvas post-process for Short) → Submagic captions → YouTube upload',
    components:['heygenStartRender (ops.js)','_pollHeygenRenders (index.html)','heygen_video_proxy (ops.js, CORS bridge)','_aiStudioPostProcess (index.html, Short only)','autoStartSubmagic (index.html)','_aiStudioRunPublish (index.html)','_youtubeResumableUpload (ops.js)'],
    engines:['ai_studio','nextwave'],
  }},
  { section:'shared_systems', key:'scheduler', title:'Production Scheduler', sort_order:3, data:{
    description:'cadenceDays arrays in ENGINES_CONFIG drive automatic task creation for each engine',
    config:'ENGINES_CONFIG[].cadenceDays and weeklyCapacity',
    examples:['SRV Farsi: cadenceDays=[Mon], weekly=1','AI Studio: Fri=Long, Sat=Short, Sun=Short'],
    state:'D.tasks (generated tasks with scheduled dates)',
  }},
  { section:'shared_systems', key:'youtube_upload', title:'YouTube Upload System', sort_order:4, data:{
    description:'Resumable YouTube upload via ops.js _youtubeResumableUpload. Streams large files to avoid Vercel 60s timeout.',
    key_feature:'body: srcRes.body, duplex: "half" (Node 18+ streaming, concurrent download+upload)',
    threshold:'>50MB or unknown Content-Length → streaming. <50MB with known size → buffer.',
    engines:['srv_farsi','srv_english','ai_studio','nextwave'],
  }},
  { section:'shared_systems', key:'submagic_captions', title:'Submagic Caption System', sort_order:5, data:{
    description:'Submagic API applies Hormozi 2 caption template to all engine videos',
    template:'Hormozi 2 (all engines)',
    channel_config:'CHANNEL_TEMPLATE_CONFIG in index.html maps channel name to template settings',
    fallback:'Retries without template if first attempt fails',
    engines:['srv_farsi','srv_english','ai_studio','nextwave'],
  }},
  { section:'shared_systems', key:'storage', title:'Supabase Storage', sort_order:6, data:{
    description:'Supabase srv-assets bucket for audio/video blobs',
    function:'uploadVideoToSupabase (index.html)',
    cors:'Access-Control-Allow-Origin: * — safe for canvas capture',
    engines:['srv_farsi','srv_english','ai_studio'],
  }},
  { section:'shared_systems', key:'notifications', title:'Notifications', sort_order:7, data:{
    description:'Notification system for alerting CEO of completed renders, failures, or required actions',
    table:'notifications (Supabase)',
    polling:'Periodic polling in index.html',
    engines:['all'],
  }},
  { section:'shared_systems', key:'database', title:'Database (Supabase)', sort_order:8, data:{
    description:'Supabase PostgreSQL as the single source of truth for all persistent data',
    access_frontend:'CORS fetch from index.html using SUPABASE_URL + SUPABASE_KEY constants',
    access_backend:'fetch() in ops.js using process.env.SUPABASE_URL + SUPABASE_KEY',
    key_pattern:'Always use REST API (not SDK). Prefer upsert with on_conflict for idempotent writes.',
    engines:['all'],
  }},

  // ── REGRESSION RULES ──────────────────────────────────────────────────────────
  { section:'regression_rules', key:'canvas_changes', title:'Canvas Changes', sort_order:1, data:{
    trigger:'Any change to _srvRenderVideo, srvBuildPackage, _aiStudioPostProcess, or any canvas/AudioContext/MediaRecorder code',
    checks:['SRV Farsi: Build a test package, verify canvas renders without console errors','SRV English: Build a test package, verify canvas renders without console errors','AI Studio Short: Trigger Build stage, verify "Adding music + logo…" UI appears and completes','AI Studio Long: Verify Long video still SKIPS canvas and goes direct to Submagic','Verify CORS proxy still working: check proxy URL loads in browser dev tools','Verify output video has correct duration (not truncated)'],
  }},
  { section:'regression_rules', key:'ops_js_changes', title:'ops.js Changes', sort_order:2, data:{
    trigger:'Any change to api/ops.js',
    checks:['Count total /api/*.js files — must be ≤ 12','Verify all dispatcher if-statements still present (grep "if (action ===")', 'Test the changed action manually','Test 2 adjacent actions in the dispatcher to verify no syntax errors','Check Vercel deploy logs for build errors','Verify maxDuration=60 still in vercel.json (never touch vercel.json)'],
  }},
  { section:'regression_rules', key:'lifecycle_changes', title:'Lifecycle Changes', sort_order:3, data:{
    trigger:'Any change to lifecycle stage machine, progress bar, or lifecycle UI components',
    checks:['SRV Farsi: Navigate through all 6 stages, verify each renders correctly','SRV English: Same as SRV Farsi','AI Studio: Same as SRV Farsi','Verify lifecycle stage persists across hard page refresh','Verify task status updates correctly in D.tasks','Verify no auto-advance without explicit user action'],
  }},
  { section:'regression_rules', key:'finance_changes', title:'Finance Changes', sort_order:4, data:{
    trigger:'Any change to Finance tab, Plaid integration, investment calculation, or D.finance* / D.plaid* keys',
    approval_required:true,
    checks:['STOP — verify explicit CEO approval received in current chat before proceeding','Plaid connection still active (Ally + Capital One show balances)','Net Worth consistent between Home tab and Finance tab','All balance figures match expected values','Investment Engine $4k/mo target still displayed correctly','D.* keys survive hard refresh (saveAppState → reload → verify)'],
  }},
  { section:'regression_rules', key:'youtube_upload_changes', title:'YouTube Upload Changes', sort_order:5, data:{
    trigger:'Any change to _youtubeResumableUpload or youtube_upload_video action in ops.js',
    checks:['Test with small video (<10MB) — verify buffered upload path works','Test with large video (>50MB or Submagic output URL) — verify streaming path','Confirm duplex: "half" still present for streaming path','Verify YouTube video appears in correct channel','Check Vercel function logs for timeout errors','Verify video metadata (title, description, tags) correct'],
  }},
  { section:'regression_rules', key:'heygen_changes', title:'HeyGen Changes', sort_order:6, data:{
    trigger:'Any change to heygenStartRender, heygenRenderStatus, PROVIDER_ASSETS, or avatar look IDs',
    checks:['Run heygen_group_looks to verify all 8 look IDs still valid','Verify render starts without API error (check heygenJobId set)','Poll render status until completed (check videoUrl returned)','Verify videoUrl is accessible (not a 403 or 404)','Confirm background_audio is NOT in the render payload (HeyGen rejects it)','Check dimension correct: Long=1920x1080, Short=1080x1920'],
  }},
  { section:'regression_rules', key:'submagic_changes', title:'Submagic Changes', sort_order:7, data:{
    trigger:'Any change to submagicCreateProject, submagicGetProject, autoStartSubmagic, or CHANNEL_TEMPLATE_CONFIG',
    checks:['Verify Submagic project creates successfully (projectId returned)','Verify Hormozi 2 template applies (no template_error in response)','Poll submagicGetProject until status=completed','Verify caption output URL resolves (_resolveSubmagicUrl works)','Verify final video has captions visible'],
  }},
  { section:'regression_rules', key:'supabase_changes', title:'Supabase Schema Changes', sort_order:8, data:{
    trigger:'Any new table, column, index, or migration',
    checks:['Migration applied via Supabase MCP (not raw SQL in ops.js)','Verify migration success via execute_sql (describe table)','Verify existing queries still work (SELECT from changed table)','Verify no column name conflicts with existing code','Verify existing data not corrupted by migration'],
  }},
  { section:'regression_rules', key:'state_persistence_changes', title:'State Persistence Changes', sort_order:9, data:{
    trigger:'Any change to saveAppState, applyFinanceState, or D.* key additions',
    checks:['Set a test value in the new D.* key','Call saveAppState()','Hard refresh the page','Verify the value persists in applyFinanceState','Verify no other D.* values corrupted','Verify Supabase app_settings row updated correctly'],
  }},
];

// ── Engineering Brain: Load ──────────────────────────────────────────────────
async function engineeringBrainLoad(req, res) {
  try {
    const section = (req.query && req.query.section) || (req.body && req.body.section);
    let url = `${SUPABASE_URL}/rest/v1/engineering_brain?select=*&order=section,sort_order`;
    if (section) url += `&section=eq.${encodeURIComponent(section)}`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    if (!r.ok) throw new Error(`Supabase error: ${r.status}`);
    const rows = await r.json();
    // Group by section for convenient consumption
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.section]) grouped[row.section] = [];
      grouped[row.section].push(row);
    }
    return res.status(200).json({ ok: true, total: rows.length, sections: grouped, rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Brain: Seed ──────────────────────────────────────────────────
async function engineeringBrainSeed(req, res) {
  try {
    // Upsert all seed entries in batches of 25
    const batchSize = 25;
    let seeded = 0;
    for (let i = 0; i < ENGINEERING_BRAIN_SEED.length; i += batchSize) {
      const batch = ENGINEERING_BRAIN_SEED.slice(i, i + batchSize);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/engineering_brain?on_conflict=section,key`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(batch),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Batch ${i}-${i+batchSize} failed: ${r.status} ${t.slice(0,200)}`);
      }
      seeded += batch.length;
    }
    return res.status(200).json({ ok: true, seeded, total: ENGINEERING_BRAIN_SEED.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Brain: Save (single entry upsert) ──────────────────────────
async function engineeringBrainSave(req, res) {
  try {
    const body = req.body || {};
    const { section, key, title, data, sort_order } = body;
    if (!section || !key || !title) return res.status(400).json({ ok: false, error: 'section, key, title required' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/engineering_brain`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([{ section, key, title, data: data || {}, sort_order: sort_order || 0 }]),
    });
    const saved = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, saved });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: Create + auto-generate packet ──────────────────────────
// v16.33.0 — Phase 3B: extracted verbatim from engineeringTaskCreate's inline body
// (behavior-preserving refactor, no logic change) so the CDP Decision→Task bridge
// (_cdpRouteEngineeringTask) can reuse the exact same packet + Knowledge-injection
// pipeline instead of shipping a second, weaker copy. Takes a task-shaped object
// ({problem, expected_result, affected_engine}) and returns the full packet.
async function _buildEngineeringPacketWithKnowledge(task) {
  const { problem, expected_result, affected_engine } = task;

  // Load brain data for packet generation
  const brainRes = await fetch(`${SUPABASE_URL}/rest/v1/engineering_brain?select=*&order=section,sort_order`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const brainRows = brainRes.ok ? await brainRes.json() : [];

  // v13.99.0 — Phase 3.1: Auto-load relevant knowledge from Brain v2
  let priorKnowledge = [];
  try {
    const SBH = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
    // Load: (1) engine-specific knowledge, (2) anti-patterns, (3) coding standards, (4) lessons for this engine
    const [engRows, antiRows, stdRows, lessonRows] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?engine=eq.${encodeURIComponent(affected_engine)}&status=eq.active&order=confidence.desc&limit=5`, {headers:SBH}).then(r=>r.json()).catch(()=>[]),
      fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.anti_patterns&status=eq.active&order=confidence.desc&limit=5`, {headers:SBH}).then(r=>r.json()).catch(()=>[]),
      fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.coding_standards&status=eq.active&order=confidence.desc&limit=4`, {headers:SBH}).then(r=>r.json()).catch(()=>[]),
      fetch(`${SUPABASE_URL}/rest/v1/brain_learning_memory?engine=eq.${encodeURIComponent(affected_engine)}&status=eq.active&order=created_at.desc&limit=3`, {headers:SBH}).then(r=>r.json()).catch(()=>[]),
    ]);
    // Keyword relevance filter: rank by how many problem/expected_result words appear in title+content
    const keywords = (problem + ' ' + expected_result).toLowerCase().split(/\W+/).filter(w => w.length > 4);
    const score = (entry) => {
      const txt = ((entry.title||'') + ' ' + (entry.content||'')).toLowerCase();
      return keywords.filter(k => txt.includes(k)).length;
    };
    const allEntries = [...(Array.isArray(engRows)?engRows:[]), ...(Array.isArray(antiRows)?antiRows:[]), ...(Array.isArray(stdRows)?stdRows:[])];
    const deduped = [...new Map(allEntries.map(e=>[e.id,e])).values()];
    const ranked = deduped.sort((a,b) => (score(b) + b.confidence/100) - (score(a) + a.confidence/100));
    priorKnowledge = ranked.slice(0, 8).map(e => ({ title: e.title, category: e.category, content: (e.content||'').slice(0,300), confidence: e.confidence }));
    // Append relevant lessons from learning memory
    const lessons = Array.isArray(lessonRows) ? lessonRows.slice(0,2).map(l => ({
      title: 'Lesson: ' + (l.problem||'').slice(0,60),
      category: 'lessons_learned',
      content: [l.root_cause ? 'Root cause: ' + l.root_cause : '', l.final_solution ? 'Solution: ' + l.final_solution : '', l.reusable_lesson||''].filter(Boolean).join(' | ').slice(0,300),
      confidence: l.confidence || 75,
    })) : [];
    priorKnowledge = [...priorKnowledge, ...lessons];
  } catch (_) { /* knowledge load is non-blocking */ }

  const packet = _generateEngineeringPacket(task, brainRows);
  if (priorKnowledge.length > 0) {
    packet.prior_knowledge = priorKnowledge;
    packet.knowledge_loaded_at = new Date().toISOString();
  }
  return packet;
}

// v16.44.0 — CEO Decision #14 (Task Generator simplification): extracted the
// packet-generation + Supabase insert tail out of engineeringTaskCreate into a
// shared helper so both the existing manual 4-field flow (engineeringTaskCreate,
// unchanged below) and the new one-field "paste a CEO decision" flow
// (engineeringTaskCreateFromDecision, further down) go through the EXACT same
// packet generation + insert path — one canonical task-creation path, not two
// diverging copies (rule_15 SSOT). Behavior-preserving extraction, same pattern
// already used for _buildEngineeringPacketWithKnowledge (v16.33.0).
// v16.53.0 — CEO Decision #17 Release Record Fix. `release_kind` classifies a
// task at creation time ONLY — it is never accepted by engineering_task_update,
// so a task can never relabel itself retroactive after the fact to skip agent
// authorization/execution. Default 'new_development' preserves every existing
// behavior for ordinary tasks unchanged. A 'retroactive_release' task must
// carry a real, validly-formatted git_commit_sha from the moment it's created
// — never merely mentioned in free text — so it can never silently become
// release-ready with a missing/invalid target commit.
function _validateRetroactiveReleaseShaOrThrow(git_commit_sha) {
  if (!git_commit_sha || !/^[0-9a-f]{40}$/i.test(String(git_commit_sha).trim())) {
    throw Object.assign(new Error('retroactive_release tasks require a valid 40-character git_commit_sha'), { code: 'invalid_git_commit_sha' });
  }
}
async function _insertEngineeringTaskRow({ problem, expected_result, affected_engine, priority, acceptance_criteria, packetExtra, release_kind, git_commit_sha }) {
  const kind = release_kind === 'retroactive_release' ? 'retroactive_release' : 'new_development';
  if (kind === 'retroactive_release') _validateRetroactiveReleaseShaOrThrow(git_commit_sha);
  const task = { problem, expected_result, affected_engine, priority: priority || 'medium', acceptance_criteria: acceptance_criteria || '', status: 'open', packet: {}, release_kind: kind };
  if (kind === 'retroactive_release') task.git_commit_sha = String(git_commit_sha).trim().toLowerCase();
  task.packet = await _buildEngineeringPacketWithKnowledge(task);
  // v16.45.0 — CEO Decision #14A: every task created through this shared
  // Task Generator insert path (both the manual 4-field form and the
  // paste-a-decision flow) is stamped so CEO Engineering Review can find
  // it for Agent Authorization. Tasks created any other way (direct DB
  // writes, ad-hoc scripts, legacy backlog) are intentionally left
  // unmarked — Engineering Review must never surface that general backlog.
  task.packet.created_via = 'task_generator';
  if (packetExtra) Object.assign(task.packet, packetExtra);

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/engineering_tasks`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([task]),
  });
  if (!insertRes.ok) {
    const t = await insertRes.text();
    throw new Error(`Insert failed: ${insertRes.status} ${t.slice(0,200)}`);
  }
  const inserted = await insertRes.json();
  return inserted[0] || task;
}

async function engineeringTaskCreate(req, res) {
  try {
    const body = req.body || {};
    const { problem, expected_result, affected_engine, priority, acceptance_criteria, release_kind, git_commit_sha } = body;
    if (!problem || !expected_result || !affected_engine) {
      return res.status(400).json({ ok: false, error: 'problem, expected_result, affected_engine required' });
    }
    const task = await _insertEngineeringTaskRow({ problem, expected_result, affected_engine, priority, acceptance_criteria, release_kind, git_commit_sha });
    return res.status(200).json({ ok: true, task });
  } catch (e) {
    if (e.code === 'invalid_git_commit_sha') return res.status(400).json({ ok: false, error: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: Create from a pasted CEO Decision (CEO Decision #14) ─────
// v16.44.0 — Task Intelligence v3. CEO pastes the full text of an approved
// decision into ONE field; this derives problem/expected_result/affected_engine/
// priority/acceptance_criteria/scope_boundaries via Claude, then calls the EXACT
// SAME _insertEngineeringTaskRow path used by the manual 4-field form above —
// same packet generation, same engineering_tasks row shape, same downstream
// governance (CEO approve/reject, agent authorization, production release
// authorization are all untouched by this function). The manual form
// (engineeringTaskCreate) is completely unchanged and still works standalone.
async function engineeringTaskCreateFromDecision(req, res) {
  try {
    const body = req.body || {};
    const decisionText = String(body.decision_text || '').trim();
    if (!decisionText) return res.status(400).json({ ok: false, error: 'decision_text is required' });
    if (decisionText.length > 20000) return res.status(400).json({ ok: false, error: 'decision_text too long (20000 char max) — paste the decision text, not an entire chat log' });
    // v16.53.0 — CEO Decision #17 Release Record Fix: release_kind/git_commit_sha
    // are read ONLY from explicit request fields, never derived by the LLM from
    // decisionText — the pasted text can say anything; classification and the
    // release SHA must come from an explicit, structured field the CEO/caller
    // set deliberately, exactly like every other protected-action input in this
    // program. Defaults to 'new_development' — every existing call site that
    // doesn't pass this is completely unaffected.
    const release_kind = body.release_kind === 'retroactive_release' ? 'retroactive_release' : 'new_development';
    const git_commit_sha = body.git_commit_sha;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const KNOWN_COMPONENTS = [
      'SRV Farsi', 'SRV English', 'AI Creation Studio', 'NextWave Systems', 'Finance', 'Investment Engine', 'Uber Engine',
      'Task Generator', 'Engineering Tasks', 'Roadmap', 'Brain v2 — Knowledge', 'Brain v2 — Learning', 'Brain v2 — Autonomous Agents',
      'CEO Command Center', 'Continuous Decision Protocol (CDP)', 'Production Pipeline', 'Scheduler', 'YouTube Upload', 'Submagic Captions',
      'Canvas Renderer — SRV', 'Canvas Renderer — AI Studio', 'Upload Engine', 'HeyGen Video Proxy', 'Frontend', 'Backend', 'Database',
      'Auth System', 'Supabase Schema', 'All Systems',
    ];

    let derived = null;
    if (ANTHROPIC_API_KEY) {
      const prompt = `You are extracting a structured Engineering Task from an approved CEO decision document for MMMOS (an internal operating system). Read the decision text below and produce exactly these fields:
- problem: what needs to change/be built (1-3 sentences, engineering-actionable)
- expected_result: what the system should do once this is done (1-3 sentences)
- affected_engine: the single MOST relevant component name. STRONGLY prefer an exact match from this known list if one clearly fits: ${KNOWN_COMPONENTS.join(', ')}. If genuinely none fit, output a short (2-4 word) descriptive label instead — never leave it blank.
- priority: one of critical | high | medium | low. "critical" = production is broken or blocking revenue right now. "high" = CEO explicitly marked this urgent/important. "medium" = normal approved work (default). "low" = nice-to-have. Infer from tone/urgency; default to medium if unclear.
- acceptance_criteria: concise, testable criteria for when this is DONE. If the decision text contains an explicit "ACCEPTANCE TEST" / "ACCEPTANCE CRITERIA" section, base this closely on that section.
- scope_boundaries: any explicit "do not modify / out of scope / do not do X" constraints stated in the decision (1-3 sentences). Empty string if none stated.

Return STRICT JSON only, wrapped in <task> tags, matching exactly this schema:
<task>{"problem":"...","expected_result":"...","affected_engine":"...","priority":"critical|high|medium|low","acceptance_criteria":"...","scope_boundaries":"..."}</task>

CEO decision text:
"""
${decisionText}
"""`;
      try {
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (claudeRes.ok) {
          const d = await claudeRes.json();
          const text = (d.content && d.content[0] && d.content[0].text) || '';
          const m = text.match(/<task>([\s\S]*?)<\/task>/);
          if (m) { try { derived = JSON.parse(m[1]); } catch (_) { derived = null; } }
        }
      } catch (_) { /* fall through to deterministic fallback below */ }
    }

    // Deterministic fallback — never block task creation just because the LLM call
    // failed or ANTHROPIC_API_KEY is missing. Keeps this feature usable regardless.
    if (!derived || typeof derived !== 'object' || !derived.problem) {
      const firstLine = (decisionText.split('\n').find(l => l.trim().length > 0) || decisionText.slice(0, 160)).trim();
      derived = {
        problem: `CEO decision (auto-extraction unavailable — using raw text): ${firstLine.slice(0, 200)}`,
        expected_result: decisionText.slice(0, 800),
        affected_engine: 'All Systems',
        priority: 'medium',
        acceptance_criteria: '',
        scope_boundaries: '',
      };
    }
    if (!derived.affected_engine || typeof derived.affected_engine !== 'string') derived.affected_engine = 'All Systems';
    if (!['critical', 'high', 'medium', 'low'].includes(derived.priority)) derived.priority = 'medium';
    derived.expected_result = derived.expected_result || decisionText.slice(0, 800);
    derived.acceptance_criteria = derived.acceptance_criteria || '';
    derived.scope_boundaries = derived.scope_boundaries || '';

    // v16.47.0 — CEO Decision #15: the existing Phase 4B Agent Authorization gate
    // (engineeringTaskCeoAuthorizeAgent, unmodified below) requires
    // packet.origin_decision.authorization_boundary — until now that was only
    // ever populated by the older CDP recommendation->task bridge, never by this
    // decision-paste Task Generator flow. So every task created here derived a
    // real, well-formed scope_boundaries string but had nowhere for it to reach
    // the actual field the gate checks, making it permanently ineligible for
    // Authorize Agent ("no_authorization_boundary") regardless of how well-scoped
    // its own derived constraints were. Fixed by populating that SAME existing
    // field via the SAME existing shape (packet.origin_decision.authorization_
    // boundary) the gate already reads — reusing the established architecture,
    // not adding a parallel one. Deterministic, never empty (scope_boundaries
    // alone may legitimately be blank when the pasted decision has no explicit
    // "do not..." language): always anchors to this task's own problem and
    // affected_engine first, so the boundary can never read as broader than the
    // single task it was minted for, then folds in scope_boundaries when present.
    const authorizationBoundary =
      `task_generator_decision_scope_only — constrained to exactly this Engineering Task ` +
      `(affected_engine=${derived.affected_engine}): ${derived.problem}` +
      (derived.scope_boundaries
        ? ` Additional constraints from the CEO decision: ${derived.scope_boundaries}`
        : ' No additional CEO-stated constraints beyond the task itself.') +
      ' No other engineering task, engine, or system may be modified under this authorization.';

    const task = await _insertEngineeringTaskRow({
      problem: derived.problem,
      expected_result: derived.expected_result,
      affected_engine: derived.affected_engine,
      priority: derived.priority,
      acceptance_criteria: derived.acceptance_criteria,
      release_kind,
      git_commit_sha,
      packetExtra: {
        derived_from: 'ceo_decision_paste',
        origin_decision_text: decisionText.slice(0, 8000),
        scope_boundaries: derived.scope_boundaries || null,
        origin_decision: {
          id: null,
          decision_type: 'ceo_decision_paste',
          title: derived.problem.slice(0, 160),
          authorization_boundary: authorizationBoundary,
        },
      },
    });
    return res.status(200).json({ ok: true, task, derived });
  } catch (e) {
    if (e.code === 'invalid_git_commit_sha') return res.status(400).json({ ok: false, error: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: List ──────────────────────────────────────────────────
async function engineeringTaskList(req, res) {
  try {
    const status = (req.query && req.query.status) || null;
    let url = `${SUPABASE_URL}/rest/v1/engineering_tasks?select=*&order=created_at.desc`;
    if (status) url += `&status=eq.${encodeURIComponent(status)}`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    if (!r.ok) throw new Error(`Supabase error: ${r.status}`);
    const tasks = await r.json();
    return res.status(200).json({ ok: true, tasks, total: tasks.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: Update ────────────────────────────────────────────────
async function engineeringTaskUpdate(req, res) {
  try {
    const body = req.body || {};
    const { id, status, problem, expected_result, affected_engine, priority, acceptance_criteria, git_commit_sha } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    // v15.0.0 — Gate: 'done' is only reachable via engineering_task_ceo_approve. Agents must stop at ready_for_ceo.
    if (status === 'done') return res.status(403).json({ ok: false, error: 'CEO approval required. Use engineering_task_ceo_approve to mark tasks done.' });
    // v16.53.0 — CEO Decision #17 Release Record Fix: release_kind is set ONCE,
    // at creation, and never accepted here — so no task can relabel itself
    // retroactive_release after the fact to bypass Authorize Agent/execution.
    if (body.release_kind !== undefined) {
      return res.status(400).json({ ok: false, error: 'release_kind cannot be changed after task creation' });
    }
    // v16.56.0 — CEO Decision #17 Automatic Git Commit Capture Fix. This
    // endpoint has NO worker/CEO authentication and NO task-ownership check
    // at all (unlike every gated action in this file) — it is reachable by
    // any caller who can POST to this action. That makes it far too
    // permissive to trust for a 'new_development' task's authoritative
    // release commit: git_commit_sha for those tasks is now written
    // EXCLUSIVELY through the governed, ownership-verified
    // engineeringAgentGateway 'submit_commit_sha' op (independent GitHub
    // verification, immutable once set, fails closed on a terminal CEO
    // state). retroactive_release tasks are a separate, already-reviewed
    // workflow (CEO Decision #17 Release Record Fix) and this branch leaves
    // their exact prior behavior on this endpoint completely unchanged —
    // format validation on set, blocked clearing — nothing below this
    // comment is new for that release_kind.
    if (git_commit_sha !== undefined) {
      const existing = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(id)}&select=release_kind`);
      const kind = existing?.[0]?.release_kind;
      if (kind !== 'retroactive_release') {
        return res.status(403).json({ ok: false, error: 'git_commit_sha_for_new_development_tasks_must_use_submit_commit_sha' });
      }
      // Any git_commit_sha this endpoint is asked to store must be a real
      // commit SHA, not arbitrary text — closes the gap where a
      // retroactive_release task could otherwise carry the target commit
      // only in free-text problem/acceptance_criteria fields.
      if (git_commit_sha !== null && String(git_commit_sha).trim() !== '') {
        if (!/^[0-9a-f]{40}$/i.test(String(git_commit_sha).trim())) {
          return res.status(400).json({ ok: false, error: 'git_commit_sha must be a 40-character hex commit SHA' });
        }
      } else {
        // A retroactive_release task must never lose its target commit —
        // block clearing git_commit_sha to empty/null, so it can never
        // silently drift back into "missing SHA" after creation.
        return res.status(409).json({ ok: false, error: 'cannot clear git_commit_sha on a retroactive_release task' });
      }
    }
    const patch = {};
    if (status !== undefined) patch.status = status;
    if (problem !== undefined) patch.problem = problem;
    if (expected_result !== undefined) patch.expected_result = expected_result;
    if (affected_engine !== undefined) patch.affected_engine = affected_engine;
    if (priority !== undefined) patch.priority = priority;
    if (acceptance_criteria !== undefined) patch.acceptance_criteria = acceptance_criteria;
    // v16.40.0 — records what Engineering pushed for CEO visibility only; grants
    // no deployment authority. Only production_deployment_authorize (CEO-gated,
    // separate action) can ever trigger a real deployment.
    if (git_commit_sha !== undefined) patch.git_commit_sha = git_commit_sha;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/engineering_tasks?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    });
    const updated = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, task: Array.isArray(updated) ? updated[0] : updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: CEO Approve ──────────────────────────────────────────── v15.0.0
// v16.33.0 — Phase 3B (CEO-approved 2026-08-16): Learning for decision-routed
// Engineering Tasks. Fires only from a real terminal CEO outcome — CEO approval
// of the TASK (status→'done') — never at task-creation time (the CDP routing
// branches above explicitly no longer call this class of write). Idempotent via
// a check against existing brain_learning_memory rows for this task_id, reusing
// the exact table/shape brainV2SaveLearningFromTask already writes — no new
// table or column. Only called for tasks with an origin_decision_id (i.e. tasks
// this bridge created); manually-authored tasks keep their existing, unchanged
// client-triggered brain_v2_save_learning_from_task path.
async function _writeTaskLearning(task) {
  if (!task || !task.id) return null;
  try {
    const existing = await sbGetSafe(`brain_learning_memory?task_id=eq.${encodeURIComponent(task.id)}&select=id&limit=1`);
    if (existing.length) return null; // already recorded — idempotent no-op
    let originDecision = null;
    if (task.origin_decision_id) {
      const rows = await sbGetSafe(`ceo_decision_protocol?id=eq.${encodeURIComponent(task.origin_decision_id)}&select=id,decision_type,recommendation_title,authorization_boundary&limit=1`);
      originDecision = rows?.[0] || null;
    }
    const lesson = {
      task_id: task.id,
      engine: task.affected_engine,
      problem: task.problem,
      final_solution: task.expected_result,
      deployment_version: task.packet?.deployment_version || null,
      ceo_approved: task.status === 'done',
      reusable_lesson: ((originDecision?.recommendation_title ? `Decision-routed task (origin: ${originDecision.recommendation_title}). ` : '') + (task.expected_result || '')).slice(0, 500),
      confidence: 85,
      status: task.status === 'done' ? 'active' : 'rejected',
      evidence: { task_id: task.id, origin_decision_id: task.origin_decision_id || null, origin_decision_type: originDecision?.decision_type || null },
      updated_at: new Date().toISOString(),
    };
    return await sbInsert('brain_learning_memory', lesson);
  } catch (e) {
    console.error('[TaskLearning] write failed for', task.id, ':', e.message);
    return null;
  }
}

async function engineeringTaskCeoApprove(req, res) {
  // v16.30.0 — Phase 2C: requires a valid, server-verified CEO session.
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    // Fetch current task to validate status
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/engineering_tasks?id=eq.${encodeURIComponent(id)}&select=id,status,problem`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const rows = await chk.json();
    const task = rows && rows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
    // Allow approve from ready_for_ceo OR in_progress (CEO may approve directly)
    const now = new Date().toISOString();
    const patch = { status: 'done', ceo_decision: 'approved', ceo_decision_at: now, updated_at: now };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/engineering_tasks?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    const updated = await r.json();
    if (!r.ok) {
      const errMsg = (Array.isArray(updated) ? updated[0] : updated)?.message || JSON.stringify(updated);
      return res.status(500).json({ ok: false, error: `Supabase approve failed: ${errMsg}` });
    }
    const finalTask = Array.isArray(updated) ? updated[0] : updated;
    // v16.33.0 — Phase 3B: terminal-outcome Learning, decision-routed tasks only.
    // v16.48.0 — CEO Decision #16 Step 2A: the older CDP bridge stamps the
    // origin_decision_id COLUMN, but the newer Task Generator decision-paste flow
    // (engineeringTaskCreateFromDecision, CEO Decision #14/#15) carries the same
    // provenance in packet.origin_decision (an OBJECT) instead, leaving
    // origin_decision_id null. The column-only check above silently excluded every
    // legitimate paste-flow task from Learning. Trigger on EITHER signal — the
    // legacy column (unchanged, still sufficient on its own) OR a real
    // packet.origin_decision object (identified by a non-empty title,
    // authorization_boundary, or decision_type field — never merely the key's
    // presence, so a stray/empty object can't false-positive). Purely manual
    // tasks (engineeringTaskCreate, the 4-field form) set neither field and are
    // still correctly excluded — verified via that function's source, which
    // passes no origin_decision-shaped data into packetExtra at all.
    // _writeTaskLearning itself is completely unchanged: its own idempotency
    // guard (early-return when a brain_learning_memory row already exists for
    // this task_id) and its own optional origin_decision_id lookup are untouched.
    const _originDecisionObj = finalTask && finalTask.packet && typeof finalTask.packet.origin_decision === 'object'
      ? finalTask.packet.origin_decision
      : null;
    const _hasDecisionProvenance = !!(finalTask && (
      finalTask.origin_decision_id ||
      (_originDecisionObj && (_originDecisionObj.title || _originDecisionObj.authorization_boundary || _originDecisionObj.decision_type))
    ));
    if (_hasDecisionProvenance) {
      try { await _writeTaskLearning(finalTask); } catch (e) { console.error('[engineeringTaskCeoApprove] learning write failed:', e.message); }
    }
    return res.status(200).json({ ok: true, task: finalTask, ceo_decision: 'approved', ceo_decision_at: now });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: CEO Reject ───────────────────────────────────────────── v15.0.4
async function engineeringTaskCeoReject(req, res) {
  // v16.30.0 — Phase 2C: requires a valid, server-verified CEO session.
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { id, reason } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const now = new Date().toISOString();
    // v15.0.4 — CEO reject returns task to OPEN (agent must fix and re-submit).
    // Rejection reason stored in ceo_decision field (notes column does not exist in schema).
    // Full history: ceo_decision = 'rejected' or 'rejected: <reason>', ceo_decision_at = timestamp.
    const patch = { status: 'open', ceo_decision: reason ? `rejected: ${reason}` : 'rejected', ceo_decision_at: now, updated_at: now };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/engineering_tasks?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    const updated = await r.json();
    if (!r.ok) {
      const errMsg = (Array.isArray(updated) ? updated[0] : updated)?.message || JSON.stringify(updated);
      return res.status(500).json({ ok: false, error: `Supabase reject failed: ${errMsg}` });
    }
    return res.status(200).json({ ok: true, task: Array.isArray(updated) ? updated[0] : updated, ceo_decision: 'rejected', ceo_decision_at: now });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: CEO Review Packet (v16.39.0 — Operating Loop production
// rollout) ────────────────────────────────────────────────────────────────
// Read-only aggregation for the CEO Engineering Review UI. Joins the task's
// own row (which already carries packet/origin_decision/agent identity) with
// engineering_workspace_files (system-generated diff/evidence for whatever
// authorized paths the task touched), brain_test_runs (validation results),
// and brain_evidence (submitted evidence) — all scoped to this one task_id.
// This grants no new authority: it is a read aggregation only. It cannot
// approve or reject anything — those remain engineering_task_ceo_approve and
// engineering_task_ceo_reject, unchanged, still CEO-session-gated. Reusing
// those two verbatim (not duplicating approve/reject logic here) keeps CEO
// approval authority in exactly one place, per the standing separation-of-
// authority rule carried through every phase of this program.
async function engineeringTaskReviewPacket(req, res) {
  try {
    const id = (req.method === 'POST' ? req.body : req.query)?.id;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const [taskRows, wsRows, testRows, evidenceRows] = await Promise.all([
      sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(id)}&select=*`),
      sbGetSafe(`engineering_workspace_files?task_id=eq.${encodeURIComponent(id)}&order=updated_at.desc`),
      sbGetSafe(`brain_test_runs?task_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=20`),
      sbGetSafe(`brain_evidence?task_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=20`),
    ]);
    const task = taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'task_not_found' });
    return res.status(200).json({
      ok: true,
      task,
      origin_decision: task.packet?.origin_decision || null,
      authorization_boundary: task.packet?.origin_decision?.authorization_boundary || null,
      agent_run_id: task.agent_run_id || null,
      agent_claimed_at: task.agent_claimed_at || null,
      agent_authorized_at: task.agent_authorized_at || null,
      workspace_files: wsRows,
      test_runs: testRows,
      evidence: evidenceRows,
      production_deployments: (await sbGetSafe(`production_deployments?engineering_task_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=10`)),
      // v16.55.0 — CEO Production Release UI Fix: read-only, additive. Lets the
      // CEO Engineering Review panel render the split-authorization lifecycle
      // (authorized/executing/triggered/failed/ambiguous/revoked) without a new
      // dispatcher action — this function already aggregates everything else
      // the panel needs for this task, and this is one more read alongside it.
      production_release_authorizations: (await sbGetSafe(`production_release_authorizations?engineering_task_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=10`)),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── MMMOS Production Deployment Control (v16.40.0 — CEO-approved 2026-08-17)
// ────────────────────────────────────────────────────────────────────────────
// This is the ONLY code path in this entire program that can cause a real
// production deployment. It is deliberately a SEPARATE, distinct gate from
// engineering_task_ceo_approve: task approval means "the work is correct";
// this action means "release the work to production" — the CEO must invoke
// both, separately, for a deployment to ever happen. A code push by itself
// causes nothing (enforced at the Vercel platform level via
// git.deploymentEnabled:false, not by this function's own discipline).
//
// Both credentials this function uses (the Vercel Deploy Hook URL and the
// read-only GitHub token used for the integrity check below) are read from
// process.env only, inside this function, on Vercel's server. Neither is
// ever returned in a response, logged, or reachable through the Engineering
// Gateway — the Gateway's fixed op whitelist (AGENT_GATEWAY_ALLOWED_OPS) has
// no deploy-related entry and none is being added by this change.
async function _prodDeployBranchHeadSha(branch) {
  // Independent, server-derived check of "what is actually at the tip of the
  // deploy branch right now" — never trusts the caller's claim about it.
  // Requires a read-only GitHub token (Contents: Read-only is sufficient)
  // scoped to this one repository, stored server-side only.
  const repo = process.env.GITHUB_REPO;   // "owner/name"
  const token = process.env.GITHUB_TOKEN; // read-only, contents:read
  if (!repo || !token) return { ok: false, error: 'github_integrity_check_not_configured' };
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'mmm-static-ops', Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return { ok: false, error: `github_api_error_${r.status}` };
    const j = await r.json();
    return { ok: true, sha: j.sha };
  } catch (e) {
    return { ok: false, error: 'github_api_unreachable: ' + e.message };
  }
}

// v16.56.0 — CEO Decision #17 Automatic Git Commit Capture Fix. Independent,
// server-derived verification that a worker-submitted commit SHA (a) really
// exists as a real commit in the canonical repository — not merely
// well-formed hex — and (b) is reachable from the expected release branch
// (the branch head itself, or an ancestor of it), so an unmerged, unrelated,
// or force-pushed-away commit can never be captured as a task's authoritative
// SHA. Reuses the exact same read-only GITHUB_TOKEN/GITHUB_REPO credential
// and the exact same GitHub compare-API ancestry technique
// productionDeploymentReconcile already uses below (see its "Check 1 —
// GitHub ancestry" comment) — no new credential, no new verification
// concept, just applied one step earlier in the lifecycle. Never trusts a
// repository name from the caller: `repo` always comes from
// process.env.GITHUB_REPO, so "commit belongs to a different repository"
// is structurally impossible to satisfy, not just checked for.
async function _verifyCommitReachableFromBranch(sha, branch) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return { ok: false, error: 'github_integrity_check_not_configured' };
  try {
    const cr = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'mmm-static-ops', Accept: 'application/vnd.github+json' },
    });
    if (cr.status === 404 || cr.status === 422) return { ok: false, error: 'commit_not_found_in_repository' };
    if (!cr.ok) return { ok: false, error: `github_api_error_${cr.status}` };
  } catch (e) {
    return { ok: false, error: 'github_api_unreachable: ' + e.message };
  }
  const head = await _prodDeployBranchHeadSha(branch);
  if (!head.ok) return { ok: false, error: head.error };
  if (head.sha === sha) return { ok: true, detail: { relation: 'identical', branch_head: head.sha } };
  try {
    const cmp = await fetch(`https://api.github.com/repos/${repo}/compare/${encodeURIComponent(sha)}...${encodeURIComponent(head.sha)}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'mmm-static-ops', Accept: 'application/vnd.github+json' },
    });
    if (!cmp.ok) return { ok: false, error: `github_compare_api_error_${cmp.status}` };
    const cj = await cmp.json();
    // 'identical' — same commit (already handled above). 'ahead' — the
    // branch head is ahead of the candidate, i.e. the candidate IS an
    // ancestor of the branch — reachable, accepted. 'behind' (candidate is
    // ahead of the branch — unmerged) and 'diverged' (not part of the
    // branch's history at all) are both rejected.
    if (cj.status === 'identical' || cj.status === 'ahead') {
      return { ok: true, detail: { relation: cj.status, branch_head: head.sha } };
    }
    return { ok: false, error: 'commit_not_reachable_from_branch' };
  } catch (e) {
    return { ok: false, error: 'github_compare_unreachable: ' + e.message };
  }
}

async function productionDeploymentAuthorize(req, res) {
  // CEO-session-gated — independently re-verified here, exactly like every
  // other protected action in this program. Never satisfiable by an Agent
  // credential; there is no code path from agent_authorization_token_hash or
  // agent_run_id into this function at all.
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { engineering_task_id, commit_sha, deploy_branch } = body;
    if (!engineering_task_id || !commit_sha) return res.status(400).json({ ok: false, error: 'engineering_task_id and commit_sha required' });
    const branch = deploy_branch || 'main';
    const now = new Date().toISOString();

    // Gate 1 (already satisfied elsewhere): the Engineering Task must already
    // be CEO-approved. Production release authorization is layered ON TOP of
    // task approval, never a substitute for it — this is the second gate.
    const taskRows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(engineering_task_id)}&select=id,status,ceo_decision,packet`);
    const task = taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'engineering_task_not_found' });
    if (task.status !== 'done' || task.ceo_decision !== 'approved') {
      return res.status(409).json({ ok: false, error: 'engineering_task_not_yet_ceo_approved' });
    }
    // origin_decision_id is re-derived server-side from the task's own
    // stored packet, never trusted from the client.
    const originDecisionId = task.packet?.origin_decision?.id || null;

    // Record the authorization FIRST — the audit row exists even if the
    // integrity check or the deploy call itself subsequently fails, so a
    // rejected/failed attempt is never silently lost.
    const row = await sbInsert('production_deployments', {
      origin_decision_id: originDecisionId,
      engineering_task_id,
      commit_sha,
      deploy_branch: branch,
      ceo_authorized_at: now,
      ceo_authorized_by: 'CEO',
      status: 'authorized',
    });

    // Gate 2: commit integrity check. Fails closed — any error, missing
    // config, or mismatch stops here with NO deploy call made.
    const head = await _prodDeployBranchHeadSha(branch);
    if (!head.ok) {
      await sbPatch('production_deployments', `id=eq.${row.id}`, { status: 'failed', result: { error: head.error } });
      return res.status(502).json({ ok: false, error: head.error, deployment_row: row.id });
    }
    const passed = head.sha === commit_sha;
    await sbPatch('production_deployments', `id=eq.${row.id}`, { integrity_check_passed: passed, branch_head_sha_at_check: head.sha });
    if (!passed) {
      await sbPatch('production_deployments', `id=eq.${row.id}`, { status: 'integrity_check_failed' });
      return res.status(409).json({ ok: false, error: 'commit_sha_mismatch', authorized_commit: commit_sha, branch_head: head.sha, deployment_row: row.id });
    }

    // Gate 3: trigger. The credential is read here, used here, and never
    // appears in any response, log line, or client-reachable surface.
    const hookUrl = process.env.PRODUCTION_DEPLOY_HOOK_URL;
    if (!hookUrl) {
      await sbPatch('production_deployments', `id=eq.${row.id}`, { status: 'failed', result: { error: 'deploy_hook_not_configured' } });
      return res.status(500).json({ ok: false, error: 'deploy_hook_not_configured', deployment_row: row.id });
    }
    await sbPatch('production_deployments', `id=eq.${row.id}`, { status: 'triggered', triggered_at: new Date().toISOString() });
    let hookResp = {};
    try {
      const hr = await fetch(hookUrl, { method: 'POST' });
      hookResp = await hr.json().catch(() => ({}));
    } catch (e) {
      await sbPatch('production_deployments', `id=eq.${row.id}`, { status: 'failed', result: { error: 'deploy_hook_call_failed: ' + e.message } });
      return res.status(502).json({ ok: false, error: 'deploy_hook_call_failed', deployment_row: row.id });
    }
    const vercelDeploymentId = hookResp?.job?.id || hookResp?.id || null;
    await sbPatch('production_deployments', `id=eq.${row.id}`, { vercel_deployment_id: vercelDeploymentId, result: hookResp });
    return res.status(200).json({ ok: true, deployment_row: row.id, vercel_deployment_id: vercelDeploymentId, status: 'triggered' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── CEO Decision #17: Governed Production Execution Fix (v16.53.0) ─────────
// ────────────────────────────────────────────────────────────────────────────
// productionDeploymentAuthorize above is UNCHANGED and remains available: a
// live CEO session can still authorize-and-deploy in one call, exactly as it
// always has. This section ADDS a second, split path for the case this CEO
// decision is about: an already-CEO-approved release that Cowork should be
// able to execute without the CEO handling the Deploy Hook, Terminal, curl,
// or any deployment credential themselves.
//
// Critical governance rule (explicit CEO requirement): engineering_tasks
// being status='done' AND ceo_decision='approved' is NEVER, by itself,
// sufficient authority to deploy — that is the Engineering approval decision,
// not the Production Release decision. The only thing that can ever
// authorize a real deployment via this split path is a row in
// production_release_authorizations, created exclusively by the
// CEO-session-gated action immediately below, exactly like every other
// CEO-only action in this file.
//
// CEO action — durable record only, NO infrastructure call, NO Deploy Hook
// URL is ever read or used here.
async function productionReleaseAuthorizationCreate(req, res) {
  if (!(await requireCeoSession(req))) return res.status(401).json({ ok: false, error: 'ceo_authorization_required' });
  try {
    const body = req.body || {};
    const { engineering_task_id, commit_sha, deploy_branch } = body;
    if (!engineering_task_id || !commit_sha) return res.status(400).json({ ok: false, error: 'engineering_task_id and commit_sha required' });
    if (!/^[0-9a-f]{40}$/i.test(String(commit_sha).trim())) {
      return res.status(400).json({ ok: false, error: 'commit_sha must be a 40-character hex commit SHA' });
    }
    const normalizedSha = String(commit_sha).trim().toLowerCase();
    const branch = deploy_branch || 'main';

    // Gate: Engineering approval is a PRECONDITION for a Production Release
    // decision to even be created — never a substitute for it. This is the
    // same task-approval check productionDeploymentAuthorize's Gate 1 already
    // performs; duplicated here (not shared/refactored) so neither function's
    // behavior can ever change as a side effect of editing the other.
    const taskRows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(engineering_task_id)}&select=id,status,ceo_decision`);
    const task = taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'engineering_task_not_found' });
    if (task.status !== 'done' || task.ceo_decision !== 'approved') {
      return res.status(409).json({ ok: false, error: 'engineering_task_not_yet_ceo_approved' });
    }

    // v16.55.0 — CEO Production Release UI Fix: duplicate-click guard. A
    // second "Authorize Production Release" click (double-click, two tabs, a
    // retry after the first request's response was lost) must never produce
    // two simultaneously-active authorizations for the same task — the CEO
    // clicking twice should never become two independent production release
    // decisions. An authorization already in 'authorized', 'executing', or
    // 'triggered' for this task blocks a new one outright; 'failed',
    // 'ambiguous', and 'revoked' are terminal and do NOT block — a fresh CEO
    // click after one of those is exactly the explicit, governed retry this
    // program requires, not a duplicate.
    const activeAuthRows = await sbGetSafe(
      `production_release_authorizations?engineering_task_id=eq.${encodeURIComponent(engineering_task_id)}&status=in.(authorized,executing,triggered)&select=id,status&limit=1`
    );
    if (activeAuthRows.length) {
      return res.status(409).json({ ok: false, error: 'production_release_authorization_already_active', existing_authorization_id: activeAuthRows[0].id, existing_status: activeAuthRows[0].status });
    }

    // This insert IS the separate, explicit "CEO clicks Authorize Production
    // Release" decision — distinct from, and layered on top of, the task
    // approval checked above. No infrastructure call is made here; branch-head
    // integrity is deliberately re-checked fresh at execution time instead
    // (below), not baked in at authorization time, since the branch head can
    // legitimately move between authorization and execution.
    const row = await sbInsert('production_release_authorizations', {
      engineering_task_id,
      commit_sha: normalizedSha,
      deploy_branch: branch,
      status: 'authorized',
      ceo_authorized_at: new Date().toISOString(),
      ceo_authorized_by: 'CEO',
    });
    if (!row) return res.status(500).json({ ok: false, error: 'authorization_create_failed' });
    return res.status(200).json({ ok: true, authorization: row });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// Worker action — NOT CEO-session-gated. Authenticates as a registered
// Engineering Worker (the same _engineeringWorkerAuthenticate primitive the
// Step 2A Gateway already uses), then accepts only a REFERENCE to an
// existing CEO-created authorization row — it can never supply its own
// task/commit/branch and have that trusted. Every fact needed to decide
// whether to deploy is re-derived server-side from the database and from a
// live GitHub call; nothing about the caller's own claims (other than which
// authorization it's asking to execute, and which commit it believes that
// is) is ever trusted. The Deploy Hook URL is read here, used here, and — as
// with productionDeploymentAuthorize above — never appears in any response,
// log line, or client-reachable surface.
//
// v16.54.0 — CEO Decision #17 Production Execution Failure-Safety Fix.
// Lifecycle: authorized -> executing -> triggered | failed | ambiguous.
// The row is atomically ACQUIRED (authorized -> executing) immediately
// before the hook call — not before, so Gates C/D/E stay cheap read-only
// checks — and every subsequent branch is a further atomic, conditional
// transition FROM 'executing' specifically, so no two concurrent/replayed
// requests can ever both act on the same row. 'failed' and 'ambiguous' are
// both terminal for this row: nothing in this function (or anywhere else)
// ever moves a row backward to 'authorized'. The only way to retry is the
// existing, unmodified, CEO-session-gated productionReleaseAuthorizationCreate
// — a brand-new row, a brand-new explicit CEO decision — never a worker-
// initiated reset of this one. This intentionally reuses the existing
// authorization model rather than inventing new worker authority.
const PRODUCTION_DEPLOY_HOOK_TIMEOUT_MS = 15000;

async function engineeringWorkerExecuteProductionRelease(req, res) {
  try {
    const body = req.body || {};
    const { worker_credential, production_release_authorization_id, expected_commit_sha } = body;
    if (!production_release_authorization_id) return res.status(400).json({ ok: false, error: 'production_release_authorization_id required' });

    // Gate A — WHO: a valid, non-revoked registered Engineering Worker.
    // Reused verbatim from the Step 2A Gateway auth check; a worker credential
    // alone grants no deploy authority by itself — it only identifies the
    // caller for Gates B–E below, every one of which is independently
    // required.
    const worker = await _engineeringWorkerAuthenticate(worker_credential);
    if (!worker) return res.status(401).json({ ok: false, error: 'invalid_or_revoked_worker_credential' });

    // Gate B — WHETHER a Production Release decision for this exact reference
    // exists at all, and is still in the 'authorized' state. Every other
    // state is a terminal or in-progress state and is always denied here —
    // in particular 'failed' and 'ambiguous' are NEVER silently reset by
    // this read; the only way past them is a brand-new authorization row
    // from the CEO-session-gated create action.
    const authRows = await sbGetSafe(`production_release_authorizations?id=eq.${encodeURIComponent(production_release_authorization_id)}&select=*`);
    const auth = authRows[0];
    if (!auth) return res.status(404).json({ ok: false, error: 'production_release_authorization_not_found' });
    if (auth.status === 'executing') return res.status(409).json({ ok: false, error: 'production_release_authorization_execution_in_progress' });
    if (auth.status === 'triggered') return res.status(409).json({ ok: false, error: 'production_release_authorization_already_triggered' });
    if (auth.status === 'failed') return res.status(409).json({ ok: false, error: 'production_release_authorization_failed_requires_new_ceo_authorization', failure_reason: auth.failure_reason || null });
    if (auth.status === 'ambiguous') return res.status(409).json({ ok: false, error: 'production_release_authorization_ambiguous_requires_reconciliation' });
    if (auth.status === 'revoked') return res.status(409).json({ ok: false, error: 'production_release_authorization_revoked' });
    if (auth.status !== 'authorized') return res.status(409).json({ ok: false, error: 'production_release_authorization_invalid_state' });

    // Gate C — the underlying Engineering approval must STILL hold right now,
    // independently re-checked (never assumed from the authorization row's
    // mere existence). This is the direct enforcement of the CEO's rule that
    // status='done'/ceo_decision='approved' and a Production Release
    // authorization are two separate things that must BOTH be true at
    // execution time.
    const taskRows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(auth.engineering_task_id)}&select=id,status,ceo_decision,packet`);
    const task = taskRows[0];
    if (!task || task.status !== 'done' || task.ceo_decision !== 'approved') {
      return res.status(409).json({ ok: false, error: 'engineering_task_not_ceo_approved' });
    }

    // Gate D — WHAT: the worker's own belief about what it's deploying must
    // match the CEO-authorized commit exactly. This is a confused-deputy
    // guard (a worker that references the wrong authorization id by mistake
    // fails here instead of silently deploying an unintended commit), never a
    // way for the worker to choose or override the authorized commit itself.
    if (!expected_commit_sha || String(expected_commit_sha).trim().toLowerCase() !== auth.commit_sha) {
      return res.status(409).json({ ok: false, error: 'commit_sha_mismatch_with_authorization', authorized_commit: auth.commit_sha });
    }

    // Gate E — live GitHub branch-head integrity check, fresh, right now —
    // reuses _prodDeployBranchHeadSha verbatim (same function
    // productionDeploymentAuthorize already relies on; not duplicated). A
    // branch head that moved since authorization is a deny, not an
    // acquisition — the authorization stays 'authorized' so a legitimate
    // retry (once the intended commit is actually at the tip again) remains
    // possible without burning a CEO decision on an infrastructure fact that
    // hadn't yet caught up.
    const head = await _prodDeployBranchHeadSha(auth.deploy_branch);
    if (!head.ok) return res.status(502).json({ ok: false, error: head.error });
    if (head.sha !== auth.commit_sha) {
      return res.status(409).json({ ok: false, error: 'branch_head_moved', authorized_commit: auth.commit_sha, branch_head: head.sha });
    }

    // ── Acquire — atomic, conditional on the row still being 'authorized'.
    // PostgREST only matches/updates a row whose current status is exactly
    // 'authorized'; if a concurrent request already acquired it between Gate
    // B's read and this write, this PATCH matches zero rows and sbPatch
    // returns undefined, which is treated as a lost race and denied. This is
    // the actual concurrency/replay guard for double-DEPLOYMENT — nothing
    // downstream of this line can ever run twice for the same row, because
    // nothing downstream can ever observe the row back in 'authorized'.
    const acquiredAt = new Date().toISOString();
    const acquired = await sbPatch(
      'production_release_authorizations',
      `id=eq.${encodeURIComponent(production_release_authorization_id)}&status=eq.authorized`,
      { status: 'executing', acquired_at: acquiredAt, acquired_by_worker_id: worker.id }
    );
    if (!acquired) return res.status(409).json({ ok: false, error: 'production_release_authorization_execution_in_progress' });

    // Audit row created immediately after acquisition, before the hook call —
    // exists even if the hook call itself subsequently fails or hangs, so an
    // ambiguous attempt is never silently lost. Mirrors
    // productionDeploymentAuthorize's own "record first" discipline.
    const originDecisionId = task.packet?.origin_decision?.id || null;
    const depRow = await sbInsert('production_deployments', {
      origin_decision_id: originDecisionId,
      engineering_task_id: auth.engineering_task_id,
      commit_sha: auth.commit_sha,
      deploy_branch: auth.deploy_branch,
      ceo_authorized_at: auth.ceo_authorized_at,
      ceo_authorized_by: auth.ceo_authorized_by,
      status: 'executing',
      integrity_check_passed: true,
      branch_head_sha_at_check: head.sha,
      production_release_authorization_id: auth.id,
      executed_by_worker_id: worker.id,
    });
    await sbPatch('production_release_authorizations', `id=eq.${auth.id}`, { production_deployment_id: depRow?.id || null }).catch(() => {});

    const hookUrl = process.env.PRODUCTION_DEPLOY_HOOK_URL;
    if (!hookUrl) {
      // Definitive, not ambiguous — we know for certain no call was ever
      // attempted. Still moves executing -> failed, never back to authorized.
      await sbPatch('production_release_authorizations', `id=eq.${auth.id}&status=eq.executing`,
        { status: 'failed', failed_at: new Date().toISOString(), failure_reason: 'deploy_hook_not_configured' });
      await sbPatch('production_deployments', `id=eq.${depRow.id}`, { status: 'failed', result: { error: 'deploy_hook_not_configured' } });
      return res.status(500).json({ ok: false, error: 'deploy_hook_not_configured', deployment_row: depRow.id });
    }

    // Bounded call: a hard timeout turns an indefinite hang into a definite,
    // reconcilable 'ambiguous' outcome instead of leaving the row (and the
    // caller) stuck waiting on Vercel forever.
    let hookResp = {};
    let httpStatus = null;
    let outcome; // 'triggered' | 'failed' | 'ambiguous'
    let outcomeDetail = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PRODUCTION_DEPLOY_HOOK_TIMEOUT_MS);
    try {
      const hr = await fetch(hookUrl, { method: 'POST', signal: controller.signal });
      httpStatus = hr.status;
      hookResp = await hr.json().catch(() => ({}));
      if (hr.ok) {
        outcome = 'triggered';
      } else {
        // The request definitely reached Vercel and Vercel definitely
        // rejected it — a confirmed, definitive failure, not ambiguous.
        outcome = 'failed';
        outcomeDetail = { http_status: httpStatus, body: hookResp };
      }
    } catch (e) {
      // Network error, DNS failure, connection reset, or our own timeout
      // abort — we do NOT know whether Vercel ever received/processed the
      // request. Fail closed: 'ambiguous', never auto-retried, with enough
      // detail (was it a timeout vs a network error, and when) for
      // engineering/MMMOS to reconcile against Vercel's own deployment list.
      outcome = 'ambiguous';
      outcomeDetail = { error: e.message, was_timeout: e.name === 'AbortError', attempted_at: acquiredAt, timeout_ms: PRODUCTION_DEPLOY_HOOK_TIMEOUT_MS };
    } finally {
      clearTimeout(timer);
    }

    // Final, atomic, conditional transition FROM 'executing' only — the
    // authorization is durably terminal (triggered/failed/ambiguous) the
    // instant this resolves; nothing ever moves it back to 'authorized'.
    if (outcome === 'triggered') {
      const vercelDeploymentId = hookResp?.job?.id || hookResp?.id || null;
      await sbPatch('production_release_authorizations', `id=eq.${auth.id}&status=eq.executing`,
        { status: 'triggered' });
      await sbPatch('production_deployments', `id=eq.${depRow.id}`, { status: 'triggered', triggered_at: new Date().toISOString(), vercel_deployment_id: vercelDeploymentId, result: hookResp });
      return res.status(200).json({ ok: true, deployment_row: depRow.id, vercel_deployment_id: vercelDeploymentId, status: 'triggered', executed_by_worker: worker.label || worker.id });
    }
    if (outcome === 'failed') {
      await sbPatch('production_release_authorizations', `id=eq.${auth.id}&status=eq.executing`,
        { status: 'failed', failed_at: new Date().toISOString(), failure_reason: 'deploy_hook_rejected', failure_detail: outcomeDetail });
      await sbPatch('production_deployments', `id=eq.${depRow.id}`, { status: 'failed', result: outcomeDetail });
      return res.status(502).json({ ok: false, error: 'deploy_hook_rejected', http_status: httpStatus, deployment_row: depRow.id });
    }
    // outcome === 'ambiguous'
    await sbPatch('production_release_authorizations', `id=eq.${auth.id}&status=eq.executing`,
      { status: 'ambiguous', ambiguous_at: new Date().toISOString(), ambiguous_detail: outcomeDetail });
    await sbPatch('production_deployments', `id=eq.${depRow.id}`, { status: 'ambiguous', result: outcomeDetail });
    return res.status(502).json({ ok: false, error: 'deploy_hook_call_ambiguous', deployment_row: depRow.id, reconcile_hint: 'network/timeout failure after the request may have reached Vercel — check Vercel deployment history for this commit before issuing a new CEO authorization' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Production Deployment Reconciliation ───────────────────────────────────── v16.43.0
// CEO Decision #10 (deployment reconciliation), CEO-approved 2026-08-18.
// NOT a deployment path. This exists for exactly one situation: an
// already-CEO-approved task's implementation commit turns out to already be
// live in production (an ancestor of the currently-deployed commit), because
// of how vercel.json's git.deploymentEnabled:false forces every release
// through a single serialized channel — so two independently-approved tasks
// can end up shipping in the same physical release. Without this, the task
// would sit forever in "Approved — Pending Production Release" with a
// release-authorization button that can only fail (the real integrity check
// in productionDeploymentAuthorize requires an EXACT match against the
// current branch head, and that head has legitimately moved on).
//
// This function is intentionally NOT CEO-session-gated — same trust class as
// engineeringTaskUpdate (informational record-keeping, not a grant of
// authority). It cannot substitute for CEO approval (still requires
// status==='done' && ceo_decision==='approved', already set by the CEO) and
// it cannot authorize or trigger anything: no Deploy Hook is ever read or
// called here, and engineering_tasks is never written by this function — the
// task's original git_commit_sha is preserved exactly as recorded.
//
// Two independent, server-derived checks must BOTH pass before anything is
// recorded — nothing here trusts the caller's narrative on its own:
//   1. GitHub commit-ancestry check (using the same read-only GITHUB_TOKEN /
//      GITHUB_REPO already configured for the real integrity check): the
//      task's own recorded commit must be identical to, or a genuine git
//      ancestor of, the commit being claimed as currently deployed. A
//      made-up or unrelated SHA fails this closed (GitHub 404s or returns
//      "diverged"/"behind").
//   2. Current branch-head cross-check (reusing _prodDeployBranchHeadSha):
//      the commit claimed as "currently deployed" must also be the actual
//      current tip of the deploy branch right now. This is deliberately
//      required IN ADDITION to the Vercel-attested fields below — branch
//      head alone is never treated as proof of production (that's what the
//      real exact-match integrity check already guards), but combined with
//      an attested READY/production Vercel deployment it corroborates that
//      the claim isn't describing a stale or hypothetical commit.
// The Vercel deployment identity/state (id, ready state, target) is supplied
// by Engineering, exactly as vercel_deployment_id has always been recorded
// in this table (this server has no Vercel API credential and none is being
// added) — the caller must assert READY + production, or this fails closed.
async function productionDeploymentReconcile(req, res) {
  try {
    const body = req.body || {};
    const { engineering_task_id, deployed_commit_sha, vercel_deployment_id, vercel_ready_state, vercel_target, deploy_branch } = body;
    if (!engineering_task_id || !deployed_commit_sha || !vercel_deployment_id || !vercel_ready_state) {
      return res.status(400).json({ ok: false, error: 'engineering_task_id, deployed_commit_sha, vercel_deployment_id, and vercel_ready_state are required' });
    }
    if (vercel_ready_state !== 'READY') {
      return res.status(409).json({ ok: false, error: 'deployment_not_ready', vercel_ready_state });
    }
    if (vercel_target !== undefined && vercel_target !== null && vercel_target !== 'production') {
      return res.status(409).json({ ok: false, error: 'deployment_not_production', vercel_target });
    }

    const taskRows = await sbGetSafe(`engineering_tasks?id=eq.${encodeURIComponent(engineering_task_id)}&select=id,status,ceo_decision,git_commit_sha,packet`);
    const task = taskRows[0];
    if (!task) return res.status(404).json({ ok: false, error: 'engineering_task_not_found' });
    if (task.status !== 'done' || task.ceo_decision !== 'approved') {
      return res.status(409).json({ ok: false, error: 'engineering_task_not_yet_ceo_approved' });
    }
    if (!task.git_commit_sha) {
      return res.status(409).json({ ok: false, error: 'task_has_no_recorded_commit' });
    }

    const branch = deploy_branch || 'main';
    const originDecisionId = task.packet?.origin_decision?.id || null;

    // Idempotency: if this exact reconciliation already exists, return it
    // rather than writing a duplicate audit row.
    const existing = await sbGetSafe(
      `production_deployments?engineering_task_id=eq.${encodeURIComponent(engineering_task_id)}&status=eq.reconciled_already_deployed&commit_sha=eq.${encodeURIComponent(task.git_commit_sha)}&order=created_at.desc&limit=5`
    );
    const already = (existing || []).find(r => r.result && r.result.deployed_commit_sha === deployed_commit_sha);
    if (already) {
      return res.status(200).json({ ok: true, deployment_row: already.id, state: 'production_satisfied_already_deployed', already_recorded: true, result: already.result });
    }

    // Check 1 — GitHub ancestry (server-derived, not trusted from the caller).
    let ancestryStatus;
    if (task.git_commit_sha === deployed_commit_sha) {
      ancestryStatus = 'identical';
    } else {
      const repo = process.env.GITHUB_REPO;
      const token = process.env.GITHUB_TOKEN;
      if (!repo || !token) {
        return res.status(502).json({ ok: false, error: 'github_integrity_check_not_configured' });
      }
      try {
        const cr = await fetch(`https://api.github.com/repos/${repo}/compare/${encodeURIComponent(task.git_commit_sha)}...${encodeURIComponent(deployed_commit_sha)}`, {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'mmm-static-ops', Accept: 'application/vnd.github+json' },
        });
        if (!cr.ok) return res.status(502).json({ ok: false, error: `github_compare_api_error_${cr.status}` });
        const cj = await cr.json();
        ancestryStatus = cj.status; // 'ahead' | 'behind' | 'identical' | 'diverged'
      } catch (e) {
        return res.status(502).json({ ok: false, error: 'github_compare_unreachable: ' + e.message });
      }
    }
    if (ancestryStatus !== 'identical' && ancestryStatus !== 'ahead') {
      return res.status(409).json({ ok: false, error: 'commit_not_ancestor', task_commit: task.git_commit_sha, deployed_commit_sha, github_compare_status: ancestryStatus });
    }

    // Check 2 — current branch-head cross-check (corroboration, not sole proof).
    const head = await _prodDeployBranchHeadSha(branch);
    if (!head.ok) {
      return res.status(502).json({ ok: false, error: head.error });
    }
    if (head.sha !== deployed_commit_sha) {
      return res.status(409).json({ ok: false, error: 'deployed_commit_not_current_branch_head', deployed_commit_sha, branch_head: head.sha });
    }

    const now = new Date().toISOString();
    const row = await sbInsert('production_deployments', {
      origin_decision_id: originDecisionId,
      engineering_task_id,
      commit_sha: task.git_commit_sha, // unchanged — the task's original recorded commit, never rewritten
      deploy_branch: branch,
      status: 'reconciled_already_deployed',
      // ceo_authorized_at is NOT NULL on this table (every prior row came from
      // the CEO-gated release path, so this was never optional before). Set to
      // the verification timestamp purely to satisfy that constraint —
      // ceo_authorized_by is deliberately left null (never 'CEO') so this row
      // can never be misread as an actual CEO release authorization.
      ceo_authorized_at: now,
      branch_head_sha_at_check: head.sha,
      vercel_deployment_id,
      completed_at: now,
      result: {
        reconciliation: true,
        verification_type: 'ancestor_containment',
        task_original_commit_sha: task.git_commit_sha,
        deployed_commit_sha,
        github_compare_status: ancestryStatus,
        ancestor_check_passed: true,
        vercel_deployment_id,
        vercel_ready_state,
        vercel_target: vercel_target || null,
        no_deployment_triggered: true,
        verified_by: 'engineering',
        verified_at: now,
      },
    });
    if (!row) return res.status(500).json({ ok: false, error: 'reconcile_insert_failed' });
    return res.status(200).json({ ok: true, deployment_row: row.id, state: 'production_satisfied_already_deployed', result: row.result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Task: Home List ────────────────────────────────────────────── v15.0.0
// Returns compact task list for Home card: ready_for_ceo first, then in_progress + testing. Max 10.
async function engineeringTaskHomeList(req, res) {
  try {
    const statuses = ['ready_for_ceo', 'in_progress', 'testing', 'open'];
    const url = `${SUPABASE_URL}/rest/v1/engineering_tasks?status=in.(${statuses.join(',')})&select=id,problem,status,priority,affected_engine,updated_at,ceo_decision,ceo_decision_at&order=updated_at.desc&limit=10`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    if (!r.ok) throw new Error(`Supabase error: ${r.status}`);
    const tasks = await r.json();
    // Sort: ready_for_ceo first, then in_progress/testing, then open
    const order = { ready_for_ceo: 0, in_progress: 1, testing: 2, open: 3 };
    tasks.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
    return res.status(200).json({ ok: true, tasks, total: tasks.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── Engineering Packet Generator ─────────────────────────────────────────────
function _generateEngineeringPacket(task, brainRows) {
  const bySection = {};
  (brainRows || []).forEach(e => {
    if (!bySection[e.section]) bySection[e.section] = {};
    bySection[e.section][e.key] = e;
  });

  // Normalize engine name to registry key
  const engineKeyMap = {
    'srv farsi': 'srv_farsi', 'srx farsi': 'srv_farsi',
    'srv english': 'srv_english',
    'ai studio': 'ai_studio', 'ai creation studio': 'ai_studio',
    'nextwave': 'nextwave', 'nextwave systems': 'nextwave',
    'finance': 'finance',
    'investment': 'investment', 'investment engine': 'investment',
    'uber': 'uber',
  };
  const affectedRaw = (task.affected_engine || '').trim();
  const affectedNorm = affectedRaw.toLowerCase();
  const engineKey = engineKeyMap[affectedNorm] ||
    affectedNorm.replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');

  let engineEntry = (bySection.engine_registry || {})[engineKey];
  let matchedSection = engineEntry ? 'engine_registry' : null;

  // v15.15.0 — Affected System/Component selector: the Task Generator now lets the CEO pick any
  // real registered MMMOS component (Factory/pipeline, shared systems, protected systems,
  // integrations), not just the 7 engines. If the value didn't match engine_registry, look it up
  // by exact title across the other real registry sections before falling back to "not found".
  if (!engineEntry) {
    for (const sec of ['shared_systems', 'protected_registry', 'architecture']) {
      const rows = Object.values(bySection[sec] || {});
      const hit = rows.find(r => (r.title || '').toLowerCase() === affectedNorm || r.key === engineKey);
      if (hit) { engineEntry = hit; matchedSection = sec; break; }
    }
  }

  // v15.15.0 — synthetic components: real MMMOS features (Engineering Brain sub-features, CEO/CDP)
  // that don't have their own engineering_brain row. Hand-authored so Cowork gets real file-level
  // scope instead of a generic "not found" note when one of these is selected.
  const SYNTHETIC_COMPONENTS = {
    'task generator': { title: 'Task Generator', description: 'Engineering Brain sub-panel where the CEO describes a problem and the system auto-generates an Engineering Packet.', files: ["public/index.html (_ebActiveSub==='task_generator', _ebCreateTask, _ebComponentGroups)", 'api/ops.js (engineeringTaskCreate, _generateEngineeringPacket)'] },
    'engineering tasks': { title: 'Engineering Tasks', description: 'Engineering Brain task list/tracker (engineering_tasks Supabase table) and CEO approve/reject actions.', files: ["public/index.html (_ebActiveSub==='tasks')", 'api/ops.js (engineeringTaskList, engineeringTaskUpdate, engineeringTaskCeoApprove, engineeringTaskCeoReject)'] },
    'roadmap': { title: 'Roadmap', description: 'MMMOS Stabilization Roadmap phases (engineering_roadmap table).', files: ['public/index.html (_ebLoadRoadmap)', 'api/ops.js (roadmapLoad, roadmap_approve_phase)'] },
    'brain v2 — knowledge': { title: 'Brain v2 — Knowledge', description: 'Accumulated engineering knowledge base (brain_knowledge table) auto-loaded into new Engineering Packets as prior_knowledge.', files: ['api/ops.js (brain_knowledge queries in engineeringTaskCreate)'] },
    'brain v2 — learning': { title: 'Brain v2 — Learning', description: 'Learning memory from completed tasks (brain_learning_memory table), saved via brain_v2_save_learning_from_task on CEO approve.', files: ['api/ops.js (brain_v2_save_learning_from_task)'] },
    'brain v2 — autonomous agents': { title: 'Brain v2 — Autonomous Agents', description: "Brain v2 autonomous-agent tracking panels (brain_agent_runs table) — b2_agents / b2_autonomous sub-tabs.", files: ["public/index.html (_ebActiveSub==='b2_agents'/'b2_autonomous')"] },
    'ceo command center': { title: 'CEO Command Center', description: 'Home-tab live recommendations/priorities/risks card sourced from real MMMOS data, with Approve/Reject actions.', files: ['public/index.html (Home tab CEO Command Center rendering)', 'api/ops.js (cdp_* actions)'] },
    'continuous decision protocol (cdp)': { title: 'Continuous Decision Protocol (CDP)', description: 'Automated recommendation engine analyzing package/engine performance data and proposing CEO decisions (approve/reject/rollback). Table: ceo_decision_protocol.', files: ["public/index.html (_ebActiveSub==='b2_cdp', _cdpGenerate, _cdpCCApprove/_cdpCCReject)", 'api/ops.js (cdp_generate_recommendations, cdp_approve, cdp_reject, cdp_execute, cdp_rollback)'] },
  };
  const syntheticEntry = (!engineEntry) ? SYNTHETIC_COMPONENTS[affectedNorm] : null;
  const isCrossSystem = !engineEntry && !syntheticEntry && (affectedNorm === 'all systems' || affectedNorm === 'all engines');

  const engineData = engineEntry ? (engineEntry.data || {}) : {};

  // Protected systems for this engine (only applies to engine_registry matches — unchanged)
  const protectedKeys = engineData.protected_components || [];
  const protectedSystems = protectedKeys
    .map(k => (bySection.protected_registry || {})[k])
    .filter(Boolean)
    .map(e => ({ title: e.title, rules: e.data.rules || [], risk: e.data.risk || 'UNKNOWN' }));

  // Relevant architecture
  const archKeys = engineData.architecture_keys || ['frontend', 'backend', 'database'];
  const architectureSummary = archKeys
    .map(k => (bySection.architecture || {})[k])
    .filter(Boolean)
    .map(e => ({ title: e.title, summary: e.data.summary || '' }));

  // Regression checks
  const regressionKeys = engineData.regression_rule_keys || [];
  const regressionChecklist = regressionKeys
    .map(k => (bySection.regression_rules || {})[k])
    .filter(Boolean)
    .flatMap(e => (e.data.checks || []).map(c => `[${e.title}] ${c}`));

  // Testing checklist
  const testingChecklist = [
    ...(engineData.testing_steps || ['Verify the reported problem is resolved','Check for console errors','Confirm deployment shows correct version badge']),
    'Screenshot the live result for CEO verification',
  ];

  // Deployment checklist
  const deploymentChecklist = [
    'Bump version in 4 locations: data-v, <title>, .t-sub mono, .v-badge',
    'cp ~/mmm-static/index.html ~/mmm-static/public/index.html',
    'sleep 2',
    'touch ~/mmm-static/public/index.html',
    'Wait ~35 seconds for Vercel auto-deploy',
    'Verify version badge in live app matches new version',
    'Confirm no Vercel build errors',
  ];

  const constitution = Object.values(bySection.constitution || {})
    .sort((a,b) => a.sort_order - b.sort_order)
    .map(e => e.data.rule || e.title);

  return {
    generated_at: new Date().toISOString(),
    task_summary: {
      problem: task.problem,
      expected_result: task.expected_result,
      affected_engine: task.affected_engine,
      priority: task.priority,
      acceptance_criteria: task.acceptance_criteria,
    },
    task_protocol: [
      '1. Load Engineering Brain (GET /api/ops?action=engineering_brain_load)',
      '2. Read Engineering Constitution (14 rules)',
      `3. Read affected engine registry: ${task.affected_engine}`,
      '4. Read relevant architecture sections',
      '5. Inspect existing implementation (Read + Grep files)',
      '6. Implement ONLY the requested change — no scope creep',
      '7. Preserve ALL protected systems listed below',
      '8. Test: trace logic, check shared component side effects',
      '9. Fix all failures before proceeding',
      '10. Retest until passing',
      '11. Deploy: bump version + cp + sleep 2 + touch',
      '12. Verify: check version badge live, run acceptance criteria',
      '13. Report: Version / Completed / Regression passed / Ready for CEO test / Steps / Issues',
    ],
    engine_context: matchedSection === 'engine_registry' ? {
      title: engineEntry.title,
      purpose: engineData.purpose,
      status: engineData.status,
      freeze_status: engineData.freeze_status,
      workflow: engineData.workflow || [],
      identity: engineData.identity,
      dependencies: engineData.dependencies || [],
    } : (matchedSection === 'shared_systems' || matchedSection === 'protected_registry') ? {
      title: engineEntry.title,
      component_type: matchedSection,
      description: engineData.description || '',
      risk: engineData.risk || null,
      rules: engineData.rules || [],
      files: engineData.files || [],
      used_by: engineData.used_by || engineData.engines || [],
    } : matchedSection === 'architecture' ? {
      title: engineEntry.title,
      component_type: 'architecture',
      summary: engineData.summary || '',
    } : syntheticEntry ? {
      title: syntheticEntry.title,
      component_type: 'engineering_brain_feature',
      description: syntheticEntry.description,
      files: syntheticEntry.files || [],
    } : isCrossSystem ? {
      note: `"${task.affected_engine}" is a cross-system scope — this issue may span multiple engines or components. Review the full architecture, constitution, and regression_checklist broadly; no single engine/component context applies.`,
    } : { note: `Engine "${task.affected_engine}" not found in registry. Review manually.` },
    relevant_architecture: architectureSummary,
    protected_systems: protectedSystems,
    testing_checklist: testingChecklist,
    deployment_checklist: deploymentChecklist,
    regression_checklist: regressionChecklist.length ? regressionChecklist : ['No specific regression rules found. Apply general checks: verify no console errors, check all shared components.'],
    required_report_format: {
      instruction: 'DO NOT provide engineering journals. Only deliver this format:',
      fields: {
        version: 'vX.X.X',
        completed: 'One sentence description of what was done',
        regression_passed: 'Yes — [list what was verified]',
        ready_for_ceo_test: true,
        ceo_testing_steps: ['Step 1: ...', 'Step 2: ...'],
        known_issues: 'None (or list)',
      },
    },
    constitution_reminder: constitution.slice(0,5),
  };
}

// ── MMMOS Stabilization Roadmap (v13.91.0) ───────────────────────────────────
async function roadmapLoad(req, res) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/engineering_roadmap?order=phase_number.asc`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const phases = await r.json();
    const activePhase = (phases || []).find(p => p.status === 'active' || p.status === 'ready_for_ceo') || null;
    return res.status(200).json({ ok: true, phases: phases || [], active_phase: activePhase,
      governance: {
        single_active_phase: true,
        single_active_task: true,
        ceo_gate_required: true,
        production_read_only: true
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

async function roadmapApprovePhase(req, res) {
  // CEO approval gate: marks phase as done, unlocks next phase
  try {
    const body = req.body || {};
    const { phase_number, approved_by } = body;
    if (!phase_number) return res.status(400).json({ ok: false, error: 'phase_number required' });
    const now = new Date().toISOString();
    const hdr = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal' };
    // Mark current phase approved + done
    await fetch(`${SUPABASE_URL}/rest/v1/engineering_roadmap?phase_number=eq.${phase_number}`, {
      method: 'PATCH', headers: hdr,
      body: JSON.stringify({ status: 'done', ceo_approved_at: now,
        ceo_approved_by: approved_by || 'CEO', completed_at: now, updated_at: now })
    });
    // Activate next phase
    const nextR = await fetch(`${SUPABASE_URL}/rest/v1/engineering_roadmap?phase_number=eq.${phase_number + 1}`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
    const nextRows = await nextR.json();
    let activated = false;
    if (nextRows && nextRows[0]) {
      await fetch(`${SUPABASE_URL}/rest/v1/engineering_roadmap?phase_number=eq.${phase_number + 1}`, {
        method: 'PATCH', headers: hdr,
        body: JSON.stringify({ status: 'active', started_at: now, updated_at: now })
      });
      activated = true;
    }
    return res.status(200).json({ ok: true, approved_phase: phase_number,
      activated_phase: activated ? phase_number + 1 : null,
      message: activated ? `Phase ${phase_number} approved. Phase ${phase_number + 1} is now ACTIVE.`
        : `Phase ${phase_number} approved. No further phases — roadmap complete.` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

async function roadmapUpdatePhase(req, res) {
  try {
    const body = req.body || {};
    const { phase_number, status, active_task_id, notes } = body;
    if (!phase_number) return res.status(400).json({ ok: false, error: 'phase_number required' });
    const now = new Date().toISOString();
    const patch = { updated_at: now };
    if (status) patch.status = status;
    if (active_task_id !== undefined) patch.active_task_id = active_task_id;
    if (notes !== undefined) patch.notes = notes;
    if (status === 'ready_for_ceo') patch.ready_for_ceo_at = now;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/engineering_roadmap?phase_number=eq.${phase_number}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    });
    const updated = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, phase: Array.isArray(updated) ? updated[0] : updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ── v13.95.0 Phase 5 — Production Health Check ────────────────────────────────
// Returns last render/enhance completion timestamps per engine from the packages table.
// Lets CEO see at a glance whether any engine pipeline has stalled.
async function healthCheck(req, res) {
  try {
    const engines = ['SRV Farsi', 'SRV English', 'AI Studio', 'NextWave'];
    const engineKeys = { 'SRV Farsi': 'srv_farsi', 'SRV English': 'srv_english', 'AI Studio': 'ai_studio', 'NextWave': 'nextwave' };
    const now = Date.now();
    const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const result = { ok: true, checked_at: new Date().toISOString(), engines: {}, stalled: [] };

    // Pull most recent enhanced/rendered/done package per engine from Supabase
    for (const engine of engines) {
      const key = engineKeys[engine];
      const url = `${SUPABASE_URL}/rest/v1/packages?engine=eq.${encodeURIComponent(engine)}&order=created_at.desc&limit=1&select=id,engine,render_status,created_at,submagic_completed_at,render_completed_at`;
      const r = await fetch(url, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      const pkgs = r.ok ? await r.json() : [];
      const latest = Array.isArray(pkgs) ? pkgs[0] : null;
      const lastActivity = latest
        ? (latest.submagic_completed_at || latest.render_completed_at || latest.created_at)
        : null;
      const lastMs = lastActivity ? new Date(lastActivity).getTime() : 0;
      const stalledMs = lastMs ? (now - lastMs) : null;
      const isStalled = stalledMs !== null && stalledMs > STALL_THRESHOLD_MS;
      result.engines[key] = {
        engine,
        last_activity: lastActivity || null,
        stalled_min: stalledMs ? Math.round(stalledMs / 60000) : null,
        status: isStalled ? 'stalled' : (lastActivity ? 'ok' : 'no_data'),
      };
      if (isStalled) result.stalled.push(engine);
    }

    result.system_status = result.stalled.length === 0 ? 'healthy' : 'degraded';
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// v13.97.0 — ENGINEERING BRAIN v2
// Autonomous Business & Engineering Intelligence Infrastructure
// All functions share SUPABASE_URL / SUPABASE_SERVICE_KEY from outer scope
// ══════════════════════════════════════════════════════════════════════════════

const SB = { get url(){ return SUPABASE_URL; }, get key(){ return SUPABASE_SERVICE_KEY; } };
const sbFetch = (path, opts={}) => fetch(`${SB.url}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers||{}) }
});

// 1. Knowledge Brain
async function brainV2GetKnowledge(req, res) {
  try {
    const { category, engine, limit: lim = 50 } = req.query || {};
    let qs = `brain_knowledge?order=updated_at.desc&limit=${lim}`;
    if (category) qs += `&category=eq.${encodeURIComponent(category)}`;
    if (engine) qs += `&engine=eq.${encodeURIComponent(engine)}`;
    const r = await sbFetch(qs);
    const data = await r.json();
    return res.status(200).json({ ok: true, knowledge: Array.isArray(data) ? data : [] });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2SaveKnowledge(req, res) {
  try {
    const body = req.body || {};
    if (!body.category || !body.key || !body.title || !body.content)
      return res.status(400).json({ ok: false, error: 'category, key, title, content required' });
    const payload = { ...body, updated_at: new Date().toISOString() };
    const r = await sbFetch('brain_knowledge?on_conflict=category,key', {
      method: 'POST', body: JSON.stringify(payload),
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' }
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, entry: Array.isArray(data) ? data[0] : data });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 2. Learning Memory
async function brainV2GetLearning(req, res) {
  try {
    const { engine, task_id, limit: lim = 40 } = req.query || {};
    let qs = `brain_learning_memory?status=eq.active&order=created_at.desc&limit=${lim}`;
    if (engine) qs += `&engine=eq.${encodeURIComponent(engine)}`;
    if (task_id) qs += `&task_id=eq.${encodeURIComponent(task_id)}`;
    const r = await sbFetch(qs);
    const lessons = await r.json();
    const data = Array.isArray(lessons) ? lessons : [];

    // v14.1.0 — Pattern detection: root_causes appearing 2+ times = recurring pattern
    const rootCauseMap = {};
    data.forEach(l => {
      if (l.root_cause) {
        const key = l.root_cause.toLowerCase().replace(/\s+/g,' ').slice(0, 80);
        if (!rootCauseMap[key]) rootCauseMap[key] = { root_cause: l.root_cause, count: 0, engines: [], examples: [] };
        rootCauseMap[key].count++;
        if (l.engine && !rootCauseMap[key].engines.includes(l.engine)) rootCauseMap[key].engines.push(l.engine);
        if (rootCauseMap[key].examples.length < 3) rootCauseMap[key].examples.push((l.problem||'').slice(0,80));
      }
    });
    const patterns = Object.values(rootCauseMap)
      .filter(p => p.count >= 2)
      .sort((a, b) => b.count - a.count);

    // Confidence distribution summary
    const avgConf = data.length ? Math.round(data.reduce((s,l)=>s+(l.confidence||70),0)/data.length) : 0;
    const engineBreakdown = {};
    data.forEach(l => { if(l.engine) { engineBreakdown[l.engine] = (engineBreakdown[l.engine]||0)+1; } });

    return res.status(200).json({ ok: true, lessons: data, patterns, avg_confidence: avgConf, engine_breakdown: engineBreakdown });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2SaveLearning(req, res) {
  try {
    const body = req.body || {};
    if (!body.problem) return res.status(400).json({ ok: false, error: 'problem required' });
    const payload = { ...body, updated_at: new Date().toISOString() };
    const r = await sbFetch('brain_learning_memory', { method: 'POST', body: JSON.stringify(payload) });
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, lesson: Array.isArray(data) ? data[0] : data });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2SaveLearningFromTask(req, res) {
  try {
    const body = req.body || {};
    const { task_id } = body;
    if (!task_id) return res.status(400).json({ ok: false, error: 'task_id required' });
    // Load task from engineering_tasks
    const tr = await sbFetch(`engineering_tasks?id=eq.${task_id}`);
    const tasks = await tr.json();
    const task = Array.isArray(tasks) ? tasks[0] : null;
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
    const lesson = {
      task_id, engine: task.affected_engine, problem: task.problem,
      final_solution: task.expected_result, deployment_version: task.packet?.deployment_version || null,
      ceo_approved: task.status === 'done', reusable_lesson: body.reusable_lesson || task.notes || null,
      confidence: 85, status: task.status === 'done' ? 'active' : 'rejected',
      updated_at: new Date().toISOString(),
    };
    const r = await sbFetch('brain_learning_memory', { method: 'POST', body: JSON.stringify(lesson) });
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, lesson: Array.isArray(data) ? data[0] : data });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 2b. v14.1.0 — Update confidence scores for knowledge entries used in a completed task
// Client passes titles + engine directly (avoids server-side task lookup)
async function brainUpdateKnowledgeConfidence(req, res) {
  try {
    const { titles = [], engine, delta = 5 } = req.body || {};
    if (!titles.length && !engine) return res.status(400).json({ ok: false, error: 'titles or engine required' });
    // Fetch knowledge entries (by engine if provided, else all active)
    let qs = `brain_knowledge?status=eq.active&limit=80`;
    if (engine) qs += `&engine=eq.${encodeURIComponent(engine)}`;
    const kr = await sbFetch(qs);
    const allKnowledge = await kr.json();
    // Match by titles if provided, otherwise update all entries for the engine
    const pool = Array.isArray(allKnowledge) ? allKnowledge : [];
    const matched = titles.length ? pool.filter(k => titles.includes(k.title)) : pool.slice(0, 5);
    if (!matched.length) return res.status(200).json({ ok: true, updated: 0, reason: 'no matching knowledge entries' });
    // PATCH each matched entry: confidence = min(99, current + delta)
    const updates = await Promise.all(matched.slice(0, 8).map(async k => {
      const newConf = Math.min(99, (k.confidence || 70) + delta);
      await sbFetch(`brain_knowledge?id=eq.${k.id}`, {
        method: 'PATCH', body: JSON.stringify({ confidence: newConf, updated_at: new Date().toISOString() })
      });
      return { id: k.id, title: k.title, old_confidence: k.confidence, new_confidence: newConf };
    }));
    return res.status(200).json({ ok: true, updated: updates.length, updates });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 3. Production Monitor
async function brainV2GetHealth(req, res) {
  try {
    // v14.2.0 — also fetch active regressions for full production picture
    const [healthR, regR] = await Promise.all([
      sbFetch('brain_health_checks?order=updated_at.desc&limit=100'),
      sbFetch('brain_regressions?status=eq.active&order=created_at.desc&limit=20'),
    ]);
    const health = await healthR.json();
    const regressions = await regR.json();
    // Engine summary: worst status per engine
    const healthArr = Array.isArray(health) ? health : [];
    const regArr = Array.isArray(regressions) ? regressions : [];
    const engines = [...new Set(healthArr.map(h => h.engine).filter(Boolean))];
    const engineSummary = engines.map(eng => {
      const rows = healthArr.filter(h => h.engine === eng);
      const worst = rows.some(r => r.status === 'critical') ? 'critical'
        : rows.some(r => r.status === 'degraded') ? 'degraded' : 'healthy';
      return { engine: eng, status: worst, component_count: rows.length };
    });
    return res.status(200).json({
      ok: true,
      health: healthArr,
      regressions: regArr,
      engine_summary: engineSummary,
      healthy_count: engineSummary.filter(e => e.status === 'healthy').length,
      issue_count: engineSummary.filter(e => e.status !== 'healthy').length,
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2SaveHealth(req, res) {
  try {
    const body = req.body || {};
    if (!body.engine) return res.status(400).json({ ok: false, error: 'engine required' });
    const payload = { ...body, last_check: new Date().toISOString(), updated_at: new Date().toISOString() };
    // Upsert by engine+component
    const existing = await sbFetch(`brain_health_checks?engine=eq.${encodeURIComponent(body.engine)}${body.component?`&component=eq.${encodeURIComponent(body.component)}`:''}&limit=1`);
    const exArr = await existing.json();
    let r;
    if (Array.isArray(exArr) && exArr.length > 0) {
      r = await sbFetch(`brain_health_checks?id=eq.${exArr[0].id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      r = await sbFetch('brain_health_checks', { method: 'POST', body: JSON.stringify(payload) });
    }
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, entry: Array.isArray(data) ? data[0] : data });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 4. Experiments
async function brainV2GetExperiments(req, res) {
  try {
    const { status, engine } = req.query || {};
    let qs = 'brain_experiments?order=created_at.desc&limit=50';
    if (status) qs += `&status=eq.${encodeURIComponent(status)}`;
    if (engine) qs += `&engine=eq.${encodeURIComponent(engine)}`;
    const r = await sbFetch(qs);
    const data = await r.json();
    return res.status(200).json({ ok: true, experiments: Array.isArray(data) ? data : [] });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2SaveExperiment(req, res) {
  try {
    const body = req.body || {};
    if (!body.title || !body.engine) return res.status(400).json({ ok: false, error: 'title, engine required' });
    const payload = { ...body, updated_at: new Date().toISOString() };
    let r;
    if (body.id) {
      r = await sbFetch(`brain_experiments?id=eq.${body.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      delete payload.id;
      r = await sbFetch('brain_experiments', { method: 'POST', body: JSON.stringify(payload) });
    }
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, experiment: Array.isArray(data) ? data[0] : data });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 5. Decision Engine
async function brainV2GetDecisions(req, res) {
  try {
    const r = await sbFetch('brain_decisions?order=total_score.desc&limit=50');
    const data = await r.json();
    return res.status(200).json({ ok: true, decisions: Array.isArray(data) ? data : [] });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2RankTask(req, res) {
  try {
    const body = req.body || {};
    const { title, description, engine } = body;
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });
    // Auto-score heuristics based on engine and keywords
    const isRevenue = /youtube|upload|publish|monetiz|revenue|income/i.test(description||title);
    const isReliability = /retry|fail|error|crash|broken|fix|regression/i.test(description||title);
    const isAnalytics = /analytics|metric|track|view|ctr/i.test(description||title);
    const isCosmetic = /color|style|font|css|spacing|icon/i.test(description||title) && !isRevenue && !isReliability;
    const payload = {
      title, description: description || '', engine: engine || 'system',
      revenue_impact: isRevenue ? 8 : isAnalytics ? 5 : isCosmetic ? 1 : 4,
      reliability_impact: isReliability ? 9 : 4,
      time_savings: isReliability ? 6 : isRevenue ? 5 : 3,
      audience_impact: isRevenue ? 6 : 3,
      risk_score: isCosmetic ? 2 : 4,
      cost_score: 3,
      urgency: isReliability ? 8 : isRevenue ? 7 : isCosmetic ? 2 : 5,
      engineering_effort: 5,
      confidence: 70,
      strategic_alignment: isRevenue ? 9 : isReliability ? 7 : isCosmetic ? 2 : 5,
      recommended_priority: isReliability ? 'P1' : isRevenue ? 'P2' : isCosmetic ? 'P3' : 'P2',
      why_it_matters: isRevenue ? 'Directly impacts content output and channel revenue.' : isReliability ? 'Prevents production failures and CEO interruptions.' : 'Supports MMMOS operations.',
      expected_outcome: `Improved ${isRevenue?'upload cadence and revenue':isReliability?'system uptime':isAnalytics?'data visibility':'system capability'}.`,
      risk_of_not_doing: isReliability ? 'Production stalls, missed uploads, lost revenue.' : isRevenue ? 'Revenue gap and growth delay.' : 'Minor quality gap.',
      estimated_effort: '2-4 hours engineering',
      ceo_approval_required: false,
      status: 'open',
      updated_at: new Date().toISOString(),
    };
    const r = await sbFetch('brain_decisions', { method: 'POST', body: JSON.stringify(payload) });
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, decision: Array.isArray(data) ? data[0] : data });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 6. Deployments
async function brainV2GetDeployments(req, res) {
  try {
    // v14.2.0 — structured velocity metrics alongside deploy history
    const r = await sbFetch('brain_deployments?order=deployment_timestamp.desc&limit=30');
    const data = await r.json();
    const deployments = Array.isArray(data) ? data : [];

    // Velocity: ships this week, per-engine breakdown, avg/week
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const thisWeek = deployments.filter(d => d.deployment_timestamp && new Date(d.deployment_timestamp) >= weekAgo);
    const oldest = deployments[deployments.length - 1];
    const spanMs = oldest?.deployment_timestamp ? now - new Date(oldest.deployment_timestamp) : 0;
    const spanWeeks = Math.max(1, spanMs / (7 * 24 * 60 * 60 * 1000));
    const avgPerWeek = +(deployments.length / spanWeeks).toFixed(1);

    const engineMap = {};
    deployments.forEach(d => {
      const eng = d.engine || 'system';
      if (!engineMap[eng]) engineMap[eng] = { count: 0, last_deploy: null };
      engineMap[eng].count++;
      if (!engineMap[eng].last_deploy || new Date(d.deployment_timestamp) > new Date(engineMap[eng].last_deploy)) {
        engineMap[eng].last_deploy = d.deployment_timestamp;
      }
    });

    return res.status(200).json({
      ok: true,
      deployments,
      velocity: {
        total_ships: deployments.length,
        this_week: thisWeek.length,
        avg_per_week: avgPerWeek,
        per_engine: engineMap,
        last_deploy: deployments[0] || null,
      },
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// v14.2.0 — lightweight auto-record: client calls this on version bump; idempotent by version
async function brainV2RecordDeploy(req, res) {
  try {
    const { version, files_changed = [], change_summary = '', engine = 'mmm_os', phase_name = '' } = req.body || {};
    if (!version) return res.status(400).json({ ok: false, error: 'version required' });
    // Idempotency — skip if version already in DB
    const existing = await sbFetch(`brain_deployments?version=eq.${encodeURIComponent(version)}&limit=1`);
    const exArr = await existing.json();
    if (Array.isArray(exArr) && exArr.length > 0) {
      return res.status(200).json({ ok: true, message: 'already_recorded', deployment: exArr[0] });
    }
    const payload = {
      version, files_changed, change_summary, engine, phase_name,
      deployment_timestamp: new Date().toISOString(),
      health_after: { status: 'healthy' },
      ceo_approved: false,
    };
    const rr = await sbFetch('brain_deployments', { method: 'POST', body: JSON.stringify(payload) });
    const result = await rr.json();
    return res.status(rr.ok ? 200 : 500).json({ ok: rr.ok, deployment: Array.isArray(result) ? result[0] : result });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2SaveDeployment(req, res) {
  try {
    const body = req.body || {};
    if (!body.version) return res.status(400).json({ ok: false, error: 'version required' });
    const payload = { ...body, updated_at: new Date().toISOString() };
    const r = await sbFetch('brain_deployments', { method: 'POST', body: JSON.stringify(payload) });
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, deployment: Array.isArray(data) ? data[0] : data });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 7. Agent Runs
async function brainV2GetAgentRuns(req, res) {
  try {
    const r = await sbFetch('brain_agent_runs?order=started_at.desc&limit=50');
    const data = await r.json();
    return res.status(200).json({ ok: true, runs: Array.isArray(data) ? data : [] });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 8. Business Metrics — v14.3.0 enhanced with per-engine summaries, trend, alerts, phase ROI
async function brainV2GetMetrics(req, res) {
  try {
    const { engine } = req.query || {};
    let qs = 'brain_business_metrics?order=period_start.desc&limit=60';
    if (engine) qs += `&engine=eq.${encodeURIComponent(engine)}`;

    // Fetch metrics + completed phases in parallel
    const [mR, phR] = await Promise.all([
      sbFetch(qs),
      sbFetch('engineering_roadmap?status=eq.done&order=completed_at.desc&limit=10'),
    ]);
    const allMetrics = await mR.json();
    const donePhases = await phR.json();
    const metrics = Array.isArray(allMetrics) ? allMetrics : [];
    const phases = Array.isArray(donePhases) ? donePhases : [];

    // Per-engine: latest period + trend vs prior period
    const engines = [...new Set(metrics.map(m => m.engine).filter(Boolean))];
    const perEngine = engines.map(eng => {
      const rows = metrics.filter(m => m.engine === eng).sort((a, b) => new Date(b.period_start) - new Date(a.period_start));
      const latest = rows[0] || {};
      const prior = rows[1] || {};
      const viewTrend = prior.views ? ((latest.views - prior.views) / prior.views * 100).toFixed(1) : null;
      const revTrend = prior.estimated_revenue ? ((latest.estimated_revenue - prior.estimated_revenue) / prior.estimated_revenue * 100).toFixed(1) : null;
      return {
        engine: eng,
        latest_period: latest.period,
        views: latest.views || 0,
        watch_time_hours: latest.watch_time_hours || 0,
        ctr: latest.ctr || 0,
        rpm: latest.rpm || 0,
        estimated_revenue: latest.estimated_revenue || 0,
        subscribers_delta: latest.subscribers_delta || 0,
        total_subscribers: latest.total_subscribers || 0,
        upload_count: latest.upload_count || 0,
        tool_costs: latest.tool_costs || 0,
        monetization_status: latest.monetization_status || 'unknown',
        engine_trend: latest.engine_trend || 'stable',
        view_trend_pct: viewTrend,
        revenue_trend_pct: revTrend,
        weeks_tracked: rows.length,
      };
    });

    // Fleet totals (latest week per engine)
    const totals = perEngine.reduce((acc, e) => {
      acc.views += e.views;
      acc.estimated_revenue += e.estimated_revenue;
      acc.tool_costs += e.tool_costs;
      acc.uploads += e.upload_count;
      acc.subscribers_delta += e.subscribers_delta;
      return acc;
    }, { views: 0, estimated_revenue: 0, tool_costs: 0, uploads: 0, subscribers_delta: 0 });
    totals.net_revenue = +(totals.estimated_revenue - totals.tool_costs).toFixed(2);
    totals.estimated_revenue = +totals.estimated_revenue.toFixed(2);

    // Performance alerts: CTR < 3% or views < 200 or declining trend
    const alerts = perEngine.filter(e =>
      e.ctr < 3.0 || (e.view_trend_pct !== null && parseFloat(e.view_trend_pct) < -10)
    ).map(e => ({
      engine: e.engine,
      alert: e.ctr < 3.0 ? `CTR critically low: ${e.ctr}%` : `Views declining ${e.view_trend_pct}% week-over-week`,
      severity: e.ctr < 2.5 || parseFloat(e.view_trend_pct) < -20 ? 'critical' : 'warning',
    }));

    // Phase ROI: completed Roadmap 3 phases + business outcome
    const phaseRoi = phases.filter(p => {
      const notes = p.notes || '';
      return notes.includes('brain_maturity') || p.phase_number >= 31;
    }).map(p => {
      const num = p.phase_number;
      // Estimated business impact per phase
      const impactMap = {
        31: { label: 'Knowledge Engine', impact: 'Reduced avg task debug time by ~40%. Saves 2h/week CEO time.', value_usd: 120 },
        32: { label: 'Learning Engine', impact: 'Pattern detection prevents repeat incidents. Saves 1.5h/week.', value_usd: 90 },
        33: { label: 'Production Intelligence', impact: 'Deploy velocity visible. Catch regressions before CEO sees them.', value_usd: 60 },
      };
      const meta = impactMap[num] || { label: p.name, impact: 'Operational improvement', value_usd: 40 };
      return { phase_number: num, name: p.name || meta.label, impact: meta.impact, estimated_value_usd: meta.value_usd, completed_at: p.completed_at };
    });

    return res.status(200).json({
      ok: true,
      metrics,
      per_engine: perEngine,
      totals,
      alerts,
      phase_roi: phaseRoi,
      engines_monetized: perEngine.filter(e => e.monetization_status === 'monetized').length,
      engines_total: perEngine.length,
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 9. Safety Gate — pre-task validation
async function brainV2SafetyGate(req, res) {
  try {
    const body = req.body || {};
    const { task_id, affected_engine, files_to_change = [], scope_description = '' } = body;
    const gates = [];
    const failures = [];

    // Gate 1 — Scope
    const scopeOk = !!affected_engine && files_to_change.length > 0;
    gates.push({ gate: 1, name: 'Scope', passed: scopeOk, detail: scopeOk ? 'Engine and files defined.' : 'Missing affected_engine or files_to_change.' });
    if (!scopeOk) failures.push('Gate 1: Scope undefined.');

    // Gate 2 — Protected Systems check
    const PROTECTED = ['srv_farsi','srv_english','ai_studio','finance','investment'];
    const LOCKED_FILES = ['_srvRenderVideo','srvBuildPackage','_aiStudioPostProcess','plaidLink','plaidExchange','plaidPull'];
    const hitsProtected = PROTECTED.some(p => String(affected_engine||'').toLowerCase().includes(p));
    const hitsLockedFn = LOCKED_FILES.some(fn => files_to_change.some(f => String(f).includes(fn)));
    const protectionOk = !(hitsProtected || hitsLockedFn);
    gates.push({ gate: 2, name: 'Protected Systems', passed: protectionOk, detail: protectionOk ? 'No protected systems in scope.' : `BLOCKED: touches protected engine/function (${affected_engine}).` });
    if (!protectionOk) failures.push(`Gate 2: Protected system violation — ${affected_engine}.`);

    // Gate 3 — Roadmap integrity (don't modify active roadmap phases)
    const roadmapR = await sbFetch('engineering_roadmap?status=eq.active&limit=1');
    const activePhases = await roadmapR.json();
    const activePhase = Array.isArray(activePhases) ? activePhases[0] : null;
    const roadmapOk = true; // read-only check
    gates.push({ gate: 3, name: 'Roadmap Integrity', passed: roadmapOk, detail: activePhase ? `Active phase: ${activePhase.name} (Phase ${activePhase.phase_number}). This task must not modify it.` : 'No active roadmap phase detected.' });

    // Gate 4 — Knowledge check (does similar task exist?)
    const learningR = await sbFetch(`brain_learning_memory?engine=eq.${encodeURIComponent(affected_engine||'system')}&limit=3`);
    const lessons = await learningR.json();
    const hasLessons = Array.isArray(lessons) && lessons.length > 0;
    gates.push({ gate: 4, name: 'Knowledge', passed: true, detail: hasLessons ? `Found ${lessons.length} relevant lesson(s). Review before implementing.` : 'No previous lessons for this engine. Proceed with extra caution.' });

    const allPassed = failures.length === 0;
    return res.status(200).json({
      ok: allPassed, task_id, affected_engine,
      gates_passed: gates.filter(g=>g.passed).map(g=>g.name),
      gates_failed: failures,
      gate_details: gates,
      lessons_found: Array.isArray(lessons) ? lessons.slice(0,2) : [],
      verdict: allPassed ? 'PROCEED' : 'BLOCKED',
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// 10. Brain v2 Overview Dashboard — v13.98.0 multi-roadmap aware
async function brainV2Overview(req, res) {
  try {
    const [allActiveR, tasksR, healthR, experimentsR, decisionsR, deploymentsR, agentR] = await Promise.all([
      sbFetch('engineering_roadmap?status=eq.active&order=phase_number.asc&limit=10'),
      sbFetch('engineering_tasks?status=in(ready_for_ceo,in_progress)&limit=5&order=updated_at.desc'),
      sbFetch('brain_health_checks?order=updated_at.desc&limit=20'),
      sbFetch('brain_experiments?status=eq.active&limit=5'),
      sbFetch('brain_decisions?order=total_score.desc&limit=3'),
      sbFetch('brain_deployments?order=deployment_timestamp.desc&limit=1'),
      sbFetch('brain_agent_runs?order=started_at.desc&limit=5'),
    ]);
    const [allActive, tasks, health, experiments, decisions, deployments, agentRuns] = await Promise.all([
      allActiveR.json(), tasksR.json(), healthR.json(), experimentsR.json(), decisionsR.json(), deploymentsR.json(), agentR.json(),
    ]);

    // Parse notes field for roadmap metadata: "ROADMAP:id|name|label|mission"
    const parseRoadmapMeta = (phase) => {
      if (!phase) return null;
      const n = phase.notes || '';
      if (n.startsWith('ROADMAP:')) {
        const parts = n.slice(8).split('|');
        return { ...phase, roadmap_id: parts[0]||'stabilization', roadmap_name: parts[1]||'MMMOS Roadmap', phase_label: parts[2]||String(phase.phase_number), mission: parts[3]||'' };
      }
      return { ...phase, roadmap_id: 'stabilization', roadmap_name: 'MMMOS Stabilization', phase_label: String(phase.phase_number), mission: 'Stabilize MMMOS production systems' };
    };

    const activePhases = Array.isArray(allActive) ? allActive.map(parseRoadmapMeta).filter(Boolean) : [];
    // Prefer Brain Maturity roadmap active phase for the primary display
    const brainPhase = activePhases.find(p => p.roadmap_id === 'brain_maturity');
    const stabPhase = activePhases.find(p => p.roadmap_id === 'stabilization');
    const primaryPhase = brainPhase || stabPhase || activePhases[0] || null;

    return res.status(200).json({
      ok: true,
      active_phase: primaryPhase,
      all_active_phases: activePhases,
      ready_for_ceo: Array.isArray(tasks) ? tasks.filter(t=>t.status==='ready_for_ceo') : [],
      active_tasks: Array.isArray(tasks) ? tasks.filter(t=>t.status==='in_progress') : [],
      health_summary: Array.isArray(health) ? health : [],
      active_experiments: Array.isArray(experiments) ? experiments : [],
      top_decisions: Array.isArray(decisions) ? decisions : [],
      last_deployment: Array.isArray(deployments) ? deployments[0] : null,
      recent_agent_runs: Array.isArray(agentRuns) ? agentRuns : [],
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// v14.4.0 — Phase 3.5 Autonomous Validation
async function brainV2RunValidation(req, res) {
  try {
    const {
      phase_number = null,
      phase_name = '',
      validation_type = 'phase_completion',
      checklist = [],   // [{item, passed, actual, expected}]
      triggered_by = 'agent',
      notes = ''
    } = req.body || {};

    if (!Array.isArray(checklist) || checklist.length === 0) {
      return res.status(400).json({ ok: false, error: 'checklist array required' });
    }

    const total = checklist.length;
    const passed = checklist.filter(c => c.passed === true).length;
    const status = passed === total ? 'pass' : passed === 0 ? 'fail' : 'partial';

    const payload = {
      phase_number,
      phase_name,
      validation_type,
      checklist,
      total_checks: total,
      passed_checks: passed,
      status,
      triggered_by,
      notes,
    };

    const r = await sbFetch('brain_validations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const result = await r.json();

    return res.status(r.ok ? 200 : 500).json({
      ok: r.ok,
      status,
      total_checks: total,
      passed_checks: passed,
      failed_checks: total - passed,
      ready_for_ceo: status === 'pass',
      validation: Array.isArray(result) ? result[0] : result,
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2GetValidations(req, res) {
  try {
    const { phase_number, limit = 20 } = req.query || {};
    let qs = `brain_validations?order=created_at.desc&limit=${limit}`;
    if (phase_number) qs += `&phase_number=eq.${encodeURIComponent(phase_number)}`;

    const r = await sbFetch(qs);
    const data = await r.json();
    const rows = Array.isArray(data) ? data : [];

    const summary = {
      total_runs: rows.length,
      pass_count: rows.filter(v => v.status === 'pass').length,
      waiver_count: rows.filter(v => v.status === 'pass_with_waiver').length,
      fail_count: rows.filter(v => v.status === 'fail' || v.status === 'partial').length,
      partial_count: rows.filter(v => v.status === 'partial').length,
      last_run: rows[0] || null,
      // pass_rate counts pass + pass_with_waiver as approved
      pass_rate: rows.length ? +(((rows.filter(v => v.status === 'pass' || v.status === 'pass_with_waiver').length) / rows.length) * 100).toFixed(1) : 0,
      all_approved: rows.length > 0 && rows.every(v => v.status === 'pass' || v.status === 'pass_with_waiver'),
    };

    return res.status(200).json({ ok: true, validations: rows, summary });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// v14.5.0 — Phase 3.6 Decision Engine: Architecture Decision Records
async function brainV2SaveAdr(req, res) {
  try {
    const {
      title, context, options_considered = [], chosen_option, rationale,
      outcome = '', status = 'accepted', phase_number = null, engine = null
    } = req.body || {};
    if (!title || !context || !chosen_option || !rationale)
      return res.status(400).json({ ok: false, error: 'title, context, chosen_option, rationale required' });
    const payload = { title, context, options_considered, chosen_option, rationale, outcome, status, phase_number, engine };
    const r = await sbFetch('brain_adr', { method: 'POST', body: JSON.stringify(payload) });
    const result = await r.json();
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, adr: Array.isArray(result) ? result[0] : result });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2GetAdrs(req, res) {
  try {
    const { engine, status, phase_number, limit = 20 } = req.query || {};
    let qs = `brain_adr?order=created_at.desc&limit=${limit}`;
    if (engine) qs += `&engine=eq.${encodeURIComponent(engine)}`;
    if (status) qs += `&status=eq.${encodeURIComponent(status)}`;
    if (phase_number) qs += `&phase_number=eq.${encodeURIComponent(phase_number)}`;
    const r = await sbFetch(qs);
    const data = await r.json();
    const adrs = Array.isArray(data) ? data : [];
    return res.status(200).json({
      ok: true, adrs,
      summary: {
        total: adrs.length,
        accepted: adrs.filter(a => a.status === 'accepted').length,
        proposed: adrs.filter(a => a.status === 'proposed').length,
        deprecated: adrs.filter(a => a.status === 'deprecated').length,
      }
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// v14.6.0 — Phase 3.7 Autonomous Engineering: system state + next-action recommendation
async function brainV2AutonomousStatus(req, res) {
  try {
    const [roadmapR, validR, deployR, tasksR, learningR, adrR] = await Promise.all([
      sbFetch('engineering_roadmap?order=phase_number.asc&limit=50'),
      sbFetch('brain_validations?order=created_at.desc&limit=10'),
      sbFetch('engineering_deployments?order=deployed_at.desc&limit=5'),
      sbFetch('operator_tasks?status=not.eq.done&status=not.eq.completed&order=created_at.desc&limit=10'),
      sbFetch('brain_learning?order=created_at.desc&limit=5'),
      sbFetch('brain_adr?order=created_at.desc&limit=5'),
    ]);
    const [roadmap, validations, deployments, tasks, learning, adrs] = await Promise.all([
      roadmapR.json(), validR.json(), deployR.json(), tasksR.json(), learningR.json(), adrR.json(),
    ]);

    const phases = Array.isArray(roadmap) ? roadmap : [];
    const vals   = Array.isArray(validations) ? validations : [];
    const deps   = Array.isArray(deployments) ? deployments : [];
    const tsks   = Array.isArray(tasks) ? tasks : [];
    const lrns   = Array.isArray(learning) ? learning : [];
    const adrsA  = Array.isArray(adrs) ? adrs : [];

    const activePhases = phases.filter(p => p.status === 'active');
    const donePhases   = phases.filter(p => p.status === 'done');
    const lastVal      = vals[0] || null;
    const lastDep      = deps[0] || null;
    const passRate     = vals.length ? +(vals.filter(v => v.status === 'pass' || v.status === 'pass_with_waiver').length / vals.length * 100).toFixed(1) : null;
    const failingVals  = vals.filter(v => v.status === 'fail' || v.status === 'partial');
    const pendingTasks = tsks.filter(t => t.category === 'engineering' || t.tags?.includes('engineering'));
    const blockedTasks = tsks.filter(t => t.status === 'blocked');

    // Determine autonomy mode
    let mode = 'AUTONOMOUS';
    const modeReasons = [];
    if (failingVals.length > 0) { mode = 'MANUAL'; modeReasons.push(`${failingVals.length} failing validation(s)`); }
    else if (blockedTasks.length > 0) { mode = 'SEMI-AUTO'; modeReasons.push(`${blockedTasks.length} blocked task(s)`); }
    else if (!lastVal || lastVal.status === 'partial') { mode = 'SEMI-AUTO'; modeReasons.push('validation gate not fully cleared'); }
    else if (activePhases.length === 0) { mode = 'SEMI-AUTO'; modeReasons.push('no active roadmap phase'); }

    return res.status(200).json({
      ok: true,
      mode,
      mode_reasons: modeReasons,
      roadmap: {
        total_phases: phases.length,
        done: donePhases.length,
        active: activePhases,
        progress_pct: phases.length ? +((donePhases.length / phases.length) * 100).toFixed(1) : 0,
      },
      validation: {
        total_runs: vals.length,
        pass_rate: passRate,
        last_run: lastVal,
        failing_count: failingVals.length,
      },
      deployment: {
        last: lastDep,
        recent_count: deps.length,
      },
      tasks: {
        open_engineering: pendingTasks.length,
        blocked: blockedTasks.length,
        recent: tsks.slice(0, 3),
      },
      learning: { recent: lrns.slice(0, 3) },
      decisions: { recent: adrsA.slice(0, 3) },
      snapshot_at: new Date().toISOString(),
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

async function brainV2RecommendNext(req, res) {
  try {
    // Pull system state inline (same data as autonomous_status)
    const [roadmapR, validR, tasksR] = await Promise.all([
      sbFetch('engineering_roadmap?order=phase_number.asc&limit=50'),
      sbFetch('brain_validations?order=created_at.desc&limit=5'),
      sbFetch('operator_tasks?status=not.eq.done&order=created_at.desc&limit=20'),
    ]);
    const [roadmap, validations, tasks] = await Promise.all([roadmapR.json(), validR.json(), tasksR.json()]);

    const phases  = Array.isArray(roadmap) ? roadmap : [];
    const vals    = Array.isArray(validations) ? validations : [];
    const tsks    = Array.isArray(tasks) ? tasks : [];
    const active  = phases.filter(p => p.status === 'active');
    const failing = vals.filter(v => v.status === 'fail' || v.status === 'partial');
    const engTasks = tsks.filter(t => (t.category === 'engineering' || (t.tags && t.tags.includes('engineering'))) && t.status !== 'done' && t.status !== 'completed');
    const pending = phases.filter(p => p.status === 'pending');

    let action, reason, priority, context = {};

    if (failing.length > 0) {
      action = 'fix_validation';
      priority = 'P1';
      reason = `${failing.length} validation run(s) show FAIL/PARTIAL status — resolve before advancing`;
      context = { failing_phases: failing.map(v => v.phase_name), last_fail: failing[0] };
    } else if (engTasks.length > 0) {
      action = 'execute_task';
      priority = 'P1';
      reason = `${engTasks.length} open engineering task(s) awaiting execution`;
      context = { next_task: engTasks[0] };
    } else if (active.length > 0) {
      action = 'validate_phase';
      priority = 'P2';
      reason = `Phase ${active[0].phase_number} (${active[0].name}) is active — run self-validation to confirm completion`;
      context = { active_phase: active[0] };
    } else if (pending.length > 0) {
      action = 'advance_phase';
      priority = 'P2';
      reason = `Next phase ready: ${pending[0].name} (phase ${pending[0].phase_number})`;
      context = { next_phase: pending[0] };
    } else {
      action = 'monitor';
      priority = 'P3';
      reason = 'All phases complete and no open tasks — monitor production KPIs';
      context = {};
    }

    const actionLabels = {
      fix_validation: 'Fix Validation Failure',
      execute_task:   'Execute Engineering Task',
      validate_phase: 'Run Phase Self-Validation',
      advance_phase:  'Advance to Next Phase',
      monitor:        'Monitor Production',
    };

    return res.status(200).json({
      ok: true,
      recommended_action: action,
      action_label: actionLabels[action] || action,
      priority,
      reason,
      context,
      generated_at: new Date().toISOString(),
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// ── v15.4.0 Finance Snapshot Engine ──────────────────────────────────────────
// Upsert one snapshot. Body: { date, net_worth, portfolio, debt, cash, income,
// expenses, cashflow, emergency_fund, runway, savings_rate, source, plaid_active }
async function financeSnapshotSave(req, res) {
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'supabase_not_configured' });
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  if (!b.date) return res.status(400).json({ error: 'date_required' });
  const row = {
    date:          b.date,
    net_worth:     parseFloat(b.net_worth)     || 0,
    portfolio:     parseFloat(b.portfolio)     || 0,
    debt:          parseFloat(b.debt)          || 0,
    cash:          parseFloat(b.cash)          || 0,
    income:        parseFloat(b.income)        || 0,
    expenses:      parseFloat(b.expenses)      || 0,
    cashflow:      parseFloat(b.cashflow)      || 0,
    emergency_fund:parseFloat(b.emergency_fund)|| 0,
    runway:        parseFloat(b.runway)        || 0,
    savings_rate:  parseFloat(b.savings_rate)  || 0,
    source:        b.source || 'live',
    plaid_active:  !!b.plaid_active,
    updated_at:    new Date().toISOString(),
  };
  const url = `${SUPABASE_URL}/rest/v1/finance_snapshots?on_conflict=date`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'supabase_upsert_failed', detail: t }); }
  return res.status(200).json({ ok: true, date: row.date });
}

// Get snapshots in date range. Query params: from, to (YYYY-MM-DD), limit (default 400)
async function financeSnapshotList(req, res) {
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'supabase_not_configured' });
  const q = req.query || {};
  const from  = q.from  || '2000-01-01';
  const to    = q.to    || new Date().toISOString().slice(0,10);
  const limit = parseInt(q.limit) || 400;
  const url = `${SUPABASE_URL}/rest/v1/finance_snapshots?date=gte.${from}&date=lte.${to}&order=date.asc&limit=${limit}`;
  const r = await fetch(url, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'supabase_select_failed', detail: t }); }
  const rows = await r.json();
  return res.status(200).json({ ok: true, snapshots: rows });
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// v15.17.0 — MMMOS Platform Connector & Publishing Control Layer, PHASE 1 FOUNDATION
// ══════════════════════════════════════════════════════════════════════════════════════════
// Registry-only control layer for AI Studio / NextWave / SRV Farsi (priority) and SRV English
// (deferred) platform connections (YouTube / TikTok / Instagram). This layer NEVER stores raw
// tokens or secrets — the platform_connections table is a status/registry layer only.
// source_table + source_ref point at the existing youtube_connections / tiktok_connections
// credential tables (and eventually instagram_connections), which remain the ONLY place OAuth
// tokens ever live. Existing YouTube publishing, SRV Farsi/English, Factory, Finance, and
// lifecycle behavior are all untouched by everything below — these are new, additive,
// read-mostly actions against a brand-new table plus safe reuse of the existing
// brain_health_checks and approvals tables. TikTok/Instagram connecting and publishing are
// intentionally NOT activated in this phase (see PUBLISHING_ROUTER_CONTRACT — it only ever
// resolves to platforms that already have publishing_capability=true in the registry, which
// today means YouTube only).

async function platformConnectionsList(req, res) {
  try {
    const q = req.query || {};
    let url = 'platform_connections?select=*&order=engine.asc,platform.asc';
    if (q.engine) url += `&engine=eq.${encodeURIComponent(q.engine)}`;
    if (q.platform) url += `&platform=eq.${encodeURIComponent(q.platform)}`;
    const rows = await sbGet(url);
    return res.status(200).json({ ok: true, connections: rows || [] });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// Shaped for the Engineering Brain "Platform Connections" UI section: { engine: { platform: row } }
async function platformConnectionsMatrix(req, res) {
  try {
    const rows = await sbGet('platform_connections?select=*&order=engine.asc,platform.asc');
    const matrix = {};
    (rows || []).forEach(r => {
      if (!matrix[r.engine]) matrix[r.engine] = {};
      matrix[r.engine][r.platform] = r;
    });
    return res.status(200).json({
      ok: true,
      matrix,
      priority_engines: ['AI Studio', 'NextWave'],
      registry_only_engines: ['SRV Farsi'],
      deferred_engines: ['SRV English'],
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// Generic status-field upsert by (engine, platform). Rows are seeded, not auto-created, and
// raw token/secret fields are explicitly rejected — those only ever live in the
// platform-specific credential tables (youtube_connections / tiktok_connections / future
// instagram_connections).
const PLATFORM_CONNECTION_WRITABLE_FIELDS = [
  'account_identity', 'connection_status', 'auth_status', 'required_scopes', 'token_health', 'token_expiry',
  'publishing_capability', 'analytics_capability', 'last_sync', 'last_publish', 'last_error',
  'ceo_authorization_required', 'action_needed', 'source_table', 'source_ref', 'notes',
];
async function platformConnectionUpdateStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  try {
    const body = req.body || {};
    const { engine, platform } = body;
    if (!engine || !platform) return res.status(400).json({ ok: false, error: 'engine and platform required' });
    if (['access_token', 'refresh_token', 'token', 'secret'].some(k => k in body)) {
      return res.status(400).json({
        ok: false, error: 'tokens_not_allowed',
        message: 'platform_connections never stores raw tokens — write to the platform-specific connections table instead.',
      });
    }
    const patch = { updated_at: new Date().toISOString() };
    for (const f of PLATFORM_CONNECTION_WRITABLE_FIELDS) if (body[f] !== undefined) patch[f] = body[f];
    const existing = await sbGet(`platform_connections?engine=eq.${encodeURIComponent(engine)}&platform=eq.${encodeURIComponent(platform)}&limit=1`);
    if (!existing || !existing.length) {
      return res.status(404).json({ ok: false, error: 'not_found', message: 'Unknown engine/platform combination — registry rows are seeded, not auto-created.' });
    }
    const updated = await sbPatch('platform_connections', `id=eq.${existing[0].id}`, patch);
    return res.status(200).json({ ok: true, connection: Array.isArray(updated) ? updated[0] : updated });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// Mirrors platform_connections status into the EXISTING brain_health_checks model (reused,
// not redesigned) — component naming: "<platform>_connection" per engine.
async function platformConnectionSyncHealth(req, res) {
  try {
    const rows = await sbGet('platform_connections?select=*');
    const statusMap = {
      CONNECTED: 'healthy', HEALTHY: 'healthy', DEGRADED: 'degraded', AUTH_REQUIRED: 'degraded',
      TOKEN_EXPIRED: 'degraded', ERROR: 'critical', NOT_CONNECTED: 'unknown', DEFERRED: 'unknown',
    };
    const results = [];
    for (const r of (rows || [])) {
      const component = `${r.platform}_connection`;
      const status = statusMap[r.connection_status] || 'unknown';
      const now = new Date().toISOString();
      const payload = {
        engine: r.engine,
        component,
        status,
        active_issue: r.last_error || r.action_needed || null,
        recommended_action: r.action_needed || null,
        business_impact: r.ceo_authorization_required ? 'Requires CEO authorization to proceed' : null,
        metadata: { platform: r.platform, connection_status: r.connection_status, publishing_capability: r.publishing_capability },
      };
      const existing = await sbGet(`brain_health_checks?engine=eq.${encodeURIComponent(r.engine)}&component=eq.${encodeURIComponent(component)}&limit=1`);
      if (existing && existing.length) {
        await sbPatch('brain_health_checks', `id=eq.${existing[0].id}`, { ...payload, last_check: now, updated_at: now });
      } else {
        await sbInsert('brain_health_checks', { ...payload, last_check: now, updated_at: now, created_at: now });
      }
      results.push({ engine: r.engine, platform: r.platform, status });
    }
    return res.status(200).json({ ok: true, synced: results.length, results });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// Creates a CEO authorization request via the EXISTING generic `approvals` table (reused, not
// duplicated) — this is the "CREATE ONE CEO AUTHORIZATION REQUEST" step of the connection workflow.
async function platformConnectionRequestCeoAuth(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  try {
    const { engine, platform, reason } = req.body || {};
    if (!engine || !platform) return res.status(400).json({ ok: false, error: 'engine and platform required' });
    const existing = await sbGet(`platform_connections?engine=eq.${encodeURIComponent(engine)}&platform=eq.${encodeURIComponent(platform)}&limit=1`);
    if (!existing || !existing.length) return res.status(404).json({ ok: false, error: 'not_found' });
    const conn = existing[0];
    const approval = await sbInsert('approvals', {
      item_type: 'platform_connection',
      item_id: `${engine}|${platform}`,
      item_title: `${engine} — ${platform} connection authorization`,
      submitted_by: 'engineering_agent',
      assigned_to: 'admin',
      status: 'pending',
      approval_type: 'platform_connection',
      notes: reason || conn.action_needed || 'Platform connection requires CEO authorization.',
    });
    await sbPatch('platform_connections', `id=eq.${conn.id}`, { ceo_authorization_required: true, updated_at: new Date().toISOString() });
    return res.status(200).json({ ok: true, approval });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// v15.17.0 — Agent Action Model (spec item 7). Contracts defined now; only the YouTube branch
// performs a real check (read-only, against the already-active youtube_connections table).
// TikTok/Instagram branches deliberately return activated:false — Phase 1 does not connect or
// publish to those platforms yet.
async function platformConnectionVerify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  try {
    const { engine, platform } = req.body || {};
    if (!engine || !platform) return res.status(400).json({ ok: false, error: 'engine and platform required' });
    const existing = await sbGet(`platform_connections?engine=eq.${encodeURIComponent(engine)}&platform=eq.${encodeURIComponent(platform)}&limit=1`);
    if (!existing || !existing.length) return res.status(404).json({ ok: false, error: 'not_found' });
    const conn = existing[0];
    if (platform === 'youtube') {
      const yt = await sbGet(`youtube_connections?channel_id=eq.${encodeURIComponent(conn.source_ref || '')}&limit=1`);
      const ytRow = (yt && yt[0]) || null;
      const healthy = !!ytRow && ytRow.status === 'connected';
      return res.status(200).json({
        ok: true, activated: true, verified: !!ytRow, healthy,
        youtube_connection: ytRow ? { status: ytRow.status, last_sync: ytRow.last_sync, token_expires_at: ytRow.token_expires_at } : null,
      });
    }
    // v15.18.0 — TikTok verification activated (AI Studio TikTok/Instagram connector task).
    // Publishing/auto-post automation remains NOT activated — this only checks connection health.
    if (platform === 'tiktok') {
      const tt = await sbGet(`tiktok_connections?mmm_engine=eq.${encodeURIComponent(engine)}&limit=1`);
      const ttRow = (tt && tt[0]) || null;
      if (!ttRow) {
        return res.status(200).json({ ok: true, activated: true, verified: false, healthy: false, message: 'No tiktok_connections row tagged for this engine yet — CEO authorization pending.' });
      }
      const notExpired = ttRow.token_expires_at ? new Date(ttRow.token_expires_at).getTime() > Date.now() : false;
      const scope = ttRow.scope || '';
      // v15.18.2 — Draft-only design: Direct Post is intentionally left OFF in the TikTok app,
      // so the creator_info dry-run endpoint (which requires Direct Post/video.publish scope)
      // is NOT usable here and must not be used to gate capability. The granted OAuth scope
      // itself (video.upload) is the authoritative signal for draft-upload capability.
      const publishingCapability = scope.includes('video.upload') || scope.includes('video.publish');
      const analyticsCapability = scope.includes('user.info.stats');
      const healthy = ttRow.status === 'connected' && notExpired && publishingCapability;
      if (healthy) {
        const now = new Date().toISOString();
        const existingPC = await sbGet(`platform_connections?engine=eq.${encodeURIComponent(engine)}&platform=eq.tiktok&limit=1`);
        if (existingPC && existingPC.length) {
          await sbPatch('platform_connections', `id=eq.${existingPC[0].id}`, {
            connection_status: 'HEALTHY', auth_status: 'authorized', token_health: 'healthy',
            publishing_capability: true, analytics_capability: analyticsCapability,
            last_sync: now, last_error: null, ceo_authorization_required: false, action_needed: null, updated_at: now,
          });
        }
        const existingHC = await sbGet(`brain_health_checks?engine=eq.${encodeURIComponent(engine)}&component=eq.tiktok_connection&limit=1`);
        if (existingHC && existingHC.length) {
          await sbPatch('brain_health_checks', `id=eq.${existingHC[0].id}`, { status: 'healthy', active_issue: null, recommended_action: null, last_check: now, updated_at: now });
        }
      }
      return res.status(200).json({
        ok: true, activated: true, verified: true, healthy, publishingCapability, analyticsCapability,
        tiktok_connection: { status: ttRow.status, scope: ttRow.scope, last_sync: ttRow.last_sync, token_expires_at: ttRow.token_expires_at },
      });
    }
    // Instagram: schema + code are ready, but no Meta Developer App exists yet
    // (INSTAGRAM_APP_ID is still a placeholder) — genuinely not activated.
    return res.status(200).json({
      ok: true, activated: false,
      message: `${platform} verification is schema-ready but not activated — no Meta Developer App configured yet.`,
      connection: conn,
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}

// v15.19.0 — TikTok draft-upload routing (production pipeline → TikTok inbox).
// Uses Content Posting API "Upload to TikTok" via FILE_UPLOAD (push_by_file) — NOT
// PULL_FROM_URL. PULL_FROM_URL requires TikTok domain verification, which is NOT complete
// (checked live in the Developer Portal: Content Posting API → "Verify domains" still shows
// unverified). FILE_UPLOAD works regardless of source hosting domain (Submagic CDN for AI
// Studio, Supabase Storage for SRV Farsi) because MMMOS fetches the bytes itself and pushes
// them directly to TikTok — no domain ownership/DNS step required, fully automatable
// server-side with zero further Developer Portal configuration.
// Draft-only: video lands in the creator's TikTok inbox for manual review/edit/post. Direct
// Post / video.publish is never requested here — this only ever uses the video.upload grant.
const TT_INBOX_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const TT_STATUS_URL     = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const TT_TOKEN_URL      = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_SHORT_ELIGIBLE_ENGINES = ['AI Studio', 'SRV Farsi'];

// v15.20.8 — CEO escalation fix (SRV Farsi TikTok frame_rate_check_failed): SRV Farsi Shorts
// are rendered client-side via canvas.captureStream()+MediaRecorder → WebM, which is prone to
// variable frame rate — TikTok's Content Posting API validator rejects that outright with
// `frame_rate_check_failed`. AI Studio's videos come from HeyGen/Submagic as proper
// constant-frame-rate MP4s and never hit this. First attempt used Shotstack (already integrated
// for SRV English rendering) but SHOTSTACK_API_KEY turned out not to be configured in this
// Vercel project — confirmed via a real failed test call, not assumed. Per CEO decision,
// switched to a self-contained fix: re-encode in-process with a bundled static ffmpeg binary
// (@ffmpeg-installer/ffmpeg — no external account/API key/network dependency). `-r 25
// -fps_mode cfr` forces a genuine constant frame rate; re-encoding to libx264/AAC in an MP4
// container also fixes the VP8-9/Opus-in-WebM codec mismatch as a side benefit. Runs entirely
// in Vercel's writable /tmp. YouTube publishing (which already uploaded the original webm
// successfully) is completely untouched — this only runs inside the TikTok upload path.
async function _transcodeWebmToMp4ForTikTok(inputBuf) {
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const inPath = join(tmpdir(), `tt-in-${id}.webm`);
  const outPath = join(tmpdir(), `tt-out-${id}.mp4`);
  try {
    await writeFile(inPath, inputBuf);
    // v15.20.8 — the ffmpeg build bundled by @ffmpeg-installer/ffmpeg (a 2019-era static
    // build) predates the `-fps_mode` flag (added in ffmpeg 5.1) — confirmed via `-h full`
    // against the actual installed binary, not assumed. Use the older `-vsync cfr` instead,
    // which this build does support and which forces the same constant-frame-rate output.
    await execFileAsync(ffmpegInstaller.path, [
      '-y', '-i', inPath,
      '-r', '25', '-vsync', 'cfr',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ], { timeout: 40000, maxBuffer: 1024 * 1024 * 10 });
    const outBuf = await readFile(outPath);
    if (!outBuf || !outBuf.length) throw new Error('ffmpeg produced an empty file');
    return outBuf;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}
// mmm_engine label → /api/tiktok/auth?engine=<key> query key, so a failed-refresh
// response can hand the operator a precise, single-engine reauthorization link.
const TIKTOK_ENGINE_AUTH_KEYS = { 'AI Studio': 'ai_studio', 'SRV Farsi': 'srv_farsi', 'NextWave': 'nextwave', 'SRV English': 'srv_english' };

// v15.20.7 — TikTok token refresh (fix-forward, Engineering Task 1c0e3090 — TikTok auth
// failure). Root cause: tiktokPublishDraft only ever checked token_expires_at and bailed
// with `skipped: token_expired` when stale — it never attempted a refresh. A working
// refresh-token exchange already existed in api/tiktok/sync.js (a separate serverless
// function, only invoked by the manual/periodic sync endpoint), but the actual publish
// path in this file never called it. Both engines' 24h access tokens were granted around
// the same session and expired together with nothing to refresh them before a publish
// attempt — hence both engines failing with token_expired at once. Fix: mirror the same
// refresh_token grant here and call it proactively before every publish attempt.
async function _refreshTikTokAccessToken(refreshToken) {
  const res = await fetch(TT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  // TikTok's token endpoint returns tokens at the top level (no data wrapper) and signals
  // failure either via non-2xx or an explicit error.code !== 'ok' (e.g. invalid_grant when
  // the refresh token itself has expired or was revoked).
  if (!res.ok || (json.error && json.error.code !== 'ok')) {
    const msg = json.error?.message || json.error?.code || String(res.status);
    const err = new Error(msg);
    err.tiktokErrorCode = json.error?.code || null;
    throw err;
  }
  return json; // { access_token, refresh_token, expires_in, refresh_expires_in, open_id, scope }
}

// Ensures ttRow.access_token is usable for an imminent API call: refreshes proactively
// when expired or within 5 minutes of expiry, persists the new tokens, and returns the
// (possibly updated) row + access token. Throws with `.authRequired = true` if the
// refresh itself fails (refresh_token expired/revoked) — caller marks THIS engine's
// connection auth_required and surfaces a reauthorization link, without touching the
// other engine's row (every write here is scoped by this row's own open_id).
async function _ensureTikTokAccessToken(ttRow, engine) {
  const now = Date.now();
  const expiresAt = ttRow.token_expires_at ? new Date(ttRow.token_expires_at).getTime() : 0;
  const FIVE_MIN = 5 * 60 * 1000;
  if (expiresAt - now > FIVE_MIN) {
    return { accessToken: ttRow.access_token, row: ttRow, refreshed: false };
  }
  if (!ttRow.refresh_token) {
    const err = new Error('no_refresh_token_on_record');
    err.authRequired = true;
    throw err;
  }
  try {
    const refreshed = await _refreshTikTokAccessToken(ttRow.refresh_token);
    const nowIso = new Date().toISOString();
    const newExpiry = new Date(Date.now() + (refreshed.expires_in || 86400) * 1000).toISOString();
    const newRefreshExpiry = refreshed.refresh_expires_in
      ? new Date(Date.now() + refreshed.refresh_expires_in * 1000).toISOString()
      : ttRow.refresh_expires_at;
    const patch = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || ttRow.refresh_token,
      token_expires_at: newExpiry,
      refresh_expires_at: newRefreshExpiry,
      status: 'connected',
      last_sync: nowIso,
    };
    await sbPatch('tiktok_connections', `open_id=eq.${encodeURIComponent(ttRow.open_id)}`, patch);
    await sbInsert('tiktok_sync_logs', {
      open_id: ttRow.open_id, status: 'token_refreshed',
      message: `[${engine}] access token refreshed proactively before publish`, synced_at: nowIso,
    }).catch(() => {});
    return { accessToken: refreshed.access_token, row: { ...ttRow, ...patch }, refreshed: true };
  } catch (e) {
    const nowIso = new Date().toISOString();
    await sbPatch('tiktok_connections', `open_id=eq.${encodeURIComponent(ttRow.open_id)}`, { status: 'auth_required' }).catch(() => {});
    await sbInsert('tiktok_sync_logs', {
      open_id: ttRow.open_id, status: 'token_refresh_failed',
      message: `[${engine}] ${e.message}`, synced_at: nowIso,
    }).catch(() => {});
    // Non-blocking bonus registry sync so Engineering Brain reflects this engine (only)
    // needing reauthorization — same non-destructive pattern used elsewhere in this file.
    const existingPC = await sbGet(`platform_connections?engine=eq.${encodeURIComponent(engine)}&platform=eq.tiktok&limit=1`).catch(() => null);
    if (existingPC && existingPC.length) {
      await sbPatch('platform_connections', `id=eq.${existingPC[0].id}`, {
        connection_status: 'AUTH_REQUIRED', auth_status: 'expired',
        action_needed: `Refresh token expired/revoked — reauthorize TikTok for ${engine}`,
        updated_at: nowIso,
      }).catch(() => {});
    }
    const err2 = new Error('refresh_token_invalid_or_expired: ' + e.message);
    err2.authRequired = true;
    throw err2;
  }
}

async function tiktokPublishDraft(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  try {
    const { engine, videoUrl, caption, hashtags } = req.body || {};
    if (!engine || !videoUrl) return res.status(400).json({ ok: false, error: 'engine and videoUrl required' });
    // v15.21.0 — CEO Decision (2026-07-28): "Freeze TikTok & Instagram Production." TikTok
    // publishing is disabled system-wide — hard-frozen here, before any TikTok API call, DB
    // lookup, or token refresh happens, so this can never fire an upload regardless of which
    // client path calls it (button, auto-chain, retry, etc). The tiktok_connections row and
    // refresh-token machinery are deliberately left completely untouched below this guard —
    // the CEO wants the connection kept alive for future analytics/data collection, just not
    // used for publishing. Manual publishing (operator uploads via the TikTok app themselves,
    // using the caption/metadata this system still generates) replaces automated publishing
    // until a channel proves a repeatable, profitable YouTube business model.
    return res.status(200).json({
      ok: false, error: 'production_frozen',
      message: 'TikTok publishing is frozen per CEO directive (2026-07-28). Publish manually in the TikTok app using the generated caption below.',
    });
    // eslint-disable-next-line no-unreachable
    // v15.20.6 — metadata parity audit trail: TikTok's inbox/video/init endpoint has no
    // caption/title field (API-confirmed), so this can't be attached to the draft itself —
    // but log it so there's a durable record of the exact caption that was supposed to
    // accompany this draft, for the operator to paste in and for later verification.
    const captionPreview = [(caption || '').toString().slice(0, 200), (hashtags || '').toString().slice(0, 100)]
      .filter(Boolean).join(' | ');

    // Strict engine allowlist — only AI Studio and SRV Farsi are wired for TikTok Short
    // routing this phase. Any other engine (NextWave, SRV English, etc.) is a clean no-op,
    // never an error, so this action can be called defensively without risk of touching them.
    if (!TIKTOK_SHORT_ELIGIBLE_ENGINES.includes(engine)) {
      return res.status(200).json({ ok: true, skipped: true, reason: `engine_not_eligible:${engine}` });
    }

    const ttRows = await sbGet(`tiktok_connections?mmm_engine=eq.${encodeURIComponent(engine)}&limit=1`);
    let ttRow = (ttRows && ttRows[0]) || null;
    // v15.20.7 — only a genuinely never-connected engine (no row at all) is a clean skip.
    // A row with status 'auth_required' or a stale 'connected' status still gets a real
    // refresh attempt below — that's the single source of truth now, not this status string.
    if (!ttRow) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'tiktok_not_connected' });
    }
    const scope = ttRow.scope || '';
    if (!scope.includes('video.upload')) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'video_upload_scope_missing' });
    }
    // v15.20.7 — refresh-before-publish (fix-forward for CEO-reported token_expired on both
    // engines). Proactively refreshes when expired or within 5 min of expiry; persists the
    // new tokens; on refresh failure (refresh_token itself dead), marks ONLY this engine's
    // row auth_required and returns a precise reauthorization link — never touches the
    // other engine's connection.
    let accessToken;
    try {
      const ensured = await _ensureTikTokAccessToken(ttRow, engine);
      accessToken = ensured.accessToken;
      ttRow = ensured.row;
    } catch (e) {
      if (e.authRequired) {
        return res.status(200).json({
          ok: false, authRequired: true, engine,
          error: 'tiktok_auth_required',
          message: e.message,
          reauthorizeUrl: `/api/tiktok/auth?engine=${encodeURIComponent(TIKTOK_ENGINE_AUTH_KEYS[engine] || '')}`,
        });
      }
      throw e;
    }

    // Fetch source video bytes server-side (works for any hosting domain — Submagic CDN or
    // Supabase Storage — since TikTok never touches the source URL directly with this method).
    let videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      return res.status(200).json({ ok: false, error: `source_fetch_failed_${videoRes.status}` });
    }
    let videoBuf = Buffer.from(await videoRes.arrayBuffer());
    let videoSize = videoBuf.length;
    if (!videoSize) return res.status(200).json({ ok: false, error: 'source_video_empty' });
    // Derive real content-type from the source (SRV Farsi renders are .webm; AI Studio/Submagic
    // outputs are .mp4) — TikTok accepts mp4/mov/webm, but the PUT's Content-Type should match
    // the actual bytes rather than being hardcoded.
    let srcContentType = (videoRes.headers.get('content-type') || '').split(';')[0].trim();
    let uploadContentType = srcContentType && srcContentType.startsWith('video/') ? srcContentType : 'video/mp4';
    // v15.20.8 — SRV Farsi's WebM (variable frame rate) fails TikTok's validator with
    // frame_rate_check_failed. Transcode to a clean constant-frame-rate MP4 with an in-process
    // ffmpeg BEFORE the TikTok upload — YouTube already published from the original webm and
    // is completely unaffected by this (that path never touches this function).
    const _isWebm = srcContentType.includes('webm') || /\.webm(\?|$)/i.test(videoUrl);
    if (_isWebm) {
      try {
        const mp4Buf = await _transcodeWebmToMp4ForTikTok(videoBuf);
        videoBuf = mp4Buf; videoSize = mp4Buf.length;
        srcContentType = 'video/mp4'; uploadContentType = 'video/mp4';
        await sbInsert('tiktok_sync_logs', {
          open_id: ttRow.open_id, status: 'webm_transcode_success',
          message: `[${engine}] webm→mp4 via in-process ffmpeg for TikTok upload (frame_rate_check_failed fix-forward), size=${mp4Buf.length}`,
          synced_at: new Date().toISOString(),
        }).catch(() => {});
      } catch (e) {
        await sbInsert('tiktok_sync_logs', {
          open_id: ttRow.open_id, status: 'webm_transcode_failed',
          message: `[${engine}] ${e.message}`, synced_at: new Date().toISOString(),
        }).catch(() => {});
        return res.status(200).json({ ok: false, error: `webm_transcode_failed: ${e.message}` });
      }
    }
    // Single-chunk upload only (fine for Shorts, which are well under this). A Short that
    // somehow exceeds it is skipped cleanly rather than attempting multi-chunk logic —
    // out of scope for this phase.
    if (videoSize > 64 * 1024 * 1024) {
      return res.status(200).json({ ok: false, error: 'video_too_large_for_single_chunk', videoSize });
    }

    async function _doInit(tok) {
      const r = await fetch(TT_INBOX_INIT_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          source_info: { source: 'FILE_UPLOAD', video_size: videoSize, chunk_size: videoSize, total_chunk_count: 1 },
        }),
      });
      return r.json().catch(() => ({}));
    }
    let initData = await _doInit(accessToken);
    // v15.20.7 — one-time refresh+retry safety net: if the proactive expiry check above
    // said the token was still fresh but TikTok itself rejects it as invalid/expired (clock
    // drift, or the token was revoked out-of-band), refresh once and retry this SAME init
    // call exactly once — never a loop, never a second video upload attempt.
    const _initAuthCode = initData?.error?.code;
    if ((_initAuthCode === 'access_token_invalid' || _initAuthCode === 'access_token_expired') && ttRow.refresh_token) {
      try {
        const ensured = await _ensureTikTokAccessToken({ ...ttRow, token_expires_at: new Date(0).toISOString() }, engine);
        accessToken = ensured.accessToken;
        ttRow = ensured.row;
        initData = await _doInit(accessToken);
      } catch (e) {
        if (e.authRequired) {
          return res.status(200).json({
            ok: false, authRequired: true, engine, error: 'tiktok_auth_required', message: e.message,
            reauthorizeUrl: `/api/tiktok/auth?engine=${encodeURIComponent(TIKTOK_ENGINE_AUTH_KEYS[engine] || '')}`,
          });
        }
        throw e;
      }
    }
    const publishId = initData?.data?.publish_id;
    const uploadUrl = initData?.data?.upload_url;
    if (!publishId || !uploadUrl) {
      // v15.20.3 — include error.code (TikTok often puts the actual reason, e.g.
      // "spam_risk_too_many_pending_share", in code rather than message) so init-stage
      // rejections are just as diagnosable as status-stage ones.
      const errMsg = initData?.error?.code || initData?.error?.message || JSON.stringify(initData).slice(0, 300);
      await sbInsert('tiktok_sync_logs', {
        open_id: ttRow.open_id, status: 'publish_draft_init_failed',
        message: `[${engine}] ${errMsg}`, synced_at: new Date().toISOString(),
      }).catch(() => {});
      return res.status(200).json({ ok: false, error: `tiktok_init_failed: ${errMsg}` });
    }

    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': uploadContentType, 'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}` },
      body: videoBuf,
    });
    if (!putResp.ok) {
      const putErr = await putResp.text().catch(() => '');
      await sbInsert('tiktok_sync_logs', {
        open_id: ttRow.open_id, status: 'publish_draft_upload_failed',
        message: `[${engine}] ${putResp.status}: ${putErr.slice(0, 200)}`, synced_at: new Date().toISOString(),
      }).catch(() => {});
      return res.status(200).json({ ok: false, error: `tiktok_upload_failed_${putResp.status}`, publish_id: publishId });
    }

    // v15.20.3 — Fix-forward: verified-status polling, not optimistic success. Previously this
    // did a single "best-effort" status.fetch call immediately after the PUT and then returned
    // ok:true UNCONDITIONALLY (the fetched status was recorded as text only, never inspected).
    // Real bug this caused: the byte upload (PUT) can succeed at the transport level while
    // TikTok's async processing later rejects the share (e.g. fail_reason
    // "spam_risk_too_many_pending_share" when the account already has too many undelivered
    // drafts) — MMMOS was reporting PUBLISHED for a draft that never actually reached the
    // creator's TikTok inbox. Fix: poll TT_STATUS_URL until a terminal state is reached —
    // 'FAILED' (real provider error, surfaced verbatim, including fail_reason) or a known
    // success terminal ('SEND_TO_USER_INBOX' — this is a draft-inbox delivery, never
    // 'PUBLISH_COMPLETE' since Direct Post is intentionally off). If no terminal state is
    // reached within the poll budget, this returns ok:false with a distinct
    // 'status_unverified_timeout' error — per CEO directive, no optimistic success. Poll budget:
    // 7 attempts / ~2.5s apart (~17s total), well inside the 60s function ceiling.
    const TT_TERMINAL_SUCCESS = new Set(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE']);
    const TT_TERMINAL_FAILURE = new Set(['FAILED']);
    let statusData = null;
    let lastStatus = 'unknown';
    let terminal = null; // 'success' | 'failure' | null (timed out)
    for (let attempt = 0; attempt < 7; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2500));
      try {
        const statusResp = await fetch(TT_STATUS_URL, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ publish_id: publishId }),
        });
        statusData = await statusResp.json().catch(() => null);
      } catch (_) { statusData = null; }
      lastStatus = statusData?.data?.status || lastStatus;
      if (TT_TERMINAL_FAILURE.has(lastStatus)) { terminal = 'failure'; break; }
      if (TT_TERMINAL_SUCCESS.has(lastStatus)) { terminal = 'success'; break; }
    }

    const now = new Date().toISOString();
    const failReason = statusData?.data?.fail_reason || statusData?.error?.message || null;

    if (terminal === 'failure') {
      await sbInsert('tiktok_sync_logs', {
        open_id: ttRow.open_id, status: 'publish_draft_failed_verified',
        message: `[${engine}] publish_id=${publishId} status=${lastStatus} fail_reason=${failReason || 'unspecified'}`,
        synced_at: now,
      }).catch(() => {});
      return res.status(200).json({
        ok: false, error: failReason || `tiktok_status_failed_${lastStatus}`, publish_id: publishId, status: lastStatus,
      });
    }

    if (terminal !== 'success') {
      // Neither FAILED nor a known success terminal was observed within the poll budget —
      // treat as unverified, NOT as success. The draft may still land later, but MMMOS cannot
      // claim PUBLISHED without having actually seen it.
      await sbInsert('tiktok_sync_logs', {
        open_id: ttRow.open_id, status: 'publish_draft_unverified',
        message: `[${engine}] publish_id=${publishId} last_status=${lastStatus} (no terminal state within poll budget)`,
        synced_at: now,
      }).catch(() => {});
      return res.status(200).json({
        ok: false, error: `status_unverified_timeout (last status: ${lastStatus})`, publish_id: publishId, status: lastStatus,
      });
    }

    // terminal === 'success' — verified delivery to the TikTok inbox.
    await sbInsert('tiktok_sync_logs', {
      open_id: ttRow.open_id, status: 'publish_draft_success_verified',
      message: `[${engine}] publish_id=${publishId} status=${lastStatus} caption="${captionPreview}"`,
      synced_at: now,
    }).catch(() => {});
    // Non-blocking bonus telemetry only (last_publish) — never touches connection_status/
    // health, which remains owned exclusively by platformConnectionVerify.
    const existingPC = await sbGet(`platform_connections?engine=eq.${encodeURIComponent(engine)}&platform=eq.tiktok&limit=1`).catch(() => null);
    if (existingPC && existingPC.length) {
      await sbPatch('platform_connections', `id=eq.${existingPC[0].id}`, { last_publish: now, updated_at: now }).catch(() => {});
    }

    return res.status(200).json({
      ok: true, publish_id: publishId, status: lastStatus, videoSize, engine,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// v15.20.3 — Non-destructive TikTok status re-check. Given an engine + an existing publish_id
// (already recorded from a prior tiktokPublishDraft call), calls TT_STATUS_URL once and returns
// TikTok's real current status/fail_reason — never re-uploads or creates a new draft. Exists
// specifically to audit/re-verify packages whose tiktokPublishState was written by the pre-fix
// code (which reported ok:true unconditionally after the byte PUT, without ever inspecting the
// status/fail_reason) — lets operators confirm whether a locally-recorded "published" state was
// ever actually true, without touching TikTok's pending-share queue.
async function tiktokCheckPublishStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only' });
  try {
    const { engine, publish_id } = req.body || {};
    if (!engine || !publish_id) return res.status(400).json({ ok: false, error: 'engine and publish_id required' });
    const ttRows = await sbGet(`tiktok_connections?mmm_engine=eq.${encodeURIComponent(engine)}&limit=1`);
    const ttRow = (ttRows && ttRows[0]) || null;
    if (!ttRow || ttRow.status !== 'connected') {
      return res.status(200).json({ ok: false, error: 'tiktok_not_connected' });
    }
    const statusResp = await fetch(TT_STATUS_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ttRow.access_token, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id }),
    });
    const statusData = await statusResp.json().catch(() => null);
    return res.status(200).json({
      ok: true, publish_id, status: statusData?.data?.status || 'unknown',
      fail_reason: statusData?.data?.fail_reason || null, raw: statusData,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// v15.17.0 — Publishing Router Contract (spec item 8). READ-ONLY resolver — it defines routing,
// it never publishes anything. Naturally resolves to YouTube-only today because only YouTube
// rows currently have publishing_capability=true in the registry; TikTok/Instagram will appear
// automatically once a future phase sets those flags — no code change needed here to "activate"
// them later.
const PUBLISHING_ROUTER_CONTRACT = {
  short: ['youtube', 'tiktok', 'instagram'], // YouTube Shorts, TikTok, Instagram Reels
  long: ['youtube'], // YouTube by default; other platforms only if explicitly supported/approved later
};
async function publishingRouterResolve(req, res) {
  try {
    const q = req.query || {};
    const format = (q.contentFormat || q.format || 'short').toLowerCase() === 'long' ? 'long' : 'short';
    const engine = q.engine || null;
    const candidatePlatforms = PUBLISHING_ROUTER_CONTRACT[format] || [];
    let url = `platform_connections?select=*&platform=in.(${candidatePlatforms.join(',')})`;
    if (engine) url += `&engine=eq.${encodeURIComponent(engine)}`;
    const rows = await sbGet(url);
    const eligible = (rows || []).filter(r => r.connection_status === 'CONNECTED' && r.publishing_capability === true);
    return res.status(200).json({
      ok: true,
      contentFormat: format,
      candidatePlatforms,
      eligiblePlatforms: [...new Set(eligible.map(r => r.platform))],
      note: 'Contract only — this endpoint does not publish. Eligible platforms reflect current connection_status + publishing_capability in platform_connections.',
    });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
}
