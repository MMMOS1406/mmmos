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

// ── CEO correction 2026-11-17: chapters, no "Monthly Mix" words, snowfall only in the Mix ──
{ const tr = [{ pkgId: 'a', title: 'Passenger Seat Witness', durationSec: 244.5, youtubeVideoId: 'abcdefghijk' }, { pkgId: 'b', title: 'But the photograph lied', durationSec: 205.2, youtubeVideoId: 'abcdefghijl' }, { pkgId: 'c', title: 'You Left Your Jacket', durationSec: 199.9, youtubeVideoId: 'abcdefghijm' }];
  const tl = E.srv2MixTimeline(tr); const d = E.srv2MixDescription('2026-11', tl); const cc = E.srv2MixChapterCheck(d, tl.items);
  ok('chapters come from the built timeline: 0:00 first, each song\'s own timestamp (middle of its crossfade), ascending, ≥ 10 s apart, every line starts with the timestamp', cc.ok && cc.chapters[0].ts === '0:00' && cc.chapters.every((c, i) => c.ts === tl.items[i].timestamp) && d.split('\n').filter((l) => /^\d+:\d\d /.test(l)).length === 3, cc);
  ok('the chapter check catches a wrong first chapter, a wrong or out-of-order time, a missing line and a line that does not start with its timestamp', !E.srv2MixChapterCheck(d.replace('0:00 ', '0:07 '), tl.items).ok && !E.srv2MixChapterCheck(d.replace(tl.items[2].timestamp, tl.items[1].timestamp), tl.items).ok && !E.srv2MixChapterCheck(d.replace(/^\d+:\d\d (You Left.*)$/m, '$1'), tl.items).ok && !E.srv2MixChapterCheck(d.replace(tl.items[1].timestamp, '0:05'), tl.items).ok);
  const rec = (desc) => ({ mixId: E.srv2MixKey('2026-11', tl), monthKey: '2026-11', title: E.srv2MixTitle('2026-11', tl), description: desc, crossfadeSec: 6, totalSec: tl.totalSec, plannedRelease: E.srv2MixMonthlySlot('2026-11'), tracks: tl.items.map((x) => ({ pkgId: x.pkgId, title: x.title, youtubeVideoId: x.youtubeVideoId, audioSource: 'long-video-aac', usedSec: x.durationSec, chapterSec: x.chapterSec })) });
  ok('a Mix record whose description has broken chapters is refused (server and page use the same check); the generated description passes', E.srv2MixRecordCheck(rec(d)).ok && !E.srv2MixRecordCheck(rec(d.replace(tl.items[1].timestamp, '3:59'))).ok); }
{ let canvasLib = null; try { canvasLib = await import('@napi-rs/canvas'); } catch (_) {}
  if (!canvasLib) ok('SKIP real-canvas checks (npm i --no-save @napi-rs/canvas)', true);
  else { const R = await import('../../public/srv-studio-v2/srv2-render.mjs'); const A = await import('../../lib/srvStudioV2Avatars.mjs'); const path = await import('node:path'); const { createCanvas, loadImage, GlobalFonts } = canvasLib; const repo = path.resolve(new URL('../..', import.meta.url).pathname);
    GlobalFonts.registerFromPath(path.join(repo, 'public/srv-studio-v2/fonts/PlayfairDisplay-Variable.ttf'), 'SRV2 Display'); GlobalFonts.registerFromPath(path.join(repo, 'public/srv-studio-v2/fonts/Inter-Variable.ttf'), 'SRV2 Sans'); R.srv2SetCanvasFactory((w, h) => createCanvas(w, h));
    ok('snowfall is a Mix-only layer: Long and Short defaults have snow OFF (unchanged), the Mix preset has it ON', R.SRV2_FX_DEFAULTS.snow === false && R.SRV2_FX_SNOWFALL.snow === true && R.SRV2_FX_STATIC.snow === false && R.srv2NormalizeFx(R.SRV2_FX_DEFAULTS).snow === false && R.srv2NormalizeFx(R.SRV2_FX_SNOWFALL).snow === true);
    const a = A.srv2AvatarById('srv2-fm-06'); const img = await loadImage(path.join(repo, 'public', a.src)); const prep = R.srv2PrepareSource(img, a.crop); const tlL = R.srv2LongTimeline({ duration: 120, chorusStart: null, hook: '', seed: 'x' });
    const mk = (fx, title) => R.srv2CreateScene({ kind: 'long', img, avatar: a, title, hook: '', timeline: tlL, prepared: prep, fx: R.srv2NormalizeFx(fx) });
    const frame = (sc, t) => { const c = createCanvas(1920, 1080); const ctx = c.getContext('2d'); const texts = []; const ft = ctx.fillText.bind(ctx); ctx.fillText = (x, ...r) => { texts.push(String(x)); return ft(x, ...r); }; const t0 = performance.now(); R.srv2DrawFrame(ctx, sc, t, 0.3, 3); return { ctx, texts, ms: performance.now() - t0, d: ctx.getImageData(0, 0, 1920, 1080).data }; };
    const noSnow = mk(R.SRV2_FX_DEFAULTS, ''), snow = mk(R.SRV2_FX_SNOWFALL, ''); const diffs = []; let costMs = 0, nonface = 0, face = 0, texts = [];
    for (const t of [3, 15, 40, 90]) { const x = frame(noSnow, t), y = frame(snow, t); texts = texts.concat(y.texts); costMs += y.ms; const fx = a.focus.fx * 1920, fy = a.focus.fy * 1080; let n = 0, tot = 0, f = 0, fn = 0;
      for (let py = 0; py < 1080; py += 3) for (let px = 0; px < 1920; px += 3) { const i = (py * 1920 + px) * 4; const dd = Math.abs(x.d[i] - y.d[i]) + Math.abs(x.d[i + 1] - y.d[i + 1]) + Math.abs(x.d[i + 2] - y.d[i + 2]); const inFace = Math.hypot(px - fx, (py - fy) * 0.9) < 1080 * 0.12; if (dd > 12) { if (inFace) f++; else n++; } tot++; if (inFace) fn++; }
      diffs.push({ t, changedOutside: n, changedInFace: f }); nonface += n; face += f; }
    ok('snowfall is visible but restrained: some pixels change at every sample time, never more than 2% of the frame, and the artist\'s face area stays clear (under 2% of its pixels change)', diffs.every((d) => d.changedOutside > 80) && nonface / diffs.length / (640 * 360) < 0.02 && face / diffs.length < 0.02 * (Math.PI * (1080 * 0.12) ** 2 / 9), diffs);
    { const all = texts.join(''); ok('no frame draws "Monthly Mix" (or any title) in the Mix scene — only the SRV STUDIO wordmark (drawn letter by letter)', !/monthly|mix/i.test(all) && all.includes('SRV STUDIO'), all.slice(0, 80)); }
    ok('snowfall is cheap and deterministic: under 40 ms per 1080p frame in this environment, and the same time gives the same frame', costMs / 4 < 40 && Buffer.compare(Buffer.from(frame(mk(R.SRV2_FX_SNOWFALL, ''), 40).d), Buffer.from(frame(mk(R.SRV2_FX_SNOWFALL, ''), 40).d)) === 0, costMs / 4); } }
