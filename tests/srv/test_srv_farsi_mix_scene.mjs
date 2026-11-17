// SRV Farsi Mix — the video scene's TEXT, checked at every song transition. CEO correction 2026-11-17: ONE readable song title at the bottom of the cover (the Persian title large, the Latin title under it, as on the approved Short card),
// the outgoing title is gone before the incoming one fades in (never two titles at once), no artist-category word anywhere, the tracklist on the left stays Finglish, and the highlighted row + caption change exactly at each song's switch second
// (the same second as its YouTube chapter).
// A recording canvas context stands in for a real canvas; node tests/srv/test_srv_farsi_mix_scene.mjs
import * as F from '../../lib/srvFarsiMix.mjs'; import { createMixScene, drawMixThumbnail } from '../../public/srv-farsi-mix/scene.mjs';
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 400) : '')); };
const ARABIC = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
function recorder() { const calls = []; const st = { font: '', globalAlpha: 1, direction: 'ltr', fillStyle: '' }; const noop = () => {};
  const ctx = new Proxy({}, { get(_, k) { if (k === 'fillText') return (text, x, y) => calls.push({ text: String(text), x, y, font: st.font, alpha: st.globalAlpha, dir: st.direction }); if (k === 'measureText') return (t) => ({ width: String(t).length * (parseInt((st.font.match(/(\d+)px/) || [0, 20])[1]) || 20) * 0.58 }); if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop }); if (k === 'canvas') return { width: 1920, height: 1080 }; if (k in st) return st[k]; return noop; }, set(_, k, v) { st[k] = v; return true; } });
  return { ctx, calls }; }
const finglish = ['Didaar-e To', 'Sandali-ye Khali-ye To', 'To Jân-e Mani', 'Masir-e Hamishegi', 'Miz-e Haman, To Nisti', 'Lams-e Avalin Dast', 'Ye Labkhande To', 'Hanu-z Montazerem', 'Eshgh-e Man', 'Delam Hanu Tange To'];
const fa = ['دیدار تو', 'صندلی خالی تو', 'تو جانِ منی', 'مسیر همیشگی', 'میز همان، تو نیستی', 'لمس اولین دست', 'یک لبخندِ تو', 'هنوز منتظرم', 'عشق من', 'دلم هنوز تنگ توئه'];
const songs = finglish.map((f, i) => ({ pkgId: 'p' + i, title: fa[i], finglish: f, artist: 'female', durationSec: 205 + i * 3 }));
const tl = F.srvfMixTimeline(songs); const title = F.srvfMixTitle('all', 'romantic');
const scene = createMixScene({ W: 1920, H: 1080, mix: { titleLatin: title.split('|')[0].trim(), titleFa: title.split('|')[1].trim(), tracks: tl.items, totalSec: tl.totalSec }, background: 'ice', images: { covers: {} }, seed: 1 });
const frame = (t) => { const r = recorder(); scene.draw(r.ctx, t); return r.calls; };
const persian = (calls) => calls.filter((c) => ARABIC.test(c.text));
const f0 = frame(5);

