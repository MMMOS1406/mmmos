// CEO homepage — one business card model. PURE: no network, database or clock (the caller passes `nowMs`). Mirrored byte-for-byte in public/growth/homeInsights.mjs (a test enforces it).
// Input  = the Growth Decision Center model of ONE business (`dash`, from the growth_report action = lib/growthDecisions.buildDashboard + the channel's own counters), the business's
//          video rows (youtube_videos_analytics, titles / publish dates / lifetime views) and nothing else. It never reads or mixes another business's data.
// Output = what the card shows. Rules enforced here (and tested):
//  - a missing number is null and is shown as "not available" with the reason, never 0 and never an estimate;
//  - TOTAL views are never labelled organic: "organic" = non-advertising views, and only when the paid series is known for EVERY day of the window;
//  - a trend is called only when both windows carry enough organic volume AND the previous window is comparable (a channel catalog reset makes it not comparable);
//  - revenue and expenses are shown only when a verified source exists; otherwise an explicit unavailable state that names what is needed;
//  - recommendations are advisory text with evidence, confidence, a success measure, an owner and a review date; nothing here changes a prompt, a schedule or production.
import { buildDiagnosis } from './diagnosis.mjs';
import { buildPlan } from './growthPlan.mjs';
const DAY = 86400000;
export const MIN = Object.freeze({ organicWindow: 500, organicWeek: 100, videoViews: 100, staleDays: 3, shortShare: 80, longPerThousandShorts: 100, spread: 0.15, concentrationShare: 50, weekShare: 60 });
// CEO policy per business (display-level guard only: nothing here changes a prompt, a configuration or a publishing step).
// SRV Studio = Female Emotional Deep House, Long only (CEO decision 2026-11): historical Shorts figures stay visible as evidence but never generate a recommendation to produce Shorts.
export const POLICY = Object.freeze({ srv_studio: Object.freeze({ longOnly: true, note: 'SRV Studio is Long-only (CEO policy). Short figures are historical evidence only.' }) });
const SHORTS_ACTION = /\b(produc|publish|post|upload|resum|mak|creat|shoot|film)\w*\b[^.]*\bshorts?\b|\bshorts?\b[^.]*\b(produc|publish|post|upload|resum)\w*/i;
const violatesLongOnly = (r) => !!r && (r.id === 'shorts_to_long' || r.id === 'format' || SHORTS_ACTION.test(String(r.action || '')));
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
const OUTCOME_RANK = { TEST: 0, IMPROVE: 0, 'WAIT FOR DATA': 2, CONTINUE: 3 };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r1 = (x) => (isNum(x) ? Math.round(x * 10) / 10 : null);
const pctChange = (a, b) => (isNum(a) && isNum(b) && b > 0 ? r1(((a - b) / b) * 100) : null);
const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDaysKey = (d, n) => dateKey(Date.parse(d + 'T00:00:00Z') + n * DAY);
const daysBetween = (aKey, bMs) => Math.floor((bMs - Date.parse(aKey + 'T00:00:00Z')) / DAY);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dlab = (k) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(k || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : '?'; };
const fmt = (n) => (isNum(n) ? Math.round(n).toLocaleString('en-US') : '—');
const signed = (p) => (p === null || p === undefined ? '—' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p) + '%');
const stripBidi = (s) => String(s == null ? '' : s).replace(/[‎‏‪-‮⁦-⁩]/g, '');
const shortTitle = (t, n = 46) => { t = stripBidi(t).replace(/\s*\|\s*Persian.*$/i, '').replace(/\s*-\s*Emotional Deep House.*$/i, '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ── channel catalog reset: the video count fell by half or more in one day (the previous window then describes a different catalog) ──
export function findReset(history, nowMs, withinDays = 70) {
  const h = Array.isArray(history) ? history : [];
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1], b = h[i]; if (!a || !b || !isNum(a.videos) || !isNum(b.videos)) continue;
    if (a.videos >= 10 && b.videos <= a.videos * 0.5 && daysBetween(b.d, nowMs) <= withinDays) return { date: b.d, from_videos: a.videos, to_videos: b.videos };
  }
  return null;
}
// change of the public channel counters between two dates (counters include paid views; they carry no organic split)
function counterChange(history, fromKey, nowMs) {
  const h = (Array.isArray(history) ? history : []).filter((x) => x && x.d); if (h.length < 2) return null;
  const last = h[h.length - 1]; let base = null;
  for (const x of h) { if (x.d <= fromKey) base = x; else break; }
  if (!base || base.d === last.d) return null;
  return { from: base.d, to: last.d, days: Math.round((Date.parse(last.d + 'T00:00:00Z') - Date.parse(base.d + 'T00:00:00Z')) / DAY), views: isNum(last.views) && isNum(base.views) ? last.views - base.views : null, subs: isNum(last.subs) && isNum(base.subs) ? last.subs - base.subs : null };
}

