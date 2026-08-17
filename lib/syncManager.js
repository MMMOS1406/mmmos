// MMM OS v12.2 Task 4 — Sync Manager
//
// Provider registry and orchestration layer on top of ApiQueue.
// Handles: provider registration, deduplication-aware job scheduling,
// rate-limit enforcement, token-refresh delegation, worker dispatch,
// and system-wide status reporting.
//
// ── Adding a new provider ────────────────────────────────────────────────────
//
//   import { createSyncManager } from '../../lib/syncManager.js';
//
//   const manager = createSyncManager();
//
//   manager.registerProvider('tiktok', {
//     displayName: 'TikTok',
//     rateLimits: { requestsPerMinute: 30, requestsPerHour: 500 },
//     maxRetries: 3,
//     baseDelaySecs: 60,
//     supportedJobTypes: ['sync_account', 'sync_videos', 'refresh_token'],
//     refreshToken: async (accountId) => { /* return { accessToken, expiresAt } */ },
//   });
//
// ── Scheduling a job ─────────────────────────────────────────────────────────
//
//   await manager.scheduleSync('youtube', 'sync_channel', { channelId: 'UCxxx' });
//   // Idempotent within the dedupeWindowMins window (default 60 min).
//
// ── Running pending jobs (from a handler or cron) ────────────────────────────
//
//   const result = await manager.runProvider('youtube', async (job, queue) => {
//     const { channelId } = job.payload;
//     await doActualChannelSync(channelId);      // your business logic
//     return { channelId, synced: true };        // stored in job.result
//   });
//   // result: { processed, succeeded, failed, rateLimited? }
//
// ── Token refresh ────────────────────────────────────────────────────────────
//
//   const tokens = await manager.refreshProviderToken('youtube', channelId);
//   // Delegates to the refreshToken fn registered with the provider.
//   // Errors are logged automatically and re-thrown for the caller to handle.
//
// ────────────────────────────────────────────────────────────────────────────

import { createQueue } from './apiQueue.js';

export class SyncManager {
  constructor() {
    this._providers = new Map(); // name → config
    this._queue = createQueue();
  }

  // ── Provider registration ─────────────────────────────────────────────────

  /**
   * Register (or update) a provider.
   *
   * @param {string} name   Provider key. Must be stable — used in queue rows.
   * @param {object} cfg
   *   displayName     STR   Human-readable name
   *   rateLimits      OBJ   { requestsPerMinute?, requestsPerHour? }
   *   maxRetries      INT   Max retry attempts before marking job 'failed'. Default 3.
   *   baseDelaySecs   INT   Base exponential-backoff delay. Default 30.
   *   supportedJobTypes  STR[]  Informational — not enforced at queue level.
   *   refreshToken    FN    async (entityId: string) => { accessToken, expiresAt }
   *                         Should throw a non-retryable error if not yet configured:
   *                         throw Object.assign(new Error('...'), { retryable: false })
   *   workerFn        FN    Default async (job, queue) => any
   *                         Used when runProvider() is called without an explicit worker.
   */
  registerProvider(name, cfg) {
    this._providers.set(name, {
      name,
      displayName:       cfg.displayName       ?? name,
      rateLimits:        cfg.rateLimits         ?? {},
      maxRetries:        cfg.maxRetries         ?? 3,
      baseDelaySecs:     cfg.baseDelaySecs      ?? 30,
      supportedJobTypes: cfg.supportedJobTypes  ?? [],
      refreshToken:      cfg.refreshToken       ?? null,
      workerFn:          cfg.workerFn           ?? null,
    });
  }

  // ── Job scheduling ────────────────────────────────────────────────────────

