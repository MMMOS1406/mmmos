// Business improvement tracking: one persistent document per business (app_settings key growth_improvements_<business>; no new table, no migration).
// PURE: no network, database or clock (callers pass `nowMs`). A business's document only ever holds that business's items (the document, every item key and every id are business-bound).
// An item records: problem · evidence · proposed solution · owner · approval · status · baseline · target · review date · actual result · outcome (successful / unsuccessful / inconclusive) ·
// lessons · next action · history. NOTHING here changes production: tracking an improvement is a record; every creative, title/thumbnail, schedule or ad-setting change stays the CEO's separate decision.
// Learning: an item that ended "unsuccessful" suppresses the same proposal until NEW EVIDENCE exists (the baseline measure moved materially, or 90 days passed) — and says so.
const DAY = 86400000;
export const improvementsKey = (business) => 'growth_improvements_' + business;
export const STATUSES = Object.freeze(['proposed', 'approved', 'in_progress', 'completed', 'abandoned']);
export const OUTCOMES = Object.freeze(['successful', 'unsuccessful', 'inconclusive']);
export const LIMITS = Object.freeze({ maxItems: 100, maxHistory: 60, maxDocBytes: 120000, text: 600, note: 1000, reconsiderDays: 90, reconsiderChange: 0.25 });
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const str = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n) : '');
const dkey = (ms) => new Date(ms).toISOString().slice(0, 10);
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + 'T00:00:00Z'));
const ID_RE = /^imp_[a-z0-9]{8,24}$/;
const KEY_RE = /^[a-z_]{3,24}:[a-z_]{3,40}$/;
const TERMINAL = new Set(['completed', 'abandoned']);
const TRANSITIONS = { proposed: ['approved', 'in_progress', 'abandoned'], approved: ['in_progress', 'abandoned'], in_progress: ['completed', 'abandoned'], completed: [], abandoned: [] };

export const emptyImprovements = (business) => ({ v: 1, business, rev: 0, updated_at: null, items: [] });