// the last weekly view totals, oldest first (descriptive only; never a growth claim)
function weekly(dash) { const t = ((dash.trend || []).filter((x) => isNum(x.views))).slice(-4); return t.length >= 2 ? { weeks: t.map((x) => ({ from: x.from, to: x.to, views: x.views })), text: 'Weekly total views (including any paid), oldest to newest: ' + t.map((x) => fmt(x.views)).join(' → ') } : null; }
function statusOf(dash, reset) {
  const w = dash.windows || {}, d28 = w.d28 || {}, p28 = w.d28_prev || {}, d7 = w.d7 || {}, p7 = w.d7_prev || {};
  const known = isNum(d28.non_ad_views) && isNum(p28.non_ad_views);
  let momentum = null;
  if (isNum(d7.non_ad_views) && isNum(p7.non_ad_views) && d7.non_ad_views >= MIN.organicWeek && p7.non_ad_views >= MIN.organicWeek) {
    const c = pctChange(d7.non_ad_views, p7.non_ad_views); momentum = { delta_pct: c, label: c >= 25 ? 'accelerating' : c <= -25 ? 'slowing' : 'steady', text: `Last 7 days ${fmt(d7.non_ad_views)} organic views vs ${fmt(p7.non_ad_views)} the week before (${signed(c)})` };
  }
  if (reset) return { code: 'reset', label: 'GROWTH UNPROVEN · NEW CATALOG', arrow: 'none', reason: `The channel catalog was reset on ${dlab(reset.date)} (${reset.from_videos} → ${reset.to_videos} videos), so the previous 28 days are not comparable and no growth percentage is stated.`, delta_pct: null, comparable: false, momentum, weekly: weekly(dash) };
  if (!isNum(d28.views)) return { code: 'unknown', label: 'NO DATA', arrow: 'none', reason: 'No collected 28-day window is available for this business.', delta_pct: null, comparable: false, momentum };
  if (!known) return { code: 'unknown', label: 'CAN’T TELL', arrow: 'none', reason: 'Paid and organic views cannot be separated for the whole period, so organic growth is not stated (total views are not organic).', delta_pct: null, comparable: false, momentum };
  if (d28.non_ad_views < MIN.organicWindow || p28.non_ad_views < MIN.organicWindow) return { code: 'unknown', label: 'TOO SMALL TO CALL', arrow: 'none', reason: `Organic volume is too small to read a trend (${fmt(d28.non_ad_views)} and ${fmt(p28.non_ad_views)} organic views; ${fmt(MIN.organicWindow)} needed in each window).`, delta_pct: pctChange(d28.non_ad_views, p28.non_ad_views), comparable: true, momentum };
  const c = pctChange(d28.non_ad_views, p28.non_ad_views);
  const code = c >= 15 ? 'growing' : c <= -15 ? 'declining' : 'flat';
  return { code, label: code.toUpperCase(), arrow: code === 'growing' ? 'up' : code === 'declining' ? 'down' : 'flat', reason: `Organic views ${signed(c)} vs the previous 28 days (${fmt(d28.non_ad_views)} vs ${fmt(p28.non_ad_views)}).`, delta_pct: c, comparable: true, momentum };
}

