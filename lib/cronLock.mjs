// Database-backed single-flight lock with a cooldown (G1 / S-B). No schema change, no migration: one row per lock in app_settings.
// Why not the in-memory guard in lib/growthProbe.mjs: a serverless platform runs several instances, so a per-instance Set does not stop two parallel requests.
// How it is atomic: the claim is ONE conditional UPDATE — `PATCH app_settings?key=eq.<lock>&updated_at=lt.<now − cooldown>`. PostgreSQL re-evaluates the WHERE clause on the
// committed row version, so of N simultaneous claimants exactly one gets the row back (`Prefer: return=representation`); the others get an empty array.
// The row's updated_at is the lock time: a successful run keeps it (the cooldown runs from the START of the run); a FAILED run puts it back to the epoch so a retry is allowed.
// A run that dies without releasing simply holds the lock until the cooldown ends (no stuck state, no manual cleanup).
// Infrastructure failure (database error, unreadable lock row) is reported as reason `lock_unavailable`; the CALLERS FAIL CLOSED on it (refuse 503) — a run never starts without its lock.
// Injected `fetchImpl` / `supabaseUrl` / `serviceKey`: nothing here reads the environment or a clock of its own.
export const LOCKS = Object.freeze({ autosync: 'cron_lock_autosync', analytics: 'cron_lock_analytics' });   // never the shared-state key
// Cooldown = duplicate-fire protection for AUTHENTICATED callers (a retried cron delivery, a double-click, two overlapping manual runs). It is deliberately short: unauthenticated
// callers can no longer reach the lock at all (authentication always comes first), so the lock is not an abuse barrier and must never be able to starve the 00:49Z run.
export const DEFAULT_COOLDOWN_MS = Object.freeze({ autosync: 10 * 60e3, analytics: 10 * 60e3 });
export const FORCE_MIN_GAP_MS = 2 * 60e3;   // a CEO-forced run still cannot overlap a run that started less than 2 minutes ago
const EPOCH = '1970-01-01T00:00:00.000Z';

const headers = (serviceKey, extra = {}) => ({ apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json', ...extra });
const iso = (ms) => new Date(ms).toISOString();
const rid = (now) => 'r' + now.toString(36) + Math.random().toString(36).slice(2, 8);

export async function acquire({ name, cooldownMs, force = false, now = Date.now(), fetchImpl, supabaseUrl, serviceKey }) {
  const key = LOCKS[name]; if (!key) return { ok: false, reason: 'unknown_lock' };
  if (!fetchImpl || !supabaseUrl || !serviceKey) return { ok: false, reason: 'lock_unavailable' };        // fail closed: no lock, no run
  const cd = force ? FORCE_MIN_GAP_MS : (Number.isFinite(cooldownMs) ? cooldownMs : DEFAULT_COOLDOWN_MS[name]);
  const token = rid(now);
  try {
    // 1. make sure the row exists (idempotent; never overwrites an existing lock)
    await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?on_conflict=key`, { method: 'POST', headers: headers(serviceKey, { Prefer: 'resolution=ignore-duplicates,return=minimal' }), body: JSON.stringify([{ key, value: JSON.stringify({ state: 'idle' }), updated_at: EPOCH }]) });
    // 2. the atomic claim
    const claim = await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?key=eq.${key}&updated_at=lt.${encodeURIComponent(iso(now - cd))}`, { method: 'PATCH', headers: headers(serviceKey, { Prefer: 'return=representation' }), body: JSON.stringify({ value: JSON.stringify({ state: 'running', token, started: iso(now), forced: !!force }), updated_at: iso(now) }) });
    if (!claim.ok) return { ok: false, reason: 'lock_unavailable' };
    const rows = await claim.json();
    if (Array.isArray(rows) && rows.length === 1) return { ok: true, token, name, key };
    // 3. refused: say why (read-only)
    // A refusal is only believable if the lock row exists. If it cannot be read back (row missing, unexpected response) the lock mechanism is unavailable, not "busy".
    let state = 'lock_unavailable', retryAfterMs = cd;
    try { const g = await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?key=eq.${key}&select=value,updated_at`, { headers: headers(serviceKey) }); const rr = await g.json(); const r = Array.isArray(rr) ? rr[0] : null; if (r) { const v = JSON.parse(r.value || '{}'); state = v.state === 'running' ? 'run_in_progress' : 'cooldown'; retryAfterMs = Math.max(0, Date.parse(r.updated_at) + cd - now); } } catch (_) {}
    return { ok: false, reason: state, retryAfterMs };
  } catch (_) { return { ok: false, reason: 'lock_unavailable' }; }
}
// success=true keeps the cooldown running (updated_at untouched); success=false frees the lock so the next scheduled/forced run can retry.
export async function release({ lock, success, now = Date.now(), fetchImpl, supabaseUrl, serviceKey }) {
  if (!lock || !lock.ok || !fetchImpl) return false;
  try {
    const body = success ? { value: JSON.stringify({ state: 'done', token: lock.token, finished: iso(now) }) } : { value: JSON.stringify({ state: 'failed', token: lock.token, finished: iso(now) }), updated_at: EPOCH };
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?key=eq.${lock.key}&value=like.*${lock.token}*`, { method: 'PATCH', headers: headers(serviceKey, { Prefer: 'return=minimal' }), body: JSON.stringify(body) });
    return !!(r && r.ok);
  } catch (_) { return false; }
}

// ── what actually happened (G1 correction 3): release must follow the handler's real RESPONSE, not "no exception was thrown" ──
// Handlers answer through res.status(code).json(body) and swallow most errors into a 5xx / partial body, so the response is wrapped to record the outcome.
export function captureOutcome(res) {
  const cap = { code: 200, body: undefined, sent: false };
  const proxy = new Proxy(res, {
    get(target, prop) {
      if (prop === 'status') return (c) => { cap.code = c; target.status(c); return proxy; };
      if (prop === 'json') return (b) => { cap.body = b; cap.sent = true; return target.json(b); };
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { res: proxy, outcome: () => cap };
}
// A run counts as SUCCESS (the cooldown keeps running) only when it answered below 400 AND the body says the work completed; anything else frees the lock so a retry is possible.
//  autosync : every connected channel synced (failed === 0), or there was nothing to sync
//  analytics: the pipeline reported status "healthy"
export function runSucceeded(kind, cap) {
  if (!cap || !cap.sent || !(cap.code < 400) || !cap.body || typeof cap.body !== 'object') return false;
  if (kind === 'autosync') return cap.body.failed === 0 || (typeof cap.body.message === 'string' && Array.isArray(cap.body.synced));
  if (kind === 'analytics') return cap.body.status === 'healthy';
  return false;
}
