// Recommendation plan: turns the diagnosis into SPECIFIC, MEASURABLE, ADVISORY improvement proposals — and evaluates a started improvement against its own baseline and target.
// PURE: no network, database or clock (the caller passes `nowMs`). One business at a time. Nothing here changes a prompt, lyrics, music, avatar, title, thumbnail, schedule, ad setting or configuration.
// Every proposal answers: what is the problem · what evidence supports it · what exactly to change or test · why it might help (a labelled hypothesis) · who owns it ·
//   baseline · target · when to review · how success, failure and "inconclusive" are decided.
const DAY = 86400000;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const dkey = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmt = (n) => (isNum(n) ? Math.round(n * 100) / 100 : '—');

// The measures an improvement can be judged on. `n` names the sample-size field; `min_n` is the least sample for a verdict; `auto:false` = recorded by a person (no automatic reading exists yet).
export const METRICS = Object.freeze({
  organic_views_28d: { label: 'Organic views (28 days)', unit: 'views', dir: 'up', auto: true },
  paid_share_pct: { label: 'Advertising share of views', unit: '%', dir: 'down', auto: true },
  long_median_at25: { label: 'Long videos: watch ratio at 25% of the runtime (median)', unit: '', dir: 'up', auto: true, n: 'long_n', min_n: 3 },
  long_views_per_upload: { label: 'Long videos: views per new Long upload', unit: 'views', dir: 'up', auto: true, n: 'long_uploads', min_n: 3 },
  uploads_28d: { label: 'Uploads in 28 days', unit: 'uploads', dir: 'up', auto: true },
  ctr_median_recent: { label: 'Click-through rate (median, newest uploads)', unit: '', dir: 'up', auto: true, n: 'n_recent', min_n: 5 },
  subs_per_1000_organic: { label: 'Subscribers per 1,000 organic views', unit: '', dir: 'up', auto: true },
  attribution_share_pct: { label: 'Share of lost organic views attributed to named sources', unit: '%', dir: 'up', auto: false },
  ctr_known_uploads: { label: 'Uploads with a known click-through rate', unit: 'uploads', dir: 'up', auto: false },
  content_test_reach: { label: 'Views per day per Long (test releases)', unit: 'views', dir: 'up', auto: false },
  content_test_pct: { label: 'Average percentage viewed per Long (test releases)', unit: '%', dir: 'up', auto: false },
  content_fields_recorded: { label: 'Long videos with the new production fields recorded', unit: 'videos', dir: 'up', auto: false },
});
// Current value (and sample size) of every automatic measure, read from one business's card.
export function currentMetrics(card) {
  if (!card || card.state !== 'ok') return {};
  const k = card.kpis || {}, d = card.diagnosis || {}, cat = (key) => (d.categories || []).find((c) => c.key === key) || {}, st = (key) => cat(key).stats || {};
  const m = {};
  const put = (id, value, n) => { if (isNum(value)) m[id] = { value, n: isNum(n) ? n : null }; };
  put('organic_views_28d', k.organic && k.organic.value, null);
  put('paid_share_pct', card.split && card.split.verifiable ? card.split.paid_share_pct : null, null);
  put('long_median_at25', st('retention').median_at25, st('retention').long_n);
  put('long_views_per_upload', st('distribution').long_per_upload, st('distribution').long_uploads);
  put('uploads_28d', card.content && card.content.uploads ? card.content.uploads.last28 : null, null);
  put('ctr_median_recent', st('packaging').ctr_recent, st('packaging').n_recent);
  put('subs_per_1000_organic', k.subscribers && k.subscribers.per_1000_organic, null);
  return m;
}

const REASON = {
  distribution: 'Naming the source that lost the views shows whether the cause is discovery (search or suggested videos), the Shorts feed, subscriber notifications or fewer new uploads.',
  retention: 'Separating paid from organic viewers and changing only the opening isolates whether the early drop comes from the audience reached or from the opening itself.',
  packaging: 'Click-through rate separates a packaging problem (few clicks per impression) from a distribution problem (few impressions) and a retention problem (viewers leave after clicking).',
  audience: 'A visible, specific prompt to subscribe can raise subscribers per view when conversion is the weak step.',
  publishing: 'Holding the upload cadence constant removes upload frequency as an explanation for changes in views, so the effect of other changes can be read.',
  economics: 'A period without paid ads shows how many views the catalog earns on its own and what organic viewers actually do.',
};
const APPROVAL = { distribution: false, retention: true, packaging: true, audience: true, publishing: true, economics: true };   // creative, title/thumbnail, schedule and ad-setting changes need the CEO's approval

