// SRV Studio V2 — Checkpoint D2 headless render: drives /studio/render in real Chrome (the real module and
// MediaRecorder), saves the outputs, and prints the in-browser measurements. Preview only, local only.
//   PUPPETEER_CORE=<dir with node_modules/puppeteer-core> CHROME_PATH=<chrome> node headless-render.mjs OUTDIR kind:dur:avatar:name[:static|motion] ...
// (D5) the optional 5th field picks A · static (D4 look) or B · cinematic motion (production default); CPU and
// memory of the page are sampled with page.metrics() around each render.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js'));
const puppeteer = require('puppeteer-core');
const outDir = path.resolve(process.argv[2]); fs.mkdirSync(outDir, { recursive: true });
const jobs = process.argv.slice(3).map((j) => { const [kind, dur, avatar, name, fx = 'motion'] = j.split(':'); return { kind, dur, avatar, name, fx }; });
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-headless-'));
const srv = await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const results = [];
for (const j of jobs) {
  const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 1000 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await page.goto(`${srv.origin}/studio/render?auto=render&kind=${j.kind}&dur=${j.dur}&avatar=${j.avatar}&save=${j.name}&fx=${j.fx}`);
  const m0 = await page.metrics(); const w0 = Date.now();
  let heapMax = 0; const hp = setInterval(async () => { try { heapMax = Math.max(heapMax, (await page.metrics()).JSHeapUsedSize); } catch (_) {} }, 2000);
  await page.waitForFunction('window.__srv2Result && (window.__srv2Result.error || window.__srv2Saved)', { timeout: (Number(j.dur) + 120) * 1000, polling: 1000 });
  clearInterval(hp); const m1 = await page.metrics(); const wall = (Date.now() - w0) / 1000;
  const perf = { wallSec: +wall.toFixed(1), mainThreadBusyPct: +(((m1.TaskDuration - m0.TaskDuration) / wall) * 100).toFixed(1), scriptSec: +(m1.ScriptDuration - m0.ScriptDuration).toFixed(1), heapPeakMB: +(Math.max(heapMax, m1.JSHeapUsedSize) / 1048576).toFixed(1) };
  const r = await page.evaluate(() => ({ result: window.__srv2Result, saved: window.__srv2Saved, rotation: window.__srv2Rotation, thumb: window.__srv2Thumb }));
  if (r.saved) for (const k of ['video', 'thumb']) if (r.saved[k]) { const dst = path.join(outDir, path.basename(r.saved[k].file)); fs.copyFileSync(r.saved[k].file, dst); r.saved[k].file = dst; }
  results.push({ job: j, perf, ...r }); await page.close();
}
await browser.close(); await srv.close(); fs.rmSync(storageDir, { recursive: true, force: true });
console.log(JSON.stringify({ productionHits: srv.productionHits, results }, null, 1));
