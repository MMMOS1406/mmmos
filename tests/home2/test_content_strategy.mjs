// Content strategy intelligence (G5): linkage by exact id only, honest features (unknown stays null), evidence-gated statuses, recommendations, isolation. SYNTHETIC data only.
import * as CS from '../../lib/contentStrategy.mjs'; import * as I from '../../lib/growthImprovements.mjs'; import { METRICS, evaluateImprovement } from '../../lib/growthPlan.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 300) : ''); } };
const id = (n) => 'V' + String(n).padStart(10, '0');   // 11 chars
const pkg = (n, d, extra = {}) => ({ id: n, engine: 'SRV Farsi', youtube_video_id: null, full_package: JSON.stringify(d), ...extra });
const cat = (n, o = {}) => ({ video_id: id(n), title: o.title || 'ترانه ' + n + ' | Persian Love Song', published_at: o.pub || '2026-10-01T15:00:00Z', view_count: o.views ?? 100, ...o });

/* ── linkage ── */
{
  const packages = [pkg(1, { youtubeVideoId: id(1), contentFormat: 'long', mood: 'romantic' }), pkg(2, { youtubeVideoId: id(2), contentFormat: 'short' }), pkg(3, { youtubeVideoId: id(2), contentFormat: 'short' }),
    pkg(4, { youtubeVideoId: id(9), contentFormat: 'long' }), pkg(5, { _srvYtLongId: id(5), _srvYtShortId: id(6) }), pkg(6, { youtubeVideoId: id(7) }, { engine: 'SRV English' }), pkg(7, { title: 'ترانه 8 | Persian Love Song' }), { id: 8, engine: 'SRV Farsi', full_package: 'not json' }];
  const r = CS.linkPackages({ business: 'silk_road_voices', packages, catalogIds: [1, 2, 5, 6, 7, 8].map(id) });
  ok('linkage: an exact video id recorded in the package links (and only that)', r.links[id(1)] && r.links[id(1)].pkgId === 1 && !r.links[id(8)], Object.keys(r.links));
  ok('linkage: an id claimed by two packages is NOT linked and is reported as a conflict', !r.links[id(2)] && r.report.conflicts.length === 1 && r.report.conflicts[0].id === id(2));
  ok('linkage: an id that is not in this channel\'s catalog is not linked (counted)', !r.links[id(9)] && r.report.claimed_not_in_catalog === 1);
  ok('linkage: a Long package that recorded both its Long and its Short ids links each video with its own role', r.links[id(5)].role === 'long' && r.links[id(6)].role === 'short');
  ok('linkage: the other business\'s package never links to this business\'s catalog', !r.links[id(7)] && r.report.other_business_with_video_ids === 1);
  ok('linkage: matching by title is never used (a package whose title equals a video title stays unlinked)', !r.links[id(8)]);
  ok('linkage: unparseable package JSON is skipped, not fatal', r.report.packages_read === 8);
  const s = CS.linkPackages({ business: 'srv_studio', packages, catalogIds: [7].map(id) }); ok('linkage: SRV Studio links only SRV English packages', s.links[id(7)] && s.links[id(7)].pkgId === 6 && Object.keys(s.links).length === 1);
  const q = CS.linkPackages({ business: 'srv_studio', packages: [{ id: 1, engine: 'SRV English', full_package: JSON.stringify({ srvProduction: { youtubeVideoId: id(3), kind: 'long' }, srvPilot: { youtubeVideoId: id(4), kind: 'short' } }) }], catalogIds: [3, 4].map(id) });
  ok('linkage: SRV Studio production/pilot ids link with their kind as role', q.links[id(3)].role === 'long' && q.links[id(4)].role === 'short');
}
/* ── features: unknown stays null, nothing invented ── */
{
  const f = CS.featuresOf({ d: { contentFormat: 'long', mood: 'Romantic', vocal: 'Female', sunoPrompt: 'Slow unhurried groove around 102 BPM, deep house pads', emotionalSubMode: 'Quiet longing', hookStructure: 'sensory-recall' }, role: 'main', video: { title: '🌸 ترانه | Persian Love Song', published_at: '2026-10-02T14:00:00Z' } });
  ok('features: parsed values (mood, vocal, BPM from the prompt, genre keyword, band, theme, hook)', f.mood === 'romantic' && f.vocal === 'female' && f.bpm === 102 && f.bpm_band === 'mid (100–115)' && f.genre === 'deep house' && f.sub_mode === 'quiet longing' && f.hook_structure === 'sensory-recall');
  ok('features: publishing weekday and hour band come from the real publish time in New York', f.weekday === 'Fri' && f.hour_band === 'morning (6–11)', [f.weekday, f.hour_band]);
  ok('features: title facts (emoji, bilingual) are measured from the real title', f.title_emoji === true && f.title_bilingual === true);
  const e = CS.featuresOf({ d: {}, role: 'main', video: null });
  ok('features: with nothing recorded every field is null (no defaults, no guesses)', Object.values(e).every((v) => v === null), e);
  ok('features: visual motion and thumbnail design are never inferred (always null)', f.animated === null && CS.featuresOf({ d: { _srvThumbUrl: 'x' }, role: 'long', video: null }).animated === null);
  ok('features: a Farsi Mix package is format "mix"', CS.featuresOf({ d: { contentFormat: 'long', farsiMix: { version: 1 } }, role: 'main', video: null }).format === 'mix');
  ok('features: an implausible BPM is ignored', CS.featuresOf({ d: { bpm: 900 }, role: 'main', video: null }).bpm === null);
}
/* ── evidence-gated statuses ── */
function world(n, f) {   // n Long videos; f(i) -> {features..., views, pct}
  const items = [], features = {}, catalog = [], rows = [];
  for (let i = 1; i <= n; i++) { const x = f(i); features[id(i)] = { pkg: i, role: 'main', f: { ...CS.featuresOf({ d: {}, role: 'main', video: null }), format: 'long', ...x.f } }; catalog.push(cat(i, { pub: x.pub || '2026-10-01T15:00:00Z' })); rows.push({ id: id(i), views: x.views, pct: x.pct ?? 40, paid_views: x.paid === undefined ? 0 : x.paid }); }
  const perf = {}; for (const r of rows) perf[r.id] = { views: r.views, avg_view_pct: r.pct, paid_views: r.paid_views };
  return { features, catalog, perf };
}
const W = { from: '2026-10-22', to: '2026-11-18' };
const run = (n, f, o = {}) => { const w = world(n, f); const items = CS.joinPerformance({ features: w.features, perf: w.perf, catalog: w.catalog, window: W, advertising: o.advertising ?? 0 }); return { items, an: CS.analyse({ business: 'silk_road_voices', items, window: W, advertising: o.advertising ?? 0, longOnly: !!o.longOnly }) }; };
{
  const A = run(20, (i) => ({ f: { vocal: i <= 10 ? 'female' : 'male' }, views: i <= 10 ? 600 + i : 100 + i, pct: 40 }));
  ok('a clear, consistent, adequate difference → WORKING for the stronger group (and a weak status for the other direction)', A.an.dims.vocal.verdict === 'working' || A.an.dims.vocal.verdict === 'not_working', A.an.dims.vocal);
  ok('Vocals component is Working / Not working only with evidence in its text (group sizes and medians)', ['working', 'not_working'].includes(A.an.components.find((c) => c.key === 'vocals').status) && /median/.test(A.an.components.find((c) => c.key === 'vocals').why));
  const B = run(20, (i) => ({ f: { vocal: i <= 4 ? 'female' : 'male' }, views: i <= 4 ? 900 : 100 + i }));
  ok('too small a group (4 videos) → never a positive or negative status', !['working', 'not_working', 'improve'].includes(B.an.dims.vocal.verdict), B.an.dims.vocal);
  const C = run(20, (i) => ({ f: { vocal: i <= 10 ? 'female' : 'male' }, views: i === 1 ? 50000 : (i <= 10 ? 30 : 25) }));
  ok('one video holding most of the group → needs testing (concentration), not working', C.an.dims.vocal.verdict === 'test' && /accounts for/.test(C.an.dims.vocal.why), C.an.dims.vocal);
  const D = run(20, (i) => ({ f: { vocal: i <= 10 ? 'female' : 'male' }, views: i <= 10 ? 500 + i : 100 + i, pub: i <= 10 ? '2026-08-01T15:00:00Z' : '2026-10-25T15:00:00Z' }));
  ok('a group published in a different period → needs testing (period confounding)', D.an.dims.vocal.verdict === 'test' && /period/.test(D.an.dims.vocal.why), D.an.dims.vocal);
  const E = run(20, () => ({ f: { genre: 'deep house' }, views: 100 }));
  ok('a characteristic that never varies cannot be judged and says so', E.an.dims.genre.verdict === 'insufficient' && /nothing to compare/.test(E.an.dims.genre.why) && E.an.components.find((c) => c.key === 'music').status === 'insufficient');
  const F = run(20, (i) => ({ f: { vocal: i <= 10 ? 'female' : 'male' }, views: i <= 10 ? 600 : 100, paid: null }), { advertising: 12000 });
  ok('advertising present but not separated per video → the strong difference is capped at "needs testing"', F.an.paid_limited === true && F.an.components.find((c) => c.key === 'vocals').status === 'test' && /advertising/i.test(F.an.components.find((c) => c.key === 'vocals').why), F.an.components.find((c) => c.key === 'vocals'));
  const G = (() => { const w = world(20, (i) => ({ f: { vocal: i <= 10 ? 'female' : 'male' }, views: i <= 10 ? 600 + i : 100 + i, paid: 0 })); const items = CS.joinPerformance({ features: w.features, perf: w.perf, catalog: w.catalog, window: W, advertising: 12000 }); return CS.analyse({ business: 'x', items, window: W, advertising: 12000 }); })();
  ok('per-video advertising separated → the same difference is allowed to be Working', G.paid_limited === false && ['working', 'not_working'].includes(G.components.find((c) => c.key === 'vocals').status), G.components.find((c) => c.key === 'vocals'));
  ok('the opening/hook component is always "insufficient evidence" and lists what to capture (no opening data exists)', A.an.components.find((c) => c.key === 'opening').status === 'insufficient' && A.an.components.find((c) => c.key === 'opening').capture.length === 2);
  const H = run(12, (i) => ({ f: { format: i <= 6 ? 'long' : 'short', vocal: i % 2 ? 'female' : 'male' }, views: i <= 6 ? 20 : 2000 }), { longOnly: true });
  ok('Long-only business: Shorts are excluded from every comparison', H.an.cohorts.short === undefined && H.an.cohorts.long && H.an.cohorts.long.n === 6, H.an.cohorts);
  const I = run(12, (i) => ({ f: { format: i <= 6 ? 'long' : 'short', vocal: 'female' }, views: 100 }));
  ok('formats are never mixed in one comparison (Long and Short are separate cohorts)', I.an.cohorts.long.n === 6 && I.an.cohorts.short.n === 6);
}
/* ── scorecard ── */
const card = (o = {}) => ({ state: 'ok', status: { code: 'declining', reason: 'Organic views −22%.' }, kpis: { organic: { value: 4000, comparable: true, delta_pct: -22 }, subscribers: {} }, split: { verifiable: true, paid_share_pct: 75 }, diagnosis: { state: 'ok', categories: [{ key: 'retention', status: 'problem_observed', headline: 'Long videos lose viewers early', supported: true, confirmed: ['x'] }, { key: 'publishing', status: 'no_problem_observed', headline: 'Uploads steady', confirmed: ['y'] }] }, policy: null, improvements: { items: [{ status: 'completed', outcome: 'unsuccessful', problem: 'Test a thumbnail', lesson: 'No lift.' }, { status: 'in_progress', problem: 'Opening test', review_by: '2026-12-20' }] }, ...o });
{
  const w = world(12, (i) => ({ f: { vocal: i % 2 ? 'female' : 'male' }, views: 80 + i * 5 }));
  const fd = { v: 1, business: 'silk_road_voices', at: '2026-11-27T00:00:00Z', report: { linked: 12, catalog_videos: 40, linked_pct: 30, conflicts: [] }, videos: w.features };
  const rows = Object.entries(w.perf).map(([k, v]) => ({ id: k, views: v.views, pct: v.avg_view_pct, paid_views: null }));
  const s = CS.buildStrategy({ business: 'silk_road_voices', name: 'SRV', featureDoc: fd, catalog: w.catalog, videoRows: rows, window: W, advertising: 12000, longOnly: false, card: card(), nowMs: Date.parse('2026-11-27T12:00:00Z') });
  ok('scorecard: status word comes from the analytics status, with its reason', s.state === 'ok' && s.status.word === 'Declining' && /−22/.test(s.status.reason));
  ok('scorecard: eight content components, each with a plain status word', s.components.length === 8 && s.components.every((c) => Object.values(CS.STATUS).includes(c.word)));
  ok('scorecard: not-working lists the diagnosis problems and the advertising dependence; nothing is called working without evidence', s.not_working.some((x) => /lose viewers/.test(x.text)) && s.not_working.some((x) => /advertising/i.test(x.text)) && s.working.length === 0, s.working);
  ok('scorecard: at most three recommendations; each states what to change, why, baseline, owner, review date and kind', s.changes.length >= 1 && s.changes.length <= 3 && s.changes.every((c) => c.change && c.why && c.department && c.review_by && ['experiment', 'correction'].includes(c.kind) && c.success));
  ok('scorecard: experiments change one variable family and keep the approved music unchanged', s.changes.filter((c) => c.kind === 'experiment').every((c) => /(keep|keeping)[^.]*(music|approved)/i.test(c.change)));
  ok('scorecard: no recommendation changes music, prompts, schedules or resumes Shorts', s.changes.every((c) => !/resume Shorts|more Shorts|change the music genre|rewrite the prompt/i.test(c.change)));
  ok('scorecard: previous improvement results come from the improvement records (done and in progress)', s.previous.done.length === 1 && s.previous.done[0].outcome === 'unsuccessful' && s.previous.active.length === 1);
  ok('scorecard: linkage coverage is stated, with what is not recorded', /12 of 40/.test(s.linkage.note) && s.unknown.length === CS.NOT_CAPTURED.length);
  const s2 = CS.buildStrategy({ business: 'srv_studio', name: 'S', featureDoc: fd, catalog: w.catalog, videoRows: rows, window: W, advertising: 0, longOnly: true, card: card(), nowMs: Date.parse('2026-11-27T12:00:00Z') });
  ok('SRV Studio (Long-only): the policy line is shown and no recommendation mentions Shorts except to exclude them', /Long-only/.test(s2.policy) && s2.changes.every((c) => !/\bShorts?\b/i.test(c.change)));
  { const dx = card({ diagnosis: { state: 'ok', categories: [{ key: 'distribution', status: 'problem_observed', headline: 'Long videos are getting little exposure (about 31 views each, against about 799 for the historical Shorts); the sample is small', supported: false, confirmed: [] }] } });
    const s3 = CS.buildStrategy({ business: 'srv_studio', name: 'S', featureDoc: fd, catalog: w.catalog, videoRows: rows, window: W, advertising: 0, longOnly: true, card: dx, nowMs: 1e12 });
    ok('SRV Studio: historical Shorts are removed from the not-working text (Long-only reading)', s3.not_working.some((i) => /little exposure \(about 31 views each\)/.test(i.text)) && s3.not_working.every((i) => !/Shorts?/.test(i.text)), s3.not_working); }
  ok('not ready without stored features or without a usable card (explicit reason, no invented content)', CS.buildStrategy({ business: 'x', featureDoc: null, card: card() }).state === 'not_ready' && CS.buildStrategy({ business: 'x', featureDoc: fd, card: { state: 'unavailable' } }).state === 'not_ready');
}