function contentOf(dash, rows, nowMs) {
  const top = ((dash.videos && dash.videos.top) || []).filter((v) => isNum(v.views) && v.views > 0).slice(0, 3).map((v) => ({ id: v.id, title: shortTitle(v.title || v.id), views: v.views, avd_sec: v.avg_view_duration_sec, avg_pct: v.avg_view_pct, subs: v.subs_gained }));
  const list = Array.isArray(rows) ? rows : [];
  const recent = list.filter((r) => r && r.published_at && r.title).map((r) => ({ r, age: (nowMs - Date.parse(r.published_at)) / DAY })).filter((x) => x.age >= 3 && x.age <= 60);
  const live = recent.filter((x) => isNum(Number(x.r.view_count)) && Number(x.r.view_count) > 0);
  const zero = recent.length - live.length;
  const ranked = live.map((x) => ({ id: x.r.video_id, title: shortTitle(x.r.title), published: String(x.r.published_at).slice(0, 10), total_views: Number(x.r.view_count), per_day: r1(Number(x.r.view_count) / Math.max(1, x.age)), avg_pct: isNum(Number(x.r.retention_pct)) && x.r.retention_pct !== null ? r1(Number(x.r.retention_pct)) : null, sample: Number(x.r.view_count) >= MIN.videoViews ? 'ok' : 'insufficient' })).sort((a, b) => a.per_day - b.per_day);
  const attention = ranked.length >= 4 ? ranked.slice(0, 3) : [];
  const day28 = nowMs - 28 * DAY, day56 = nowMs - 56 * DAY;
  const up = (a, b) => list.filter((r) => r && r.published_at && Date.parse(r.published_at) >= a && Date.parse(r.published_at) < b).length;
  return { top, attention, attention_basis: 'Lowest views per day among uploads from the last 60 days (at least 3 days old). Uploads under 100 views are too early to judge and are not treated as failures', zero_view_uploads: zero, uploads: { last28: up(day28, nowMs + DAY), prev28: up(day56, day28) } };
}

function retentionOf(dash) {
  const curves = ((dash.retention && dash.retention.curves) || []).filter((c) => c && c.all && isNum(c.all.at25) && (c.views || 0) >= MIN.videoViews);
  const at25 = curves.map((c) => c.all.at25).sort((a, b) => a - b);
  const median = at25.length ? at25[Math.floor((at25.length - 1) / 2)] : null;
  const best = curves.slice().sort((a, b) => b.all.at25 - a.all.at25)[0] || null, worst = curves.slice().sort((a, b) => a.all.at25 - b.all.at25)[0] || null;
  const avd = dash.avd || {}, conv = dash.conversion || {};
  return {
    avd_sec: isNum(avd.d28_sec) ? avd.d28_sec : null, avd_prev_sec: isNum(avd.prev28_sec) ? avd.prev28_sec : null, avg_pct: isNum(avd.d28_pct) ? avd.d28_pct : null,
    subscriber_view_share_pct: isNum(conv.subscribed_view_share_pct) ? conv.subscribed_view_share_pct : null,
    curves: curves.length, median_at25: median, early_loss: curves.filter((c) => c.all.at25 < 0.5).length,
    best: best && { title: shortTitle(best.title || best.video_id, 40), at25: best.all.at25 }, worst: worst && { title: shortTitle(worst.title || worst.video_id, 40), at25: worst.all.at25 },
    note: 'Watch ratio at 25% of the runtime (1.00 = everyone still watching; above 1.00 = replays, typical of Shorts that loop).',
  };
}