const metricRef = (m) => (isObj(m) && typeof m.metric === 'string' && /^[a-z0-9_]{3,40}$/.test(m.metric) ? { metric: m.metric, value: isNum(m.value) ? m.value : null, n: isNum(m.n) ? m.n : null, label: str(m.label, 160), rule: str(m.rule, LIMITS.text), captured_at: isDate(m.captured_at) ? m.captured_at : null } : null);
const cleanPlan = (p) => (isObj(p) && /^[a-z_]{3,24}$/.test(String(p.experiment)) ? { experiment: p.experiment, variable: str(p.variable, 40), label: str(p.label, 60), short: str(p.short, 60), changes: str(p.changes, 300), releases: isNum(p.releases) ? p.releases : null, per_arm: isNum(p.per_arm) ? p.per_arm : null, arms: (Array.isArray(p.arms) ? p.arms : []).slice(0, 2).map((a) => ({ id: str(a && a.id, 2), label: str(a && a.label, 60) })), unchanged: (Array.isArray(p.unchanged) ? p.unchanged : []).slice(0, 8).map((u) => str(u, 40)), executor: str(p.executor, 120), engine: str(p.engine, 40), metric: str(p.metric, 20), mature_days: isNum(p.mature_days) ? p.mature_days : null, min_per_arm: isNum(p.min_per_arm) ? p.min_per_arm : null } : null);
function cleanItem(x, business) {
  if (!isObj(x) || !ID_RE.test(String(x.id)) || !KEY_RE.test(String(x.key)) || !String(x.key).endsWith(':' + business) || !STATUSES.includes(x.status)) return null;
  const apr = isObj(x.approval) ? { status: ['not_required', 'pending', 'approved', 'declined'].includes(x.approval.status) ? x.approval.status : 'pending', by: str(x.approval.by, 20), at: str(x.approval.at, 40), note: str(x.approval.note, LIMITS.note) } : { status: 'pending', by: '', at: '', note: '' };
  const res = isObj(x.result) && OUTCOMES.includes(x.result.outcome) ? { outcome: x.result.outcome, actual: isObj(x.result.actual) ? { value: isNum(x.result.actual.value) ? x.result.actual.value : null, n: isNum(x.result.actual.n) ? x.result.actual.n : null, at: str(x.result.actual.at, 40) } : null, evaluated_by: x.result.evaluated_by === 'system' ? 'system' : 'ceo', early: x.result.early === true, note: str(x.result.note, LIMITS.note), at: str(x.result.at, 40) } : null;
  return { id: x.id, key: x.key, category: str(x.category, 24), created_at: str(x.created_at, 40), created_by: str(x.created_by, 20), status: x.status, problem: str(x.problem, LIMITS.text), evidence: (Array.isArray(x.evidence) ? x.evidence : []).slice(0, 5).map((e) => str(e, 400)).filter(Boolean),
    action: str(x.action, 1200), why: str(x.why, 800), owner: str(x.owner, 160), requires_approval: x.requires_approval === true, approval: apr, baseline: metricRef(x.baseline), target: metricRef(x.target),
    review_by: isDate(x.review_by) ? x.review_by : null, success: str(x.success, LIMITS.text), failure: str(x.failure, LIMITS.text), inconclusive: str(x.inconclusive, LIMITS.text),
    plan: cleanPlan(x.plan), result: res, lessons: str(x.lessons, LIMITS.note), next_action: str(x.next_action, 300), reconsidered: x.reconsidered === true,
    history: (Array.isArray(x.history) ? x.history : []).slice(-LIMITS.maxHistory).filter(isObj).map((h) => ({ at: str(h.at, 40), by: str(h.by, 20), event: str(h.event, 40), detail: str(h.detail, 300) })) };
}
export function sanitizeImprovements(raw, business) {
  let v; try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
  if (!isObj(v) || v.business !== business) return null;
  const items = (Array.isArray(v.items) ? v.items : []).map((x) => cleanItem(x, business)).filter(Boolean).slice(0, LIMITS.maxItems);
  return { v: 1, business, rev: isNum(v.rev) && v.rev >= 0 ? Math.floor(v.rev) : 0, updated_at: str(v.updated_at, 40) || null, items };
}
const uid = (nowMs, seed) => 'imp_' + (nowMs.toString(36) + Math.abs((seed || 0) | 0).toString(36) + 'x'.repeat(8)).slice(0, 14).replace(/[^a-z0-9]/g, 'x');
const hist = (it, by, event, detail, nowMs) => { it.history = [...it.history, { at: new Date(nowMs).toISOString(), by, event, detail: str(detail || '', 300) }].slice(-LIMITS.maxHistory); };
const latestFor = (doc, key) => doc.items.filter((i) => i.key === key).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;

