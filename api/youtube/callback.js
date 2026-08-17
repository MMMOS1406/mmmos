// MMM OS v12.3 — YouTube OAuth (Auth + Callback combined)
// GET /api/youtube/auth     → no `code`/`error` → redirect to Google consent screen
// GET /api/youtube/callback → `code` or `error` present → finish OAuth flow
//
// Both vercel.json rewrites point here to stay within the 12-function Hobby limit.
//
// Strategy: mine=true returns whichever brand account was selected at OAuth
// (Silk Road Voices). The other 3 channels are fetched by exact handle using
// the forHandle parameter — cannot return wrong results unlike name search.

// v13.54.0 — Sprint 3: upgraded from youtube.readonly to youtube.upload so MMM can
// auto-upload finished MP4s.
// v13.57.9 — added yt-analytics.readonly for retention/CTR/watch-time data. Operator
// must disconnect + reconnect once after this scope upgrade lands to grant the new
// permission on Google's consent screen.
const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ══════════════════════════════════════════════════════════════════════════
// CANONICAL ROUTING TABLE — CEO-verified 2026-08-04, approved as system architecture
// in the v16.25.0 review. One Google account owns four YouTube Brand Accounts —
// each Brand Account is its own distinct identity for OAuth, tokens, and channel
// resolution. Do not assume 1 Google account = 1 YouTube channel anywhere in the
// integration layer (auth, callback, sync, status, reconnect, diagnostics, DWE
// recommendations, channel matching). Always route by Brand Account.
//
//   Google account:  silkroadvoices@gmail.com
//
//   Brand Account          → MMM Engine        → BRAND_HANDLES entry
//   ─────────────────────────────────────────────────────────────────
//   Silk Road Voices        → SRV Farsi         → SilkRoadVoices
//   InsidePlaces AI          → SRV English       → SRVStudioMusic
//   InsideObjects AI         → AI Studio         → AICreation-tool
//   InsideFoods AI           → NextWave Systems  → NextWaveSys
//
// This mapping is the single source of truth — reference it here rather than
// relying on memory in future engineering work on this integration.
// ══════════════════════════════════════════════════════════════════════════

// Exact handles for all 4 brand accounts — forHandle is an exact match, not a search
// Note: @ prefix is stripped before passing to the API parameter (encoding @→%40 breaks some API versions)
const BRAND_HANDLES = [
  'SilkRoadVoices',
  'SRVStudioMusic',
  'NextWaveSys',
  'AICreation-tool',
];

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
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase ${table} upsert failed: ${res.status} ${t}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function exchangeCodeForTokens(code, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }
  return res.json();
}

function parseChannel(ch) {
  return {
    channelId: ch.id,
    title: ch.snippet?.title || '',
    description: ch.snippet?.description || '',
    avatarUrl: ch.snippet?.thumbnails?.default?.url || '',
    subscribers: parseInt(ch.statistics?.subscriberCount || 0),
    totalViews: parseInt(ch.statistics?.viewCount || 0),
    totalVideos: parseInt(ch.statistics?.videoCount || 0),
  };
}

