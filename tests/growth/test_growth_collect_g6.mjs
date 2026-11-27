// G6 older-catalog freshness: lifetime views / likes / comments for EVERY catalog video (Data API videos.list part=statistics). SYNTHETIC fake-Google; nothing touches the network or a database.
import * as C from '../../lib/growthCollect.mjs';
import { makeWorld, addDays } from './collect_fixtures.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const NOW = Date.parse('2030-03-15T18:00:00Z'), NOWISO = new Date(NOW).toISOString(), B1 = 'silk_road_voices', END = '2030-03-14', FROM = addDays(END, -27);
const ids = Array.from({ length: 120 }, (_, i) => 'cat' + String(i).padStart(8, '0'));   // 11 characters
const vids = [{ id: 'shortAAAA01', views: 500, avd: 17, pct: 57 }, { id: 'longAAAAA01', views: 76, avd: 90, pct: 39 }];
const run = async (w, extra = {}) => C.runCollection({ business: w.business, steps: C.collectSteps({ to: END }), fetchJson: w.fetchJson, now: () => NOW, catalogIds: ids, ...extra });
const merge = (prev, r) => C.mergeCollection(prev, r, { business: B1, from: FROM, to: END, nowIso: NOWISO });
{ const w = makeWorld(B1, { videos: vids }); const r = await run(w);
  const stepIds = r.steps.filter((s) => /^video_stats:/.test(s.id)); ok('plan: 120 catalog ids → 3 statistics requests of at most 50 ids (Data API, 1 unit each)', stepIds.length === 3 && (w.statsRequests || []).map((x) => x.length).join(',') === '50,50,20', (w.statsRequests || []).map((x) => x.length));
  ok('every request is a GET to videos.list part=statistics (read-only whitelist) and only this channel\'s ids are sent', C.collectorAllowed('https://www.googleapis.com/youtube/v3/videos?part=statistics&id=abc,def&maxResults=2') && !C.collectorAllowed('https://www.googleapis.com/youtube/v3/videos?part=snippet&id=abc&maxResults=1') && !C.collectorAllowed('https://www.googleapis.com/youtube/v3/videos?part=statistics&id=abc&maxResults=1', 'POST') && (w.statsRequests || []).flat().every((x) => ids.includes(x)));
  const d = merge(null, r);
  ok('merge: lifetime stats stored for every catalog id returned, with the collection time', Object.keys(d.catalog_stats).length === 120 && d.catalog_stats[ids[0]].v > 0 && d.catalog_stats[ids[0]].l === 5 && d.catalog_stats[ids[0]].c === 2 && d.catalog_stats[ids[0]].at === NOWISO && d.catalog_stats_at === NOWISO, d.catalog_stats[ids[0]]);
  const back = C.parseDoc(JSON.stringify(d), B1); ok('the stored document round-trips through the sanitizer with its catalog stats', back && Object.keys(back.catalog_stats).length === 120 && back.catalog_stats_at === NOWISO);
  ok('document size stays small (120 videos add well under 20 KB)', JSON.stringify(d.catalog_stats).length < 20000, JSON.stringify(d.catalog_stats).length); }
{ const w = makeWorld(B1, { videos: vids }); w.noLikes = true; w.hiddenStats = [ids[5]]; const r = await run(w); const d = merge(null, r);
  ok('hidden likes/comments stay null (never invented) and an id YouTube did not return is simply absent', d.catalog_stats[ids[0]].l === null && d.catalog_stats[ids[0]].c === null && d.catalog_stats[ids[5]] === undefined && Object.keys(d.catalog_stats).length === 119); }
{ const w = makeWorld(B1, { videos: vids }); const r1 = await run(w); const d1 = merge(null, r1); const w2 = makeWorld(B1, { videos: vids }); w2.behave.stats = { status: 500, json: { error: { message: 'boom' } } }; const r2 = await run(w2); const d2 = merge(d1, r2);
  ok('a failed statistics read keeps the previous values (stored data is never wiped by a failure)', Object.keys(d2.catalog_stats).length === 120 && d2.catalog_stats[ids[0]].at === NOWISO); }
{ const w = makeWorld(B1, { videos: vids }); const r = await C.runCollection({ business: B1, steps: C.collectSteps({ to: END }), fetchJson: w.fetchJson, now: () => NOW });
  ok('with no catalog ids passed nothing extra is requested (the approved collector behaviour is unchanged)', !r.steps.some((s) => /^video_stats:/.test(s.id)) && !(w.statsRequests || []).length); }
{ const w = makeWorld(B1, { videos: vids }); const many = Array.from({ length: 900 }, (_, i) => 'big' + String(i).padStart(8, '0')); const r = await C.runCollection({ business: B1, steps: C.collectSteps({ to: END }), fetchJson: w.fetchJson, now: () => NOW, catalogIds: many });
  ok('bounded: at most 600 ids (12 requests) however large the catalog; budget and read-only rules still apply', (w.statsRequests || []).flat().length <= C.LIMITS.maxCatalogStats && r.requests.data + r.requests.analytics <= C.LIMITS.maxRequestsPerRun, [(w.statsRequests || []).flat().length]); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
