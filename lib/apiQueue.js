// MMM OS v12.2 Task 4 — Core API Queue
//
// Supabase-backed persistent job queue.
// Responsibilities: enqueue, dequeue (optimistic claim), complete, fail with
// exponential-backoff retry, rate-limit checking, audit logging, metrics, purge.
// No business logic — pure infrastructure.
//
// ── SQL migration (run once in Supabase SQL editor) ─────────────────────────
//
//   CREATE TABLE IF NOT EXISTS api_queue (
//     id              BIGSERIAL    PRIMARY KEY,
//     provider        TEXT         NOT NULL,
//     job_type        TEXT         NOT NULL,
//     payload         JSONB        NOT NULL DEFAULT '{}',
//     status          TEXT         NOT NULL DEFAULT 'pending',
//     priority        INT          NOT NULL DEFAULT 5,
//     attempts        INT          NOT NULL DEFAULT 0,
//     max_attempts    INT          NOT NULL DEFAULT 3,
//     next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
//     last_error      TEXT,
//     result          JSONB,
//     idempotency_key TEXT,
//     created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
//     updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
//   );
//   -- Deduplication (unique pending job per key)
//   CREATE UNIQUE INDEX IF NOT EXISTS idx_apiqueue_idem
//     ON api_queue(idempotency_key)
//     WHERE idempotency_key IS NOT NULL AND status = 'pending';
//   -- Fast dequeue lookup
//   CREATE INDEX IF NOT EXISTS idx_apiqueue_ready
//     ON api_queue(provider, priority, next_attempt_at)
//     WHERE status = 'pending';
//
//   CREATE TABLE IF NOT EXISTS api_logs (
//     id         BIGSERIAL    PRIMARY KEY,
//     provider   TEXT         NOT NULL,
//     job_id     BIGINT,
//     level      TEXT         NOT NULL DEFAULT 'info',
//     message    TEXT         NOT NULL,
//     meta       JSONB,
//     logged_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
//   );
//   CREATE INDEX IF NOT EXISTS idx_apilogs_provider
//     ON api_logs(provider, logged_at DESC);
//
// ────────────────────────────────────────────────────────────────────────────

// ── Shared Supabase HTTP helpers ─────────────────────────────────────────────
// Exported so other handlers can import them instead of duplicating the boilerplate.

export function makeSupabaseClient(url, key) {
  const headers = () => ({
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Cache-Control': 'no-cache',
  });

  async function sbGet(path) {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: headers() });
    if (!r.ok) return null;
    return r.json();
  }

  async function sbPost(table, body, prefer = 'return=minimal') {
    const r = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json', 'Prefer': prefer },
      body: JSON.stringify(body),
    });
    const data = (prefer.includes('representation') && r.ok) ? await r.json() : null;
    return { ok: r.ok, status: r.status, data };
  }

  async function sbUpsert(table, body, onConflict, prefer = 'return=minimal') {
    const qs = onConflict ? `?on_conflict=${onConflict}` : '';
    const r = await fetch(`${url}/rest/v1/${table}${qs}`, {
      method: 'POST',
      headers: {
        ...headers(),
        'Content-Type': 'application/json',
        'Prefer': `resolution=merge-duplicates,${prefer}`,
      },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status };
  }

  async function sbPatch(table, filter, body, prefer = 'return=minimal') {
    const r = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: { ...headers(), 'Content-Type': 'application/json', 'Prefer': prefer },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status };
  }

  async function sbDelete(table, filter) {
    const r = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: { ...headers(), 'Prefer': 'return=minimal' },
    });
    return { ok: r.ok, status: r.status };
  }

  return { sbGet, sbPost, sbUpsert, sbPatch, sbDelete };
}

// ── ApiQueue class ────────────────────────────────────────────────────────────

export class ApiQueue {
  constructor(supabaseUrl, serviceKey) {
    this._db = makeSupabaseClient(supabaseUrl, serviceKey);
  }

  // ── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Add a job to the queue.
   *
   * @param {string} provider        - 'youtube' | 'tiktok' | 'instagram' | 'finance'
   * @param {string} jobType         - e.g. 'sync_channel', 'sync_videos'
   * @param {object} payload         - Arbitrary job-specific data
   * @param {object} opts
   *   priority       INT  1 (urgent) – 10 (low). Default 5.
   *   maxAttempts    INT  Max retry attempts. Default 3.
   *   runAt          ISO  Earliest execution time. Default now.
   *   idempotencyKey STR  Prevents duplicate pending jobs with the same key.
   * @returns {boolean} true if enqueued, false if duplicate or error
   */
  async enqueue(provider, jobType, payload = {}, opts = {}) {
    const { priority = 5, maxAttempts = 3, runAt, idempotencyKey = null } = opts;
    const result = await this._db.sbPost('api_queue', {
      provider,
      job_type: jobType,
      payload,
      status: 'pending',
      priority,
      max_attempts: maxAttempts,
      next_attempt_at: runAt || new Date().toISOString(),
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    });
    if (!result.ok) {
      // 409 = duplicate idempotency key — expected, not an error
      if (result.status === 409) return false;
      console.error(`[ApiQueue] enqueue failed (${result.status})`);
      return false;
    }
    return true;
  }

  // ── Dequeue (optimistic claim) ────────────────────────────────────────────

  /**
   * Claim up to `limit` pending jobs for a provider.
   * Uses optimistic locking: each job is PATCH'd from 'pending' → 'running'
   * with a WHERE status=pending guard so concurrent workers can't double-claim.
   *
   * @param {string} provider
   * @param {number} limit
   * @returns {object[]} Successfully claimed jobs
   */
  async dequeue(provider, limit = 5) {
    const now = new Date().toISOString();
    const candidates = await this._db.sbGet(
      `api_queue?provider=eq.${provider}&status=eq.pending` +
      `&next_attempt_at=lte.${encodeURIComponent(now)}` +
      `&order=priority.asc,next_attempt_at.asc&limit=${limit}&select=*`
    );
    if (!candidates?.length) return [];

    const claimed = [];
    for (const job of candidates) {
      // Guard: only succeeds if the row is still 'pending' (no double-claim)
      const patch = await this._db.sbPatch(
        'api_queue',
        `id=eq.${job.id}&status=eq.pending`,
        { status: 'running', updated_at: now }
      );
      if (patch.ok) claimed.push({ ...job, status: 'running' });
    }
    return claimed;
  }

  // ── Complete ──────────────────────────────────────────────────────────────

  /**
   * Mark a job as successfully completed.
   * @param {number|string} jobId
   * @param {object|null}   result   Optional result data stored on the job row.
   */
  async complete(jobId, result = null) {
    return this._db.sbPatch('api_queue', `id=eq.${jobId}`, {
      status: 'done',
      ...(result !== null ? { result } : {}),
      updated_at: new Date().toISOString(),
    });
  }

  // ── Fail with retry ───────────────────────────────────────────────────────

  /**
   * Mark a job as failed.
   * If retryable and attempts remain, reschedules with exponential backoff:
   *   attempt 1 → baseDelaySecs
   *   attempt 2 → baseDelaySecs × 2
   *   attempt 3 → baseDelaySecs × 4
   * Once max_attempts is exhausted the job moves to 'failed' permanently.
   *
   * @param {number|string} jobId
   * @param {string}        errorMsg
   * @param {object}        opts
   *   retryable     BOOL  Whether to schedule a retry. Default true.
   *   baseDelaySecs INT   Base backoff delay in seconds. Default 30.
   */
  async fail(jobId, errorMsg, opts = {}) {
    const { retryable = true, baseDelaySecs = 30 } = opts;

    const rows = await this._db.sbGet(`api_queue?id=eq.${jobId}&select=attempts,max_attempts`);
    const job = rows?.[0];
    if (!job) return;

    const attempts = (job.attempts || 0) + 1;
    const exhausted = attempts >= (job.max_attempts || 3);
    const willRetry = retryable && !exhausted;

    let nextAttemptAt;
    if (willRetry) {
      const delaySecs = baseDelaySecs * Math.pow(2, attempts - 1);
      nextAttemptAt = new Date(Date.now() + delaySecs * 1000).toISOString();
    }

    return this._db.sbPatch('api_queue', `id=eq.${jobId}`, {
      status: willRetry ? 'pending' : 'failed',
      attempts,
      last_error: String(errorMsg).slice(0, 500),
      ...(willRetry ? { next_attempt_at: nextAttemptAt } : {}),
      updated_at: new Date().toISOString(),
    });
  }

