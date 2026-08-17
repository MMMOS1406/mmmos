// MMM OS v12.1 — YouTube Connection Status
// GET /api/youtube/status?channelId=UC...
// Returns connection state, last sync, channel stats, and video analytics

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Cache-Control': 'no-cache',
    }
  });
  if (!res.ok) return null;
  return res.json();
}
async function sbUpsertYT(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_connections?on_conflict=channel_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(data),
  });
  return res.ok;
}

// ══════════════════════════════════════════════════════════════════════════
// v16.25.0 — Integration Health Recovery Ladder (CEO-approved 2026-08-04). Company standard:
//   Health Check -> Autonomous Recovery Attempt -> Recovered (Healthy)
//                                                -> Recovery Failed -> Department Blocked -> CEO Action Required
// Only a genuine Human Action Required outcome is allowed to reach CEO Action Required.
// Recoverable failures (expired access token, retryable API errors, temporary network
// failures, rate limits) are handled entirely inside this function — the caller never sees
// them as a reason to escalate. This is the YouTube implementation of the pattern; the same
// shape (attempt recovery, classify the failure, only escalate on a real credential problem)
// is the standard to reuse for TikTok, Plaid, Robinhood, Instagram, and future integrations —
// not implemented for those here, scope is YouTube only this sprint.
// Brand Account routing: this Google account (silkroadvoices@gmail.com) owns 4 distinct
// YouTube Brand Accounts, each with its own identity for token/channel purposes — see the
// canonical routing table documented in api/youtube/callback.js (CEO-verified 2026-08-04).
// Diagnostics below are already per-channel_id, which is per-Brand-Account, so this file
// requires no changes — noted here only so future work references that table, not memory.
// ══════════════════════════════════════════════════════════════════════════
async function attemptTokenRecovery(refreshToken) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.access_token) {
      return { outcome: 'recovered', access_token: body.access_token, expires_in: body.expires_in || 3600 };
    }
    // Google's OAuth error taxonomy: invalid_grant means the refresh token itself is
    // invalid, expired, or the user revoked consent — no autonomous recovery is possible.
    // This is the only case that legitimately becomes Human Action Required. Everything
    // else (5xx, rate limiting, malformed-but-transient responses) is Recoverable — the
    // attempt just didn't land this time, and the next health check will simply retry.
    if (body.error === 'invalid_grant') {
      return { outcome: 'human_action_required', reason: body.error_description || 'invalid_grant' };
    }
    return { outcome: 'recoverable_retry', reason: body.error || `http_${res.status}` };
  } catch (e) {
    return { outcome: 'recoverable_retry', reason: e.message };
  }
}

