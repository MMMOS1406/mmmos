// CEO product correction 2026-11-16 — SRV STUDIO (English): Mix rules (any two or more songs, dynamic length), catalog states and customer-facing brand names. node tests/srv/mix_correction_srv_studio.mjs
import fs from 'node:fs';
import * as E from '../../lib/srvStudioV2Mix.mjs';
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const rd = (f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const OLD = /SRV ?(Farsi|English)|SRVFarsi|SRVEnglish/i;
const t2e = E.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: 200 }, { pkgId: 'b', title: 'B', durationSec: 215 }]);
ok('two songs are valid; runtime = sum − crossfade; any length', E.srv2MixValidate(t2e).ok && t2e.totalSec === 409, t2e.totalLabel);
ok('the order chosen is the order built', E.srv2MixTimeline([{ pkgId: 'c', title: 'C', durationSec: 200 }, { pkgId: 'a', title: 'A', durationSec: 200 }, { pkgId: 'b', title: 'B', durationSec: 200 }]).items.map((x) => x.pkgId).join() === 'c,a,b');
ok('one song is refused; 12 songs are valid (no ceiling)', !E.srv2MixValidate(E.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: 200 }])).ok && E.srv2MixValidate(E.srv2MixTimeline(Array.from({ length: 12 }, (_, i) => ({ pkgId: 'x' + i, title: 'T' + i, durationSec: 210 })))).ok);
const eTl = E.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: 200, youtubeVideoId: 'abcdefghijk' }, { pkgId: 'b', title: 'B', durationSec: 215, youtubeVideoId: 'abcdefghijl' }]);
const eAll = [E.srv2MixTitle('2026-11', eTl), E.srv2MixDescription('2026-11', eTl), E.srv2MixTags(eTl).join(' | '), E.SRV2_MIX_AI_DISCLOSURE].join('\n');
ok('SRV Studio Mix metadata says "SRV Studio" and never "SRV English"/"SRV Farsi"', !OLD.test(eAll) && /SRV Studio/.test(eAll));
const R = rd('public/srv-studio-v2/srv2-render.mjs');
ok('SRV Studio thumbnail painter draws no song title (the title is not read) and keeps only the small SRV STUDIO wordmark', !/srv2CleanTitle\(title\)/.test(R.slice(R.indexOf('export function srv2PaintThumbnail'), R.indexOf('// ═══ Frame-drop monitor'))) && /titleText: null/.test(R));
ok('thumbnail config is YouTube landscape 1280x720 JPEG under 2 MB', /thumb: \{ W: 1280, H: 720, type: 'image\/jpeg'/.test(R) && /maxBytes: 2 \* 1024 \* 1024/.test(R));
ok('the public copy of the Mix library is byte-identical to lib/', rd('lib/srvStudioV2Mix.mjs') === rd('public/srv-studio-v2/lib/srvStudioV2Mix.mjs'));

// ── selections of 2, 3, 5, 8, 12 and 30 songs; ordering; transitions; 500 MB limit ──
const mkTracks = (n, base = 210) => Array.from({ length: n }, (_, i) => ({ pkgId: 'p' + i, title: 'Song ' + i, youtubeVideoId: 'vid' + String(i).padStart(8, '0'), durationSec: base + (i % 5) * 11 }));
for (const n of [2, 3, 5, 8, 12, 30]) {
  const tr = mkTracks(n); const tl = E.srv2MixTimeline(tr); const v = E.srv2MixValidate(tl); const sum = tr.reduce((a, x) => a + x.durationSec, 0);
  ok(`${n} songs: valid; runtime = sum − ${n - 1} × 6 s crossfade (${tl.totalLabel}); order kept; first chapter 0:00; chapters ≥ 10 s apart`, v.ok && Math.abs(tl.totalSec - (sum - (n - 1) * 6)) < 1e-6 && tl.items.map((x) => x.pkgId).join() === tr.map((x) => x.pkgId).join() && tl.items[0].chapterSec === 0 && tl.items.every((x, i) => i === 0 || x.chapterSec - tl.items[i - 1].chapterSec >= 10), v.problems);
  const plan = E.srv2MixBitratePlan(tl.totalSec);
  ok(`${n} songs: the bitrate plan keeps the file inside 500 MB (${Math.round(plan.estimatedBytes / 1048576)} MB at ${Math.round(plan.videoBitsPerSecond / 1000)} kbps video)`, plan.fitsLimit && plan.estimatedBytes <= 500 * 1048576 && plan.videoBitsPerSecond <= 8e6);
}
const rev = mkTracks(5).reverse(); const tlRev = E.srv2MixTimeline(rev);
ok('any order is respected and the chapters follow it (reverse order of 5)', tlRev.items.map((x) => x.pkgId).join() === 'p4,p3,p2,p1,p0' && E.srv2MixValidate(tlRev).ok);
const plan30 = E.srv2MixBitratePlan(30 * 60), plan5 = E.srv2MixBitratePlan(5 * 60);
ok('500 MB: a 30-minute Mix gets about 1.9 Mbps; a 5-minute Mix keeps the Long ceiling of 8 Mbps', Math.abs(plan30.videoBitsPerSecond - 1.92e6) < 0.06e6 && plan5.videoBitsPerSecond === 8e6);
// the longest Mix that still gets a usable (>= 300 kbps) video bitrate inside 500 MB, and the first one refused
let lo = 60, hi = 12 * 3600; while (hi - lo > 1) { const mid = (lo + hi) >> 1; const p = E.srv2MixBitratePlan(mid); (p.fitsLimit && p.videoBitsPerSecond >= 300000) ? (lo = mid) : (hi = mid); }
const edgeOk = E.srv2MixValidate(E.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: lo / 2 + 3 }, { pkgId: 'b', title: 'B', durationSec: lo / 2 + 3 }]));
const edgeBad = E.srv2MixValidate(E.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: (hi + 600) / 2 + 3 }, { pkgId: 'b', title: 'B', durationSec: (hi + 600) / 2 + 3 }]));
ok(`500 MB boundary: a Mix up to about ${Math.floor(lo / 60)} min is accepted; ${Math.floor((hi + 600) / 60)} min is refused with the size reason`, edgeOk.ok && !edgeBad.ok && /500 MB/.test(edgeBad.problems.join()), { lo, hi, edgeBad: edgeBad.problems });
const e5 = E.srv2MixTimeline(mkTracks(5).map((x, i) => ({ ...x, youtubeVideoId: 'abcdefghij' + i })));
ok('title and description follow the real length and count (5 songs): "N Min", the tracklist with every timestamp, every song link, the AI disclosure; no 30-minute wording', new RegExp(Math.round(e5.totalSec / 60) + ' Min').test(E.srv2MixTitle('2026-11', e5)) && e5.items.every((x) => E.srv2MixDescription('2026-11', e5).includes(x.timestamp + ' ' + x.title)) && E.srv2MixDescription('2026-11', e5).includes(E.SRV2_MIX_AI_DISCLOSURE) && /5 emotional deep house songs/.test(E.srv2MixDescription('2026-11', e5)) && !/30-minute/.test(E.srv2MixDescription('2026-11', e5)));
ok('private-first: the upload decision refuses a second Mix for a month and a duplicate key; a valid first upload is allowed (the server forces private, no publishAt — covered by the server suite)', E.srv2MixUploadDecide({ entries: [] }, { mixKey: E.srv2MixKey('2026-11', e5), monthKey: '2026-11' }).ok && !E.srv2MixUploadDecide({ entries: [{ status: 'uploaded', mixKey: E.srv2MixKey('2026-11', e5), monthKey: '2026-11' }] }, { mixKey: E.srv2MixKey('2026-11', e5), monthKey: '2026-11' }).ok);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