async function ytGet(url, accessToken) {
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + accessToken },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchAllChannels(accessToken) {
  const channels = [];
  const foundIds = new Set();

  // Fetch all 4 channels by exact handle — no mine=true, no name search
  // @ is stripped: encodeURIComponent('@') → '%40' breaks some YouTube API versions
  for (const handle of BRAND_HANDLES) {
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${handle}`;
      console.log('[v12.0] forHandle lookup:', handle, '→', apiUrl);
      const data = await ytGet(apiUrl, accessToken);
      console.log('[v12.0] forHandle raw response items:', data.items?.length ?? 0, 'for handle:', handle);
      const ch = data.items?.[0];
      if (!ch) {
        console.warn('[v12.0] forHandle returned no channel for:', handle, '— full response:', JSON.stringify(data));
        continue;
      }
      if (foundIds.has(ch.id)) {
        console.warn('[v12.0] Duplicate channel ID skipped:', ch.id, handle);
        continue;
      }
      foundIds.add(ch.id);
      const parsed = parseChannel(ch);
      channels.push(parsed);
      console.log(`[v12.0] SAVED: @${handle} → id=${ch.id} title="${ch.snippet?.title}" subs=${ch.statistics?.subscriberCount} videos=${ch.statistics?.videoCount}`);
    } catch (e) {
      console.error('[v12.0] forHandle FAILED for', handle, '— error:', e.message);
    }
  }

  if (!channels.length) throw new Error('No channels found for this account');
  console.log('[v12.0] Total channels to save:', channels.length, channels.map(c => `${c.title}(${c.channelId})`).join(', '));
  return channels;
}

// ── Auth initiation ─────────────────────────────────────────────────────────
function handleYTAuthInit(req, res) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI ||
    `https://${req.headers.host}/api/youtube/callback`;

  if (!clientId || clientId === 'PLACEHOLDER') {
    return res.status(200).json({
      mode: 'unconfigured',
      message: 'YouTube OAuth not yet configured. Add YOUTUBE_CLIENT_ID to Vercel env vars.',
      requiredEnvVars: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI'],
      scopesRequired: YT_SCOPES,
      setupSteps: [
        '1. Go to console.cloud.google.com',
        '2. Create project → Enable YouTube Data API v3',
        '3. Create OAuth 2.0 credentials (Web Application)',
        `4. Set redirect URI to: ${redirectUri}`,
        '5. Add YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET to Vercel env vars',
        '6. Redeploy',
      ],
    });
  }

  // v13.54.1 — force re-consent + account picker every time. Without 'select_account',
  // Google can silently re-grant prior scopes (e.g. only youtube.readonly when we
  // now request youtube.upload). include_granted_scopes=false prevents Google from
  // skipping new scopes that overlap with old ones.
  // v13.56.0 — per-channel target. Accepted as ?channel_target=<title> query param;
  // encoded into OAuth state so the callback knows WHICH brand channel was authorized.
  const channelTarget = (req.query && req.query.channel_target) || '';
  const state = channelTarget
    ? 'mmm_youtube_auth__' + Buffer.from(channelTarget).toString('base64url')
    : 'mmm_youtube_auth';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YT_SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'false',
    state: state,
  });

  console.log('[v13.56.0] YouTube OAuth redirect initiated · channel_target:', channelTarget || '(legacy/all)');
  return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