const px = (c) => +(c.font.match(/(\d+)px/) || [0, 0])[1];
const isFaCaption = (c) => /^800 \d+px/.test(c.font) && ARABIC.test(c.text) && c.text !== title.split('|')[1].trim();
ok('header label is TOP PERSIAN (not SRV FARSI), no "SRV Farsi" prefix, the mood heading is drawn', f0.some((c) => c.text === 'TOP PERSIAN') && !f0.some((c) => /SRV FARSI —|^SRV FARSI$/.test(c.text)) && f0.some((c) => c.text === 'LOVE ROMANTIC MIX'), f0.slice(0, 6).map((c) => c.text));
ok('exactly ONE song title is on the cover: the Persian title of song 1 (large), with its Latin title under it, plus the channel name — and the heading subtitle', f0.filter(isFaCaption).length === 1 && f0.filter(isFaCaption)[0].text === fa[0] && f0.filter((c) => c.text === finglish[0].toUpperCase() && /^600 /.test(c.font)).length === 1 && f0.filter((c) => c.text === 'SILK ROAD VOICES').length >= 1, f0.filter(isFaCaption).map((c) => c.text));
const faY = f0.filter(isFaCaption)[0].y, latY = f0.filter((c) => c.text === finglish[0].toUpperCase() && /^600 /.test(c.font))[0].y;
ok('the Persian title sits ABOVE its Latin title, both at the bottom of the cover tile (tile 180-820)', faY < latY && latY > 640 && latY < 820 && faY > 560, { faY, latY });
const rowTexts = (calls, i) => calls.filter((c) => c.text === finglish[i].toUpperCase() && /^italic 700/.test(c.font));
ok('the left tracklist lists every song in Finglish, in order (10 rows), never Persian', finglish.every((f, i) => rowTexts(f0, i).length >= 1) && f0.filter((c) => /^\d\d$/.test(c.text)).length >= 8 && !f0.filter((c) => /^italic 700/.test(c.font)).some((c) => ARABIC.test(c.text)));
// every transition: the previous title is gone, the next one is there, and they are never both visible
const capAlpha = (calls, i) => { const cs = calls.filter((c) => isFaCaption(c) && c.text === fa[i]); return cs.length ? Math.max(...cs.map((c) => c.alpha)) : 0; };
let allGood = true; const bad = [];
for (const it of tl.items.slice(1)) { const i = it.index; const b = frame(it.switchAtSec - 1.2), a = frame(it.switchAtSec + 1.2);
  if (!(capAlpha(b, i - 1) > 0.95 && capAlpha(b, i) < 0.02 && capAlpha(a, i) > 0.95 && capAlpha(a, i - 1) < 0.02)) { allGood = false; bad.push({ i, b: [capAlpha(b, i - 1), capAlpha(b, i)], a: [capAlpha(a, i - 1), capAlpha(a, i)] }); }
  if (scene.activeAt(it.switchAtSec - 0.05) !== i - 1 || scene.activeAt(it.switchAtSec) !== i) { allGood = false; bad.push({ i, active: [scene.activeAt(it.switchAtSec - 0.05), scene.activeAt(it.switchAtSec)] }); }
  for (let d = -0.5; d <= 0.5; d += 0.05) { const f = frame(it.switchAtSec + d); const x = capAlpha(f, i - 1), y = capAlpha(f, i); if (x > 0.05 && y > 0.05) { allGood = false; bad.push({ i, d: +d.toFixed(2), x, y }); } }
}
ok('at EVERY transition (9 of 9): the previous title is fully visible before, the next fully visible after, the active row flips at the switch second, and the two titles are NEVER visible together', allGood, bad.slice(0, 3));
const sw = tl.items[4].switchAtSec; const mid = frame(sw);
ok('at the switch instant neither title is on screen (the outgoing one has left, the incoming one has not arrived)', capAlpha(mid, 3) < 0.05 && capAlpha(mid, 4) < 0.05);
// long Persian titles, long Latin titles
const mkScene = (tracks, bg = 'ice') => { const t = F.srvfMixTimeline(tracks); return { t, sc: createMixScene({ W: 1920, H: 1080, mix: { titleLatin: 'Top Persian — Female Love Romantic Mix', titleFa: 'ف', tracks: t.items, totalSec: t.totalSec }, background: bg, images: { covers: {} }, seed: 1 }) }; };
const LONGFA = 'ای که در دل من نشسته‌ای همیشه و هنوز منتظر یک نگاه از تو هستم';
{ const { sc } = mkScene([{ pkgId: 'a', title: LONGFA, finglish: 'Ey Ke Dar Del-e Man Neshaste-i Hamishe Va Hanuz Montazer', artist: 'female', durationSec: 200 }, { pkgId: 'b', title: 'ب', finglish: 'Short', artist: 'male', durationSec: 200 }]); const r = recorder(); sc.draw(r.ctx, 5);
  const fa2 = r.calls.filter((c) => /^800 \d+px/.test(c.font) && ARABIC.test(c.text) && c.text !== 'ف'); const lat = r.calls.filter((c) => /^600 \d+px/.test(c.font) && /EY KE DAR|MONTAZER/.test(c.text));
  ok('a LONG Persian title wraps onto two lines (every word kept, never cut), each line at most 54 px and inside the tile width', fa2.length === 2 && fa2.map((c) => c.text).join(' ') === LONGFA && fa2.every((c) => px(c) <= 54 && px(c) >= 26), fa2.map((c) => [c.text.slice(0, 12), px(c)]));
  ok('a LONG Latin title shrinks to fit on one line (never truncated)', lat.length === 1 && lat[0].text.includes('MONTAZER') && px(lat[0]) >= 13 && px(lat[0]) <= 25, lat.map((c) => [c.text, px(c)])); }
{ const { sc } = mkScene([{ pkgId: 'a', title: 'دیدار تو', finglish: 'Didaar-e To', artist: 'female', durationSec: 200 }, { pkgId: 'b', title: 'ب', finglish: 'Other', artist: 'male', durationSec: 200 }]); const r = recorder(); sc.draw(r.ctx, 5); const fa2 = r.calls.filter((c) => /^800 \d+px/.test(c.font) && c.text === 'دیدار تو');
  ok('a short Persian title stays on ONE line at the large size (66 px)', fa2.length === 1 && px(fa2[0]) === 66, fa2.map(px)); }
