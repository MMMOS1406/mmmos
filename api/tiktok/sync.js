// MMM OS v12.3 — TikTok Sync Engine
// POST /api/tiktok/sync { openId }
// Fetches latest account stats + recent videos, saves to Supabase
// READ-ONLY — no write operations to TikTok

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TT_TOKEN_URL  = 'https://open.tiktokapis.com/v2/oauth/token/';
const TT_USER_URL   = 'https://open.tiktokapis.com/v2/user/info/';
const TT_VIDEO_URL  = 'https://open.tiktokapis.com/v2/video/list/';
const USER_FIELDS   = 'open_id,union_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count';
const VIDEO_FIELDS  = 'id,create_time,cover_image_url,share_url,title,video_description,duration,like_count,comment_count,share_count,view_count';

// ── Supabase helpers ──
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) throw new Error(`Supabase GET failed: ${res.status}`);
  return res.json();
}

async function sbUpsert(table, data, onConflict) {
  const url = onConflict
    ? `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    : `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase upsert failed: ${t}`); }
}

// PATCH updates only the supplied columns on an existing row — safe for partial updates
// where the table has NOT NULL columns we don't want to overwrite.
async function sbPatch(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase patch failed: ${t}`); }
}

// ── Status helpers (merged from tiktok/status.js) ────────────────────────────

