// SRV Studio V2 — Checkpoint D6: verifies the Render Studio A/B player with real mouse clicks in a real
// (windowed) browser: Play / Pause / Resume / Restart / Stop, click-on-picture and space bar, blocked-audio
// fallback, Long and Short, and the encoded A/B videos playing in sync. Preview only, sample data.
//   PUPPETEER_CORE=<dir> node headless-player.mjs <browser executable> <label> OUTDIR [origin]
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PUPPETEER_CORE || here, 'x.js'));
const puppeteer = require('puppeteer-core');
const [exe, label, outDirArg, originArg] = process.argv.slice(2);
const outDir = path.resolve(outDirArg); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv2-player-'));
const srv = originArg ? null : await startPreview({ publicDir: path.resolve(here, '../../../public'), port: 0, storageDir: path.join(tmp, 's') });
const origin = originArg || srv.origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const ok = (n, c, x) => { checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + `[${label}] ` + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };

async function open(blockAudio) {
  const prof = fs.mkdtempSync(path.join(tmp, 'prof-'));
  const b = await puppeteer.launch({ executablePath: exe, headless: false, userDataDir: prof, args: ['--no-first-run', '--no-default-browser-check', '--window-position=-2600,0', '--window-size=1440,900'] });
  const p = (await b.pages())[0] || await b.newPage(); await p.setViewport({ width: 1440, height: 780 }); // a laptop-sized browser window
  if (blockAudio) await p.evaluateOnNewDocument(() => { // what a browser that refuses sound looks like to the page
    const AP = AudioContext.prototype; Object.defineProperty(AP, 'state', { get() { return 'suspended'; } }); Object.defineProperty(AP, 'currentTime', { get() { return 0; } }); AP.resume = function () { return new Promise(() => {}); };
  });
  const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(origin + '/studio/render'); await p.waitForFunction('window.__srv2Ready', { timeout: 60000 });
  await p.waitForFunction("document.getElementById('pmsg').textContent.includes('Ready')", { timeout: 30000 }).catch(() => {});
  return { b, p, errors };
}
const hash = (p, id) => p.evaluate((i) => { const c = document.getElementById(i); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let k = 0; k < d.length; k += 4 * 211) s = (s * 31 + d[k]) >>> 0; return s; }, id);
const player = (p) => p.evaluate(() => ({ ...window.__srv2Player, chip: document.getElementById('pstate').textContent, snd: document.getElementById('snd').textContent, enable: !document.getElementById('enableSound').hidden, clock: document.getElementById('clock').textContent }));

