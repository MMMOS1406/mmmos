// MMM OS v12.1 — Auto Sync Scheduler
// GET /api/youtube/autosync
// Vercel Cron: runs daily at 00:00 UTC
// Loads all connected channels, syncs each one, retries once on failure,
// logs every result to youtube_sync_logs.

import { createHash } from 'node:crypto';
import { cronSignatureInput } from '../../lib/growthCollect.mjs'; // Growth system: signature for the scheduled collection hook (no new credential)
import { loadDisabled, filterEnabled } from '../../lib/channelSyncControl.mjs'; // per-channel sync switch (default: nothing disabled = unchanged behaviour)
import { cronEntryDecision, cronSignature } from '../../lib/cronAuth.mjs'; // G1/S-A — entry-point policy (fail closed) + the derived signature for the internal hops (no new credential)
import { ceoSessionOk, tokenFromRequest } from '../../lib/ceoSession.mjs'; // G1/S-A — manual recovery run by a signed-in CEO
import { acquire as lockAcquire, release as lockRelease, captureOutcome, runSucceeded } from '../../lib/cronLock.mjs'; // G1/S-B — database-backed single-flight + short duplicate-fire cooldown

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function sbLog(channelId, status, message) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_sync_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ channel_id: channelId, status, message, synced_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('[v12.1] autosync log write failed:', e.message);
  }
}

