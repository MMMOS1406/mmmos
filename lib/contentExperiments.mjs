// Content experiments that enter the EXISTING production workflow (G10). PURE: no network, no clock, no environment.
// An approved experiment is carried by the production tasks that already exist: the next N Long tasks of THAT business get a small `experiment` tag
// (arm A or B + a plain instruction shown to the VA on the task card). Nothing else changes: no prompts, music, creative policy or publishing schedule.
// Three independent experiments, run ONE AT A TIME per business so each result is readable: thumbnail, title, visual opening.
export const EXPERIMENTS = Object.freeze({
  thumbnail_test: { variable: 'thumbnail', label: 'Thumbnail test', short: 'the thumbnail test', metric: 'reach',
    changes: 'only the thumbnail text: arm A keeps the normal text (12 characters or fewer), arm B uses a longer line (13–25 characters).',
    arms: [{ id: 'A', label: 'Normal thumbnail text', instruction: 'THUMBNAIL TEST — arm A. Keep the normal thumbnail text (12 characters or fewer). Change nothing else: same music, vocals, lyrics, title, visuals and publish time.' },
           { id: 'B', label: 'Longer thumbnail text', instruction: 'THUMBNAIL TEST — arm B. In the thumbnail text field use a longer line of 13–25 characters (the song\'s hook line). Change nothing else: same music, vocals, lyrics, title, visuals and publish time.' }],
    unchanged: ['music', 'vocals', 'lyrics', 'title', 'visuals', 'publishing schedule'] },
  title_test: { variable: 'title', label: 'Title test', short: 'the title test', metric: 'reach',
    changes: 'only the title structure: arm A keeps the normal title, arm B puts the search phrase first.',
    arms: [{ id: 'A', label: 'Normal title', instruction: 'TITLE TEST — arm A. Keep the normal title structure. Change nothing else: same music, vocals, lyrics, thumbnail, visuals and publish time.' },
           { id: 'B', label: 'Search phrase first', instruction: { silk_road_voices: 'TITLE TEST — arm B. Reorder the already-generated title as: Persian Love Song | <song title> | SRV Farsi. Wording stays as generated; only the order changes. Change nothing else: same music, vocals, lyrics, thumbnail, visuals and publish time.', srv_studio: 'TITLE TEST — arm B. Reorder the already-generated title as: Emotional Deep House | <song title> | SRV Studio. Wording stays as generated; only the order changes. Change nothing else: same music, vocals, lyrics, thumbnail, visuals and publish time.' } }],
    unchanged: ['music', 'vocals', 'lyrics', 'thumbnail', 'visuals', 'publishing schedule'] },
  opening_test: { variable: 'visual opening', label: 'Visual-opening test', short: 'the visual-opening test', metric: 'retention',
    changes: 'only the visual shown in the first 10 seconds: arm A keeps the automatic choice, arm B uses a different look from the same approved set.',
    arms: [{ id: 'A', label: 'Automatic visual', instruction: 'OPENING TEST — arm A. Keep the automatically selected avatar/background. Change nothing else: same music, vocals, lyrics, title, thumbnail and publish time.' },
           { id: 'B', label: 'Different look, same set', instruction: 'OPENING TEST — arm B. In the existing avatar/background selector choose a different look from the SAME approved set than the automatic one. Change nothing else: same music, vocals, lyrics, title, thumbnail and publish time.' }],
    unchanged: ['music', 'vocals', 'lyrics', 'title', 'thumbnail', 'publishing schedule'] },
});
export const EXPERIMENT_ORDER = Object.freeze(['thumbnail_test', 'title_test', 'opening_test']);
export const RELEASES = 6;            // 3 per arm
export const MIN_PER_ARM = 3;         // releases per arm before a retain/discontinue recommendation
export const MATURE_DAYS = 14;        // a release is measured only after it has been public this long
export const EXEC_BY = 'VA, through the Production tasks';
export const ENGINES = Object.freeze({ silk_road_voices: 'SRV Farsi', srv_studio: 'SRV English' });
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const DAY = 86400000;
const med = (a) => { const s = a.filter(isNum).slice().sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const armInstruction = (exp, arm, business) => { const a = EXPERIMENTS[exp].arms.find((x) => x.id === arm); return a ? (typeof a.instruction === 'string' ? a.instruction : (a.instruction[business] || '')) : ''; };
// The plan stored with the improvement record and shown to the CEO BEFORE approval: what changes, how many releases, who executes, what stays unchanged.
export function planFor(expKey, business) {
  const e = EXPERIMENTS[expKey]; if (!e || !ENGINES[business]) return null;
  return { experiment: expKey, variable: e.variable, label: e.label, short: e.short, changes: e.changes, releases: RELEASES, per_arm: RELEASES / 2, arms: e.arms.map((a) => ({ id: a.id, label: a.label })), unchanged: e.unchanged.slice(), executor: EXEC_BY, engine: ENGINES[business], metric: e.metric, mature_days: MATURE_DAYS, min_per_arm: MIN_PER_ARM };
}

/* ───────── task side (the production tasks that already exist) ───────── */
export const taskKey = (t) => String((t && (t.taskId !== undefined ? t.taskId : t.id)) ?? '');
export const isLongTask = (t) => !!t && (t.contentType === 'Long' || t.contentFormat === 'long' || t.isLong === true) && t.contentFormat !== 'mix' && !t.farsiMix;
export function videoIdOfPackage(p) {
  if (!p || typeof p !== 'object') return null; const ID = /^[A-Za-z0-9_-]{11}$/; const c = [p.youtubeVideoId, p.youtube_video_id, p._srvYtLongId, p.srvProduction && p.srvProduction.youtubeVideoId].find((x) => typeof x === 'string' && ID.test(x));
  return c || null;
}
// Eligible = an existing, not-yet-started Long production task of THIS business that is not a test task, has no package yet and carries no experiment tag.
export function eligibleTasks(tasks, packages, business) {
  const engine = ENGINES[business]; const havePkg = new Set((packages || []).map((p) => String(p && p.taskId)));
  return (tasks || []).filter((t) => t && t.engine === engine && isLongTask(t) && !t.isTest && !/\[TEST\]/i.test(t.name || '') && !t.experiment && !havePkg.has(taskKey(t)) && (t.status === 'assigned' || t.status === undefined || t.status === null))
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.isoDate || '').localeCompare(String(b.isoDate || '')));
}
// Tag up to `releases` slots. Arms alternate A,B,A,B… in order; slots already tagged for this experiment are kept (idempotent). Returns { tagged: [taskKey], total_slots, slots_open }.
export function tagTasks({ tasks, packages, business, itemId, key, expKey }) {
  const e = EXPERIMENTS[expKey]; if (!e) return { tagged: [], total_slots: 0, slots_open: 0, error: 'unknown_experiment' };
  const mine = (tasks || []).filter((t) => t && t.experiment && t.experiment.id === itemId); const used = mine.length;
  const room = Math.max(0, RELEASES - used); const pool = eligibleTasks(tasks, packages, business).slice(0, room); const tagged = [];
  pool.forEach((t, i) => { const slot = used + i; const arm = slot % 2 === 0 ? 'A' : 'B'; t.experiment = { id: itemId, key, exp: expKey, variable: e.variable, arm, slot: slot + 1, of: RELEASES, label: e.arms.find((a) => a.id === arm).label, instruction: armInstruction(expKey, arm, business), business, tagged_at: 0 }; tagged.push(taskKey(t)); });
  return { tagged, total_slots: used + tagged.length, slots_open: RELEASES - used - tagged.length };
}
// Remove tags of a stopped experiment from tasks that were NOT started (never from a task that already has a package).
export function untagTasks({ tasks, packages, itemId }) {
  const havePkg = new Set((packages || []).map((p) => String(p && p.taskId))); let n = 0;
  for (const t of tasks || []) if (t && t.experiment && t.experiment.id === itemId && !havePkg.has(taskKey(t))) { delete t.experiment; n++; }
  return n;
}