// artist categories never drawn
{ const { sc } = mkScene([{ pkgId: 'a', title: 'دیدار', finglish: 'Didaar', artist: 'female', durationSec: 200 }, { pkgId: 'b', title: 'تو', finglish: 'To', artist: 'male', durationSec: 200 }, { pkgId: 'c', title: 'جان', finglish: 'Jan', artist: 'duet', durationSec: 200 }]); let leak = 0; for (const t of [3, 150, 300, 450]) { const r = recorder(); sc.draw(r.ctx, t); leak += r.calls.filter((c) => /\b(FEMALE|MALE|DUET|ALL ARTISTS)\b/i.test(c.text)).length; }
  ok('NO frame shows Female / Male / Duet / All Artists (female, male and duet songs, a title that contains the word)', leak === 0, leak); }
// every background: one Persian caption + the heading subtitle, nothing else Persian
let leak2 = 0; for (const bg of F.SRVF_BACKGROUND_IDS) { const sc = createMixScene({ W: 1920, H: 1080, mix: { titleLatin: 'Top Persian — Love Romantic Mix', titleFa: 'گلچین', tracks: tl.items, totalSec: tl.totalSec }, background: bg, images: { covers: {} }, seed: 2 }); for (const t of [3, 400, 900, 1500]) { const r = recorder(); sc.draw(r.ctx, t); const fp = persian(r.calls).filter((c) => c.text !== 'گلچین'); if (fp.length > 1 || fp.some((c) => !/^800 /.test(c.font))) leak2++; } }
ok('all six backgrounds: at every sample at most one Persian song title (heavy 800 face) besides the heading, never in the tracklist', leak2 === 0, leak2);
const rt = recorder(); drawMixThumbnail(rt.ctx, { background: 'night-gold', categoryLabel: 'All Artists', moodLabel: 'Love Romantic', titleFa: 'گلچین', tracks: tl.items, cover: null, runtimeLabel: '27 MIN' });
ok('thumbnail: TOP PERSIAN label, the mood, ONE song caption (Persian title + Latin title + channel name), no artist-category word', rt.calls.some((c) => c.text === 'TOP PERSIAN') && rt.calls.some((c) => c.text === 'LOVE') && rt.calls.filter((c) => c.text === fa[0]).length === 1 && rt.calls.filter((c) => c.text === finglish[0].toUpperCase()).length === 1 && !rt.calls.some((c) => /\b(FEMALE|MALE|DUET|ALL ARTISTS)\b/i.test(c.text)), rt.calls.map((c) => c.text).slice(0, 14));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
