// MMM OS v12.3 — API Queue (combined handler)
// Routes by URL path:
//   POST /api/queue/process → pull & execute next job
//   POST /api/queue/add     → enqueue a new job
//   GET  /api/queue/status  → per-provider health stats

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.APP_URL || 'https://mmm-static.vercel.app';

// Rate limits per provider — window: perMin=60s, perHour=3600s, perDay=86400s
const RATE_LIMITS = {
  youtube:   { perDay: 10000, perHour: null,  perMin: null },
  tiktok:    { perDay: null,  perHour: 100,   perMin: null },
  instagram: { perDay: null,  perHour: 200,   perMin: null },
  openai:    { perDay: null,  perHour: null,  perMin: 60   },
  claude:    { perDay: null,  perHour: null,  perMin: 50   },
  finance:   { perDay: null,  perHour: null,  perMin: null },
};

const PROVIDERS = Object.keys(RATE_LIMITS);

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbGet(path) {
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

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Insert failed: ${t.slice(0, 200)}`); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

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
  return { ok: res.ok, status: res.status };
}

// ── Rate limit check ──────────────────────────────────────────────────────────

async function getEligibleProviders(filterProvider) {
  const candidates = filterProvider ? [filterProvider] : PROVIDERS;
  const eligible = [];

  for (const provider of candidates) {
    const limits = RATE_LIMITS[provider];
    if (!limits) continue;
    let ok = true;

    if (limits.perMin) {
      const since = new Date(Date.now() - 60_000).toISOString();
      const rows = await sbGet(
        `api_queue?provider=eq.${provider}&status=in.(running,completed)&started_at=gte.${encodeURIComponent(since)}&select=id`
      );
      if (rows && rows.length >= limits.perMin) ok = false;
    }
    if (ok && limits.perHour) {
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const rows = await sbGet(
        `api_queue?provider=eq.${provider}&status=in.(running,completed)&started_at=gte.${encodeURIComponent(since)}&select=id`
      );
      if (rows && rows.length >= limits.perHour) ok = false;
    }
    if (ok && limits.perDay) {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const rows = await sbGet(
        `api_queue?provider=eq.${provider}&status=in.(running,completed)&started_at=gte.${encodeURIComponent(since)}&select=id`
      );
      if (rows && rows.length >= limits.perDay) ok = false;
    }

    if (ok) eligible.push(provider);
  }

  return eligible;
}

// ── Job dispatcher ─────────────────────────────────────────────────────────────

async function executeJob(job) {
  const payload = job.payload || {};

  switch (`${job.provider}:${job.job_type}`) {
    case 'youtube:autosync': {
      const r = await fetch(`${APP_URL}/api/youtube/autosync`);
      if (!r.ok) throw new Error(`YouTube autosync HTTP ${r.status}`);
      break;
    }
    case 'youtube:detect': {
      const r = await fetch(`${APP_URL}/api/youtube/detect`);
      if (!r.ok) throw new Error(`YouTube detect HTTP ${r.status}`);
      break;
    }
    case 'tiktok:sync': {
      if (!payload.openId) throw new Error('tiktok:sync requires payload.openId');
      const r = await fetch(`${APP_URL}/api/tiktok/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openId: payload.openId }),
      });
      if (!r.ok) throw new Error(`TikTok sync HTTP ${r.status}`);
      break;
    }
    case 'packages:cross_platform_sync': {
      const r = await fetch(`${APP_URL}/api/packages/sync`);
      if (!r.ok) throw new Error(`Cross-platform sync HTTP ${r.status}`);
      break;
    }
    default:
      // No dispatcher yet — log and succeed silently
      console.log(`[v12.3] queue: no dispatcher for ${job.provider}:${job.job_type} — marking complete`);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleProcess(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const filterProvider = req.body?.provider || null;

  // 1. Check which providers are under their rate limits
  const eligible = await getEligibleProviders(filterProvider);
  if (!eligible.length) {
    return res.status(200).json({ processed: false, reason: 'rate_limited', rateLimitedProviders: filterProvider ? [filterProvider] : PROVIDERS });
  }

  // 2. Pull the highest-priority pending job that's due
  const providerList = eligible.map(p => `"${p}"`).join(',');
  const jobs = await sbGet(
    `api_queue?status=in.(pending,retrying)&provider=in.(${providerList})&scheduled_at=lte.${encodeURIComponent(new Date().toISOString())}&order=priority.desc,scheduled_at.asc&limit=1`
  );

  if (!jobs?.length) {
    return res.status(200).json({ processed: false, reason: 'queue_empty' });
  }

  const job = jobs[0];
  const newAttempts = (job.attempts || 0) + 1;
  const startedAt = new Date().toISOString();

  // 3. Mark running
  await sbPatch('api_queue', `id=eq.${job.id}`, {
    status: 'running',
    started_at: startedAt,
    attempts: newAttempts,
  });

  // 4. Execute
  let success = false;
  let errorMessage = null;
  try {
    await executeJob(job);
    success = true;
  } catch (err) {
    errorMessage = err.message;
    console.error(`[v12.3] queue: job ${job.id} failed:`, err.message);
  }

  // 5. Update final status
  const now = new Date().toISOString();
  if (success) {
    await sbPatch('api_queue', `id=eq.${job.id}`, { status: 'completed', completed_at: now, error_message: null });
  } else if (newAttempts >= (job.max_attempts || 3)) {
    await sbPatch('api_queue', `id=eq.${job.id}`, { status: 'failed', completed_at: now, error_message: errorMessage });
  } else {
    // Exponential backoff: 2^attempts minutes
    const backoffMs = Math.pow(2, newAttempts) * 60_000;
    const scheduledAt = new Date(Date.now() + backoffMs).toISOString();
    await sbPatch('api_queue', `id=eq.${job.id}`, {
      status: 'retrying',
      scheduled_at: scheduledAt,
      error_message: errorMessage,
    });
  }

  console.log(`[v12.3] queue: processed job ${job.id} (${job.provider}:${job.job_type}) — ${success ? 'ok' : 'failed'}`);
  return res.status(200).json({
    processed: true,
    jobId: job.id,
    provider: job.provider,
    jobType: job.job_type,
    success,
    attempts: newAttempts,
    errorMessage,
  });
}

