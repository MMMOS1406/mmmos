// SRV Studio V2 — Checkpoint D2 (order SRV-STUDIO-V2-007): cinematic renderer, recorder configuration,
// YouTube metadata, audio timing, painters (real canvas via @napi-rs/canvas), frame monitor, app
// integration and protection of the shared / Farsi / V1 paths, plus ffprobe validation of rendered samples.
// Run: node tests/srv/test_srv_studio_v2_render.mjs   (SRV2_RENDER_DIR=<folder with srv2-sample-*.mp4>)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../../public/srv-studio-v2/srv2-render.mjs';
import * as A from '../../lib/srvStudioV2Avatars.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const H = read('public/index.html');
// db766dd = main before SRV Studio V2 shipped (PR #40): the protected baseline these checks diff against.
const BASE_H = execSync('git show db766dd6ed3c561bdb5ea3577ab4e1bf68c98912:public/index.html', { cwd: repo, maxBuffer: 64 << 20 }).toString('utf8');
const n017 = (s) => s.replace(/_publishFetch\('/g, "fetch('"); // SRV-STUDIO-V2-017: the only allowed change to shared publish functions is fetch( → _publishFetch(
let pass = 0, fail = 0, skip = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const skipped = (n, why) => { skip++; out.push('SKIP ' + n + '  (' + why + ')'); };
const top = (src, name) => { const m = src.match(new RegExp('\\n(async )?function ' + name + '\\(')); if (!m) throw new Error('missing ' + name); const s = m.index + 1; return src.slice(s, src.indexOf('\n}\n', s) + 2); };

// ── 1. Output targets and codec selection ──
{
  const C = R.SRV2_RENDER_CONFIG;
  ok('Config: Long 1920x1080, 30 fps, 8 Mbps', C.long.W === 1920 && C.long.H === 1080 && C.long.fps === 30 && C.long.videoBitsPerSecond === 8e6);
  ok('Config: Short 1080x1920, 30 fps, 6 Mbps, 30 s target, 60 s cap', C.short.W === 1080 && C.short.H === 1920 && C.short.fps === 30 && C.short.videoBitsPerSecond === 6e6 && C.short.targetSec === 30 && C.short.maxSec === 60);
  ok('Config: thumbnail 1280x720 JPEG, under 2 MB; drop warning at 2%', C.thumb.W === 1280 && C.thumb.H === 720 && C.thumb.type === 'image/jpeg' && C.thumb.maxBytes === 2 * 1048576 && C.dropWarnPct === 2);
  ok('Config: Long cap 360 s stays under the 500 MB srv-assets bucket limit at 8 Mbps', (C.long.maxSec * (C.long.videoBitsPerSecond + C.long.audioBitsPerSecond)) / 8 < 500 * 1048576);
  const all = () => true;
  ok('Codec: H.264 MP4 preferred when supported', R.srv2PickMime(all).startsWith('video/mp4;codecs=avc1'));
  ok('Codec: falls back to VP9 WebM when MP4 is unsupported', R.srv2PickMime((m) => m.startsWith('video/webm')) === 'video/webm;codecs=vp9,opus');
  ok('Codec: null when nothing is supported; a throwing probe is tolerated', R.srv2PickMime(() => false) === null && R.srv2PickMime(() => { throw new Error('x'); }) === null);
  const i1 = R.srv2MimeInfo('video/mp4;codecs=avc1.640028,mp4a.40.2'), i2 = R.srv2MimeInfo('video/webm;codecs=vp9,opus');
  ok('Codec: container/extension/codecs derived from the MIME', i1.ext === 'mp4' && i1.video === 'h264' && i1.audio === 'aac' && i2.ext === 'webm' && i2.video === 'vp9' && i2.audio === 'opus');
}

// ── 2. YouTube metadata ──
{
  ok('Title: Long template exact', R.srv2YouTubeTitle('long', 'Neon Nights') === 'Neon Nights | Emotional Deep House | Night Drive | SRV Studio');
  ok('Title: Short template exact', R.srv2YouTubeTitle('short', 'Neon Nights') === 'Neon Nights | Night Drive Deep House | SRV Studio #Shorts');
  ok('Title: emoji wrappers, [TEST], quotes and "| …" suffixes removed from the song title', R.srv2YouTubeTitle('long', '💔 "Neon Nights" 💔 | old suffix') === 'Neon Nights | Emotional Deep House | Night Drive | SRV Studio' && R.srv2CleanTitle('[TEST] 💫 Stay 💫') === 'Stay');
  ok('Title: TEST mode prefixes [TEST]', R.srv2YouTubeTitle('short', 'Stay', { test: true }) === '[TEST] Stay | Night Drive Deep House | SRV Studio #Shorts');
  const long = 'When the City Lights Fade Into the Rearview Mirror Tonight';
  const tl = R.srv2YouTubeTitle('long', long), ts = R.srv2YouTubeTitle('short', long, { test: true });
  ok('Title: over 100 characters → descriptor segments dropped, song title kept whole', tl.length <= 100 && tl.startsWith(long + ' | ') && tl.endsWith('SRV Studio') && ts.length <= 100 && ts.includes(long) && ts.endsWith('#Shorts'), tl + ' / ' + ts);
  const huge = 'A '.repeat(70).trim() + ' End';
  const th = R.srv2YouTubeTitle('long', huge), th2 = R.srv2YouTubeTitle('short', huge, { test: true });
  ok('Title: a title longer than 100 by itself is cut at a word boundary with …, still ≤ 100', th.length <= 100 && th.endsWith('…') && th2.length <= 100 && th2.endsWith('… #Shorts'));
  ok('Title: every generated title ≤ 100 for 200 random titles', Array.from({ length: 200 }, (_, i) => 'Word'.repeat(1 + (i % 30)) + ' ' + i).every((t) => R.srv2YouTubeTitle(i2k(t), t, { test: t.length % 2 === 0 }).length <= 100));
  function i2k(t) { return t.length % 3 ? 'long' : 'short'; }
  const pkg = { title: '💔 Neon Nights 💔', mood: 'Female — Romantic', lyrics: '[Verse]\nUnder neon lights\n[Chorus]\nI find my way back to you\n(ooh)', shortLyrics: 'x', captionYT: 'A late drive and the one you still look for. 🌃 #vibes #love <b>' };
  const mL = R.srv2YouTubeMetadata('long', pkg, {}), mS = R.srv2YouTubeMetadata('short', pkg, { test: true, publishAt: '2026-11-01T18:00:00Z' });
  ok('Hashtags: controlled set — 5 for Long, + #Shorts for Short, mood tag from the task mood', R.srv2Hashtags('long', 'romantic').join(' ') === '#SRVStudio #DeepHouse #NightDrive #EmotionalHouse #RomanticHouse' && R.srv2Hashtags('short', 'hopeful').join(' ') === '#SRVStudio #DeepHouse #NightDrive #EmotionalHouse #HopefulHouse #Shorts');
  const tagsInDesc = (d) => (d.match(/#[\p{L}\p{N}_]+/gu) || []);
  ok('Description: only the controlled hashtags appear (caption hashtags removed)', tagsInDesc(mL.description).join(' ') === R.srv2Hashtags('long', 'romantic').join(' ') && tagsInDesc(mS.description).join(' ') === R.srv2Hashtags('short', 'romantic').join(' '));
  ok('Description: no emoji and no angle brackets', !/[\p{Extended_Pictographic}<>]/u.test(mL.description + mS.description + mL.title + mS.title));
  ok('Description: AI disclosure present and matches the server\'s check (no extra avatar-narration line appended)', mL.description.includes(R.SRV2_AI_DISCLOSURE) && /ai[\s\-]?generated|🤖/i.test(mL.description) && /ai[\s\-]?generated|🤖/i.test(mS.description));
  ok('Description: Long carries lyrics without section tags or notes; Short does not', /Lyrics\nUnder neon lights\nI find my way back to you/.test(mL.description) && !/\[Verse\]|\(ooh\)/.test(mL.description) && !/Lyrics/.test(mS.description));
  ok('Metadata: category 10, private, not made for kids, containsSyntheticMedia true', [mL, mS].every((m) => m.categoryId === '10' && m.privacyStatus === 'private' && m.madeForKids === false && m.containsSyntheticMedia === true));
  ok('Metadata: TEST never schedules; a live package keeps its slot', mS.publishAt === null && R.srv2YouTubeMetadata('long', pkg, { publishAt: '2026-11-01T18:00:00Z' }).publishAt === '2026-11-01T18:00:00Z');
  ok('Tags: ≤ 450 characters, include the clean title, no emoji', mL.tags.join(',').length <= 450 && mL.tags.includes('Neon Nights') && mL.tags.includes('SRV Studio'));
  ok('Hook: [Chorus] first line, else hook field, else first lyric', R.srv2HookLine(pkg) === 'I find my way back to you' && R.srv2HookLine({ hook: 'H 💔', lyrics: '' }) === 'H' && R.srv2HookLine({ lyrics: 'one\ntwo' }) === 'one');
}

// ── 3. Audio analysis (synthetic signals) ──
{
  const sr = 8000; const sig = (sec, f) => { const a = new Float32Array(sr * sec); for (let i = 0; i < a.length; i++) a[i] = f(i / sr); return a; };
  const tone = (t) => Math.sin(2 * Math.PI * 220 * t);
  // 120 s: quiet 0.1 everywhere, loud 0.8 from 50–80 s
  const song = sig(120, (t) => tone(t) * (t >= 50 && t < 80 ? 0.8 : 0.1));
  const a1 = R.srv2AnalyzeAudio(song, sr, { lineCount: 0, windowSec: 30 });
  ok('Audio: chorus window found at the loud section (±1 s)', Math.abs(a1.chorusStart - 50) <= 1, String(a1.chorusStart));
  // Short: silence to 1.0 s, then 4 phrases of 1.5 s separated by 0.6 s gaps
  const ph = [1.0, 3.1, 5.2, 7.3];
  const short = sig(10, (t) => (ph.some((s) => t >= s && t < s + 1.5) ? tone(t) * 0.7 : 0));
  const a2 = R.srv2AnalyzeAudio(short, sr, { lineCount: 4, windowSec: 10, fromStart: true });
  ok('Audio: vocal onset detected (≈ 1.0 s) and 4 ascending line timings near the phrase starts', Math.abs(a2.vocalOnset - 0.8) <= 0.35 && a2.lineTimings.length === 4 && a2.lineTimings.every((t, i) => !i || t > a2.lineTimings[i - 1]) && a2.lineTimings.slice(1).every((t, i) => Math.abs(t - ph[i + 1]) <= 0.5), JSON.stringify(a2));
  const a3 = R.srv2AnalyzeAudio(new Float32Array(sr * 20), sr, { lineCount: 3, windowSec: 12 });
  ok('Audio: silent input falls back to even spacing', a3.method === 'fallback-silent' && a3.lineTimings.join() === '0,4,8');
}

// ── 4. Timelines ──
{
  const t1 = R.srv2LongTimeline({ duration: 230, chorusStart: 61, hook: 'hook line', seed: 'srv2-fm-06|Neon' });
  const t2 = R.srv2LongTimeline({ duration: 230, chorusStart: 61, hook: 'hook line', seed: 'srv2-fm-06|Neon' });
  const S = t1.shots;
  ok('Long: shots cover the whole song contiguously', S[0].start === 0 && Math.abs(S[S.length - 1].end - 230) < 0.01 && S.every((s, i) => !i || Math.abs(s.start - S[i - 1].end) < 0.01));
  ok('Long: shots last 20–28 s (the last may absorb a short tail, < 40 s)', S.slice(0, -1).every((s) => s.end - s.start >= 20 - 1e-6 && s.end - s.start <= 28 + 1e-6) && S[S.length - 1].end - S[S.length - 1].start < 40);
  ok('Long: opens wide; the same framing never repeats back to back; all three framings used', S[0].framing === 'wide' && S.every((s, i) => !i || s.framing !== S[i - 1].framing) && new Set(S.map((s) => s.framing)).size === 3);
  ok('Long: deterministic for the same package', JSON.stringify(t1) === JSON.stringify(t2));
  ok('Long: title card 0–8 s, outro in the last 10 s, 1.5 s cross-dissolves', t1.titleEnd === 8 && t1.outroStart === 220 && t1.xfade === 1.5);
  ok('Long: hook shown for 6 s at the chorus; none inside the title card or outro', t1.hooks.length === 1 && t1.hooks[0].start === 61 && t1.hooks[0].end === 67 && R.srv2LongTimeline({ duration: 60, chorusStart: 55, hook: 'h' }).hooks.length === 0 && R.srv2LongTimeline({ duration: 60, chorusStart: 5, hook: 'h' }).hooks.length === 0);
  const st = R.srv2ShortTimeline({ duration: 30, lines: ['a', 'b', 'c'], lineTimings: [0.5, 4, 9] });
  ok('Short: lines start at their timings, ascending, inside the Short', st.lines.map((l) => l.start).join() === '0.5,4,9' && st.lines.every((l) => l.end > l.start && l.end <= 30));
  const sc = R.srv2ShortTimeline({ duration: 30, lines: ['a', 'b', 'c'], lineTimings: [0.2, 1.05, 3.5] });
  ok('Short: lines closer than 1.8 s are spaced out so each one is readable', sc.lines.map((l) => l.start).join() === '0.2,2,3.8' && sc.lines.every((l, i) => !i || l.start >= sc.lines[i - 1].start + 1.8 - 1e-9));
  const se = R.srv2ShortTimeline({ duration: 30, lines: ['a', 'b', 'c'] });
  ok('Short: without timings, lines are evenly spaced', se.lines.map((l) => l.start).join() === '0,10,20');
  const boxes = R.srv2ShortTextBoxes(), Z = R.SRV2_RENDER_CONFIG.shortSafe;
  ok('Short: every text box sits outside the Shorts safe zones (top 220, bottom 480, right 140)', boxes.every((b) => b.y >= Z.top && b.y + b.h <= 1920 - Z.bottom && b.x + b.w <= 1080 - Z.right && b.x >= 0), JSON.stringify(boxes.map((b) => [b.name, Math.round(b.y), Math.round(b.y + b.h), b.x + b.w])));
}

// ── 5. Painters on a real canvas ──
let canvasLib = null;
try { canvasLib = await import('@napi-rs/canvas'); } catch { /* optional */ }
if (!canvasLib) skipped('Painters (real canvas)', '@napi-rs/canvas not installed: npm i --no-save @napi-rs/canvas');
else {
  const { createCanvas, loadImage, GlobalFonts } = canvasLib;
  GlobalFonts.registerFromPath(path.join(repo, 'public/srv-studio-v2/fonts/PlayfairDisplay-Variable.ttf'), 'SRV2 Display');
  GlobalFonts.registerFromPath(path.join(repo, 'public/srv-studio-v2/fonts/Inter-Variable.ttf'), 'SRV2 Sans');
  R.srv2SetCanvasFactory((w, h) => createCanvas(w, h));
  const neutral = (ctx, w, h) => { const d = ctx.getImageData(0, 0, w, h).data; let bad = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i + 1]) > 2 || Math.abs(d[i + 1] - d[i + 2]) > 2) bad++; return bad / (d.length / 4); };
  const meanIn = (ctx, x, y, w, h) => { const d = ctx.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };
  // grade: a saturated colour test card comes out neutral
  const cc = createCanvas(64, 64); const cx = cc.getContext('2d');
  ['#ff0000', '#00ff00', '#0000ff', '#d9a066'].forEach((c, i) => { cx.fillStyle = c; cx.fillRect(i * 16, 0, 16, 64); });
  const prepC = R.srv2PrepareSource(cc, { x: 0, y: 0, w: 64, h: 64 });
  ok('Grade: a saturated colour card becomes neutral black-and-white (R = G = B)', neutral(prepC.graded.getContext('2d'), 64, 64) === 0);
  const lutDark = R.srv2GradePixels(new Uint8ClampedArray([0, 0, 0, 255]))[0], lutWhite = R.srv2GradePixels(new Uint8ClampedArray([255, 255, 255, 255]))[0];
  ok('Grade: lifted blacks (≈1.5%) and a soft highlight roll-off', lutDark >= 3 && lutDark <= 5 && lutWhite >= 245 && lutWhite <= 250, lutDark + '/' + lutWhite);
  const warm = A.srv2AvatarById('srv2-fm-14'); // carries a warm split-tone in the master
  const wImg = await loadImage(path.join(repo, 'public', warm.src)); const wPrep = R.srv2PrepareSource(wImg, warm.crop);
  ok('Grade: the warm split-tone master (#14) is neutralised', neutral(wPrep.graded.getContext('2d'), wPrep.w, wPrep.h) === 0);
  // thumbnails for every final avatar
  const res = []; let worst = 0, maxBytes = 0, sides = true;
  for (const a of A.SRV_STUDIO_V2_AVATARS) {
    const img = await loadImage(path.join(repo, 'public', a.src)); const prep = R.srv2PrepareSource(img, a.crop);
    const c = createCanvas(1280, 720); const ctx = c.getContext('2d');
    const info = R.srv2PaintThumbnail(ctx, prep, a, { title: 'Neon Nights' });
    worst = Math.max(worst, info.sourceScale); const buf = c.toBuffer('image/jpeg', 90); maxBytes = Math.max(maxBytes, buf.length);
    sides = sides && info.layout === (a.focus.fx >= 0.5 ? 'title-left' : 'title-right');
    res.push(neutral(ctx, 1280, 720));
  }
  ok('Thumbnail: all 20 avatars render 1280x720, JPEG under 2 MB', maxBytes > 0 && maxBytes < 2 * 1048576, (maxBytes / 1024).toFixed(0) + ' KB max');
  ok('Thumbnail: source is downscaled, never enlarged (scale ≤ 1)', worst <= 1, String(worst));
  ok('Thumbnail: face-aware — the title goes on the side away from the face', sides);
  ok('Thumbnail: black-and-white throughout (wordmark and title included)', res.every((r) => r === 0));
  // Long + Short frames
  const a6 = A.srv2AvatarById('srv2-fm-06'); const img6 = await loadImage(path.join(repo, 'public', a6.src)); const p6 = R.srv2PrepareSource(img6, a6.crop);
  const tl = R.srv2LongTimeline({ duration: 120, chorusStart: 40, hook: 'Under neon lights', seed: 'x' });
  const L = R.srv2CreateScene({ kind: 'long', img: img6, avatar: a6, title: 'Neon Nights', timeline: tl, prepared: p6 });
  const lc = createCanvas(1920, 1080); const lx = lc.getContext('2d');
  R.srv2DrawFrame(lx, L, 0, 0, 0); const m0 = meanIn(lx, 0, 0, 1920, 1080);
  R.srv2DrawFrame(lx, L, 30, 0, 900); const m30 = meanIn(lx, 0, 0, 1920, 1080);
  ok('Long frame: starts from black and fades into the picture', m0 < 2 && m30 > 20, m0.toFixed(1) + ' → ' + m30.toFixed(1));
  for (let t = 0; t < 120; t += 0.5) R.srv2DrawFrame(lx, L, t, 0.5, Math.round(t * 30));
  ok('Long frame: neutral black-and-white mid-song', neutral(lx, 1920, 1080) === 0);
  ok('Long frame: source enlargement stays ≤ 1.55 (final masters are below full HD — disclosed)', L.stats.maxUpscale <= 1.55 && L.stats.maxUpscale >= 1.15, L.stats.maxUpscale.toFixed(2));
  R.srv2DrawFrame(lx, L, 30, 0, 900); const quiet = meanIn(lx, 0, 0, 1920, 1080); R.srv2DrawFrame(lx, L, 30, 1, 900); const loud = meanIn(lx, 0, 0, 1920, 1080);
  ok('Audio-reactive: bass lifts the highlights slightly (a few %), never more', loud > quiet && (loud - quiet) / quiet < 0.08, ((loud - quiet) / quiet * 100).toFixed(2) + '%');
  const Lr = R.srv2CreateScene({ kind: 'long', img: img6, avatar: a6, title: 'Neon Nights', timeline: tl, prepared: p6, reactive: false });
  R.srv2DrawFrame(lx, Lr, 30, 0, 900); const q2 = meanIn(lx, 0, 0, 1920, 1080); R.srv2DrawFrame(lx, Lr, 30, 1, 900);
  ok('Audio-reactive: can be switched off (reactive:false)', Math.abs(meanIn(lx, 0, 0, 1920, 1080) - q2) < 1e-9);
  const sTl = R.srv2ShortTimeline({ duration: 30, lines: ['Under neon lights', 'I find my way back to you'] });
  const S = R.srv2CreateScene({ kind: 'short', img: img6, avatar: a6, title: 'Neon Nights', timeline: sTl, prepared: p6 });
  const sc = createCanvas(1080, 1920); const sx = sc.getContext('2d'); R.srv2DrawFrame(sx, S, 5, 0, 150);
  ok('Short frame: 1080x1920, card from the master at ≤ 1.0 (no enlargement), neutral', S.stats.maxUpscale <= 1.0 && neutral(sx, 1080, 1920) === 0, S.stats.maxUpscale.toFixed(2));
  ok('Short frame: nothing drawn in the bottom safe zone except backdrop (no bright text)', meanIn(sx, 0, 1920 - 470, 1080, 460) < 40);
  // configurable logo replaces the wordmark
  const logo = createCanvas(200, 60); const lgx = logo.getContext('2d'); lgx.fillStyle = '#ff0000'; lgx.fillRect(0, 0, 200, 60);
  const Ll = R.srv2CreateScene({ kind: 'long', img: img6, avatar: a6, title: 'Neon Nights', timeline: tl, prepared: p6, logo });
  R.srv2DrawFrame(lx, Ll, 4, 0, 120);
  ok('Branding: a configured logo is drawn in place of the wordmark (configurable, one asset path)', neutral(lx, 1920, 1080) > 0 && R.SRV2_BRAND.logoUrl === null && R.SRV2_BRAND.word === 'SRV STUDIO');
}

// ── 6. Frame monitor and bass follower ──
{
  const m = new R.Srv2FrameMonitor(30); for (let i = 0; i <= 300; i++) m.tick(i / 30, 1);
  const s1 = m.summary(10);
  ok('Monitor: steady 30 fps → 0 dropped, no warning', s1.dropped === 0 && !s1.warn && s1.expected === 300);
  const m2 = new R.Srv2FrameMonitor(30); let t = 0; for (let i = 0; i < 280; i++) { m2.tick(t, 1); t += i % 20 === 19 ? 3 / 30 : 1 / 30; }
  const s2 = m2.summary(t);
  ok('Monitor: stalls are counted and > 2% raises the warning', s2.dropped >= 25 && s2.warn && s2.droppedPct > 2, JSON.stringify(s2));
  const f = R.srv2BassFollower(); const bins = new Uint8Array(1024); let lv = 0; for (let i = 0; i < 10; i++) lv = f(bins, 23.4);
  bins.fill(255, 1, 7); const up = f(bins, 23.4); bins.fill(0); let down = up; for (let i = 0; i < 5; i++) down = f(bins, 23.4);
  ok('Bass follower: 0 in silence, fast attack, slow release, bounded 0..1', lv === 0 && up > 0.4 && up <= 1 && down > 0 && down < up);
}

// ── 7. App integration and protection ──
{
  ok('Protected: shared _srvRenderVideo byte-identical to main', top(H, '_srvRenderVideo') === top(BASE_H, '_srvRenderVideo'));
  const v2fns = ['_srvEnglishV2Build', '_srvEnglishV2Publish', '_srvEnglishV2RenderHtml', '_srvEnglishV2FillMeta', '_srvEnglishV2Renderer'];
  ok('Protected: no V2 function calls _srvRenderVideo', v2fns.every((n) => !/_srvRenderVideo\(/.test(top(H, n))));
  const pub = n017(top(H, '_srvEnglishRunPublish')), pub0 = top(BASE_H, '_srvEnglishRunPublish');
  const pLine = "  if(_srvStudioV2On())return _srvEnglishV2Publish(pkgId,taskId); // SRV Studio V2 publish (flag OFF in production)\n";
  ok('Protected: with V2 off, _srvEnglishRunPublish is byte-identical to main (one early V2 line)', pub.split('\n')[1] + '\n' === pLine && pub.replace(pLine, '') === pub0);
  const farsi = ['_srvFarsiBuildTrigger', '_srvFarsiRunPublish', '_srvChorusSync', '_srvUploadToStorage', 'srvLoadMp3', '_assignPublishSlot', '_srvEnglishApproveVideo'];
  ok('Protected: SRV Farsi build/publish and shared helpers byte-identical to main', farsi.every((n) => n017(top(H, n)) === top(BASE_H, n)), farsi.filter((n) => n017(top(H, n)) !== top(BASE_H, n)).join());
  const imports = H.match(/import\(\s*SRV2_RENDER_MODULE\s*\)/g) || [];
  ok('Lazy load: the module is imported in exactly one place, by dynamic import(), never by a <script> tag', imports.length === 1 && !/<script[^>]+srv2-render/.test(H) && /const SRV2_RENDER_MODULE='\/srv-studio-v2\/srv2-render\.mjs';/.test(H));
  ok('Lazy load: only V2 functions reach the loader', (H.match(/await _srvEnglishV2Renderer\(\)/g) || []).length === 4 && [ '_srvEnglishV2Build', '_srvEnglishV2Publish', '_srvEnglishV2FillMeta', '_srvEnglishV2FillPreview' ].every((n) => /_srvEnglishV2Renderer\(\)/.test(top(H, n))));
  const vb = top(H, '_srvEnglishV2Build');
  ok('Build: uses the saved package fields (title, lyrics per format) and records render stats', /title:pkg\.title\|\|''/.test(vb) && /lyrics:pkg\[used\.lyrics\]/.test(vb) && /pkg\.srvRender=Object\.assign\(\{\},out\.stats/.test(vb) && /_srvSavePackageQueued\(pkg\)/.test(vb));
  ok('Build: uploads video + 1280x720 thumbnail through the existing storage helper, then moves to Approve', /_srvUploadToStorage\(pkgId,new File\(\[out\.blob\]/.test(vb) && /'thumb'\)/.test(vb) && /_srvEnglishV2SetStage\(taskId,'approve'\)/.test(vb));
  ok('Build: a failed package save does not advance to Approve', vb.indexOf("if(ok!==true)") < vb.indexOf("_srvEnglishV2SetStage(taskId,'approve')") && /if\(ok!==true\)\{[^}]*return;\}/.test(vb));
  const vp = top(H, '_srvEnglishV2Publish');
  ok('Publish: metadata from the module (containsSyntheticMedia), upload engine "SRV English", thumbnail engine "SRV Studio"', /R\.srv2YouTubeMetadata\(kind,pkg/.test(vp) && /Object\.assign\(\{videoUrl,engine:'SRV English'\},meta\)/.test(vp) && /engine:'SRV Studio',thumbUrl:pkg\._srvThumbUrl/.test(vp));
  ok('Publish: refuses without a video, stops on upload failure, records the result', /if\(!videoUrl\)/.test(vp) && /if\(!up\|\|up\.ok===false\|\|!vid\)\{[^}]*return;\}/.test(vp) && /const vid=up&&\(up\.youtubeVideoId\|\|up\.videoId\)/.test(vp) && /pkg\.srvPublish=/.test(vp));
  ok('Card: Build/Approve/Done show the V2 panel only when V2 is on', /if\(_v2On&&\(stage==='build'\|\|stage==='approve'\|\|stage==='done'\)\)stageContent=_srvEnglishV2RenderHtml/.test(H));
  { const d = execSync('git diff 2aac4af ff5cc43 -U0 -- api/', { cwd: repo }).toString(); const h = d.split('\n').filter((l) => l.startsWith('@@'));
    ok('Server: the renderer needs no server change; from D2 to D6 the only api/ change is the D4 flag guard inside srvEnglishRegenCaption (E3 has its own scope check)', h.every((l) => /srvEnglishRegenCaption/.test(l)) && !/^-[^-]/m.test(d) && !/^\+\+\+ b\/api\/(?!ops\.js)/m.test(d), h.join(' | ')); }
  ok('Module file is self-contained (no imports, no network hosts)', !/^\s*import\s/m.test(read('public/srv-studio-v2/srv2-render.mjs')) && !/https?:\/\//.test(read('public/srv-studio-v2/srv2-render.mjs')));
}

// ── 8. ffprobe validation of rendered samples ──
{
  const dir = process.env.SRV2_RENDER_DIR || path.join(os.homedir(), 'MMM', 'srv-studio-v2-discovery', 'checkpoint-d2');
  const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'format=duration,bit_rate,format_name:stream=codec_type,codec_name,profile,width,height,avg_frame_rate,bit_rate,nb_read_frames,sample_rate,channels,duration', '-of', 'json', f]).toString());
  let haveProbe = true; try { execFileSync('ffprobe', ['-version']); } catch { haveProbe = false; }
  for (const [kind, cfg] of [['long', R.SRV2_RENDER_CONFIG.long], ['short', R.SRV2_RENDER_CONFIG.short]]) {
    const f = ['mp4', 'webm'].map((e) => path.join(dir, `srv2-sample-${kind}.${e}`)).find((x) => fs.existsSync(x));
    if (!haveProbe || !f) { skipped(`ffprobe ${kind}`, !haveProbe ? 'ffprobe not on PATH' : 'no rendered sample in ' + dir); continue; }
    const j = probe(f); const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
    const [n, d] = v.avg_frame_rate.split('/').map(Number); const fps = n / d; const dur = Number(j.format.duration);
    const vbr = Number(v.bit_rate) || (Number(j.format.bit_rate) - Number(a && a.bit_rate || 0));
    const meta = fs.existsSync(path.join(dir, 'headless-render-result.json')) ? (() => { const s = fs.readFileSync(path.join(dir, 'headless-render-result.json'), 'utf8'); return JSON.parse(s.slice(s.indexOf('{'))); })() : null;
    const exp = meta && meta.results.find((r) => r.job.kind === kind); const expDur = exp ? exp.result.stats.durationSec : null;
    ok(`ffprobe ${kind}: H.264 (MP4) or VP9 (WebM fallback)`, (f.endsWith('.mp4') && v.codec_name === 'h264') || (f.endsWith('.webm') && v.codec_name === 'vp9'), v.codec_name + ' ' + (v.profile || ''));
    ok(`ffprobe ${kind}: ${cfg.W}x${cfg.H}`, v.width === cfg.W && v.height === cfg.H);
    ok(`ffprobe ${kind}: ~30 fps average (29.5–30.5) and frame count within 1% of duration × 30`, fps >= 29.5 && fps <= 30.5 && Math.abs(Number(v.nb_read_frames) - dur * 30) / (dur * 30) < 0.01, fps.toFixed(2) + ' fps, ' + v.nb_read_frames + ' frames');
    ok(`ffprobe ${kind}: video bitrate within ±15% of ${cfg.videoBitsPerSecond / 1e6} Mbps`, Math.abs(vbr - cfg.videoBitsPerSecond) / cfg.videoBitsPerSecond <= 0.15, (vbr / 1e6).toFixed(2) + ' Mbps');
    ok(`ffprobe ${kind}: audio present (AAC or Opus, 48 kHz, stereo)`, !!a && ['aac', 'opus'].includes(a.codec_name) && a.sample_rate === '48000' && a.channels === 2, a && a.codec_name);
    ok(`ffprobe ${kind}: duration within ±0.5 s of the render length`, expDur != null && Math.abs(dur - expDur) <= 0.5, dur.toFixed(2) + ' s vs ' + expDur);
    const tf = path.join(dir, `srv2-sample-${kind}-thumb.jpg`);
    if (fs.existsSync(tf)) { const t = probe(tf).streams[0]; ok(`ffprobe ${kind} thumbnail: 1280x720 JPEG under 2 MB`, t.codec_name === 'mjpeg' && t.width === 1280 && t.height === 720 && fs.statSync(tf).size < 2 * 1048576); }
  }
}

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
process.exit(fail ? 1 : 0);
