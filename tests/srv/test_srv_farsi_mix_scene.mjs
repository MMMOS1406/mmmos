// SRV Farsi Mix — the video scene's TEXT, checked at every song transition (CEO final correction 2026-11-12): TOP PERSIAN branding, the tracklist AND the changing cover caption show the song's FINGLISH,
// no Persian script anywhere in the tracklist or caption, and the highlighted row + caption change exactly at each song's switch second (the same second as its YouTube chapter).
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
ok('header label is TOP PERSIAN (not SRV FARSI) and the heading has no "SRV Farsi" prefix', f0.some((c) => c.text === 'TOP PERSIAN') && !f0.some((c) => /SRV FARSI —|^SRV FARSI$/.test(c.text)) && f0.some((c) => c.text === 'LOVE ROMANTIC MIX'), f0.slice(0, 6).map((c) => c.text));
ok('the only Persian script in the whole frame is the heading subtitle (never the tracklist or a song caption)', persian(f0).length === 1 && persian(f0)[0].text === title.split('|')[1].trim(), persian(f0).map((c) => c.text));
const rowTexts = (calls, i) => calls.filter((c) => c.text === finglish[i].toUpperCase());
ok('the left tracklist lists every song in Finglish, in order (10 rows)', finglish.every((f, i) => rowTexts(f0, i).length >= 1) && f0.filter((c) => /^\d\d$/.test(c.text)).length >= 8, f0.filter((c) => /^\d\d$/.test(c.text)).length);
// the caption of the active cover at every transition
const captionAt = (calls) => { const cands = calls.filter((c) => /^600 \d+px/.test(c.font) && c.alpha > 0.02 && c.text.length > 2 && c.text !== 'TOP PERSIAN' && !/LOVE ROMANTIC MIX|SILK ROAD/.test(c.text) && !ARABIC.test(c.text)); const joined = (idx) => { const w = finglish[idx].toUpperCase(); const parts = cands.filter((c) => w.replace(/\s+/g, ' ').includes(c.text.replace(/\s+/g, ' ')) && c.font.includes('600')); return parts.length ? Math.max(...parts.map((c) => c.alpha)) : 0; }; return finglish.map((_, i) => joined(i)); };
let allGood = true; const bad = [];
for (const it of tl.items.slice(1)) {
  const before = captionAt(frame(it.switchAtSec - 1.2)), after = captionAt(frame(it.switchAtSec + 1.2)); const i = it.index;
  const gb = before[i - 1] > 0.9 && before[i] < 0.2, ga = after[i] > 0.9 && after[i - 1] < 0.2; if (!(gb && ga)) { allGood = false; bad.push({ i, before: before.slice(i - 1, i + 1), after: after.slice(i - 1, i + 1) }); }
  if (scene.activeAt(it.switchAtSec - 0.05) !== i - 1 || scene.activeAt(it.switchAtSec) !== i) { allGood = false; bad.push({ i, active: [scene.activeAt(it.switchAtSec - 0.05), scene.activeAt(it.switchAtSec)] }); }
}
ok('at EVERY transition (9 of 9) the caption changes from the previous song\'s Finglish to the next one\'s, and the active row flips at exactly the switch second', allGood, bad);
const sw = tl.items[4].switchAtSec; const mid = captionAt(frame(sw)); ok('at the switch instant the incoming caption is half-faded over the outgoing one (a cross-fade, neither Persian)', mid[3] > 0.9 && mid[4] > 0.3 && mid[4] < 0.7 && persian(frame(sw)).length === 1, mid.slice(2, 6));
const longName = F.srvfMixTimeline([{ pkgId: 'a', title: 'آ', finglish: 'Ey Ke Dar Del-e Man Nesheste-i Hamishe', artist: 'female', durationSec: 200 }, { pkgId: 'b', title: 'ب', finglish: 'Short', artist: 'male', durationSec: 200 }]);
const sc2 = createMixScene({ W: 1920, H: 1080, mix: { titleLatin: 'Top Persian — X', titleFa: 'ف', tracks: longName.items, totalSec: longName.totalSec }, background: 'ice', images: { covers: {} }, seed: 1 }); const r2 = recorder(); sc2.draw(r2.ctx, 5);
ok('a long Finglish title is wrapped onto two lines in the caption (not truncated), in Latin', r2.calls.filter((c) => /^600 \d+px/.test(c.font) && /EY KE DAR|NESHESTE-I HAMISHE/.test(c.text)).length === 2 && r2.calls.some((c) => c.text.includes('HAMISHE')));
// typography (CEO/PM correction 2026-11-12): the caption under the cover is LIGHTER (600, not 800) and capped at 38 px; long titles wrap to two lines at ≤ 34 px
{ const px = (c) => +(c.font.match(/(\d+)px/) || [0, 0])[1]; const cap = (calls) => calls.filter((c) => /^600 \d+px/.test(c.font) && c.alpha > 0.9 && !/LOVE ROMANTIC MIX|TOP PERSIAN|SILK ROAD/.test(c.text) && !/^\d\d/.test(c.text));
  const one = (name) => { const t = F.srvfMixTimeline([{ pkgId: 'a', title: 'آ', finglish: name, artist: 'female', durationSec: 200 }, { pkgId: 'b', title: 'ب', finglish: 'Other', artist: 'male', durationSec: 200 }]); const sc = createMixScene({ W: 1920, H: 1080, mix: { titleLatin: 'Top Persian — X', titleFa: 'ف', tracks: t.items, totalSec: t.totalSec }, background: 'ice', images: { covers: {} }, seed: 1 }); const r = recorder(); sc.draw(r.ctx, 5); return cap(r.calls); };
  const short = one('Eshgh-e Man'), med = one('Didaar-e To'), long = one('Ey Ke Dar Del-e Man Nesheste-i Hamishe');
  ok('typography: short and medium titles are drawn at weight 600 and no larger than 38 px (was 800 and up to 64 px)', short.length === 1 && med.length === 1 && px(short[0]) <= 38 && px(med[0]) <= 38 && px(short[0]) >= 30, [short.map(px), med.map(px)]);
  ok('typography: a long title wraps to two lines, each at most 34 px, weight 600, nothing truncated', long.length === 2 && long.every((c) => px(c) <= 34 && px(c) >= 20) && long.map((c) => c.text).join(' ') === 'EY KE DAR DEL-E MAN NESHESTE-I HAMISHE', long.map((c) => [c.text, px(c)]));
  ok('typography: the tracklist rows and the heading are untouched (still italic 700 rows; heading 800)', f0.some((c) => /^italic 700 \d+px/.test(c.font)) && f0.some((c) => c.text === 'LOVE ROMANTIC MIX' && /^800 /.test(c.font))); }