async function getVideoAnalytics(channelId) {
  // Fetch recent videos ordered by publish date — select * handles missing columns gracefully
  const videos = await sbGet(
    `youtube_videos?channel_id=eq.${channelId}&select=*&order=published_at.desc&limit=20`
  );
  if (!videos || !videos.length) return { lastUploadDate: null, uploadsThisWeek: 0, recentVideos: [] };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const uploadsThisWeek = videos.filter(v => v.published_at && v.published_at >= sevenDaysAgo).length;

  const recentVideos = videos.slice(0, 5).map(v => ({
    videoId: v.video_id,
    title: v.title,
    publishedAt: v.published_at,
    thumbnailUrl: v.thumbnail_url || '',
    viewCount: v.view_count || null,
    likeCount: v.like_count || null,
  }));

  return {
    lastUploadDate: videos[0]?.published_at || null,
    uploadsThisWeek,
    recentVideos,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Mock mode
  if (!process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID === 'PLACEHOLDER') {
    return res.status(200).json({
      mode: 'mock',
      configured: false,
      connected: false,
      message: 'YouTube credentials not yet configured',
      requiredEnvVars: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI'],
    });
  }

  try {
    const connections = await sbGet('youtube_connections?status=eq.connected&select=channel_id,last_sync,connected_at,status,token_expires_at&limit=10');
    if (!connections || !connections.length) {
      return res.status(200).json({ configured: true, connected: false, channels: [] });
    }

    const channels = [];
    for (const conn of connections) {
      const chData = await sbGet(`youtube_channels?channel_id=eq.${conn.channel_id}&select=*&limit=1`);
      const ch = chData?.[0];
      if (!ch) continue;

      const analytics = await getVideoAnalytics(conn.channel_id);

      // Best video by view count
      const bestVidData = await sbGet(
        `youtube_videos?channel_id=eq.${conn.channel_id}&select=video_id,title,view_count,thumbnail_url&order=view_count.desc&limit=1`
      );
      const bestVideo = bestVidData?.[0] ? {
        videoId: bestVidData[0].video_id,
        title: bestVidData[0].title,
        viewCount: bestVidData[0].view_count ?? null,
        thumbnailUrl: bestVidData[0].thumbnail_url || '',
      } : null;

      channels.push({
        channelId: conn.channel_id,
        title: ch.title,
        avatarUrl: ch.avatar_url,
        subscribers: ch.subscribers,
        totalVideos: ch.total_videos,
        totalViews: ch.total_views,
        lastSync: conn.last_sync,
        connectedAt: conn.connected_at,
        status: conn.status,
        tokenExpiresAt: conn.token_expires_at,
        // v12.1 analytics
        lastUploadDate: analytics.lastUploadDate,
        uploadsThisWeek: analytics.uploadsThisWeek,
        recentVideos: analytics.recentVideos,
        // v12.2 intelligence
        bestVideo,
      });
    }

    // Diagnostics: last 10 sync log entries
    const syncLogs = await sbGet(
      'youtube_sync_logs?order=synced_at.desc&limit=10&select=channel_id,status,message,synced_at'
    ) || [];

    // Token health: expiry info per connection, now with the Recovery Ladder applied — see
    // attemptTokenRecovery() above. isExpired below is the ONLY signal DWE/_ytChannelHealth
    // uses to decide token_reconnect/CEO Action Required, so by the time we return it here it
    // must already reflect a genuinely-failed recovery attempt, never routine access-token
    // staleness.
    const connsFull = await sbGet(
      'youtube_connections?status=eq.connected&select=channel_id,token_expires_at,refresh_token&limit=10'
    ) || [];
    const now = Date.now();
    const tokenHealth = [];
    for (const c of connsFull) {
      const expiresAt = new Date(c.token_expires_at);
      const msLeft = expiresAt - now;
      if (msLeft >= 60000) {
        // Real life left on the access token — healthy, no recovery step needed.
        tokenHealth.push({ channelId: c.channel_id, expiresAt: c.token_expires_at, isExpired: false, expiresInMinutes: Math.round(msLeft / 60000), recovery: null });
        continue;
      }
      if (!c.refresh_token) {
        // No refresh token on file at all — this channel was never fully connected, or the
        // connection record is broken. No autonomous recovery is possible; this is a real
        // Human Action Required case (equivalent to "disconnected account").
        tokenHealth.push({ channelId: c.channel_id, expiresAt: c.token_expires_at, isExpired: true, expiresInMinutes: Math.round(msLeft / 60000), recovery: 'human_action_required', recoveryReason: 'no_refresh_token_on_file' });
        continue;
      }
      const recovery = await attemptTokenRecovery(c.refresh_token);
      if (recovery.outcome === 'recovered') {
        const newExpiry = new Date(Date.now() + recovery.expires_in * 1000).toISOString();
        // Brand-account channels share one refresh_token (same Google app) — recovering one
        // recovers all of them, same as the existing manual-sync refresh path.
        const sharing = await sbGet(`youtube_connections?refresh_token=eq.${encodeURIComponent(c.refresh_token)}&select=channel_id`) || [];
        for (const sc of sharing) {
          await sbUpsertYT({ channel_id: sc.channel_id, access_token: recovery.access_token, token_expires_at: newExpiry });
        }
        tokenHealth.push({ channelId: c.channel_id, expiresAt: newExpiry, isExpired: false, expiresInMinutes: Math.round(recovery.expires_in / 60), recovery: 'recovered' });
      } else if (recovery.outcome === 'human_action_required') {
        tokenHealth.push({ channelId: c.channel_id, expiresAt: c.token_expires_at, isExpired: true, expiresInMinutes: Math.round(msLeft / 60000), recovery: 'human_action_required', recoveryReason: recovery.reason });
      } else {
        // recoverable_retry — the attempt didn't land this time (network/rate-limit/5xx-
        // shaped), but this is not a credential problem. Stays inside the department: never
        // reports isExpired:true, so it can never escalate. The next health check retries.
        tokenHealth.push({ channelId: c.channel_id, expiresAt: c.token_expires_at, isExpired: false, expiresInMinutes: Math.round(msLeft / 60000), recovery: 'retry_pending', recoveryReason: recovery.reason });
      }
    }

    return res.status(200).json({ configured: true, connected: true, channels, syncLogs, tokenHealth });
  } catch (err) {
    console.error('[v12.1] Status check error:', err.message);
    return res.status(500).json({ error: 'status_check_failed', message: err.message });
  }
}
