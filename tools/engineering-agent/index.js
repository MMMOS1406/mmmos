#!/usr/bin/env node
/**
 * MMMOS Engineering Agent MCP Server v5.0.0
 * Zero npm dependencies — pure Node.js
 *
 * Tools exposed:
 *   eb_list_tasks                    — list tasks (optional status filter)
 *   eb_load_task                     — load task by UUID
 *   eb_read_section                  — read one Brain section
 *   eb_read_all_brain                — read complete Brain (all sections)
 *   eb_update_task                   — set status/test_results/deployment_version/ready_for_ceo
 *   eb_create_task                   — create new engineering task (manual, 5 fields)
 *   eb_create_intelligent_task       — Task Intelligence v2: CEO enters 4 fields, Brain auto-generates
 *                                      complete Engineering Packet (constitution, engine spec,
 *                                      protected components, shared deps, regression risks,
 *                                      acceptance criteria, EVL plan, operator validation plan,
 *                                      deployment checks, retry rules, CEO test steps)
 *   eb_get_system_version            — get current MMMOS version from Brain
 *   eb_validate_task                 — EVL Stage 1: API-level validation (generate + check criteria)
 *                                      PASS → status = testing (awaiting operator UI validation)
 *                                      FAIL → status = in_progress (fix needed)
 *   eb_record_operator_validation    — EVL Stage 2: full lifecycle to APPROVE + visual checklist
 *                                      PASS → status = ready_for_ceo
 *                                      FAIL → status = in_progress (auto-loop: fix → redeploy → rerun)
 *
 * Engineering Validation Loop v2 (EVL v2) — two-stage gate:
 *   Stage 1 (API): eb_validate_task       — runs live generate endpoint, checks script/lyrics
 *   Stage 2 (UI):  eb_record_operator_validation — Claude drives full lifecycle to APPROVE,
 *                                                   plays the Approve-page video, verifies all 7
 *                                                   visual checklist items. Auto-loops on any fail.
 *                                                   CEO review begins only at the Approve video.
 *   Only after BOTH stages pass is a task promoted to ready_for_ceo.
 *   CEO responsibility: review Approve video → accept or reject → publish if approved.
 *   CEO must NEVER discover engineering defects.
 *
 * v5.0.0: EVL Stage 2 v3 upgrade.
 *   Full lifecycle through APPROVE now required (not just Build).
 *   Visual checklist enforced for AI Studio: logo_visible, music_audible, voice_clear,
 *   captions_correct, short_duration_pass, video_plays_in_approve, long_duration_pass (if applicable).
 *   Auto-loop on any checklist fail: diagnose → fix → redeploy → rerun full lifecycle → Approve → recheck.
 *   New fields: approve_video_url, approve_video_played, visual_checklist.
 *
 * v4.0.0: Added eb_create_intelligent_task (Task Intelligence v2).
 *   CEO enters only: problem, expected_result, affected_engine, priority.
 *   Brain auto-reads Supabase and generates complete Engineering Packet.
 *   Packet is stored in engineering_tasks.packet for any future agent or session.
 *
 * v3.0.0: Added EVL Stage 2 (operator UI validation gate).
 *   Changed eb_validate_task to promote to "testing" (not ready_for_ceo) on API pass.
 *   Added eb_record_operator_validation for UI evidence + final ready_for_ceo promotion.
 *
 * v6.0.0 (CEO Decision #17 Step 2B): Engineering Worker tools added.
 *   New tools: eb_worker_list_authorized_tasks, eb_worker_claim_task,
 *   eb_worker_read_task_packet, eb_worker_read_authorization_boundary,
 *   eb_worker_read_authorized_file, eb_worker_write_authorized_file,
 *   eb_worker_validate_javascript_syntax, eb_worker_submit_execution_plan,
 *   eb_worker_submit_evidence.
 *   These call the EXISTING governed MMMOS HTTP actions
 *   (engineering_worker_list_authorized_tasks / engineering_worker_claim_task /
 *   engineering_agent_gateway — Decision #16 Step 2C + Decision #17 Step 2A,
 *   both unmodified by this change) instead of direct Supabase REST. No new
 *   auth scheme, no new claim mechanism, no new Agent Gateway. Authenticates
 *   as a registered Engineering Worker via a single standing credential —
 *   never a tool input parameter, never logged, never echoed back in any
 *   tool result. The CEO never has to manually relay a per-task agent_token
 *   for this path: Decision #17 Step 2A extended the Agent Gateway to accept
 *   a genuinely claimed worker identity as an alternate proof, so
 *   worker_credential + task_id + agent_run_id is everything these tools
 *   need end-to-end.
 *   All existing eb_* tools above are completely unchanged — this is a pure
 *   addition, not a rewrite of the Brain/EVL system, which has no governed
 *   HTTP equivalent and continues to use direct Supabase REST as before.
 *
 * v7.0.0 (CEO Decision #17 Step 2D): Secure Cowork Pairing Flow.
 *   Replaces the Step 2C manual credential-copy handoff (CEO had to mint a
 *   credential in the browser, copy it, and paste it into this server's
 *   config by hand) with a self-service pairing protocol the CEO approves
 *   with a single dashboard click, and nothing else:
 *     eb_worker_connect_request — this server generates its own one-time
 *       pairing secret locally, sends only its SHA-256 hash to MMMOS
 *       (engineering_worker_pairing_request), and keeps the raw secret in a
 *       local pending-pairing file. Nothing secret ever leaves this
 *       process at this step.
 *     eb_worker_connect_finish  — call after the CEO clicks "Approve
 *       Connection" in the dashboard. Presents the locally-held raw pairing
 *       secret to engineering_worker_pairing_complete; MMMOS mints a real
 *       worker_credential only if the CEO's approval AND this proof both
 *       check out, and returns it directly to this call — never to the
 *       CEO's browser. This server writes it straight to a local file
 *       (MMMOS_WORKER_CREDENTIAL_FILE, below) and discards the pending
 *       pairing file. The credential itself never appears in any tool
 *       result this server returns.
 *   The credential is now sourced primarily from that local file, read
 *   lazily on every worker-tool call (so a fresh pairing takes effect
 *   immediately — no restart required) rather than once at process start.
 *   The legacy MMMOS_WORKER_CREDENTIAL environment variable (Step 2B) still
 *   works as a fallback for anyone who set it up that way already — it is
 *   not removed, just no longer the primary/recommended path.
 *
 * v7.1.0 (CEO Decision #17 — Engineering Brain Worker Transport Completion):
 *   Two additions, both pure passthroughs over the existing mmosOps()
 *   transport, following the exact pattern of every eb_worker_* tool above —
 *   no new HTTP client, no new auth scheme, no new validation logic:
 *     eb_worker_submit_commit_sha — calls the existing governed
 *       engineering_agent_gateway action with op: 'submit_commit_sha'.
 *       All SHA format/GitHub-reachability/ownership validation remains
 *       entirely server-side in the deployed api/ops.js, exactly as before;
 *       this tool duplicates none of it locally.
 *     eb_worker_execute_production_release — calls the existing governed
 *       engineering_worker_execute_production_release action directly (not
 *       a Gateway op — that action is deliberately outside
 *       AGENT_GATEWAY_ALLOWED_OPS server-side, unchanged). It can only ever
 *       execute a production_release_authorizations row already created
 *       through the separate, CEO-session-gated
 *       production_release_authorization_create action performed in the
 *       MMMOS CEO UI — this server exposes no tool for creating that
 *       authorization, only for executing one that already exists.
 *   Both use the existing single standing worker credential exactly as
 *   every other eb_worker_* tool does: read via _requireWorkerCredential(),
 *   attached to the outgoing request body, never accepted as a tool
 *   argument, never included in any tool result.
 */