// ── recommendations: the Growth Decision Center rules plus three homepage rules; ranked; at most three ──
function ownerFor(id) { return /paid_dependence|stale|wow_low/.test(id) ? 'CEO' : /ret_|retention|conv_|shorts_to_long|spread/.test(id) ? 'Production (CEO approves any creative change)' : 'PM (analysis)'; }
function reviewIn(id, nowMs) { const days = /paid_dependence/.test(id) ? 28 : /ret_|retention|spread|shorts_to_long|conv_/.test(id) ? 14 : 7; return dateKey(nowMs + days * DAY); }
function confidenceOf(r) { const vol = r.evidence && r.evidence.volume_ok; const kind = r.diagnosis && r.diagnosis.kind; return vol && kind === 'confirmed' ? 'High' : vol || kind === 'confirmed' ? 'Medium' : 'Low'; }
function homepageRules(dash, content, nowMs, longOnly) {
  const out = []; const w = dash.windows || {}, d28 = w.d28 || {}; const fm = (dash.formats && dash.formats.rows) || [];
  const S = fm.find((x) => x.type === 'short'), Lg = fm.find((x) => x.type === 'long');
  if (S && Lg && isNum(S.views) && S.views > 0 && S.views_share_pct >= MIN.shortShare) {
    const per = Math.round((Lg.views / S.views) * 1000);
    if (per < MIN.longPerThousandShorts) out.push({ id: 'shorts_to_long', finding: `Shorts bring ${S.views_share_pct}% of views, but only ${per} Long views come per 1,000 Short views.`, evidence: { metric: 'Long views per 1,000 Short views', period: dash.formats.window, value: `${fmt(Lg.views)} Long vs ${fmt(S.views)} Short views (${per} per 1,000)`, volume_ok: S.views >= 1000 }, diagnosis: { kind: 'hypothesis', text: 'Short viewers may not be finding the Long videos; not tested.' }, action: 'On the next three Shorts, point viewers to the matching Long video or Mix (pinned comment and end line) and compare Long views per 1,000 Short views.', priority: 'Medium', success: `At least ${MIN.longPerThousandShorts} Long views per 1,000 Short views over the next 28 days.`, outcome: 'TEST', creative: true });
  }
  const trend = (dash.trend || []).filter((t) => isNum(t.views)).slice(-4);
  if (trend.length === 4) { const sum = trend.reduce((a, t) => a + t.views, 0), mx = trend.reduce((a, t) => (t.views > a.views ? t : a), trend[0]); const share = sum ? Math.round((mx.views / sum) * 100) : 0;
    if (sum >= 500 && share >= MIN.weekShare) out.push({ id: 'burst_concentration', finding: `${share}% of the last four weeks' views came in one week (${dlab(mx.from)} to ${dlab(mx.to)}).`, evidence: { metric: 'largest weekly share of the last 4 weeks', period: { from: trend[0].from, to: trend[3].to }, value: `${fmt(mx.views)} of ${fmt(sum)} views`, volume_ok: sum >= 1000 }, diagnosis: { kind: 'hypothesis', text: 'A single distribution event may explain the burst; the cause is not identified.' }, action: 'Record views at day 1, 3 and 7 for every new upload so a repeat of the pattern can be seen, and do not plan on the burst continuing.', priority: 'Medium', success: 'Day-1/3/7 views are logged for each upload over the next 4 weeks.', outcome: 'TEST', creative: false }); }
  const tv = (dash.videos && dash.videos.top && dash.videos.top[0]) || null, total = dash.videos && dash.videos.total_views;
  if (tv && isNum(total) && total > 0) { const share = Math.round((tv.views / total) * 100);
    if (share >= MIN.concentrationShare) out.push({ id: 'one_video_share', finding: `One video holds ${share}% of the last 28 days' views.`, evidence: { metric: 'top video share of 28-day views', period: dash.videos.window, value: `${shortTitle(tv.title || tv.id, 36)}: ${fmt(tv.views)} of ${fmt(total)}`, volume_ok: total >= 1000 }, diagnosis: { kind: 'confirmed', text: 'Per-video report of the last 28 days.' }, action: 'Judge the channel on the other uploads and on organic views; do not read this video as a channel-wide trend.', priority: 'Medium', success: 'Top-video share falls below 50% as the newer uploads accumulate views.', outcome: 'IMPROVE', creative: false }); }
  const cs = ((dash.retention && dash.retention.curves) || []).filter((c) => c && c.all && isNum(c.all.at25) && (c.views || 0) >= MIN.videoViews);
  if (cs.length >= 3 && !longOnly) { const hi = cs.reduce((a, c) => (c.all.at25 > a.all.at25 ? c : a)), lo = cs.reduce((a, c) => (c.all.at25 < a.all.at25 ? c : a)); const gap = Math.round((hi.all.at25 - lo.all.at25) * 100) / 100;
    if (gap >= MIN.spread && lo.all.at25 < 0.8) out.push({ id: 'retention_spread', finding: `Retention at 25% of the runtime differs by ${Math.round(gap * 100)} points between "${shortTitle(hi.title || hi.video_id, 28)}" (${hi.all.at25}) and "${shortTitle(lo.title || lo.video_id, 28)}" (${lo.all.at25}).`, evidence: { metric: 'watch ratio at 25% of runtime', period: (hi.window || null), value: `${hi.all.at25} vs ${lo.all.at25} across ${cs.length} videos with at least ${MIN.videoViews} views`, volume_ok: true }, diagnosis: { kind: 'hypothesis', text: 'The opening of the weaker video may differ; the cause is not tested.' }, action: 'Compare the first 10 seconds of the two videos and reuse the stronger opening structure on the next three uploads.', priority: 'Medium', success: `Watch ratio at 25% of at least ${Math.round((hi.all.at25 - 0.1) * 100) / 100} on the next three uploads.`, outcome: 'TEST', creative: true }); }
  if (longOnly && S && Lg && isNum(Lg.views)) {
    const enough = Lg.views >= 1000;
    out.push({ id: 'long_eval', finding: `Long videos drew ${fmt(Lg.views)} views (${isNum(Lg.views_share_pct) ? Lg.views_share_pct + '% of all views' : 'share n/a'}) in the 28-day window${enough ? '' : '; that sample is too small to judge them'}. Shorts are historical evidence only.`, evidence: { metric: 'Long-video views, watch time and average view duration', period: dash.formats.window, value: `${fmt(Lg.views)} views, ${Lg.watch_hours} watch hours, ${Lg.avg_view_duration_sec}s average view duration (Short: ${fmt(S.views)} views, ${S.avg_view_duration_sec}s)`, volume_ok: enough }, diagnosis: { kind: 'confirmed', text: 'YouTube content-type report; per-video format is not stored, so individual Long videos cannot be separated here.' }, action: 'Evaluate each new Long video (views, watch time, watch ratio at 25%) once it has 14 days of data, and improve the opening of any that trails the best one.', priority: enough ? 'Medium' : 'High', success: 'Each new Long video has a 14-day read; Long views exceed 1,000 in a 28-day window before any trend is claimed.', outcome: enough ? 'IMPROVE' : 'WAIT FOR DATA', creative: false });
  } else if (longOnly && Lg && isNum(Lg.views) && !S) {
    out.push({ id: 'long_eval', finding: `Long videos drew ${fmt(Lg.views)} views in the 28-day window.`, evidence: { metric: 'Long-video views', period: dash.formats.window, value: `${fmt(Lg.views)} views`, volume_ok: Lg.views >= 1000 }, diagnosis: { kind: 'confirmed', text: 'YouTube content-type report.' }, action: 'Evaluate each new Long video once it has 14 days of data.', priority: 'Medium', success: 'Each new Long video has a 14-day read.', outcome: 'IMPROVE', creative: false });
  }
  return out;
}
export function pickRecommendations(dash, content, nowMs, business) {
  const longOnly = !!(POLICY[business] && POLICY[business].longOnly);
  const base = ((dash && dash.recommendations) || []).filter((r) => r && r.id !== 'stale' && !(longOnly && violatesLongOnly(r)));
  const early = base.filter((r) => /^ret_early_/.test(r.id)); const rest = base.filter((r) => !/^ret_early_/.test(r.id));
  const merged = rest.slice();
  if (early.length) { const names = early.map((r) => (r.finding || '').replace(/ loses about half.*$/, '')).slice(0, 3); merged.push({ ...early[0], id: 'ret_early', finding: `${early.length} of your top videos lose about half of their viewers in the first quarter.`, evidence: { ...early[0].evidence, value: names.join('; ') + (early.length > 3 ? '; …' : '') }, action: early[0].action, success: early[0].success }); }
  for (const r of homepageRules(dash, content, nowMs, longOnly)) if (!(longOnly && violatesLongOnly(r))) merged.push(r);
  const keepers = merged.filter((r) => !/^(ret_ok_|conv_ok|wow_flat|organic_led|mixed_traffic|ret_low_)/.test(r.id) || false);
  const pool = keepers.length >= 3 ? keepers : merged;
  pool.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) || ((b.evidence && b.evidence.volume_ok ? 1 : 0) - (a.evidence && a.evidence.volume_ok ? 1 : 0)) || (OUTCOME_RANK[a.outcome] ?? 3) - (OUTCOME_RANK[b.outcome] ?? 3));
  return pool.slice(0, 3).map((r, i) => ({ rank: i + 1, id: r.id, priority: r.priority, outcome: r.outcome, title: r.finding, evidence: r.evidence ? `${r.evidence.metric}: ${r.evidence.value}` : '', evidence_period: r.evidence && r.evidence.period ? `${r.evidence.period.from} → ${r.evidence.period.to}` : null, sample: r.evidence && r.evidence.volume_ok ? 'sufficient' : 'insufficient', confidence: confidenceOf(r), diagnosis: r.diagnosis ? `${r.diagnosis.kind === 'confirmed' ? 'Confirmed' : 'Hypothesis (not tested)'}: ${r.diagnosis.text}` : '', action: r.action, success: r.success, owner: ownerFor(r.id), review_by: reviewIn(r.id, nowMs), advisory: true }));
}


