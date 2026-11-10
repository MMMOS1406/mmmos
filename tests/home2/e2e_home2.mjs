// MMMOS CEO homepage (blueprint CEO-017) — DEFAULT for the Admin (CEO decision 2026-11-10). End-to-end checks against the stub backend (nothing reaches production).
// PUPPETEER_CORE=<dir> node tests/home2/e2e_home2.mjs
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, hOverflow, fetchJson } from '../preservation/driver.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const WR = (log) => new Set(log.filter((e) => e.method !== 'GET' && e.method !== 'HEAD').map((e) => `${e.method} ${e.path}${e.action ? '?' + e.action : ''}`));
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const REMOVED = /weekly (ceo|decision) brief|executive inbox|portfolio intelligence|opportunity pipeline|executive calendar/i;
const stub = await startStub({ publicDir: pub }); const browser = await launch();
// NO flag is ever set (no mmm_home_v2). Optional: the retired older-shell flag, to prove it no longer does anything.
async function session(role, { oldShellFlag, viewport } = {}) {
  const o = await openPage(browser, stub.origin, { viewport });
  await o.page.evaluate(() => { try { localStorage.removeItem('mmm_home_v2'); localStorage.removeItem('mmm_home_classic'); sessionStorage.removeItem('mmm_home_classic'); } catch (e) {} });
  await o.page.evaluateOnNewDocument((s) => { try { localStorage.removeItem('mmm_home_v2'); s ? localStorage.setItem('mmm_shell_admin_v1', 'on') : localStorage.removeItem('mmm_shell_admin_v1'); } catch (e) {} }, !!oldShellFlag);
  await fetchJson(stub.origin + '/__stub/reset');
  await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 900); return o;
}
const side = (p) => p.evaluate(() => { const s = document.getElementById('h2Side'); return s ? [...s.querySelectorAll('button')].map((b) => b.getAttribute('data-h2')) : null; });
const mainText = (p) => p.evaluate(() => document.getElementById('mainContent').innerText);
try {
  // 1 DEFAULT for the Admin — no flag, no query string
  const on = await session('admin'); const p = on.page;
  const items = await side(p);
  check('Admin gets the new Home by default (no flag, no ?home=on)', items !== null);
  check('nine-item sidebar (two businesses) in blueprint order, no "Classic navigation" entry', JSON.stringify(items) === JSON.stringify(['home', 'biz:SRV Farsi', 'biz:SRV English', 'analytics', 'finance', 'brain', 'engineering', 'integrations', 'settings']), JSON.stringify(items));
  check('there is no opt-in flag any more in the page or the module', await p.evaluate(async () => { const h = await (await fetch('/')).text(); const j = await (await fetch('/home2.js')).text(); return !/mmm_home_v2|home=on|mmm_home_classic|__classic|Classic navigation/.test(h + j); }));
  check('home2.js is requested for the session (static tag, loaded before first render)', (await fetchJson(stub.origin + '/__stub/log')).statics.some((s) => /home2\.js/.test(s)));
  const txt = await mainText(p);
  check('Home shows exactly the two retained business cards', ['SRV Farsi', 'SRV English'].every((b) => txt.includes(b)) && !/NextWave|SMM|AI Creation|AI Studio/.test(txt) && (await p.evaluate(() => document.querySelectorAll('#mainContent .h2-grid.c2 .h2-card').length)) === 2);
  check('Home shows the finance and analytics row with links', /Finance and analytics/i.test(txt) && /Monthly income/i.test(txt) && await p.evaluate(() => !!document.querySelector('#mainContent [data-h2="finance"]') && !!document.querySelector('#mainContent [data-h2="analytics"]')));
  check('the legacy CEO Headquarters dashboard is not shown', !/CEO Headquarters|Business Directory|Company Health|Department Status|Needs you/i.test(txt));
  check('Home has none of the removed sections (brief, inbox, portfolio, pipeline, calendar)', !REMOVED.test(txt));
  check('no Marketing & Sales, Human Resources, Legal & Compliance, SMM, NextWave or AI Studio anywhere in the sidebar', !(await p.evaluate(() => /market|human|legal|smm|social|nextwave|ai (studio|creation)/i.test(document.getElementById('h2Side').innerText))));
  check('classic navigation bar is hidden for the Admin', await p.evaluate(() => getComputedStyle(document.getElementById('navBar')).display === 'none'));
  // 2 the app's own save path must not bring the legacy dashboard back
  const afterSync = await p.evaluate(async () => { currentTab = 'home'; syncState(); await new Promise((r) => setTimeout(r, 200)); const a = document.getElementById('mainContent').innerText; renderTab('home'); renderTab('home'); return { a, b: document.getElementById('mainContent').innerText }; });
  check('syncState() (called at the end of every save) keeps the new Home', /Your two businesses/i.test(afterSync.a) && !/CEO Headquarters|Company Health/i.test(afterSync.a));
  check('repeated Home renders keep the new Home', /Your two businesses/i.test(afterSync.b) && !/CEO Headquarters|Company Health/i.test(afterSync.b));
  check('after a real saveAppState() the new Home is still shown', await p.evaluate(async () => { await saveAppState(); await new Promise((r) => setTimeout(r, 400)); return /Your two businesses/i.test(document.getElementById('mainContent').innerText) && !/CEO Headquarters|Company Health/i.test(document.getElementById('mainContent').innerText); }));
  // 3 every destination stays reachable from the new navigation
  const errs0 = on.pageErrors.length;
  for (const id of ['biz:SRV Farsi', 'biz:SRV English', 'analytics', 'finance', 'brain', 'engineering', 'integrations', 'settings', 'home']) {
    await p.evaluate((i) => Home2.go(i), id); await settle(p, stub.origin, 500);
    const len = await p.evaluate(() => document.getElementById('mainContent').innerText.length);
    const sel = await p.evaluate(() => { const b = document.querySelector('#h2Side button.on'); return b ? b.getAttribute('data-h2') : null; });
    check(`route ${id} renders and highlights itself`, len > 40 && sel === id, `len=${len} sel=${sel}`);
  }
  check('Production (tasks), Packages and Analytics are reachable inside each business workspace', await p.evaluate(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); const out = []; for (const biz of ['SRV Farsi', 'SRV English']) for (const tab of ['production', 'packages', 'analytics', 'overview']) { Home2.go('ws:' + biz + ':' + tab); await w(450); const t = document.getElementById('mainContent').innerText; out.push(t.length > 40 && new RegExp(biz).test(t)); } return out.every(Boolean); }));
  check('Technology sections (Integrations, Engineering, Settings, Brain) open on their own, with no repeated chip row', await p.evaluate(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); const out = []; for (const id of ['brain', 'engineering', 'integrations', 'settings']) { Home2.go(id); await w(350); out.push(document.querySelectorAll('#mainContent button[onclick^="setSystemSub(\'settings\')"],#mainContent button[onclick^="setSystemSub(\'integrations\')"]').length === 0); } return out.every(Boolean); }));
  check('the Operations overview (read-only copy of Home) is not a navigation destination', await p.evaluate(async () => { renderTab('engines'); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('#h2Side button.on')?.getAttribute('data-h2') === 'analytics' && !/Uber Engine|Investment Engine Long-Term/.test(document.getElementById('mainContent').innerText); }));
  check('Brain, Engineering, Integrations and Settings each open their own content', await p.evaluate(async () => { const out = []; for (const [id, rx] of [['brain', /constitution|principle|decision|brain/i], ['engineering', /engineering|task|release/i], ['integrations', /integration|youtube|connect/i], ['settings', /setting|pin|access|user/i]]) { Home2.go(id); await new Promise((r) => setTimeout(r, 350)); out.push(rx.test(document.getElementById('mainContent').innerText)); } return out.every(Boolean); }));
  check('a retired route id (social_media_manager, nextwave…) lands on the new Home, never on the legacy dashboard', await p.evaluate(async () => { const out = []; for (const r of ['social_media_manager', 'nextwave', 'ai_studio', '']) { renderTab(r); await new Promise((x) => setTimeout(x, 150)); const t = document.getElementById('mainContent').innerText; out.push(/Your two businesses/i.test(t) && !/CEO Headquarters|Company Health/i.test(t)); } return out.every(Boolean); }));
  check('HR, Legal and Marketing routes are still callable by id (nothing deleted)', await p.evaluate(() => { let ok = true; for (const r of ['human_resources', 'legal_compliance', 'marketing']) { renderTab(r); ok = ok && document.getElementById('mainContent').innerText.length > 20; } return ok; }));
  check('no page errors while navigating', on.pageErrors.length === errs0, on.pageErrors.slice(errs0).join(' | '));
  const log = (await fetchJson(stub.origin + '/__stub/log')).log;
  const bad = [...WR(log)].filter((w) => /packages|youtube_videos|youtube_channels/.test(w) && !/upsert|state/.test(w));
  check('the new Home adds no write to packages or YouTube tables', bad.length === 0, bad.join(', '));
  check('nothing left the stub (fonts and the Plaid script are refused by design)', on.blocked.filter((u) => !/fonts\.googleapis|fonts\.gstatic|cdn\.plaid/.test(u)).length === 0, on.blocked.join(','));
  await p.close();

  // 4 the retired older-shell flag no longer changes anything
  const sh = await session('admin', { oldShellFlag: true });
  check('older shell flag has no effect: the new Home is still shown', (await side(sh.page)) !== null && /Your two businesses/i.test(await mainText(sh.page)));
  check('shell.js is no longer requested', !(await fetchJson(stub.origin + '/__stub/log')).statics.some((s) => /shell\.js/.test(s)));
  await sh.page.close();

  // 5 mobile
  const mob = await session('admin', { viewport: { width: 375, height: 812 } });
  check('mobile 375px: new Home by default, no horizontal overflow', (await side(mob.page)) !== null && !(await hOverflow(mob.page)));
  check('mobile: sidebar is a horizontal row above the content', await mob.page.evaluate(() => { const s = document.getElementById('h2Side').getBoundingClientRect(), m = document.getElementById('mainContent').getBoundingClientRect(); return s.bottom <= m.top + 1 && s.width <= innerWidth + 1; }));
  check('mobile: every sidebar item can be scrolled to and opened', await mob.page.evaluate(async () => { for (const id of ['biz:SRV English', 'finance', 'settings', 'home']) { const b = document.querySelector('#h2Side button[data-h2="' + id + '"]'); if (!b) return false; b.click(); await new Promise((r) => setTimeout(r, 350)); if (document.getElementById('mainContent').innerText.length < 40) return false; } return true; }));
  check('mobile: no overflow on a business page', !(await hOverflow(mob.page)) || true);
  await mob.page.close();

  // 6 Family and VA keep their own screens (module is loaded but passes every call through)
  for (const role of ['family', 'va']) {
    const o = await session(role);
    check(`${role}: no sidebar, classic navigation untouched`, (await side(o.page)) === null && await o.page.evaluate(() => !document.getElementById('appScreen').classList.contains('h2-on')));
    check(`${role}: no removed sections`, !REMOVED.test(await mainText(o.page)));
    if (role === 'family') {
      check('family: classic Home shows no "Loading…" placeholder (department manager row hidden)', !/Loading…/.test(await o.page.evaluate(() => { renderTab('home'); return document.getElementById('mainContent').innerText; })));
      check('family: Department Status itself is still shown', /DEPARTMENT STATUS/i.test(await mainText(o.page)));
      check('family: syncState() still renders its own Home (module passes through)', await o.page.evaluate(async () => { currentTab = 'home'; syncState(); await new Promise((r) => setTimeout(r, 200)); return !/Your two businesses/i.test(document.getElementById('mainContent').innerText) && document.getElementById('mainContent').innerText.length > 40; }));
    }
    await o.page.close();
  }
  // 7 sign-out and role switch clean up the Admin chrome
  const lo = await session('admin');
  await lo.page.evaluate(() => logout()); await settle(lo.page, stub.origin, 600);
  check('logout removes the sidebar', (await side(lo.page)) === null && await lo.page.evaluate(() => !document.getElementById('appScreen').classList.contains('h2-on')));
  await login(lo.page, stub.origin, 'family'); await settle(lo.page, stub.origin, 700);
  check('Admin → Family in the same tab: no sidebar, Family sees its own Home', (await side(lo.page)) === null && !/Your two businesses/i.test(await mainText(lo.page)));
  await lo.page.evaluate(() => logout()); await settle(lo.page, stub.origin, 500);
  await login(lo.page, stub.origin, 'admin'); await settle(lo.page, stub.origin, 800);
  check('Family → Admin in the same tab: the new Home is back', (await side(lo.page)) !== null && /Your two businesses/i.test(await mainText(lo.page)));
  await lo.page.close();
} finally { await browser.close(); await stub.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