for (const kind of ['long', 'short']) {
  const { b, p, errors } = await open(false);
  if (kind === 'short') { await p.select('#kind', 'short'); await sleep(1500); }
  const geo = await p.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { play: Math.round(r('play').top), panelsTop: Math.round(r('cmpA').top), vh: innerHeight, emptyPlayerVisible: !document.getElementById('out').hidden }; });
  ok(`${kind}: ▶ Play is visible without scrolling, above the pictures; no empty video player`, geo.play > 0 && geo.play < geo.vh - 60 && geo.play < geo.panelsTop && !geo.emptyPlayerVisible, geo);
  const s0 = await player(p);
  ok(`${kind}: starts STOPPED with poster frames (Pause/Stop disabled)`, /STOPPED/.test(s0.chip) && await p.evaluate(() => document.getElementById('pause').disabled && document.getElementById('stopAnim').disabled));
  const hA0 = await hash(p, 'cmpA'), hB0 = await hash(p, 'cmpB');
  await p.click('#play'); await sleep(2500);
  const s1 = await player(p); const hA1 = await hash(p, 'cmpA'), hB1 = await hash(p, 'cmpB'); await sleep(1500); const s1b = await player(p); const hB2 = await hash(p, 'cmpB');
  ok(`${kind}: ▶ Play starts BOTH pictures (A and B change frame by frame)`, hA1 !== hA0 && hB1 !== hB0 && hB2 !== hB1, { t: s1.t });
  ok(`${kind}: status shows PLAYING with a running clock and sound on`, /PLAYING/.test(s1.chip) && s1b.t > s1.t + 1 && /sound on/.test(s1b.snd), { chip: s1.chip, clock: s1b.clock, snd: s1b.snd });
  if (kind === 'long') await p.screenshot({ path: path.join(outDir, `${label}-playing-long.png`), clip: { x: 300, y: 50, width: 1140, height: 640 } });
  await p.click('#pause'); await sleep(300); const s2 = await player(p); const hp1 = await hash(p, 'cmpB'); await sleep(1500); const s2b = await player(p); const hp2 = await hash(p, 'cmpB');
  ok(`${kind}: ❚❚ Pause freezes the picture and the clock`, /PAUSED/.test(s2.chip) && s2.t === s2b.t && hp1 === hp2, { at: s2.t });
  await p.click('#play'); await sleep(1500); const s3 = await player(p);
  ok(`${kind}: ▶ Resume continues from the paused position`, /PLAYING/.test(s3.chip) && s3.t > s2.t && s3.t < s2.t + 2.5, { from: s2.t, now: s3.t });
  await p.click('#restart'); await sleep(900); const s4 = await player(p);
  ok(`${kind}: ↺ Restart goes back to the beginning and plays`, /PLAYING/.test(s4.chip) && s4.t < 1.5, { t: s4.t });
  await p.click('#cmpB'); await sleep(300); const s5 = await player(p); await p.click('#cmpA'); await sleep(800); const s6 = await player(p);
  ok(`${kind}: clicking a picture pauses, clicking again plays`, /PAUSED/.test(s5.chip) && /PLAYING/.test(s6.chip));
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press('Space'); await sleep(300); const s7 = await player(p); await p.keyboard.press('Space'); await sleep(500); const s8 = await player(p);
  ok(`${kind}: space bar pauses and plays`, /PAUSED/.test(s7.chip) && /PLAYING/.test(s8.chip));
  await p.click('#stopAnim'); await sleep(800); const s9 = await player(p);
  ok(`${kind}: ■ Stop returns to the start and the poster`, /STOPPED/.test(s9.chip) && s9.t === 0 && /^0:00/.test(s9.clock));
  ok(`${kind}: no page errors`, errors.filter((e) => !/favicon/.test(e)).length === 0, errors.slice(0, 2));
  await b.close();
}
{ // blocked audio: the animation must still play, and say so
  const { b, p } = await open(true);
  const h0 = await hash(p, 'cmpB'); await p.click('#play'); await sleep(2500); const s = await player(p); const h1 = await hash(p, 'cmpB'); await sleep(1200); const h2 = await hash(p, 'cmpB'); const s2 = await player(p);
  ok('blocked audio: both pictures still animate on the page clock', h1 !== h0 && h2 !== h1 && s2.t > s.t + 0.8, { t: s2.t });
  ok('blocked audio: status says sound is blocked and offers Enable sound', /PLAYING/.test(s.chip) && /blocked/.test(s.snd) && s.enable, { snd: s.snd });
  await p.screenshot({ path: path.join(outDir, `${label}-blocked-audio.png`), clip: { x: 300, y: 50, width: 1140, height: 300 } });
  await b.close();
}
{ // encoded A/B videos in sync
  const { b, p } = await open(false);
  for (const kind of ['long', 'short']) {
    await p.select('#vkind', kind); await sleep(800);
    await p.$eval('#vplay', (el) => el.scrollIntoView({ block: 'center' })); await p.click('#vplay'); await sleep(3500);
    const v = await p.evaluate(() => window.__srv2Videos);
    ok(`encoded ${kind}: ▶ Play both plays A and B together, in sync`, !v.paused && !v.bPaused && v.a > 2 && Math.abs(v.a - v.b) < 0.15, v);
    if (kind === 'short') await p.screenshot({ path: path.join(outDir, `${label}-encoded-short.png`) });
    await p.click('#vpause'); await sleep(400); const w = await p.evaluate(() => window.__srv2Videos);
    ok(`encoded ${kind}: ❚❚ Pause stops both`, w.paused && w.bPaused);
  }
  await b.close();
}
fs.writeFileSync(path.join(outDir, `${label}-player-result.json`), JSON.stringify({ label, exe, checks, productionHits: srv ? srv.productionHits : null }, null, 1));
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n[${label}] ${checks.length - failed} passed, ${failed} failed` + (srv ? ` · productionHits ${srv.productionHits}` : ''));
if (srv) await srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
