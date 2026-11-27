// Content strategy intelligence (G5). PURE: no network, no clock, no environment. Everything it knows comes from its arguments.
//
// 1. LINK   published YouTube videos <-> production packages, ONLY by exact YouTube video id recorded in the package (never by title, date or similarity).
//           An id claimed by two packages, a package of the other business, or an id that is not in this channel's catalog is NOT linked and is reported.
// 2. FEATURE what is known about each linked video's production (music, vocals, lyrics, visual, thumbnail, title, publishing). Unknown stays null — nothing is inferred or invented.
// 3. ASSESS  per component (music, vocals, lyrics, visualizations, opening/hook, thumbnails, titles, publishing): working / needs improvement / not working / needs testing /
//           insufficient evidence. A positive or negative status needs: enough videos in the group AND in the comparison, a consistent effect, no single-video concentration,
//           no period confounding, and (when the business used advertising) per-video advertising separated. Otherwise the honest status is "needs testing" or "insufficient evidence".
// 4. ADVISE at most three recommendations per business; each says what to change or test, why, the baseline, a measurable target, the owner and a review date,
//           and whether it is a confirmed correction or a proposed experiment. Advisory only: nothing here changes production.

import { planFor, EXPERIMENT_ORDER, EXPERIMENTS, RELEASES as EXP_RELEASES, EXEC_BY } from './contentExperiments.mjs';
export const BUSINESS_ENGINE = Object.freeze({ silk_road_voices: 'SRV Farsi', srv_studio: 'SRV English' });
export const STATUS = Object.freeze({ working: 'Working', improve: 'Needs improvement', not_working: 'Not working', test: 'Needs testing', insufficient: 'Not enough data' });
export const COMPONENTS = Object.freeze([
  { key: 'music', label: 'Music', dims: ['mood', 'genre', 'bpm_band'] },
  { key: 'vocals', label: 'Vocals', dims: ['vocal', 'vocal_style'] },
  { key: 'lyrics', label: 'Lyrics', dims: ['sub_mode', 'hook_structure'] },
  { key: 'visuals', label: 'Visualizations', dims: ['visual_kind', 'avatar_pool', 'visual_motion'] },
  { key: 'opening', label: 'Opening and hook', dims: ['opening_visual', 'intro_type'] },
  { key: 'thumbnails', label: 'Thumbnails', dims: ['thumb_emoji', 'thumb_text_band', 'thumb_custom', 'thumb_variant'] },
  { key: 'titles', label: 'Titles', dims: ['title_bilingual', 'title_emoji', 'title_len_band'] },
  { key: 'publishing', label: 'Publishing', dims: ['weekday', 'hour_band'] },
]);
export const DIM_LABEL = Object.freeze({ mood: 'mood', genre: 'music genre', bpm_band: 'tempo', vocal: 'vocalist', sub_mode: 'emotional theme', hook_structure: 'hook structure', visual_kind: 'visual type', avatar_pool: 'avatar set',
  thumb_emoji: 'thumbnail emoji', thumb_text_band: 'thumbnail text length', thumb_custom: 'custom thumbnail', title_bilingual: 'bilingual title', title_emoji: 'emoji in the title', title_len_band: 'title length', weekday: 'publishing weekday', hour_band: 'publishing hour', vocal_style: 'vocal style', visual_motion: 'static or animated visual', opening_visual: 'visual opening', intro_type: 'musical opening', thumb_variant: 'thumbnail design' });
const VALUE_LABEL = { thumb_emoji: { true: 'emoji in the thumbnail text', false: 'no emoji in the thumbnail text' }, thumb_custom: { true: 'a custom thumbnail', false: 'the automatic thumbnail' }, title_bilingual: { true: 'a bilingual title (Farsi and English)', false: 'a single-language title' }, title_emoji: { true: 'an emoji in the title', false: 'no emoji in the title' } };
const vlab = (dim, v) => (VALUE_LABEL[dim] && VALUE_LABEL[dim][String(v)]) || String(v);
export const LIM = Object.freeze({ minGroup: 5, minOther: 5, minWindowViews: 20, ratioWork: 1.5, ratioBad: 0.5, ratioSoft: 0.8, shareWork: 0.7, concentration: 0.5, periodDays: 21, minVideosForRead: 8, maxRecs: 3, maxDocBytes: 120000, maxVideos: 200 });

