// S-G — one gate for endpoints that start work or write rows: the Vercel cron bearer (CRON_SECRET) or a signed-in CEO session. Fails closed.
// Same decision function as the daily sync entry point (lib/cronAuth.mjs), so there is exactly one policy:
//   CRON_SECRET set          → bearer matches (scheduler) or CEO session, else 401
//   no secret, on Vercel     → CEO session only, else 503 (never silently open)
//   no secret, not on Vercel → local development / tests only
import { cronEntryDecision } from './cronAuth.mjs';
import { ceoSessionOk, tokenFromRequest } from './ceoSession.mjs';
export async function mutatingGate(req, { env = process.env, fetchImpl = globalThis.fetch, supabaseUrl, serviceKey } = {}) {
  let d = cronEntryDecision({ env, headers: req.headers || {}, ceoOk: false });
  if (!d.allow && tokenFromRequest(req)) d = cronEntryDecision({ env, headers: req.headers || {}, ceoOk: await ceoSessionOk(req, { fetchImpl, supabaseUrl, serviceKey }) });
  return d;   // { allow, mode } or { allow:false, status, error }
}