  /**
   * Schedule a sync job with automatic deduplication.
   *
   * The idempotency key defaults to:
   *   `{provider}:{jobType}:{entityKey}:{windowSlot}`
   * where windowSlot changes every dedupeWindowMins minutes.
   * This means the same job type for the same entity is only queued once
   * per window — re-submitting within the window is a silent no-op.
   *
   * @param {string} provider
   * @param {string} jobType
   * @param {object} payload        Job-specific data
   * @param {object} opts
   *   priority          INT    1 (urgent) – 10 (low). Default 5.
   *   runAt             ISO    Earliest execution time. Default now.
   *   dedupeWindowMins  INT    Deduplication window. Default 60 min.
   *   idempotencyKey    STR    Override auto-generated key.
   * @returns {boolean}  true if enqueued, false if deduplicated or unknown provider
   */
  async scheduleSync(provider, jobType, payload = {}, opts = {}) {
    if (!this._providers.has(provider)) {
      console.warn(`[SyncManager] scheduleSync: unknown provider "${provider}"`);
      return false;
    }
    const cfg = this._providers.get(provider);

    // Derive entity key from common payload fields
    const entityKey = payload.channelId ?? payload.accountId ?? payload.entityId ?? 'global';
    const windowMins = opts.dedupeWindowMins ?? 60;
    const windowSlot = Math.floor(Date.now() / (windowMins * 60_000));
    const idempotencyKey = opts.idempotencyKey ?? `${provider}:${jobType}:${entityKey}:${windowSlot}`;

    const enqueued = await this._queue.enqueue(provider, jobType, payload, {
      priority:       opts.priority ?? 5,
      maxAttempts:    cfg.maxRetries,
      runAt:          opts.runAt ?? new Date().toISOString(),
      idempotencyKey,
    });

    if (enqueued) {
      await this._queue.log(
        provider, 'info',
        `Scheduled ${jobType} for ${entityKey}`,
        { entityKey, jobType },
        null
      );
    }
    return enqueued;
  }

  // ── Worker dispatch ───────────────────────────────────────────────────────

  /**
   * Claim and process pending jobs for a provider in one invocation.
   *
   * Flow per job:
   *   1. Rate-limit check (abort entire batch if limited)
   *   2. Dequeue (optimistic claim)
   *   3. Call workerFn(job, queue)
   *   4a. On success: queue.complete(jobId, result)
   *   4b. On error:   queue.fail(jobId, err.message, { retryable })
   *       err.retryable = false → skips retry, moves to 'failed' immediately
   *
   * @param {string}        providerName
   * @param {Function|null} workerFn    async (job, queue) => any
   *                                    Falls back to the provider's registered workerFn.
   * @param {number}        batchSize   Max jobs per invocation. Default 10.
   * @returns {{ processed, succeeded, failed, rateLimited?, reason? }}
   */
  async runProvider(providerName, workerFn = null, batchSize = 10) {
    const cfg = this._providers.get(providerName);
    if (!cfg) throw new Error(`[SyncManager] Provider not registered: ${providerName}`);

    const worker = workerFn ?? cfg.workerFn;
    if (!worker) throw new Error(`[SyncManager] No worker function for: ${providerName}`);

    // ── Rate limit gate ──
    const rateCheck = await this._queue.checkRateLimit(providerName, cfg.rateLimits);
    if (!rateCheck.allowed) {
      const msg = `Rate limited — ${rateCheck.reason}`;
      console.warn(`[SyncManager] ${providerName}: ${msg}`);
      await this._queue.log(providerName, 'warn', msg);
      return { processed: 0, succeeded: 0, failed: 0, rateLimited: true, reason: rateCheck.reason };
    }

    // ── Dequeue ──
    const jobs = await this._queue.dequeue(providerName, batchSize);
    let succeeded = 0, failed = 0;

    for (const job of jobs) {
      const t0 = Date.now();
      await this._queue.log(
        providerName, 'info',
        `Starting ${job.job_type} (attempt ${(job.attempts ?? 0) + 1}/${job.max_attempts})`,
        { payload: job.payload },
        job.id
      );

      try {
        const result = await worker(job, this._queue);
        await this._queue.complete(job.id, result ?? null);
        await this._queue.log(
          providerName, 'info',
          `Completed ${job.job_type} in ${Date.now() - t0}ms`,
          result ? { result } : null,
          job.id
        );
        succeeded++;
      } catch (err) {
        // Workers signal non-retryable failures via err.retryable = false
        const retryable = err.retryable !== false;
        await this._queue.fail(job.id, err.message, { retryable, baseDelaySecs: cfg.baseDelaySecs });
        await this._queue.log(
          providerName, 'error',
          `Failed ${job.job_type}: ${err.message}`,
          { retryable, stack: err.stack?.slice(0, 300) },
          job.id
        );
        failed++;
      }
    }

    return { processed: jobs.length, succeeded, failed };
  }

  // ── Token refresh ─────────────────────────────────────────────────────────

  /**
   * Refresh OAuth tokens for a provider entity (channel, account, etc.).
   * Delegates to the provider's registered refreshToken function.
   * Logs success/failure automatically; re-throws on error so callers can decide
   * whether to enqueue a retry job or surface the error.
   *
   * @param {string} providerName
   * @param {string} entityId     Channel ID, account ID, etc.
   * @returns {{ accessToken: string, expiresAt: string }}
   */
  async refreshProviderToken(providerName, entityId) {
    const cfg = this._providers.get(providerName);
    if (!cfg?.refreshToken) {
      const err = Object.assign(
        new Error(`No refreshToken handler registered for provider: ${providerName}`),
        { retryable: false }
      );
      throw err;
    }

    try {
      const tokens = await cfg.refreshToken(entityId);
      await this._queue.log(
        providerName, 'info',
        `Token refreshed for ${entityId}`,
        { expiresAt: tokens?.expiresAt }
      );
      return tokens;
    } catch (err) {
      await this._queue.log(
        providerName, 'error',
        `Token refresh failed for ${entityId}: ${err.message}`
      );
      throw err;
    }
  }

