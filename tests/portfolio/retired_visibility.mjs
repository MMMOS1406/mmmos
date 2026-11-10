// Retired businesses (NextWave, SMM, AI Creation Studio) must not appear anywhere in the ACTIVE application, for any role, and nothing may break.
// Runs on a read-only copy of the REAL production state/data (tools/home2/fetch-real-fixture.mjs) in the local stub. node tests/portfolio/retired_visibility.mjs [--list]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
import { ADMIN_ROUTES, FAMILY_ROUTES, VA_ROUTES, key } from '../preservation/sweep.mjs';
const real = JSON.parse(fs.readFileSync(process.env.CLI_FIXTURE || path.join(process.env.HOME, 'mmm-backups/home2-real-fixture-20261109.json'), 'utf8'));
const RX = /next\s?wave|\bSMM\b|social[ -]media[ -]manager|ai creation|ai studio|colin\b/i;
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const fx = makeFixture(); fx.restFilter = true; fx.settings.mmm_finance_v118 = real.state; fx.tables.packages = real.packages; fx.tables.youtube_channels = real.youtube_channels; fx.tables.youtube_videos_analytics = real.youtube_videos_analytics;
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname); const stub = await startStub({ publicDir: pub, fixture: fx }); const browser = await launch();
const hits = {}; const errs = {};
try {
  for (const [role, routes] of [['admin', ADMIN_ROUTES], ['family', FAMILY_ROUTES], ['va', VA_ROUTES]]) {
    const o = await openPage(browser, stub.origin, { realClock: true }); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 800);
    const nav = await o.page.evaluate(() => (document.getElementById('navBar') || {}).innerText || '');
    if (RX.test(nav)) hits[`${role} · navigation`] = nav.match(RX)[0];
    for (const r of routes) {
      const e0 = o.pageErrors.length;
      await o.page.evaluate((route) => { try { renderTab(route.id); if (route.sub) window[route.sub[0]](route.sub[1]); } catch (e) { window.__thrown = String(e && e.message); } }, r); await settle(o.page, stub.origin, 500);
      const txt = await o.page.evaluate(() => (document.getElementById('mainContent') || {}).innerText || ''); const m = txt.match(new RegExp(RX.source, 'gi'));
      if (m) { const ctx = []; const g = new RegExp(RX.source, 'gi'); let mm; while ((mm = g.exec(txt)) && ctx.length < 6) ctx.push(txt.slice(Math.max(0, mm.index - 40), mm.index + 40).replace(/\s+/g, ' ')); hits[`${role} · ${key(r)}`] = process.argv.includes('--ctx') ? ctx : [...new Set(m.map((x) => x.toLowerCase()))].join(', '); }
      if (o.pageErrors.length > e0) errs[`${role} · ${key(r)}`] = o.pageErrors.slice(e0).join(' | ').slice(0, 200);
    }
    // the task queue as the VA / admin sees it: no retired engine's tasks listed
    await o.page.close();
  }
} finally { await browser.close(); await stub.close(); }
if (process.argv.includes('--list')) console.log(JSON.stringify(hits, null, 1));
check('no visible mention of a retired business on any route, in the navigation, for Admin, Family or VA', Object.keys(hits).length === 0, Object.entries(hits).map(([k, v]) => `${k}: ${v}`).join(' ; ').slice(0, 600));
check('no page error on any route', Object.keys(errs).length === 0, JSON.stringify(errs).slice(0, 400));
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