// Is this proposal allowed to start again? Active → no (already tracked). Last attempt unsuccessful → no, unless new evidence (the baseline measure moved ≥ 25% since that attempt, or 90 days passed).
export function startCheck(doc, proposal, nowMs) {
  const last = latestFor(doc, proposal.key);
  if (!last) return { ok: true };
  if (!TERMINAL.has(last.status)) return { ok: false, reason: 'already_active', item_id: last.id, detail: 'This improvement is already being tracked (' + last.status.replace('_', ' ') + ').' };
  if (last.status === 'completed' && last.result && last.result.outcome === 'unsuccessful') {
    const at = Date.parse((last.result.at || last.created_at || '').slice(0, 10) + 'T00:00:00Z'); const old = last.baseline && isNum(last.baseline.value) ? last.baseline.value : null, cur = proposal.baseline && isNum(proposal.baseline.value) ? proposal.baseline.value : null;
    const moved = old !== null && cur !== null && old !== 0 && Math.abs(cur - old) / Math.abs(old) >= LIMITS.reconsiderChange, aged = Number.isFinite(at) && nowMs - at >= LIMITS.reconsiderDays * DAY;
    if (!moved && !aged) return { ok: false, reason: 'previously_unsuccessful', item_id: last.id, detail: `The same improvement was tried and ended unsuccessful on ${(last.result.at || '').slice(0, 10)}; it is proposed again only with new evidence (its measure moving by 25% or more, or 90 days).`, lessons: last.lessons || null };
    return { ok: true, reconsidered: true, new_evidence: moved ? 'the baseline measure has moved materially since the unsuccessful attempt' : 'more than 90 days have passed' };
  }
  return { ok: true };
}
// Annotates a plan's proposals with their tracking state (active / done / suppressed) so a repeat is never silently offered again.
export function annotatePlan(plan, doc, nowMs) {
  return (plan.proposals || []).map((p) => { const last = latestFor(doc, p.key); const chk = startCheck(doc, p, nowMs);
    return { ...p, tracking: last ? { item_id: last.id, status: last.status, outcome: last.result ? last.result.outcome : null, review_by: last.review_by } : null, can_start: chk.ok, blocked: chk.ok ? null : { reason: chk.reason, detail: chk.detail, lessons: chk.lessons || null }, reconsidered: chk.reconsidered ? chk.new_evidence : null }; });
}
// Create an item from a plan proposal (the server builds the proposal from live data; the client only names its key).
export function startImprovement(doc, proposal, { by = 'ceo', nowMs, note = '' } = {}) {
  if (!isObj(doc) || !isObj(proposal) || !KEY_RE.test(String(proposal.key)) || !String(proposal.key).endsWith(':' + doc.business)) return { error: 'proposal_not_for_this_business' };
  if (doc.items.length >= LIMITS.maxItems) return { error: 'too_many_items' };
  const chk = startCheck(doc, proposal, nowMs); if (!chk.ok) return { error: chk.reason, detail: chk.detail, item_id: chk.item_id || null };
  const approvalNeeded = proposal.requires_approval === true;
  const it = cleanItem({ id: uid(nowMs, doc.rev + doc.items.length), key: proposal.key, category: proposal.category, created_at: new Date(nowMs).toISOString(), created_by: by, status: approvalNeeded ? 'proposed' : 'in_progress', problem: proposal.problem, evidence: proposal.evidence, action: proposal.action, why: proposal.why, owner: proposal.owner, requires_approval: approvalNeeded,
    plan: proposal.plan,
    approval: { status: approvalNeeded ? 'pending' : 'not_required', by: '', at: '', note: '' }, baseline: proposal.baseline, target: proposal.target, review_by: proposal.review_by, success: proposal.success, failure: proposal.failure, inconclusive: proposal.inconclusive, reconsidered: !!chk.reconsidered, history: [] }, doc.business);
  if (!it) return { error: 'invalid_proposal' };
  hist(it, by, 'created', (approvalNeeded ? 'awaiting CEO approval' : 'started (no approval needed)') + (note ? ' — ' + note : '') + (chk.reconsidered ? ' — reconsidered: ' + chk.new_evidence : ''), nowMs);
  const next = { ...doc, rev: doc.rev + 1, updated_at: new Date(nowMs).toISOString(), items: [it, ...doc.items] };
  return JSON.stringify(next).length > LIMITS.maxDocBytes ? { error: 'document_too_large' } : { doc: next, item: it };
}
// Update one item: status transitions are validated; approval gates "in progress"; completing needs an outcome (system-proposed or the CEO's own, with a note when it differs).
// patch: { status?, approval?: {status:'approved'|'declined', note?}, lessons?, next_action?, owner?, review_by?, result?: { outcome, note?, actual?: {value, n} }, evaluation?: { state, actual } }
export function updateImprovement(doc, id, patch, { by = 'ceo', nowMs } = {}) {
  const i = doc.items.findIndex((x) => x.id === id); if (i < 0) return { error: 'not_found' }; const it = JSON.parse(JSON.stringify(doc.items[i])); const p = isObj(patch) ? patch : {};
  if (p.approval !== undefined) { const a = isObj(p.approval) ? p.approval : {}; if (!['approved', 'declined'].includes(a.status)) return { error: 'invalid_approval' }; if (!it.requires_approval) return { error: 'approval_not_required' };
    it.approval = { status: a.status, by, at: new Date(nowMs).toISOString(), note: str(a.note, LIMITS.note) }; hist(it, by, 'approval_' + a.status, a.note, nowMs); if (a.status === 'declined') { it.status = 'abandoned'; hist(it, by, 'status_abandoned', 'declined', nowMs); } else if (it.status === 'proposed') { it.status = 'approved'; hist(it, by, 'status_approved', '', nowMs); } }
  if (p.status !== undefined && p.status !== it.status) {
    if (!STATUSES.includes(p.status)) return { error: 'invalid_status' };
    if (!TRANSITIONS[it.status].includes(p.status)) return { error: 'invalid_transition', detail: `${it.status} → ${p.status}` };
    if (p.status === 'in_progress' && it.requires_approval && it.approval.status !== 'approved') return { error: 'approval_required', detail: 'this improvement changes creative, packaging, schedule or ad settings and needs the CEO\'s approval first' };
    if (p.status === 'completed') {
      const ev = isObj(p.evaluation) ? p.evaluation : null; const r = isObj(p.result) ? p.result : {};
      const outcome = OUTCOMES.includes(r.outcome) ? r.outcome : (ev && OUTCOMES.includes(ev.state) ? ev.state : null);
      if (!outcome) return { error: 'outcome_required', detail: ev && ev.state === 'pending' ? 'the review date has not been reached: record an outcome yourself, with a note' : 'record the outcome (successful, unsuccessful or inconclusive)' };
      const early = !!(ev && ev.state === 'pending'); const differs = ev && OUTCOMES.includes(ev.state) && ev.state !== outcome;
      if ((early || differs) && !str(r.note, LIMITS.note)) return { error: 'note_required', detail: early ? 'completing before the review date needs a note' : 'your outcome differs from the data-based reading; add a note' };
      const actual = isObj(r.actual) ? { value: isNum(r.actual.value) ? r.actual.value : null, n: isNum(r.actual.n) ? r.actual.n : null } : (ev && isObj(ev.actual) ? { value: isNum(ev.actual.value) ? ev.actual.value : null, n: isNum(ev.actual.n) ? ev.actual.n : null } : null);
      it.result = { outcome, actual: actual ? { ...actual, at: new Date(nowMs).toISOString() } : null, evaluated_by: !r.outcome && ev ? 'system' : 'ceo', early, note: str(r.note, LIMITS.note), at: new Date(nowMs).toISOString() };
      hist(it, by, 'result_' + outcome, (early ? 'early; ' : '') + str(r.note, 200), nowMs);
    }
    it.status = p.status; hist(it, by, 'status_' + p.status, '', nowMs);
  }
  if (p.lessons !== undefined) { it.lessons = str(p.lessons, LIMITS.note); hist(it, by, 'lessons', '', nowMs); }
  if (p.next_action !== undefined) { it.next_action = str(p.next_action, 300); hist(it, by, 'next_action', '', nowMs); }
  if (p.owner !== undefined && !TERMINAL.has(it.status)) { it.owner = str(p.owner, 160); hist(it, by, 'owner', it.owner, nowMs); }
  if (p.review_by !== undefined && !TERMINAL.has(it.status)) { if (!isDate(p.review_by)) return { error: 'invalid_review_date' }; it.review_by = p.review_by; hist(it, by, 'review_date', p.review_by, nowMs); }
  const items = doc.items.slice(); items[i] = cleanItem(it, doc.business); const next = { ...doc, rev: doc.rev + 1, updated_at: new Date(nowMs).toISOString(), items };
  return JSON.stringify(next).length > LIMITS.maxDocBytes ? { error: 'document_too_large' } : { doc: next, item: items[i] };
}
// The line the CEO sees on the business card: what is being worked on, who owns it, when it is reviewed and how the last one ended.
export function activeSummary(doc, nowMs) {
  const active = doc.items.filter((x) => !TERMINAL.has(x.status)).sort((a, b) => (a.review_by || '9999') < (b.review_by || '9999') ? -1 : 1);
  const last = doc.items.filter((x) => x.status === 'completed' && x.result).sort((a, b) => (a.result.at < b.result.at ? 1 : -1))[0] || null;
  const a = active[0] || null;
  return { active_count: active.length, active: a ? { id: a.id, problem: a.problem, status: a.status, owner: a.owner, review_by: a.review_by, overdue: !!(a.review_by && Date.parse(a.review_by + 'T00:00:00Z') < nowMs), awaiting_approval: a.requires_approval && a.approval.status === 'pending' } : null,
    last_result: last ? { problem: last.problem, outcome: last.result.outcome, at: (last.result.at || '').slice(0, 10), lessons: last.lessons || null, next_action: last.next_action || null } : null, total: doc.items.length };
}
