// Content strategy intelligence (G5): linkage by exact id only, honest features (unknown stays null), evidence-gated statuses, recommendations, isolation. SYNTHETIC data only.
import * as CS from '../../lib/contentStrategy.mjs';
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
/* ── stored document: business-bound, bounded ── */
{
  const packages = [pkg(1, { youtubeVideoId: id(1), contentFormat: 'long' })]; const d = CS.buildFeatureDoc({ business: 'silk_road_voices', packages, catalog: [cat(1)], nowIso: 'T' });
  ok('feature document: bound to its business, contains only features (no lyrics, prompts or captions)', d.business === 'silk_road_voices' && !/lyrics|sunoPrompt|caption/i.test(JSON.stringify(d.videos)) && CS.sanitizeFeatureDoc(JSON.stringify(d), 'silk_road_voices') && CS.sanitizeFeatureDoc(JSON.stringify(d), 'srv_studio') === null);
  ok('feature document key is per business', CS.contentKey('srv_studio') === 'growth_content_srv_studio');
  const big = CS.buildFeatureDoc({ business: 'silk_road_voices', packages: Array.from({ length: 500 }, (_, i) => pkg(i + 1, { youtubeVideoId: id(i + 1) })), catalog: Array.from({ length: 500 }, (_, i) => cat(i + 1)), nowIso: 'T' });
  ok('feature document is bounded in video count and size', Object.keys(big.videos).length <= CS.LIM.maxVideos && JSON.stringify(big).length < CS.LIM.maxDocBytes, JSON.stringify(big).length);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
