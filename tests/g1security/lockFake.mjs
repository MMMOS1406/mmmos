// A faithful in-memory model of the lock rows (app_settings key cron_lock_*) for tests that build their own fetch stub: the same PostgREST requests lib/cronLock.mjs sends
// (insert-if-absent, one conditional PATCH, read-back, release-by-token). One conditional update runs without interleaving, as in PostgreSQL. SYNTHETIC; nothing is written anywhere.
const rows = {};
const j = (b, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
export const lockRows = rows;
export function lockFetch(url, init = {}) {
  const u = String(url), method = init.method || 'GET'; if (!/\/rest\/v1\/app_settings/.test(u)) return null;
  const body = init.body ? JSON.parse(init.body) : null; const key = (/[?&]key=eq\.([^&]+)/.exec(u) || [])[1];
  if (method === 'POST' && body && [].concat(body).every((r) => /^cron_lock_/.test(r.key || ''))) { for (const r of [].concat(body)) if (!rows[r.key]) rows[r.key] = { value: r.value, updated_at: Date.parse(r.updated_at) }; return j([]); }
  if (!key || !/^cron_lock_/.test(key)) return null; const row = rows[key];
  if (method === 'GET') return j(row ? [{ value: row.value, updated_at: new Date(row.updated_at).toISOString() }] : []);
  if (method === 'PATCH') { if (!row) return j([]);
    const lt = /updated_at=lt\.([^&]+)/.exec(u); if (lt && !(row.updated_at < Date.parse(decodeURIComponent(lt[1])))) return j([]);
    const like = /value=like\.\*([^*&]+)\*/.exec(u); if (like && !String(row.value).includes(decodeURIComponent(like[1]))) return j([]);
    if (body.value !== undefined) row.value = body.value; if (body.updated_at !== undefined) row.updated_at = Date.parse(body.updated_at);
    return j(/return=representation/.test((init.headers || {}).Prefer || '') ? [{ key, value: row.value, updated_at: new Date(row.updated_at).toISOString() }] : []); }
  return null;
}
