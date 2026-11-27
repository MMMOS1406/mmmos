// SRV Studio business policy (CEO, effective 2026-11-23): Female artist, Emotional Deep House, LONG VIDEOS ONLY, no new Shorts.
// ONE source of truth for "may a Short be produced?": the same production configuration row the upload gate already reads (app_settings.srv_studio_v2_production, parsed by srv2ParseProductionConfig).
// A Short is allowed only when that configuration explicitly lists "short" in `formats`. An unreadable or missing configuration means Long-only (fails closed to the policy).
// Historical Short packages and videos are never touched: this only refuses NEW Short generation / creation.
import { srv2ParseProductionConfig } from './srvStudioV2Pilot.mjs';
export const STUDIO_LONG_ONLY_MESSAGE = 'SRV Studio is Long-only (CEO policy): new Shorts are not produced. Create a Long song instead; existing Shorts are unchanged.';
export const SETTINGS_KEY = 'srv_studio_v2_production';
export const isStudioEngine = (e) => e === 'SRV English' || e === 'srv_english';
export function isShortRequest(b) {
  const x = b && typeof b === 'object' ? b : {}; const f = String(x.contentFormat || '').toLowerCase(), t = String(x.contentType || '').toLowerCase();
  if (f) return f === 'short'; return /short/.test(t) || x.isShortVideo === true;   // an explicit format wins; the free-text type is only used when no format is given
}
export function shortsAllowed(raw) {
  try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; const p = srv2ParseProductionConfig(v); return !!(p && p.config && Array.isArray(p.config.formats) && p.config.formats.includes('short')); } catch (_) { return false; }
}
// -> { allow: true } | { allow: false, status: 409, error: 'production_long_only', message }
export async function studioShortGate({ engine, body, fetchImpl, supabaseUrl, serviceKey }) {
  if (!isStudioEngine(engine) || !isShortRequest(body)) return { allow: true };
  let raw = null;
  try { const r = await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?key=eq.${SETTINGS_KEY}&select=value&limit=1`, { headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } }); if (r && r.ok) { const rows = await r.json(); raw = Array.isArray(rows) && rows[0] ? rows[0].value : null; } } catch (_) { raw = null; }
  return shortsAllowed(raw) ? { allow: true } : { allow: false, status: 409, error: 'production_long_only', message: STUDIO_LONG_ONLY_MESSAGE };
}
