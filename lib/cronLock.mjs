// Database-backed single-flight lock with a cooldown (G1 / S-B). No schema change, no migration: one row per lock in app_settings.
// Why not the in-memory guard in lib/growthProbe.mjs: a serverless platform runs several instances, so a per-instance Set does not stop two parallel requests.
// How it is atomic: the claim is ONE conditional UPDATE — `PATCH app_settings?key=eq.<lock>&updated_at=lt.<now − cooldown>`. PostgreSQL re-evaluates the WHERE clause on the
// committed row version, so of N simultaneous claimants exactly one gets the row back (`Prefer: return=representation`); the others get an empty array.
// The row's updated_at is the lock time: a successful run keeps it (the cooldown runs from the START of the run); a FAILED run puts it back to the epoch so a retry is allowed.
// A run that dies without releasing simply holds the lock until the cooldown ends (no stuck state, no manual cleanup).
// Injected `fetchImpl` / `supabaseUrl` / `serviceKey`: nothing here reads the environment or a clock of its own.
export const LOCKS = Object.freeze({ autosync: 'cron_lock_autosync', analytics: 'cron_lock_analytics' });   // never the shared-state key
export const DEFAULT_COOLDOWN_MS = Object.freeze({ autosync: 6 * 3600e3, analytics: 6 * 3600e3 });
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
