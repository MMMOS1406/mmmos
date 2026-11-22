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
export const POLICY_TEXT = Object.freeze({
  srv_studio: 'Female Emotional Deep House, Long only. Do not recommend resuming Shorts. Any creative change needs CEO approval.',
  silk_road_voices: 'Approved Farsi Creative V2 and the artist/mood policies stay as they are. Any creative change needs CEO approval; experiments below change measurement, packaging tests and ad settings only.',
});

// ── 1. format classification per video. Authoritative source = YouTube creatorContentType totals (collected). Per-video type is not stored, so it is ESTIMATED from the stored
//      average view duration ÷ average % viewed (≈ runtime) and VALIDATED against those authoritative totals; if they disagree the classification is declared unreliable. ──
export function classifyVideos(videoRows, formats) {
  const rows = (Array.isArray(videoRows) ? videoRows : []).map((v) => { const avd = num(v.avd ?? v.avg_view_duration_sec), pct = num(v.pct ?? v.avg_view_pct), views = num(v.views) || 0; const rt = avd > 0 && pct > 0 ? avd / (pct / 100) : null;
    return { id: v.id || v.video_id, views, avd, pct, subs: num(v.subs_gained), runtime_sec: rt === null ? null : Math.round(rt), type: rt === null ? 'unknown' : rt <= D_MIN.shortMaxSec ? 'short' : rt >= D_MIN.longMinSec ? 'long' : 'ambiguous' }; });
  const sum = (t) => rows.filter((r) => r.type === t).reduce((a, r) => a + r.views, 0);
  const est = { short: sum('short'), long: sum('long'), ambiguous: sum('ambiguous'), unknown: sum('unknown') };
  const api = { long: null, short: null };
  for (const f of (formats && formats.rows) || []) if (f.type === 'long' || f.type === 'short') api[f.type] = num(f.views);
  let validated = null, note = 'The YouTube content-type totals are not available, so the per-video format could not be validated.';
  if (isNum(api.long) && isNum(api.short)) {
    const tot = api.long + api.short, tol = Math.max(50, tot * D_MIN.classTolerance);
    validated = Math.abs(est.short - api.short) <= tol && Math.abs(est.long + est.ambiguous - api.long) <= tol;
    note = validated ? `Estimated Short ${fmt(est.short)} / Long ${fmt(est.long + est.ambiguous)} views agree with YouTube's content-type totals (Short ${fmt(api.short)} / Long ${fmt(api.long)}).` : `Estimated Short ${fmt(est.short)} / Long ${fmt(est.long + est.ambiguous)} views do NOT agree with YouTube's totals (Short ${fmt(api.short)} / Long ${fmt(api.long)}): per-video format is unreliable.`;
  }
  return { rows, est, api, validated, basis: 'Estimated runtime = average view duration ÷ average % viewed (stored per video). Short ≤ 61 s, Long ≥ 180 s. The authoritative per-video duration (Data API contentDetails.duration) is not stored yet.', note };
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
  return { d28, p28, from, cohort, uploads, sources, orgTotal, engagement, ctrKnown, catalogN: (catalog || []).length, byId };
}