/* ───────── tracking and results ───────── */
// perf: { videoId: { per_day, pct, ctr, pub (YYYY-MM-DD), organic (bool: not advertising-exposed) } } for this business only.
export function trackExperiment({ itemId, expKey, tasks, packages, perf, nowMs }) {
  const e = EXPERIMENTS[expKey]; const parts = (tasks || []).filter((t) => t && t.experiment && t.experiment.id === itemId);
  const pkgBy = {}; for (const p of packages || []) if (p) pkgBy[String(p.taskId)] = p;
  const rows = parts.map((t) => { const p = pkgBy[taskKey(t)] || null; const vid = videoIdOfPackage(p); const pf = vid && perf ? perf[vid] || null : null; const age = pf && pf.pub ? Math.floor((nowMs - Date.parse(pf.pub + 'T00:00:00Z')) / DAY) : null;
    const state = vid ? (age !== null && age >= MATURE_DAYS ? 'measured' : 'published') : (p ? 'in production' : 'waiting for the VA');
    return { task: taskKey(t), name: t.name || '', arm: t.experiment.arm, slot: t.experiment.slot, state, video_id: vid, age_days: age, per_day: pf && state === 'measured' && pf.organic !== false ? pf.per_day : null, pct: pf && state === 'measured' ? pf.pct : null, ctr: pf && state === 'measured' ? pf.ctr : null, excluded_paid: !!(pf && pf.organic === false) }; });
  const count = (s) => rows.filter((r) => r.state === s).length;
  const arm = (id) => { const a = rows.filter((r) => r.arm === id); const m = e && e.metric === 'retention' ? 'pct' : 'per_day'; const vals = a.map((r) => r[m]).filter(isNum); return { id, releases: a.length, published: a.filter((r) => r.video_id).length, measured: vals.length, median: med(vals), metric: m }; };
  const A = arm('A'), B = arm('B');
  return { slots: RELEASES, tagged: rows.length, waiting: count('waiting for the VA'), in_production: count('in production'), published: rows.filter((r) => r.video_id).length, measured: rows.filter((r) => isNum(r.per_day) || isNum(r.pct)).length, arms: { A, B }, rows, recommendation: recommend(A, B, e) };
}
// Retain / discontinue / extend, with the reason; always labelled by sample size. The CEO still records the outcome.
export function recommend(A, B, e) {
  const need = MIN_PER_ARM; const unit = e && e.metric === 'retention' ? 'average percentage viewed' : 'organic views per day';
  if (!A || !B || A.measured < need || B.measured < need) return { verdict: 'pending', text: `Waiting for results: ${Math.min(A ? A.measured : 0, B ? B.measured : 0)} of ${need} measured releases per arm (a release is measured ${MATURE_DAYS} days after it is public).`, basis: null };
  const ratio = A.median > 0 ? B.median / A.median : null; const basis = { metric: unit, A: Math.round(A.median * 10) / 10, B: Math.round(B.median * 10) / 10, ratio: ratio === null ? null : Math.round(ratio * 100) / 100, n_per_arm: [A.measured, B.measured] };
  const strongN = A.measured >= 4 && B.measured >= 4; const tag = strongN ? '' : ' (small sample: 3 releases per arm)';
  if (ratio !== null && ratio >= 1.3) return { verdict: 'retain', text: `Retain arm B: median ${unit} ${basis.B} versus ${basis.A} (${ratio}×)${tag}.`, basis };
  if (ratio !== null && ratio <= 0.9) return { verdict: 'discontinue', text: `Discontinue arm B and keep arm A: median ${unit} ${basis.B} versus ${basis.A} (${ratio}×)${tag}.`, basis };
  return { verdict: 'inconclusive', text: `No clear difference (${basis.B} versus ${basis.A}${ratio === null ? '' : ', ' + ratio + '×'})${tag}. Keep the current approach; extend by 2 releases per arm only if the CEO wants a firmer answer.`, basis };
}
// One-line status for the homepage card.
export function statusLine(tr, reviewBy) {
  if (!tr) return null; const m = tr.measured, p = tr.published;
  if (tr.recommendation.verdict !== 'pending') return `Test complete: ${tr.recommendation.verdict === 'retain' ? 'retain arm B' : tr.recommendation.verdict === 'discontinue' ? 'discontinue arm B' : 'no clear difference'}. Record the result in Analytics.`;
  return `Test running: ${tr.tagged} of ${tr.slots} releases assigned, ${p} published, ${m} measured` + (reviewBy ? `. Review ${reviewBy}.` : '.');
}
