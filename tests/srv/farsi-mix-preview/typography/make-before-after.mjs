// Renders the SAME frame with the previous and the corrected scene for a short, a medium and a long title, side by side (real canvas, real covers/fonts).
// PUPPETEER_CORE=<dir> node make-before-after.mjs <outDir>
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { startPreview } from '../server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js')); const puppeteer = require('puppeteer-core');
const out = path.resolve(process.argv[2] || '.'); fs.mkdirSync(out, { recursive: true });
const srv = await startPreview({ port: 0 }); const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 }); await page.goto(srv.origin + '/farsi-mix'); await page.waitForFunction(() => window.__fmxReady === true, { timeout: 60000 }); await new Promise((r) => setTimeout(r, 1200));
const res = await page.evaluate(async () => {
  const [A, B] = await Promise.all([import('/preview/typography/scene-before.mjs'), import('/srv-farsi-mix/scene.mjs')]); const F = window.__fmx.F; const R = window.__fmx.R;
  const img = await R.loadImage('/assets/srv-farsi-avatars/library/female/srv_farsi_female_02.jpg'); const titles = [['short', 'Eshgh-e Man'], ['medium', 'Didaar-e To'], ['long', 'Ey Ke Dar Del-e Man Nesheste-i Hamishe']]; const out = {};
  for (const [k, name] of titles) {
    const tl = F.srvfMixTimeline([{ pkgId: 'a', title: 'آ', finglish: name, artist: 'female', durationSec: 200 }, { pkgId: 'b', title: 'ب', finglish: 'Sandali-ye Khali-ye To', artist: 'male', durationSec: 200 }, { pkgId: 'c', title: 'ج', finglish: 'To Jân-e Mani', artist: 'duet', durationSec: 200 }]);
    const mix = { titleLatin: 'Top Persian — Love Romantic Mix', titleFa: 'گلچین آهنگ‌های عاشقانه فارسی', tracks: tl.items, totalSec: tl.totalSec };
    for (const [tag, M] of [['before', A], ['after', B]]) { const sc = M.createMixScene({ W: 1920, H: 1080, mix, background: 'ice', images: { covers: { 0: { img, focus: { fx: 0.693, fy: 0.37, fw: 0.19 } }, 1: { img }, 2: { img } } }, seed: 4 }); const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; sc.draw(c.getContext('2d'), 6); out[k + '-' + tag] = c.toDataURL('image/png'); }
  }
  return out;
});
for (const [k, d] of Object.entries(res)) fs.writeFileSync(path.join(out, `typography-${k}.png`), Buffer.from(d.split(',')[1], 'base64'));
await browser.close(); await srv.close(); console.log('wrote', Object.keys(res).join(', '));