// ── executive summary: what the CEO reads in 30 seconds. Derived only from the numbers already in the card; every sentence is observed evidence, any cause is labelled a hypothesis. ──
const lc = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const joinAnd = (a) => (a.length <= 1 ? a[0] || '' : a[0] + ' and ' + lc(a[1]));
export function buildSummary({ business, status, split, retention, trend, reset, recs, formats, freshness, diag }) {
  const longOnly = !!(POLICY[business] && POLICY[business].longOnly);
  const P = [];
  const paid = split && split.verifiable ? split.paid_share_pct : null;
  const slowing = status.momentum && status.momentum.label === 'slowing' && status.code !== 'growing' && status.code !== 'reset';
  const t4 = (trend || []).filter((x) => isNum(x.views)).slice(-4);
  const tsum = t4.reduce((a, x) => a + x.views, 0), tmax = t4.reduce((a, x) => Math.max(a, x.views), 0);
  const volatile = t4.length === 4 && tsum >= 500 && Math.round((tmax / tsum) * 100) >= MIN.weekShare;
  const rc = diag && diag.categories ? diag.categories.find((x) => x.key === 'retention') : null;
  const gap = !longOnly && retention && retention.best && retention.worst && retention.curves >= 3 ? Math.round((retention.best.at25 - retention.worst.at25) * 100) / 100 : null;
  const earlyLoss = rc && rc.stats && rc.stats.format_known ? rc.status === 'problem_observed' : (!longOnly && retention && retention.early_loss > 0);
  if (status.code === 'declining' || slowing) P.push({ key: 'discovery', kind: 'analysis', label: 'Organic discovery', action: 'Investigate traffic sources' });
  else if (paid !== null && paid >= 50) P.push({ key: 'paid', kind: 'analysis', label: 'Heavy reliance on paid advertising', action: 'Track organic views separately and run a comparison period without ads' });
  if (earlyLoss) P.push({ key: 'retention', kind: 'creative', label: 'Early viewer retention', action: 'Test stronger openings' });
  if (reset) P.push({ key: 'reset', kind: 'analysis', label: volatile ? 'Inconsistent viewing after the catalog reset' : 'No comparable baseline after the catalog reset', action: (longOnly ? 'Evaluate performance of new Long videos' : 'Evaluate performance of the new catalog') + ((gap !== null && gap >= MIN.spread) || (longOnly && earlyLoss) ? ' and improve openings' : '') });
  if (status.code === 'unknown' && !P.length) P.push({ key: 'data', kind: 'analysis', label: 'Not enough data to diagnose', action: 'Wait for the next data collection before changing anything' });
  if (!P.length) P.push({ key: 'ok', kind: 'analysis', label: 'No major problem detected', action: 'Keep the current approach and keep tracking organic views weekly' });
  const top = P.slice(0, 2);
  const kinds = new Set(top.map((x) => x.kind));
  const owner = kinds.has('creative') && kinds.has('analysis') ? 'Growth & Creative Quality' : kinds.has('creative') ? 'Creative Quality' : 'Growth & Analytics';
  // observed evidence: one sentence, built only from stored numbers
  const parts = [];
  if (status.code === 'reset') { const w = status.weekly && status.weekly.weeks; if (w && w.length >= 2) parts.push(`since the reset, weekly views went ${w.map((x) => fmt(x.views)).join(' → ')}`); parts.push('the previous 28 days are not comparable'); }
  else if (status.delta_pct !== null && status.delta_pct !== undefined) parts.push(`organic views ${status.delta_pct >= 0 ? 'rose' : 'fell'} ${Math.abs(status.delta_pct)}% against the previous 28 days`);
  else parts.push(status.reason.replace(/\.$/, ''));
  if (paid !== null && paid > 0) parts.push(`paid advertising supplied ${paid}% of all views`);
  if (earlyLoss) parts.push(rc && rc.stats && rc.stats.format_known ? `${rc.stats.long_low} of ${rc.stats.long_n} measured Long videos keep under half of their viewers at the 25% mark` : `${retention.early_loss} of ${retention.curves} measured videos lose about half their viewers in the first quarter`);
  const observed = parts.length ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? '; ' + parts.slice(1).join('; ') : '') + '.' : '';
  const hyp = (recs || []).map((r) => r.diagnosis || '').find((d) => /^Hypothesis/.test(d)) || null;
  const caveats = [];
  if (longOnly) { const L = formats && formats.rows && formats.rows.find((x) => x.type === 'long'); if (L && L.views < 1000) caveats.push(`Long-video sample is small (${fmt(L.views)} views in 28 days): growth is unproven, not failed.`); caveats.push(POLICY[business].note); }
  return { problem: joinAnd(top.map((x) => x.label)), action: joinAnd(top.map((x) => x.action)) + '.', owner, observed, hypothesis: hyp, caveats, basis: top.map((x) => x.key), advisory: true };
}