import readline from 'readline';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, createHash } from 'crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// canonical — mmm-os.vercel.app is a separate redirect project.
// R2: MMMOS_HOST may point at this project's own preview deployments for
// isolated testing. Only mmm-static*.vercel.app hosts are accepted, so the
// worker credential can never be sent to any other server.
const MMMOS_HOST = (() => {
  const v = String(process.env.MMMOS_HOST || '').trim().replace(/^https:\/\//, '').replace(/\/.*$/, '');
  return /^mmm-static[a-z0-9-]*\.vercel\.app$/.test(v) ? v : 'mmm-static.vercel.app';
})();

// Decision #17 Step 2D: local, per-installation storage for the standing
// Engineering Worker credential, plus a scratch file for an in-flight
// pairing attempt. Both live next to this script (inside the connected
// engineering-agent folder), never in git (this directory isn't a repo),
// never in the shared Claude Desktop app config. __dirname is derived from
// import.meta.url since this is an ES module.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MMMOS_WORKER_CREDENTIAL_FILE = path.join(__dirname, '.mmmos_worker_credential');
const MMMOS_PENDING_PAIRING_FILE = path.join(__dirname, '.mmmos_pending_pairing.json');

// Reads the standing Engineering Worker credential fresh on every call
// (never cached in a module-level constant) so a credential written by
// eb_worker_connect_finish takes effect immediately, with no server
// restart. Local file is the primary/recommended source (Step 2D pairing);
// the MMMOS_WORKER_CREDENTIAL env var (Step 2B, manual setup) remains a
// working fallback for any installation still configured that way. Optional
// on purpose: the existing Brain/EVL tools below never need it, and this
// server must keep working with it entirely absent. Every worker tool below
// checks for it itself and fails with a clear, credential-free error if
// it's missing — this value is never included in any log line, error
// message, or tool result, however it was sourced.
function _loadWorkerCredential() {
  try {
    if (fs.existsSync(MMMOS_WORKER_CREDENTIAL_FILE)) {
      const v = fs.readFileSync(MMMOS_WORKER_CREDENTIAL_FILE, 'utf8').trim();
      if (v) return v;
    }
  } catch (e) { /* fall through to env var */ }
  return process.env.MMMOS_WORKER_CREDENTIAL || null;
}

if (!SUPABASE_KEY) {
  process.stderr.write('[mmm-engineering-brain] ERROR: SUPABASE_KEY env var is required\n');
  process.exit(1);
}

// ── Supabase REST helper ──────────────────────────────────────────────────────
function sbRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    const bodyStr = body != null ? JSON.stringify(body) : null;
    if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          if (res.statusCode >= 400) reject(new Error(`Supabase ${res.statusCode}: ${data.slice(0, 300)}`));
          else resolve(data ? JSON.parse(data) : null);
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── MMMOS live API helper ─────────────────────────────────────────────────────
function mmosPost(path, body, _redirectDepth) {
  const depth = _redirectDepth || 0;
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(bodyStr)),
    };
    const req = https.request(
      { hostname: MMMOS_HOST, path, method: 'POST', headers },
      (res) => {
        // Follow 301/302/307/308 redirects up to 3 hops
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && depth < 3) {
          res.resume(); // drain
          try {
            const loc = new URL(res.headers.location);
            // Temporarily override hostname for the redirect
            const origHost = MMMOS_HOST;
            const tempHost = loc.hostname;
            const tempPath = loc.pathname + (loc.search || '');
            // Use a direct https call for the redirect target
            const rb = JSON.stringify(body);
            const rh = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(rb)) };
            const rreq = https.request(
              { hostname: tempHost, path: tempPath, method: 'POST', headers: rh },
              (rres) => {
                let data = '';
                rres.on('data', (d) => (data += d));
                rres.on('end', () => {
                  try {
                    const parsed = JSON.parse(data);
                    if (rres.statusCode >= 400) reject(new Error(`MMMOS ${rres.statusCode}: ${JSON.stringify(parsed).slice(0,300)}`));
                    else resolve(parsed);
                  } catch (e) {
                    reject(new Error(`MMMOS parse error (${rres.statusCode}): ${data.slice(0,200)}`));
                  }
                });
              }
            );
            rreq.on('error', reject);
            rreq.write(rb);
            rreq.end();
          } catch(e) { reject(new Error('Redirect parse failed: ' + e.message)); }
          return;
        }
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400)
              reject(new Error(`MMMOS ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`));
            else resolve(parsed);
          } catch (e) {
            reject(new Error(`MMMOS parse error (${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Governed MMMOS API call (Decision #17 Step 2B) ────────────────────────────
// Thin wrapper over the EXISTING mmosPost helper above (already used for
// /api/generate) — not a new HTTP client, not a new endpoint. Every Engineering
// Worker tool below calls through this single function so there is exactly one
// place that talks to /api/ops on behalf of a worker.
function mmosOps(action, body) {
  return mmosPost(`/api/ops?action=${encodeURIComponent(action)}`, body || {});
}

// Fails fast, locally, with a clear and credential-free error, before any
// network call — this is what makes "missing worker credential" fail closed
// deterministically rather than depending on the server's generic
// worker_authentication_failed response for an undefined/empty value.
function _requireWorkerCredential() {
  const cred = _loadWorkerCredential();
  if (!cred) {
    throw new Error(
      'No Engineering Worker credential configured yet. Call eb_worker_connect_request, ' +
      'ask the CEO to click "Approve Connection" for it in the Engineering Workers panel, ' +
      'then call eb_worker_connect_finish. Every other eb_worker_* tool needs this first.'
    );
  }
  return cred;
}

// ── Text analysis helpers ─────────────────────────────────────────────────────
function countWords(text) {
  if (!text) return 0;
  const clean = String(text)
    .replace(/\[\d+:\d+[^\]]*\]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.split(' ').filter((w) => w.length > 0).length;
}

function hasPersian(text) {
  return /[؀-ۿ]/.test(text || '');
}

// ── EVL Stage 1: Engine-specific API validation protocols ─────────────────────
// Each protocol calls the live /api/generate endpoint, inspects the returned
// package, and returns { passed, checks, evidence }.

async function _generate(engine, contentFormat) {
  const body = {
    engine,
    mood:
      engine === 'SRV Farsi'
        ? 'romantic'
        : engine === 'SRV English'
        ? 'emotional'
        : 'AI Tools',
    contentFormat: contentFormat || 'short',
    taskName: 'EVL Validation Run',
    recentPackages: [],
  };
  const result = await mmosPost('/api/generate', body);
  if (!result.success || !result.package)
    throw new Error(`Generate call failed: ${JSON.stringify(result).slice(0, 300)}`);
  return result.package;
}

async function _validateAIStudioShort() {
  const TARGET_MIN = 85;
  const TARGET_MAX = 115;
  const ATTEMPTS = 3;
  const REQUIRED_PASS = 2;
  const attempts = [];
  let passCount = 0;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const pkg = await _generate('AI Studio', 'short');
      const script = pkg.script || '';
      const wc = countWords(script);
      const pass = wc >= TARGET_MIN && wc <= TARGET_MAX;
      if (pass) passCount++;
      attempts.push({ attempt: i + 1, wordCount: wc, pass, excerpt: script.slice(0, 180) });
    } catch (e) {
      attempts.push({ attempt: i + 1, wordCount: null, pass: false, error: e.message });
    }
  }
  const passed = passCount >= REQUIRED_PASS;
  return {
    protocol: 'ai_studio_short_word_count',
    target: `${TARGET_MIN}–${TARGET_MAX} words → 35–45 s at 160 wpm`,
    passRate: `${passCount}/${ATTEMPTS}`,
    passed,
    attempts,
    note: 'API-level check only. Operator UI validation required to verify rendered video duration.',
  };
}

async function _validateAIStudioLong() {
  const pkg = await _generate('AI Studio', 'long');
  const wc = countWords(pkg.script || '');
  const passed = wc >= 850 && wc <= 1100;
  return {
    protocol: 'ai_studio_long_word_count',
    target: '850–1100 words → 7–9 min at 160 wpm',
    wordCount: wc,
    passed,
    excerpt: (pkg.script || '').slice(0, 200),
    note: 'API-level check only. Operator UI validation required to verify rendered video duration.',
  };
}

async function _validateSRVFarsi() {
  const pkg = await _generate('SRV Farsi', 'short');
  const lyrics = pkg.lyrics || '';
  const persianOk = hasPersian(lyrics);
  const wc = countWords(lyrics);
  const lengthOk = wc >= 60;
  const moodOk = !!pkg.mood;
  const passed = persianOk && lengthOk && moodOk;
  return {
    protocol: 'srv_farsi_content',
    checks: { persian_chars: persianOk, lyrics_word_count: `${wc} (need ≥ 60)`, mood_present: moodOk },
    passed,
    excerpt: lyrics.slice(0, 200),
  };
}

async function _validateSRVEnglish() {
  const pkg = await _generate('SRV English', 'short');
  const lyrics = pkg.lyrics || '';
  const wc = countWords(lyrics);
  const lengthOk = wc >= 60;
  const moodOk = !!pkg.mood;
  const noPersian = !hasPersian(lyrics);
  const passed = lengthOk && moodOk && noPersian;
  return {
    protocol: 'srv_english_content',
    checks: {
      lyrics_word_count: `${wc} (need ≥ 60)`,
      mood_present: moodOk,
      no_persian_bleed: noPersian,
    },
    passed,
    excerpt: lyrics.slice(0, 200),
  };
}

async function _validateNextWave() {
  const pkg = await _generate('NextWave', 'short');
  const wc = countWords(pkg.script || '');
  const passed = wc >= 110 && wc <= 160;
  return {
    protocol: 'nextwave_word_count',
    target: '110–160 words → 45–60 s at 160 wpm',
    wordCount: wc,
    passed,
    excerpt: (pkg.script || '').slice(0, 180),
  };
}

async function _runProtocol(task) {
  const engine = (task.affected_engine || '').toLowerCase().replace(/\s+/g, '_');
  const criteria = (task.acceptance_criteria || '').toLowerCase();
  const isLong =
    criteria.includes('long video') ||
    criteria.includes('7-10 min') ||
    criteria.includes('7–9 min') ||
    (task.packet && task.packet.contentFormat === 'long');

  if (engine === 'ai_studio') return isLong ? _validateAIStudioLong() : _validateAIStudioShort();
  if (engine === 'srv_farsi') return _validateSRVFarsi();
  if (engine === 'srv_english') return _validateSRVEnglish();
  if (engine === 'nextwave') return _validateNextWave();

  try {
    const engineLabel = engine === 'all' || engine === 'system' ? 'AI Studio' : engine;
    await _generate(engineLabel, 'short');
    return { protocol: 'generic_generate', passed: true, note: `No specific protocol for "${engine}" — generate endpoint responded successfully.` };
  } catch (e) {
    return { protocol: 'generic_generate', passed: false, error: e.message };
  }
}

// ── EVL Stage 2: Operator UI validation protocols ─────────────────────────────
// These are the WHAT-TO-CHECK specs returned to Claude when it needs to run
// the full UI lifecycle. Claude executes these steps via Claude in Chrome.

const UI_VALIDATION_PROTOCOLS = {
  ai_studio: {
    engine_label: 'AI Studio',
    short: {
      lifecycle_steps: [
        'Navigate to MMMOS Tasks tab',
        'Find or create an AI Studio Short task (Sunday = Short)',
        'Click Generate — wait for script generation (~10–30s)',
        'RECORD: script word count (accept 85–115 words)',
        'Click Next to advance to Review stage',
        'Click Build — HeyGen render starts (~5–15 min)',
        'Poll Check Status until render complete — video URL appears',
        'RECORD: videoUrl from package',
        'Measure rendered video duration via JavaScript: document.querySelector("video").duration',
        'ACCEPTANCE CHECK: duration must be 35–45 seconds',
        'Post-process runs automatically (canvas logo + music)',
        'RECORD: post-processed video URL or blob URL',
        'Click Approve to advance to Publish stage',
        'DO NOT publish to YouTube — stop here for Short validation',
        'RECORD: lifecycle stages reached (Generate ✓, Build ✓, Approve ✓)',
      ],
      acceptance_criteria: {
        script_word_count: '85–115 words (proxy for 35–45s at HeyGen cadence)',
        rendered_duration: '35–45 seconds (measured from video element)',
        lifecycle_completion: 'Generate → Build → Approve reached without errors',
        long_unaffected: 'Not tested in this run (separate task if needed)',
        engines_untouched: 'SRV Farsi and SRV English pipelines not modified',
      },
    },
    long: {
      lifecycle_steps: [
        'Navigate to MMMOS Tasks tab',
        'Find or create an AI Studio Long task (Friday = Long)',
        'Click Generate — wait for script generation (~30–60s for Long)',
        'RECORD: script word count (accept 850–1100 words)',
        'Click Next to advance to Review stage',
        'Click Build — HeyGen render starts (~10–25 min for Long)',
        'Poll Check Status until render complete',
        'RECORD: videoUrl from package',
        'Measure rendered video duration: must be 7–10 minutes (420–600 seconds)',
        'Click Approve',
        'DO NOT publish to YouTube — stop here for validation',
        'RECORD: lifecycle stages reached',
      ],
      acceptance_criteria: {
        script_word_count: '850–1100 words',
        rendered_duration: '420–600 seconds (7–10 minutes)',
        lifecycle_completion: 'Generate → Build → Approve without errors',
      },
    },
  },
  srv_farsi: {
    engine_label: 'SRV Farsi',
    short: {
      lifecycle_steps: [
        'Navigate to MMMOS Tasks tab',
        'Find SRV Farsi Short task (Sat or Sun)',
        'Click Generate — wait for lyrics generation',
        'RECORD: lyrics (must contain Persian chars, ≥60 words)',
        'RECORD: mood field',
        'Click Next → Build → HeyGen render (~5–10 min)',
        'RECORD: videoUrl',
        'Verify video plays and avatar is visible',
        'DO NOT publish — stop at Approve',
      ],
      acceptance_criteria: {
        lyrics_persian: 'Must contain Persian/Farsi characters',
        lyrics_word_count: '≥60 words',
        mood_field: 'Must be present',
        video_renders: 'HeyGen returns a valid video URL',
      },
    },
  },
  srv_english: {
    engine_label: 'SRV English',
    short: {
      lifecycle_steps: [
        'Navigate to MMMOS Tasks tab',
        'Find SRV English Short task',
        'Click Generate — wait for lyrics generation',
        'RECORD: lyrics (must be English, ≥60 words, no Persian chars)',
        'RECORD: mood field',
        'Click Next → Build → render',
        'RECORD: videoUrl',
        'DO NOT publish — stop at Approve',
      ],
      acceptance_criteria: {
        lyrics_english: 'No Persian characters present',
        lyrics_word_count: '≥60 words',
        mood_field: 'Must be present',
        video_renders: 'HeyGen returns a valid video URL',
      },
    },
  },
  nextwave: {
    engine_label: 'NextWave',
    short: {
      lifecycle_steps: [
        'Navigate to MMMOS Tasks tab',
        'Find NextWave Short task',
        'Click Generate — wait for script generation',
        'RECORD: script word count (accept 110–160 words)',
        'Click Next → Build → render',
        'RECORD: videoUrl',
        'DO NOT publish — stop at Approve',
      ],
      acceptance_criteria: {
        script_word_count: '110–160 words',
        video_renders: 'HeyGen returns a valid video URL',
      },
    },
  },
};

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'eb_list_tasks',
    description:
      'List engineering tasks from the Engineering Brain. ' +
      'Filter by status: open | in_progress | testing | blocked | done | ready_for_ceo. ' +
      '"testing" = API-level EVL passed, awaiting operator UI validation. ' +
      '"ready_for_ceo" = both API and UI validation passed. ' +
      'Returns id, problem, status, priority, affected_engine, acceptance_criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description:
            'Optional status filter: open | in_progress | testing | blocked | done | ready_for_ceo',
        },
      },
    },
  },
  {
    name: 'eb_load_task',
    description:
      'Load a single engineering task by UUID. ' +
      'Returns all fields: problem, expected_result, acceptance_criteria, affected_engine, priority, status, packet (test_results, deployment_version, ready_for_ceo, notes).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the engineering task' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'eb_read_section',
    description:
      'Read one section of the Engineering Brain. ' +
      'Sections: overview | constitution | architecture | engine_registry | protected_registry | shared_systems | regression_rules',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description:
            'Section name: overview | constitution | architecture | engine_registry | protected_registry | shared_systems | regression_rules',
        },
      },
      required: ['section'],
    },
  },
  {
    name: 'eb_read_all_brain',
    description:
      'Read the COMPLETE Engineering Brain — all sections grouped by name. ' +
      'Use at the start of every task to load constitution rules, architecture reference, engine registry, protected systems, and shared components. ' +
      'This is your primary context loader before touching any code.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'eb_update_task',
    description:
      'Update an engineering task. Can set: status, test_results, deployment_version, ready_for_ceo, notes. ' +
      'Setting ready_for_ceo=true automatically sets status=ready_for_ceo. ' +
      'All packet fields are merged (not replaced). ' +
      'NOTE: Do not manually set ready_for_ceo=true — use eb_record_operator_validation after UI validation.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the task' },
        status: {
          type: 'string',
          description:
            'New status: open | in_progress | testing | blocked | done | ready_for_ceo',
        },
        test_results: {
          type: 'string',
          description: 'Test results summary — what was tested and what passed/failed',
        },
        deployment_version: {
          type: 'string',
          description: 'Version deployed, e.g. v13.78.3',
        },
        ready_for_ceo: {
          type: 'boolean',
          description:
            'Set true only after operator UI validation passes via eb_record_operator_validation',
        },
        notes: { type: 'string', description: 'Implementation notes, decisions made, known limitations' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'eb_create_task',
    description: 'Create a new engineering task in the Engineering Brain task queue.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: { type: 'string', description: 'Clear description of the problem to solve' },
        expected_result: {
          type: 'string',
          description: 'What the system should do after the fix',
        },
        affected_engine: {
          type: 'string',
          description:
            'Which engine or system is affected: srv_farsi | srv_english | ai_studio | nextwave | system | finance | all',
        },
        priority: {
          type: 'string',
          description: 'P1 (critical/production broken) | P2 (important) | P3 (nice to have)',
        },
        acceptance_criteria: {
          type: 'string',
          description:
            'Specific, testable criteria that define when this task is DONE. Be precise — this is what the validation loop will check.',
        },
      },
      required: ['problem', 'expected_result', 'affected_engine', 'priority', 'acceptance_criteria'],
    },
  },
  {
    name: 'eb_get_system_version',
    description:
      'Get the current deployed MMMOS system version and overview from the Engineering Brain.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'eb_validate_task',
    description:
      'EVL Stage 1 — API-level validation. Runs after every deploy, BEFORE operator UI validation.\n' +
      'Executes the affected engine\'s generation pipeline against the live Vercel deployment,\n' +
      'validates the result against acceptance criteria, retries for LLM variance.\n\n' +
      'Status transitions:\n' +
      '  PASS → status = "testing" (API check passed; operator UI validation still required)\n' +
      '  FAIL → status = "in_progress" (fix needed before UI validation)\n\n' +
      'After this returns PASS with status="testing", Claude must:\n' +
      '  1. Open MMMOS in Chrome (mmm-static.vercel.app)\n' +
      '  2. Run the full operator lifecycle for the affected engine\n' +
      '  3. Call eb_record_operator_validation with the UI evidence\n' +
      '  Only then is the task promoted to ready_for_ceo.\n\n' +
      'Engine protocols (API level):\n' +
      '  ai_studio (short) — 3× generate, 2/3 must pass, script word count 85–115 words\n' +
      '  ai_studio (long)  — 1× generate, script word count 850–1100 words\n' +
      '  srv_farsi         — 1× generate, Persian chars + lyrics ≥60 words + mood field\n' +
      '  srv_english       — 1× generate, English lyrics ≥60 words + mood + no Persian bleed\n' +
      '  nextwave          — 1× generate, script word count 110–160 words',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'UUID of the engineering task to validate',
        },
        deployment_version: {
          type: 'string',
          description: 'Version just deployed, e.g. v13.78.4 — recorded in the task packet',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'eb_create_intelligent_task',
    description:
      'Task Intelligence v2 — CEO enters only 4 fields; Brain auto-generates the full Engineering Packet.\n\n' +
      'Reads the Engineering Brain from Supabase and generates:\n' +
      '  • Relevant constitution rules\n' +
      '  • Engine specification (from engine_registry)\n' +
      '  • Protected components for this engine\n' +
      '  • Shared dependencies\n' +
      '  • Regression risks (from regression_rules)\n' +
      '  • Auto-derived acceptance criteria\n' +
      '  • EVL Stage 1 (API) validation plan\n' +
      '  • EVL Stage 2 (Operator UI) validation plan + lifecycle steps\n' +
      '  • Deployment checks\n' +
      '  • Retry rules\n' +
      '  • CEO test steps\n\n' +
      'The complete packet is stored in the engineering_tasks table and available to any future agent or session via eb_load_task.\n\n' +
      'Use this instead of eb_create_task for all new production tasks. ' +
      'eb_create_task remains available for edge cases requiring manual packet control.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: {
          type: 'string',
          description: 'Clear description of the problem to solve (CEO language, no technical detail required)',
        },
        expected_result: {
          type: 'string',
          description: 'What the system should do after the fix (CEO language)',
        },
        affected_engine: {
          type: 'string',
          description:
            'Which engine is affected: srv_farsi | srv_english | ai_studio | nextwave | system | finance | all',
        },
        priority: {
          type: 'string',
          description: 'P1 (critical/production broken) | P2 (important) | P3 (nice to have)',
        },
      },
      required: ['problem', 'expected_result', 'affected_engine', 'priority'],
    },
  },
  {
    name: 'eb_record_operator_validation',
    description:
      'EVL Stage 2 v3 — Record results of the full UI lifecycle validation through the APPROVE stage.\n\n' +
      'REQUIRED workflow — Claude must complete ALL steps before calling this tool:\n' +
      '  1. Drive full lifecycle: Generate → Review → Build → APPROVE (stop here, never Publish)\n' +
      '  2. Open the Approve page\n' +
      '  3. Play the final rendered video FROM the Approve page (not a download or intermediate file)\n' +
      '  4. Verify EVERY checklist item against the playing Approve-page video\n' +
      '  5. If ANY item fails: diagnose root cause → fix code → redeploy → rerun full lifecycle →\n' +
      '     return to Approve → recheck video → repeat until all pass\n' +
      '  6. Only call this tool when ALL checklist items pass\n\n' +
      'AI Studio visual checklist (ALL must pass):\n' +
      '  - short_duration_pass: Short video duration within target range\n' +
      '  - long_duration_pass: Long video duration within target (if applicable)\n' +
      '  - logo_visible: "AI CREATION STUDIO" logo visibly present on video\n' +
      '  - music_audible: Background music clearly audible in video\n' +
      '  - voice_clear: Voice remains clear, correctly mixed with music\n' +
      '  - captions_correct: Captions render correctly throughout\n' +
      '  - video_plays_in_approve: Final video plays successfully in the Approve step\n\n' +
      'Status transitions:\n' +
      '  PASS → status = "ready_for_ceo" (CEO reviews ONLY the Approve-page video)\n' +
      '  FAIL → status = "in_progress" (auto-loop: diagnose → fix → redeploy → rerun → Approve → recheck)\n\n' +
      'This is the ONLY path to ready_for_ceo. CEO must never discover engineering defects.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'UUID of the engineering task',
        },
        passed: {
          type: 'boolean',
          description: 'True only if ALL checklist items passed after reviewing the Approve-page video',
        },
        lifecycle_stages_passed: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Lifecycle stages completed without error. MUST include "Approve" — e.g. ["Generate","Review","Build","Approve"]',
        },
        approve_video_url: {
          type: 'string',
          description: 'URL of the video playing on the Approve page (not a download link or intermediate file)',
        },
        approve_video_played: {
          type: 'boolean',
          description: 'Confirm the video was actually played from the Approve page before checklist verification',
        },
        visual_checklist: {
          type: 'object',
          description:
            'AI Studio 7-item visual checklist verified against the Approve-page video. ' +
            'Each value is "PASS — <evidence>" or "FAIL — <what was observed>". ' +
            'Keys: logo_visible, music_audible, voice_clear, captions_correct, ' +
            'short_duration_pass, video_plays_in_approve, long_duration_pass (if applicable)',
          properties: {
            logo_visible: { type: 'string' },
            music_audible: { type: 'string' },
            voice_clear: { type: 'string' },
            captions_correct: { type: 'string' },
            short_duration_pass: { type: 'string' },
            video_plays_in_approve: { type: 'string' },
            long_duration_pass: { type: 'string' },
          },
        },
        rendered_duration_seconds: {
          type: 'number',
          description: 'Video duration in seconds measured from the Approve-page video element',
        },
        script_word_count: {
          type: 'number',
          description: 'Word count of the generated script or lyrics',
        },
        video_url: {
          type: 'string',
          description: 'URL of the rendered HeyGen video (raw or proxy) — use approve_video_url for the Approve-page video',
        },
        acceptance_criteria_results: {
          type: 'object',
          description:
            'Key-value map of each acceptance criterion to PASS/FAIL + measurement, e.g. {"Duration 35-45s": "PASS — 38.2s measured"}',
        },
        failure_reason: {
          type: 'string',
          description: 'If passed=false, describe what failed and what was observed in the Approve-page video',
        },
        evidence_notes: {
          type: 'string',
          description:
            'Additional evidence: console logs, timing, what the operator saw, auto-loop iterations',
        },
        deployment_version: {
          type: 'string',
          description: 'Version that was validated, e.g. v13.78.7',
        },
      },
      required: ['task_id', 'passed'],
    },
  },

  // ── Engineering Worker tools (Decision #17 Step 2B) ──────────────────────────
  // All nine call the existing governed MMMOS HTTP actions via mmosOps() using
  // this server's single standing worker credential (never a tool input —
  // it is read only from local file/environment configuration via
  // _loadWorkerCredential(), never exposed through any tool schema or
  // result). None of these accept or return a
  // worker_credential or per-task agent_token: Decision #17 Step 2A already
  // made the worker's own claimed identity sufficient proof for the Gateway.
  {
    name: 'eb_worker_list_authorized_tasks',
    description:
      'List Engineering Tasks that a CEO has authorized for an agent to claim and that are ' +
      'currently unclaimed (or whose prior claim lease expired). Calls the governed action ' +
      'engineering_worker_list_authorized_tasks (Decision #16 Step 2C) using this server\'s ' +
      'standing worker credential. Returns only id/problem (truncated)/affected_engine/priority/' +
      'agent_authorized_at — never the full packet or authorization boundary; read those after ' +
      'claiming via eb_worker_read_task_packet / eb_worker_read_authorization_boundary.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'eb_worker_claim_task',
    description:
      'Claim one CEO-authorized Engineering Task as this registered Engineering Worker. Calls ' +
      'the governed action engineering_worker_claim_task (Decision #16 Step 2C), which ' +
      'independently re-verifies worker identity AND CEO task authorization server-side before ' +
      'granting the claim — worker identity alone is never sufficient. On success, returns ' +
      'run_id and lease_expires_at; pass run_id as agent_run_id to every subsequent ' +
      'eb_worker_read_*/write_*/submit_* call for this task. Fails if the task is not CEO-' +
      'authorized, is already validly claimed by another worker, or this worker\'s credential ' +
      'is invalid/revoked.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'UUID of the Engineering Task to claim' } },
      required: ['task_id'],
    },
  },
  {
    name: 'eb_worker_read_task_packet',
    description:
      'Read the full task packet (problem, expected_result, affected_engine, priority, packet) ' +
      'for a task this worker has claimed. Calls the existing Agent Gateway ' +
      '(engineering_agent_gateway, op=read_task_packet) — the same Gateway used by the legacy ' +
      'per-task-token path, unmodified. Requires the run_id returned by eb_worker_claim_task; ' +
      'fails if the claim, lease, or worker identity no longer independently verify.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
      },
      required: ['task_id', 'agent_run_id'],
    },
  },
  {
    name: 'eb_worker_read_authorization_boundary',
    description:
      'Read the CEO-set authorization boundary text for a claimed task — the scope this ' +
      'Engineering Worker is actually authorized to act within. Calls the existing Agent Gateway ' +
      '(op=read_authorization_boundary). Always read this before doing any work — the Gateway ' +
      'enforces the boundary independently for file operations, but the text itself explains ' +
      'the CEO\'s intent for anything the Gateway does not mechanically check.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
      },
      required: ['task_id', 'agent_run_id'],
    },
  },
  {
    name: 'eb_worker_read_authorized_file',
    description:
      'Read one file from this task\'s isolated, database-backed workspace (never the real ' +
      'repository) at a path within this task\'s CEO-set read_paths scope. Calls the existing ' +
      'Agent Gateway (op=read_authorized_file). A path outside the task\'s stored ' +
      'agent_capability_scope is denied server-side — this tool cannot expand what it can read.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
        path: { type: 'string', description: 'Root-relative path within the task\'s authorized read_paths' },
      },
      required: ['task_id', 'agent_run_id', 'path'],
    },
  },
  {
    name: 'eb_worker_write_authorized_file',
    description:
      'Write one file in this task\'s isolated, database-backed workspace (never the real ' +
      'repository) at a path within this task\'s CEO-set write_paths scope. Calls the existing ' +
      'Agent Gateway (op=write_authorized_file). A path outside the task\'s stored ' +
      'agent_capability_scope is denied server-side. The write is recorded as evidence ' +
      '(baseline/current diff) automatically — this never touches the live deployed site.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
        path: { type: 'string', description: 'Root-relative path within the task\'s authorized write_paths' },
        content: { type: 'string', description: 'New full content for the file (up to 20000 chars)' },
      },
      required: ['task_id', 'agent_run_id', 'path', 'content'],
    },
  },
  {
    name: 'eb_worker_validate_javascript_syntax',
    description:
      'Run a syntax-only check (parse, never execute) against this task\'s current workspace ' +
      'content for a path within its authorized validation_ops scope. Calls the existing Agent ' +
      'Gateway (op=validate_javascript_syntax). Denied server-side for any path or task not ' +
      'explicitly authorized for this validation op.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
        path: { type: 'string', description: 'Root-relative path to validate' },
      },
      required: ['task_id', 'agent_run_id', 'path'],
    },
  },
  {
    name: 'eb_worker_submit_execution_plan',
    description:
      'Submit a non-authoritative execution plan as evidence on this claimed task, before or ' +
      'during work. Calls the existing Agent Gateway (op=submit_execution_plan). Recorded ' +
      'evidence only — never authorizes or begins execution, never changes task status.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
        plan: { type: 'string', description: 'Execution plan text (up to 5000 chars)' },
      },
      required: ['task_id', 'agent_run_id', 'plan'],
    },
  },
  {
    name: 'eb_worker_submit_evidence',
    description:
      'Submit evidence (a note, test result, screenshot URL, or execution plan) for this ' +
      'claimed task — the governed way for this Engineering Worker to return results into the ' +
      'MMMOS workflow. Calls the existing Agent Gateway (op=submit_evidence). Evidence is ' +
      'explicitly non-authoritative: it never sets task status, ceo_decision, or any approval ' +
      'field — the task still surfaces in normal CEO Engineering Review for the CEO\'s own ' +
      'Approve/Reject decision, exactly as any other agent-executed task does today.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
        evidence_type: {
          type: 'string',
          description: 'One of: note | test_result | screenshot_url | execution_plan',
        },
        title: { type: 'string', description: 'Short evidence title (up to 300 chars)' },
        content: { type: 'string', description: 'Evidence content (up to 5000 chars)' },
      },
      required: ['task_id', 'agent_run_id', 'evidence_type', 'title', 'content'],
    },
  },
  {
    name: 'eb_worker_submit_commit_sha',
    description:
      'Report the exact commit SHA this claimed task\'s completed work produced. Calls the ' +
      'existing Agent Gateway (op=submit_commit_sha), the ONLY path that writes ' +
      'engineering_tasks.git_commit_sha for a normal "new_development" task. All validation — ' +
      'SHA format, existence in the canonical GitHub repository, reachability from main, task/run ' +
      'ownership — happens server-side in api/ops.js; this tool duplicates none of it locally and ' +
      'never accepts or returns a worker credential. The write is immutable once accepted: a task ' +
      'that already has a git_commit_sha recorded will reject a different value (409), and an ' +
      'already CEO-approved/rejected task rejects any value (409). Not applicable to ' +
      'retroactive_release tasks, which carry their SHA through a separate, already-reviewed path.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the claimed task' },
        agent_run_id: { type: 'string', description: 'run_id returned by eb_worker_claim_task for this task' },
        commit_sha: { type: 'string', description: 'The 40-character hex commit SHA the completed work produced' },
      },
      required: ['task_id', 'agent_run_id', 'commit_sha'],
    },
  },
  {
    name: 'eb_worker_execute_production_release',
    description:
      'Execute an ALREADY CEO-authorized production release. Calls the existing governed ' +
      'engineering_worker_execute_production_release action directly (not a Gateway op — that ' +
      'action is deliberately outside the Agent Gateway\'s allowed-ops list server-side). This ' +
      'tool can never create a Production Release Authorization — that remains a CEO-session-' +
      'gated decision made only through the MMMOS CEO UI. It can only execute a ' +
      'production_release_authorizations row that already exists with status="authorized". ' +
      'Every server-side gate still applies independently at execution time: worker credential ' +
      'validity, authorization status, the linked engineering task still being CEO-approved, the ' +
      'expected_commit_sha matching the authorized commit exactly (a confused-deputy guard — this ' +
      'never lets the worker choose or override the authorized commit), and a fresh live GitHub ' +
      'branch-head check. Executes once; a failed or ambiguous result is never auto-retried — a ' +
      'new CEO authorization is required to try again.',
    inputSchema: {
      type: 'object',
      properties: {
        production_release_authorization_id: { type: 'string', description: 'UUID of the CEO-created production_release_authorizations row to execute' },
        expected_commit_sha: { type: 'string', description: 'The 40-character hex commit SHA this worker expects to be deploying — must exactly match the authorization\'s commit_sha or the call is rejected' },
      },
      required: ['production_release_authorization_id', 'expected_commit_sha'],
    },
  },
  {
    name: 'eb_worker_submit_task',
    description:
      'Create a new Engineering Task through the governed worker-credential path. Calls the ' +
      'existing engineering_worker_submit_task action directly (api/ops.js, v16.50.0 Step 2E) -- ' +
      'the SAME canonical insert path (_insertEngineeringTaskRow) the CEO\'s own Task Generator UI ' +
      'uses: same packet generation, same created_via=\'task_generator\' stamp, same downstream ' +
      'governance. This exists because the standalone eb_create_task/eb_create_intelligent_task ' +
      'tools write directly to Supabase REST with this server\'s low-privilege publishable key, ' +
      'which engineering_tasks\' RLS correctly rejects (no INSERT policy for any non-service-role ' +
      'caller -- RLS working as designed, not a defect). This tool never touches Supabase directly ' +
      'and never uses that key for a write; the actual insert happens server-side in api/ops.js ' +
      'under the service role, gated only by worker-credential authentication. It creates ONLY a ' +
      'task row (status=\'open\'), landing exactly where any Task-Generator-created task lands, ' +
      'awaiting normal CEO Engineering Review -- it never sets agent_authorized_at and cannot ' +
      'approve, authorize, or execute anything itself. Pass submission_idempotency_key to make a ' +
      'retry safe: a prior submission with the same key is returned as-is instead of creating a ' +
      'second row.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: { type: 'string', description: 'Clear description of the problem/objective (CEO language)' },
        expected_result: { type: 'string', description: 'What the system should do once this is done (CEO language)' },
        affected_engine: { type: 'string', description: 'Which engine is affected: srv_farsi | srv_english | ai_studio | nextwave | system | finance | all' },
        priority: { type: 'string', description: 'P1 (critical) | P2 (important) | P3 (nice to have), or high/medium/low' },
        acceptance_criteria: { type: 'string', description: 'Optional explicit acceptance criteria; omit to let the Brain auto-derive them' },
        submission_idempotency_key: { type: 'string', description: 'Optional key to make resubmission safe (dedup on the server)' },
      },
      required: ['problem', 'expected_result', 'affected_engine'],
    },
  },
  {
    name: 'eb_worker_connect_request',
    description:
      'Step 1 of the Decision #17 Step 2D secure pairing flow — begins connecting this ' +
      'Cowork installation to MMMOS as a registered Engineering Worker, with no CEO file editing, ' +
      'Terminal use, or manual credential relay. Generates a one-time pairing secret locally ' +
      '(never sent to MMMOS or returned in this tool\'s own result), sends only its hash to MMMOS, ' +
      'and creates a pending connection request the CEO will see in the Engineering Workers panel. ' +
      'Call eb_worker_connect_finish afterward, once the CEO has approved it there.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Optional label for this worker identity (defaults to "Cowork — Primary Engineering Worker")' },
      },
    },
  },
  {
    name: 'eb_worker_connect_finish',
    description:
      'Step 2 of the Decision #17 Step 2D secure pairing flow — call this after the CEO has ' +
      'clicked "Approve Connection" in the Engineering Workers panel for a request started with ' +
      'eb_worker_connect_request. Proves possession of the locally-held pairing secret to MMMOS; ' +
      'if the CEO\'s approval and this proof both check out, MMMOS mints a real worker credential ' +
      'and returns it directly to this call, which stores it locally for every other eb_worker_* ' +
      'tool to use. The credential itself is never included in this tool\'s result. If the CEO ' +
      'has not approved yet, this reports that clearly so it can be retried later.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── MMMOS Engineering Integration R2: runner tools ──────────────────────────
  // The automatic runner uses ONLY these runner-mode tools to find and claim
  // work, so it can never pick up a task the CEO did not make runner-eligible
  // (the server enforces the same rule independently).
  {
    name: 'eb_runner_list_eligible_tasks',
    description: 'RUNNER: list tasks the CEO explicitly authorized for the automatic runner (never pre-R2 or manual-only tasks). Returns id, problem, business.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'eb_runner_claim_task',
    description: 'RUNNER: claim one runner-eligible task. The server refuses any task that is not runner-eligible. Returns run_id — pass it as agent_run_id to every other call for this task.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'eb_worker_read_runner_scope',
    description: 'Read which repository folders/files this claimed task may change, the always-denied files, and the working rules.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, agent_run_id: { type: 'string' } }, required: ['task_id', 'agent_run_id'] },
  },
  {
    name: 'eb_worker_renew_lease',
    description: 'Extend this claim\'s 30-minute lease. Call at least every 20 minutes during long work. Stops working 8 hours after the claim.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, agent_run_id: { type: 'string' } }, required: ['task_id', 'agent_run_id'] },
  },
  {
    name: 'eb_worker_read_adviser_followups',
    description: 'Read follow-up instructions (corrections, questions, notes, acceptance) the CEO Adviser posted on this claimed task.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, agent_run_id: { type: 'string' } }, required: ['task_id', 'agent_run_id'] },
  },
  {
    name: 'eb_worker_upload_artifact',
    description: 'Upload a local file (MP4, screenshot, QA report, checkpoint, source bundle) to the task\'s private MMMOS storage and record it as evidence. local_path must be an absolute path inside ~/mmm-static-wt/ or ~/MMM/. Max 500 MB.',
    inputSchema: { type: 'object', properties: {
      task_id: { type: 'string' }, agent_run_id: { type: 'string' }, local_path: { type: 'string' },
      artifact_kind: { type: 'string', description: 'video | screenshot | source | checkpoint | qa_report | other' },
      title: { type: 'string' }, description: { type: 'string' } }, required: ['task_id', 'agent_run_id', 'local_path'] },
  },
  {
    name: 'eb_worker_submit_pull_request',
    description: 'Record the pull request this task produced. MMMOS reads the branch from GitHub itself and refuses it if any changed file is outside the task\'s allowed folders. Never merges or deploys.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, agent_run_id: { type: 'string' }, pr_url: { type: 'string' }, branch: { type: 'string' } }, required: ['task_id', 'agent_run_id', 'pr_url', 'branch'] },
  },
];

// R2 — artifact upload helpers. Only files under these roots may be uploaded,
// so a confused runner can never ship e.g. ~/.ssh or app credentials.
const ARTIFACT_ROOTS = [path.join(process.env.HOME || '', 'mmm-static-wt') + path.sep, path.join(process.env.HOME || '', 'MMM') + path.sep];
const ARTIFACT_TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', json: 'application/json', zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar',
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', html: 'text/html', csv: 'text/csv', mp3: 'audio/mpeg', wav: 'audio/wav' };
function _artifactFile(localPath) {
  const real = fs.realpathSync(String(localPath || ''));
  if (!ARTIFACT_ROOTS.some(r => real.startsWith(r))) throw new Error('local_path must be inside ~/mmm-static-wt/ or ~/MMM/');
  if (real.split(path.sep).some(seg => seg.startsWith('.') && seg !== '.')) throw new Error('hidden files and folders cannot be uploaded');
  const st = fs.statSync(real);
  if (!st.isFile()) throw new Error('local_path is not a file');
  if (st.size > 500 * 1024 * 1024) throw new Error('file is larger than 500 MB');
  const ext = path.extname(real).slice(1).toLowerCase();
  const type = ARTIFACT_TYPES[ext];
  if (!type) throw new Error('file type not allowed: .' + ext);
  const name = path.basename(real).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, 'f').slice(-140);
  return { real, size: st.size, type, name };
}
function _putSigned(uploadUrl, file) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.supabase.co')) return reject(new Error('unexpected upload host'));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'PUT',
      headers: { 'Content-Type': file.type, 'Content-Length': String(file.size), 'x-upsert': 'false' } }, (res) => {
      let data = ''; res.on('data', d => (data += d)); res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error(`upload failed ${res.statusCode}: ${data.slice(0, 200)}`)));
    });
    req.on('error', reject);
    fs.createReadStream(file.real).on('error', reject).pipe(req);
  });
}

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function callTool(name, args) {
  // ── eb_list_tasks ──
  if (name === 'eb_list_tasks') {
    // R2 (B10): read through the governed worker action when a worker
    // credential is configured; the public-key read below is the fallback
    // and stops working once the B10 migration removes public reads.
    const cred = _loadWorkerCredential();
    if (cred) {
      // Only a confirmed answer from a server that has this action is used;
      // an older server (no such action) falls back to the read below.
      const r = await mmosOps('engineering_worker_read_tasks', { worker_credential: cred, ...(args.status ? { status: args.status } : {}) }).catch(() => null);
      if (r && r.ok === true && Array.isArray(r.tasks)) {
        if (!r.tasks.length) return 'No tasks found' + (args.status ? ` with status: ${args.status}` : '') + '.';
        return JSON.stringify(r.tasks, null, 2);
      }
    }
    let path =
      'engineering_tasks?select=id,problem,status,priority,affected_engine,acceptance_criteria,created_at,updated_at&order=created_at.desc';
    if (args.status) path += `&status=eq.${encodeURIComponent(args.status)}`;
    const rows = await sbRequest('GET', path);
    if (!rows?.length)
      return 'No tasks found' + (args.status ? ` with status: ${args.status}` : '') + '.';
    return JSON.stringify(rows, null, 2);
  }

  // ── eb_load_task ──
  if (name === 'eb_load_task') {
    const cred = _loadWorkerCredential(); // R2 (B10): governed read first
    if (cred) {
      const r = await mmosOps('engineering_worker_read_tasks', { worker_credential: cred, task_id: args.task_id }).catch(() => null);
      if (r && r.ok === true && r.task) return JSON.stringify(r.task, null, 2);
    }
    const rows = await sbRequest(
      'GET',
      `engineering_tasks?id=eq.${encodeURIComponent(args.task_id)}&select=*`
    );
    if (!rows?.length) throw new Error(`Task ${args.task_id} not found`);
    return JSON.stringify(rows[0], null, 2);
  }

  // ── eb_read_section ──
  if (name === 'eb_read_section') {
    const rows = await sbRequest(
      'GET',
      `engineering_brain?section=eq.${encodeURIComponent(args.section)}&select=key,title,data&order=sort_order`
    );
    if (!rows?.length) throw new Error(`Section "${args.section}" not found or empty`);
    return JSON.stringify(rows, null, 2);
  }

  // ── eb_read_all_brain ──
  if (name === 'eb_read_all_brain') {
    const rows = await sbRequest(
      'GET',
      'engineering_brain?select=section,key,title,data&order=section,sort_order'
    );
    const grouped = {};
    for (const row of rows || []) {
      if (!grouped[row.section]) grouped[row.section] = [];
      grouped[row.section].push({ key: row.key, title: row.title, data: row.data });
    }
    return JSON.stringify(grouped, null, 2);
  }

  // ── eb_update_task ──
  if (name === 'eb_update_task') {
    const { task_id, status, test_results, deployment_version, ready_for_ceo, notes } = args;
    const curr = await sbRequest(
      'GET',
      `engineering_tasks?id=eq.${encodeURIComponent(task_id)}&select=packet,status`
    );
    if (!curr?.length) throw new Error(`Task ${task_id} not found`);
    const packet = { ...(curr[0].packet || {}) };
    const update = { updated_at: new Date().toISOString() };
    if (status) update.status = status;
    if (test_results !== undefined) packet.test_results = test_results;
    if (deployment_version !== undefined) packet.deployment_version = deployment_version;
    if (ready_for_ceo !== undefined) {
      packet.ready_for_ceo = ready_for_ceo;
      if (ready_for_ceo && !status) update.status = 'ready_for_ceo';
    }
    if (notes !== undefined) packet.notes = notes;
    update.packet = packet;
    await sbRequest('PATCH', `engineering_tasks?id=eq.${encodeURIComponent(task_id)}`, update);
    return JSON.stringify({
      ok: true,
      task_id,
      new_status: update.status || curr[0].status,
      updated_fields: Object.keys(args).filter((k) => k !== 'task_id'),
    });
  }

  // ── eb_create_task ──
  if (name === 'eb_create_task') {
    const result = await sbRequest('POST', 'engineering_tasks', {
      problem: args.problem,
      expected_result: args.expected_result,
      affected_engine: args.affected_engine,
      priority: args.priority,
      acceptance_criteria: args.acceptance_criteria,
      status: 'open',
      packet: {},
    });
    const task = Array.isArray(result) ? result[0] : result;
    return JSON.stringify({ ok: true, task_id: task?.id, task });
  }

  // ── eb_get_system_version ──
  if (name === 'eb_get_system_version') {
    const rows = await sbRequest(
      'GET',
      'engineering_brain?section=eq.overview&select=key,title,data&order=sort_order'
    );
    return JSON.stringify(rows || [], null, 2);
  }

  // ── eb_validate_task (EVL Stage 1) ─────────────────────────────────────────
  // Runs the API-level generation + content check. On PASS → "testing" status.
  // On FAIL → "in_progress". Does NOT promote to ready_for_ceo (that requires Stage 2).
  if (name === 'eb_validate_task') {
    const { task_id, deployment_version } = args;

    const rows = await sbRequest(
      'GET',
      `engineering_tasks?id=eq.${encodeURIComponent(task_id)}&select=*`
    );
    if (!rows?.length) throw new Error(`Task ${task_id} not found`);
    const task = rows[0];

    const started = new Date().toISOString();
    let result;
    try {
      result = await _runProtocol(task);
    } catch (e) {
      result = { passed: false, protocol: 'error', error: e.message };
    }
    const finished = new Date().toISOString();

    const curr = await sbRequest(
      'GET',
      `engineering_tasks?id=eq.${encodeURIComponent(task_id)}&select=packet,status`
    );
    const packet = { ...(curr[0].packet || {}) };

    if (!Array.isArray(packet.evl_history)) packet.evl_history = [];
    packet.evl_history.push({
      stage: 'api',
      started,
      finished,
      passed: result.passed,
      result,
    });
    if (packet.evl_history.length > 10) packet.evl_history = packet.evl_history.slice(-10);

    if (deployment_version) packet.deployment_version = deployment_version;

    const update = { updated_at: finished, packet };

    if (result.passed) {
      // Stage 1 pass → "testing" (awaiting Stage 2 UI validation)
      packet.evl_stage1_passed = true;
      packet.evl_stage1_result = `PASS — ${result.protocol} — ${JSON.stringify(result).slice(0, 400)}`;
      packet.ready_for_ceo = false; // explicitly NOT ready until Stage 2 passes
      update.status = 'testing';
    } else {
      // Stage 1 fail → back to in_progress
      packet.evl_stage1_passed = false;
      packet.evl_stage1_result = `FAIL — ${result.protocol} — ${JSON.stringify(result).slice(0, 400)}`;
      packet.ready_for_ceo = false;
      update.status = 'in_progress';
    }

    await sbRequest('PATCH', `engineering_tasks?id=eq.${encodeURIComponent(task_id)}`, update);

    // Return the UI validation protocol so Claude knows exactly what to do next
    const engine = (task.affected_engine || '').toLowerCase();
    const uiProtocol = UI_VALIDATION_PROTOCOLS[engine] || null;

    return JSON.stringify({
      evl_stage: 1,
      evl: result.passed ? 'PASS' : 'FAIL',
      task_id,
      new_status: update.status,
      protocol: result.protocol,
      result,
      deployment_version: deployment_version || packet.deployment_version,
      next_step: result.passed
        ? 'Stage 1 PASS. Open MMMOS in Chrome, complete full lifecycle through APPROVE (Generate→Review→Build→Approve). Play the Approve-page video. Verify all 7 checklist items. Then call eb_record_operator_validation.'
        : 'Stage 1 FAIL. Fix the issue, redeploy, then re-run eb_validate_task.',
      ui_protocol: result.passed ? uiProtocol : null,
    });
  }

  // ── eb_record_operator_validation (EVL Stage 2 v3) ───────────────────────────
  // Records evidence from the full UI-driven lifecycle run through APPROVE stage.
  // Enforces: Approve stage reached, approve video played, 7-item visual checklist.
  // PASS → ready_for_ceo. FAIL → in_progress with auto-loop instructions.
  if (name === 'eb_record_operator_validation') {
    const {
      task_id,
      passed,
      lifecycle_stages_passed,
      approve_video_url,
      approve_video_played,
      visual_checklist,
      rendered_duration_seconds,
      script_word_count,
      video_url,
      acceptance_criteria_results,
      failure_reason,
      evidence_notes,
      deployment_version,
    } = args;

    const curr = await sbRequest(
      'GET',
      `engineering_tasks?id=eq.${encodeURIComponent(task_id)}&select=packet,status,affected_engine`
    );
    if (!curr?.length) throw new Error(`Task ${task_id} not found`);

    const packet = { ...(curr[0].packet || {}) };
    const engine = curr[0].affected_engine || '';
    const now = new Date().toISOString();
    const stages = lifecycle_stages_passed || [];

    // ── Gate 1: Approve stage must be reached ──────────────────────────────────
    const approveReached = stages.map(s => s.toLowerCase()).includes('approve');
    let gateFailures = [];
    if (!approveReached) {
      gateFailures.push('Approve stage was NOT reached — lifecycle must complete through Approve before calling this tool');
    }

    // ── Gate 2: Approve video must have been played ────────────────────────────
    if (!approve_video_played) {
      gateFailures.push('approve_video_played is false or missing — must play the Approve-page video before verification');
    }
    if (!approve_video_url) {
      gateFailures.push('approve_video_url is missing — must provide the URL of the video on the Approve page');
    }

    // ── Gate 3: Visual checklist (AI Studio) ──────────────────────────────────
    const isAiStudio = engine.toLowerCase().includes('ai_studio') || engine.toLowerCase().includes('ai studio');
    const requiredChecklistItems = isAiStudio
      ? ['logo_visible', 'music_audible', 'voice_clear', 'captions_correct', 'short_duration_pass', 'video_plays_in_approve']
      : [];
    const checklist = visual_checklist || {};
    const checklistFails = [];
    for (const item of requiredChecklistItems) {
      if (!checklist[item]) {
        checklistFails.push(`${item}: missing — must verify against Approve-page video`);
      } else if (String(checklist[item]).toUpperCase().startsWith('FAIL')) {
        checklistFails.push(`${item}: ${checklist[item]}`);
      }
    }
    if (checklistFails.length > 0) {
      gateFailures.push(...checklistFails);
    }

    // ── Determine effective pass/fail ──────────────────────────────────────────
    const effectivePassed = passed && gateFailures.length === 0;
    const effectiveFailureReason = gateFailures.length > 0
      ? `GATE FAILURES:\n${gateFailures.map(f => `  • ${f}`).join('\n')}\n\nOriginal failure_reason: ${failure_reason || 'n/a'}`
      : (failure_reason || null);

    const uiEvidence = {
      stage: 'operator_ui_v3',
      timestamp: now,
      passed: effectivePassed,
      lifecycle_stages_passed: stages,
      approve_video_url: approve_video_url || null,
      approve_video_played: approve_video_played || false,
      visual_checklist: checklist,
      rendered_duration_seconds: rendered_duration_seconds ?? null,
      script_word_count: script_word_count ?? null,
      video_url: video_url || null,
      acceptance_criteria_results: acceptance_criteria_results || {},
      gate_failures: gateFailures,
      failure_reason: effectiveFailureReason,
      evidence_notes: evidence_notes || null,
      deployment_version: deployment_version || packet.deployment_version,
    };

    if (!Array.isArray(packet.evl_history)) packet.evl_history = [];
    packet.evl_history.push(uiEvidence);
    if (packet.evl_history.length > 10) packet.evl_history = packet.evl_history.slice(-10);

    packet.evl_stage2_result = effectivePassed
      ? `UI PASS v3 — Approve video verified — Duration: ${rendered_duration_seconds}s — Stages: ${stages.join(' → ')}`
      : `UI FAIL v3 — ${effectiveFailureReason || 'No reason provided'}`;

    if (deployment_version) packet.deployment_version = deployment_version;

    const update = { updated_at: now, packet };

    if (effectivePassed) {
      // Both stages passed + all gates cleared → ready for CEO
      packet.ready_for_ceo = true;
      packet.test_results =
        `EVL v2 COMPLETE (Stage 2 v3) — API PASS + UI PASS\n` +
        `Approve video: ${approve_video_url || 'n/a'}\n` +
        `Duration: ${rendered_duration_seconds}s | Stages: ${stages.join(' → ')}\n` +
        `Visual checklist: ${JSON.stringify(checklist).slice(0, 300)}\n` +
        `Criteria: ${JSON.stringify(acceptance_criteria_results || {}).slice(0, 200)}`;
      update.status = 'ready_for_ceo';
    } else {
      // Validation failed → back to in_progress
      packet.ready_for_ceo = false;
      packet.test_results =
        `EVL v2 FAIL (Stage 2 v3) — UI Validation Failed\n` +
        `Reason: ${effectiveFailureReason || 'See evidence_notes'}\n` +
        `Stages reached: ${stages.join(' → ')}\n` +
        `Evidence: ${evidence_notes || 'n/a'}`;
      update.status = 'in_progress';
    }

    await sbRequest('PATCH', `engineering_tasks?id=eq.${encodeURIComponent(task_id)}`, update);

    const autoLoopInstructions = effectivePassed ? null : [
      '1. Identify root cause from gate_failures and failure_reason above',
      '2. Fix the code in index.html / ops.js',
      '3. Redeploy (Edit tool → launchd → Vercel ~35s)',
      '4. Hard-refresh browser to load new version',
      '5. Run FULL lifecycle from Generate → Review → Build → APPROVE',
      '6. Open Approve page, PLAY the final video',
      '7. Verify all 7 checklist items against the Approve-page video',
      '8. Call eb_record_operator_validation again with complete evidence',
      '9. Repeat until all gates clear and passed=true',
    ];

    return JSON.stringify({
      evl_stage: 2,
      evl_version: 'v3',
      evl: effectivePassed ? 'PASS' : 'FAIL',
      task_id,
      new_status: update.status,
      gate_failures: gateFailures,
      rendered_duration_seconds,
      lifecycle_stages_passed: stages,
      approve_video_url: approve_video_url || null,
      visual_checklist: checklist,
      next_step: effectivePassed
        ? 'Task is READY FOR CEO TEST. CEO reviews the Approve-page video and approves or rejects.'
        : 'FAIL — auto-loop required.',
      auto_loop: autoLoopInstructions,
    });
  }

  // ── eb_create_intelligent_task (Task Intelligence v2) ──────────────────────
  // CEO enters 4 fields. Brain reads Supabase and auto-generates full Engineering Packet.
  if (name === 'eb_create_intelligent_task') {
    const { problem, expected_result, affected_engine, priority } = args;

    // 1. Read all brain sections from Supabase
    const brainRows = await sbRequest(
      'GET',
      'engineering_brain?select=section,key,title,data&order=section,sort_order'
    );
    const brain = {};
    for (const row of brainRows || []) {
      if (!brain[row.section]) brain[row.section] = [];
      brain[row.section].push({ key: row.key, title: row.title, data: row.data });
    }

    // 2. Normalize engine key (ai_studio, srv_farsi, etc.)
    const engineKey = (affected_engine || '')
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z_]/g, '');

    // 3. Find engine entry from registry
    const engineEntry = (brain.engine_registry || []).find((e) => e.key === engineKey);

    // 4. Find protected components that list this engine as a user
    const engineProtected = (brain.protected_registry || []).filter((p) =>
      (p.data?.used_by || []).includes(engineKey)
    );

    // 5. Find shared systems this engine depends on
    const engineShared = (brain.shared_systems || []).filter((s) => {
      const engines = s.data?.engines || [];
      return engines.includes(engineKey) || engines.includes('all');
    });

    // 6. Find regression rules keyed to this engine
    const engineRegressionKeys = engineEntry?.data?.regression_rule_keys || [];
    const engineRegression = (brain.regression_rules || []).filter((r) =>
      engineRegressionKeys.includes(r.key)
    );

    // 7. All constitution rules are always relevant
    const constitutionRules = (brain.constitution || []).map((r) => ({
      key: r.key,
      title: r.title,
      rule: r.data?.rule,
      apply: r.data?.apply,
      why: r.data?.why,
    }));

    // 8. UI validation protocol (from in-memory constant — already defined in this file)
    const uiProtocol = UI_VALIDATION_PROTOCOLS[engineKey] || null;

    // 9. Auto-derive acceptance criteria from expected_result + engine spec
    const freezeStatus = engineEntry?.data?.freeze_status || 'check engine registry';
    const ceoTestSteps = engineEntry?.data?.testing_steps || [
      'Open MMMOS in browser',
      'Navigate to Engines tab → find the affected engine',
      'Verify the fix works end-to-end',
      'Check no regression in other engines',
    ];

    const acceptanceCriteria = [
      `OUTCOME: ${expected_result}`,
      `ENGINE IDENTITY PRESERVED: ${engineEntry?.data?.identity || 'per engine registry — do not change'}`,
      `FREEZE STATUS: ${freezeStatus} — do not modify any frozen component`,
      `NO REGRESSION: SRV Farsi, SRV English, AI Studio, NextWave all unaffected by this change`,
      `EVL PASS: Both Stage 1 (API generation check) and Stage 2 (operator UI lifecycle) must pass`,
      ...ceoTestSteps.map((s, i) => `CEO TEST STEP ${i + 1}: ${s}`),
    ].join('\n');

    // 10. Build the EVL plan block
    const evlStage1Protocol =
      engineKey === 'ai_studio'
        ? '3× generate, 2/3 must pass — script 85–115 words (Short) or 850–1100 words (Long)'
        : engineKey === 'srv_farsi'
        ? '1× generate — Persian chars present + lyrics ≥60 words + mood field'
        : engineKey === 'srv_english'
        ? '1× generate — English lyrics ≥60 words + mood field + no Persian bleed'
        : engineKey === 'nextwave'
        ? '1× generate — script 110–160 words'
        : 'Generic: generate endpoint responds without error';

    const deploymentChecks = [
      'Bump version in 4 locations in index.html: data-v attribute, <title>, .t-sub div, .v-badge span',
      'Deploy ritual: cp index.html public/index.html → sleep 2 → touch public/index.html',
      'Wait ~35s for Vercel auto-deploy',
      'Verify new version badge visible in MMMOS UI',
      'Count /api/*.js files — must remain ≤ 12 (Vercel Hobby limit)',
      ...engineRegression.flatMap((r) => r.data?.checks || []),
    ];

    const retryRules = [
      'HeyGen render error → retry once after 60s (transient API)',
      'Submagic template error → retry without template (fallback enabled in _autoStartSubmagic)',
      'EVL Stage 1 FAIL → fix code → redeploy → re-run eb_validate_task (do not skip)',
      'EVL Stage 2 FAIL → diagnose root cause → fix → restart from Stage 1',
      'Vercel deploy error → check /api/*.js file count ≤ 12, check vercel.json unchanged',
      'Max 3 deploy-fix cycles before CEO escalation',
    ];

    // 11. Assemble full packet
    const packet = {
      intelligence_version: 'v2.0',
      generated_at: new Date().toISOString(),
      engine_spec: engineEntry
        ? {
            key: engineEntry.key,
            title: engineEntry.title,
            status: engineEntry.data?.status,
            version: engineEntry.data?.version,
            identity: engineEntry.data?.identity,
            purpose: engineEntry.data?.purpose,
            calendar: engineEntry.data?.calendar,
            workflow: engineEntry.data?.workflow,
            dependencies: engineEntry.data?.dependencies,
            freeze_status: engineEntry.data?.freeze_status,
            youtube_channel: engineEntry.data?.youtube_channel,
            avatar: engineEntry.data?.avatar,
            music: engineEntry.data?.music,
          }
        : { key: engineKey, warning: 'Engine not found in registry — verify affected_engine value' },
      constitution_rules: constitutionRules,
      protected_components: engineProtected.map((p) => ({
        key: p.key,
        title: p.title,
        risk: p.data?.risk,
        rules: p.data?.rules,
        description: p.data?.description,
        files: p.data?.files,
      })),
      shared_dependencies: engineShared.map((s) => ({
        key: s.key,
        title: s.title,
        description: s.data?.description,
        engines: s.data?.engines,
        components: s.data?.components,
      })),
      regression_risks: engineRegression.map((r) => ({
        key: r.key,
        title: r.title,
        trigger: r.data?.trigger,
        checks: r.data?.checks,
        approval_required: r.data?.approval_required || false,
      })),
      evl_plan: {
        stage1_api: {
          tool: 'eb_validate_task',
          protocol: evlStage1Protocol,
          on_pass: 'status → testing (Stage 2 required before ready_for_ceo)',
          on_fail: 'status → in_progress (fix then re-run Stage 1)',
        },
        stage2_operator: uiProtocol
          ? {
              tool: 'eb_record_operator_validation',
              lifecycle_steps: uiProtocol.short?.lifecycle_steps || [],
              acceptance_criteria: uiProtocol.short?.acceptance_criteria || {},
              on_pass: 'status → ready_for_ceo',
              on_fail: 'status → in_progress (diagnose → fix → restart Stage 1)',
            }
          : {
              tool: 'eb_record_operator_validation',
              note: 'No UI protocol defined — run manual lifecycle verification',
              on_pass: 'status → ready_for_ceo',
              on_fail: 'status → in_progress',
            },
      },
      operator_validation_plan: uiProtocol?.short?.lifecycle_steps || [],
      deployment_checks: deploymentChecks,
      retry_rules: retryRules,
      ceo_test_steps: ceoTestSteps,
    };

    // 12. Create the task in Supabase with full packet embedded
    const result = await sbRequest('POST', 'engineering_tasks', {
      problem,
      expected_result,
      affected_engine: engineKey,
      priority,
      acceptance_criteria: acceptanceCriteria,
      status: 'open',
      packet,
    });
    const task = Array.isArray(result) ? result[0] : result;

    return JSON.stringify({
      ok: true,
      task_id: task?.id,
      intelligence_version: 'v2.0',
      engine_found: !!engineEntry,
      packet_stats: {
        constitution_rules: constitutionRules.length,
        protected_components: engineProtected.length,
        shared_dependencies: engineShared.length,
        regression_risks: engineRegression.length,
        operator_validation_steps: (uiProtocol?.short?.lifecycle_steps || []).length,
        deployment_checks: deploymentChecks.length,
        retry_rules: retryRules.length,
        ceo_test_steps: ceoTestSteps.length,
      },
      engine_spec_summary: {
        engine: engineKey,
        title: engineEntry?.title || 'unknown',
        freeze_status: freezeStatus,
        identity: engineEntry?.data?.identity || 'n/a',
      },
      acceptance_criteria_preview: acceptanceCriteria.slice(0, 400),
      task_id_for_future_sessions: task?.id,
    });
  }

  // ── Engineering Worker tools (Decision #17 Step 2B) ──────────────────────────
  // Every branch below calls mmosOps (the existing /api/ops HTTP action
  // dispatcher, via the existing mmosPost helper) with this server's single
  // standing worker credential. The credential is read fresh via
  // _requireWorkerCredential() (local file, lazily, with an env-var
  // fallback) and attached directly into the request body sent to MMMOS —
  // it is never included in any value returned to the caller
  // (Claude) below, never logged, and never accepted as a tool argument.

  if (name === 'eb_worker_list_authorized_tasks') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_worker_list_authorized_tasks', { worker_credential });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_claim_task') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_worker_claim_task', { worker_credential, task_id: args.task_id });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_read_task_packet') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op: 'read_task_packet',
    });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_read_authorization_boundary') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op: 'read_authorization_boundary',
    });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_read_authorized_file') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op: 'read_authorized_file', path: args.path,
    });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_write_authorized_file') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op: 'write_authorized_file',
      path: args.path, content: args.content,
    });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_validate_javascript_syntax') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op: 'validate_javascript_syntax', path: args.path,
    });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_submit_execution_plan') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op: 'submit_execution_plan', plan: args.plan,
    });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_submit_evidence') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op: 'submit_evidence',
      evidence_type: args.evidence_type, title: args.title, content: args.content,
    });
    return JSON.stringify(result, null, 2);
  }

  // ── MMMOS Engineering Integration R2: runner tools ──────────────────────────
  // Fail-safe: a server older than R2 ignores mode:'runner' and would list (and
  // let the runner claim) ordinary manual-only tasks. Only a response that
  // confirms mode === 'runner' is trusted, and a claim is attempted only for a
  // task that such a runner listing just returned.
  const _runnerList = async (worker_credential) => {
    const r = await mmosOps('engineering_worker_list_authorized_tasks', { worker_credential, mode: 'runner' });
    // Distinguish "switched off" from "server too old" so the message is accurate.
    if (r && r.mode === 'runner_disabled') throw new Error('The automatic runner is switched off in MMMOS (eng_runner is OFF). Refusing to list or claim anything.');
    if (!r || r.mode !== 'runner' || !Array.isArray(r.tasks)) throw new Error('MMMOS did not confirm runner mode — this server does not have the R2 runner gate. Refusing to list or claim anything.');
    return r;
  };
  if (name === 'eb_runner_list_eligible_tasks') {
    const worker_credential = _requireWorkerCredential();
    return JSON.stringify(await _runnerList(worker_credential), null, 2);
  }
  if (name === 'eb_runner_claim_task') {
    const worker_credential = _requireWorkerCredential();
    const listed = await _runnerList(worker_credential);
    if (!listed.tasks.some(t => t.id === args.task_id)) throw new Error('That task is not in the runner-eligible list. Refusing to claim it.');
    return JSON.stringify(await mmosOps('engineering_worker_claim_task', { worker_credential, task_id: args.task_id, mode: 'runner' }), null, 2);
  }
  if (['eb_worker_read_runner_scope', 'eb_worker_renew_lease', 'eb_worker_read_adviser_followups'].includes(name)) {
    const worker_credential = _requireWorkerCredential();
    const op = { eb_worker_read_runner_scope: 'read_runner_scope', eb_worker_renew_lease: 'renew_lease', eb_worker_read_adviser_followups: 'read_adviser_followups' }[name];
    return JSON.stringify(await mmosOps('engineering_agent_gateway', { worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id, op }), null, 2);
  }
  if (name === 'eb_worker_upload_artifact') {
    const worker_credential = _requireWorkerCredential();
    const file = _artifactFile(args.local_path);
    const base = { worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id };
    const up = await mmosOps('engineering_agent_gateway', { ...base, op: 'create_artifact_upload', file_name: file.name });
    if (!up.ok || !up.upload_url) return JSON.stringify(up, null, 2);
    await _putSigned(up.upload_url, file);
    const reg = await mmosOps('engineering_agent_gateway', { ...base, op: 'submit_artifact', object_path: up.object_path,
      artifact_kind: args.artifact_kind, title: args.title, description: args.description });
    return JSON.stringify(reg, null, 2);
  }
  if (name === 'eb_worker_submit_pull_request') {
    const worker_credential = _requireWorkerCredential();
    return JSON.stringify(await mmosOps('engineering_agent_gateway', { worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id,
      op: 'submit_pull_request', pr_url: args.pr_url, branch: args.branch }), null, 2);
  }

  // ── Decision #17 Engineering Brain Worker Transport Completion ─────────────
  // Both pure passthroughs over mmosOps, identical pattern to every
  // eb_worker_* handler above — worker_credential read fresh, attached to
  // the outgoing body, never accepted as an argument, never returned.

  if (name === 'eb_worker_submit_commit_sha') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_agent_gateway', {
      worker_credential, task_id: args.task_id, agent_run_id: args.agent_run_id,
      op: 'submit_commit_sha', commit_sha: args.commit_sha,
    });
    return JSON.stringify(result, null, 2);
  }

  if (name === 'eb_worker_execute_production_release') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_worker_execute_production_release', {
      worker_credential,
      production_release_authorization_id: args.production_release_authorization_id,
      expected_commit_sha: args.expected_commit_sha,
    });
    return JSON.stringify(result, null, 2);
  }

  // ── Phase 3B.1: governed task creation via the worker-credential path ──────
  // Fixes eb_create_task/eb_create_intelligent_task (below) writing directly to
  // Supabase REST with the low-privilege publishable key -- correctly rejected
  // by engineering_tasks' RLS. Routes through the SAME canonical insert path
  // (_insertEngineeringTaskRow) the CEO's Task Generator UI already uses.
  if (name === 'eb_worker_submit_task') {
    const worker_credential = _requireWorkerCredential();
    const result = await mmosOps('engineering_worker_submit_task', {
      worker_credential,
      problem: args.problem,
      expected_result: args.expected_result,
      affected_engine: args.affected_engine,
      priority: args.priority,
      acceptance_criteria: args.acceptance_criteria,
      submission_idempotency_key: args.submission_idempotency_key,
    });
    return JSON.stringify(result, null, 2);
  }

  // ── Decision #17 Step 2D: secure pairing (no CEO credential handling) ──────
  if (name === 'eb_worker_connect_request') {
    const label = (args && typeof args.label === 'string' && args.label.trim()) ? args.label.trim() : 'Cowork — Primary Engineering Worker';
    const pairingSecret = randomBytes(32).toString('hex');
    const pairingSecretHash = createHash('sha256').update(pairingSecret).digest('hex');
    const result = await mmosOps('engineering_worker_pairing_request', { label, pairing_secret_hash: pairingSecretHash });
    if (!result || !result.ok) {
      return JSON.stringify({ ok: false, error: (result && result.error) || 'pairing_request_failed' }, null, 2);
    }
    // The raw pairing secret is persisted ONLY to this local file — it is
    // never included below in this tool's own result.
    fs.writeFileSync(
      MMMOS_PENDING_PAIRING_FILE,
      JSON.stringify({ pairing_id: result.pairing_id, pairing_secret: pairingSecret, label, expires_at: result.expires_at }),
      { mode: 0o600 }
    );
    return JSON.stringify({
      ok: true,
      pairing_id: result.pairing_id,
      label,
      expires_at: result.expires_at,
      message: 'Connection request sent to MMMOS. Ask the CEO to open Engineering Brain -> Engineering Workers and click "Approve Connection" for this request, then call eb_worker_connect_finish.',
    }, null, 2);
  }
  if (name === 'eb_worker_connect_finish') {
    if (!fs.existsSync(MMMOS_PENDING_PAIRING_FILE)) {
      return JSON.stringify({ ok: false, error: 'no_pending_pairing_request', message: 'Call eb_worker_connect_request first.' }, null, 2);
    }
    let pending;
    try {
      pending = JSON.parse(fs.readFileSync(MMMOS_PENDING_PAIRING_FILE, 'utf8'));
    } catch (e) {
      return JSON.stringify({ ok: false, error: 'pending_pairing_file_corrupt', message: 'Call eb_worker_connect_request again to start over.' }, null, 2);
    }
    const result = await mmosOps('engineering_worker_pairing_complete', {
      pairing_id: pending.pairing_id, pairing_secret: pending.pairing_secret,
    });
    if (!result || !result.ok) {
      const err = (result && result.error) || 'pairing_complete_failed';
      const message = err === 'pairing_not_approved'
        ? 'Not yet approved — ask the CEO to click "Approve Connection" in the Engineering Workers panel, then retry eb_worker_connect_finish.'
        : (err === 'pairing_request_expired'
          ? 'This pairing request expired — call eb_worker_connect_request again to start a new one.'
          : undefined);
      return JSON.stringify({ ok: false, error: err, message }, null, 2);
    }
    // The raw credential is written straight to a local file and never
    // included in this tool's own result.
    fs.writeFileSync(MMMOS_WORKER_CREDENTIAL_FILE, String(result.worker_credential).trim() + '\n', { mode: 0o600 });
    try { fs.unlinkSync(MMMOS_PENDING_PAIRING_FILE); } catch (e) { /* non-fatal */ }
    return JSON.stringify({
      ok: true, worker_id: result.worker_id, label: result.label,
      message: 'Connected. Engineering Worker tools are now active.',
    }, null, 2);
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── MCP stdio protocol (newline-delimited JSON-RPC 2.0) ───────────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = msg;
  if (!method || method.startsWith('notifications/')) return;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mmm-engineering-brain', version: '7.1.0' },
      },
    });
    return;
  }

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    try {
      const text = await callTool(params?.name, params?.arguments || {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        },
      });
    }
    return;
  }

  if (id != null) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
});

process.stderr.write(
  '[mmm-engineering-brain] MCP server v7.1.0 ready — Task Intelligence v2 + EVL v2' +
  (_loadWorkerCredential()
    ? ' + Engineering Worker tools active (worker credential connected)\n'
    : ' + Engineering Worker tools present but INACTIVE (no worker connected yet — call eb_worker_connect_request)\n')
);
