// MMM OS v12.3 — Instagram OAuth (Auth + Callback combined)
// GET /api/instagram/auth     → no `code` param → redirect to Instagram consent screen
// GET /api/instagram/callback → `code` param present → exchange tokens, save, redirect home
//
// Uses Instagram Login (not deprecated Basic Display API).
// Requires app type: Business. Scopes: instagram_business_basic

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const IG_AUTH_URL        = 'https://api.instagram.com/oauth/authorize';
const IG_TOKEN_URL       = 'https://api.instagram.com/oauth/access_token';
const IG_LONGTOKEN_URL   = 'https://graph.instagram.com/access_token';
const IG_USER_URL        = 'https://graph.instagram.com/me';
// v15.18.0 — expanded from instagram_business_basic to add publishing + analytics.
// NOTE: requires a Meta Developer App to actually exist first (see handleAuthInit) —
// that app-creation step is an account-owner action outside this agent's reach.
const IG_SCOPES          = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights';
const IG_USER_FIELDS     = 'id,username,account_type,media_count,followers_count,follows_count,profile_picture_url';

const ENGINE_LABELS = { ai_studio: 'AI Studio', nextwave: 'NextWave', srv_farsi: 'SRV Farsi', srv_english: 'SRV English' };

// ── Supabase helper ──────────────────────────────────────────────────────────
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase ${table} upsert failed: ${res.status} ${t}`);
  }
}

// ── Auth initiation ──────────────────────────────────────────────────────────
function handleAuthInit(req, res) {
  const appId      = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI ||
    `https://${req.headers.host}/api/instagram/callback`;

  if (!appId || appId === 'PLACEHOLDER') {
    return res.status(200).json({
      mode: 'unconfigured',
      message: 'Instagram OAuth not yet configured. Add INSTAGRAM_APP_ID to Vercel env vars.',
      requiredEnvVars: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_REDIRECT_URI'],
      scopesRequired: IG_SCOPES,
      setupSteps: [
        '1. Go to developers.facebook.com → My Apps',
        '2. Create app → App type: Business',
        '3. Add product: Instagram → Instagram Login',
        `4. Set redirect URI to: ${redirectUri}`,
        '5. Request permission: instagram_business_basic',
        '6. Add INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET to Vercel env vars',
        '7. Redeploy',
      ],
    });
  }

  const engineKey = (req.query.engine || '').toLowerCase().replace(/[^a-z_]/g, '');
  const stateEngine = ENGINE_LABELS[engineKey] ? engineKey : 'unassigned';

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    scope:         IG_SCOPES,
    response_type: 'code',
    state:         `mmm_instagram_auth:${stateEngine}`,
  });

  console.log('[v12.3] Instagram OAuth redirect initiated');
  return res.redirect(302, `${IG_AUTH_URL}?${params.toString()}`);
}

// ── Token exchange helpers ────────────────────────────────────────────────────
async function exchangeCodeForShortToken(code, redirectUri) {
  const res = await fetch(IG_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
      code,
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const msg = json.error?.message || json.error_message || String(res.status);
    throw new Error(`Instagram token exchange failed: ${msg}`);
  }
  // { access_token, token_type, expires_in, user_id }
  return json;
}

