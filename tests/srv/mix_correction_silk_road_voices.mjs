// CEO product correction 2026-11-16 — SILK ROAD VOICES (SRV Farsi): Mix catalog states, any-length Mix rules, customer-facing brand names and the Short artwork. node tests/srv/mix_correction_2026_11_16.mjs
import fs from 'node:fs';
import * as F from '../../lib/srvFarsiMix.mjs';
import * as FS from '../../lib/srvFarsiMixServer.mjs';
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const rd = (f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

// ── Silk Road Voices (Farsi): every song is listed with a state ──
const pk = (id, title, artist, sec, extra = {}) => ({ id, engine: 'SRV Farsi', title, titleFinglish: 'Fing ' + id, artist, mood: (artist ? artist[0].toUpperCase() + artist.slice(1) + ' — ' : '') + 'Romantic', contentType: 'LongScript', contentFormat: 'long', _srvLongVideoUrl: 'https://x/' + id + '.webm', _srvLongDurationSec: sec, _srvYtLongId: 'YT' + String(id).padStart(9, '0'), generatedAt: '2026-11-0' + (1 + (+id % 8)) + 'T00:00:00Z', ...extra });
const pkgs = [pk(1, 'یک', 'female', 230), pk(2, 'دو', 'male', 210), pk(3, 'سه', 'duet', 250),
  pk(4, 'خصوصی', 'female', 230, { srvPublish: { privacyStatus: 'private' } }),
  pk(5, 'بدون مدت', 'female', 0),
  pk(6, 'ساخته نشده', 'female', 0, { _srvLongVideoUrl: null, _srvAudioUrl: null, _srvYtLongId: null }),
  pk(7, 'تست', 'female', 230, { isTest: true }), pk(8, 'کنار', 'female', 230, { srvTaskUid: 'set-aside:z' }),
  pk(9, 'شورت', 'female', 0, { _srvLongVideoUrl: null, contentType: 'Short Video', _srvYtLongId: null }),
  pk(10, 'بی‌هنرمند', '', 230)];
pkgs[9].artist = ''; pkgs[9].mood = '';
const c = F.srvfMixCandidates(pkgs); const by = Object.fromEntries(c.map((x) => [x.pkgId, x]));
ok('catalog: the built Long that was never built (6) is LISTED as "Not built"; Shorts and tests/set-aside are not songs', by['6'] && by['6'].reason === 'not_built' && !by['9'] && by['7'].reason === 'test', c.map((x) => x.pkgId + ':' + x.reason));
ok('state mapping: ready / private / source audio unavailable / not built / detail missing', F.srvfCatalogState(by['1']) === 'ready' && F.srvfCatalogState(by['4']) === 'private' && F.srvfCatalogState(by['5']) === 'source_unavailable' && F.srvfCatalogState(by['6']) === 'not_built' && F.srvfCatalogState(by['10']) === 'needs_info', c.map((x) => x.pkgId + ':' + F.srvfCatalogState(x)));
ok('state mapping covers server-side reasons: source required / unreachable audio = source unavailable; not public on YouTube / other channel / not found = private', ['not_in_mmmos', 'source_required', 'media_unreachable', 'source_duration_mismatch'].every((r) => F.srvfCatalogState({ reason: r }) === 'source_unavailable') && ['not_public', 'not_public_on_youtube', 'other_channel', 'not_found_on_youtube'].every((r) => F.srvfCatalogState({ reason: r }) === 'private'));
const cnt = F.srvfCatalogStateCounts(c);
ok('state counts add up to every visible song (test/set-aside are not songs and are not counted)', cnt.total === cnt.ready + cnt.source_unavailable + cnt.private + cnt.not_built + cnt.needs_info && cnt.total === c.filter((x) => x.reason !== 'test' && x.reason !== 'set_aside').length, cnt);
ok('a never-built song is NOT counted as a published song in the catalog summary', F.srvfCatalogSummary(c).all.published === c.filter((x) => !['test', 'set_aside', 'not_built'].includes(x.reason) && ['female', 'male', 'duet'].includes(x.artist)).length);
ok('a not-built song can never be selected (not eligible)', by['6'].eligible === false);
const rec = FS.srvfCatalogReconcile({ uploads: [{ id: by['1'].youtubeVideoId, channelId: 'CH', privacyStatus: 'public', durationSec: 230, title: 'x' }], discovery: { complete: true }, packages: pkgs, channelId: 'CH' });
ok('server reconcile keeps the not-built song visible (never dropped) and does not treat it as published or an artist gap', rec.songs.some((x) => x.pkgId === '6' && x.reason === 'not_built') && rec.mmmos.notBuilt === 1 && !rec.artistGaps.some((g) => g.pkgId === '6'), rec.mmmos);

// ── Mix rules: any selection of two or more songs, dynamic length ──
const song = (i, sec) => ({ pkgId: 'p' + i, title: 'آهنگ ' + i, finglish: 'Song ' + i, artist: ['female', 'male', 'duet'][i % 3], mood: 'romantic', durationSec: sec, finglishConfirmed: true });
const two = [song(1, 200), song(2, 215)]; const tl2 = F.srvfMixTimeline(two); const v2 = F.srvfMixValidate(tl2, { category: 'all', mood: 'romantic', songs: two.map((s) => ({ ...s })) });
ok('Farsi: two songs (7:29) are a valid Mix — no minimum length', tl2.totalSec === 200 + 215 - 6 && v2.ok, v2);
const many = Array.from({ length: 40 }, (_, i) => song(i, 210)); const tlM = F.srvfMixTimeline(many);
ok('Farsi: 40 songs are valid (no song-count ceiling); the runtime is exactly the sum minus the crossfades', F.srvfMixValidate(tlM, { category: 'all', mood: 'romantic', songs: many }).ok && Math.abs(tlM.totalSec - (40 * 210 - 39 * 6)) < 0.01, tlM.totalLabel);
ok('Farsi: one song is refused', !F.srvfMixValidate(F.srvfMixTimeline([song(1, 200)]), { category: 'all', mood: 'romantic', songs: [song(1, 200)] }).ok);
const reorder = [song(3, 220), song(1, 200), song(2, 215)]; const tlR = F.srvfMixTimeline(reorder);
ok('Farsi: the chosen ORDER is kept in the timeline and tracklist (chapters ascend in the order picked)', tlR.items.map((x) => x.pkgId).join() === 'p3,p1,p2' && tlR.items.every((x, i) => i === 0 || x.chapterSec > tlR.items[i - 1].chapterSec));

// ── customer-facing brand names ──
const OLD = /SRV ?(Farsi|English)|SRVFarsi|SRVEnglish/i;
const tlB = F.srvfMixTimeline(reorder);
const fTitle = F.srvfMixTitle('all', 'romantic'), fDesc = F.srvfMixDescription({ title: fTitle, category: 'all', mood: 'romantic' }, tlB), fTags = F.srvfMixTags({ category: 'all', mood: 'romantic' }, tlB).join(' | ');
ok('Silk Road Voices Mix title, description, hashtags, tags and AI disclosure never say "SRV Farsi"/"SRV English"', !OLD.test(fTitle) && !OLD.test(fDesc) && !OLD.test(fTags) && !OLD.test(F.SRVF_AI_DISCLOSURE) && /Silk Road Voices/.test(fDesc) && /#SilkRoadVoices/.test(fDesc), { fTitle, fTags });
const html = rd('public/index.html');
const shortFn = html.slice(html.indexOf('function _drawFarsiComposedFrame'), html.indexOf('// v2-visual-refinement — skipFade'));
ok('Silk Road Voices Short artwork: no "SRV FARSI" card mark and no lower "SRV FARSI" brand line are drawn (header still says SILK ROAD VOICES)', !/SRV FARSI/.test(shortFn.replace(/\/\/.*$/gm, '')) && /SILK ROAD VOICES/.test(shortFn) && /آهنگ‌های بیشتر در کانال ما/.test(shortFn));
ok('Silk Road Voices Short artwork keeps the approved design pieces: portrait card, Persian title, Latin title, "PERSIAN LOVE SONG"', /_drawFarsiPanel\(cX,cY,cW,cH/.test(shortFn) && /PERSIAN LOVE SONG/.test(shortFn) && /titleFinglish/.test(shortFn));
const ytTitleFn = html.slice(html.indexOf('function _srvFarsiYouTubeTitle'), html.indexOf('function _srvFarsiYouTubeTitle') + 600);
ok('Silk Road Voices Short YouTube title ends "| Silk Road Voices" (not "SRV Farsi"); the Long title is unchanged', /Persian Love Song \| Silk Road Voices/.test(ytTitleFn) && !/Persian Love Song \| SRV Farsi/.test(ytTitleFn) && /Silk Road Voices - \$\{finglish\} \| Persian Deep House/.test(ytTitleFn));
const sceneSrc = rd('public/srv-farsi-mix/scene.mjs').replace(/\/\/.*$/gm, '');
ok('Silk Road Voices Mix video and thumbnail artwork carry no "SRV FARSI" text', !/SRV FARSI/.test(sceneSrc) && /SILK ROAD VOICES/.test(sceneSrc));
ok('internal identifiers are untouched (engine names, database keys, action names)', /engine:'SRV Farsi'|engine === 'SRV Farsi'/.test(html) && /srv_farsi_mix/.test(rd('api/ops.js')) && /srv_studio_v2_mix/.test(rd('api/ops.js')));
ok('the public copy of the Mix library is byte-identical to lib/', rd('lib/srvFarsiMix.mjs') === rd('public/srv-farsi-mix/lib/srvFarsiMix.mjs'));

// ── selections of 2, 3, 5, 8, 12 and 40 songs; ordering; transitions; metadata follows the real count/length ──
const mkF = (n) => Array.from({ length: n }, (_, i) => ({ pkgId: 'p' + i, title: 'آهنگ ' + i, finglish: 'Song ' + i, artist: ['female', 'male', 'duet'][i % 3], mood: 'romantic', durationSec: 200 + (i % 5) * 9, finglishConfirmed: true }));
for (const n of [2, 3, 5, 8, 12, 40]) {
  const tr = mkF(n); const tl = F.srvfMixTimeline(tr); const v = F.srvfMixValidate(tl, { category: 'all', mood: 'romantic', songs: tr }); const sum = tr.reduce((a, x) => a + x.durationSec, 0);
  ok(`${n} songs: valid; runtime = sum − ${n - 1} × 6 s crossfade (${tl.totalLabel}); order kept; switch point = chapter second`, v.ok && Math.abs(tl.totalSec - (sum - (n - 1) * 6)) < 1e-6 && tl.items.map((x) => x.pkgId).join() === tr.map((x) => x.pkgId).join() && tl.items.every((x, i) => i === 0 ? x.chapterSec === 0 : x.chapterSec <= x.switchAtSec && x.switchAtSec < x.chapterSec + 1), v.problems);
  const d = F.srvfMixDescription({ title: F.srvfMixTitle('all', 'romantic'), category: 'all', mood: 'romantic' }, tl);
  ok(`${n} songs: the description lists the ${n} chapters (timestamp, Finglish, Persian) that pass YouTube's chapter rules, with Silk Road Voices wording`, tl.items.every((x) => d.includes(x.timestamp + ' ' + x.finglish + ' — ' + x.title)) && new RegExp(n + ' Persian').test(d) && !/SRV ?(Farsi|English)/i.test(d) && F.srvfChapterCheck(d, tl.items).ok && F.srvfChapterCheck(d, tl.items).chapters.length === n);
}
ok('a Mix above YouTube\'s 12-hour limit is refused with that reason (no other length rule)', (() => { const huge = Array.from({ length: 200 }, (_, i) => ({ ...mkF(1)[0], pkgId: 'h' + i, title: 'آهنگ ' + i, durationSec: 240 })); const tl = F.srvfMixTimeline(huge); const v = F.srvfMixValidate(tl, { category: 'all', mood: 'romantic', songs: huge }); return tl.totalSec < 12 * 3600 ? v.ok : (!v.ok && /12/.test(v.problems.join())); })());

// ── CEO correction 2026-11-17: titles without artist words, chapters, cover crop ──
ok('NO generated title, description or cover wording names the artist category (Female / Male / Duet / All Artists), whichever category is chosen', ['female', 'male', 'duet', 'all'].every((c) => { const t = F.srvfMixTitle(c, 'romantic'); const tlx = F.srvfMixTimeline(mkF(3)); const d = F.srvfMixDescription({ title: t, category: c, mood: 'romantic' }, tlx); return !/\b(Female|Male|Duet|All Artists)\b/i.test(t) && !/\b(female|male|duet) voices\b/i.test(d); }) && F.srvfStripCategoryWords('Top Persian — Female Love Romantic Mix') === 'Top Persian — Love Romantic Mix' && F.srvfStripCategoryWords('Duet: Love Happy Mix') === 'Love Happy Mix');
{ const tr = [{ pkgId: 'a', title: 'هنوز منتظرم', finglish: 'Hanu-z Montazerem', durationSec: 230.5 }, { pkgId: 'b', title: 'عشقِ من', finglish: 'Eshgh-e Man', durationSec: 223 }, { pkgId: 'c', title: 'دیدار تو', finglish: 'Didaar-e To', durationSec: 243 }]; const tl = F.srvfMixTimeline(tr); const d = F.srvfMixDescription({ title: 'x', category: 'female', mood: 'romantic' }, tl); const cc = F.srvfChapterCheck(d, tl.items);
  ok('chapters from the BUILT timeline: 0:00, 3:47, 7:24 (the CEO\'s real video), every line starts with its timestamp followed by the Latin title (left-to-right), then the Persian title', cc.ok && cc.chapters.map((x) => x.ts).join() === '0:00,3:47,7:24' && d.split('\n').filter((l) => /^\d+:\d\d /.test(l)).every((l) => /^\d+:\d\d [A-Za-z]/.test(l)), cc);
  ok('the chapter check catches: first chapter not 0:00, out-of-order, under 10 s, missing line, wrong time', !F.srvfChapterCheck(d.replace('0:00 ', '0:05 '), tl.items).ok && !F.srvfChapterCheck(d.replace('7:24', '3:30'), tl.items).ok && !F.srvfChapterCheck(d.replace('3:47', '0:08'), tl.items).ok && !F.srvfChapterCheck(d.replace(/^7:24.*$/m, ''), tl.items).ok && !F.srvfChapterCheck(d.replace('3:47', '3:48'), tl.items).ok && F.srvfChapterCheck(d.replace(/^7:24.*$/m, ''), null).warnings.length === 1);
  ok('a Mix of two songs is valid but warns that YouTube draws the chapter bar from three timestamps', F.srvfChapterCheck(F.srvfMixDescription({ title: 'x', category: 'all', mood: 'romantic' }, F.srvfMixTimeline(tr.slice(0, 2))), null).warnings.length === 1); }
// published thumbnails: which side holds the portrait
{ const W = 480, H = 270; const mk = (portraitRight, seed) => { const g = new Uint8Array(W * H); let a = seed; const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const onPortrait = portraitRight ? x > W * 0.5 : x < W * 0.5; g[y * W + x] = onPortrait ? Math.floor(70 + 120 * rnd() * (0.4 + 0.6 * Math.abs(Math.sin(x / 9 + y / 13)))) : Math.floor(40 + 30 * (x / W)); }
    for (let k = 0; k < 600; k++) { const x = portraitRight ? Math.floor(rnd() * W * 0.35) : Math.floor(W * 0.62 + rnd() * W * 0.33), y = Math.floor(H * 0.2 + rnd() * H * 0.45); g[y * W + x] = 245; }   // thin bright "title" strokes on the smooth side
    return g; };
  const r1 = F.srvfPortraitSide(mk(true, 7), W, H), r2 = F.srvfPortraitSide(mk(false, 9), W, H);
  ok('portrait side is the textured side, in both layouts (title strokes on the smooth side do not confuse it)', r1.side === 'right' && r2.side === 'left' && r1.ratio > 1.3 && r2.ratio > 1.3, [r1, r2]);
  const cr = F.srvfPortraitCrop(1920, 1080, 'right'), cl = F.srvfPortraitCrop(1920, 1080, 'left');
  ok('the cover is the square from the portrait HALF only: right crop starts at 960 (the title half is excluded), left crop ends at 960; square, inside the image, top-biased', cr.sx === 960 && cr.sw === 960 && cr.sh === 960 && cr.sy >= 0 && cr.sy + cr.sh <= 1080 && cl.sx === 0 && cl.sx + cl.sw === 960 && cl.sy < 120, [cr, cl]); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
