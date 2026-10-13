// CEO-008 Phase 0 — preservation harness: browser driver.
// Requires puppeteer-core and a local Chrome (set CHROME_PATH). puppeteer-core is intentionally NOT added
// to package.json so the production build is untouched; point PUPPETEER_CORE at its install dir if needed.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { FIXED_NOW } from './fixtures.mjs';

const require = createRequire(import.meta.url);
export function loadPuppeteer() {
  const dirs = [process.env.PUPPETEER_CORE, process.cwd(), new URL('../../', import.meta.url).pathname].filter(Boolean);
  for (const d of dirs) { try { return require(require.resolve('puppeteer-core', { paths: [d] })); } catch { /* try next */ } }
  throw new Error('puppeteer-core not found. Set PUPPETEER_CORE to a directory that contains node_modules/puppeteer-core.');
}
export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export async function launch() {
  const puppeteer = loadPuppeteer();
  return puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
}

// Replace nondeterministic tokens so two runs of the same code compare equal.
export function normalize(s) {
  return String(s)
    .replace(/\b17\d{11}\b/g, '<TS>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\b/g, '<ISO>')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2}\s?[AP]M\b/g, '<DATETIME>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}\s?[AP]M\b/g, '<TIME>')
    .replace(/\bcdp-[0-9a-f-]{8,}\b/g, '<ID>')
    .replace(/\s+/g, ' ').trim();
}

/** Open a page wired to the stub. opts: {viewport, flag (shell flag), stubOrigin} */
export async function openPage(browser, stubOrigin, opts = {}) {
  const page = await browser.newPage();
  const consoleErrors = []; const pageErrors = []; const blocked = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  await page.setViewport(opts.viewport || { width: 1440, height: 900 });
  await page.emulateTimezone('UTC');
  await page.evaluateOnNewDocument((FIXED, flag) => {
    const RealDate = Date; const t0 = performance.now();
    class FDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(FIXED + (performance.now() - t0)); else super(...a); }
      static now() { return FIXED + (performance.now() - t0); }
    }
    window.Date = FDate;
    try { if (flag) localStorage.setItem('mmm_shell_admin_v1', 'on'); else localStorage.removeItem('mmm_shell_admin_v1'); } catch { /* ignore */ }
  }, FIXED_NOW, !!opts.flag);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(stubOrigin) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return req.continue();
    blocked.push(u.slice(0, 120)); // nothing may leave the stub — fonts, CDNs, anything else is refused
    return req.abort('blockedbyclient');
  });
  await page.goto(stubOrigin + '/', { waitUntil: 'domcontentloaded' });
  return { page, consoleErrors, pageErrors, blocked };
}

export async function settle(page, stubOrigin, ms = 700) {
  // wait until the stub has seen no new request for `ms`
  let last = -1; let stable = 0;
  for (let i = 0; i < 80 && stable < ms; i++) {
    const n = await fetchJson(stubOrigin + '/__stub/log').then((j) => j.log.length).catch(() => 0);
    if (n === last) stable += 100; else { stable = 0; last = n; }
    await sleep(100);
  }
  await sleep(150);
}

export async function fetchJson(url) { const r = await fetch(url); return r.json(); }

export async function login(page, stubOrigin, userId) {
  await page.waitForFunction(() => typeof USERS !== 'undefined' && typeof selectUser === 'function');
  const pin = await page.evaluate((id) => { const u = USERS.find((x) => x.id === id); return u.ceoAuth ? '0000' : u.pin; }, userId);
  await page.evaluate((id) => selectUser(id), userId);
  await page.evaluate((p) => { document.getElementById('pinInput').value = p; }, pin);
  await page.evaluate(() => tryLogin());
  await page.waitForFunction(() => document.getElementById('appScreen').classList.contains('show') && typeof currentUser !== 'undefined' && currentUser);
  await settle(page, stubOrigin, 900);
}

export async function mainSnapshot(page) {
  const { html, text } = await page.evaluate(() => {
    const el = document.getElementById('mainContent');
    return { html: el ? el.innerHTML : '', text: el ? el.innerText : '' };
  });
  const nh = normalize(html);
  return { htmlHash: sha(nh), htmlLen: nh.length, text: normalize(text).slice(0, 6000) };
}

export async function hOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

export async function stubLog(stubOrigin) { return fetchJson(stubOrigin + '/__stub/log'); }
export async function stubReset(stubOrigin) { return fetchJson(stubOrigin + '/__stub/reset'); }
export const sig = (e) => `${e.method} ${e.path}${e.action ? '?action=' + e.action : ''}${e.table ? ' [' + e.table + ']' : ''}${e.rpc ? ' rpc:' + e.rpc : ''}`;
