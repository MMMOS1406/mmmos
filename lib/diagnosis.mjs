// Root-cause diagnostic model (advisory only). PURE: no network, database or clock (the caller passes `nowMs`).
// One business at a time: it only ever sees that business's dashboard model, its collected per-video rows and its own catalog rows (isolation is by construction).
// It separates five things and never turns a correlation into a cause:
//   distribution (exposure) · packaging (clicks per exposure) · retention (leaving early) · audience development (repeat viewing / subscribers) · insufficient evidence
// Every category states: confirmed observation(s) with sample size, a labelled hypothesis, confidence, missing evidence, a recommended experiment (owner, review date, success measure).
// Nothing here changes a prompt, thumbnail, title, music, schedule or publishing step; every creative experiment is a proposal that needs CEO approval and must stay inside the approved policies.
const DAY = 86400000;
export const D_MIN = Object.freeze({ curveViews: 100, longSample: 1000, subsSample: 20, convFlat: 0.15, shortMaxSec: 61, longMinSec: 180, classTolerance: 0.1, newCohortShare: 60 });
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x) => (x === null || x === undefined || x === '' ? null : (Number.isFinite(Number(x)) ? Number(x) : null));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dlab = (k) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(k || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : '?'; };
const dkey = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmt = (n) => (isNum(n) ? Math.round(n).toLocaleString('en-US') : '—');
const r2 = (x) => (isNum(x) ? Math.round(x * 100) / 100 : null);
const pctOf = (a, b) => (isNum(a) && isNum(b) && b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const median = (a) => { const s = a.filter(isNum).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const stripBidi = (s) => String(s == null ? '' : s).replace(/[‎‏‪-‮⁦-⁩]/g, '');
const shortT = (t, n = 38) => { t = stripBidi(t).replace(/\s*\|\s*(Persian|SRV).*$/i, '').replace(/\s*-\s*Emotional Deep House.*$/i, '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
// Evidence grades and the rules that turn a measurement into a SUPPORTED diagnosis. A hypothesis can never be promoted to a cause by this model: only a category whose
// `supported` flag is true (sample and mechanism evidence present) may be named as the outcome, and even then the model says what it does NOT establish.
export const CONFIDENCE_RULES = Object.freeze([
  'Confirmed observation: measured directly in collected data (not inferred), with the sample size shown.',
  'Hypothesis: an explanation that was not measured. It is always labelled "not tested" and is never counted as evidence.',
  'Supported diagnosis: the observation meets its sample threshold AND the mechanism that would explain it is measured. Missing mechanism evidence caps the category at "observed — cause not established".',
  'Sample thresholds: Long-retention needs 3 or more Long videos with 300+ views each; traffic attribution needs a previous-window source split; packaging needs impressions and click-through rate for 5+ uploads; audience development needs 20+ net subscribers across both windows; a Long-video exposure read needs 1,000+ Long views.',
  'Confidence: High = threshold sample + two independent measures agree + no missing mechanism evidence; Medium = threshold sample + one measure; Low = anything else. Low-confidence conclusions are flagged on screen.',
  'Outcome: exactly one of distribution, packaging, retention, audience development, or insufficient evidence. Priority follows the viewer funnel (exposure → click → watch → return).',
]);
export const SAMPLE_GRADE = (views) => (views >= 1000 ? 'adequate' : views >= 300 ? 'limited' : views >= 100 ? 'low' : 'insufficient');
export const POLICY_TEXT = Object.freeze({
  srv_studio: 'Female Emotional Deep House, Long only. Do not recommend resuming Shorts. Any creative change needs CEO approval.',
  silk_road_voices: 'Approved Farsi Creative V2 and the artist/mood policies stay as they are. Any creative change needs CEO approval; experiments below change measurement, packaging tests and ad settings only.',
});

// ── 1. format classification per video. Authoritative source = YouTube creatorContentType totals (collected). Per-video type is not stored, so it is ESTIMATED from the stored
//      average view duration ÷ average % viewed (≈ runtime) and VALIDATED against those authoritative totals; if they disagree the classification is declared unreliable. ──
export function classifyVideos(videoRows, formats, formatMap) {
  const rows = (Array.isArray(videoRows) ? videoRows : []).map((v) => { const avd = num(v.avd ?? v.avg_view_duration_sec), pct = num(v.pct ?? v.avg_view_pct), views = num(v.views) || 0; const rt = avd > 0 && pct > 0 ? avd / (pct / 100) : null;
    const id = v.id || v.video_id; const est = rt === null ? 'unknown' : rt <= D_MIN.shortMaxSec ? 'short' : rt >= D_MIN.longMinSec ? 'long' : 'ambiguous';
    const pm = formatMap && typeof formatMap.get === 'function' ? formatMap.get(id) : (formatMap && formatMap[id]);   // production metadata (package contentFormat) — authoritative where it exists
    const prod = pm === 'short' ? 'short' : (pm === 'long' || pm === 'mix') ? 'long' : null;
    return { id, views, avd, pct, subs: num(v.subs_gained), runtime_sec: rt === null ? null : Math.round(rt), est_type: est, type: prod || est, source: prod ? 'production' : 'estimated' }; });
  const sum = (t) => rows.filter((r) => r.est_type === t).reduce((a, r) => a + r.views, 0);
  const est = { short: sum('short'), long: sum('long'), ambiguous: sum('ambiguous'), unknown: sum('unknown') };
  const api = { long: null, short: null };
  for (const f of (formats && formats.rows) || []) if (f.type === 'long' || f.type === 'short') api[f.type] = num(f.views);
  let validated = null, note = 'The YouTube content-type totals are not available, so the per-video format could not be validated.';
  if (isNum(api.long) && isNum(api.short)) {
    const tot = api.long + api.short, tol = Math.max(50, tot * D_MIN.classTolerance);
    validated = Math.abs(est.short - api.short) <= tol && Math.abs(est.long + est.ambiguous - api.long) <= tol;
    note = validated ? `Estimated Short ${fmt(est.short)} / Long ${fmt(est.long + est.ambiguous)} views agree with YouTube's content-type totals (Short ${fmt(api.short)} / Long ${fmt(api.long)}).` : `Estimated Short ${fmt(est.short)} / Long ${fmt(est.long + est.ambiguous)} views do NOT agree with YouTube's totals (Short ${fmt(api.short)} / Long ${fmt(api.long)}): per-video format is unreliable.`;
  }
  const both = rows.filter((r) => r.source === 'production' && r.est_type !== 'unknown'); const agree = both.filter((r) => (r.est_type === 'ambiguous' ? 'long' : r.est_type) === r.type).length;
  const production = { videos: rows.filter((r) => r.source === 'production').length, views: rows.filter((r) => r.source === 'production').reduce((a, r) => a + r.views, 0), compared: both.length, agree };
  return { rows, est, api, validated, production, basis: 'Format = production package metadata where the video is linked to a package, otherwise estimated runtime (average view duration ÷ average % viewed). Short ≤ 61 s, Long ≥ 180 s. The authoritative per-video duration (Data API contentDetails.duration) is not stored yet. = average view duration ÷ average % viewed (stored per video). Short ≤ 61 s, Long ≥ 180 s. The authoritative per-video duration (Data API contentDetails.duration) is not stored yet.', note };
}

// ── 2. facts the categories share ──
function facts({ dash, cls, catalog, nowMs }) {
  const w = dash.windows || {}, d28 = w.d28 || {}, p28 = w.d28_prev || {};
  const byId = new Map((catalog || []).map((c) => [c.video_id, c]));
  const from = dash.traffic && dash.traffic.window ? dash.traffic.window.from : (d28.from || dkey(nowMs - 28 * DAY));
  const fromMs = Date.parse(from + 'T00:00:00Z');
  const cohort = { new_views: 0, old_views: 0, unknown_views: 0, new_n: 0, old_n: 0 };
  for (const r of cls.rows) { const c = byId.get(r.id); const pub = c && c.published_at ? Date.parse(c.published_at) : NaN; if (isNaN(pub)) cohort.unknown_views += r.views; else if (pub >= fromMs) { cohort.new_views += r.views; cohort.new_n++; } else { cohort.old_views += r.views; cohort.old_n++; } }
  const up = (a, b) => (catalog || []).filter((c) => c.published_at && Date.parse(c.published_at) >= a && Date.parse(c.published_at) < b).length;
  const uploads = { last28: up(nowMs - 28 * DAY, nowMs + DAY), prev28: up(nowMs - 56 * DAY, nowMs - 28 * DAY) };
  const organicRows = ((dash.traffic && dash.traffic.rows) || []).filter((t) => !t.paid && isNum(t.views));
  const orgTotal = organicRows.reduce((a, t) => a + t.views, 0);
  const sources = organicRows.slice().sort((a, b) => b.views - a.views).map((t) => ({ source: t.source, views: t.views, share_pct: pctOf(t.views, orgTotal) }));
  const withLikes = (catalog || []).filter((c) => isNum(num(c.view_count)) && num(c.view_count) > 0 && c.like_count !== null && c.like_count !== undefined);
  const lifeViews = withLikes.reduce((a, c) => a + num(c.view_count), 0), likes = withLikes.reduce((a, c) => a + (num(c.like_count) || 0), 0), comments = withLikes.reduce((a, c) => a + (num(c.comment_count) || 0), 0);
  const engagement = lifeViews > 0 ? { basis: 'lifetime counts, all views incl. paid', videos: withLikes.length, views: lifeViews, likes, comments, likes_per_1000: r2((likes / lifeViews) * 1000), comments_per_1000: r2((comments / lifeViews) * 1000) } : null;
  const ctrKnown = (catalog || []).filter((c) => num(c.ctr) !== null || num(c.impressions) !== null).length;
  // previous-window traffic split (collector change C1; absent today). Organic sources only: paid is reported separately.
  const prevRows = dash.traffic_prev && Array.isArray(dash.traffic_prev.rows) ? dash.traffic_prev.rows.filter((t) => !t.paid && isNum(t.views)) : null;
  let attribution = null;
  if (prevRows && prevRows.length && organicRows.length) {
    const prev = new Map(prevRows.map((t) => [t.source, t.views])); const cur = new Map(organicRows.map((t) => [t.source, t.views]));
    const names = [...new Set([...prev.keys(), ...cur.keys()])]; const deltas = names.map((n) => ({ source: n, prev: prev.get(n) || 0, cur: cur.get(n) || 0 })).map((x) => ({ ...x, delta: x.cur - x.prev }));
    const losers = deltas.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta); const loss = losers.reduce((a, x) => a + Math.abs(x.delta), 0); const net = prevRows.reduce((a, t) => a + t.views, 0) - orgTotal;
    const top2 = losers.slice(0, 2); const top2loss = top2.reduce((a, x) => a + Math.abs(x.delta), 0);
    attribution = { deltas: deltas.sort((a, b) => a.delta - b.delta), net_decline: net, loss, top2: top2.map((x) => x.source), top2_share_pct: loss > 0 ? pctOf(top2loss, loss) : null, concentrated: net > 0 && loss >= net * 0.5 && loss > 0 && top2loss / loss >= 0.5 };
  }
  return { d28, p28, from, cohort, uploads, sources, orgTotal, engagement, ctrKnown, attribution, catalogN: (catalog || []).length, byId };
}

const cat = (key, label, o) => ({ key, label, status: 'insufficient_evidence', supported: false, support_note: '', confirmed: [], metrics: [], hypothesis: null, confidence: 'Low', missing: [], experiment: null, ...o });
const EXPORT_STEP = (to) => `Export YouTube Studio → Analytics → Reach (traffic source types, impressions, impressions click-through rate) for the 28 days to ${dlab(to)} and for the 28 days before, and give the two files to Claude Code.`;

// ── 3. the categories ──
function distribution({ business, dash, status, cls, F, nowMs, longOnly }) {
  const c = cat('distribution', 'Distribution — is exposure insufficient or declining?');
  const d28 = F.d28, p28 = F.p28; const through = (dash.freshness && dash.freshness.last_day) || dkey(nowMs);
  const cmp = status.comparable && status.delta_pct !== null;
  if (!isNum(d28.non_ad_views)) { c.confirmed.push('Organic views cannot be separated from paid views for the whole period.'); c.missing.push('Paid/organic series for every day of the window'); return c; }
  if (cmp) c.confirmed.push(`Organic views ${status.delta_pct < 0 ? 'fell' : 'rose'} ${Math.abs(status.delta_pct)}% (${fmt(d28.non_ad_views)} vs ${fmt(p28.non_ad_views)} in the previous 28 days).`);
  else if (status.code === 'reset') c.confirmed.push('The channel catalog was reset, so the previous 28 days are not comparable.');
  if (status.momentum) c.confirmed.push(status.momentum.text + '.');
  const top = F.sources.slice(0, 3); if (top.length) c.confirmed.push('Organic views by source this window: ' + top.map((s) => `${s.source.replace(/_/g, ' ').toLowerCase()} ${s.share_pct}%`).join(', ') + ` (${fmt(F.orgTotal)} organic views).`);
  const k = F.cohort, kt = k.new_views + k.old_views + k.unknown_views;
  if (kt > 0) c.confirmed.push(`Videos published inside the window (${k.new_n}) drew ${fmt(k.new_views)} views in total, all views incl. any paid${isNum(d28.non_ad_views) && d28.non_ad_views > 0 ? `; that is at most ${Math.min(100, pctOf(k.new_views, d28.non_ad_views))}% of the ${fmt(d28.non_ad_views)} organic views (paid views are not split per video)` : ''}. ${k.old_n} older videos drew ${fmt(k.old_views)}.`);
  if (F.catalogN) c.confirmed.push(`Uploads: ${F.uploads.last28} in the last 28 days vs ${F.uploads.prev28} in the 28 days before.`);
  c.metrics = [{ label: 'organic views, 28 d', value: fmt(d28.non_ad_views), sample: 'channel total' }, { label: 'views from uploads published in the window', value: fmt(k.new_views), sample: `${k.new_n} videos, incl. any paid` }];
  const prob = status.code === 'declining' || (status.momentum && status.momentum.label === 'slowing' && status.code !== 'growing') || status.code === 'reset';
  if (longOnly) {
    const L = cls.rows.filter((r) => r.type === 'long'), S = cls.rows.filter((r) => r.type === 'short');
    const lv = L.reduce((a, r) => a + r.views, 0), sv = S.reduce((a, r) => a + r.views, 0);
    const newL = L.filter((r) => { const p = F.byId.get(r.id); return p && p.published_at && Date.parse(p.published_at) >= Date.parse(F.from + 'T00:00:00Z'); });
    const perL = newL.length ? Math.round(newL.reduce((a, r) => a + r.views, 0) / newL.length) : null, perS = S.length ? Math.round(sv / S.length) : null;
    c.confirmed.unshift(`Long videos drew ${fmt(lv)} views from ${L.length} videos${perL !== null ? ` (about ${fmt(perL)} each for those published in the window)` : ''}; Shorts, now historical, drew ${fmt(sv)} from ${S.length} videos${perS !== null ? ` (about ${fmt(perS)} each)` : ''}.`);
    c.headline = `Long videos are getting little exposure${perL !== null && perS !== null ? ` (about ${fmt(perL)} views each, against about ${fmt(perS)} for the historical Shorts)` : ''}; the sample is small`;
    const shortFeed = F.sources.find((s) => s.source === 'SHORTS'); if (shortFeed && shortFeed.share_pct >= 50) c.confirmed.push(`${shortFeed.share_pct}% of organic views came from the Shorts feed, a surface Long-only uploads do not use.`);
    c.stats = { long_per_upload: perL, long_uploads: newL.length, short_per_upload: perS, long_views: lv, short_views: sv };
    c.metrics.push({ label: 'Long views per Long video (window uploads)', value: perL === null ? '—' : fmt(perL), sample: `${newL.length} Long uploads` });
    c.status = 'problem_observed'; c.confidence = 'Low';
    c.hypothesis = 'Viewers who found the channel through the Shorts feed may not be reaching the Long videos, and new Long uploads have had little exposure so far. Not tested.';
    c.missing = ['Impressions per Long upload (not collected)', 'Traffic source of the Long views (the report is not split by format)', 'Number of Long uploads and their age (authoritative duration not stored)'];
  } else {
    if (prob && cmp) c.headline = `Organic views ${status.delta_pct < 0 ? 'fell' : 'rose'} ${Math.abs(status.delta_pct)}% against the previous 28 days`; else if (prob) c.headline = 'Organic views are slowing';
    c.status = prob ? 'problem_observed' : 'no_problem_observed'; c.confidence = cmp && d28.non_ad_views >= 2000 && p28.non_ad_views >= 2000 ? 'Medium' : 'Low';
    if (prob) {
      c.hypothesis = 'Fewer or weaker new releases, or faster decay of older videos, may be lowering organic views. Not tested: paid views are not split per video and the traffic sources of the previous 28 days are not stored, so which source lost views is unknown.';
      c.missing = ['Traffic-source split for the previous 28 days (stored for the current window only)', 'Impressions (not collected)', 'Organic vs paid views per video (not collected)'];
    }
  }
  // supported only when the MECHANISM is measured: a named-source attribution of the lost organic views (previous-window split) — never from the decline alone
  const A = F.attribution;
  if (A) { c.confirmed.push('Organic views by source vs the previous 28 days: ' + A.deltas.slice(0, 3).map((x) => `${x.source.replace(/_/g, ' ').toLowerCase()} ${x.delta >= 0 ? '+' : '−'}${fmt(Math.abs(x.delta))}`).join(', ') + '.'); }
  c.supported = !!(A && A.concentrated && cmp && prob && d28.non_ad_views >= 2000 && p28.non_ad_views >= 2000);
  c.support_note = c.supported ? `Supported: ${A.top2_share_pct}% of the lost organic views come from ${A.top2.map((x) => x.replace(/_/g, ' ').toLowerCase()).join(' and ')}.` : (c.status === 'problem_observed' ? 'Observed, not supported as a cause: ' + (A ? 'the lost views are not concentrated in named sources' : longOnly ? 'Long-video impressions and the traffic source of the Long views are not collected, so the cause of low Long exposure cannot be named' : 'the previous-window traffic-source split is not stored, so the source of the decline cannot be named') + '.' : '');
  if (c.status === 'problem_observed') c.experiment = longOnly
    ? { text: `Diagnostic first, no creative change: ${EXPORT_STEP(through)} Read the Long uploads separately, then compare their exposure with the earlier Shorts. Record day-1, day-3 and day-7 views for each of the next three Long uploads.`, short: 'Get impressions, click-through rate and traffic sources for the Long uploads (Studio export), compare Long exposure with the earlier Shorts, and log day-1/3/7 views for the next three Long uploads.', owner: 'CEO (export) → Growth & Analytics', review_days: 14, success: 'Impressions and click-through rate are known for every Long upload, and each of the next three Long uploads has a day-7 view count to judge it against.', needs: 'CEO-provided export (no authorization needed) — or authorize collector changes C1/C3 below' }
    : { text: `Diagnostic first, no creative change: ${EXPORT_STEP(through)} With the two periods side by side we can name the source that lost the views.`, short: 'Get the traffic-source split for both 28-day periods (Studio export) and name the source that lost the views.', owner: 'CEO (export) → Growth & Analytics', review_days: 7, success: 'At least 80% of the lost organic views are attributed to named traffic sources, or the decline is shown not to come from exposure.', needs: 'CEO-provided export (no authorization needed) — or authorize collector change C1 below' };
  return c;
}
function packaging({ business, F, through, longOnly, reach }) {
  const c = cat('packaging', 'Packaging — are clicks weak relative to exposure?');
  if (reach && reach.recent && reach.earlier && (reach.recent.n || reach.earlier.n)) {   // impressions / CTR from the Reporting API reach reports (once a job exists and has accumulated data)
    const pc = (x) => (x === null || x === undefined ? '—' : (Math.round(x * 1000) / 10) + '%');
    c.confirmed.push(`Click-through rate (impressions): median ${pc(reach.recent.median_ctr)} for the ${reach.recent.n} newest uploads vs ${pc(reach.earlier.median_ctr)} for the ${reach.earlier.n} before.`);
    c.stats = { ctr_recent: reach.recent.median_ctr, ctr_earlier: reach.earlier.median_ctr, n_recent: reach.recent.n, n_earlier: reach.earlier.n, change_pct: reach.change_pct };
    c.metrics = [{ label: 'median CTR, newest uploads', value: pc(reach.recent.median_ctr), sample: `${reach.recent.n} uploads` }];
    if (reach.enough) { c.confidence = 'Medium'; const drop = reach.change_pct !== null && reach.change_pct <= -20; c.status = drop ? 'problem_observed' : 'no_problem_observed'; c.supported = drop;
      c.support_note = drop ? `Supported as an issue: click-through rate fell ${Math.abs(reach.change_pct)}% between comparable groups of uploads (${reach.rule}). Which part of the packaging changed is not tested.` : '';
      if (drop) { c.headline = `Thumbnails and titles earn ${Math.abs(reach.change_pct)}% fewer clicks per impression than earlier uploads`; c.hypothesis = 'The title or thumbnail style of the newer uploads may be less appealing to the audience being shown them; not tested.'; c.missing = ['Which element changed (title, thumbnail, audience shown)']; c.experiment = { text: `Use YouTube Studio's own Test & compare on the thumbnail or title of the next three ${longOnly ? 'Long ' : ''}uploads (if the channel is eligible). Proposals need CEO approval and must stay inside ${business === 'srv_studio' ? 'the Female Emotional Deep House, Long-only policy' : 'the approved Farsi Creative V2 rules'}; music, artist and mood do not change.`, short: 'Test the thumbnail or title of the next three uploads with Studio\'s Test & compare and compare click-through rate.', owner: 'Creative Quality (CEO approves)', review_days: 28, success: `Click-through rate back to at least ${pc(reach.earlier.median_ctr)} on the next three uploads.`, needs: 'CEO approval' }; }
      return c; }
    c.status = 'insufficient_evidence'; c.supported = false; c.confidence = 'Low'; c.support_note = `Not supported yet: ${reach.rule}.`;
    c.missing = ['More uploads with impressions and click-through rate (the comparison needs 5+ uploads per group)'];
    c.experiment = { text: 'Keep the reach reports collecting; the comparison runs automatically once 5+ uploads in each group have impressions.', short: 'Wait for 5+ uploads per group with impressions and click-through rate.', owner: 'Growth & Analytics', review_days: 28, success: 'Click-through rate is known for 5+ uploads in each comparison group.', needs: 'No further action' };
    return c;
  }
  c.confirmed.push(`No impressions or click-through rate are stored (${F.ctrKnown} of ${F.catalogN} videos have either).`);
  c.missing = ['Thumbnail impressions', 'Impressions click-through rate', 'Impressions by traffic source'];
  c.status = 'insufficient_evidence'; c.confidence = 'Low'; c.supported = false;
  c.support_note = F.ctrKnown >= 5 ? `Impressions or CTR exist for ${F.ctrKnown} videos, but the packaging comparison (recent vs earlier uploads) is not run until at least 5 Long uploads in each group have both.` : 'Not supported: impressions and click-through rate are not stored, so packaging can neither be blamed nor cleared.';
  c.hypothesis = null;
  c.experiment = { text: `Measure before changing anything: ${EXPORT_STEP(through)} Then, if the channel is eligible, use YouTube Studio's own Test & compare on the thumbnails or titles of the next ${longOnly ? 'three Long' : 'three Long'} uploads. Any thumbnail or title proposal needs CEO approval and must stay inside ${business === 'srv_studio' ? 'the Female Emotional Deep House, Long-only policy' : 'the approved Farsi Creative V2 rules'}; music, artist and mood do not change.`, short: 'Get impressions and click-through rate (Studio export), then run Studio Test & compare on the next three Long thumbnails or titles.', owner: 'CEO (export, approvals) → Creative Quality', review_days: 28, success: 'Click-through rate is known for at least 5 Long uploads; Studio reports a winning variant for at least one test, or shows no difference.', needs: 'CEO-provided export, or authorize collector change C3 (Reporting API reach reports)' };
  return c;
}
function retention({ dash, cls, F, longOnly }) {
  const c = cat('retention', 'Retention — are viewers leaving early?');
  const type = new Map(cls.rows.map((r) => [r.id, r.type]));
  const curves = ((dash.retention && dash.retention.curves) || []).filter((x) => x && x.all && isNum(x.all.at25) && (x.views || 0) >= D_MIN.curveViews);
  const usable = cls.validated === true;   // per-video format is used only when it agrees with YouTube's own content-type totals
  const longC = usable ? curves.filter((x) => type.get(x.video_id) === 'long' || type.get(x.video_id) === 'ambiguous') : (longOnly ? [] : curves), shortC = usable ? curves.filter((x) => type.get(x.video_id) === 'short') : [];
  if (!usable) c.confirmed.push('Per-video format could not be validated against YouTube\'s content-type totals, so retention is read across all measured videos without separating Long from Short.');
  const Lrows = cls.rows.filter((r) => r.type === 'long' && r.pct > 0), Lv = Lrows.reduce((a, r) => a + r.views, 0);
  const Lpct = Lv > 0 ? r2(Lrows.reduce((a, r) => a + r.pct * r.views, 0) / Lv) : null, Lavd = Lv > 0 ? Math.round(Lrows.reduce((a, r) => a + r.avd * r.views, 0) / Lv) : null;
  const Srows = cls.rows.filter((r) => r.type === 'short' && r.pct > 0), Sv = Srows.reduce((a, r) => a + r.views, 0), Spct = Sv > 0 ? r2(Srows.reduce((a, r) => a + r.pct * r.views, 0) / Sv) : null;
  if (Lpct !== null) c.confirmed.push(`Long videos: average ${Lpct}% viewed, ${Lavd}s average view duration over ${fmt(Lv)} views${Spct !== null ? `; Shorts ${Spct}% viewed over ${fmt(Sv)} views` : ''}.`);
  const topL = Lrows.slice().sort((a, b) => b.views - a.views)[0]; if (topL && Lv > 0 && topL.views / Lv >= 0.5) c.confirmed.push(`One Long video supplies ${pctOf(topL.views, Lv)}% of Long views, so the Long averages mostly describe that video.`);
  const avd = dash.avd || {}; if (isNum(avd.d28_sec) && isNum(avd.prev28_sec) && !longOnly) c.confirmed.push(`Channel average view duration ${avd.d28_sec}s vs ${avd.prev28_sec}s in the previous 28 days (mixes Long and Short views and includes paid views).`);
  const at = longC.map((x) => x.all.at25);
  if (longC.length) c.confirmed.push(`Watch ratio at 25% of the runtime, Long videos with at least ${D_MIN.curveViews} views (${longC.length}): ` + longC.map((x) => `${shortT(x.title || x.video_id, 28)} ${x.all.at25}`).join('; ') + '.');
  if (shortC.length) c.confirmed.push(`Shorts measured: ${shortC.map((x) => x.all.at25).join(', ')} (Shorts loop, so values near or above 1.0 are not comparable with Long videos).`);
  c.stats = { long_n: longC.length, long_low: longC.filter((x) => x.all.at25 < 0.5).length, format_known: usable, median_at25: median(longC.map((x) => x.all.at25)), min_curve_views: longC.length ? Math.min(...longC.map((x) => x.views || 0)) : null };
  const grades = longC.map((x) => ({ title: shortT(x.title || x.video_id, 28), views: x.views, grade: SAMPLE_GRADE(x.views) }));
  if (grades.length) { c.confirmed.push('Sample behind each Long curve: ' + grades.map((g) => `${g.title} ${fmt(g.views)} views (${g.grade})`).join('; ') + '.'); const weak = grades.filter((g) => g.views < 300); if (weak.length) c.confirmed.push(`Low-confidence: ${weak.length} of ${grades.length} Long curves rest on fewer than 300 views.`); }
  c.stats.grades = grades;
  const gaps = longC.filter((x) => x.organic && isNum(x.organic.at25)).map((x) => ({ t: shortT(x.title || x.video_id, 28), all: x.all.at25, org: x.organic.at25 }));
  if (gaps.length) c.confirmed.push('Organic-only viewers (paid excluded) at 25%: ' + gaps.map((g) => `${g.t} ${g.org} (all viewers ${g.all})`).join('; ') + '.');
  c.metrics = [{ label: 'Long watch ratio at 25% (median)', value: median(at) === null ? '—' : String(median(at)), sample: `${longC.length} Long videos ≥ ${D_MIN.curveViews} views` }, { label: 'Long avg % viewed', value: Lpct === null ? '—' : Lpct + '%', sample: `${fmt(Lv)} Long views` }];
  if (longC.length >= 2) {
    const low = longC.filter((x) => x.all.at25 < 0.5).length;
    c.status = low >= 2 ? 'problem_observed' : 'no_problem_observed'; c.confidence = longC.length >= 3 ? 'Medium' : 'Low';
    const adequate = usable && longC.length >= 3 && longC.every((x) => (x.views || 0) >= 300); const organicMeasured = longC.some((x) => x.organic && isNum(x.organic.at25));
    // sample concentration: when one video supplies >= 75% of the measured Long views, the verdict must also hold on at least two OTHER Long videos with 300+ views
    const domId = topL ? topL.id : null; const topShare = topL && Lv > 0 ? topL.views / Lv : 0; const concentrated = topShare >= 0.75;
    const nonDom = longC.filter((x) => x.video_id !== domId && (x.views || 0) >= 300), nonDomLow = nonDom.filter((x) => x.all.at25 < 0.5);
    c.stats.concentration = { top_id: domId, top_share_pct: Math.round(topShare * 1000) / 10, concentrated, non_dominant_n: nonDom.length, non_dominant_low: nonDomLow.length };
    if (concentrated) { c.confidence = 'Low'; c.qualification = `Sample concentration: one video supplies ${c.stats.concentration.top_share_pct}% of Long views; the verdict rests on ${longC.length} Long videos of which ${nonDom.length} are independent of that video (${nonDomLow.length} of them also below 0.5 at 25%). Treat as low confidence.`; c.confirmed.push(c.qualification); }
    c.supported = c.status === 'problem_observed' && adequate && organicMeasured && (!concentrated || (nonDom.length >= 2 && nonDomLow.length >= 2));
    c.support_note = c.supported ? 'Supported as an issue' + (concentrated ? ' (qualified: sample concentrated, low confidence)' : '') + ': low early retention is measured on 3 or more Long videos with 300+ views each, including organic-only viewers. This does not by itself establish that it caused the fall in organic views.' : (c.status === 'problem_observed' ? 'Observed, not supported: ' + (!usable ? 'the Long/Short split could not be validated' : longC.length < 3 ? 'fewer than 3 Long videos were measured' : !adequate ? 'at least one Long curve rests on fewer than 300 views' : !organicMeasured ? 'no organic-only measurement exists' : 'the sample is concentrated in one video and fewer than two other Long videos show the same pattern') + '.' : '');
    if (c.status === 'problem_observed') {
      c.headline = `Long videos lose viewers early (${c.stats.long_low} of ${c.stats.long_n} measured Long videos keep under half of their viewers at the 25% mark${c.stats.concentration && c.stats.concentration.concentrated ? `; low confidence: one video supplies ${c.stats.concentration.top_share_pct}% of Long views` : ''})`;
      const worse = gaps.filter((g) => g.org + 0.05 <= g.all).length;
      c.hypothesis = (gaps.length && worse === 0 ? 'Paid viewers do not explain the early drop on its own: organic-only viewers also leave early on the same videos. ' : 'Paid viewers may leave earlier than organic viewers, which would lower the averages. ') + 'The opening of Long videos may not hold attention; there is no stronger Long video on this channel to compare against, so the cause is not tested.';
      c.missing = ['Organic-only average view duration per video and per format', 'A Long video with strong retention to compare against', 'Retention for Long videos below the sample threshold'];
      c.experiment = { text: `With CEO approval, change ONLY the first 10 seconds' visual on one upcoming Long video (approved music, artist and mood unchanged) and read its organic-only watch ratio at 25% against the ${longC.length} current Long videos (${Math.min(...at)}–${Math.max(...at)}). Do it inside the no-ads period proposed under economics, so paid viewers do not blur the reading.`, short: `Change only the first-10-seconds visual on one upcoming Long video (CEO approval) and compare its organic-only watch ratio at 25% with today's ${Math.min(...at)}–${Math.max(...at)}.`, owner: 'Creative Quality (CEO approves) → Growth & Analytics', review_days: 28, success: `Watch ratio at 25% of at least 0.50 on the next 3 Long uploads (today: median ${median(at)} across ${longC.length} Long videos).`, needs: 'CEO approval of the creative change; no collection change' };
    }
  } else {
    c.status = 'insufficient_evidence'; c.confidence = 'Low'; c.supported = false; c.support_note = 'Not supported: too few Long videos with a measured retention curve.';
    c.confirmed.push(`Only ${longC.length} Long video${longC.length === 1 ? '' : 's'} ha${longC.length === 1 ? 's' : 've'} at least ${D_MIN.curveViews} views in the window, so Long retention cannot be judged.${longOnly ? ` The ${shortC.length} measured retention curves are historical Shorts and say nothing about Long videos.` : ''}`);
    c.missing = ['Retention curves for Long videos (curves are collected for the top videos by views, which are Shorts)', `A Long sample of at least ${fmt(D_MIN.longSample)} views`];
    c.experiment = { text: 'Wait for the Long sample, then read it: each new Long upload gets a 14-day read of average % viewed and watch ratio at 25%. Collector change C5 would collect retention curves for Long videos explicitly.', short: 'Give each new Long upload a 14-day read of average % viewed and watch ratio at 25%.', owner: 'Growth & Analytics', review_days: 14, success: `At least 3 Long videos with ${D_MIN.curveViews}+ views and a measured watch ratio at 25%.`, needs: 'No authorization for reading; C5 needs authorization' };
  }
  return c;
}
function audience({ dash, status, F, longOnly }) {
  const c = cat('audience', 'Audience development — weak repeat viewing or subscriber conversion?');
  const cv = dash.conversion || {}, d28 = F.d28, p28 = F.p28;
  if (isNum(cv.per_1000_non_ad)) c.confirmed.push(`Net subscribers: ${isNum(d28.net_subs) ? (d28.net_subs >= 0 ? '+' : '') + d28.net_subs : '—'} in 28 days${isNum(p28.net_subs) ? ` (previous 28 days ${p28.net_subs >= 0 ? '+' : ''}${p28.net_subs})` : ''}; ${cv.per_1000_non_ad} per 1,000 organic views${isNum(cv.prev_per_1000_non_ad) ? ` (previous ${cv.prev_per_1000_non_ad})` : ''}.`);
  if (isNum(cv.subscribed_view_share_pct)) c.confirmed.push(`Views from existing subscribers: ${cv.subscribed_view_share_pct}% of all views.`);
  if (F.engagement) c.confirmed.push(`Likes ${F.engagement.likes_per_1000} and comments ${F.engagement.comments_per_1000} per 1,000 views (${F.engagement.basis}; ${fmt(F.engagement.videos)} videos).`);
  c.metrics = [{ label: 'subscribers per 1,000 organic views', value: isNum(cv.per_1000_non_ad) ? String(cv.per_1000_non_ad) : '—', sample: `${fmt(d28.non_ad_views)} organic views` }, { label: 'net subscribers, 28 d', value: isNum(d28.net_subs) ? String(d28.net_subs) : '—', sample: 'channel total' }];
  c.missing = ['New vs returning viewers (Studio only: the Analytics API has no such metric)', 'Subscribers gained per traffic source (not offered by the API)'];
  const enough = isNum(d28.net_subs) && Math.abs(d28.net_subs) + (isNum(p28.net_subs) ? Math.abs(p28.net_subs) : 0) >= D_MIN.subsSample;
  if (isNum(cv.per_1000_non_ad) && isNum(cv.prev_per_1000_non_ad) && cv.prev_per_1000_non_ad > 0 && status.comparable && enough) {
    const ch = (cv.per_1000_non_ad - cv.prev_per_1000_non_ad) / cv.prev_per_1000_non_ad;
    c.status = ch <= -D_MIN.convFlat ? 'problem_observed' : 'no_problem_observed'; c.confidence = 'Medium'; c.supported = c.status === 'problem_observed'; c.support_note = c.supported ? `Supported: subscribers per 1,000 organic views fell ${Math.round(Math.abs(ch) * 100)}% with an adequate subscriber sample.` : '';
    if (c.status === 'no_problem_observed') c.confirmed.push('Conversion per organic view is steady; the lower subscriber total follows from fewer organic views, not from weaker conversion. Repeat viewing itself cannot be measured with the API.');
    else { c.hypothesis = 'Viewers may be less inclined to subscribe; not tested.'; c.experiment = { text: 'Add a subscribe prompt (pinned comment and end screen) to the next three Long uploads and compare subscribers per 1,000 organic views.', short: 'Add a subscribe prompt to the next three Long uploads and compare subscribers per 1,000 organic views.', owner: 'Growth & Analytics (CEO approves text)', review_days: 28, success: `Subscribers per 1,000 organic views back to ${cv.prev_per_1000_non_ad} or higher.`, needs: 'CEO approval' }; }
  } else {
    c.status = 'insufficient_evidence'; c.confidence = 'Low'; c.supported = false; c.support_note = 'Not supported: the subscriber sample is too small.';
    c.confirmed.push(`Subscriber sample is too small to judge conversion (${isNum(d28.net_subs) ? d28.net_subs : '—'} net subscribers in 28 days; at least ${D_MIN.subsSample} needed across both windows).`);
    if (longOnly) c.confirmed.push('Subscriber and viewer figures mix Shorts-feed viewers with Long viewers; they are not split by format.');
  }
  return c;
}


// ── publishing: upload consistency and post-publication performance ──
function publishing({ dash, cls, F, nowMs, longOnly }) {
  const c = cat('publishing', 'Publishing — upload consistency and post-publication performance');
  const up = F.uploads; const byId = new Map(cls.rows.map((r) => [r.id, r.type]));
  c.stats = { uploads_28d: up.last28, uploads_prev_28d: up.prev28 };
  if (!F.catalogN) { c.confirmed.push('The channel catalog is not available, so upload frequency cannot be read.'); c.missing = ['Channel catalog (published dates)']; return c; }
  c.confirmed.push(`Uploads: ${up.last28} in the last 28 days vs ${up.prev28} in the 28 days before.`);
  const drop = up.prev28 >= 6 && up.last28 <= up.prev28 * 0.75;
  if (drop) { c.status = 'problem_observed'; c.confidence = up.prev28 >= 8 ? 'Medium' : 'Low'; c.supported = true; c.headline = `Fewer uploads: ${up.last28} in the last 28 days against ${up.prev28} before`; c.support_note = 'Supported as an observation: the upload counts come straight from the channel catalog. It is not shown that the lower cadence caused the change in views.'; }
  else { c.status = up.prev28 >= 6 || up.last28 >= 6 ? 'no_problem_observed' : 'insufficient_evidence'; c.confidence = 'Medium'; if (c.status === 'insufficient_evidence') c.confirmed.push('Fewer than 6 uploads in either window: cadence cannot be judged.'); }
  const U = dash.uploads && typeof dash.uploads === 'object' ? Object.entries(dash.uploads).map(([id, u]) => ({ id, ...u })) : [];
  const recentMs = nowMs - 28 * DAY, earlierMs = nowMs - 56 * DAY; const inR = (u) => Date.parse(u.pub + 'T12:00:00Z') >= recentMs, inE = (u) => Date.parse(u.pub + 'T12:00:00Z') >= earlierMs && Date.parse(u.pub + 'T12:00:00Z') < recentMs;
  const pick = (g) => g.filter((u) => u.d7 !== null && u.d7 !== undefined && (!longOnly || byId.get(u.id) === 'long')); const rr = pick(U.filter(inR)), ee = pick(U.filter(inE));
  const med = (a) => median(a.map((u) => u.d7));
  if (U.length) { const fresh = U.filter(inR).sort((a, b) => (a.pub < b.pub ? 1 : -1)).slice(0, 4); if (fresh.length) c.confirmed.push('Newest uploads, views in the first 1 / 3 / 7 days: ' + fresh.map((u) => `${u.pub.slice(5)}: ${u.d1 ?? '—'} / ${u.d3 ?? '—'} / ${u.d7 ?? '—'}`).join('; ') + ' (cumulative from the publish day; "—" = not yet covered).'); }
  c.stats.d7_recent_n = rr.length; c.stats.d7_earlier_n = ee.length; c.stats.d7_recent_median = med(rr); c.stats.d7_earlier_median = med(ee);
  if (rr.length >= 5 && ee.length >= 5) { const ch = med(ee) > 0 ? Math.round(((med(rr) - med(ee)) / med(ee)) * 100) : null; c.confirmed.push(`Median day-7 views: ${fmt(med(rr))} for the ${rr.length} newest uploads vs ${fmt(med(ee))} for the ${ee.length} before${ch === null ? '' : ` (${ch >= 0 ? '+' : ''}${ch}%)`}.`); if (ch !== null && ch <= -25) { c.status = 'problem_observed'; c.supported = true; c.confidence = 'Medium'; c.headline = (c.headline ? c.headline + '; ' : '') + `new uploads reach ${Math.abs(ch)}% fewer views in their first week`; } }
  else if (U.length) c.confirmed.push(`Day-7 comparison needs 5+ uploads with a full first week in each period (now ${rr.length} and ${ee.length}); it fills in as the daily collection accumulates.`);
  else { c.missing.push('Day-1/3/7/28 performance per upload (collected by the upgraded collector once it runs)'); }
  c.metrics = [{ label: 'uploads, last 28 d', value: String(up.last28), sample: `${up.prev28} in the 28 days before` }];
  if (c.status === 'problem_observed') c.experiment = { text: `Hold the upload cadence at ${up.prev28} per 28 days for the next 28 days (the production schedule is the CEO's decision) and read the day-7 views of each new upload against the earlier uploads.`, short: `Keep ${up.prev28} uploads per 28 days for one period and compare day-7 views per upload.`, owner: 'Production (CEO approves any schedule change)', review_days: 28, success: `At least ${up.prev28} uploads in the next 28 days and a day-7 reading for each.`, needs: 'CEO decision on the production schedule' };
  return c;
}
// ── business economics: advertising dependency, monetization progress, verified revenue/costs ──
function economics({ dash, F, ypp }) {
  const c = cat('economics', 'Business economics — advertising dependency, monetization and profitability');
  const d28 = F.d28; c.missing = ['Verified revenue (YouTube revenue permission or a CEO-attested Studio Earn capture)', 'Verified business operating costs and advertising spend'];
  const paidKnown = isNum(d28.paid_views) && isNum(d28.views) && d28.views > 0; const share = paidKnown ? pctOf(d28.paid_views, d28.views) : null; c.stats = { paid_share_pct: share, paid_views: paidKnown ? d28.paid_views : null };
  if (share !== null) c.confirmed.push(`YouTube-classified advertising supplied ${share}% of all views in the 28-day window (${fmt(d28.paid_views)} of ${fmt(d28.views)}); the rest is non-advertising ("organic" here includes any external paid promotion, which cannot be told apart).`);
  const weeks = (dash.trend || []).filter((t) => isNum(t.views) && isNum(t.non_ad_views) && t.views - t.non_ad_views > 0); if (weeks.length) c.confirmed.push(`Advertising views fall in ${weeks.length} of the last ${(dash.trend || []).length} weeks (${weeks.map((t) => dlab(t.from)).join(', ')}).`);
  const m = ypp && ypp.state ? ypp : null;
  if (m && m.state && m.state !== 'not_captured' && m.eligibility) c.confirmed.push('Monetization: ' + m.eligibility.text + '.'); else c.confirmed.push('Monetization progress is not known: no official Studio → Earn capture is stored (the API cannot provide qualified watch hours or Shorts views).');
  c.confirmed.push('Revenue and operating costs are not available from a verified source, so profitability cannot be assessed.');
  if (share === null) { c.status = 'insufficient_evidence'; c.confidence = 'Low'; return c; }
  if (share >= 50) { c.status = 'problem_observed'; c.supported = true; c.confidence = 'High'; c.headline = `Advertising supplied ${share}% of views, so total views overstate organic growth`;
    c.support_note = 'Supported: the advertising share is measured directly and reconciles exactly with YouTube Studio. It supports a dependency finding, not a statement about why organic views moved.';
    c.hypothesis = null; c.experiment = { text: 'Run one 28-day period without paid ads on Long videos (or ads on one video only) so organic behaviour can be read on its own. The ad setting is the CEO\'s decision; creative is untouched.', short: 'Run one 28-day period without paid ads on Long videos and record organic views and organic watch time.', owner: 'CEO (ad setting) → Growth & Analytics', review_days: 28, success: 'A 28-day window with advertising at or below 10% of views exists, with organic views and organic watch time recorded.', needs: 'CEO decision on ad settings; no collection change' }; }
  else if (share >= 20) { c.status = 'no_problem_observed'; c.confidence = 'High'; c.headline = `Advertising supplied ${share}% of views`; }
  else { c.status = 'no_problem_observed'; c.confidence = 'High'; }
  return c;
}

const ORDER = ['distribution', 'retention', 'packaging', 'audience', 'publishing', 'economics'];
const STATUS_RANK = { problem_observed: 0, insufficient_evidence: 1, no_problem_observed: 2 };
const addDays = (ms, n) => dkey(ms + n * DAY);

// Data-quality block: windows, reconciliation, coverage and sample flags, all from numbers already in the model.
function dataQuality({ dash, cls, F, through }) {
  const rc = dash.reconciliation || {}, checks = Array.isArray(rc.checks) ? rc.checks : [];
  const tw = dash.traffic && dash.traffic.window ? dash.traffic.window : null, dw = F.d28 && F.d28.from ? { from: F.d28.from, to: F.d28.to } : null;
  const trafficTotal = ((dash.traffic && dash.traffic.rows) || []).reduce((a, t) => a + (isNum(t.views) ? t.views : 0), 0); const chViews = (checks.find((c) => c.metric === 'views') || {}).channel_total;
  const coverage = isNum(chViews) && chViews > 0 && trafficTotal > 0 ? Math.round((trafficTotal / chViews) * 1000) / 10 : null;
  const flags = [];
  if (isNum(rc.days_present) && isNum(rc.days_expected) && rc.days_present < rc.days_expected) flags.push(`${rc.days_present} of ${rc.days_expected} days present in the collected window (the newest day was not yet reported by YouTube).`);
  for (const c of checks) if (c.ok === false) flags.push(`Reconciliation: ${c.metric} differs by ${c.diff_pct}% between the channel total and the daily series.`);
  if (tw && dw && (tw.from !== dw.from || tw.to !== dw.to)) flags.push(`The dashboard's 28-day window (${dlab(dw.from)} – ${dlab(dw.to)}) and the collected report window (${dlab(tw.from)} – ${dlab(tw.to)}) are offset by a day; totals differ by that day's views.`);
  if (coverage !== null && Math.abs(coverage - 100) > 0.5) flags.push(`Traffic-source rows cover ${coverage}% of channel views.`);
  const small = cls.rows.filter((r) => r.views < D_MIN.curveViews).length; if (cls.rows.length) flags.push(`${small} of ${cls.rows.length} videos have fewer than ${D_MIN.curveViews} views in the window: per-video conclusions about them are not drawn.`);
  if (cls.validated === false) flags.push('Per-video format classification disagrees with YouTube\'s content-type totals.');
  flags.push('"Organic" means every source except YouTube advertising. Views from external paid promotion (EXT_URL) cannot be told apart and are counted as organic.');
  return { dashboard_window: dw, collected_window: tw, days_present: rc.days_present ?? null, days_expected: rc.days_expected ?? null, traffic_coverage_pct: coverage, reconciliation_ok: checks.length ? checks.every((c) => c.ok !== false) : null, data_through: through, flags, format_sources: { production_linked_videos: cls.production.videos, production_views: cls.production.views, compared: cls.production.compared, agree: cls.production.agree } };
}

// Collection plan. `auth`: what is needed before it can run. Nothing here is executed by the dashboard.
export const DATA_PLAN = Object.freeze([
  { id: 'C0', metric: 'Per-video Long/Short format', now: 'Estimated from stored average view duration ÷ % viewed and validated against YouTube\'s content-type totals (implemented, display only).', change: 'None.', auth: 'None.' },
  { id: 'C7', metric: 'Impressions, CTR, traffic sources (both periods), new vs returning viewers', now: 'Not stored.', change: 'CEO exports the Studio Reach and Audience tabs for the two 28-day periods.', auth: 'No authorization; CEO action.' },
  { id: 'C1', metric: 'Traffic-source split for the previous 28 days', now: 'Stored for the current window only.', change: 'Collector stores the previous-window traffic report (same Analytics API call shape, existing scope).', auth: 'CEO authorization: production data-collection change.' },
  { id: 'C2', metric: 'Daily traffic by source', now: 'Requested daily but reduced to the paid series only.', change: 'Keep the full daily source split (no new Google request).', auth: 'CEO authorization: collector change.' },
  { id: 'C3', metric: 'Thumbnail impressions and impressions CTR (per video, by traffic source)', now: 'Not in the Analytics API; the Reporting API reach reports channel_reach_basic_a1 / channel_reach_combined_a1 exist (added 2026-01-15).', change: 'Create a Reporting API job for the reach reports (existing yt-analytics.readonly scope; reports appear from job creation, with a limited backfill).', auth: 'CEO authorization: creates a job on Google\'s side. No new credential, vendor or cost.' },
  { id: 'C4', metric: 'Authoritative video duration / live status', now: 'Not stored.', change: 'Store Data API contentDetails.duration per video (youtube.readonly already granted).', auth: 'CEO authorization: collector change.' },
  { id: 'C5', metric: 'Retention curves for Long videos', now: 'Collected for the top videos by views only.', change: 'Choose the curve set by format, not only by views.', auth: 'CEO authorization: collector change (more requests / quota).' },
  { id: 'C6', metric: 'Organic vs paid views and organic average view duration per video; shares', now: 'Not collected (shares metric exists under yt-analytics.readonly).', change: 'Add video × traffic-source and shares requests.', auth: 'CEO authorization: collector change (more requests / quota).' },
  { id: 'R', metric: 'Revenue', now: 'Not collected.', change: 'Needs the yt-analytics-monetary.readonly scope (new consent) or a CEO-attested Studio capture.', auth: 'CEO decision; not requested here.' },
]);

export function buildDiagnosis({ business, dash, status, videoRows, catalog, formatMap, nowMs, longOnly, reach = null, ypp = null }) {
  if (!dash || dash.error || !dash.windows) return { state: 'unavailable' };
  const cls = classifyVideos(videoRows, dash.formats, formatMap);
  const F = facts({ dash, cls, catalog, nowMs });
  const through = (dash.freshness && dash.freshness.last_day) || dkey(nowMs);
  const args = { business, dash, status, cls, F, nowMs, longOnly, through, reach, ypp: ypp || dash.ypp || null };
  const cats = [distribution(args), retention(args), packaging(args), audience(args), publishing(args), economics(args)];
  cats.forEach((c) => { if (c.experiment) c.experiment.review_by = addDays(nowMs, c.experiment.review_days); });
  const ranked = cats.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const problems = cats.filter((c) => c.status === 'problem_observed'), unknown = cats.filter((c) => c.status === 'insufficient_evidence');
  const leading = ranked.find((c) => c.experiment) || null;
  const established = problems.length > 0 && problems.every((c) => c.supported && c.confidence === 'High' && c.missing.length === 0);
  const OUTCOME_ORDER = ['distribution', 'packaging', 'retention', 'audience', 'publishing', 'economics'];
  const supported = OUTCOME_ORDER.map((k) => cats.find((c) => c.key === k)).filter((c) => c && c.supported);
  const OUT_LABEL = { distribution: 'Distribution issue supported by evidence', packaging: 'Packaging issue supported by evidence', retention: 'Retention issue supported by evidence', audience: 'Audience development issue supported by evidence', publishing: 'Publishing consistency issue supported by evidence', economics: 'Advertising dependency supported by evidence' };
  const outcome = supported.length ? supported[0].key : 'insufficient_evidence';
  const observedOnly = problems.filter((c) => !c.supported);
  const decline = cats.find((c) => c.key === 'distribution');
  const declineUnexplained = !!(decline && decline.status === 'problem_observed' && !decline.supported);
  const wrong = problems.length ? problems.map((c) => c.label.split(' — ')[0].toLowerCase()).join(' and ') : (unknown.length ? 'no problem is confirmed, but important evidence is missing' : 'no problem observed');
  const first = (c) => (c && c.confirmed[0]) || '';
  return {
    state: 'ok', established,
    root_cause_label: established ? 'ROOT CAUSE ESTABLISHED' : 'ROOT CAUSE NOT YET ESTABLISHED',
    what_is_wrong: problems.length ? problems.map((c) => c.headline || ('Problem observed in ' + c.label.split(' — ')[0].toLowerCase())).join('. ') + '.' : (unknown.length ? 'No problem can be confirmed yet: ' + unknown.map((c) => c.label.split(' — ')[0].toLowerCase()).join(', ') + ' cannot be judged with the data stored.' : 'No problem observed in the measured data.'),
    evidence: problems.length ? problems.flatMap((c) => c.confirmed.slice(0, 2)).slice(0, 4) : cats.flatMap((c) => c.confirmed.slice(0, 1)).slice(0, 3),
    cause_or_missing: established ? problems.map((c) => c.hypothesis).filter(Boolean) : [...new Set(problems.concat(unknown).flatMap((c) => c.missing))].slice(0, 4),
    hypotheses: problems.map((c) => ({ category: c.key, text: c.hypothesis })).filter((h) => h.text),
    next_test: leading ? { category: leading.key, ...leading.experiment } : null,
    outcome, outcome_label: outcome === 'insufficient_evidence' ? 'Insufficient evidence to name a cause' : OUT_LABEL[outcome] + (supported[0] && supported[0].qualification ? ' — qualified, low confidence (sample concentrated)' : ''),
    outcome_qualification: supported[0] && supported[0].qualification ? supported[0].qualification : null,
    contributing: supported.map((c) => ({ key: c.key, label: c.label.split(' — ')[0], headline: c.headline || null, qualified: !!c.qualification })),
    supported_issues: supported.map((c) => ({ key: c.key, note: c.support_note })), observed_not_supported: observedOnly.map((c) => ({ key: c.key, note: c.support_note })),
    outcome_caveat: outcome !== 'insufficient_evidence' && declineUnexplained ? 'This does not establish why organic views fell: that decline is observed but its source is not attributed yet.' : (outcome === 'insufficient_evidence' && observedOnly.length ? 'Problems are observed (' + observedOnly.map((c) => c.key).join(', ') + ') but none meets the rule for a supported cause.' : ''),
    confidence_rules: CONFIDENCE_RULES, data_quality: dataQuality({ dash, cls, F, through }),
    categories: cats, classification: { basis: cls.basis, validated: cls.validated, note: cls.note, est: cls.est, api: cls.api },
    engagement: F.engagement, data_plan: DATA_PLAN, policy: POLICY_TEXT[business] || null, advisory: true,
    first_evidence: first(problems[0]),
  };
}
