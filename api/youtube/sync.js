// MMM OS v12.1 — YouTube Sync Engine
// POST /api/youtube/sync { channelId }
// Fetches latest channel stats + recent videos, saves to Supabase
// READ-ONLY — no write operations to YouTube

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase helpers ──
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY }
  });
  if (!res.ok) throw new Error(`Supabase GET failed: ${res.status}`);
  return res.json();
}
async function sbUpsert(table, data, onConflict = 'channel_id') {
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

// ── Token refresh ──
async function refreshAccessToken(refreshToken) {
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
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  return res.json();
}

// ── YouTube API calls (READ-ONLY) ──
async function ytGet(endpoint, accessToken) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}`, {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });
  if (res.status === 401) throw new Error('TOKEN_EXPIRED');
  if (res.status === 403) throw new Error('QUOTA_EXCEEDED');
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  return res.json();
}

async function fetchChannelStats(channelId, accessToken) {
  const data = await ytGet(`channels?part=snippet,statistics&id=${channelId}`, accessToken);
  const ch = data.items?.[0];
  if (!ch) throw new Error('NO_CHANNEL');
  return {
    channelId: ch.id,
    title: ch.snippet?.title || '',
    description: ch.snippet?.description || '',
    avatarUrl: ch.snippet?.thumbnails?.medium?.url || ch.snippet?.thumbnails?.default?.url || '',
    subscribers: parseInt(ch.statistics?.subscriberCount || 0),
    totalViews: parseInt(ch.statistics?.viewCount || 0),
    totalVideos: parseInt(ch.statistics?.videoCount || 0),
  };
}

async function fetchRecentVideos(channelId, accessToken, maxResults = 20) {
  // Get uploads playlist
  const channelData = await ytGet(
    `channels?part=contentDetails&id=${channelId}`,
    accessToken
  );
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) return [];

  // Get recent videos from uploads playlist
  const playlistData = await ytGet(
    `playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}`,
    accessToken
  );
  const items = playlistData.items || [];
  if (!items.length) return [];

  // Batch-fetch per-video statistics
  const videoIds = items.map(i => i.contentDetails?.videoId).filter(Boolean).join(',');
  const statsMap = {};
  if (videoIds) {
    try {
      const statsData = await ytGet(`videos?part=statistics&id=${videoIds}`, accessToken);
      for (const v of (statsData.items || [])) {
        statsMap[v.id] = {
          viewCount: parseInt(v.statistics?.viewCount || 0),
          likeCount: parseInt(v.statistics?.likeCount || 0),
          commentCount: parseInt(v.statistics?.commentCount || 0),
        };
      }
      console.log('[v12.1] Video stats fetched for', Object.keys(statsMap).length, 'videos');
    } catch (e) {
      console.warn('[v12.1] Video stats batch fetch failed (non-fatal):', e.message);
    }
  }

  return items.map(item => {
    const videoId = item.contentDetails?.videoId || '';
    const stats = statsMap[videoId] || {};
    return {
      videoId,
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
      publishedAt: item.snippet?.publishedAt || '',
      channelId: item.snippet?.channelId || channelId,
      viewCount: stats.viewCount || 0,
      likeCount: stats.likeCount || 0,
      commentCount: stats.commentCount || 0,
    };
  });
}

// ── Mock sync response (used when credentials not configured) ──
function mockSyncResponse(channelId) {
  return {
    mode: 'mock',
    channelId,
    channel: {
      channelId: channelId || 'UCmock123',
      title: 'MMM Test Channel',
      subscribers: 1240,
      totalViews: 45000,
      totalVideos: 18,
      avatarUrl: '',
    },
    videos: [
      { videoId: 'mock1', title: 'Test Video 1', publishedAt: '2026-05-20T10:00:00Z', thumbnailUrl: '' },
      { videoId: 'mock2', title: 'Test Video 2', publishedAt: '2026-05-15T10:00:00Z', thumbnailUrl: '' },
    ],
    syncedAt: new Date().toISOString(),
    message: 'Mock sync — add real credentials to enable live data',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { channelId } = req.body || {};

  // Mock mode if no credentials
  if (!process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID === 'PLACEHOLDER') {
    console.log('[v12.0] Sync in mock mode');
    return res.status(200).json(mockSyncResponse(channelId));
  }

  try {
    // 1. Load connection from Supabase
    const connections = await sbGet(`youtube_connections?channel_id=eq.${channelId}&select=*`);
    if (!connections || !connections.length) {
      return res.status(404).json({ error: 'Channel not connected', channelId });
    }
    let conn = connections[0];

    // 2. Refresh token if needed
    let accessToken = conn.access_token;
    const expiresAt = new Date(conn.token_expires_at);
    if (expiresAt < new Date(Date.now() + 60000)) { // refresh if < 1min left
      console.log('[v12.0] Refreshing access token...');
      const refreshed = await refreshAccessToken(conn.refresh_token);
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
      // Update all connections sharing the same refresh_token (all brand account channels)
      const allConns = await sbGet(`youtube_connections?refresh_token=eq.${encodeURIComponent(conn.refresh_token)}&select=channel_id`);
      for (const c of (allConns || [])) {
        await sbUpsert('youtube_connections', {
          channel_id: c.channel_id,
          access_token: accessToken,
          token_expires_at: newExpiry,
        });
      }
      console.log('[v12.0] Token refreshed ✓ — updated', (allConns || []).length, 'connections');
    }

    // 3. Fetch channel stats for the specific channel
    console.log('[v12.0] Fetching channel stats for:', channelId);
    const channel = await fetchChannelStats(channelId, accessToken);

    // 4. Fetch recent videos
    console.log('[v12.0] Fetching recent videos...');
    const videos = await fetchRecentVideos(channelId, accessToken, 20);
    console.log('[v12.0] Videos fetched:', videos.length);

    // 5. Save channel to Supabase
    await sbUpsert('youtube_channels', {
      channel_id: channel.channelId,
      title: channel.title,
      description: channel.description,
      avatar_url: channel.avatarUrl,
      subscribers: channel.subscribers,
      total_views: channel.totalViews,
      total_videos: channel.totalVideos,
      updated_at: new Date().toISOString(),
    });

    // 6. Save videos to Supabase (conflict on video_id)
    for (const video of videos) {
      try {
        await sbUpsert('youtube_videos', {
          video_id: video.videoId,
          channel_id: channelId,
          title: video.title,
          description: video.description,
          thumbnail_url: video.thumbnailUrl,
          published_at: video.publishedAt,
          view_count: video.viewCount,
          like_count: video.likeCount,
          comment_count: video.commentCount,
          linked_package_id: null,
          upload_status: null,
          synced_at: new Date().toISOString(),
        }, 'video_id');
      } catch (e) {
        // Fall back to schema without stats columns (pre-migration)
        if (e.message.includes('column') || e.message.includes('view_count')) {
          await sbUpsert('youtube_videos', {
            video_id: video.videoId,
            channel_id: channelId,
            title: video.title,
            description: video.description,
            thumbnail_url: video.thumbnailUrl,
            published_at: video.publishedAt,
            linked_package_id: null,
            upload_status: null,
            synced_at: new Date().toISOString(),
          }, 'video_id');
        } else {
          throw e;
        }
      }
    }

    // 7. Update last_sync on connection
    await sbUpsert('youtube_connections', {
      channel_id: channelId,
      last_sync: new Date().toISOString(),
      status: 'connected',
    });

    // 8. Log success (append-only)
    await sbUpsert('youtube_sync_logs', {
      channel_id: channelId,
      status: 'success',
      message: `Sync complete — ${channel.subscribers} subs, ${videos.length} videos fetched`,
      synced_at: new Date().toISOString(),
    }, null);

    console.log('[v12.0] Sync complete ✓', channelId);
    return res.status(200).json({
      success: true,
      channel,
      videos,
      syncedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[v12.0] Sync error:', err.message);
    const errorType = err.message === 'TOKEN_EXPIRED' ? 'token_expired'
      : err.message === 'QUOTA_EXCEEDED' ? 'quota_exceeded'
      : err.message === 'NO_CHANNEL' ? 'no_channel'
      : 'sync_error';

    // Log failure
    try {
      await sbUpsert('youtube_sync_logs', {
        channel_id: channelId || 'unknown',
        status: 'error',
        message: err.message,
        synced_at: new Date().toISOString(),
      }, null);
    } catch(e2) {}

    return res.status(500).json({ error: errorType, message: err.message });
  }
}
