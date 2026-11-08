// CEO-017B release 1 (transition build): the server is preferred; the old browser check works ONLY while the server has no PIN for that user.
// The PIN used is read inside the page and never printed.   PUPPETEER_CORE=<dir> node tests/ceo017a/e2e_login_transition.mjs
import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, settle, sleep } from '../preservation/driver.mjs';
const pub = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '../../public'));
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const stub = await startStub({ publicDir: pub }); const browser = await launch();
async function attempt(userId, which, serverMode) {
  const { page } = await openPage(browser, stub.origin);
  await page.evaluateOnNewDocument((mode) => { const real = window.fetch.bind(window); window.fetch = async (url, opts) => { const u = String(url); if (/action=(family_login|operator_login)/.test(u)) { const act = /action=(\w+)/.exec(u)[1]; const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } }); if (mode === 'notconfigured') return J({ ok: false, error: act === 'family_login' ? 'family_not_configured' : 'operator_not_configured' }); return J({ ok: false, error: 'invalid_credentials' }, 401); } return real(url, opts); }; }, serverMode);
  await page.goto(stub.origin + '/', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => typeof USERS !== 'undefined' && typeof tryLogin === 'function');
  await page.evaluate((id, wrong) => { selectUser(id); const u = USERS.find((x) => x.id === id); document.getElementById('pinInput').value = wrong ? 'definitely-wrong' : u.pin; }, userId, which === 'wrong');
  await page.evaluate(() => tryLogin()); await settle(page, stub.origin, 500); await sleep(300);
  const out = await page.evaluate(() => ({ loggedIn: getComputedStyle(document.getElementById('loginScreen')).display === 'none' })); await page.close(); return out;
}
try {
  for (const id of ['family', 'va']) {
    check(`${id}: server has no PIN yet + correct old PIN -> signs in (existing access preserved)`, (await attempt(id, 'right', 'notconfigured')).loggedIn);
    check(`${id}: server has no PIN yet + wrong PIN -> refused`, !(await attempt(id, 'wrong', 'notconfigured')).loggedIn);
    check(`${id}: server HAS a PIN + the old browser PIN -> refused (the server decides; the old value is dead)`, !(await attempt(id, 'right', 'configured')).loggedIn);
  }
} finally { await browser.close(); await stub.close(); }
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
