// MMM OS v12.1 — Auto Sync Scheduler
// GET /api/youtube/autosync
// Vercel Cron: runs daily at 00:00 UTC
// Loads all connected channels, syncs each one, retries once on failure,
// logs every result to youtube_sync_logs.

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
    headers: { 'Content-Type': 'application/json' },
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
  const connections = await sbGet('tiktok_connections?status=eq.connected&select=open_id&limit=20');
  if (!connections || !connections.length) {
    console.log('[v16.7.0] No connected TikTok accounts — done');
    return { message: 'No accounts connected', total: 0, succeeded: 0, failed: 0, results: [] };
  }
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
          headers: { 'Content-Type': 'application/json' },
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

  // Vercel injects CRON_SECRET and sends it as Bearer token on scheduled runs.
  // If the secret is set, enforce it — allows safe manual POST triggers without the header
  // only when CRON_SECRET is absent (dev/staging).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const startedAt = new Date().toISOString();
  console.log('[v12.1] Auto sync starting —', startedAt);

  const connections = await sbGet('youtube_connections?status=eq.connected&select=channel_id&limit=20');
  if (!connections || !connections.length) {
    console.log('[v12.1] No connected channels — done');
    return res.status(200).json({ message: 'No channels connected', synced: [] });
  }

  console.log('[v12.1] Channels to sync:', connections.map(c => c.channel_id).join(', '));

  const results = [];

  for (const conn of connections) {
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
    const aRes = await fetch(`${appUrl}/api/ops?action=analytics_auto_run`);
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

  return res.status(200).json({
    startedAt,
    completedAt: new Date().toISOString(),
    total: results.length,
    succeeded,
    failed,
    results,
    analyticsAuto,
    tiktokAuto,
  });
}