function baselineTarget(category, card, nowMs, D) {
  const m = currentMetrics(card), cur = (id) => (m[id] ? m[id].value : null);
  const prevOrg = card.kpis && card.kpis.organic ? card.kpis.organic.prev : null;
  switch (category) {
    case 'distribution': if (card.policy && card.policy.long_only) return { baseline: { metric: 'ctr_known_uploads', value: 0 }, target: { metric: 'ctr_known_uploads', value: 5, rule: 'impressions and click-through rate known for at least 5 Long uploads, each with a day-7 view count' } };
      return { baseline: { metric: 'organic_views_28d', value: cur('organic_views_28d') }, target: { metric: 'attribution_share_pct', value: 80, rule: 'at least 80% of the lost organic views attributed to named traffic sources (or shown not to be an exposure change)' } };
    case 'retention': return { baseline: { metric: 'long_median_at25', value: cur('long_median_at25'), n: m.long_median_at25 ? m.long_median_at25.n : null }, target: { metric: 'long_median_at25', value: 0.5, rule: 'median watch ratio at 25% of at least 0.50 across the next 3 Long uploads (each with 300+ views)' } };
    case 'packaging': {
      const pk = ((card.diagnosis || {}).categories || []).find((c) => c.key === 'packaging') || {}; const s = pk.stats || {};
      return isNum(s.ctr_recent) ? { baseline: { metric: 'ctr_median_recent', value: s.ctr_recent, n: s.n_recent }, target: { metric: 'ctr_median_recent', value: isNum(s.ctr_earlier) ? s.ctr_earlier : null, rule: 'median click-through rate back to the earlier uploads\' level across the next 3 uploads (5+ in the comparison group)' } }
        : { baseline: { metric: 'ctr_known_uploads', value: 0 }, target: { metric: 'ctr_known_uploads', value: 5, rule: 'click-through rate known for at least 5 uploads' } }; }
    case 'audience': { const pv = card.kpis && card.kpis.subscribers ? card.kpis.subscribers.prev_per_1000_organic : null; return { baseline: { metric: 'subs_per_1000_organic', value: cur('subs_per_1000_organic') }, target: { metric: 'subs_per_1000_organic', value: pv, rule: 'back to the previous period\'s subscribers per 1,000 organic views' } }; }
    case 'publishing': { const prev = card.content && card.content.uploads ? card.content.uploads.prev28 : null; return { baseline: { metric: 'uploads_28d', value: cur('uploads_28d') }, target: { metric: 'uploads_28d', value: prev, rule: 'at least the previous period\'s number of uploads in the next 28 days' } }; }
    case 'economics': return { baseline: { metric: 'paid_share_pct', value: cur('paid_share_pct') }, target: { metric: 'paid_share_pct', value: 10, rule: 'one 28-day window with advertising at or below 10% of views, with organic views and organic watch time recorded' } };
    default: return { baseline: null, target: null };
  }
}

// The business goal for the next 28 days (one line on the card).
export function businessGoal(card, nowMs) {
  const k = card.kpis || {}, s = card.status || {}, m = currentMetrics(card), review_by = dkey(nowMs + 28 * DAY);
  if (s.code === 'reset' || !(k.organic && k.organic.comparable)) {
    if (m.long_views_per_upload) { const b = m.long_views_per_upload.value, t = Math.max(100, Math.round(b * 2)); return { metric: 'long_views_per_upload', label: METRICS.long_views_per_upload.label, baseline: b, target: t, rule: `at least ${t} views per new Long upload (twice today's level, minimum 100), judged on the next 3 or more Long uploads`, review_by }; }
    return { metric: 'organic_views_28d', label: METRICS.organic_views_28d.label, baseline: k.organic ? k.organic.value : null, target: null, rule: 'no comparable previous period: a target is set once 28 days of the new catalog exist', review_by };
  }
  const base = k.organic.value, prev = k.organic.prev;
  if (s.code === 'declining' && isNum(prev)) return { metric: 'organic_views_28d', label: METRICS.organic_views_28d.label, baseline: base, target: prev, rule: `organic views back to the previous 28-day level (${Math.round(prev).toLocaleString('en-US')})`, review_by };
  const t = isNum(base) ? Math.round(base * 1.1) : null; return { metric: 'organic_views_28d', label: METRICS.organic_views_28d.label, baseline: base, target: t, rule: 'organic views 10% above the current 28-day level', review_by };
}