async function exchangeForLongToken(shortToken) {
  const url = `${IG_LONGTOKEN_URL}?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(process.env.INSTAGRAM_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    const msg = json.error?.message || String(res.status);
    throw new Error(`Instagram long-lived token exchange failed: ${msg}`);
  }
  // { access_token, token_type, expires_in }
  return json;
}

async function fetchUserInfo(accessToken) {
  const url = `${IG_USER_URL}?fields=${IG_USER_FIELDS}&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Instagram user info failed: ${json.error?.message || res.status}`);
  }
  return json;
}

// ── Platform Connections registry sync (Phase 1 layer, v15.17.0) ────────────
async function sbPatchOrInsert(table, matchFilter, patch, insertExtra) {
  const getUrl = `${SUPABASE_URL}/rest/v1/${table}?${matchFilter}&limit=1`;
  const getRes = await fetch(getUrl, { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY } });
  const rows = getRes.ok ? await getRes.json() : [];
  if (rows && rows.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchFilter}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    });
  } else if (insertExtra) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...insertExtra, ...patch }),
    });
  }
}

async function syncPlatformConnectionHealthy(engineLabel, platform, opts) {
  const now = new Date().toISOString();
  try {
    await sbPatchOrInsert(
      'platform_connections',
      `engine=eq.${encodeURIComponent(engineLabel)}&platform=eq.${encodeURIComponent(platform)}`,
      {
        account_identity: opts.accountIdentity,
        connection_status: opts.healthy ? 'HEALTHY' : 'DEGRADED',
        auth_status: opts.healthy ? 'authorized' : 'partial',
        required_scopes: opts.scopes,
        token_health: opts.healthy ? 'healthy' : 'degraded',
        token_expiry: opts.tokenExpiry || null,
        publishing_capability: !!opts.publishingCapability,
        analytics_capability: !!opts.analyticsCapability,
        last_sync: now,
        last_error: opts.lastError || null,
        ceo_authorization_required: false,
        action_needed: opts.healthy ? null : (opts.lastError || 'Verify manually'),
        source_table: 'instagram_connections',
        source_ref: opts.sourceRef || null,
        notes: opts.notes || null,
        updated_at: now,
      }
    );
    await sbPatchOrInsert(
      'brain_health_checks',
      `engine=eq.${encodeURIComponent(engineLabel)}&component=eq.${encodeURIComponent(platform + '_connection')}`,
      {
        status: opts.healthy ? 'healthy' : 'degraded',
        active_issue: opts.lastError || null,
        recommended_action: opts.healthy ? null : (opts.lastError || null),
        metadata: { platform, connection_status: opts.healthy ? 'HEALTHY' : 'DEGRADED', publishing_capability: !!opts.publishingCapability },
        last_check: now, updated_at: now,
      },
      { engine: engineLabel, component: platform + '_connection', created_at: now }
    );
  } catch (e) {
    console.warn('[v15.18.0] platform_connections sync failed (non-fatal):', e.message);
  }
}

// ── Callback handler ─────────────────────────────────────────────────────────
async function handleCallback(req, res) {
  const { code, state, error } = req.query;
  const appUrl      = process.env.APP_URL || `https://${req.headers.host}`;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${appUrl}/api/instagram/callback`;

  if (error) {
    console.error('[v12.3] Instagram OAuth error:', error);
    return res.redirect(302, `${appUrl}/?ig_error=${encodeURIComponent(error)}`);
  }

  const stateParts = String(state || '').split(':');
  if (stateParts[0] !== 'mmm_instagram_auth') {
    console.error('[v12.3] Instagram OAuth state mismatch');
    return res.redirect(302, `${appUrl}/?ig_error=state_mismatch`);
  }
  const engineKey   = stateParts[1] || 'unassigned';
  const engineLabel = ENGINE_LABELS[engineKey] || null;

  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId || appId === 'PLACEHOLDER') {
    return res.redirect(302, `${appUrl}/?ig_connected=mock&username=Instagram+Test+Account&tab=integrations`);
  }

  try {
    console.log('[v15.18.0] Exchanging Instagram auth code... engine:', engineKey);
    const shortToken = await exchangeCodeForShortToken(code, redirectUri);
    const userId = String(shortToken.user_id);

    console.log('[v15.18.0] Exchanging for long-lived token...');
    const longToken = await exchangeForLongToken(shortToken.access_token);
    const accessToken = longToken.access_token;
    const tokenExpiry = new Date(Date.now() + (longToken.expires_in || 5183944) * 1000).toISOString();

    // Save connection immediately — user_id is enough, user info is best-effort
    await sbUpsert('instagram_connections', {
      user_id:          userId,
      mmm_engine:       engineLabel,
      access_token:     accessToken,
      token_expires_at: tokenExpiry,
      scope:            IG_SCOPES,
      connected_at:     new Date().toISOString(),
      last_sync:        new Date().toISOString(),
      status:           'connected',
    }, 'user_id');
    console.log('[v15.18.0] Instagram connection saved ✓ user_id:', userId, 'engine:', engineLabel);

    // Fetch user info — non-fatal
    let username = userId;
    let followerCount = 0;
    let accountType = '';
    let identityVerified = false;
    try {
      console.log('[v15.18.0] Fetching Instagram user info — user_id:', userId);
      const user = await fetchUserInfo(accessToken);
      username      = user.username      || userId;
      followerCount = user.followers_count || 0;
      accountType   = user.account_type || '';
      identityVerified = true;
      await sbUpsert('instagram_accounts', {
        user_id:             userId,
        username:            user.username            || '',
        account_type:        user.account_type        || '',
        follower_count:      user.followers_count     || 0,
        following_count:     user.follows_count       || 0,
        media_count:         user.media_count         || 0,
        profile_picture_url: user.profile_picture_url || '',
        updated_at:          new Date().toISOString(),
      }, 'user_id');
      console.log('[v15.18.0] Instagram user info saved ✓', username);
    } catch (e) {
      console.warn('[v15.18.0] fetchUserInfo failed (non-fatal):', e.message);
      try {
        await sbUpsert('instagram_accounts', {
          user_id: userId, username: '', account_type: '',
          follower_count: 0, following_count: 0, media_count: 0,
          profile_picture_url: '', updated_at: new Date().toISOString(),
        }, 'user_id');
      } catch (e2) {}
    }

    // Publishing + analytics on Instagram's Graph API require a professional
    // (Business or Creator) account — this is a platform prerequisite, not
    // something MMMOS can grant. We verify it from the real account_type rather
    // than assuming the requested scopes were honored.
    const isProfessional = accountType === 'BUSINESS' || accountType === 'MEDIA_CREATOR' || accountType === 'CREATOR';
    const publishingCapability = isProfessional && IG_SCOPES.includes('instagram_business_content_publish');
    const analyticsCapability  = isProfessional && IG_SCOPES.includes('instagram_business_manage_insights');

    try {
      await sbUpsert('instagram_sync_logs', {
        user_id:   userId,
        status:    'success',
        message:   `Connected: ${username} (engine: ${engineLabel || 'unassigned'}, account_type: ${accountType || 'unknown'})`,
        synced_at: new Date().toISOString(),
      }, null);
    } catch (e) {
      console.error('[v15.18.0] sync_logs save failed (non-fatal):', e.message);
    }

    if (engineLabel) {
      await syncPlatformConnectionHealthy(engineLabel, 'instagram', {
        accountIdentity: `${username} (Instagram, ${accountType || 'unknown type'})`,
        healthy: identityVerified && isProfessional,
        scopes: IG_SCOPES,
        tokenExpiry,
        publishingCapability,
        analyticsCapability,
        sourceRef: userId,
        lastError: isProfessional ? null : 'Account is not a Business/Creator professional account — required for publishing + insights.',
        notes: `Reconnected ${new Date().toISOString()}. Identity verified via /me; publishing/analytics eligibility verified via account_type=${accountType || 'unknown'}.`,
      });
    }

    console.log('[v15.18.0] Instagram OAuth complete ✓', username);
    return res.redirect(302,
      `${appUrl}/?ig_connected=true&username=${encodeURIComponent(username)}&followers=${followerCount}&userId=${encodeURIComponent(userId)}&tab=integrations`
    );

  } catch (err) {
    console.error('[v12.3] Instagram callback error:', err.message);
    try {
      await sbUpsert('instagram_sync_logs', {
        user_id: 'unknown', status: 'error', message: err.message,
        synced_at: new Date().toISOString(),
      }, null);
    } catch (e2) {}
    return res.redirect(302, `${appUrl}/?ig_error=${encodeURIComponent(err.message)}`);
  }
}

// ── Combined entry point ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Auth initiation: no code param → redirect to Instagram
  if (!req.query.code && !req.query.error) return handleAuthInit(req, res);

  // Callback: code (or error) param present → finish OAuth flow
  return handleCallback(req, res);
}
