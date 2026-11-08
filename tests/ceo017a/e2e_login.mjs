// CEO-017A step B — browser proof that Family and VA sign-in are judged by the server only, nothing is left in the page to type.
// PUPPETEER_CORE=<dir> node tests/ceo017a/e2e_login.mjs [publicDir]   (synthetic stub backend; throw-away test PINs only)
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, settle, sleep } from '../preservation/driver.mjs';
const pub = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '../../public'));
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
check('no PIN literal remains in the served app (no `pin:"..."`, no browser-side PIN comparison)', !/\bpin\s*:\s*["'][^"']+["']/.test(html.slice(html.indexOf('const USERS=['), html.indexOf('const USERS=[') + 1500)) && !/selectedUser\.pin\s*===/.test(html) && !/settings\.pins\[/.test(html.replace(/delete D\.settings\.pins/g, '')));
const stub = await startStub({ publicDir: pub }); const browser = await launch();
async function attempt(userId, pin, serverMode) {
  const { page } = await openPage(browser, stub.origin);
  await page.evaluateOnNewDocument((mode, goodPin) => {
    const real = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/action=(family_login|operator_login)/.test(u)) {
        const act = /action=(\w+)/.exec(u)[1]; const body = JSON.parse((opts && opts.body) || '{}'); const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
        if (mode === 'down') throw new TypeError('network down');
        if (mode === 'notconfigured') return J({ ok: false, error: act === 'family_login' ? 'family_not_configured' : 'operator_not_configured' });
        if (body.pin === goodPin) return J(act === 'family_login' ? { ok: true, family_session_token: 't.t', expires_at: new Date(Date.now() + 36e5).toISOString() } : { ok: true, operator_session_token: 't.t', expires_at: new Date(Date.now() + 36e5).toISOString() });
        return J({ ok: false, error: 'invalid_credentials' }, 401);
      }
      return real(url, opts);
    };
  }, serverMode, 'test-good-pin');
  await page.goto(stub.origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof USERS !== 'undefined' && typeof selectUser === 'function' && typeof tryLogin === 'function');
  const hasPin = await page.evaluate((id) => { const u = USERS.find((x) => x.id === id); return Object.prototype.hasOwnProperty.call(u, 'pin') && !!u.pin; }, userId);
  await page.evaluate((id) => selectUser(id), userId); await page.evaluate((p) => { document.getElementById('pinInput').value = p; }, pin); await page.evaluate(() => tryLogin()); await settle(page, stub.origin, 500); await sleep(300);
  const out = await page.evaluate(() => ({ appVisible: !!document.getElementById('app') && getComputedStyle(document.getElementById('app')).display !== 'none', loginVisible: getComputedStyle(document.getElementById('loginScreen')).display !== 'none', err: (document.getElementById('pinErr') || {}).textContent || '', family: !!sessionStorage.getItem('mmm_family_session'), operator: !!sessionStorage.getItem('mmm_operator_session') }));
  await page.close(); return { ...out, hasPin };
}
try {
  for (const [id, key] of [['family', 'family'], ['va', 'operator']]) {
    let r = await attempt(id, 'test-good-pin', 'normal'); check(`${id}: correct PIN (server says ok) opens the app and stores a session`, !r.loginVisible && r[key], JSON.stringify(r));
    check(`${id}: the user object carries no PIN`, r.hasPin === false);
    r = await attempt(id, 'wrong', 'normal'); check(`${id}: wrong PIN is refused`, r.loginVisible && !r[key] && /ncorrect/.test(r.err), r.err);
    r = await attempt(id, 'anything', 'down'); check(`${id}: server unreachable -> refused (fails closed, no browser fallback)`, r.loginVisible && /Could not sign in/.test(r.err), r.err);
    r = await attempt(id, 'anything', 'notconfigured'); check(`${id}: PIN not configured on the server -> refused with guidance`, r.loginVisible && /ask the CEO/i.test(r.err), r.err);
  }
} finally { await browser.close(); await stub.close(); }
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