async function handleAdd(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { provider, job_type, payload, priority, max_attempts, scheduled_at } = req.body || {};

  if (!provider || !job_type) {
    return res.status(400).json({ error: 'provider and job_type are required', validProviders: PROVIDERS });
  }
  if (!RATE_LIMITS[provider]) {
    return res.status(400).json({ error: `Unknown provider: "${provider}"`, validProviders: PROVIDERS });
  }

  const job = await sbInsert('api_queue', {
    provider,
    job_type,
    payload:      payload      || {},
    status:       'pending',
    priority:     Math.min(10, Math.max(1, parseInt(priority) || 5)),
    max_attempts: max_attempts || 3,
    scheduled_at: scheduled_at || new Date().toISOString(),
  });

  console.log(`[v12.3] queue: added job ${job?.id} (${provider}:${job_type})`);
  return res.status(200).json({ queued: true, job });
}

async function handleStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const stats = {};
  let totalPending = 0, totalFailed = 0, totalCompleted = 0;

  for (const provider of PROVIDERS) {
    const rows = await sbGet(
      `api_queue?provider=eq.${provider}&select=status,completed_at,started_at&order=created_at.desc&limit=500`
    ) || [];

    const pending   = rows.filter(r => r.status === 'pending' || r.status === 'retrying').length;
    const running   = rows.filter(r => r.status === 'running').length;
    const completed = rows.filter(r => r.status === 'completed').length;
    const failed    = rows.filter(r => r.status === 'failed').length;
    const total     = rows.length;
    const successRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : null;

    const lastRow = rows.find(r => r.completed_at);
    const lastProcessed = lastRow?.completed_at || null;

    // Health: healthy <10% failure rate & recent activity, degraded 10-30%, down >30% or no activity
    let health = 'healthy';
    if (total > 0) {
      const failRate = failed / total;
      if (failRate > 0.3) health = 'down';
      else if (failRate > 0.1) health = 'degraded';
    }
    // No recent activity in 24h and has jobs → degraded
    if (lastProcessed && (Date.now() - new Date(lastProcessed)) > 86_400_000) {
      if (health === 'healthy') health = 'degraded';
    }

    stats[provider] = { pending, running, completed, failed, total, successRate, lastProcessed, health };
    totalPending  += pending;
    totalFailed   += failed;
    totalCompleted += completed;
  }

  return res.status(200).json({
    providers: stats,
    total: { pending: totalPending, failed: totalFailed, completed: totalCompleted },
    checkedAt: new Date().toISOString(),
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url || '';
  if (url.includes('/process')) return handleProcess(req, res);
  if (url.includes('/add'))     return handleAdd(req, res);
  if (url.includes('/status'))  return handleStatus(req, res);

  return res.status(200).json({
    service: 'MMM OS API Queue',
    routes: {
      'POST /api/queue/process': 'Process next pending job',
      'POST /api/queue/add':     'Add a job to the queue',
      'GET  /api/queue/status':  'Queue health per provider',
    },
  });
}
