// NextWave Finance Pilot — L1 isolated state and L2 CEO status (Order 049).
// Pure logic only: no network, no database, no secrets. api/ops.js supplies the reads and the single write.
//
// Isolation rules enforced here:
// - the pilot's state lives in ONE app_settings row, PILOT_STATE_KEY, never inside the shared company
//   state (mmm_finance_v118) and never under another business's key;
// - only fields in the schema below can be stored; generation and publishing are always stored disabled;
// - the CEO status lists only tasks whose business is the pilot and only artifacts stored under the
//   pilot's own folder, and never returns storage paths, tokens or other businesses' data.

export const PILOT_KEY = 'nextwave_finance_pilot';
export const PILOT_SETTINGS_PREFIX = 'nextwave_finance_pilot_';
export const PILOT_STATE_KEY = 'nextwave_finance_pilot_state';
export const PILOT_WRITES_FLAG = 'nwfp_state_writes'; // mmm_platform_flags row; missing = OFF
export const PILOT_DISPLAY_NAME = 'NextWave Finance Pilot';
export const SCHEMA_VERSION = 1;

// Evidence-based stage manifest. The manifest records only what a checkpoint VERIFIED in production;
// each line carries its evidence. What the card shows is then derived at runtime from that manifest plus
// live facts (stageDisplayStatus): outside production nothing is shown as deployed or live, and L1's
// label reflects the real value of the write switch.
export const LATEST_VERIFIED_CHECKPOINT = '052';
export const STAGES = Object.freeze([
  { id: 'registration', label: 'Registration (business key, folders, labels)', status: 'LIVE', evidence: 'Checkpoint 048: PR #75, merge 92281cf, production dpl_6iPTEc65' },
  { id: 'L1', label: 'L1 Isolated state', status: 'DEPLOYED', evidence: 'Checkpoint 050: PR #77, merge 9efd0df, production dpl_8jPjjXVEz; write-lock migration 20261102034457 applied and verified' },
  { id: 'L2', label: 'L2 CEO read-only card', status: 'DEPLOYED', evidence: 'Checkpoint 050: PR #77, merge 9efd0df, production dpl_8jPjjXVEz' },
  { id: 'L3', label: 'L3 Content planning (no generation)', status: 'DEPLOYED', evidence: 'Checkpoint 052: PR #79, merge a75e6d9, production dpl_DbNxKnT4; plan saving OFF (nwfp_plan_writes absent)' },
  { id: 'L4', label: 'L4 Paid generation (sandboxed)', status: 'NOT STARTED', evidence: null },
  { id: 'L5', label: 'L5 Review and approval', status: 'NOT STARTED', evidence: null },
  { id: 'L6', label: 'L6 Publishing (per video)', status: 'NOT STARTED', evidence: null },
  { id: 'L7', label: 'L7 Analytics', status: 'NOT STARTED', evidence: null },
]);
export const STAGE_STATUSES = Object.freeze(['LIVE', 'DEPLOYED', 'PREVIEW READY', 'NOT STARTED']); // allowed in the manifest
export const DISPLAY_STATUSES = Object.freeze(['LIVE', 'DEPLOYED \u2014 WRITES OFF', 'DEPLOYED \u2014 WRITES ON', 'DEPLOYED \u2014 READ ONLY', 'DEPLOYED \u2014 SAVING OFF', 'DEPLOYED \u2014 SAVING ON', 'PREVIEW READY', 'NOT STARTED']);
// What the card shows for one stage. Derived, never assumed:
// - outside production, LIVE/DEPLOYED become PREVIEW READY;
// - L1 shows the actual state-write switch; L3 shows the actual plan-saving switch; L2 is read-only.
export function stageDisplayStatus(stage, { isProduction, writesFlag, planWritesFlag }) {
  if ((stage.status === 'LIVE' || stage.status === 'DEPLOYED') && !isProduction) return 'PREVIEW READY';
  if (stage.status === 'DEPLOYED') {
    if (stage.id === 'L1') return writesFlag ? 'DEPLOYED \u2014 WRITES ON' : 'DEPLOYED \u2014 WRITES OFF';
    if (stage.id === 'L3') return planWritesFlag ? 'DEPLOYED \u2014 SAVING ON' : 'DEPLOYED \u2014 SAVING OFF';
    return 'DEPLOYED \u2014 READ ONLY';
  }
  return stage.status;
}
export const LIFECYCLE_STAGES = Object.freeze(['registered', 'planning']); // what L1 may record; later stages add more

const MAX_NOTES = 20, MAX_NOTE_LEN = 500, MAX_TOPICS = 50, MAX_TOPIC_LEN = 200;
const ALLOWED_PATCH_FIELDS = new Set(['lifecycle_stage', 'notes', 'planning_topics']);

export function isPilotSettingsKey(key) {
  return typeof key === 'string' && key.startsWith(PILOT_SETTINGS_PREFIX);
}

export function defaultState() {
  return {
    schema: SCHEMA_VERSION, business_key: PILOT_KEY, lifecycle_stage: 'registered',
    notes: [], planning_topics: [],
    generation: { enabled: false }, publishing: { enabled: false },
    updated_at: null, updated_by: null, revision: 0,
  };
}

