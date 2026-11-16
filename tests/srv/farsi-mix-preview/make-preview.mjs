// Builds the SRV Farsi Mix preview pack (CEO order 2026-11-12): screenshots of the selection interface, the transition, backgrounds and thumbnails, plus a rendered sample video.
//   PUPPETEER_CORE=<dir with node_modules/puppeteer-core> CHROME_PATH=<chrome> node make-preview.mjs <outDir>
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js')); const puppeteer = require('puppeteer-core');
const out = path.resolve(process.argv[2] || 'preview-out'); fs.mkdirSync(out, { recursive: true });
const srv = await startPreview({ port: 0, mediaDir: out });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-sandbox'] });
const page = await browser.newPage(); await page.setViewport({ width: 1360, height: 900, deviceScaleFactor: 1 }); const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const log = (...a) => console.log(...a);
await page.goto(srv.origin + '/farsi-mix'); await page.waitForFunction(() => window.__fmxReady === true, { timeout: 60000 }); await new Promise((r) => setTimeout(r, 1500));
const shot = async (name, sel) => { const f = path.join(out, name); if (sel) { const el = await page.$(sel); await el.screenshot({ path: f }); } else await page.screenshot({ path: f, fullPage: true }); log('shot', name); };
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
// 1. selection interface
await shot('01-selection-empty.png');
await page.click('#suggest'); await settle(1200); await shot('02-selection-valid-mix.png');
const valid = await page.evaluate(() => ({ v: window.__builder.validate(), tl: window.__builder.timeline().totalLabel, n: window.__builder.state.sel.length }));
log('suggested', JSON.stringify({ ok: valid.v.ok, total: valid.tl, songs: valid.n }));
await page.evaluate(() => { const b = window.__builder; b.selectIds(b.state.sel.slice(0, 6)); }); await settle(1200); await shot('03-selection-six-songs-no-fixed-minimum.png');
await page.evaluate(() => { const b = window.__builder; b.selectIds(b.state.sel.slice(0, 1)); }); await settle(1000); await shot('03b-selection-one-song-blocked.png');
await page.evaluate(() => { const b = window.__builder; b.set({ category: 'female', mood: 'romantic', sel: [] }); }); await settle(800); await page.click('#suggest'); await settle(1200); await shot('04-selection-female-category.png');
const proceedDisabled = await page.evaluate(() => document.getElementById('proceed').disabled); log('proceed disabled with one song:', proceedDisabled);
// 2-5 views
for (const [tab, name] of [['trans', '05-song-transition.png'], ['bg', '06-backgrounds.png'], ['thumb', '07-thumbnails.png']]) { await page.evaluate((t) => document.querySelector(`#nav button[data-t="${t}"]`).click(), tab); await page.waitForFunction(() => document.querySelectorAll('#g canvas').length >= 3, { timeout: 60000 }).catch(() => {}); await settle(tab === 'bg' ? 5000 : 2500); await shot(name); }
// frames at full resolution for the transition and the layout
const full = await page.evaluate(async () => { const s = await window.__fmx.buildSample(); const c = document.createElement('canvas'); document.body.appendChild(c); const sw = s.tl.items[3].switchAtSec; const res = {}; for (const [k, t] of [['layout', 20], ['before', sw - 2], ['at', sw], ['after', sw + 2]]) { const a = await window.__fmx.frame(c, s, t); res[k] = { active: a, png: c.toDataURL('image/png').split(',')[1] }; } c.remove(); return res; });
for (const k of Object.keys(full)) fs.writeFileSync(path.join(out, `frame-${k}.png`), Buffer.from(full[k].png, 'base64')); log('frames active rows:', JSON.stringify(Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v.active]))));
// 6. the sample video (real renderer, real-time)
log('rendering sample video (real time)…');
const vid = await page.evaluate(async () => { const s = await window.__fmx.buildSample({ songs: 10, songSec: 16, background: 'ice' }); const c = document.createElement('canvas'); document.body.appendChild(c); const r = await window.__fmx.renderVideo(s, c, null); c.remove(); return { ...r, tl: s.tl.items.map((x) => ({ i: x.index, sw: x.switchAtSec, ts: x.timestamp, title: x.title })), total: s.tl.totalSec }; });
fs.writeFileSync(path.join(out, 'farsi-mix-sample.webm'), Buffer.from(vid.video, 'base64')); fs.writeFileSync(path.join(out, 'farsi-mix-sample-thumbnail.jpg'), Buffer.from(vid.thumb, 'base64')); fs.writeFileSync(path.join(out, 'sample-chapters.json'), JSON.stringify({ stats: vid.stats, chapters: vid.tl, total: vid.total }, null, 1));
log('video', JSON.stringify(vid.stats).slice(0, 300));
try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(out, 'farsi-mix-sample.webm'), '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(out, 'farsi-mix-sample.mp4')]); log('mp4 ok'); } catch (e) { log('ffmpeg mp4 failed', String(e).slice(0, 200)); }
fs.writeFileSync(path.join(out, 'errors.json'), JSON.stringify(errors, null, 1)); log('page errors:', errors.length);
await browser.close(); await srv.close();
