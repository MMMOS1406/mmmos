// Scheduled-operations authentication (G1 / S-A).
// PURE: no network, no database, no clock, no environment reads (the caller passes everything in).
//
// Two mechanisms already exist in this project and are reused here — nothing new is created:
//  1. Vercel's own cron credential: when an environment variable named CRON_SECRET exists, Vercel sends it as `Authorization: Bearer <value>` on the scheduled call.
//     This is the ONLY thing a Vercel cron can send (the cron entry in vercel.json has no custom headers).
//  2. The derived internal-hop signature already used by the growth hook (`x-mmm-cron`): sha256 of a scope-labelled string that contains the service key.
//     The cron entry point (autosync) attaches it when it calls the project's own endpoints, so those endpoints can refuse everyone else.
//
// Entry-point policy (cronEntryDecision):
//   CRON_SECRET configured     → the bearer must match (timing-safe); anything else is refused 401.
//   CRON_SECRET NOT configured → TRANSITIONAL: the call is allowed exactly as before, but the caller MUST still win the single-flight lock (lib/cronLock.mjs), so an
//                                anonymous caller can trigger at most one run per cooldown window.
//                                When CRON_FAIL_CLOSED_WHEN_UNCONFIGURED is true (a one-line change to ship ONLY after the CEO has configured CRON_SECRET and one
//                                scheduled run has been verified) a production deployment without the secret refuses with 503 instead — so deleting the variable can
//                                never silently reopen the entry point.
import { createHash, timingSafeEqual } from 'node:crypto';

export const CRON_FAIL_CLOSED_WHEN_UNCONFIGURED = false;
export const CRON_SCOPES = Object.freeze(['analytics_auto_run', 'sync']);   // internal hops the cron entry point calls: the analytics pipeline, and the per-channel / per-account sync endpoints
export const SIGNATURE_HEADER = 'x-mmm-cron';

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
export const cronSignatureInput = (scope, serviceKey) => 'g1_cron:' + String(scope) + ':' + String(serviceKey || '');
// What the cron entry point sends. Throws on an unknown scope or an empty key so a wiring mistake is loud, never an empty signature.
export function cronSignature(scope, serviceKey) {
  if (!CRON_SCOPES.includes(scope)) throw new Error('unknown_cron_scope');
  if (!serviceKey) throw new Error('service_key_missing');
  return sha256hex(cronSignatureInput(scope, serviceKey));
}
const headerValue = (headers, name) => {
  if (!headers || typeof headers !== 'object') return '';
  for (const k of Object.keys(headers)) if (k.toLowerCase() === name) { const v = headers[k]; return typeof v === 'string' ? v : ''; }   // an array / repeated header is not a valid credential
  return '';
};
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };

// Fails closed: unknown scope, empty key, missing / repeated / wrong-length header all return false.
export function verifyCronSignature(headers, scope, serviceKey) {
  if (!CRON_SCOPES.includes(scope) || !serviceKey) return false;
  const got = headerValue(headers, SIGNATURE_HEADER);
  return got.length === 64 && safeEqual(got, cronSignature(scope, serviceKey));
}
// `Authorization: Bearer <CRON_SECRET>`; false when the secret is empty.
export function bearerOk(headers, cronSecret) {
  if (typeof cronSecret !== 'string' || !cronSecret) return false;
  return safeEqual(headerValue(headers, 'authorization'), 'Bearer ' + cronSecret);
}
// The cron entry-point decision. `env` = { CRON_SECRET, VERCEL_ENV }.
export function cronEntryDecision({ env = {}, headers = {}, failClosed = CRON_FAIL_CLOSED_WHEN_UNCONFIGURED } = {}) {
  const secret = typeof env.CRON_SECRET === 'string' ? env.CRON_SECRET : '';
  if (secret) return bearerOk(headers, secret) ? { allow: true, mode: 'bearer' } : { allow: false, status: 401, error: 'unauthorized' };
  if (failClosed && env.VERCEL_ENV === 'production') return { allow: false, status: 503, error: 'cron_secret_not_configured' };
  return { allow: true, mode: 'transitional', warn: 'CRON_SECRET is not configured: the entry point is protected only by the single-flight lock' };
}