async function syncChannel(channelId, appUrl) {
  const res = await fetch(`${appUrl}/api/youtube/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mmm-cron': cronSignature('sync', SUPABASE_SERVICE_KEY) },   // G1/S-A: the sync endpoint now refuses callers without this
    body: JSON.stringify({ channelId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

// v16.7.0 — CEO Decision (Final Analytics Consolidation §6/§8): one canonical TikTok
// sync process for ALL connected TikTok accounts, run on the SAME controlled schedule as
// YouTube. Deliberately implemented INLINE here rather than as its own api/tiktok/autosync.js
// file — Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and this project
// was already at that limit, so a 13th file broke the build (exceeded_serverless_functions_
// per_deployment). Reuses the existing /api/tiktok/sync endpoint per account — no new
// function, no new cron entry — while keeping YouTube and TikTok sync logically independent:
// this whole block is wrapped in try/catch by the caller so a TikTok failure can never break
// or block the YouTube sync that already completed above, and each account retries/logs
// independently so one failed account never blocks another.
async function syncAllTikTokAccounts(appUrl) {
  const allConnections = await sbGet('tiktok_connections?status=eq.connected&select=open_id,mmm_engine&limit=20');
  if (!allConnections || !allConnections.length) {
    console.log('[v16.7.0] No connected TikTok accounts — done');
    return { message: 'No accounts connected', total: 0, succeeded: 0, failed: 0, results: [] };
  }
  const disabledTt = await loadDisabled(sbGet);   // per-account switch (retired businesses only; retained engines can never be skipped)
  const connections = filterEnabled(allConnections, disabledTt.tiktok, 'open_id');
  if (connections.length !== allConnections.length) console.log('[sync-control] skipping disabled TikTok account(s):', allConnections.filter(c => !connections.includes(c)).map(c => c.open_id).join(', '));
  console.log('[v16.7.0] TikTok accounts to sync:', connections.map(c => c.open_id).join(', '));
  const results = [];
  for (const conn of connections) {
    const openId = conn.open_id;
    let success = false;
    let lastError = null;
    let attempts = 0;
    while (attempts < 2 && !success) {
      attempts++;
      try {
        if (attempts > 1) {
          console.log('[v16.7.0] Retry', openId, '— waiting 5s');
          await sleep(5000);
        }
        const res = await fetch(`${appUrl}/api/tiktok/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mmm-cron': cronSignature('sync', SUPABASE_SERVICE_KEY) },   // G1/S-A
          body: JSON.stringify({ openId }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || data.error || `HTTP ${res.status}`);
        success = true;
        console.log(`[v16.7.0] ✓ ${openId} (attempt ${attempts})`);
      } catch (e) {
        lastError = e.message;
        console.error(`[v16.7.0] ✗ ${openId} attempt ${attempts}:`, e.message);
      }
    }
    results.push({ openId, success, attempts, error: lastError || null });
    // sync.js already writes its own tiktok_sync_logs row on success/failure reaching it;
    // this extra log only covers the case where BOTH attempts failed before ever reaching
    // sync.js's own logging (e.g. a network error calling the endpoint itself).
    if (!success) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/tiktok_sync_logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ open_id: openId, status: 'error', message: `Auto sync failed after ${attempts} attempt(s): ${lastError}`, synced_at: new Date().toISOString() }),
        });
      } catch (e2) {}
    }
  }
  const succeeded = results.filter(r => r.success).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // G1/S-A — entry-point policy (lib/cronAuth.mjs), FAIL CLOSED:
  //   CRON_SECRET configured     → Vercel's scheduled call carries it as a Bearer token; a CEO session may also start a manual recovery run; everyone else gets 401.
  //   CRON_SECRET not configured → on any Vercel deployment only a CEO session is accepted, everyone else gets 503. (Local development / tests, where VERCEL_ENV is absent, are allowed.)
  // Authentication ALWAYS happens before the lock: an unauthorized request can never touch the lock, so it can never delay or starve the scheduled run.
  const lockCfg = { fetchImpl: fetch, supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY };
  let decision = cronEntryDecision({ env: process.env, headers: req.headers, ceoOk: false });
  if (!decision.allow && tokenFromRequest(req)) decision = cronEntryDecision({ env: process.env, headers: req.headers, ceoOk: await ceoSessionOk(req, lockCfg) });
  if (!decision.allow) return res.status(decision.status).json({ error: decision.error === 'unauthorized' ? 'Unauthorized' : decision.error });
  if (decision.mode === 'local') console.warn('[cron-auth] CRON_SECRET not configured; accepted only because this is not a Vercel deployment');

  // G1/S-B — single-flight + short cooldown (duplicate-fire protection for authenticated callers). Of N simultaneous callers exactly one runs.
  // FAIL CLOSED: if the lock cannot be taken because of an infrastructure error the run does NOT start (503). A CEO session may force a run (never overlapping one < 2 minutes old).
  const force = decision.mode === 'ceo' && String((req.query && req.query.force) || '') === 'true';
  const lock = await lockAcquire({ name: 'autosync', force, ...lockCfg });
  if (!lock.ok) return lock.reason === 'lock_unavailable' ? res.status(503).json({ error: 'lock_unavailable' }) : res.status(429).json({ skipped: true, reason: lock.reason, retryAfterMs: lock.retryAfterMs || null });
  // The lock follows the REAL outcome of the run (the response it sent), not merely "no exception": a run that answers 5xx, or in which a channel failed, frees the lock so a retry is possible.
  const cap = captureOutcome(res); let threw = true;
  try { await runAutosync(req, cap.res); threw = false; } finally { await lockRelease({ lock, success: !threw && runSucceeded('autosync', cap.outcome()), ...lockCfg }); }
}

