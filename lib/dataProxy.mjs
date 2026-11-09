// CEO-017B — least-privilege policy for the authenticated data proxy (the replacement for the browser talking to the database with the public key).
// Pure function: (role, method, path, body) -> allow/deny with a reason. No I/O, no secrets. Roles come ONLY from a verified server session.
export const ROLES = ['ceo', 'operator', 'family'];
export const BUSINESS_ENGINES = ['SRV Farsi', 'SRV English', 'NextWave', 'NextWave Systems'];   // 'NextWave Systems' is the display alias the app also uses; stored values today are only the first three              // the three retained businesses; '' = legacy drafts with no engine tag
export const MAX_BODY_BYTES = 3_500_000;                                              // the hosting platform refuses request bodies above 4.5 MB

const CEO_ONLY_READ = new Set(['brain_departments', 'brain_people', 'brain_documents', 'brain_expansion_ideas', 'brain_knowledge', 'brain_experiments', 'brain_decisions', 'engineering_roadmap', 'engineering_brain', 'department_work_items']);
const OPERATOR_READ = new Set(['packages', 'youtube_channels', 'youtube_videos', 'youtube_videos_analytics', 'channel_strategy', 'optimization_rules']);   // what the VA's factory and publishing screens read
const FAMILY_READ = new Set(['packages', 'youtube_channels', 'youtube_videos', 'youtube_videos_analytics']);                                            // read-only business overview
// Read before anyone signs in: on/off switches the page needs at load time. Values are switches, not secrets.
export const PUBLIC_FLAG_KEYS = new Set(['srv_studio_v2_enabled', 'srv_studio_v2_mix']);
export const STATE_KEY = 'mmm_finance_v118';                                           // the shared state document (the only app_settings row a browser may write)
const OPERATOR_KEY_PREFIXES = ['srv_studio_v2_', 'nextwave_v2_', 'nwv2r_', 'srv_farsi_creative_v2'];
const OPERATOR_KEYS = new Set([STATE_KEY, 'mmm_packages_backup', 'mmm_cdp_overrides']);
const FAMILY_KEYS = new Set([STATE_KEY]);
const PREFER_OK = /^(return=(minimal|representation|headers-only)|resolution=(merge-duplicates|ignore-duplicates)|count=(exact|planned|estimated)|,|\s)+$/;

const deny = (status, reason) => ({ allow: false, status, reason });
const ok = (extra = {}) => ({ allow: true, ...extra });

/** Keys named by a `key=eq.x` / `key=in.(a,b)` filter; null when the query does not pin the key down. */
export function keysFromQuery(params) {
  const v = params.get('key'); if (!v) return null;
  if (v.startsWith('eq.')) return [decodeURIComponent(v.slice(3))];
  const m = /^in\.\((.*)\)$/.exec(v); if (m) return m[1].split(',').map((x) => x.replace(/^"|"$/g, ''));
  return null;
}
const keyReadable = (role, key) => !key.startsWith('ceo_') && (role === 'ceo' || (role === 'operator' && (OPERATOR_KEYS.has(key) || OPERATOR_KEY_PREFIXES.some((p) => key.startsWith(p)))) || (role === 'family' && FAMILY_KEYS.has(key)));

export function decide({ role, method, path, body, bodyBytes = 0, prefer = '' }) {
  const anonymous = !ROLES.includes(role);
  if (typeof path !== 'string' || path.length > 2000) return deny(400, 'bad_path');
  const m = /^(rpc\/)?([a-z][a-z0-9_]*)(\?(.*))?$/.exec(path); if (!m) return deny(400, 'bad_path');
  const isRpc = !!m[1], name = m[2]; let params; try { params = new URLSearchParams(m[4] || ''); } catch { return deny(400, 'bad_query'); }
  if (!['GET', 'HEAD', 'POST', 'PATCH'].includes(method)) return deny(405, 'method_not_allowed');
  if (prefer && !PREFER_OK.test(prefer)) return deny(400, 'bad_prefer');
  if (bodyBytes > MAX_BODY_BYTES) return deny(413, 'too_large');
  const sel = params.get('select') || '';
  if (sel.includes('(') && role !== 'ceo') return deny(403, 'embedding_not_allowed');            // no joining into tables the role may not read
  if (params.has('apikey')) return deny(400, 'bad_query');

  if (anonymous) {                                                                                // no session: only the public on/off switches, read-only
    if (isRpc || name !== 'app_settings' || (method !== 'GET' && method !== 'HEAD')) return deny(401, 'no_session');
    const keys = keysFromQuery(params);
    return keys && keys.length && keys.every((k) => PUBLIC_FLAG_KEYS.has(k)) ? ok() : deny(401, 'no_session');
  }
  if (method === 'GET' || method === 'HEAD') {
    if (isRpc) return deny(403, 'rpc_read_not_allowed');
    if (name === 'app_settings') {
      const keys = keysFromQuery(params); if (!keys || !keys.length || keys.length > 20) return deny(403, 'key_filter_required');
      return keys.every((k) => keyReadable(role, k)) ? ok() : deny(403, 'key_not_allowed');
    }
    if (CEO_ONLY_READ.has(name)) return role === 'ceo' ? ok() : deny(403, 'read_not_allowed');
    if (OPERATOR_READ.has(name) && (role === 'ceo' || role === 'operator' || (role === 'family' && FAMILY_READ.has(name)))) return ok();
    return deny(403, 'table_not_allowed');
  }
  /* writes: only the two things the app really writes, and never for Family */
  if (role === 'family') return deny(403, 'read_only_role');
  let json = null; if (body !== undefined && body !== null && body !== '') { try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return deny(400, 'bad_json'); } }
  if (isRpc) {
    if (name !== 'mmm_state_save' || method !== 'POST') return deny(403, 'rpc_not_allowed');
    return json && json.p_key === STATE_KEY ? ok() : deny(403, 'state_key_not_allowed');
  }
  if (name === 'app_settings') {                                                                  // legacy whole-row state write (older client path) — same single key
    if (method !== 'POST') return deny(403, 'method_not_allowed');
    const rows = Array.isArray(json) ? json : [json];
    return rows.length && rows.every((r) => r && r.key === STATE_KEY) ? ok() : deny(403, 'state_key_not_allowed');
  }
  if (name === 'packages') {
    if (method !== 'POST') return deny(403, 'method_not_allowed');                                // the app never PATCHes or deletes packages from the browser
    if (params.get('on_conflict') !== 'package_id') return deny(403, 'upsert_only');
    const rows = Array.isArray(json) ? json : [json];
    if (!rows.length || rows.length > 50) return deny(400, 'bad_rows');
    for (const r of rows) { if (!r || typeof r !== 'object' || typeof r.package_id !== 'string' || !r.package_id) return deny(400, 'bad_row'); const e = r.engine == null ? '' : r.engine; if (e !== '' && !BUSINESS_ENGINES.includes(e)) return deny(403, 'engine_not_allowed'); }
    return ok();
  }
  return deny(403, 'table_not_allowed');
}