const ID11 = /^[A-Za-z0-9_-]{11}$/;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const lc = (s) => (typeof s === 'string' && s.trim() ? s.trim().toLowerCase() : null);
const str = (s, n = 120) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);
const median = (a) => { const s = a.filter(isNum).slice().sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => (isNum(x) ? Math.round(x * 10) / 10 : null);
const DAY = 86400000;

/* ───────────────────────── 1. linkage ───────────────────────── */
function candidates(row, d) {
  const out = []; const add = (id, role, via) => { if (typeof id === 'string' && ID11.test(id)) out.push({ id, role, via }); };
  add(row && row.youtube_video_id, 'main', 'column');
  add(d.youtubeVideoId, 'main', 'youtubeVideoId'); add(d.youtube_video_id, 'main', 'youtube_video_id');
  add(d._srvYtLongId, 'long', '_srvYtLongId'); add(d._srvYtShortId, 'short', '_srvYtShortId');
  for (const k of ['srvProduction', 'srvPilot', 'srvVa']) { const x = d[k]; if (x && typeof x === 'object') add(x.youtubeVideoId, x.kind === 'long' || x.kind === 'short' ? x.kind : 'main', k); }
  const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(typeof d.youtubeWatchUrl === 'string' ? d.youtubeWatchUrl : ''); if (m) add(m[1], 'main', 'youtubeWatchUrl');
  return out;
}
export function parsePackage(row) { try { const d = typeof row.full_package === 'string' ? JSON.parse(row.full_package) : (row.full_package || {}); return d && typeof d === 'object' ? d : {}; } catch (_) { return {}; } }

// -> { links: {videoId: {pkgId, role, via, d}}, report }
export function linkPackages({ business, packages, catalogIds }) {
  const engine = BUSINESS_ENGINE[business]; const cat = new Set(catalogIds || []);
  const claims = new Map(); let wrongEngine = 0, parsed = 0;
  for (const row of packages || []) {
    if (!row) continue; const d = parsePackage(row); parsed++;
    const eng = row.engine || d.engine; if (eng !== engine) { if (candidates(row, d).length) wrongEngine++; continue; }
    const seen = new Set();
    for (const c of candidates(row, d)) { const k = c.id + '|' + String(row.id); if (seen.has(k)) continue; seen.add(k); if (!claims.has(c.id)) claims.set(c.id, []); claims.get(c.id).push({ pkgId: row.id, role: c.role, via: c.via, d, row }); }
  }
  const links = {}, conflicts = [], notInCatalog = []; let roleDisagree = 0;
  for (const [id, cl] of claims) {
    const pk = [...new Set(cl.map((x) => x.pkgId))];
    if (!cat.has(id)) { notInCatalog.push(id); continue; }
    if (pk.length > 1) { conflicts.push({ id, packages: pk.slice(0, 4) }); continue; }
    const roles = [...new Set(cl.map((x) => x.role).filter((r) => r !== 'main'))]; if (roles.length > 1) { roleDisagree++; continue; }
    links[id] = { pkgId: pk[0], role: roles[0] || cl[0].role, via: cl.map((x) => x.via).filter((v, i, a) => a.indexOf(v) === i), d: cl[0].d };
  }
  const total = (catalogIds || []).length;
  return { links, report: { engine, packages_read: parsed, catalog_videos: total, linked: Object.keys(links).length, linked_pct: total ? r1((Object.keys(links).length / total) * 100) : null, conflicts, claimed_not_in_catalog: notInCatalog.length, other_business_with_video_ids: wrongEngine, role_disagreements: roleDisagree } };
}

/* ───────────────────────── 2. features ───────────────────────── */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const FARSI = /[؀-ۿ]/;
const GENRES = [['deep house', /deep house/i], ['house', /\bhouse\b/i], ['r&b', /\br&b\b|\brnb\b/i], ['lo-fi', /lo-?fi/i], ['edm', /\bedm\b|electronic dance/i], ['ballad', /ballad/i], ['acoustic', /acoustic/i], ['pop', /\bpop\b/i], ['folk', /\bfolk\b/i]];
const tz = (iso, zone) => { try { const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return { weekday: f.find((p) => p.type === 'weekday').value, hour: Number(f.find((p) => p.type === 'hour').value) }; } catch (_) { return null; } };
const bpmBand = (b) => (!isNum(b) ? null : b < 100 ? 'slow (under 100)' : b <= 115 ? 'mid (100–115)' : 'up (over 115)');
const hourBand = (h) => (!isNum(h) ? null : h < 6 ? 'night (0–5)' : h < 12 ? 'morning (6–11)' : h < 17 ? 'afternoon (12–16)' : h < 21 ? 'evening (17–20)' : 'late (21–23)');
const lenBand = (n) => (!isNum(n) ? null : n <= 30 ? 'short (≤30)' : n <= 60 ? 'medium (31–60)' : 'long (>60)');
const textBand = (n) => (!isNum(n) ? null : n <= 12 ? 'very short (≤12)' : n <= 25 ? 'short (13–25)' : 'longer (>25)');

export function featuresOf({ d, role, video }) {
  const dd = d || {}; const title = str(video && video.title, 200);
  const sunoRaw = str(dd.sunoPrompt, 800) || str(dd.shortSunoPrompt, 800);
  let bpm = isNum(Number(dd.bpm)) && Number(dd.bpm) > 40 && Number(dd.bpm) < 220 ? Number(dd.bpm) : null; if (bpm === null && sunoRaw) { const m = /(\d{2,3})\s*bpm/i.exec(sunoRaw); if (m && Number(m[1]) > 40 && Number(m[1]) < 220) bpm = Number(m[1]); }
  let genre = null; const hay = (sunoRaw || '') + ' ' + (str(dd.styleNotes, 300) || ''); for (const [g, re] of GENRES) if (re.test(hay)) { genre = g; break; }
  const mainFmt = lc(dd.contentFormat); const format = dd.farsiMix && role === 'main' ? 'mix' : role === 'long' || role === 'short' ? role : (mainFmt === 'long' || mainFmt === 'short' || mainFmt === 'mix' ? mainFmt : null);
  const vocal = lc(dd.vocal) || lc(dd.artist);
  const av = dd._srvAvatarChoice && typeof dd._srvAvatarChoice === 'object' ? dd._srvAvatarChoice : null, pool = dd._srvVisualPoolPos && typeof dd._srvVisualPoolPos === 'object' ? dd._srvVisualPoolPos : null, sav = dd.srvAvatar && typeof dd.srvAvatar === 'object' ? dd.srvAvatar : null;
  const visualKind = av || sav || pool ? 'avatar' : (typeof dd._srvBgUrl === 'string' && dd._srvBgUrl ? 'stock background' : null);
  const avatarPool = pool && lc(pool.pool) ? lc(pool.pool) : (av && lc(av.artist) ? lc(av.artist) : (sav && typeof sav.id === 'string' ? (/-fm-/.test(sav.id) ? 'female' : /-m-/.test(sav.id) ? 'male' : null) : null));
  const tText = str(dd.thumbnailText, 120) || str(dd.shortThumbnailText, 120); const tCore = tText ? tText.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim() : null;
  const customThumb = typeof dd._srvThumbUrl === 'string' || typeof dd._srvThumbDataUrl === 'string' || dd.thumbnailSetOnYoutube === true ? true : (dd.thumbnailSetOnYoutube === false ? false : null);
  const pub = video && video.published_at ? tz(video.published_at, 'America/New_York') : null;
  const dur = isNum(Number(dd._srvLongDurationSec)) && Number(dd._srvLongDurationSec) > 0 ? Math.round(Number(dd._srvLongDurationSec)) : null;
  const f = {
    format, mood: lc(dd.mood), vocal, sub_mode: lc(dd.emotionalSubMode) || lc(dd.loveSituation), hook_structure: lc(dd.hookStructure), bpm, bpm_band: bpmBand(bpm), genre,
    visual_kind: visualKind, avatar_pool: avatarPool, animated: null, visual_motion: null, opening_visual: null, intro_type: null, vocal_style: null, thumb_variant: null, thumb_text_len: tCore ? Array.from(tCore).length : null, thumb_text_band: tCore ? textBand(Array.from(tCore).length) : null,
    thumb_emoji: tText ? EMOJI.test(tText) : null, thumb_custom: customThumb,
    title_len: title ? Array.from(title).length : null, title_len_band: title ? lenBand(Array.from(title).length) : null, title_emoji: title ? EMOJI.test(title) : null, title_bilingual: title ? (FARSI.test(title) && /[A-Za-z]/.test(title)) : null,
    weekday: pub ? pub.weekday : null, hour_band: pub ? hourBand(pub.hour) : null, duration_sec: dur, test: dd.isTest === true || dd._inTestMode === true ? true : null,
  };
  for (const k of Object.keys(f)) if (f[k] === undefined) f[k] = null;
  return f;
}
// What a package/video does NOT record (the honest "not captured" list; used to tell production what to capture).
export const NOT_CAPTURED = Object.freeze([
  { key: 'visual_opening', label: 'Visual opening (what the first 10 seconds show)', capture: 'one tag per Long at build time: opening_visual = avatar_close | avatar_wide | scene | text_card | other' },
  { key: 'musical_opening', label: 'Musical opening (intro type and length)', capture: 'intro_seconds and intro_type (instrumental | vocal_first | hook_first) from the approved Suno result' },
  { key: 'animated', label: 'Static versus animated visualization', capture: 'visual_motion = static | slow_motion | animated, set by the render step' },
  { key: 'thumbnail_design', label: 'Thumbnail design variant', capture: 'thumb_variant id (layout, face/no face, text position) stored when the thumbnail is set' },
  { key: 'genre_structured', label: 'Music genre / subgenre as a structured field', capture: 'genre and subgenre chosen at generation time, not parsed from the prompt' },
  { key: 'vocal_style', label: 'Vocal style (delivery)', capture: 'vocal_style tag (soft | powerful | breathy | raspy) chosen with the Suno prompt' },
]);

/* ───────────────────────── 3. analysis ───────────────────────── */
// perf input rows: [{id, views, minutes, avg_view_pct, avd, subs, paid_views (null when not separated), published_at}] for ONE window {from,to} (YYYY-MM-DD).
function daysLive(pub, win) { if (!pub || !win || !win.from || !win.to) return null; const a = Math.max(Date.parse(win.from + 'T00:00:00Z'), Date.parse(String(pub).slice(0, 10) + 'T00:00:00Z')), b = Date.parse(win.to + 'T00:00:00Z'); if (!(b >= a)) return null; return Math.round((b - a) / DAY) + 1; }
// Lifetime reach from the collector's catalog-wide statistics (fresh for EVERY video, not only the newest ~35). Needs the stat itself: stale catalog rows are never used.
const FRESH_MS = 4 * DAY;
function lifeOf(v, stats, nowMs) {
  const st = stats && v && stats[v.video_id]; if (!st || !isNum(st.v) || !nowMs || !v.published_at) return { life_views: null, reach_life: null };
  if (!st.at || nowMs - Date.parse(st.at) > FRESH_MS) return { life_views: null, reach_life: null };
  const age = Math.floor((nowMs - Date.parse(v.published_at)) / DAY); if (age < 14) return { life_views: st.v, reach_life: null };
  return { life_views: st.v, reach_life: st.v / age, life_likes: st.l, life_comments: st.c };
}
export function joinPerformance({ links, features, perf, catalog, window, advertising, catalogStats = null, nowMs = null }) {
  const cat = {}; for (const c of catalog || []) if (c && c.video_id) cat[c.video_id] = c;
  const src = features ? Object.entries(features).map(([id, x]) => [id, { f: x.f, pkgId: x.pkg }]) : Object.entries(links || {}).map(([id, l]) => [id, { f: null, l, pkgId: l.pkgId }]);
  const items = [];
  for (const [id, x] of src) {
    const v = cat[id]; if (!v) continue; const p = perf && Object.prototype.hasOwnProperty.call(perf, id) ? perf[id] : null;
    const f = x.f || featuresOf({ d: x.l.d, role: x.l.role, video: v });
    const live = daysLive(v.published_at, window);
    const paidKnown = p ? isNum(p.paid_views) : false; const organic = p && isNum(p.views) ? (paidKnown ? Math.max(0, p.views - p.paid_views) : (advertising === 0 ? p.views : null)) : null;
    items.push({ id, pkgId: x.pkgId, f, pub: v.published_at || null, title: v.title || null, live_days: live, views: p && isNum(p.views) ? p.views : 0, organic_views: organic, paid_known: paidKnown || advertising === 0,
      reach: live && p && isNum(p.views) ? (organic !== null ? organic : p.views) / live : null, reach_basis: organic !== null ? 'organic' : 'total', pct: p && isNum(p.avg_view_pct) ? p.avg_view_pct : null, avd: p && isNum(p.avd) ? p.avd : null, minutes: p && isNum(p.minutes) ? p.minutes : null, subs: p && isNum(p.subs) ? p.subs : null,
      lifetime_views: isNum(Number(v.view_count)) ? Number(v.view_count) : null, in_window: !!p, ...lifeOf(v, catalogStats, nowMs) });
  }
  return items;
}
function evalDim(items, dim, { metric = 'reach', viewsKey = 'views', minWindowViews = LIM.minWindowViews } = {}) {
  const pool = items.filter((i) => i.f[dim] !== null && i.f[dim] !== undefined && isNum(i[metric]) && i[viewsKey] >= minWindowViews);
  const values = [...new Set(pool.map((i) => String(i.f[dim])))];
  const res = { dim, metric, n: pool.length, groups: [], verdict: 'insufficient', why: null };
  if (pool.length < 3) { res.why = pool.length === 0 ? `no video has ${DIM_LABEL[dim] || dim} recorded with enough views in the window` : `only ${pool.length} videos have ${DIM_LABEL[dim] || dim} recorded with enough views in the window`; return res; }
  if (values.length < 2) { res.why = `all ${pool.length} comparable videos share the same ${DIM_LABEL[dim] || dim} (${vlab(dim, values[0])}), so it cannot explain any difference between them and there is nothing to compare`; res.constant = values[0]; return res; }
  if (pool.length < LIM.minGroup + LIM.minOther) { res.why = `only ${pool.length} comparable videos with different ${DIM_LABEL[dim] || dim} values and enough views (at least ${LIM.minGroup + LIM.minOther} needed)`; return res; }
  const overall = median(pool.map((i) => i[metric]));
  for (const v of values) {
    const g = pool.filter((i) => String(i.f[dim]) === v), o = pool.filter((i) => String(i.f[dim]) !== v);
    const mg = median(g.map((i) => i[metric])), mo = median(o.map((i) => i[metric]));
    const sum = g.reduce((a, i) => a + i[metric], 0), top = g.reduce((a, i) => Math.max(a, i[metric]), 0);
    const above = g.filter((i) => i[metric] > overall).length / g.length;
    const dg = median(g.map((i) => Date.parse(i.pub || ''))), dO = median(o.map((i) => Date.parse(i.pub || '')));
    res.groups.push({ value: v, n: g.length, n_other: o.length, median: r1(mg), other_median: r1(mo), ratio: mo > 0 ? Math.round((mg / mo) * 100) / 100 : null, share_above_overall: Math.round(above * 100) / 100, concentration: sum > 0 ? Math.round((top / sum) * 100) / 100 : null,
      period_gap_days: isNum(dg) && isNum(dO) ? Math.round(Math.abs(dg - dO) / DAY) : null, enough: g.length >= LIM.minGroup && o.length >= LIM.minOther });
  }
  const cand = res.groups.filter((g) => g.enough && g.ratio !== null).sort((a, b) => Math.abs(Math.log(b.ratio || 1)) - Math.abs(Math.log(a.ratio || 1)))[0];
  if (!cand) { res.verdict = 'insufficient'; res.why = `no ${DIM_LABEL[dim] || dim} group has at least ${LIM.minGroup} videos with at least ${LIM.minOther} to compare against`; return res; }
  res.lead = cand;
  const blockers = [];   // a comparison is only as good as BOTH sides: any adequate group dominated by one video, or published in a different period, blocks a firm verdict
  const conc = res.groups.filter((g) => g.enough && g.concentration !== null && g.concentration > LIM.concentration).sort((a, b) => b.concentration - a.concentration)[0]; if (conc) blockers.push(`one video accounts for ${Math.round(conc.concentration * 100)}% of the ${vlab(dim, conc.value)} group`);
  const gap = res.groups.filter((g) => g.enough && g.period_gap_days !== null && g.period_gap_days > LIM.periodDays).sort((a, b) => b.period_gap_days - a.period_gap_days)[0]; if (gap) blockers.push(`the ${vlab(dim, gap.value)} group was published about ${gap.period_gap_days} days apart from the rest, so the period (not the characteristic) may explain it`);
  const up = cand.ratio >= LIM.ratioWork && cand.share_above_overall >= LIM.shareWork, down = cand.ratio <= LIM.ratioBad && cand.share_above_overall <= 1 - LIM.shareWork, soft = cand.ratio < LIM.ratioSoft && cand.share_above_overall <= 1 - LIM.shareWork + 0.05;
  if (blockers.length) { res.verdict = 'test'; res.why = `${vlab(dim, cand.value)}: ${cand.ratio}× the others, but ${blockers.join('; ')}`; return res; }
  if (up) { res.verdict = 'working'; res.why = `${vlab(dim, cand.value)}: ${cand.n} videos, median ${cand.median} per day versus ${cand.other_median} for the other ${cand.n_other} (${cand.ratio}×)`; return res; }
  if (down) { res.verdict = 'not_working'; res.why = `${cand.value}: ${cand.n} videos, median ${cand.median} per day versus ${cand.other_median} for the other ${cand.n_other} (${cand.ratio}×)`; return res; }
  if (soft) { res.verdict = 'improve'; res.why = `${cand.value}: ${cand.n} videos below the others (${cand.ratio}×)`; return res; }
  res.verdict = 'test'; res.why = `${cand.value}: ${cand.ratio}× the others, not a consistent enough difference to call (${Math.round(cand.share_above_overall * 100)}% of the group above the overall median)`; return res;
}

// Component status from its dimensions. The combined rule is deliberately cautious: conflicting reads → needs testing; a positive/negative status needs one clear read and no clear opposite.
function componentStatus(comp, results, ctx) {
  const rs = comp.dims.map((d) => results[d]).filter(Boolean);
  const clear = rs.filter((r) => ['working', 'not_working', 'improve'].includes(r.verdict));
  const pos = clear.filter((r) => r.verdict === 'working'), neg = clear.filter((r) => r.verdict !== 'working');
  const test = rs.filter((r) => r.verdict === 'test');
  let status, why, evidence = [];
  if (pos.length && neg.length) { status = 'test'; why = 'Different characteristics point in opposite directions, so this needs a controlled test.'; evidence = clear.map((r) => r.why); }
  else if (clear.length) { const r = clear.sort((a, b) => (b.lead ? Math.abs(Math.log(b.lead.ratio || 1)) : 0) - (a.lead ? Math.abs(Math.log(a.lead.ratio || 1)) : 0))[0]; status = r.verdict; why = r.why; evidence = clear.map((x) => x.why); }
  else if (test.length) { status = 'test'; why = test[0].why; evidence = test.map((x) => x.why); }
  else { status = 'insufficient'; const w = rs.slice().sort((a, b) => (b.n || 0) - (a.n || 0))[0]; why = comp.key === 'opening' && rs.every((r) => (r.n || 0) === 0) ? 'The first seconds (visual and musical opening) are not recorded for any video, so they cannot be compared.' : (w && w.why ? w.why : 'Nothing about this was recorded.'); evidence = rs.map((r) => r.why).filter(Boolean); }
  const anyLimited = clear.some((r) => r.limited); if (anyLimited && ['working', 'not_working', 'improve'].includes(status)) { status = 'test'; why = 'The difference may be partly advertising: per-video advertising is not separated yet. ' + why; }
  // one short line for the CEO view (the full reasoning stays in `why`)
  const driver = rs.slice().sort((a, b) => (b.n || 0) - (a.n || 0))[0]; let short;
  if (anyLimited && status === 'test') short = 'Differences exist, but advertising is not separated per video yet';
  else if (status === 'insufficient' && comp.key === 'opening' && rs.every((r) => (r.n || 0) === 0)) short = 'Not recorded for any video';
  else if (status === 'insufficient' && driver && driver.constant !== undefined) short = `Identical in all ${driver.n} videos, so nothing to compare`;
  else if (status === 'insufficient' && driver) short = driver.n < 3 ? 'Too few videos have this recorded' : `Only ${driver.n} comparable videos (${LIM.minGroup + LIM.minOther} needed)`;
  else if (status === 'test') short = /accounts for|apart from the rest/.test(why) ? 'One video or one period explains the difference' : 'Not a consistent enough difference to call';
  else short = why.length > 90 ? why.slice(0, 89) + '…' : why;
  const missing = []; if (comp.key === 'opening') missing.push(...NOT_CAPTURED.filter((x) => ['visual_opening', 'musical_opening'].includes(x.key)).map((x) => x.capture)); if (comp.key === 'visuals') missing.push(...NOT_CAPTURED.filter((x) => x.key === 'animated').map((x) => x.capture)); if (comp.key === 'thumbnails') missing.push(...NOT_CAPTURED.filter((x) => x.key === 'thumbnail_design').map((x) => x.capture)); if (comp.key === 'music') missing.push(...NOT_CAPTURED.filter((x) => ['genre_structured'].includes(x.key)).map((x) => x.capture)); if (comp.key === 'vocals') missing.push(...NOT_CAPTURED.filter((x) => x.key === 'vocal_style').map((x) => x.capture));
  return { key: comp.key, label: comp.label, status, why, short, evidence: evidence.slice(0, 3), capture: missing };
}

export function analyse({ business, items, window, formats = ['long', 'short', 'mix'], advertising = null, advertisingLife = null, longOnly = false }) {
  const useFormats = longOnly ? ['long'] : formats; const results = {}; const cohorts = {};
  const cohort = items.filter((i) => i.in_window && i.f.format && useFormats.includes(i.f.format));
  // One cohort per format keeps Long, Short and Mix from being compared with each other. The reported read for a dimension is the format cohort with the most comparable videos.
  const byFmt = {}; for (const i of cohort) (byFmt[i.f.format] = byFmt[i.f.format] || []).push(i);
  for (const [fmt, arr] of Object.entries(byFmt)) cohorts[fmt] = { n: arr.length, with_views: arr.filter((i) => i.views >= LIM.minWindowViews).length };
  const dims = [...new Set(COMPONENTS.flatMap((c) => c.dims))];
  const lifeItems = items.filter((i) => i.f.format && useFormats.includes(i.f.format) && isNum(i.reach_life)); const byFmtL = {}; for (const i of lifeItems) (byFmtL[i.f.format] = byFmtL[i.f.format] || []).push(i);
  const lifeLimited = advertisingLife !== 0;   // lifetime views include every past advertising flight unless the channel never advertised since the first of these videos
  const winLimited = advertising !== 0 && cohort.filter((i) => i.views >= LIM.minWindowViews).some((i) => !i.paid_known);
  for (const d of dims) {
    const per = Object.entries(byFmt).map(([fmt, arr]) => ({ fmt, r: { ...evalDim(arr, d), basis: 'window', limited: winLimited } }))
      .concat(Object.entries(byFmtL).map(([fmt, arr]) => ({ fmt, r: { ...evalDim(arr, d, { metric: 'reach_life', viewsKey: 'life_views' }), basis: 'lifetime', limited: lifeLimited } })));
    // the basis with the most comparable videos wins; on a tie the window figure (it is the only one that can be split into organic and paid per video) is kept
    per.sort((a, b) => b.r.n - a.r.n || (a.r.basis === 'window' ? -1 : 1)); const best = per[0] || { fmt: null, r: { ...evalDim([], d), basis: 'window', limited: winLimited } }; results[d] = { ...best.r, format: best.fmt };
    if (best.fmt && best.r.verdict !== 'insufficient') best.r.why = `${best.fmt === 'mix' ? 'Mix' : best.fmt === 'long' ? 'Long' : 'Short'} videos${best.r.basis === 'lifetime' ? ' (lifetime views per day)' : ''}: ${best.r.why}`, results[d].why = best.r.why;
  }
  const paidLimited = winLimited || (lifeItems.length > 0 && lifeLimited);
  const comps = COMPONENTS.map((c) => componentStatus(c, results, { paidLimited }));
  return { cohorts, components: comps, dims: results, paid_limited: paidLimited, window };
}

/* ───────────────────────── 4. recommendations ───────────────────────── */
export function recommend({ business, name, analysis, items, nowMs, longOnly, status }) {
  const recs = []; const dkey = (ms) => new Date(ms).toISOString().slice(0, 10); const review = (days) => dkey(nowMs + days * DAY);
  const longs = items.filter((i) => i.f.format === 'long' && i.in_window && isNum(i.reach)); const baseReach = median(longs.map((i) => i.reach));
  const baseUp = longs.length; const pcts = longs.map((i) => i.pct).filter(isNum); const basePct = median(pcts);
  const get = (k) => analysis.components.find((c) => c.key === k);
  const th = get('thumbnails'), ti = get('titles'), vi = get('visuals');
  const label = 'Long'; const basisLabel = longs.length && longs.every((i) => i.reach_basis === 'organic') ? 'organic views per day per Long' : 'views per day per Long (advertising not yet separated)';
  // 1 — packaging test (reach per Long) when thumbnails/titles cannot be judged
  if (th && ti && ['insufficient', 'test'].includes(th.status) && ['insufficient', 'test'].includes(ti.status)) {
    recs.push({ id: 'packaging_test', kind: 'experiment', priority: 1, why_short: 'Thumbnails and titles cannot be judged yet; testing packaging alone keeps the result readable.', brief: 'two thumbnail and title designs on the next 6 Longs, music unchanged.', decide: 'the thumbnail and title test', verb: 'Test', department: 'Production (thumbnails and titles) with Growth & Analytics (measurement)',
      change: `On the next ${Math.min(6, Math.max(4, baseUp))} ${label} releases, alternate two thumbnail designs and two title structures; keep the approved music, vocals and visualization unchanged.`, owner: 'Production + Growth & Analytics',
      why: `Thumbnails and titles cannot be judged today: ${th.why} The packaging decides whether a ${label} song is clicked; changing music or visuals at the same time would make the result unreadable.`,
      baseline: { metric: basisLabel, value: r1(baseReach), n: baseUp }, target: baseReach ? { metric: basisLabel, value: r1(baseReach * 1.3), rule: 'median of the test releases at least 30% above the baseline, with thumbnail click-through measured once the reach report is available' } : null, review_by: review(42), success: 'Median organic views per day of the test releases is at least 30% above the baseline and the better design is identified; otherwise discontinue the tested design.' });
  }
  // 2 — opening/visual test for retention
  if (vi && ['insufficient', 'test'].includes(vi.status) && basePct !== null) {
    recs.push({ id: 'opening_test', kind: 'experiment', priority: 2, why_short: 'Visuals cannot be separated from music yet, and the opening is not recorded today.', brief: 'a different first-10-second visual on the next 4 Longs, music unchanged.', decide: 'the first-10-second visual test', verb: 'Test', department: 'Production (visualization) with Growth & Analytics (measurement)',
      change: `On the next 4 ${label} songs, test a different first-10-second visualization (avatar close-up versus wide scene); keep the approved music style unchanged.`, owner: 'Production + Growth & Analytics',
      why: `Visualizations cannot be separated from music with the data stored: ${vi.why} The first seconds decide early retention, and the opening is not recorded today.`,
      baseline: { metric: 'average percentage viewed per Long', value: r1(basePct), n: pcts.length }, target: { metric: 'average percentage viewed per Long', value: r1(basePct + 5), rule: 'median of the test releases at least 5 percentage points above the baseline' }, review_by: review(42), success: 'Median average percentage viewed of the test releases is at least 5 points above the baseline; otherwise keep the current opening.' });
  }
  // 3 — capture what is not recorded (a confirmed correction: it changes nothing creative)
  const needs = [...new Set(analysis.components.flatMap((c) => c.capture || []))];
  if (needs.length) recs.push({ id: 'capture_metadata', kind: 'correction', priority: 3, why_short: 'Without these fields music, visuals and thumbnails can never be compared; nothing creative changes.', brief: 'start recording the opening, thumbnail and genre of every new Long.', verb: 'Fix', department: 'Engineering (production record) with Production',
    change: 'Start recording the missing production choices (opening visual, intro, motion, thumbnail variant, genre, vocal style) for every new Long.', owner: 'Engineering + Production',
    why: 'Without these fields music, visuals, openings and thumbnails can never be compared; this is a recording change only and does not alter any creative decision.',
    baseline: { metric: 'Long videos with the new fields recorded', value: 0, n: 0 }, target: { metric: 'Long videos with the new fields recorded', value: 8, rule: 'the next 8 Long releases all carry the fields' }, review_by: review(60), success: 'The next 8 Long releases all carry the new fields.', needs });
  // a clear "working" or "not working" read yields a continue/reconsider note instead of a test slot
  for (const c of analysis.components) {
    if (recs.length >= LIM.maxRecs) break;
    if (c.status === 'not_working' || c.status === 'improve') recs.push({ id: 'fix_' + c.key, kind: 'experiment', priority: 1, brief: `an alternative to the weaker ${c.label.toLowerCase()} pattern on the next 4 releases.`, decide: `the ${c.label.toLowerCase()} test`, verb: 'Test', department: 'Production', change: `Test an alternative to the weaker ${c.label.toLowerCase()} pattern on the next 4 releases.`, owner: 'Production', why: c.why, baseline: null, target: null, review_by: review(42), success: 'The test releases beat the weaker pattern on the same measure.' });
  }
  recs.sort((a, b) => a.priority - b.priority);
  return recs.slice(0, LIM.maxRecs);
}

/* ───────────────────────── 5. working / not working (plain language) ───────────────────────── */
export function plainFindings({ analysis, items, longOnly }) {
  const working = [], notWorking = [];
  for (const c of analysis.components) {
    if (c.status === 'working') working.push({ component: c.label, text: c.why });
    if (c.status === 'not_working' || c.status === 'improve') notWorking.push({ component: c.label, text: c.why });
  }
  return { working, not_working: notWorking };
}

/* ───────────────────────── 6. stored document ───────────────────────── */
export const contentKey = (business) => 'growth_content_' + business;
export function buildFeatureDoc({ business, packages, catalog, nowIso }) {
  const catalogIds = (catalog || []).map((c) => c.video_id).filter(Boolean);
  const { links, report } = linkPackages({ business, packages, catalogIds });
  const cat = {}; for (const c of catalog || []) cat[c.video_id] = c;
  const videos = {};
  const ordered = Object.entries(links).sort((a, b) => String((cat[b[0]] || {}).published_at || '').localeCompare(String((cat[a[0]] || {}).published_at || '')));   // newest first when the cap applies
  for (const [id, l] of ordered) { const f = featuresOf({ d: l.d, role: l.role, video: cat[id] }); videos[id] = { pkg: l.pkgId, role: l.role, via: l.via, f }; if (Object.keys(videos).length >= LIM.maxVideos) break; }
  return { v: 1, business, at: nowIso, report, videos };
}
export function sanitizeFeatureDoc(raw, business) {
  let v; try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
  if (!v || typeof v !== 'object' || v.v !== 1 || v.business !== business || !v.videos || typeof v.videos !== 'object') return null;
  return v;
}

/* ───────────────────────── 7. the scorecard ───────────────────────── */
const STATUS_WORDS = { growing: 'Growing', declining: 'Declining', flat: 'Stable', unknown: 'Insufficient evidence', reset: 'Insufficient evidence' };
function earlySignals({ items, longOnly }) {
  const out = []; const longs = items.filter((i) => i.f.format === 'long' && i.in_window && i.views > 0);
  const pcts = longs.filter((i) => isNum(i.pct) && i.views >= 20).map((i) => i.pct);
  if (pcts.length >= 3) out.push({ text: `Long videos with measurable viewing (${pcts.length}): viewers watched a median ${r1(median(pcts))}% of the song (range ${r1(Math.min(...pcts))}–${r1(Math.max(...pcts))}%).`, grade: pcts.length >= 8 ? 'Supported' : 'Early signal', n: pcts.length, note: pcts.length >= 8 ? null : 'small sample' });
  const withPaid = longs.filter((i) => isNum(i.pct) && i.views >= 20 && i.paid_known && isNum(i.organic_views));
  const heavy = withPaid.filter((i) => i.organic_views < i.views * 0.5), light = withPaid.filter((i) => i.organic_views >= i.views * 0.5);
  if (!longOnly && heavy.length >= 3 && light.length >= 3) out.push({ text: `Long videos mostly watched through advertising kept a median ${r1(median(heavy.map((i) => i.pct)))}% of the song, versus ${r1(median(light.map((i) => i.pct)))}% for videos mostly found without advertising (${heavy.length} and ${light.length} videos).`, grade: 'Early signal', n: heavy.length + light.length, note: 'association only; it does not prove advertising causes the difference' });
  return out;
}
function linkageNote(rep) { return rep ? `${rep.linked} of ${rep.catalog_videos} catalog videos (${rep.linked_pct}%) are linked to a production package by their exact YouTube video id${rep.conflicts && rep.conflicts.length ? `; ${rep.conflicts.length} claimed by more than one package were left out` : ''}. The rest have no package that names them, so their production choices are unknown.` : null; }

export function buildStrategy({ business, name, featureDoc, catalog, videoRows, window, advertising, advertisingLife = null, catalogStats = null, catalogMeta = null, tags = null, longOnly, card, nowMs }) {
  const base = { business, name, state: 'not_ready', as_of: null };
  if (!featureDoc || !card || card.state !== 'ok') return { ...base, reason: !featureDoc ? 'The production characteristics have not been linked to the published videos yet.' : 'The analytics report for this business is not available.' };
  // Deleted videos never enter a live assessment: when the collector's catalog statistics exist, only videos YouTube still returns count.
  const hasStats = !!(catalogStats && Object.keys(catalogStats).length); const liveCatalog = hasStats ? (catalog || []).filter((v) => v && catalogStats[v.video_id]) : catalog;
  const perf = {}; for (const r of videoRows || []) if (r && r.id) perf[r.id] = { views: r.views, avg_view_pct: r.pct, avd: r.avd, subs: r.subs_gained, minutes: r.minutes, paid_views: isNum(r.paid_views) ? r.paid_views : null };
  const featuresT = overlayTags(featureDoc.videos, tags); const items = joinPerformance({ features: featuresT, perf, catalog: liveCatalog, window, advertising, catalogStats, nowMs });
  const analysis = analyse({ business, items, window, advertising, advertisingLife, longOnly });
  const history = buildHistory({ business, catalog: liveCatalog, catalogStats, catalogMeta, features: featuresT, rows: videoRows, nowMs, longOnly });
  // preliminary tier: a component the strict rule could not judge may carry an EARLY direction from the historical evidence (never replacing an established status)
  if (history.state === 'ok') for (const c of analysis.components) { if (!['insufficient', 'test'].includes(c.status)) continue; const comp = COMPONENTS.find((x) => x.key === c.key); const fs = history.findings.filter((f) => comp.dims.includes(f.dim)); if (!fs.length) continue;
    const better = fs.filter((f) => f.direction === 'better'), weaker = fs.filter((f) => f.direction === 'weaker'); const strong = fs.some((f) => f.p <= 0.05); const st2 = better.length && weaker.length ? 'test' : !strong ? 'test' : better.length ? 'working' : (weaker.some((f) => f.ratio <= 0.5) ? 'not_working' : 'improve');   // an early read is only called Working / Not working when it is unlikely to be chance (p ≤ 0.05); otherwise it says Needs testing
    c.prelim = { status: st2, text: findingText(fs.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))[0]), caveats: [...new Set(fs.flatMap((f) => f.caveats))] }; }
  const d = card.diagnosis && card.diagnosis.state === 'ok' ? card.diagnosis : null;
  const working = [], notWorking = [];
  // Long-only business: historical Shorts never appear in the assessment (they would distort a Long-only reading and Shorts are not recommended).
  const plain = (t) => (longOnly ? String(t).replace(/,? ?against about [\d,]+ for the historical Shorts/g, '').replace(/\s*\([^()]*\bShorts?\b[^()]*\)/g, '') : t);
  for (const c of analysis.components) { if (c.status === 'working') working.push({ text: `${c.label}: ${c.why}`, grade: 'Supported', source: 'content comparison' }); if (c.status === 'not_working' || c.status === 'improve') notWorking.push({ text: `${c.label}: ${c.why}`, grade: 'Supported', source: 'content comparison' }); }
  if (d) for (const c of d.categories) {
    const first = c.headline || (c.confirmed && c.confirmed[0]) || null; if (!first) continue;
    if (c.status === 'problem_observed') notWorking.push({ text: plain(first), grade: c.supported ? 'Supported' : 'Observed', source: 'diagnosis' });
  }
  const k = card.kpis || {}; if (k.organic && k.organic.comparable && isNum(k.organic.delta_pct) && k.organic.delta_pct >= 15) working.push({ text: `Organic views rose ${Math.round(k.organic.delta_pct)}% against the previous 28 days.`, grade: 'Confirmed', source: 'analytics' });
  if (card.split && card.split.verifiable && isNum(card.split.paid_share_pct) && card.split.paid_share_pct >= 50 && !notWorking.some((x) => /dvertising/.test(x.text))) notWorking.push({ text: `${Math.round(card.split.paid_share_pct)}% of the last 28 days' views came from advertising, so organic reach is not carrying the channel.`, grade: 'Confirmed', source: 'analytics' });
  if (k.subscribers && isNum(k.subscribers.per_1000_organic) && isNum(k.subscribers.prev_per_1000_organic) && k.subscribers.prev_per_1000_organic > 0 && k.subscribers.per_1000_organic >= k.subscribers.prev_per_1000_organic * 1.15 && (k.organic ? k.organic.value >= 500 : false)) working.push({ text: `Subscriber conversion improved: ${k.subscribers.per_1000_organic} new subscribers per 1,000 organic views (previous ${k.subscribers.prev_per_1000_organic}).`, grade: 'Confirmed', source: 'analytics' });
  const early = earlySignals({ items, longOnly });
  const changes = recommendExperiments({ business, name, analysis, items, nowMs, longOnly, history });
  const st = card.status || {}; const prevDone = card.improvements && Array.isArray(card.improvements.items) ? card.improvements.items.filter((x) => x.status === 'completed' && x.outcome).slice(0, 5).map((x) => ({ title: x.problem || x.short || x.id, outcome: x.outcome, lesson: x.lesson || null })) : [];
  const active = card.improvements && Array.isArray(card.improvements.items) ? card.improvements.items.filter((x) => x.status === 'approved' || x.status === 'in_progress').slice(0, 3).map((x) => ({ title: x.problem || x.short || x.id, review_by: x.review_by || null, status: x.status })) : [];
  return {
    ...base, state: 'ok', as_of: featureDoc.at || null,
    status: { code: st.code || 'unknown', word: STATUS_WORDS[st.code] || 'Insufficient evidence', reason: st.reason || null },
    working: working.slice(0, 6), not_working: notWorking.slice(0, 6), early_signals: early,
    components: analysis.components.map((c) => ({ key: c.key, label: c.label, status: c.status, word: STATUS[c.status], why: c.why, short: c.short, capture: c.capture || [], prelim: c.prelim ? { status: c.prelim.status, word: STATUS[c.prelim.status], text: c.prelim.text, caveats: c.prelim.caveats } : null })),
    history: history.state === 'ok' ? { live_videos: history.live_videos, deleted_rows: history.deleted_rows, lifetime_views: history.lifetime_views, linked_live: history.linked_live, excluded_paid: history.excluded_paid, formats: history.formats, findings: history.findings.slice(0, 12).map((f) => ({ ...f, text: findingText(f) })), confounded_count: history.confounded.length, format_findings: history.format_findings, historical_shorts: history.historical_shorts } : { state: history.state, reason: history.reason },
    video_perf: history.state === 'ok' ? history.perf : {},
    changes, previous: { done: prevDone, active }, linkage: { report: featureDoc.report || null, note: history.state === 'ok' ? `${history.linked_live} of ${history.live_videos} videos still on YouTube are linked to a production package by their exact video id (${history.deleted_rows} deleted videos are ignored). The rest have no package that names them, so their production choices are unknown.` : linkageNote(featureDoc.report) },
    evidence: { window, cohorts: analysis.cohorts, paid_limited: analysis.paid_limited, lifetime_stats: !!(catalogStats && Object.keys(catalogStats).length), videos_with_lifetime: items.filter((i) => isNum(i.reach_life)).length, advertising_in_window: isNum(advertising) ? advertising : null, videos_compared: items.filter((i) => i.in_window).length },
    taggable: items.filter((i) => i.f.format === 'long').sort((a, b) => String(b.pub || '').localeCompare(String(a.pub || ''))).slice(0, 8).map((i) => ({ id: i.id, title: i.title || i.id, pub: i.pub ? String(i.pub).slice(0, 10) : null, tagged: !!(tags && tags.videos && tags.videos[i.id]), current: tags && tags.videos && tags.videos[i.id] ? Object.fromEntries(Object.entries(tags.videos[i.id]).filter(([k]) => k !== 'at')) : {} })),
    tag_fields: Object.fromEntries(Object.entries(TAG_FIELDS).map(([k, v]) => [k, { label: v.label, options: v.options || null }])),
    unknown: NOT_CAPTURED.map((x) => x.label), tagged: tags && tags.videos ? Object.keys(tags.videos).length : 0, policy: longOnly ? 'SRV Studio is Long-only: only Long videos are assessed; historical Shorts are not used and Shorts are not recommended.' : null,
  };
}