  // ── Status reporting ──────────────────────────────────────────────────────

  /**
   * Fetch queue metrics and recent logs for every registered provider.
   * Useful for a /api/system/status endpoint or admin dashboard.
   *
   * @returns {object} { [providerName]: { displayName, metrics, recentLogs } }
   */
  async getSystemStatus() {
    const status = {};
    const entries = [...this._providers.entries()];

    await Promise.all(entries.map(async ([name, cfg]) => {
      const [metrics, logs] = await Promise.all([
        this._queue.getMetrics(name),
        this._queue.getLogs(name, 10),
      ]);
      status[name] = { displayName: cfg.displayName, metrics, recentLogs: logs };
    }));

    return status;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /** Manually re-queue a specific failed job to run immediately. */
  async retryJob(jobId) {
    return this._queue.retryNow(jobId);
  }

  /** Remove old done/failed jobs across all providers. */
  async purgeOld(retentionDays = 30) {
    return this._queue.purgeOld(retentionDays);
  }

  /** Direct access to the underlying ApiQueue for low-level operations. */
  get queue() { return this._queue; }
}

// ── Singleton factory with all known providers pre-registered ─────────────────
//
// One instance per serverless invocation (module-level singleton).
// Import createSyncManager() in any handler — never construct SyncManager directly.

let _instance = null;

export function createSyncManager() {
  if (_instance) return _instance;

  const manager = new SyncManager();

  // ── YouTube ───────────────────────────────────────────────────────────────
  // Token refresh is handled inside /api/youtube/sync.js today.
  // When YouTube sync migrates to the queue model, update refreshToken here
  // to call the shared refreshAccessToken() helper directly.
  manager.registerProvider('youtube', {
    displayName: 'YouTube',
    rateLimits: {
      requestsPerMinute: 60,
      requestsPerHour:   1_000,
    },
    maxRetries:    3,
    baseDelaySecs: 30,
    supportedJobTypes: ['sync_channel', 'sync_videos', 'refresh_token', 'detect_uploads'],
    refreshToken: async (_channelId) => {
      // Stub — full implementation lives in sync.js until migration
      throw Object.assign(
        new Error('YouTube token refresh must be triggered via /api/youtube/sync'),
        { retryable: false }
      );
    },
  });

  // ── TikTok ────────────────────────────────────────────────────────────────
  // Plug in when TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET env vars are set.
  manager.registerProvider('tiktok', {
    displayName: 'TikTok',
    rateLimits: {
      requestsPerMinute: 30,
      requestsPerHour:   500,
    },
    maxRetries:    3,
    baseDelaySecs: 60,
    supportedJobTypes: ['sync_account', 'sync_videos', 'refresh_token'],
    refreshToken: async (_accountId) => {
      throw Object.assign(new Error('TikTok integration not yet configured'), { retryable: false });
    },
  });

  // ── Instagram ─────────────────────────────────────────────────────────────
  // Uses Facebook Graph API. Plug in when IG_ACCESS_TOKEN env var is set.
  manager.registerProvider('instagram', {
    displayName: 'Instagram',
    rateLimits: {
      requestsPerMinute: 20,
      requestsPerHour:   200,
    },
    maxRetries:    3,
    baseDelaySecs: 60,
    supportedJobTypes: ['sync_account', 'sync_media', 'sync_insights', 'refresh_token'],
    refreshToken: async (_accountId) => {
      throw Object.assign(new Error('Instagram integration not yet configured'), { retryable: false });
    },
  });

  // ── Finance ───────────────────────────────────────────────────────────────
  // Plaid / RocketMoney. Plug in when PLAID_SECRET env var is set.
  manager.registerProvider('finance', {
    displayName: 'Finance',
    rateLimits: {
      requestsPerHour: 50,
    },
    maxRetries:    2,
    baseDelaySecs: 120,
    supportedJobTypes: ['sync_transactions', 'sync_balances', 'sync_investments', 'refresh_token'],
    refreshToken: async (_accountId) => {
      throw Object.assign(new Error('Finance integration not yet configured'), { retryable: false });
    },
  });

  _instance = manager;
  return manager;
}