// ── PM final title correction 2026-11-17: the YouTube Mix title no longer says "Monthly Mix" ──
{
  const t2 = E.srv2MixTimeline([{ pkgId: 'a', title: 'Passenger Seat Witness', durationSec: 244 }, { pkgId: 'b', title: 'You Left Your Jacket', durationSec: 197 }]);
  const dec = E.srv2MixTitle('2026-12', t2);
  ok('December 2026 title: exact corrected text (SRV Studio branding, month, year, length, Emotional Deep House kept)', dec === 'SRV Studio Mix \u2014 December 2026 | ' + Math.round(t2.totalSec / 60) + ' Min Emotional Deep House for the Night Drive', dec);
  let bad = [], n = 0;
  for (let mo = 1; mo <= 12; mo++) for (const secs of [150, 400, 1200, 1800, 3600, 7200]) {
    const tl = E.srv2MixTimeline([{ pkgId: 'a', title: 'A', durationSec: secs / 2 + 3 }, { pkgId: 'b', title: 'B', durationSec: secs / 2 + 3 }]);
    const t = E.srv2MixTitle('2026-' + String(mo).padStart(2, '0'), tl); n++;
    if (!t || /monthly/i.test(t) || t.length > 100 || !/^SRV Studio Mix \u2014 [A-Z][a-z]+ 2026/.test(t) || !/Emotional Deep House/.test(t)) bad.push(t);
  }
  ok(`${n} month × length combinations: never "Monthly Mix"/"Monthly", always SRV Studio + month + year + Emotional Deep House, at most 100 characters`, !bad.length, bad.slice(0, 3));
  ok('description, tags and hashtags are unchanged by the title fix (still the tracklist from 0:00, song links, AI disclosure)', /^Tracklist$/m.test(E.srv2MixDescription('2026-12', t2)) && /^0:00 Passenger Seat Witness$/m.test(E.srv2MixDescription('2026-12', t2)) && E.srv2MixDescription('2026-12', t2).includes(E.SRV2_MIX_AI_DISCLOSURE) && E.srv2MixTags(t2).includes('SRV Studio'));
  ok('the monthly slot and one-Mix-per-month rule still work internally (planned release for December, second Mix of the month refused)', typeof E.srv2MixMonthlySlot('2026-12').utcIso === 'string' && !E.srv2MixUploadDecide({ entries: [{ monthKey: '2026-12', status: 'uploaded', mixKey: 'x', kind: 'mix' }] }, { mixKey: 'y', monthKey: '2026-12' }).ok);
  ok('the browser copy of the title generator is identical to the library copy', rd('lib/srvStudioV2Mix.mjs') === rd('public/srv-studio-v2/lib/srvStudioV2Mix.mjs'));
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