async function sbGetSafe(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function getVideoSummary(openId) {
  const videos = await sbGetSafe(
    `tiktok_videos?open_id=eq.${encodeURIComponent(openId)}&select=*&order=published_at.desc&limit=20`
  );
  if (!videos?.length) return { lastUploadDate: null, uploadsThisWeek: 0, recentVideos: [] };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const uploadsThisWeek = videos.filter(v => v.published_at && v.published_at >= sevenDaysAgo).length;
  const recentVideos = videos.slice(0, 5).map(v => ({
    videoId:     v.video_id,
    title:       v.title,
    publishedAt: v.published_at,
    coverUrl:    v.cover_url || '',
    viewCount:   v.view_count  || 0,
    likeCount:   v.like_count  || 0,
    shareCount:  v.share_count || 0,
    duration:    v.duration    || null,
  }));

  return { lastUploadDate: videos[0]?.published_at || null, uploadsThisWeek, recentVideos };
}

async function handleStatus(req, res) {
  if (!process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY === 'PLACEHOLDER') {
    return res.status(200).json({
      mode: 'unconfigured',
      configured: false,
      connected: false,
      message: 'TikTok credentials not yet configured',
      requiredEnvVars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'],
    });
  }

  try {
    const connections = await sbGetSafe(
      'tiktok_connections?status=eq.connected&select=open_id,last_sync,connected_at,status,token_expires_at,mmm_engine&limit=5'
    );
    if (!connections?.length) {
      return res.status(200).json({ configured: true, connected: false, accounts: [] });
    }

    const accounts = [];
    for (const conn of connections) {
      const acctData = await sbGetSafe(`tiktok_accounts?open_id=eq.${encodeURIComponent(conn.open_id)}&select=*&limit=1`);
      const acct = acctData?.[0];
      if (!acct) continue;

      const videoSummary = await getVideoSummary(conn.open_id);
      const now = Date.now();
      const expiresAt = new Date(conn.token_expires_at);
      const msLeft = expiresAt - now;

      accounts.push({
        openId:         conn.open_id,
        engine:         conn.mmm_engine || null,
        displayName:    acct.display_name    || '',
        avatarUrl:      acct.avatar_url      || '',
        followerCount:  acct.follower_count  || 0,
        followingCount: acct.following_count || 0,
        likesCount:     acct.likes_count     || 0,
        videoCount:     acct.video_count     || 0,
        lastSync:       conn.last_sync,
        connectedAt:    conn.connected_at,
        status:         conn.status,
        tokenExpiresAt: conn.token_expires_at,
        tokenExpired:   msLeft < 0,
        tokenExpiresInMinutes: Math.round(msLeft / 60000),
        lastUploadDate:  videoSummary.lastUploadDate,
        uploadsThisWeek: videoSummary.uploadsThisWeek,
        recentVideos:    videoSummary.recentVideos,
      });
    }

    const syncLogs = await sbGetSafe(
      'tiktok_sync_logs?order=synced_at.desc&limit=10&select=open_id,status,message,synced_at'
    ) || [];

    return res.status(200).json({ configured: true, connected: true, accounts, syncLogs });
  } catch (err) {
    console.error('[v12.4] TikTok status error:', err.message);
    return res.status(500).json({ error: 'status_check_failed', message: err.message });
  }
}

// ── Token refresh ──
async function refreshAccessToken(refreshToken) {
  const res = await fetch(TT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  const json = await res.json();
  // TikTok token endpoint returns tokens at top level (no data wrapper)
  if (!res.ok || (json.error && json.error.code !== 'ok')) {
    throw new Error(`TOKEN_REFRESH_FAILED: ${json.error?.message || res.status}`);
  }
  return json;
}

// ── TikTok API calls (READ-ONLY) ──
function parseTikTokError(json, httpStatus) {
  const code = json?.error?.code;
  const msg  = json?.error?.message || String(httpStatus);
  // Check specific error codes FIRST — TikTok returns 401 for scope errors too
  if (code === 'scope_not_authorized') {
    return new Error('SCOPE_NOT_AUTHORIZED: Add your TikTok account as a Sandbox Target User at developers.tiktok.com → your app → Sandbox → Target Users');
  }
  if (httpStatus === 401 || code === 'access_token_invalid' || code === 'access_token_expired') {
    return new Error('TOKEN_EXPIRED');
  }
  return new Error(msg || 'TIKTOK_API_ERROR');
}

async function ttGet(url, accessToken, fields) {
  const fullUrl = fields ? `${url}?fields=${encodeURIComponent(fields)}` : url;
  const res = await fetch(fullUrl, {
    headers: { 'Authorization': 'Bearer ' + accessToken },
  });
  const json = await res.json();
  console.log('[v12.3] ttGet', url, 'status:', res.status, 'error:', json?.error?.code || 'none');
  if (!res.ok || (json.error?.code && json.error.code !== 'ok')) {
    throw parseTikTokError(json, res.status);
  }
  return json;
}

async function ttPost(url, accessToken, fields, body = {}) {
  const fullUrl = fields ? `${url}?fields=${encodeURIComponent(fields)}` : url;
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log('[v12.3] ttPost', url, 'status:', res.status, 'error:', json?.error?.code || 'none');
  if (!res.ok || (json.error?.code && json.error.code !== 'ok')) {
    throw parseTikTokError(json, res.status);
  }
  return json;
}

async function fetchAccountInfo(accessToken) {
  const json = await ttGet(TT_USER_URL, accessToken, USER_FIELDS);
  return json.data.user;
}

async function fetchRecentVideos(accessToken, maxCount = 20) {
  const json = await ttPost(TT_VIDEO_URL, accessToken, VIDEO_FIELDS, { max_count: maxCount });
  return json.data?.videos || [];
}

function mockSyncResponse(openId) {
  return {
    mode: 'mock',
    openId: openId || 'mock_open_id',
    account: { displayName: 'MMM TikTok Test', followerCount: 842, videoCount: 12, likesCount: 4400 },
    videos: [
      { videoId: 'ttmock1', title: 'Test Short 1', publishedAt: '2026-05-20T10:00:00Z', viewCount: 1200 },
      { videoId: 'ttmock2', title: 'Test Short 2', publishedAt: '2026-05-15T10:00:00Z', viewCount: 880 },
    ],
    syncedAt: new Date().toISOString(),
    message: 'Mock sync — add TIKTOK_CLIENT_KEY to enable live data',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return handleStatus(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { openId } = req.body || {};

  if (!process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY === 'PLACEHOLDER') {
    console.log('[v12.3] TikTok sync in mock mode');
    return res.status(200).json(mockSyncResponse(openId));
  }

  if (!openId) return res.status(400).json({ error: 'openId required' });

  try {
    // 1. Load connection
    const connections = await sbGet(`tiktok_connections?open_id=eq.${encodeURIComponent(openId)}&select=*`);
    if (!connections?.length) return res.status(404).json({ error: 'Account not connected', openId });
    let conn = connections[0];

    // 2. Proactively refresh token if within 5 minutes of expiry
    let accessToken = conn.access_token;
    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at) : null;
    const msUntilExpiry = expiresAt ? expiresAt - Date.now() : Infinity;
    console.log('[v12.3] Token expires in', Math.round(msUntilExpiry / 1000), 'seconds');

    if (msUntilExpiry < 300000 && conn.refresh_token) {
      console.log('[v12.3] Refreshing TikTok access token (expires soon)...');
      const refreshed = await refreshAccessToken(conn.refresh_token);
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + (refreshed.expires_in || 86400) * 1000).toISOString();
      const newRefreshExpiry = refreshed.refresh_expires_in
        ? new Date(Date.now() + refreshed.refresh_expires_in * 1000).toISOString()
        : conn.refresh_expires_at;
      await sbPatch('tiktok_connections', `open_id=eq.${encodeURIComponent(openId)}`, {
        access_token:       accessToken,
        token_expires_at:   newExpiry,
        refresh_expires_at: newRefreshExpiry,
      });
      console.log('[v12.3] TikTok token refreshed ✓');
    } else if (expiresAt && msUntilExpiry < 0) {
      // Token truly expired AND no refresh token — fail clearly
      return res.status(401).json({ error: 'token_expired', message: 'TikTok token expired. Please reconnect your TikTok account.' });
    }

    // 3. v16.7.0 — CEO Decision (Final Analytics Consolidation): this step used to
    // unconditionally SKIP the real TikTok API calls with a hardcoded "scope not approved
    // in sandbox" assumption — that's why tiktok_videos stayed empty and account stats never
    // refreshed even after real analytics scope was granted. Fix: check the ACTUAL granted
    // scope on this connection (refreshed above if needed) and only fall back to cached data
    // if TikTok itself rejects the call — never guess.
    const grantedScope = conn.scope || '';
    const hasStatsScope = grantedScope.includes('user.info.stats');
    const hasVideoListScope = grantedScope.includes('video.list');
    let acct = null;
    let syncedVideos = [];
    let statsError = null;

    if (hasStatsScope) {
      try {
        const user = await fetchAccountInfo(accessToken);
        acct = {
          display_name:    user.display_name    || '',
          avatar_url:      user.avatar_url      || '',
          follower_count:  user.follower_count  || 0,
          following_count: user.following_count || 0,
          likes_count:     user.likes_count     || 0,
          video_count:     user.video_count     || 0,
        };
        await sbUpsert('tiktok_accounts', {
          open_id: openId, ...acct, updated_at: new Date().toISOString(),
        }, 'open_id');
      } catch (e) {
        statsError = e.message;
        console.warn('[v16.7.0] fetchAccountInfo failed — falling back to cached account data:', e.message);
      }
    }
    if (hasVideoListScope && !statsError) {
      try {
        const videos = await fetchRecentVideos(accessToken, 20);
        if (videos.length) {
          const rows = videos.map(v => ({
            video_id:     v.id,
            open_id:      openId,
            title:        v.title || '',
            description:  v.video_description || '',
            cover_url:     v.cover_image_url || '',
            share_url:    v.share_url || '',
            published_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
            duration:     v.duration || null,
            view_count:   v.view_count    || 0,
            like_count:   v.like_count    || 0,
            comment_count:v.comment_count || 0,
            share_count:  v.share_count   || 0,
            synced_at:    new Date().toISOString(),
          }));
          await sbUpsert('tiktok_videos', rows, 'video_id');
          syncedVideos = videos;
        }
      } catch (e) {
        statsError = statsError || e.message;
        console.warn('[v16.7.0] fetchRecentVideos failed — recent videos not refreshed:', e.message);
      }
    }

    // Fall back to last-known cached account row if the live pull didn't happen or failed
    if (!acct) {
      const storedAcct = await sbGet(`tiktok_accounts?open_id=eq.${encodeURIComponent(openId)}&select=*&limit=1`);
      acct = storedAcct?.[0] || {};
    }

    // 4. Update last_sync — PATCH to avoid touching NOT NULL columns (access_token etc.)
    await sbPatch('tiktok_connections', `open_id=eq.${encodeURIComponent(openId)}`, {
      last_sync: new Date().toISOString(),
      status:    'connected',
    });

    // 5. Log outcome — be honest about what actually happened, not a blanket "success"
    const capabilityNote = !hasStatsScope
      ? 'Stats unavailable — connected without user.info.stats scope. Reconnect to grant analytics access.'
      : statsError
        ? `Live stats pull failed (${statsError}) — showing last-known cached data.`
        : `Live stats synced — ${syncedVideos.length} video(s) refreshed.`;
    await sbUpsert('tiktok_sync_logs', {
      open_id:   openId,
      status:    (hasStatsScope && !statsError) ? 'success' : 'partial',
      message:   `Connected as ${acct.display_name || openId}. ${capabilityNote}`,
      synced_at: new Date().toISOString(),
    }, null);

    const account = {
      openId,
      displayName:    acct.display_name    || '',
      avatarUrl:      acct.avatar_url      || '',
      followerCount:  acct.follower_count  || 0,
      followingCount: acct.following_count || 0,
      likesCount:     acct.likes_count     || 0,
      videoCount:     acct.video_count     || 0,
    };

    console.log('[v16.7.0] TikTok sync complete ✓', openId, '| statsScope:', hasStatsScope, '| videos synced:', syncedVideos.length, '| statsError:', statsError||'none');
    return res.status(200).json({
      success: true, account, videos: syncedVideos, syncedAt: new Date().toISOString(),
      analyticsCapability: hasStatsScope, statsError,
    });

  } catch (err) {
    console.error('[v12.3] TikTok sync error:', err.message);
    const isTokenExpired = err.message === 'TOKEN_EXPIRED';
    const isScopeError = err.message.startsWith('SCOPE_NOT_AUTHORIZED');
    const errorType = isTokenExpired ? 'token_expired' : isScopeError ? 'scope_not_authorized' : 'sync_error';
    try {
      await sbUpsert('tiktok_sync_logs', {
        open_id:   openId || 'unknown',
        status:    'error',
        message:   err.message,
        synced_at: new Date().toISOString(),
      }, null);
    } catch (e2) {}
    return res.status(isTokenExpired ? 401 : 500).json({ error: errorType, message: err.message });
  }
}