const UNAVAILABLE = [
  { key: 'revenue', label: 'Revenue', reason: 'YouTube revenue is not collected: the channel connection has no revenue permission and no Studio → Earn figures are captured.', needed: 'CEO decision: grant the revenue-read permission, or capture the Earn figures from YouTube Studio (CEO-attested).' },
  { key: 'expenses', label: 'Expenses', reason: 'There is no verified business-level expense source. Finance holds household figures only, and YouTube does not report advertising spend.', needed: 'Tag business costs in Finance (verified import) or record ad spend from Google Ads billing.' },
];
export const LIMITATIONS = Object.freeze([
  { key: 'ctr', label: 'Thumbnail impressions and click-through rate', reason: 'Not in the Analytics API. The Reporting API reach reports (channel_reach_basic_a1, channel_reach_combined_a1, added 2026-01-15) carry them, but no reporting job exists yet.', work: 'CEO exports Studio → Analytics → Reach now, or authorizes a Reporting API job (existing scope, no new credential).' },
  { key: 'daily', label: 'Daily detailed collection', reason: 'The scheduled collector is off, so detailed figures end on the data-through date.', work: 'CEO authorization to switch on the scheduled collection (already built).' },
  { key: 'sources_prev', label: 'Traffic sources for the previous 28 days', reason: 'Stored for the current window only, so the source that lost views cannot be named.', work: 'CEO authorization for a collector change (same API call, existing scope) or a CEO-provided Studio export.' },
  { key: 'audience', label: 'New vs returning viewers, geography, age', reason: 'New/returning viewers exist in Studio only; geography and age are not collected.', work: 'CEO export for returning viewers; collector change (authorization) for geography and age.' },
  { key: 'engagement', label: 'Shares and per-window likes/comments', reason: 'Lifetime likes and comments are collected daily from the Data API and shown; shares and window-level engagement are not.', work: 'Collector change (authorization): add shares, likes and comments to the analytics requests.' },
  { key: 'format', label: 'Authoritative per-video Long/Short', reason: 'Format per video is estimated from stored view duration ÷ % viewed and validated against YouTube\'s content-type totals; the stored data has no duration field.', work: 'Collector change (authorization): store Data API contentDetails.duration (youtube.readonly already granted).' },
]);