/* ───────────────────────── 8. the compact CEO card (view model) ───────────────────────── */
// Everything the phone-first homepage card shows, in plain words. The detail (reasons, tables, evidence) stays in the strategy object and the Analytics section.
const CARD_PARTS = [
  { key: 'music', label: 'Music', from: ['music'] }, { key: 'vocals_lyrics', label: 'Vocals and lyrics', from: ['vocals', 'lyrics'] }, { key: 'visuals', label: 'Visualizations', from: ['visuals'] },
  { key: 'thumbs_titles', label: 'Thumbnails and titles', from: ['thumbnails', 'titles'] }, { key: 'publishing', label: 'Publishing strategy', from: ['publishing'] },
];
function combineStatus(list) {
  const st = list.map((c) => c.status); const clear = st.filter((x) => ['working', 'not_working', 'improve'].includes(x));
  if (clear.length === 0) return st.includes('test') ? 'test' : 'insufficient';
  const pos = clear.includes('working'), neg = clear.some((x) => x !== 'working'); if (pos && neg) return 'test';
  return clear.includes('not_working') ? 'not_working' : clear.includes('improve') ? 'improve' : 'working';
}
export const briefLine = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); const cut = s.split(/ \(|; |, so /)[0].replace(/[.;:]+$/, ''); return cut.length > 90 ? cut.slice(0, 89) + '…' : cut; };
const fmtN = (n) => (isNum(n) ? Math.round(n).toLocaleString('en-US') : null);
function arrow(delta) { return !isNum(delta) ? 'none' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'; }

const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
export function findingShort(f) {
  if (f.kind === 'format') return `Early signal: Mix compilations earn about ${f.ratio}× more lifetime views per video than Long songs`;
  const ph = (DIM_PHRASE[f.dim] || ((v) => `${f.dim} ${v}`))(f.value); const fm = f.format === 'long' ? 'Long' : f.format === 'short' ? 'Short' : 'Mix';
  return `Early signal: ${ph} (${fm}) get ${f.ratio >= 1 ? f.ratio + '× more' : Math.round((1 / f.ratio) * 10) / 10 + '× fewer'} views a day`;
}
export function buildCardView({ card, strategy, business, nowMs }) {
  if (!card || card.state !== 'ok') return { state: 'unavailable', reason: card && card.reason ? card.reason : 'No analytics are available for this business yet.' };
  const k = card.kpis || {}, fr = card.freshness || {}; const st = card.status || {}; const code = st.code === 'growing' ? 'growing' : st.code === 'flat' ? 'stable' : st.code === 'declining' ? 'declining' : 'early';
  const word = { growing: 'Growing', stable: 'Stable', declining: 'Declining', early: 'Too early to judge' }[code];
  const comp = k.organic && k.organic.comparable;
  const orgDelta = comp && isNum(k.organic.delta_pct) ? k.organic.delta_pct : null, watch = k.watch_organic || {}, sub = k.subscribers || {};
  const subDiff = comp && isNum(sub.net_28d) && isNum(sub.prev_net_28d) ? sub.net_28d - sub.prev_net_28d : null;   // no comparison across a catalog reset
  const kpis = [
    { key: 'organic', label: 'Organic growth', value: k.organic && isNum(k.organic.value) ? fmtN(k.organic.value) : '—', unit: 'views', trend: arrow(orgDelta), note: orgDelta !== null ? `${orgDelta > 0 ? '+' : ''}${Math.round(orgDelta)}% vs previous 28 days` : 'no comparable earlier period' },
    { key: 'subscribers', label: 'Subscriber growth', value: isNum(sub.net_28d) ? (sub.net_28d > 0 ? '+' : '') + sub.net_28d : '—', unit: 'net', trend: arrow(subDiff), note: subDiff !== null ? `${subDiff > 0 ? '+' : ''}${subDiff} vs previous 28 days` : 'no comparable earlier period' },
    { key: 'watch', label: 'Organic watch time', value: isNum(watch.value) ? fmtN(watch.value) : '—', unit: 'hours', trend: arrow(watch.comparable ? watch.delta_pct : null), note: watch.comparable && isNum(watch.delta_pct) ? `${watch.delta_pct > 0 ? '+' : ''}${Math.round(watch.delta_pct)}% vs previous 28 days` : (isNum(watch.value) ? 'no comparable earlier period' : 'not available') },
  ];
  const view = { state: 'ok', business, status: { code, word }, period: 'last 28 days', kpis, freshness: { data_through: fr.data_through || null, age_days: isNum(fr.age_days) ? fr.age_days : null, stale: !!fr.stale }, link: 'analytics' };
  if (!strategy || strategy.state !== 'ok') { view.assessment = 'pending'; view.working = []; view.not_working = []; view.strategy = []; view.changes = []; view.decision = { needed: false }; return view; }
  view.assessment = 'ok';
  const brief = (arr) => arr.map((x) => briefLine(x.text.replace(/^[A-Za-z ]+: /, (m) => (m.length < 24 ? '' : m)))).filter(Boolean);
  // Only evidence-supported positives appear under "working". An early signal (a small-sample descriptive figure) is never presented as success: it stays in Analytics.
  // Established findings first; preliminary (historical) findings fill the remaining lines, always labelled "Early signal". Never more than two lines per list.
  const hf = (strategy.history && strategy.history.findings) || [], ff = (strategy.history && strategy.history.format_findings) || [];
  const earlyUp = [...ff.filter((x) => x.direction === 'better'), ...hf.filter((x) => x.direction === 'better')].map(findingShort), earlyDown = hf.filter((x) => x.direction === 'weaker').map(findingShort);
  const w = brief(strategy.working); view.working = w.concat(earlyUp).slice(0, 2); if (!view.working.length) view.working = ['Nothing proven yet: too early to name what works.'];
  view.not_working = brief(strategy.not_working).concat(earlyDown).slice(0, 2); if (!view.not_working.length) view.not_working = ['Nothing confirmed as failing yet.'];
  view.early_lines = { working: view.working.filter((t) => /^Early signal/.test(t)).length, not_working: view.not_working.filter((t) => /^Early signal/.test(t)).length };
  view.strategy = CARD_PARTS.map((p) => { const cs = strategy.components.filter((c) => p.from.includes(c.key)); const status = combineStatus(cs); if (['insufficient', 'test'].includes(status)) { const pr = cs.filter((c) => c.prelim); if (pr.length) { const sts = pr.map((c) => c.prelim.status); const st2 = sts.includes('working') && sts.some((x) => x !== 'working') ? 'test' : sts[0]; return { key: p.key, label: p.label, status: st2, word: STATUS[st2], early: true }; } } return { key: p.key, label: p.label, status, word: STATUS[status] }; });
  const imp = (card.improvements && card.improvements.items) || []; const tracked = new Set(imp.filter((x) => !['completed', 'abandoned'].includes(x.status)).map((x) => x.key));
  const canStart = (key) => { const pr = card.plan && Array.isArray(card.plan.proposals) ? card.plan.proposals.find((q) => q.key === key) : null; return !pr || pr.can_start !== false; };
  view.changes = (strategy.changes || []).slice(0, 2).map((r) => ({ id: r.id, verb: r.verb || (r.kind === 'correction' ? 'Fix' : 'Test'), text: r.brief || briefLine(r.change), decide: r.decide || null, kind: r.kind, key: `${r.id}:${business}`, tracked: tracked.has(`${r.id}:${business}`) }));
  view.keep = business === 'srv_studio' ? 'Keep Female Emotional Deep House, Long videos only.' : 'Keep Creative V2 music and artist modes unchanged.';
  // One experiment at a time per business (a clean read): while one is approved or running there is no new decision, only its status.
  const active = imp.find((x) => ['approved', 'in_progress'].includes(x.status) && x.plan && EXPERIMENTS[x.plan.experiment]);
  const pend = imp.find((x) => x.status === 'proposed' && x.approval && x.approval.status === 'pending');
  const open = (strategy.changes || []).find((r) => r.kind === 'experiment' && !tracked.has(`${r.id}:${business}`) && canStart(`${r.id}:${business}`));
  const planOf = (plan, reviewBy) => plan ? { label: plan.label, changes: plan.changes, releases: plan.releases, per_arm: plan.per_arm, executor: plan.executor, unchanged: plan.unchanged, review_by: reviewBy || null } : null;
  if (active) { view.running = { id: active.id, key: active.key, exp: active.plan.experiment, label: active.plan.label, status: active.status, review_by: active.review_by || null, plan: planOf(active.plan, active.review_by) }; view.decision = { needed: false }; }
  else if (pend) view.decision = { needed: true, mode: 'approve_item', id: pend.id, key: pend.key, text: 'Approve ' + (pend.plan && pend.plan.short ? pend.plan.short : briefLine(pend.problem || pend.action || 'the proposed test')).replace(/\.$/, '') + '?', plan: planOf(pend.plan, pend.review_by) };
  else if (open) view.decision = { needed: true, mode: 'approve_new', key: `${open.id}:${business}`, text: 'Approve ' + (open.decide || 'this test') + '?', plan: planOf(open.plan, open.review_by) };
  else view.decision = { needed: false };
  return view;
}

/* ───────────────────────── 9. trackable proposals (use the existing improvement tracking) ───────────────────────── */
const PROP_METRIC = { thumbnail_test: ['content_test_reach', 'Views per day per Long (test releases)'], title_test: ['content_test_reach', 'Views per day per Long (test releases)'], opening_test: ['content_test_pct', 'Average percentage viewed per Long (test releases)'], capture_metadata: ['content_fields_recorded', 'Long videos with the new production fields recorded'] };
export function strategyProposals(strategy, business, nowMs) {
  if (!strategy || strategy.state !== 'ok') return [];
  const dk = (ms) => new Date(ms).toISOString().slice(0, 10);
  return (strategy.changes || []).filter((r) => PROP_METRIC[r.id]).map((r, i) => { const [metric, label] = PROP_METRIC[r.id];
    return { key: `${r.id}:${business}`, business, category: r.id, priority: i, problem: r.why_short || r.why, evidence: [], evidence_status: r.kind === 'correction' ? 'confirmed gap' : 'insufficient evidence', confidence: 'Low',
      action: r.change, short: r.brief || r.change, why: r.why, owner: r.owner || r.department, requires_approval: r.kind === 'experiment', needs: r.needs || undefined,
      baseline: r.baseline ? { metric, value: isNum(r.baseline.value) ? r.baseline.value : null, label, captured_at: dk(nowMs) } : null, target: r.target ? { metric, value: r.target.value, label, rule: r.target.rule || '' } : null,
      review_days: Math.max(1, Math.round((Date.parse(r.review_by) - nowMs) / DAY)), review_by: r.review_by, success: r.success, failure: 'The review date has passed, the sample is adequate and the measure did not beat its baseline.', inconclusive: 'The review date has passed but the sample is too small or the measure improved without reaching the target.',
      measure: { metric, auto: false }, advisory: true, source: 'content_strategy', plan: r.plan || null }; });
}

/* ───────────────────────── 10. production tags (the reliable way to capture what packages do not record) ───────────────────────── */
// Recorded by a person (CEO session) against a video that is already linked to its package; stored in their own derived document and overlaid on the features. Never written to packages.
export const tagsKey = (business) => 'growth_tags_' + business;
export const TAG_FIELDS = Object.freeze({
  opening_visual: { label: 'Visual opening (first 10 seconds)', options: ['avatar_close', 'avatar_wide', 'scene', 'text_card', 'other'] },
  intro_type: { label: 'Musical opening', options: ['instrumental', 'vocal_first', 'hook_first'] },
  visual_motion: { label: 'Visualization', options: ['static', 'slow_motion', 'animated'] },
  vocal_style: { label: 'Vocal style', options: ['soft', 'powerful', 'breathy', 'raspy', 'other'] },
  thumb_variant: { label: 'Thumbnail design id', text: /^[A-Za-z0-9_-]{1,24}$/ },
  genre: { label: 'Music genre', text: /^[A-Za-z0-9 &'-]{2,40}$/ },
});
export function sanitizeTagValues(raw) {
  const out = {}; if (!raw || typeof raw !== 'object') return out;
  for (const [k, spec] of Object.entries(TAG_FIELDS)) { const v = raw[k]; if (typeof v !== 'string') continue; const t = v.trim(); if (!t) continue; if (spec.options ? spec.options.includes(t) : spec.text.test(t)) out[k] = spec.options ? t : t.toLowerCase(); }
  return out;
}
export const emptyTags = (business) => ({ v: 1, business, rev: 0, updated_at: null, videos: {} });
export function sanitizeTags(raw, business) {
  let v; try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
  if (!v || typeof v !== 'object' || v.v !== 1 || v.business !== business || !v.videos || typeof v.videos !== 'object') return null;
  const d = emptyTags(business); d.rev = isNum(v.rev) ? v.rev : 0; d.updated_at = typeof v.updated_at === 'string' ? v.updated_at : null;
  for (const [id, t] of Object.entries(v.videos).slice(0, LIM.maxVideos)) { if (!ID11.test(id) || !t || typeof t !== 'object') continue; const vals = sanitizeTagValues(t); if (Object.keys(vals).length) d.videos[id] = { ...vals, at: typeof t.at === 'string' ? t.at : null }; }
  return d;
}
export function setTags(doc, videoId, values, nowIso) {
  if (!ID11.test(String(videoId))) return { error: 'invalid_video' }; const vals = sanitizeTagValues(values); if (!Object.keys(vals).length) return { error: 'no_valid_fields' };
  const next = { ...doc, rev: doc.rev + 1, updated_at: nowIso, videos: { ...doc.videos, [videoId]: { ...(doc.videos[videoId] || {}), ...vals, at: nowIso } } };
  if (Object.keys(next.videos).length > LIM.maxVideos) return { error: 'too_many' };
  return { doc: next };
}
// features overlay: tags win over anything parsed (a person recorded them); only videos that are already linked to a package are touched.
export function overlayTags(featureVideos, tagsDoc) {
  if (!tagsDoc || !tagsDoc.videos) return featureVideos; const out = { ...featureVideos };
  for (const [id, t] of Object.entries(tagsDoc.videos)) { const x = out[id]; if (!x) continue; const f = { ...x.f }; for (const k of Object.keys(TAG_FIELDS)) if (t[k] !== undefined) f[k === 'visual_motion' ? 'visual_motion' : k] = t[k]; if (t.genre !== undefined) f.genre = t.genre; if (t.visual_motion !== undefined) f.animated = t.visual_motion !== 'static'; out[id] = { ...x, f }; }
  return out;
}

/* ───────────────────────── 11. historical evidence (G10): every live video, preliminary vs established ───────────────────────── */
// "Established" = the strict rule above (adequate groups, no concentration/period/advertising blockers). "Preliminary" = a historical signal that does NOT meet that bar but is
// consistent and unlikely to be chance (≥3 vs ≥3 videos, ≥1.4× or ≤0.7×, a seeded permutation test p ≤ 0.10, most of the group on the same side). Preliminary findings are always labelled
// and always carry their caveat (small sample, period overlap, concentration). Deleted videos (YouTube no longer returns statistics) are excluded; advertising-exposed videos are excluded.
export const PRELIM = Object.freeze({ minGroup: 3, ratioUp: 1.4, ratioDown: 0.7, p: 0.10, share: 0.6, minAgeDays: 14, perms: 2000, mixMinSec: 600, shortMaxSec: 61 });
const lcg = (seed) => { let x = seed >>> 0 || 1; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
function permP(g, o, rnd) { const obs = Math.abs(median(g) - median(o)); const all = g.concat(o); let c = 0; for (let b = 0; b < PRELIM.perms; b++) { for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = all[i]; all[i] = all[j]; all[j] = t; } if (Math.abs(median(all.slice(0, g.length)) - median(all.slice(g.length))) >= obs - 1e-12) c++; } return (c + 1) / (PRELIM.perms + 1); }
const fmtOfDuration = (d) => (!isNum(d) ? null : d <= PRELIM.shortMaxSec ? 'short' : d < PRELIM.mixMinSec ? 'long' : 'mix');
export function liveItems({ catalog, catalogStats, catalogMeta, features, rows, nowMs }) {
  const stats = catalogStats || {}, meta = catalogMeta || {}, rowBy = {}; for (const r of rows || []) if (r && r.id) rowBy[r.id] = r;
  const out = []; let deleted = 0, noStats = 0;
  for (const v of catalog || []) { if (!v || !v.video_id) continue; const st = stats[v.video_id]; if (!st || !isNum(st.v)) { deleted++; continue; }
    const pub = v.published_at ? String(v.published_at) : null; const age = pub ? Math.floor((nowMs - Date.parse(pub)) / DAY) : null;
    const fx = features && features[v.video_id] ? features[v.video_id].f : null; const base = featuresOf({ d: {}, role: 'main', video: v });
    const dur = meta[v.video_id] && isNum(meta[v.video_id].dur) ? meta[v.video_id].dur : null; const format = (fx && fx.format) || fmtOfDuration(dur);
    const f = fx ? { ...fx } : { ...base, format }; if (!f.format) f.format = format;
    const row = rowBy[v.video_id]; const paidW = row && isNum(row.paid_views) ? row.paid_views : null; const exposed = paidW !== null && paidW > 0; const unknown = !!(row && row.views >= 20 && paidW === null);
    out.push({ id: v.video_id, title: v.title || null, pub: pub ? pub.slice(0, 10) : null, age, life: st.v, dur, f, linked: !!fx, exposed, unknown, per_day: age !== null && age >= PRELIM.minAgeDays ? st.v / age : null, pct: row && isNum(row.pct) ? row.pct : null, win_views: row ? row.views : 0, win_paid: paidW }); }
  return { items: out, deleted };
}
function tests(items, dims, format, rnd, confounded) {
  const pool = items.filter((i) => i.f.format === format && isNum(i.per_day) && !i.exposed && !i.unknown); const found = [];
  if (pool.length < PRELIM.minGroup * 2) return found; const all = median(pool.map((i) => i.per_day));
  for (const dim of dims) { const vals = [...new Set(pool.map((i) => i.f[dim]).filter((x) => x !== null && x !== undefined).map(String))]; if (vals.length < 2) continue;
    for (const v of vals) { const g = pool.filter((i) => String(i.f[dim]) === v), o = pool.filter((i) => i.f[dim] !== null && i.f[dim] !== undefined && String(i.f[dim]) !== v); if (g.length < PRELIM.minGroup || o.length < PRELIM.minGroup) continue;
      const mg = median(g.map((i) => i.per_day)), mo = median(o.map((i) => i.per_day)); if (!(mo > 0)) continue; const ratio = mg / mo; if (ratio < PRELIM.ratioUp && ratio > PRELIM.ratioDown) continue;
      const above = g.filter((i) => i.per_day > all).length / g.length; const up = ratio >= PRELIM.ratioUp; if (up ? above < PRELIM.share : (1 - above) < PRELIM.share) continue;
      const p = permP(g.map((i) => i.per_day), o.map((i) => i.per_day), rnd); if (p > PRELIM.p) continue;
      const dg = median(g.map((i) => Date.parse(i.pub || ''))), dO = median(o.map((i) => Date.parse(i.pub || ''))); const gap = isNum(dg) && isNum(dO) ? Math.round(Math.abs(dg - dO) / DAY) : null; const top = Math.max(...g.map((i) => i.per_day)), sum = g.reduce((a, i) => a + i.per_day, 0);
      const ageG = median(g.map((i) => i.age)), ageO = median(o.map((i) => i.age)); const ageGap = isNum(ageG) && isNum(ageO) ? Math.abs(ageG - ageO) : null;
      // Views per day since publish favour younger videos, so a group published in a different period (or of a different age) is NOT reported as a finding: its difference may be timing, not the characteristic.
      if ((gap !== null && gap > LIM.periodDays) || (ageGap !== null && ageGap > LIM.periodDays)) { confounded.push({ dim, value: v, format, ratio: Math.round(ratio * 100) / 100, gap_days: gap, age_gap_days: ageGap === null ? null : Math.round(ageGap) }); continue; }
      const caveats = []; if (g.length < 5 || o.length < 5) caveats.push('small sample'); if (sum > 0 && top / sum > LIM.concentration) caveats.push('one video dominates the group');
      found.push({ dim, value: v, format, direction: up ? 'better' : 'weaker', ratio: Math.round(ratio * 100) / 100, per_day: Math.round(mg * 10) / 10, other_per_day: Math.round(mo * 10) / 10, n: g.length, n_other: o.length, p: Math.round(p * 1000) / 1000, caveats }); } }
  return found;
}
export function buildHistory({ business, catalog, catalogStats, catalogMeta, features, rows, nowMs, longOnly = false }) {
  if (!catalogStats || !Object.keys(catalogStats).length) return { state: 'unavailable', reason: 'Lifetime statistics for the whole catalog have not been collected yet.' };
  const { items, deleted } = liveItems({ catalog, catalogStats, catalogMeta, features, rows, nowMs }); const rnd = lcg(20261127);
  const formats = ['short', 'long', 'mix'].map((fm) => { const a = items.filter((i) => i.f.format === fm); const lv = a.map((i) => i.life); return { format: fm, n: a.length, median_lifetime: a.length ? Math.round(median(lv)) : null, total: lv.reduce((x, y) => x + y, 0) }; });
  const useFormats = longOnly ? ['long'] : ['long', 'short', 'mix']; const dims = [...new Set(COMPONENTS.flatMap((c) => c.dims))];
  const findings = [], confounded = []; for (const fm of useFormats) findings.push(...tests(items, dims, fm, rnd, confounded));
  // format-level read (all live videos with a known format)
  const fmt = formats.reduce((m, x) => ((m[x.format] = x), m), {}); const fFind = [];
  if (!longOnly && fmt.mix && fmt.long && fmt.mix.n >= PRELIM.minGroup - 1 && fmt.long.n >= PRELIM.minGroup && fmt.long.median_lifetime > 0 && fmt.mix.median_lifetime / fmt.long.median_lifetime >= 3) {
    fFind.push({ kind: 'format', ratio: Math.round(fmt.mix.median_lifetime / fmt.long.median_lifetime), text: `Mix compilations earn far more lifetime views per video (median ${fmt.mix.median_lifetime.toLocaleString('en-US')} across ${fmt.mix.n}) than Long songs (${fmt.long.median_lifetime.toLocaleString('en-US')} across ${fmt.long.n})`, caveats: ['small sample (few mixes)', 'mostly older uploads: they are not driving the last 28 days'], direction: 'better' }); }
  const perf = {}; for (const i of items) if (i.linked) perf[i.id] = { per_day: isNum(i.per_day) ? Math.round(i.per_day * 100) / 100 : null, life: i.life, pct: i.pct, pub: i.pub, organic: !i.exposed && !i.unknown, ctr: null };
  const shorts = items.filter((i) => i.f.format === 'short' && isNum(i.per_day) && !i.exposed && !i.unknown);
  return { state: 'ok', live_videos: items.length, deleted_rows: deleted, lifetime_views: items.reduce((a, i) => a + i.life, 0), linked_live: items.filter((i) => i.linked).length, excluded_paid: items.filter((i) => i.exposed || i.unknown).length, formats, findings, confounded, format_findings: fFind, perf,
    historical_shorts: longOnly ? { n: shorts.length, median_per_day: shorts.length ? Math.round(median(shorts.map((i) => i.per_day)) * 10) / 10 : null, note: 'Historical Shorts, shown only for context; they are not used in the Long-only assessment.' } : null };
}
const DIM_PHRASE = { mood: (v) => `${v} songs`, vocal: (v) => `${v} vocals`, genre: (v) => `${v} music`, bpm_band: (v) => `${v} tempo`, sub_mode: (v) => `the theme "${v}"`, hook_structure: (v) => `the hook "${v}"`, visual_kind: (v) => `${v} visuals`, avatar_pool: (v) => `${v} avatars`, thumb_text_band: (v) => (/^short \(13/.test(v) ? 'thumbnail text of 13–25 characters' : /^very/.test(v) ? 'thumbnail text of 12 characters or fewer' : 'thumbnail text over 25 characters'), thumb_emoji: (v) => (v === 'true' ? 'emoji in the thumbnail' : 'no emoji in the thumbnail'), title_bilingual: (v) => (v === 'true' ? 'bilingual titles' : 'single-language titles'), title_emoji: (v) => (v === 'true' ? 'emoji titles' : 'titles without emoji'), title_len_band: (v) => `${v} titles`, weekday: (v) => `${v} releases`, hour_band: (v) => `${v} releases`, vocal_style: (v) => `${v} vocal style`, visual_motion: (v) => `${v} visuals`, opening_visual: (v) => `the ${String(v).replace(/_/g, ' ')} opening`, intro_type: (v) => `the ${String(v).replace(/_/g, ' ')} intro`, thumb_variant: (v) => `thumbnail design ${v}` };
export const findingText = (f) => { if (f.text) return f.text; const ph = (DIM_PHRASE[f.dim] || ((v) => `${f.dim} ${v}`))(f.value); const fm = f.format === 'long' ? 'Long' : f.format === 'short' ? 'Short' : 'Mix'; return `${fm} videos with ${ph} get ${f.ratio >= 1 ? f.ratio + '× more' : Math.round((1 / f.ratio) * 10) / 10 + '× fewer'} views per day (${f.per_day} vs ${f.other_per_day}; ${f.n} vs ${f.n_other} videos)`; };

/* ───────────────────────── 12. experiments as recommendations (G10) ───────────────────────── */
const EXP_BRIEF = { thumbnail_test: 'thumbnail text only (normal vs longer) on the next 6 Longs, everything else unchanged.', title_test: 'title order only (normal vs search phrase first) on the next 6 Longs, everything else unchanged.', opening_test: 'first-10-second visual only (automatic vs a different look) on the next 6 Longs, everything else unchanged.' };
export function recommendExperiments({ business, name, analysis, items, nowMs, longOnly, history }) {
  const recs = []; const dkey = (ms) => new Date(ms).toISOString().slice(0, 10); const review = (days) => dkey(nowMs + days * DAY);
  const perf = history && history.state === 'ok' ? Object.values(history.perf).filter((x) => x.organic && isNum(x.per_day)) : [];
  const longs = items.filter((i) => i.f.format === 'long' && i.in_window && isNum(i.reach)); const pcts = longs.map((i) => i.pct).filter(isNum);
  const baseReach = perf.length >= 3 ? median(perf.map((x) => x.per_day)) : median(longs.map((i) => i.reach)); const baseN = perf.length >= 3 ? perf.length : longs.length; const basePct = median(pcts);
  const fs = history && history.state === 'ok' ? history.findings : [];
  const early = (dims) => { const f = fs.filter((x) => dims.includes(x.dim) && x.format === 'long' || dims.includes(x.dim)).sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))[0]; return f ? 'Early signal: ' + findingText(f) + '.' : null; };
  const WHY = { thumbnail_test: early(['thumb_text_band', 'thumb_emoji']) || 'Thumbnails cannot be judged yet; testing one change alone keeps the result readable.', title_test: early(['title_bilingual', 'title_len_band', 'title_emoji']) || 'Titles cannot be judged yet; testing one change alone keeps the result readable.', opening_test: 'Visuals cannot be separated from music yet, and the first seconds are not recorded today.' };
  EXPERIMENT_ORDER.forEach((k, i) => { const plan = planFor(k, business); const e = EXPERIMENTS[k]; const retention = e.metric === 'retention';
    const base = retention ? basePct : baseReach; if (retention && basePct === null) return;
    recs.push({ id: k, kind: 'experiment', priority: i + 1, verb: 'Test', brief: EXP_BRIEF[k], decide: e.short, department: 'Production (the VA executes through the Production tasks) with Growth & Analytics (measurement)', owner: 'VA through Production tasks + Growth & Analytics',
      change: `${e.label}: change ${e.changes} Run it on the next ${plan.releases} Long releases (${plan.per_arm} per arm). Music, vocals, lyrics and every other variable stay unchanged.`, why: WHY[k], why_short: WHY[k], plan,
      baseline: base !== null ? { metric: retention ? 'average percentage viewed per Long' : 'organic views per day per Long', value: r1(base), n: retention ? pcts.length : baseN } : null,
      target: base !== null ? { metric: retention ? 'average percentage viewed per Long' : 'organic views per day per Long', value: r1(retention ? base + 5 : base * 1.3), rule: retention ? 'arm B at least 5 percentage points above arm A (median, at least 3 measured releases per arm)' : 'arm B at least 30% above arm A (median organic views per day, at least 3 measured releases per arm)' } : null,
      review_by: review(84), success: `Arm B beats arm A on the measure with at least ${plan.min_per_arm} measured releases per arm → retain arm B; arm B at or below arm A → discontinue it.` }); });
  const needs = [...new Set(analysis.components.flatMap((c) => c.capture || []))];
  if (needs.length) recs.push({ id: 'capture_metadata', kind: 'correction', priority: 9, verb: 'Fix', brief: 'start recording the opening, thumbnail and genre of every new Long.', department: 'Engineering (production record) with Production', owner: 'Engineering + Production',
    change: 'Start recording the missing production choices (opening visual, intro, motion, thumbnail variant, genre, vocal style) for every new Long.', why: 'Without these fields music, visuals and thumbnails can never be compared; nothing creative changes.', why_short: 'Without these fields music, visuals and thumbnails can never be compared; nothing creative changes.',
    baseline: { metric: 'Long videos with the new fields recorded', value: 0, n: 0 }, target: { metric: 'Long videos with the new fields recorded', value: 8, rule: 'the next 8 Long releases all carry the fields' }, review_by: review(60), success: 'The next 8 Long releases all carry the new fields.', needs });
  recs.sort((a, b) => a.priority - b.priority); return recs;
}