// ── Callback handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Auth initiation: no code/error → redirect to Google
  if (!req.query.code && !req.query.error) return handleYTAuthInit(req, res);

  const { code, state, error } = req.query;
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || `${appUrl}/api/youtube/callback`;

  if (error) {
    console.error('[v12.0] YouTube OAuth error:', error);
    return res.redirect(302, `${appUrl}/?yt_error=${encodeURIComponent(error)}`);
  }

  // v13.56.0 — state encodes per-channel target: 'mmm_youtube_auth' OR 'mmm_youtube_auth__<base64>'
  let channelTarget = '';
  if (state && state.startsWith('mmm_youtube_auth__')) {
    try { channelTarget = Buffer.from(state.replace('mmm_youtube_auth__', ''), 'base64url').toString('utf-8'); } catch(_) {}
  } else if (state !== 'mmm_youtube_auth') {
    console.error('[v13.56.0] OAuth state mismatch · state:', state);
    return res.redirect(302, `${appUrl}/?yt_error=state_mismatch`);
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId || clientId === 'PLACEHOLDER' || !code) {
    console.log('[v12.0] Callback in mock mode — no real credentials');
    return res.redirect(302, `${appUrl}/?yt_connected=mock&channel=MMM+Test+Channel`);
  }

  try {
    // 1. Exchange code for tokens
    console.log('[v13.56.0] Exchanging auth code for tokens... · target:', channelTarget || '(legacy/all)');
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    console.log('[v13.56.0] Tokens received ✓ scope:', tokens.scope);

    // v13.56.0 — find the ACTUAL channel this token writes to (via /channels?mine=true).
    // This is the authoritative source of truth — whichever brand account the user picked
    // on Google's consent screen becomes the "mine" for this token.
    let actualChannel = null;
    try {
      const mineData = await ytGet('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', tokens.access_token);
      if (mineData.items && mineData.items[0]) actualChannel = parseChannel(mineData.items[0]);
    } catch (e) {
      console.warn('[v13.56.0] mine=true lookup failed:', e.message);
    }

    // 2. Fetch all 4 brand account channels (for metadata/display — unchanged)
    console.log('[v13.56.0] Resolving all brand account channels for metadata...');
    const channels = await fetchAllChannels(tokens.access_token);

    const tokenExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    // v13.56.0 — Per-channel token storage. Save the refresh_token ONLY to the row
    // matching the channel this token actually writes to. The other 3 channels keep
    // their existing tokens (or remain unconnected for write).
    const targetChannel = actualChannel || channels.find(c => {
      if (!channelTarget) return false;
      const t = (c.title || '').toLowerCase().replace(/[^a-z0-9]/g,'');
      const want = channelTarget.toLowerCase().replace(/[^a-z0-9]/g,'');
      return t === want || t.includes(want) || want.includes(t);
    });

    if (targetChannel && targetChannel.channelId) {
      // Update ONLY this specific channel's row with the new write-scope token
      await sbUpsert('youtube_connections', {
        channel_id: targetChannel.channelId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_expires_at: tokenExpiry,
        scope: tokens.scope || '',
        connected_at: new Date().toISOString(),
        last_sync: new Date().toISOString(),
        status: 'connected',
      });
      console.log('[v13.56.0] PER-CHANNEL token saved to:', targetChannel.title, '(', targetChannel.channelId, ')');
    } else {
      // Legacy fallback (channel_target not specified): write to all rows like before
      for (const channel of channels) {
        await sbUpsert('youtube_connections', {
          channel_id: channel.channelId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokenExpiry,
          scope: tokens.scope || '',
          connected_at: new Date().toISOString(),
          last_sync: new Date().toISOString(),
          status: 'connected',
        });
      }
      console.log('[v13.56.0] LEGACY mode — same token saved to all 4 channels');
    }

    // 4. Save channel metadata (non-fatal per channel)
    for (const channel of channels) {
      try {
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
      } catch (e) {
        console.error('[v12.0] youtube_channels save failed for', channel.title, '(non-fatal):', e.message);
      }
    }

    // 5. Log (non-fatal, append-only — no on_conflict)
    try {
      await sbUpsert('youtube_sync_logs', {
        channel_id: channels[0].channelId,
        status: 'success',
        message: `Connected ${channels.length} channel(s): ${channels.map(c => c.title).join(', ')}`,
        synced_at: new Date().toISOString(),
      }, null);
    } catch (e) {
      console.error('[v12.0] youtube_sync_logs save failed (non-fatal):', e.message);
    }

    console.log('[v12.0] YouTube connection complete ✓', channels.length, 'channels');
    return res.redirect(302,
      `${appUrl}/?yt_connected=true&channel=${encodeURIComponent(channels[0].title)}&subs=${channels[0].subscribers}&channelCount=${channels.length}`
    );

  } catch (err) {
    console.error('[v12.0] YouTube callback error:', err.message);
    try {
      await sbUpsert('youtube_sync_logs', {
        channel_id: 'unknown',
        status: 'error',
        message: err.message,
        synced_at: new Date().toISOString(),
      }, null);
    } catch(e2) {}
    return res.redirect(302, `${appUrl}/?yt_error=${encodeURIComponent(err.message)}`);
  }
}
