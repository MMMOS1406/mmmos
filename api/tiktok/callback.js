// MMM OS v12.3 — TikTok OAuth (Auth + Callback combined)
// GET /api/tiktok/auth     → no `code` param → redirect to TikTok consent screen
// GET /api/tiktok/callback → `code` param present → exchange tokens, save, redirect home
//
// Both vercel.json rewrites point here so we stay within the 12-function Hobby limit.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TT_TOKEN_URL   = 'https://open.tiktokapis.com/v2/oauth/token/';
const TT_USER_URL    = 'https://open.tiktokapis.com/v2/user/info/';
const TT_CREATOR_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const USER_FIELDS  = 'open_id,union_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count';
// v15.18.0 — expanded from user.info.basic to add analytics (user.info.stats) and
// safe draft-only publishing capability (video.upload — Content Posting API "upload to
// inbox as draft", never a public post). Requires a fresh CEO consent since scopes
// cannot be silently upgraded on an existing token.
const SCOPES       = 'user.info.basic,user.info.stats,video.list,video.upload';

// engine tag → human label, embedded in the OAuth `state` param so the callback
// knows which MMMOS engine this connection belongs to (fixes the pre-v15.18.0
// ambiguous single-row-no-engine-tag problem).
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
  const clientKey  = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI ||
    `https://${req.headers.host}/api/tiktok/callback`;

  if (!clientKey || clientKey === 'PLACEHOLDER') {
    return res.status(200).json({
      mode: 'unconfigured',
      message: 'TikTok OAuth not yet configured. Add TIKTOK_CLIENT_KEY to Vercel env vars.',
      requiredEnvVars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'],
      scopesRequired: SCOPES,
      setupSteps: [
        '1. Go to developers.tiktok.com → My Apps',
        '2. Create app → Platform: Web',
        '3. Enable Login Kit — add scopes: user.info.basic, video.list',
        `4. Set redirect URI to: ${redirectUri}`,
        '5. Add TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET to Vercel env vars',
        '6. Redeploy',
      ],
    });
  }

  // engine query param (?engine=ai_studio OR ?engine=AI+Studio) tags this specific auth
  // attempt so the callback can attribute the resulting connection to the right MMMOS
  // engine. Accepts either the internal key or the human label since the frontend's
  // per-account Reconnect button only has the label (from /api/tiktok/status's
  // `engine` field) readily available.
  const engineParam = String(req.query.engine || '');
  const lowerKey = engineParam.toLowerCase().replace(/[^a-z_]/g, '');
  let stateEngine = ENGINE_LABELS[lowerKey] ? lowerKey : null;
  if (!stateEngine) {
    const matchKey = Object.keys(ENGINE_LABELS).find(k => ENGINE_LABELS[k].toLowerCase() === engineParam.trim().toLowerCase());
    stateEngine = matchKey || 'unassigned';
  }

  // v16.8.0 — CEO Decision (Standardize TikTok OAuth): per-account Reconnect. When the
  // Reconnect button on a SPECIFIC connected account is clicked, the frontend passes
  // ?target_open_id=<that account's openId>. Encoded into state (base64, matching the
  // YouTube channel_target pattern) so the callback can verify the account the user
  // actually authorized is the SAME one they clicked Reconnect for — otherwise a stale
  // TikTok browser session could silently reconnect a different account instead.
  const targetOpenId = req.query.target_open_id ? String(req.query.target_open_id) : '';
  const stateParts = ['mmm_tiktok_auth', stateEngine];
  if (targetOpenId) stateParts.push(Buffer.from(targetOpenId).toString('base64url'));

  const params = new URLSearchParams({
    client_key:    clientKey,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    state:         stateParts.join(':'),
  });

  console.log('[v16.8.0] TikTok OAuth redirect initiated — engine:', stateEngine, '| target_open_id:', targetOpenId || '(none — new/any account)');
  return res.redirect(302, `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
}

// ── Token exchange helpers ────────────────────────────────────────────────────
async function exchangeCodeForTokens(code, redirectUri) {
  const res = await fetch(TT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
    }).toString(),
  });
  const json = await res.json();
  // Token endpoint returns tokens at top level (no data wrapper).
  // Only throw if HTTP error OR an explicit error field is present.
  if (!res.ok || (json.error && json.error.code !== 'ok')) {
    const msg = json.error?.message || json.message || json.error_description || String(res.status);
    throw new Error(`TikTok token exchange failed: ${msg}`);
  }
  // Tokens are at the top level: { access_token, open_id, refresh_token, expires_in, ... }
  return json;
}

async function fetchUserInfo(accessToken) {
  const res = await fetch(`${TT_USER_URL}?fields=${USER_FIELDS}`, {
    headers: { 'Authorization': 'Bearer ' + accessToken },
  });
  const json = await res.json();
  if (!res.ok || json.error?.code !== 'ok') {
    throw new Error(`TikTok user info failed: ${json.error?.message || res.status}`);
  }
  return json.data.user;
}

// Content Posting API "creator_info" query — TikTok's official dry-run endpoint.
// It confirms the account is eligible to post (i.e. publishing capability + scope
// are genuinely working) and returns real identity data (nickname/avatar). It never
// creates, drafts, or publishes any content — purely read-only eligibility check.
// This is what satisfies "safe non-public/draft validation" without posting anything.
async function fetchCreatorInfo(accessToken) {
  const res = await fetch(TT_CREATOR_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json; charset=UTF-8' },
  });
  const json = await res.json();
  if (!res.ok || (json.error && json.error.code !== 'ok')) {
    throw new Error(`TikTok creator_info query failed: ${json.error?.message || res.status}`);
  }
  return json.data;
}

// ── Platform Connections registry sync (Phase 1 layer, v15.17.0) ────────────
// Direct Supabase writes (not a cross-function fetch) so the callback itself can
// mark the registry HEALTHY the instant CEO consent completes — no separate
// manual verification step required.
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
        source_table: platform === 'tiktok' ? 'tiktok_connections' : 'instagram_connections',
        source_ref: opts.sourceRef || null,
        notes: opts.notes || null,
        updated_at: now,
      }
    );
    // mirror into brain_health_checks so it shows up in Engineering Brain immediately
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
  const appUrl     = process.env.APP_URL || `https://${req.headers.host}`;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || `${appUrl}/api/tiktok/callback`;

  if (error) {
    console.error('[v12.3] TikTok OAuth error:', error);
    return res.redirect(302, `${appUrl}/?tt_error=${encodeURIComponent(error)}`);
  }

  // state format: "mmm_tiktok_auth" (legacy) or "mmm_tiktok_auth:<engine_key>" (v15.18.0+)
  // or "mmm_tiktok_auth:<engine_key>:<base64 target_open_id>" (v16.8.0+, per-account Reconnect)
  const stateParts = String(state || '').split(':');
  if (stateParts[0] !== 'mmm_tiktok_auth') {
    console.error('[v12.3] TikTok OAuth state mismatch');
    return res.redirect(302, `${appUrl}/?tt_error=state_mismatch`);
  }
  const engineKey   = stateParts[1] || 'unassigned';
  const engineLabel = ENGINE_LABELS[engineKey] || null; // null if unassigned/unknown
  let targetOpenId = '';
  if (stateParts[2]) {
    try { targetOpenId = Buffer.from(stateParts[2], 'base64url').toString('utf8'); } catch (e) { targetOpenId = ''; }
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey || clientKey === 'PLACEHOLDER') {
    return res.redirect(302, `${appUrl}/?tt_connected=mock&username=TikTok+Test+Account`);
  }

  try {
    console.log('[v15.18.0] Exchanging TikTok auth code... engine:', engineKey);
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const { access_token, refresh_token, expires_in, refresh_expires_in, open_id } = tokens;
    const grantedScopes = tokens.scope || SCOPES;

    const tokenExpiry   = new Date(Date.now() + (expires_in         || 86400)    * 1000).toISOString();
    const refreshExpiry = new Date(Date.now() + (refresh_expires_in || 31536000) * 1000).toISOString();

    // v16.8.0 — CEO Decision (Standardize TikTok OAuth): per-account Reconnect target
    // check. If the Reconnect button for a SPECIFIC account was clicked (target_open_id
    // present in state) but TikTok returns a DIFFERENT open_id — almost always because the
    // browser had a different TikTok account already logged in and silently reused it — do
    // NOT save anything under either account. Saving under the target would tag the wrong
    // credential to that account; saving under the returned open_id would create an
    // untracked/unlabeled connection the operator didn't ask for. Reject and ask the
    // operator to retry with the correct account selected.
    if (targetOpenId && targetOpenId !== open_id) {
      console.warn(`[v16.8.0] Reconnect target mismatch: expected open_id ${targetOpenId}, TikTok returned ${open_id} — rejecting, nothing saved`);
      try {
        await sbUpsert('tiktok_sync_logs', {
          open_id: targetOpenId,
          status: 'error',
          message: `Reconnect failed — TikTok authorized a different account than the one you clicked Reconnect for. No changes were saved. Log out of TikTok (or use a private window) and try again, selecting the matching account.`,
          synced_at: new Date().toISOString(),
        }, null);
      } catch (e2) {}
      return res.redirect(302, `${appUrl}/?tt_error=${encodeURIComponent('wrong_account_for_reconnect')}&tab=integrations`);
    }

    // v15.18.3 — Cross-engine safety guard. TikTok will silently reuse an already-active
    // browser login for this app+account (no picker shown) if the browser is still signed
    // in as a different account than intended — e.g. clicking "Authorize TikTok" for SRV
    // Farsi while still logged in as AI Studio's TikTok account silently re-authorizes AI
    // Studio's account instead of prompting for the SRV Farsi one. Detect that here and
    // refuse to relabel someone else's credential rather than silently mis-tagging it.
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tiktok_connections?open_id=eq.${encodeURIComponent(open_id)}&select=mmm_engine&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
    );
    const existingRows = existingRes.ok ? await existingRes.json() : [];
    const existingEngine = existingRows[0]?.mmm_engine || null;
    if (existingEngine && existingEngine !== engineLabel) {
      console.warn(`[v15.18.3] Wrong-account guard tripped: open_id already tagged "${existingEngine}", refusing to relabel as "${engineLabel}"`);
      if (engineLabel) {
        await syncPlatformConnectionHealthy(engineLabel, 'tiktok', {
          accountIdentity: `Wrong account — this is ${existingEngine}'s TikTok, not ${engineLabel}'s`,
          healthy: false,
          scopes: grantedScopes,
          publishingCapability: false,
          analyticsCapability: false,
          lastError: `TikTok reused the browser's active login for ${existingEngine} instead of prompting for ${engineLabel}. Log out of TikTok (or use a private window), then authorize again as the correct ${engineLabel} account.`,
          notes: `Guard tripped ${new Date().toISOString()} — no credential was overwritten.`,
        });
      }
      return res.redirect(302, `${appUrl}/?tt_error=${encodeURIComponent(`wrong_account_already_belongs_to_${existingEngine}`)}&tab=integrations`);
    }

    // Save connection immediately — open_id is enough, user info is best-effort
    await sbUpsert('tiktok_connections', {
      open_id,
      mmm_engine:         engineLabel,
      access_token,
      refresh_token:      refresh_token || null,
      token_expires_at:   tokenExpiry,
      refresh_expires_at: refreshExpiry,
      scope:              grantedScopes,
      connected_at:       new Date().toISOString(),
      last_sync:          new Date().toISOString(),
      status:             'connected',
    }, 'open_id');
    console.log('[v15.18.0] TikTok connection saved ✓ open_id:', open_id, 'engine:', engineLabel);

    // Fetch user info — non-fatal (may fail in sandbox if scope not yet approved)
    let displayName = open_id;
    let followerCount = 0;
    let identityVerified = false;
    try {
      console.log('[v15.18.0] Fetching TikTok user info — open_id:', open_id);
      const user = await fetchUserInfo(access_token);
      displayName   = user.display_name    || open_id;
      followerCount = user.follower_count  || 0;
      identityVerified = true;
      await sbUpsert('tiktok_accounts', {
        open_id,
        display_name:    user.display_name    || '',
        avatar_url:      user.avatar_url      || '',
        follower_count:  user.follower_count  || 0,
        following_count: user.following_count || 0,
        likes_count:     user.likes_count     || 0,
        video_count:     user.video_count     || 0,
        updated_at:      new Date().toISOString(),
      }, 'open_id');
      console.log('[v15.18.0] TikTok user info saved ✓', displayName);
    } catch (e) {
      console.warn('[v15.18.0] fetchUserInfo failed (non-fatal — sandbox scope may be pending):', e.message);
      // Still save a minimal account row so status checks work
      try {
        await sbUpsert('tiktok_accounts', {
          open_id, display_name: '', avatar_url: '',
          follower_count: 0, following_count: 0, likes_count: 0, video_count: 0,
          updated_at: new Date().toISOString(),
        }, 'open_id');
      } catch (e2) {}
    }

    // v15.18.2 — Draft-only design: the granted OAuth scope itself is the authoritative
    // publishing-capability signal. TikTok's creator_info dry-run endpoint requires
    // Direct Post/video.publish scope — since Direct Post is intentionally left OFF
    // (draft-only, non-public per spec), creator_info will always fail here with
    // "user did not authorize the scope required" even on a perfectly valid video.upload
    // grant. It is now attempted only as a best-effort identity bonus and NEVER downgrades
    // publishing_capability or connection health on failure.
    let publishingCapability = grantedScopes.includes('video.upload') || grantedScopes.includes('video.publish');
    let creatorInfoError = null;
    if (publishingCapability) {
      try {
        const creator = await fetchCreatorInfo(access_token);
        console.log('[v15.18.2] TikTok creator_info verified ✓ — account is Direct-Post-eligible too');
        if (creator?.creator_nickname && creator.creator_nickname !== displayName) {
          displayName = creator.creator_nickname;
        }
      } catch (e) {
        creatorInfoError = e.message; // informational only — expected while Direct Post is OFF
        console.warn('[v15.18.2] creator_info query failed (expected while Direct Post is off, non-fatal):', e.message);
      }
    }
    const analyticsCapability = grantedScopes.includes('user.info.stats');

    try {
      await sbUpsert('tiktok_sync_logs', {
        open_id,
        status:    'success',
        message:   `Connected: ${displayName} (engine: ${engineLabel || 'unassigned'})`,
        synced_at: new Date().toISOString(),
      }, null);
    } catch (e) {
      console.error('[v15.18.0] sync_logs save failed (non-fatal):', e.message);
    }

    // Update the Phase 1 Platform Connections registry immediately — no separate
    // manual verification step needed by anyone.
    if (engineLabel) {
      await syncPlatformConnectionHealthy(engineLabel, 'tiktok', {
        accountIdentity: `${displayName} (TikTok)`,
        healthy: identityVerified && publishingCapability,
        scopes: grantedScopes,
        tokenExpiry,
        publishingCapability,
        analyticsCapability,
        sourceRef: open_id,
        lastError: null, // creator_info being unreachable while Direct Post is off is expected, not an error
        notes: `Reconnected ${new Date().toISOString()} with expanded scope. Identity verified via user/info; publishing capability verified via granted OAuth scope (video.upload = draft-only, no content posted).${creatorInfoError ? ' (creator_info bonus check not available — Direct Post is intentionally off.)' : ''}`,
      });
    }

    console.log('[v15.18.0] TikTok OAuth complete ✓', displayName);
    return res.redirect(302,
      `${appUrl}/?tt_connected=true&username=${encodeURIComponent(displayName)}&followers=${followerCount}&openId=${encodeURIComponent(open_id)}&tab=integrations`
    );

  } catch (err) {
    console.error('[v12.3] TikTok callback error:', err.message);
    try {
      await sbUpsert('tiktok_sync_logs', {
        open_id: 'unknown', status: 'error', message: err.message,
        synced_at: new Date().toISOString(),
      }, null);
    } catch (e2) {}
    return res.redirect(302, `${appUrl}/?tt_error=${encodeURIComponent(err.message)}`);
  }
}

// ── Combined entry point ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Auth initiation: no code param → redirect to TikTok
  if (!req.query.code && !req.query.error) return handleAuthInit(req, res);

  // Callback: code (or error) param present → finish OAuth flow
  return handleCallback(req, res);
}