const PRIORITY = (c) => (c.supported && c.status === 'problem_observed' ? 0 : c.status === 'problem_observed' ? 1 : c.status === 'insufficient_evidence' ? 2 : 3);
export function buildPlan({ business, name, card, nowMs }) {
  if (!card || card.state !== 'ok' || !card.diagnosis || card.diagnosis.state !== 'ok') return { business, goal: null, proposals: [] };
  const d = card.diagnosis; const proposals = [];
  for (const c of d.categories) {
    if (!c.experiment) continue;
    const bt = baselineTarget(c.key, card, nowMs, d);
    const prefer = c.status === 'problem_observed' || c.status === 'insufficient_evidence';
    if (!prefer) continue;
    const evidence = c.confirmed.slice(0, 3);
    proposals.push({
      key: `${c.key}:${business}`, business, category: c.key, priority: PRIORITY(c),
      problem: c.headline || c.label.split(' — ')[0] + ': ' + (c.status === 'problem_observed' ? 'problem observed' : 'cannot be judged with the data stored'),
      evidence, evidence_status: c.supported ? 'supported' : c.status === 'problem_observed' ? 'observed, cause not established' : 'insufficient evidence', confidence: c.confidence,
      action: c.experiment.text, short: c.experiment.short || c.experiment.text, why: (c.hypothesis ? 'Hypothesis (not tested): ' + c.hypothesis + ' ' : '') + REASON[c.key],
      owner: c.experiment.owner, requires_approval: APPROVAL[c.key] === true, needs: c.experiment.needs,
      baseline: bt.baseline ? { ...bt.baseline, label: (METRICS[bt.baseline.metric] || {}).label || bt.baseline.metric, captured_at: dkey(nowMs) } : null,
      target: bt.target ? { ...bt.target, label: (METRICS[bt.target.metric] || {}).label || bt.target.metric } : null,
      review_days: c.experiment.review_days, review_by: dkey(nowMs + c.experiment.review_days * DAY),
      success: c.experiment.success,
      failure: 'The review date has passed, the sample is adequate and the measure did not move beyond its baseline (or moved the wrong way).',
      inconclusive: 'The review date has passed but the sample is too small, the data does not yet cover the period, or the measure improved without reaching the target.',
      measure: bt.target ? { metric: bt.target.metric, auto: !!(METRICS[bt.target.metric] || {}).auto } : null,
      advisory: true,
    });
  }
  proposals.sort((a, b) => a.priority - b.priority);
  return { business, name, goal: businessGoal(card, nowMs), proposals };
}

// Verdict on a started improvement. Never invents a result: before the review date it is "pending"; with no automatic reading, or too small a sample, it is "inconclusive" and says why.
export function evaluateImprovement(item, metrics, nowMs) {
  if (!item || !item.target || !item.review_by) return { state: 'unknown', reason: 'no target or review date' };
  if (nowMs < Date.parse(item.review_by + 'T00:00:00Z')) return { state: 'pending', reason: `review on ${item.review_by}` };
  const def = METRICS[item.target.metric]; if (!def) return { state: 'inconclusive', reason: 'unknown measure' };
  if (!def.auto) return { state: 'due_manual', reason: 'this measure is recorded by a person; enter the result' };
  const cur = metrics && metrics[item.target.metric]; if (!cur || !isNum(cur.value)) return { state: 'inconclusive', reason: 'the measure is not available in the current data' };
  if (def.min_n && !(isNum(cur.n) && cur.n >= def.min_n)) return { state: 'inconclusive', reason: `sample too small (${cur.n ?? 0} of at least ${def.min_n})`, actual: cur };
  const t = item.target.value, b = item.baseline ? item.baseline.value : null; if (!isNum(t)) return { state: 'inconclusive', reason: 'no numeric target', actual: cur };
  const up = def.dir === 'up'; const met = up ? cur.value >= t : cur.value <= t; if (met) return { state: 'successful', reason: `${fmt(cur.value)} reached the target ${fmt(t)}`, actual: cur };
  if (isNum(b) && (up ? cur.value <= b : cur.value >= b)) return { state: 'unsuccessful', reason: `${fmt(cur.value)} did not improve on the baseline ${fmt(b)}`, actual: cur };
  return { state: 'inconclusive', reason: `${fmt(cur.value)} improved on ${fmt(b)} but did not reach ${fmt(t)}`, actual: cur };
}