export function buildHomeCard({ business, name, dash, rows, counters, pipeline, collection, videoRows, catalog, formatMap, reach, ypp, nowMs }) {
  if (!dash || dash.error || dash.collected === false && !dash.windows) return { business, name, state: 'unavailable', reason: dash && dash.error ? 'The analytics report could not be built for this business.' : 'No analytics are stored for this business yet.' };
  const w = dash.windows || {}, d28 = w.d28 || {}, p28 = w.d28_prev || {}, conv = dash.conversion || {};
  const hist = (counters && counters.history) || []; const reset = findReset(hist, nowMs);
  const status = statusOf(dash, reset); if (!status.weekly) status.weekly = weekly(dash);
  const through = dash.freshness && dash.freshness.last_day ? dash.freshness.last_day : null; const age = through ? daysBetween(through, nowMs) : null;
  const sinceThrough = through ? counterChange(hist, through, nowMs) : null;
  const verifiable = isNum(d28.paid_views) && isNum(d28.non_ad_views);
  const content = contentOf(dash, rows, nowMs);
  if (Array.isArray(catalog) && catalog.length) {   // the channel catalog (Data API sync) is the authoritative list of uploads
    const up = (a, b) => catalog.filter((x) => x && x.published_at && Date.parse(x.published_at) >= a && Date.parse(x.published_at) < b).length;
    content.uploads = { last28: up(nowMs - 28 * DAY, nowMs + DAY), prev28: up(nowMs - 56 * DAY, nowMs - 28 * DAY) };
  }
  const subsTotal = counters && isNum(counters.subscribers) ? counters.subscribers : null;
  const c28 = counterChange(hist, addDaysKey(dateKey(nowMs), -28), nowMs);
  const card = {
    business, name, state: 'ok', status,
    freshness: { data_through: through, age_days: age, stale: age !== null && age >= MIN.staleDays, collected_at: dash.freshness ? dash.freshness.collected_at : null, counters_synced_at: counters ? counters.updated_at : null, last_ok_sync: pipeline && pipeline.last_ok_at ? pipeline.last_ok_at : null, last_sync_status: pipeline ? pipeline.last_status : null, last_sync_steps_ok: pipeline && pipeline.steps_ok != null ? pipeline.steps_ok : null, since_through: sinceThrough },
    window: { from: d28.from || null, to: d28.to || null, prev_from: p28.from || null, prev_to: p28.to || null, status: d28.status || null },
    kpis: {
      organic: { value: verifiable ? d28.non_ad_views : null, prev: isNum(p28.non_ad_views) ? p28.non_ad_views : null, delta_pct: status.comparable ? pctChange(d28.non_ad_views, p28.non_ad_views) : null, comparable: status.comparable },
      total: { value: isNum(d28.views) ? d28.views : null, prev: isNum(p28.views) ? p28.views : null, delta_pct: status.comparable ? pctChange(d28.views, p28.views) : null },
      watch_hours: { value: isNum(d28.watch_hours) ? d28.watch_hours : null, prev: isNum(p28.watch_hours) ? p28.watch_hours : null, delta_pct: status.comparable ? pctChange(d28.watch_hours, p28.watch_hours) : null },
      subscribers: { total: subsTotal, net_28d: isNum(d28.net_subs) ? d28.net_subs : null, prev_net_28d: isNum(p28.net_subs) ? p28.net_subs : null, per_1000_organic: isNum(conv.per_1000_non_ad) ? conv.per_1000_non_ad : null, prev_per_1000_organic: isNum(conv.prev_per_1000_non_ad) ? conv.prev_per_1000_non_ad : null, counter_change_28d: c28 && isNum(c28.subs) ? c28.subs : null },
    },
    split: verifiable ? { verifiable: true, organic: d28.non_ad_views, paid: d28.paid_views, paid_share_pct: d28.paid_share_pct, note: d28.paid_views === 0 ? 'No advertising traffic was recorded in these 28 days, so all views are organic (non-advertising).' : 'Paid = YouTube traffic source "advertising". Organic = every other source.' } : { verifiable: false, organic: null, paid: null, total: isNum(d28.views) ? d28.views : null, note: 'The paid series is not known for every day of the window, so the split is not stated and total views are not called organic.' },
    trend: ((dash.trend || []).slice(-8)).map((t) => ({ from: t.from, to: t.to, views: t.views, organic: t.non_ad_views, paid: isNum(t.views) && isNum(t.non_ad_views) ? t.views - t.non_ad_views : null })),
    content, retention: retentionOf(dash),
    money: UNAVAILABLE.map((u) => ({ ...u, state: 'unavailable' })),
    monetization: dash.ypp && dash.ypp.has_capture ? { state: 'captured' } : { state: 'not_captured', note: 'YouTube Partner Program progress is not captured (Studio → Earn).' },
    recommendations: pickRecommendations(dash, content, nowMs, business),
    limitations: LIMITATIONS,
    isolation: { channel_id: dash.channel_id || null },
    policy: POLICY[business] ? { long_only: true, note: POLICY[business].note } : null,
  };
  card.diagnosis = buildDiagnosis({ reach: reach || null, ypp: ypp || dash.ypp || null, business, dash, status, videoRows, catalog, formatMap, nowMs, longOnly: !!(POLICY[business] && POLICY[business].longOnly) });
  card.engagement = card.diagnosis.engagement || null;
  { const y = ypp || dash.ypp || null; card.monetization = y && y.state && y.state !== 'not_captured' ? { state: y.state, eligibility: y.eligibility ? y.eligibility.text : null, captured_at: y.capturedAt || null, data_as_of: y.dataAsOf || null, official: (y.official || []).map((o) => ({ label: o.label, text: o.text })), source: y.source } : { state: 'not_captured', eligibility: null, note: 'Monetization progress is not known: no official YouTube Studio → Earn capture is stored (the API cannot provide qualified watch hours or Shorts views).' }; }
  card.plan = buildPlan({ business, name, card, nowMs });
  card.summary = buildSummary({ diag: card.diagnosis, business, status, split: card.split, retention: card.retention, trend: card.trend, reset, recs: card.recommendations, formats: dash.formats, freshness: card.freshness });
  const sched = collection && typeof collection.scheduled === 'boolean' ? collection.scheduled : null;
  card.collection = { scheduled: sched };
  if (card.freshness.stale) card.stale_banner = `Detailed analytics end on ${dlab(through)} (${age} days ago${sched === false ? '; the daily detailed collection is not switched on' : ''}). The 28-day figures below describe ${dlab(d28.from)} to ${dlab(d28.to || through)}${card.freshness.since_through ? '; the public counters moved after that (see "Since data-through")' : ''}.`;
  if (sched === true) card.limitations = LIMITATIONS.filter((x) => x.key !== 'daily');
  return card;
}