  // ── Manual retry ──────────────────────────────────────────────────────────

  /** Reset a failed job to pending so it runs on the next dequeue. */
  async retryNow(jobId) {
    return this._db.sbPatch('api_queue', `id=eq.${jobId}`, {
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    });
  }

  // ── Rate limit check ──────────────────────────────────────────────────────

  /**
   * Check whether a provider is within its configured rate limits.
   * Counts recently completed/running jobs from api_queue as a proxy
   * for API calls made — no separate tracking table needed.
   *
   * @param {string} provider
   * @param {object} limits  { requestsPerMinute?, requestsPerHour? }
   * @returns {{ allowed: boolean, reason?: string }}
   */
  async checkRateLimit(provider, limits = {}) {
    const { requestsPerMinute = Infinity, requestsPerHour = Infinity } = limits;
    const now = Date.now();

    if (isFinite(requestsPerMinute)) {
      const since = new Date(now - 60_000).toISOString();
      const rows = await this._db.sbGet(
        `api_queue?provider=eq.${provider}&status=in.(running,done)` +
        `&updated_at=gte.${encodeURIComponent(since)}&select=id`
      );
      const count = rows?.length ?? 0;
      if (count >= requestsPerMinute) {
        return { allowed: false, reason: `${count}/${requestsPerMinute} req/min` };
      }
    }

    if (isFinite(requestsPerHour)) {
      const since = new Date(now - 3_600_000).toISOString();
      const rows = await this._db.sbGet(
        `api_queue?provider=eq.${provider}&status=in.(running,done)` +
        `&updated_at=gte.${encodeURIComponent(since)}&select=id`
      );
      const count = rows?.length ?? 0;
      if (count >= requestsPerHour) {
        return { allowed: false, reason: `${count}/${requestsPerHour} req/hr` };
      }
    }

    return { allowed: true };
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  /**
   * Append an entry to api_logs.
   * Fire-and-forget safe — errors are swallowed so logging never breaks callers.
   *
   * @param {string}      provider
   * @param {'info'|'warn'|'error'} level
   * @param {string}      message
   * @param {object|null} meta     Optional structured data
   * @param {number|null} jobId    Associate log with a specific job
   */
  async log(provider, level, message, meta = null, jobId = null) {
    try {
      await this._db.sbPost('api_logs', {
        provider,
        job_id: jobId ?? null,
        level,
        message: String(message).slice(0, 1000),
        meta: meta !== null ? meta : null,
        logged_at: new Date().toISOString(),
      });
    } catch {
      // Logging must never throw
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  /** Count jobs by status for a provider. */
  async getMetrics(provider) {
    const rows = await this._db.sbGet(`api_queue?provider=eq.${provider}&select=status`) ?? [];
    const counts = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const r of rows) {
      if (r.status in counts) counts[r.status]++;
    }
    return { ...counts, total: rows.length };
  }

  /** Recent audit log entries for a provider. */
  async getLogs(provider, limit = 50) {
    return await this._db.sbGet(
      `api_logs?provider=eq.${provider}&order=logged_at.desc&limit=${limit}&select=*`
    ) ?? [];
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  /** Delete done/failed jobs older than retentionDays. */
  async purgeOld(retentionDays = 30) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    return this._db.sbDelete(
      'api_queue',
      `status=in.(done,failed)&updated_at=lt.${encodeURIComponent(cutoff)}`
    );
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────
// Each serverless invocation gets a fresh module, so this is per-invocation only.
// Import createQueue() rather than constructing ApiQueue directly.

let _queueInstance = null;

export function createQueue() {
  if (!_queueInstance) {
    _queueInstance = new ApiQueue(
      process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co',
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _queueInstance;
}