// Reads a stored row value. Anything malformed, foreign or from another business falls back to the
// default state (never throws, never adopts foreign data).
export function parseStoredState(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return { state: defaultState(), valid: false }; } }
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.business_key !== PILOT_KEY || v.schema !== SCHEMA_VERSION) {
    return { state: defaultState(), valid: v == null };
  }
  const s = defaultState();
  if (LIFECYCLE_STAGES.includes(v.lifecycle_stage)) s.lifecycle_stage = v.lifecycle_stage;
  if (Array.isArray(v.notes)) s.notes = v.notes.filter(n => typeof n === 'string').slice(0, MAX_NOTES).map(n => n.slice(0, MAX_NOTE_LEN));
  if (Array.isArray(v.planning_topics)) s.planning_topics = v.planning_topics.filter(n => typeof n === 'string').slice(0, MAX_TOPICS).map(n => n.slice(0, MAX_TOPIC_LEN));
  s.updated_at = typeof v.updated_at === 'string' ? v.updated_at : null;
  s.updated_by = v.updated_by === 'ceo' ? 'ceo' : null;
  s.revision = Number.isInteger(v.revision) && v.revision >= 0 ? v.revision : 0;
  return { state: s, valid: true };
}

// Validates a CEO patch. Returns { ok, errors }.
export function validatePatch(patch) {
  const errors = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, errors: ['patch must be an object'] };
  const keys = Object.keys(patch);
  if (!keys.length) errors.push('patch is empty');
  for (const k of keys) if (!ALLOWED_PATCH_FIELDS.has(k)) errors.push(`field not allowed: ${k}`);
  if ('lifecycle_stage' in patch && !LIFECYCLE_STAGES.includes(patch.lifecycle_stage)) errors.push('lifecycle_stage must be one of ' + LIFECYCLE_STAGES.join(', '));
  const strList = (name, max, len) => {
    if (!(name in patch)) return;
    const a = patch[name];
    if (!Array.isArray(a) || a.length > max || a.some(x => typeof x !== 'string' || !x.trim() || x.length > len)) errors.push(`${name} must be up to ${max} non-empty strings of up to ${len} characters`);
  };
  strList('notes', MAX_NOTES, MAX_NOTE_LEN);
  strList('planning_topics', MAX_TOPICS, MAX_TOPIC_LEN);
  return { ok: errors.length === 0, errors };
}

// Applies a validated patch. Generation and publishing are always written disabled.
export function applyPatch(current, patch, { now, expectedRevision } = {}) {
  const base = parseStoredState(current).state;
  if (expectedRevision !== undefined && expectedRevision !== base.revision) return { ok: false, error: 'revision_conflict', revision: base.revision };
  const v = validatePatch(patch);
  if (!v.ok) return { ok: false, error: 'invalid_patch', errors: v.errors };
  const next = { ...base, ...patch, generation: { enabled: false }, publishing: { enabled: false },
    business_key: PILOT_KEY, schema: SCHEMA_VERSION, updated_at: now || new Date().toISOString(), updated_by: 'ceo', revision: base.revision + 1 };
  return { ok: true, state: next };
}

// Pilot-only filters for the CEO status.
export function pilotTasks(tasks) {
  return (tasks || []).filter(t => t && t.packet && t.packet.business === PILOT_KEY);
}
export function pilotArtifactBelongs(objectPath, taskId) {
  return typeof objectPath === 'string' && typeof taskId === 'string' && !objectPath.includes('..') &&
    objectPath.startsWith(`${PILOT_KEY}/${taskId}/`);
}

// Builds the read-only CEO status. Inputs come from the server; output has no paths, tokens or foreign data.
export function buildStatus({ stateValue, writesFlag, planWritesFlag, tasks, evidence, environment }) {
  const parsed = parseStoredState(stateValue);
  const own = pilotTasks(tasks);
  const ids = new Set(own.map(t => t.id));
  const arts = (evidence || []).filter(e => e && ids.has(e.task_id) && e.metadata && pilotArtifactBelongs(e.metadata.object_path, e.task_id));
  const byStatus = {};
  for (const t of own) byStatus[t.status || 'unknown'] = (byStatus[t.status || 'unknown'] || 0) + 1;
  const isProduction = environment === 'production';
  const stages = STAGES.map(s => ({
    id: s.id, label: s.label, evidence: s.evidence,
    status: stageDisplayStatus(s, { isProduction, writesFlag: !!writesFlag, planWritesFlag: !!planWritesFlag }),
  }));
  const anyOperational = stages.some(s => /^L[3-7]$/.test(s.id) && s.status === 'LIVE');
  return {
    business_key: PILOT_KEY,
    display_name: PILOT_DISPLAY_NAME,
    registration: stages[0].status === 'LIVE' ? 'REGISTERED' : 'PREVIEW READY',
    operational: anyOperational ? 'OPERATIONAL' : 'NOT OPERATIONAL',
    environment: isProduction ? 'production' : (environment || 'local'),
    stages,
    state: {
      lifecycle_stage: parsed.state.lifecycle_stage,
      notes: parsed.state.notes.length,
      planning_topics: parsed.state.planning_topics.length,
      updated_at: parsed.state.updated_at,
      revision: parsed.state.revision,
      stored: stateValue != null,
      valid: parsed.valid,
      writes: writesFlag ? 'ON' : 'OFF',
    },
    tasks: { total: own.length, by_status: byStatus },
    artifacts: { files: arts.length, total_bytes: arts.reduce((n, e) => n + (Number(e.metadata.size_bytes) || 0), 0), last_upload: arts.reduce((m, e) => (!m || e.created_at > m ? e.created_at : m), null) },
    generation: 'DISABLED',
    publishing: 'DISABLED',
    latest_verified_checkpoint: LATEST_VERIFIED_CHECKPOINT,
  };
}