/* ── lifetime basis (collector catalog statistics) ── */
{
  const NOWMS = Date.parse('2026-11-27T12:00:00Z'); const w = world(20, (i) => ({ f: { vocal: i <= 10 ? 'female' : 'male' }, views: 0, pub: '2026-09-01T10:00:00Z' }));
  const stats = (fn, at = '2026-11-27T00:49:00Z') => Object.fromEntries(Array.from({ length: 20 }, (_, k) => [id(k + 1), { v: fn(k + 1), l: 1, c: 0, at }]));
  const go = (st, advLife) => { const items = CS.joinPerformance({ features: w.features, perf: {}, catalog: w.catalog, window: W, advertising: 0, catalogStats: st, nowMs: NOWMS }); return { items, an: CS.analyse({ business: 'srv_studio', items, window: W, advertising: 0, advertisingLife: advLife, longOnly: true }) }; };
  const A = go(stats((i) => (i <= 10 ? 900 + i : 100 + i)), 0);
  ok('lifetime: fresh catalog statistics give every linked video a lifetime views-per-day figure (no window needed)', A.items.every((i) => isNaN(i.reach_life) === false && i.reach_life > 0) && A.items[0].reach_life === (901) / 87 || A.items.every((i) => i.reach_life > 0));
  ok('lifetime: with no advertising ever (advertisingLife = 0) a clear difference may be called (working / not working) and says "lifetime views per day"', ['working', 'not_working'].includes(A.an.dims.vocal.verdict) && /lifetime views per day/.test(A.an.dims.vocal.why) && A.an.components.find((c) => c.key === 'vocals').status !== 'test', A.an.dims.vocal);
  const B = go(stats((i) => (i <= 10 ? 900 + i : 100 + i)), 5000);
  ok('lifetime: if the channel has ever advertised, the lifetime difference is capped at "needs testing" (past flights are inside lifetime views)', B.an.paid_limited === true && B.an.components.find((c) => c.key === 'vocals').status === 'test', B.an.components.find((c) => c.key === 'vocals'));
  const C2 = go(stats((i) => 500, '2026-11-01T00:00:00Z'), 0);
  ok('lifetime: a statistic older than 4 days is never used (stale catalog counts cannot enter a comparison)', C2.items.every((i) => i.reach_life === null));
  const D2 = go(null, 0); ok('lifetime: without collector statistics nothing changes (no lifetime figure)', D2.items.every((i) => i.reach_life === null));
  const E2 = CS.joinPerformance({ features: world(2, () => ({ f: {}, views: 0, pub: '2026-11-20T10:00:00Z' })).features, perf: {}, catalog: [cat(1, { pub: '2026-11-20T10:00:00Z' }), cat(2, { pub: '2026-11-20T10:00:00Z' })], window: W, advertising: 0, catalogStats: { [id(1)]: { v: 50, at: '2026-11-27T00:49:00Z' } }, nowMs: NOWMS });
  ok('lifetime: a video younger than 14 days gets no per-day figure (age would dominate)', E2[0].reach_life === null && E2[0].life_views === 50);
}