const cat = (key, label, o) => ({ key, label, status: 'insufficient_evidence', confirmed: [], metrics: [], hypothesis: null, confidence: 'Low', missing: [], experiment: null, ...o });
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
  if (c.status === 'problem_observed') c.experiment = longOnly
    ? { text: `Diagnostic first, no creative change: ${EXPORT_STEP(through)} Read the Long uploads separately, then compare their exposure with the earlier Shorts. Record day-1, day-3 and day-7 views for each of the next three Long uploads.`, short: 'Get impressions, click-through rate and traffic sources for the Long uploads (Studio export), compare Long exposure with the earlier Shorts, and log day-1/3/7 views for the next three Long uploads.', owner: 'CEO (export) → Growth & Analytics', review_days: 14, success: 'Impressions and click-through rate are known for every Long upload, and each of the next three Long uploads has a day-7 view count to judge it against.', needs: 'CEO-provided export (no authorization needed) — or authorize collector changes C1/C3 below' }
    : { text: `Diagnostic first, no creative change: ${EXPORT_STEP(through)} With the two periods side by side we can name the source that lost the views.`, short: 'Get the traffic-source split for both 28-day periods (Studio export) and name the source that lost the views.', owner: 'CEO (export) → Growth & Analytics', review_days: 7, success: 'At least 80% of the lost organic views are attributed to named traffic sources, or the decline is shown not to come from exposure.', needs: 'CEO-provided export (no authorization needed) — or authorize collector change C1 below' };
  return c;
}
function packaging({ business, F, through, longOnly }) {
  const c = cat('packaging', 'Packaging — are clicks weak relative to exposure?');
  c.confirmed.push(`No impressions or click-through rate are stored (${F.ctrKnown} of ${F.catalogN} videos have either).`);
  c.missing = ['Thumbnail impressions', 'Impressions click-through rate', 'Impressions by traffic source'];
  c.status = 'insufficient_evidence'; c.confidence = 'Low';
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
  c.stats = { long_n: longC.length, long_low: longC.filter((x) => x.all.at25 < 0.5).length, format_known: usable };
  const gaps = longC.filter((x) => x.organic && isNum(x.organic.at25)).map((x) => ({ t: shortT(x.title || x.video_id, 28), all: x.all.at25, org: x.organic.at25 }));
  if (gaps.length) c.confirmed.push('Organic-only viewers (paid excluded) at 25%: ' + gaps.map((g) => `${g.t} ${g.org} (all viewers ${g.all})`).join('; ') + '.');
  c.metrics = [{ label: 'Long watch ratio at 25% (median)', value: median(at) === null ? '—' : String(median(at)), sample: `${longC.length} Long videos ≥ ${D_MIN.curveViews} views` }, { label: 'Long avg % viewed', value: Lpct === null ? '—' : Lpct + '%', sample: `${fmt(Lv)} Long views` }];
  if (longC.length >= 2) {
    const low = longC.filter((x) => x.all.at25 < 0.5).length;
    c.status = low >= 2 ? 'problem_observed' : 'no_problem_observed'; c.confidence = longC.length >= 3 ? 'Medium' : 'Low';
    if (c.status === 'problem_observed') {
      c.headline = `Long videos lose viewers early (${c.stats.long_low} of ${c.stats.long_n} measured Long videos keep under half of their viewers at the 25% mark)`;
      const worse = gaps.filter((g) => g.org + 0.05 <= g.all).length;
      c.hypothesis = (gaps.length && worse === 0 ? 'Paid viewers do not explain the early drop on its own: organic-only viewers also leave early on the same videos. ' : 'Paid viewers may leave earlier than organic viewers, which would lower the averages. ') + 'The opening of Long videos may not hold attention; there is no stronger Long video on this channel to compare against, so the cause is not tested.';
      c.missing = ['Organic-only average view duration per video and per format', 'A Long video with strong retention to compare against', 'Retention for Long videos below the sample threshold'];
      c.experiment = { text: 'Hold the creative constant and change only what can be measured: for one 28-day period run no paid ads on the Long videos (or ads on one video only), then read organic-only retention for each new Long upload. With CEO approval, test a different first-10-seconds visual on ONE upcoming Long video; approved music, artist and mood do not change.', short: 'Run one 28-day period without paid ads on Long videos and read organic-only retention; with CEO approval test a different first-10-seconds visual on one Long video.', owner: 'CEO (ad setting and creative approval) → Growth & Analytics', review_days: 28, success: `Watch ratio at 25% of at least 0.50 on the next 3 Long uploads (today: median ${median(at)} across ${longC.length} Long videos).`, needs: 'CEO decision on ad spend; no collection change' };
    }
  } else {
    c.status = 'insufficient_evidence'; c.confidence = 'Low';
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
    c.status = ch <= -D_MIN.convFlat ? 'problem_observed' : 'no_problem_observed'; c.confidence = 'Medium';
    if (c.status === 'no_problem_observed') c.confirmed.push('Conversion per organic view is steady; the lower subscriber total follows from fewer organic views, not from weaker conversion. Repeat viewing itself cannot be measured with the API.');
    else { c.hypothesis = 'Viewers may be less inclined to subscribe; not tested.'; c.experiment = { text: 'Add a subscribe prompt (pinned comment and end screen) to the next three Long uploads and compare subscribers per 1,000 organic views.', short: 'Add a subscribe prompt to the next three Long uploads and compare subscribers per 1,000 organic views.', owner: 'Growth & Analytics (CEO approves text)', review_days: 28, success: `Subscribers per 1,000 organic views back to ${cv.prev_per_1000_non_ad} or higher.`, needs: 'CEO approval' }; }
  } else {
    c.status = 'insufficient_evidence'; c.confidence = 'Low';
    c.confirmed.push(`Subscriber sample is too small to judge conversion (${isNum(d28.net_subs) ? d28.net_subs : '—'} net subscribers in 28 days; at least ${D_MIN.subsSample} needed across both windows).`);
    if (longOnly) c.confirmed.push('Subscriber and viewer figures mix Shorts-feed viewers with Long viewers; they are not split by format.');
  }
  return c;
}

const ORDER = ['distribution', 'retention', 'packaging', 'audience'];
const STATUS_RANK = { problem_observed: 0, insufficient_evidence: 1, no_problem_observed: 2 };
const addDays = (ms, n) => dkey(ms + n * DAY);

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

export function buildDiagnosis({ business, dash, status, videoRows, catalog, nowMs, longOnly }) {
  if (!dash || dash.error || !dash.windows) return { state: 'unavailable' };
  const cls = classifyVideos(videoRows, dash.formats);
  const F = facts({ dash, cls, catalog, nowMs });
  const through = (dash.freshness && dash.freshness.last_day) || dkey(nowMs);
  const args = { business, dash, status, cls, F, nowMs, longOnly, through };
  const cats = [distribution(args), retention(args), packaging(args), audience(args)];
  cats.forEach((c) => { if (c.experiment) c.experiment.review_by = addDays(nowMs, c.experiment.review_days); });
  const ranked = cats.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const problems = cats.filter((c) => c.status === 'problem_observed'), unknown = cats.filter((c) => c.status === 'insufficient_evidence');
  const leading = ranked.find((c) => c.experiment) || null;
  const established = problems.length > 0 && problems.every((c) => c.confidence === 'High' && c.missing.length === 0);
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
    categories: cats, classification: { basis: cls.basis, validated: cls.validated, note: cls.note, est: cls.est, api: cls.api },
    engagement: F.engagement, data_plan: DATA_PLAN, policy: POLICY_TEXT[business] || null, advisory: true,
    first_evidence: first(problems[0]),
  };
}