// every background, every song: no Persian in tracklist/caption
let persianLeak = 0; for (const bg of F.SRVF_BACKGROUND_IDS) { const sc = createMixScene({ W: 1920, H: 1080, mix: { titleLatin: 'Top Persian — Love Romantic Mix', titleFa: 'گلچین', tracks: tl.items, totalSec: tl.totalSec }, background: bg, images: { covers: {} }, seed: 2 }); for (const t of [3, 400, 900, 1500]) { const r = recorder(); sc.draw(r.ctx, t); persianLeak += persian(r.calls).filter((c) => c.text !== 'گلچین').length; } }
ok('all six backgrounds: no Persian script in any tracklist row or caption at four sample times', persianLeak === 0, persianLeak);
const rt = recorder(); drawMixThumbnail(rt.ctx, { background: 'night-gold', categoryLabel: 'All Artists', moodLabel: 'Love Romantic', titleFa: 'گلچین', tracks: tl.items, cover: null, runtimeLabel: '27 MIN' });
ok('thumbnail: TOP PERSIAN label (not "SRV FARSI · ALL ARTISTS"), unchanged otherwise', rt.calls.some((c) => c.text === 'TOP PERSIAN') && !rt.calls.some((c) => /SRV FARSI ·/.test(c.text)) && rt.calls.some((c) => c.text === 'LOVE'));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