async function runAutosync(req, res) {

  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const startedAt = new Date().toISOString();
  console.log('[v12.1] Auto sync starting —', startedAt);

  const connections = await sbGet('youtube_connections?status=eq.connected&select=channel_id&limit=20');
  if (!connections || !connections.length) {
    console.log('[v12.1] No connected channels — done');
    return res.status(200).json({ message: 'No channels connected', synced: [] });
  }

  // Per-channel switch: a retired business's channel can be listed in app_settings.sync_disabled_channels and is then skipped here. Retained engines can never be skipped.
  const disabled = await loadDisabled(sbGet);
  let toSync = connections;
  if (disabled.youtube.size) {
    const engMap = {}; ((await sbGet('youtube_channels?select=channel_id,mmm_engine')) || []).forEach(c => { engMap[c.channel_id] = c.mmm_engine; });
    toSync = filterEnabled(connections, disabled.youtube, 'channel_id', engMap);
    const skipped = connections.filter(c => !toSync.includes(c)).map(c => c.channel_id);
    if (skipped.length) console.log('[sync-control] skipping disabled channel(s):', skipped.join(', '));
  }
  console.log('[v12.1] Channels to sync:', toSync.map(c => c.channel_id).join(', '));

  const results = [];

  for (const conn of toSync) {
    const channelId = conn.channel_id;
    let success = false;
    let lastError = null;
    let attempts = 0;

    while (attempts < 2 && !success) {
      attempts++;
      try {
        if (attempts > 1) {
          console.log('[v12.1] Retry', channelId, '— waiting 5s');
          await sleep(5000);
        }
        await syncChannel(channelId, appUrl);
        success = true;
        console.log(`[v12.1] ✓ ${channelId} (attempt ${attempts})`);
      } catch (e) {
        lastError = e.message;
        console.error(`[v12.1] ✗ ${channelId} attempt ${attempts}:`, e.message);
      }
    }

    results.push({ channelId, success, attempts, error: lastError || null });

    await sbLog(
      channelId,
      success ? 'success' : 'error',
      success
        ? `Auto sync OK${attempts > 1 ? ` (recovered on attempt ${attempts})` : ''}`
        : `Auto sync failed after ${attempts} attempt(s): ${lastError}`
    );
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.length - succeeded;
  console.log(`[v12.1] Auto sync done — ${succeeded}/${results.length} succeeded`);

  // v13.62.0 A1 — chain into analytics_auto_run after channel sync completes.
  // Pull → Foundation → Decision → Apply → Strategy. Operator never clicks.
  let analyticsAuto = null;
  try {
    const aRes = await fetch(`${appUrl}/api/ops?action=analytics_auto_run`, { headers: { 'x-mmm-cron': cronSignature('analytics_auto_run', SUPABASE_SERVICE_KEY) } });   // G1/S-A
    analyticsAuto = await aRes.json();
    console.log('[A1] analytics_auto_run:', analyticsAuto && analyticsAuto.status);
  } catch (e) {
    console.error('[A1] analytics_auto_run failed:', e.message);
    analyticsAuto = { ok: false, error: e.message };
  }

  // v16.7.0 — run the TikTok auto-sync inline on this SAME daily cron trigger (see
  // syncAllTikTokAccounts() above for why this isn't a separate file/function).
  let tiktokAuto = null;
  try {
    tiktokAuto = await syncAllTikTokAccounts(appUrl);
    console.log('[v16.7.0] tiktok autosync:', tiktokAuto && `${tiktokAuto.succeeded}/${tiktokAuto.total}`);
  } catch (e) {
    console.error('[v16.7.0] tiktok autosync failed:', e.message);
    tiktokAuto = { ok: false, error: e.message };
  }

  // Growth system — scheduled analytics collection (LAST, so it can never delay the syncs above). It does NOTHING unless app_settings.growth_collect has
  // schedule:true for a business (default: absent => every business is skipped, zero Google requests). The action verifies this signature itself.
  let growthAuto = null;
  try {
    const sig = createHash('sha256').update(cronSignatureInput(SUPABASE_SERVICE_KEY)).digest('hex');
    const gRes = await fetch(`${appUrl}/api/ops?action=growth_collect_scheduled`, { headers: { 'x-mmm-cron': sig }, signal: AbortSignal.timeout(150000) });
    growthAuto = await gRes.json();
    console.log('[growth] scheduled collection:', JSON.stringify((growthAuto && growthAuto.results || []).map(r => r.business + ':' + (r.skipped || (r.ok ? 'ok' : 'failed')))));
  } catch (e) {
    console.error('[growth] scheduled collection call failed:', e.message);
    growthAuto = { ok: false, error: e.message };
  }

  return res.status(200).json({
    startedAt,
    completedAt: new Date().toISOString(),
    total: results.length,
    succeeded,
    failed,
    results,
    analyticsAuto,
    tiktokAuto,
    growthAuto,
  });
}
