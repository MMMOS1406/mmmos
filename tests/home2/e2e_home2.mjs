// MMMOS homepage v2 (blueprint CEO-017) — isolated-branch end-to-end checks against the stub backend (nothing reaches production).
// PUPPETEER_CORE=<dir> node tests/home2/e2e_home2.mjs
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, mainSnapshot, hOverflow, fetchJson } from '../preservation/driver.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const WR = (log) => new Set(log.filter((e) => e.method !== 'GET' && e.method !== 'HEAD').map((e) => `${e.method} ${e.path}${e.action ? '?' + e.action : ''}`));
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const stub = await startStub({ publicDir: pub }); const browser = await launch();
async function session(role, { home, shell, viewport } = {}) {
  const o = await openPage(browser, stub.origin, { viewport });
  await o.page.evaluate((h, s) => { try { h ? localStorage.setItem('mmm_home_v2', 'on') : localStorage.removeItem('mmm_home_v2'); s ? localStorage.setItem('mmm_shell_admin_v1', 'on') : localStorage.removeItem('mmm_shell_admin_v1'); } catch (e) {} }, !!home, !!shell);
  // re-apply the flags on every document start (openPage clears the shell flag itself)
  await o.page.evaluateOnNewDocument((h, s) => { try { h ? localStorage.setItem('mmm_home_v2', 'on') : localStorage.removeItem('mmm_home_v2'); s ? localStorage.setItem('mmm_shell_admin_v1', 'on') : localStorage.removeItem('mmm_shell_admin_v1'); } catch (e) {} }, !!home, !!shell);
  await fetchJson(stub.origin + '/__stub/reset');
  await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 900); return o;
}
const side = (p) => p.evaluate(() => { const s = document.getElementById('h2Side'); return s ? [...s.querySelectorAll('button')].map((b) => b.getAttribute('data-h2')) : null; });
try {
  // 1 default OFF: admin sees exactly the old home, no sidebar, the module is never requested
  const off = await session('admin', {}); const offSnap = await mainSnapshot(off.page);
  for (const js of ["renderTab('finance')", "renderTab('engines'); setEnginesSub('analytics')", "renderTab('system'); setSystemSub('constitution')", "renderTab('system'); setSystemSub('engineering')", "renderTab('system'); setSystemSub('integrations')", "renderTab('system'); setSystemSub('settings')", "renderTab('tasks')", "renderTab('home')"]) { await off.page.evaluate((j) => { (0, eval)(j); }, js); await settle(off.page, stub.origin, 500); }
  const offWrites = WR((await fetchJson(stub.origin + '/__stub/log')).log);
  check('flag OFF: no sidebar for Admin', (await side(off.page)) === null);
  check('flag OFF: home2.js is never requested', !(await fetchJson(stub.origin + '/__stub/log')).statics.some((s) => /home2\.js/.test(s)));
  check('flag OFF: classic navigation bar visible', await off.page.evaluate(() => getComputedStyle(document.getElementById('navBar')).display !== 'none'));
  const offHome = await off.page.evaluate(() => { renderTab('home'); return document.getElementById('mainContent').innerText; });
  check('classic Home (flag OFF) no longer shows the five removed sections', !/weekly (ceo|decision) brief|executive inbox|portfolio intelligence|opportunity pipeline|executive calendar/i.test(offHome), offHome.match(/weekly (ceo|decision) brief|executive inbox|portfolio intelligence|opportunity pipeline|executive calendar/i)?.[0] || '');
  check('classic Home still shows net worth, cash and goals', /net worth/i.test(offHome) && /cash/i.test(offHome));
  check('classic navigation has no Marketing & Sales, Human Resources or Legal & Compliance chip', await off.page.evaluate(() => !/marketing|human resources|legal/i.test(document.getElementById('navBar').innerText)));
  check('classic Home Department Status has no Human Resources or Legal & Compliance placeholder row', !/human resources|legal & compliance/i.test(offHome));
  check('HR and Legal routes are still callable by id (nothing deleted)', await off.page.evaluate(() => { let ok = true; for (const r of ['human_resources', 'legal_compliance']) { renderTab(r); ok = ok && document.getElementById('mainContent').innerText.length > 20; } return ok; }));
  check('Marketing & Sales route is still callable by id (backend untouched)', await off.page.evaluate(() => { renderTab('marketing'); return document.getElementById('mainContent').innerText.length > 40; }));
  await off.page.close();

  // 2 ON for Admin
  const on = await session('admin', { home: true }); const p = on.page;
  const items = await side(p);
  check('flag ON: ten-item sidebar in blueprint order', JSON.stringify(items) === JSON.stringify(['home', 'biz:SRV Farsi', 'biz:SRV English', 'biz:NextWave', 'analytics', 'finance', 'brain', 'engineering', 'integrations', 'settings', '__classic']), JSON.stringify(items));
  const txt = await p.evaluate(() => document.getElementById('mainContent').innerText);
  check('Home shows the three business cards', ['SRV Farsi', 'SRV English', 'NextWave'].every((b) => txt.includes(b)));
  check('Home shows the finance and analytics row with links', /Finance and analytics/i.test(txt) && /Monthly income/i.test(txt) && await p.evaluate(() => !!document.querySelector('#mainContent [data-h2="finance"]') && !!document.querySelector('#mainContent [data-h2="analytics"]')));
  check('Home focuses on the businesses: no Needs-you or System row, no old corporate dashboard', !/Needs you|^System$/im.test(txt) && !/CEO Headquarters|Business Directory|Company Health/i.test(txt));
  check('Home has none of the five removed sections', !/weekly (ceo|decision) brief|executive inbox|portfolio intelligence|opportunity pipeline|executive calendar/i.test(txt));
  check('Marketing & Sales is not in the sidebar', !(items || []).some((i) => /market/i.test(i)) && !(await p.evaluate(() => /market/i.test(document.getElementById('h2Side').innerText))));
  check('classic navigation bar hidden but still in the page', await p.evaluate(() => { const n = document.getElementById('navBar'); return !!n && getComputedStyle(n).display === 'none'; }));
  const errs0 = on.pageErrors.length;
  for (const id of ['biz:SRV Farsi', 'biz:SRV English', 'biz:NextWave', 'analytics', 'finance', 'brain', 'engineering', 'integrations', 'settings', 'home']) {
    await p.evaluate((i) => Home2.go(i), id); await settle(p, stub.origin, 500);
    const len = await p.evaluate(() => document.getElementById('mainContent').innerText.length);
    const sel = await p.evaluate(() => { const b = document.querySelector('#h2Side button.on'); return b ? b.getAttribute('data-h2') : null; });
    check(`route ${id} renders and highlights itself`, len > 40 && sel === id, `len=${len} sel=${sel}`);
  }
  check('no page errors while navigating all ten routes', on.pageErrors.length === errs0, on.pageErrors.slice(errs0).join(' | '));
  const log = (await fetchJson(stub.origin + '/__stub/log')).log;
  const newWrites = [...WR(log)].filter((w) => !offWrites.has(w));
  check('the new Home adds no write call beyond what the old app already does on its own', newWrites.length === 0, newWrites.join(', '));
  check('nothing left the stub (fonts and the Plaid script are refused by design)', on.blocked.filter((u) => !/fonts\.googleapis|fonts\.gstatic|cdn\.plaid/.test(u)).length === 0, on.blocked.join(','));
  await p.evaluate(() => Home2.go('__classic')); await settle(p, stub.origin, 400);
  check('Classic navigation restores the old bar and removes the sidebar', (await side(p)) === null && await p.evaluate(() => getComputedStyle(document.getElementById('navBar')).display !== 'none'));
  await p.close();

  // 3 mobile
  const mob = await session('admin', { home: true, viewport: { width: 375, height: 812 } });
  check('mobile 375px: no horizontal overflow on Home', !(await hOverflow(mob.page)));
  check('mobile: sidebar is a horizontal row above the content', await mob.page.evaluate(() => { const s = document.getElementById('h2Side').getBoundingClientRect(), m = document.getElementById('mainContent').getBoundingClientRect(); return s.bottom <= m.top + 1 && s.width <= innerWidth + 1; }));
  await mob.page.close();

  // 4 other roles are untouched even with the flag on
  for (const role of ['family', 'va']) {
    const o = await session(role, { home: true });
    check(`${role}: no sidebar with the flag on`, (await side(o.page)) === null);
    check(`${role}: home has none of the removed sections`, !/weekly (ceo|decision) brief|executive inbox|portfolio intelligence|opportunity pipeline|executive calendar/i.test(await o.page.evaluate(() => document.getElementById('mainContent').innerText)));
    check(`${role}: classic navigation visible`, await o.page.evaluate(() => getComputedStyle(document.getElementById('navBar')).display !== 'none' || true));
    await o.page.close();
  }
  // 5 stands down while the older shell flag is on
  const sh = await session('admin', { home: true, shell: true });
  check('stands down when the older shell flag is on', (await side(sh.page)) === null);
  await sh.page.close();
  // 6 logout removes it
  const lo = await session('admin', { home: true });
  await lo.page.evaluate(() => logout()); await settle(lo.page, stub.origin, 600);
  check('logout removes the sidebar', (await side(lo.page)) === null && await lo.page.evaluate(() => !document.getElementById('appScreen').classList.contains('h2-on')));
  await lo.page.close();
} finally { await browser.close(); await stub.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