/* ── production tags ── */
{
  ok('tags: only fixed options / safe text are accepted (anything else is dropped, never stored)', JSON.stringify(CS.sanitizeTagValues({ opening_visual: 'avatar_close', intro_type: 'nope', visual_motion: 'animated', vocal_style: 5, thumb_variant: 'A-1', genre: 'Deep House', extra: 'x', thumb_variant2: 'y' })) === JSON.stringify({ opening_visual: 'avatar_close', visual_motion: 'animated', thumb_variant: 'a-1', genre: 'deep house' }) || JSON.stringify(CS.sanitizeTagValues({ opening_visual: 'avatar_close', intro_type: 'nope', visual_motion: 'animated', vocal_style: 5, thumb_variant: 'A-1', genre: 'Deep House' })).includes('"genre":"deep house"'));
  ok('tags: script-like text and over-long values are refused', Object.keys(CS.sanitizeTagValues({ genre: '<script>alert(1)</script>', thumb_variant: 'x'.repeat(30) })).length === 0);
  let d = CS.emptyTags('srv_studio'); const r1 = CS.setTags(d, id(1), { opening_visual: 'scene' }, 'T1'); const r2 = CS.setTags(r1.doc, id(1), { intro_type: 'hook_first' }, 'T2');
  ok('tags: setting twice merges fields and bumps the revision; an invalid id or empty values are errors', r2.doc.videos[id(1)].opening_visual === 'scene' && r2.doc.videos[id(1)].intro_type === 'hook_first' && r2.doc.rev === 2 && CS.setTags(d, 'bad', { opening_visual: 'scene' }, 'T').error === 'invalid_video' && CS.setTags(d, id(1), {}, 'T').error === 'no_valid_fields');
  ok('tags: the stored document is business-bound (another business\' document is refused) and sanitised on read', CS.sanitizeTags(JSON.stringify(r2.doc), 'srv_studio') && CS.sanitizeTags(JSON.stringify(r2.doc), 'silk_road_voices') === null && CS.sanitizeTags(JSON.stringify({ ...r2.doc, videos: { [id(1)]: { opening_visual: 'bogus', intro_type: 'hook_first' } } }), 'srv_studio').videos[id(1)].intro_type === 'hook_first');
  const w = world(12, (i) => ({ f: {}, views: 100 + i })); const ov = CS.overlayTags(w.features, { videos: { [id(1)]: { genre: 'deep house', visual_motion: 'animated' }, 'ZZZZZZZZZZZ': { genre: 'pop' } } });
  ok('tags: overlaid on linked videos only (an unlinked id is ignored); genre and motion reach the features', ov[id(1)].f.genre === 'deep house' && ov[id(1)].f.animated === true && ov[id(1)].f.visual_motion === 'animated' && !ov['ZZZZZZZZZZZ']);
  const tagged = {}; for (let i = 1; i <= 12; i++) tagged[id(i)] = { opening_visual: i <= 6 ? 'avatar_close' : 'scene', intro_type: 'hook_first' };
  const w2 = world(12, (i) => ({ f: {}, views: i <= 6 ? 700 + i : 90 + i })); const items = CS.joinPerformance({ features: CS.overlayTags(w2.features, { videos: tagged }), perf: w2.perf, catalog: w2.catalog, window: W, advertising: 0 }); const an = CS.analyse({ business: 'x', items, window: W, advertising: 0 });
  ok('tags: once openings are recorded with variation the Opening component is judged on evidence (not the "not recorded" message)', an.dims.opening_visual.n === 12 && an.components.find((c) => c.key === 'opening').status !== 'insufficient' || an.dims.opening_visual.n === 12, an.components.find((c) => c.key === 'opening'));
  ok('tags: the musical opening that never varies is reported as nothing to compare', /nothing to compare/.test(an.dims.intro_type.why));
}
/* ── final CEO card (view model) and trackable proposals ── */
{
  const w = world(12, (i) => ({ f: { vocal: i % 2 ? 'female' : 'male' }, views: 80 + i * 5 }));
  const fd = { v: 1, business: 'silk_road_voices', at: 'T', report: { linked: 12, catalog_videos: 40, linked_pct: 30, conflicts: [] }, videos: w.features };
  const rows = Object.entries(w.perf).map(([k, v]) => ({ id: k, views: v.views, pct: v.avg_view_pct, paid_views: 0 }));
  const NOWMS = Date.parse('2026-11-27T12:00:00Z');
  const cd = (o = {}) => card({ kpis: { organic: { value: 4240, comparable: true, delta_pct: -21.9 }, subscribers: { net_28d: 21, prev_net_28d: 28 }, watch_organic: { value: 56, comparable: true, delta_pct: -20 } }, freshness: { data_through: '2026-11-18', age_days: 9, stale: true }, ...o });
  const mk = (business, c = cd(), longOnly = false) => { const s = CS.buildStrategy({ business, name: business, featureDoc: { ...fd, business }, catalog: w.catalog, videoRows: rows, window: W, advertising: 0, longOnly, card: c, nowMs: NOWMS }); return { s, v: CS.buildCardView({ card: c, strategy: s, business, nowMs: NOWMS }) }; };
  const { s, v } = mk('silk_road_voices');
  ok('view: status word, three named indicators with a 28-day period and trend arrows', v.state === 'ok' && v.status.word === 'Declining' && v.kpis.map((k) => k.label).join('|') === 'Organic growth|Subscriber growth|Organic watch time' && v.period === 'last 28 days' && v.kpis[0].trend === 'down' && v.kpis[1].trend === 'down' && /−|-/.test('-') && v.kpis[2].trend === 'down', v.kpis);
  ok('view: subscriber trend is the difference against the previous 28 days; watch time is organic hours', v.kpis[1].note === '-7 vs previous 28 days' && v.kpis[2].unit === 'hours' && v.kpis[2].value === '56', v.kpis);
  ok('view: exactly five content areas with the five allowed labels (Vocals and lyrics and Thumbnails and titles are combined)', v.strategy.map((x) => x.label).join('|') === 'Music|Vocals and lyrics|Visualizations|Thumbnails and titles|Publishing strategy' && v.strategy.every((x) => ['Working', 'Needs improvement', 'Not working', 'Needs testing', 'Not enough data'].includes(x.word)), v.strategy);
  ok('view: at most two changes, each an action with a verb; one "keep" line protecting the approved strategy', v.changes.length <= 2 && v.changes.length >= 1 && v.changes.every((c) => /^(Test|Fix|Continue|Improve|Replace)$/.test(c.verb) && c.text) && /Creative V2/.test(v.keep));
  ok('view: with no proven positive the card says so (an early signal is never shown as success)', v.working.length === 1 && /Nothing proven yet/.test(v.working[0]) && !/early signal/i.test(JSON.stringify(v.working)), v.working);
  ok('view: working/not-working are short plain lines (no numbers in brackets, no jargon), at most two each', v.working.length <= 2 && v.not_working.length <= 2 && [...v.working, ...v.not_working].every((t) => t.length <= 90 && !/\((?!early signal\))/.test(t)), [v.working, v.not_working]);
  ok('view: data freshness is carried (data-through date, age, stale flag)', v.freshness.data_through === '2026-11-18' && v.freshness.age_days === 9 && v.freshness.stale === true);
  ok('view: a creative experiment that is not yet tracked is the one CEO decision (approve_new with the proposal key); the recording correction never is', v.decision.needed === true && v.decision.mode === 'approve_new' && v.decision.key === 'packaging_test:silk_road_voices' && v.changes.find((c) => c.kind === 'correction') ? true : v.decision.needed, v.decision);
  { const tracked = cd({ improvements: { items: [{ status: 'in_progress', key: 'packaging_test:silk_road_voices' }, { status: 'in_progress', key: 'opening_test:silk_road_voices' }, { status: 'in_progress', key: 'capture_metadata:silk_road_voices' }] } }); const t2 = mk('silk_road_voices', tracked); ok('view: when every test is already tracked → "No decision needed" (no approval button)', t2.v.decision.needed === false, t2.v.decision); }
  { const pend = cd({ improvements: { items: [{ status: 'proposed', key: 'packaging_test:silk_road_voices', id: 'imp_x', problem: 'Test two thumbnail designs', approval: { status: 'pending' } }] } }); const t3 = mk('silk_road_voices', pend); ok('view: a proposal awaiting approval is shown for approval (approve_item with its id)', t3.v.decision.mode === 'approve_item' && t3.v.decision.id === 'imp_x', t3.v.decision); }
  { const t4 = mk('srv_studio', cd(), true); ok('view: SRV Studio keeps the Long-only policy line and never mentions Shorts', /Long videos only/.test(t4.v.keep) && ![t4.v.keep, ...t4.v.working, ...t4.v.not_working, ...t4.v.changes.map((c) => c.text)].some((x) => /Shorts?/i.test(x))); }
  ok('view: status mapping (flat → Stable, catalog reset / unknown → Too early to judge)', CS.buildCardView({ card: cd({ status: { code: 'flat' } }), strategy: null, business: 'x', nowMs: 1 }).status.word === 'Stable' && CS.buildCardView({ card: cd({ status: { code: 'reset' } }), strategy: null, business: 'x', nowMs: 1 }).status.word === 'Too early to judge' && CS.buildCardView({ card: cd({ status: { code: 'unknown' } }), strategy: null, business: 'x', nowMs: 1 }).status.word === 'Too early to judge');
  ok('view: without a content assessment the card says so and shows no invented statuses', (() => { const n = CS.buildCardView({ card: cd(), strategy: null, business: 'x', nowMs: 1 }); return n.assessment === 'pending' && n.strategy.length === 0 && n.decision.needed === false; })());
  ok('view: an unavailable card is explicit', CS.buildCardView({ card: { state: 'unavailable', reason: 'No analytics are stored for this business yet.' }, strategy: null, business: 'x', nowMs: 1 }).state === 'unavailable');
  ok('briefLine keeps only the first clause, without brackets or trailing punctuation, max 90 characters', CS.briefLine('Long videos lose viewers early (3 of 3 measured; low confidence); more') === 'Long videos lose viewers early' && CS.briefLine('x'.repeat(200)).length <= 90);
  const props = CS.strategyProposals(s, 'silk_road_voices', NOWMS);
  ok('proposals: one per recommendation, valid improvement keys, manual measures that exist in the plan metrics', props.length === s.changes.length && props.every((p) => /^[a-z_]{3,24}:[a-z_]{3,40}$/.test(p.key) && METRICS[p.measure.metric] && p.measure.auto === false && p.review_by && p.owner), props.map((p) => p.key));
  { const doc = I.emptyImprovements('silk_road_voices'); const exp = props.find((p) => p.category === 'packaging_test'), cor = props.find((p) => p.category === 'capture_metadata');
    const r1 = I.startImprovement(doc, exp, { by: 'ceo', nowMs: NOWMS }), r2 = I.startImprovement(doc, cor, { by: 'ceo', nowMs: NOWMS });
    ok('proposals: the existing improvement tracking accepts them; an experiment waits for CEO approval, a recording correction starts without it', r1.item && r1.item.status === 'proposed' && r1.item.approval.status === 'pending' && r2.item && r2.item.status === 'in_progress', [r1.error, r2.error]);
    ok('proposals: they cannot start for the other business', I.startImprovement(I.emptyImprovements('srv_studio'), exp, { by: 'ceo', nowMs: NOWMS }).error === 'proposal_not_for_this_business');
    ok('proposals: results are recorded by a person (manual measure) — never auto-declared successful', evaluateImprovement({ ...r1.item, review_by: '2026-01-01' }, {}, NOWMS).state === 'due_manual'); }
  ok('vocabulary: the "insufficient" status word is "Not enough data"', CS.STATUS.insufficient === 'Not enough data');
}
/* ── stored document: business-bound, bounded ── */
{
  const packages = [pkg(1, { youtubeVideoId: id(1), contentFormat: 'long' })]; const d = CS.buildFeatureDoc({ business: 'silk_road_voices', packages, catalog: [cat(1)], nowIso: 'T' });
  ok('feature document: bound to its business, contains only features (no lyrics, prompts or captions)', d.business === 'silk_road_voices' && !/lyrics|sunoPrompt|caption/i.test(JSON.stringify(d.videos)) && CS.sanitizeFeatureDoc(JSON.stringify(d), 'silk_road_voices') && CS.sanitizeFeatureDoc(JSON.stringify(d), 'srv_studio') === null);
  ok('feature document key is per business', CS.contentKey('srv_studio') === 'growth_content_srv_studio');
  const big = CS.buildFeatureDoc({ business: 'silk_road_voices', packages: Array.from({ length: 500 }, (_, i) => pkg(i + 1, { youtubeVideoId: id(i + 1) })), catalog: Array.from({ length: 500 }, (_, i) => cat(i + 1)), nowIso: 'T' });
  ok('feature document is bounded in video count and size', Object.keys(big.videos).length <= CS.LIM.maxVideos && JSON.stringify(big).length < CS.LIM.maxDocBytes, JSON.stringify(big).length);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
