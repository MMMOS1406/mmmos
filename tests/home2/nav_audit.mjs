// MMMOS navigation audit (CEO order 2026-11-10): every visible navigation control is clicked and must land on its one correct destination.
// Checks destination, sidebar highlight, return navigation, business separation (SRV Farsi vs SRV English), absence of retired/filler content,
// keyboard use, desktop + mobile layout, and the Family / VA navigation. Runs against the local stub (nothing reaches production).
// PUPPETEER_CORE=<dir> node tests/home2/nav_audit.mjs
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, hOverflow, fetchJson } from '../preservation/driver.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
// CLI_FIXTURE=<file from tools/home2/fetch-real-fixture.mjs> runs the SAME audit on a read-only copy of real production data (nothing is written to production)
let fixture;
if (process.env.CLI_FIXTURE) {
  const { makeFixture } = await import('../preservation/fixtures.mjs'); const real = JSON.parse(fs.readFileSync(process.env.CLI_FIXTURE, 'utf8'));
  fixture = makeFixture(); fixture.restFilter = true; fixture.settings.mmm_finance_v118 = real.state; fixture.tables.packages = real.packages; fixture.tables.youtube_channels = real.youtube_channels; fixture.tables.youtube_videos_analytics = real.youtube_videos_analytics;
  console.log('(running on a read-only copy of real production data)');
}
const stub = await startStub({ publicDir: pub, fixture }); const browser = await launch();
const FARSI = 'SRV Farsi', ENG = 'SRV English';
const NAMED = { 'SRV Farsi': /SRV Farsi|Silk Road/i, 'SRV English': /SRV English|Studio English/i };   // how each business can appear on screen (incl. its YouTube channel name)
const FILLER = /DEPARTMENT MANAGER|SOP LIBRARY|No mission on record|No employees on record|NO AI AGENTS|Weekly (CEO|Decision) Brief|Executive Inbox|Portfolio Intelligence/i;
const RETIRED = /NextWave|SMM\b|Social Media Manager|AI Creation|AI Studio/i;
async function session(role, viewport) {
  const o = await openPage(browser, stub.origin, { viewport });
  await fetchJson(stub.origin + '/__stub/reset'); await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 1000); return o;
}
const W = (p, ms = 500) => settle(p, stub.origin, ms);
const text = (p) => p.evaluate(() => document.getElementById('mainContent').innerText);
const hl = (p) => p.evaluate(() => { const b = document.querySelector('#h2Side button.on'); return b ? b.getAttribute('data-h2') : null; });
const clickSel = async (p, sel) => { const ok = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel); await W(p, 650); return ok; };
const header = (p) => p.evaluate(() => { const w = document.getElementById('h2Ws'); return w ? { crumb: w.querySelector('.h2-crumb').innerText, on: (w.querySelector('.h2-tabs button.on') || {}).innerText || null, tabs: [...w.querySelectorAll('.h2-tabs button')].map((b) => b.innerText) } : null; });
const visibleBefore = (p, marker) => p.evaluate((m) => { const t = document.getElementById('mainContent').innerText; const i = t.indexOf(m); return i < 0 ? t : t.slice(0, i); }, marker);
try {
  const on = await session('admin'); const p = on.page; const errs0 = on.pageErrors.length;

  // ---- 1 sidebar: every item opens its own section, highlights itself, shows no filler or retired content
  const side = await p.evaluate(() => [...document.querySelectorAll('#h2Side button')].map((b) => ({ id: b.getAttribute('data-h2'), label: b.innerText })));
  check('sidebar has exactly the nine sections in order', JSON.stringify(side.map((s) => s.label)) === JSON.stringify(['Home', 'SRV Farsi', 'SRV English', 'Analytics', 'Finance', 'Brain', 'Engineering', 'Integrations', 'Access / Settings']), side.map((s) => s.label).join(' | '));
  const expect = { home: /Your two businesses/i, 'biz:SRV Farsi': /SRV Farsi/, 'biz:SRV English': /SRV English/, analytics: /YOUTUBE ANALYTICS/i, finance: /Income|Expenses|Debt/i, brain: /./, engineering: /Engineering|Brain/i, integrations: /YouTube|Integration/i, settings: /Profile|PIN|Settings/i };
  for (const s of side) {
    await clickSel(p, `#h2Side button[data-h2="${s.id}"]`); const t = await text(p), h = await hl(p);
    check(`sidebar "${s.label}" opens its section and highlights itself`, h === s.id && expect[s.id].test(t) && t.length > 40, `highlight=${h}`);
    check(`sidebar "${s.label}": no department-dashboard filler, no retired business`, !FILLER.test(t) && !RETIRED.test(t) && !(await p.evaluate(() => /Operations|Technology/.test((document.querySelector('#mainContent h1,#mainContent .h2-title') || {}).innerText || ''))), (t.match(FILLER) || t.match(RETIRED) || [''])[0]);
  }

  // ---- 2 Home: every card, row and button goes to the right place, and Home is one click away from everywhere
  const homeTargets = async () => { await clickSel(p, '#h2Side button[data-h2="home"]'); return p.evaluate(() => [...document.querySelectorAll('#mainContent [data-h2]')].map((e, i) => ({ i, id: e.getAttribute('data-h2'), label: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) }))); };
  const targets = await homeTargets();
  check('Home offers links only to destinations that exist (no dead or double-labelled links)', targets.length >= 14 && targets.every((t) => /^(finance|analytics|biz:SRV (Farsi|English)|ws:SRV (Farsi|English):(overview|production|packages|analytics))$/.test(t.id)), targets.map((t) => t.id).join(','));
  for (const t of targets) {
    await clickSel(p, '#h2Side button[data-h2="home"]');
    await p.evaluate((i) => document.querySelectorAll('#mainContent [data-h2]')[i].click(), t.i); await W(p, 700);
    const h = await hl(p), hd = await header(p), tx = await text(p);
    let ok, d = `${t.id} → highlight=${h}`;
    if (t.id === 'finance') ok = h === 'finance' && /Income|Expenses|Debt/i.test(tx);
    else if (t.id === 'analytics') ok = h === 'analytics' && /YOUTUBE ANALYTICS/i.test(tx) && !hd;
    else { const m = /^(?:biz:|ws:)(SRV (?:Farsi|English))(?::(\w+))?$/.exec(t.id); const tab = { overview: 'Overview', production: 'Production', packages: 'Packages', analytics: 'Analytics' }[m[2] || 'overview']; ok = h === 'biz:' + m[1] && !!hd && hd.on === tab && hd.crumb.includes(m[1]); d += ` header=${hd && hd.on}`; }
    check(`Home control "${t.label}" (${t.id}) opens the right destination`, ok, d);
  }

  // ---- 3 business workspaces: four tabs, each scoped to ONE business, return paths, no mixing
  for (const [biz, other] of [[FARSI, ENG], [ENG, FARSI]]) {
    await clickSel(p, `#h2Side button[data-h2="biz:${biz}"]`);
    let hd = await header(p);
    check(`${biz} workspace: tabs Overview / Production / Packages / Analytics, Overview selected`, hd && JSON.stringify(hd.tabs) === JSON.stringify(['Overview', 'Production', 'Packages', 'Analytics']) && hd.on === 'Overview');
    for (const [tab, label] of [['overview', 'Overview'], ['production', 'Production'], ['packages', 'Packages'], ['analytics', 'Analytics']]) {
      await clickSel(p, `#h2Ws button[data-h2="ws:${biz}:${tab}"]`);
      hd = await header(p); const h = await hl(p);
      check(`${biz} › ${label}: tab and sidebar both highlight correctly`, hd && hd.on === label && h === 'biz:' + biz && hd.crumb.includes(biz), `tab=${hd && hd.on} side=${h}`);
      const t = tab === 'production' ? await visibleBefore(p, 'SHARED PLANNER') : await text(p);
      check(`${biz} › ${label}: no ${other} content, no retired business, no filler`, !NAMED[other].test(t) && !RETIRED.test(t) && !FILLER.test(t), (t.match(NAMED[other]) || t.match(RETIRED) || t.match(FILLER) || [''])[0]);
      if (tab === 'production' && fixture) check(`${biz} › Production (real data): no retired business anywhere, including the shared planner`, !RETIRED.test(await text(p)), (await text(p)).match(RETIRED)?.[0] || '');
      if (tab === 'production') check(`${biz} › Production: its own production panel is shown`, new RegExp(biz.toUpperCase()).test(await text(p)) || new RegExp(biz, 'i').test(t));
      if (tab === 'packages') check(`${biz} › Packages: the engine filter is not offered (it would let ${other} back in)`, await p.evaluate(() => { const s = document.querySelector('#pkgList select'); return !s || getComputedStyle(s).display === 'none'; }));
    }
    await clickSel(p, '#h2Ws a[data-h2="home"]');
    check(`${biz}: "← Home" returns to Home`, (await hl(p)) === 'home' && /Your two businesses/i.test(await text(p)));
  }
  // overview cards inside a workspace lead to that business's own tabs
  await clickSel(p, `#h2Side button[data-h2="biz:${FARSI}"]`);
  for (const [dest, label] of [['production', 'Production'], ['packages', 'Packages'], ['analytics', 'Analytics']]) {
    await clickSel(p, `#h2Side button[data-h2="biz:${FARSI}"]`); await clickSel(p, `#mainContent .h2-card.lnk[data-h2="ws:${FARSI}:${dest}"]`);
    const hd = await header(p); check(`${FARSI} Overview card "${label}" opens the ${label} tab`, hd && hd.on === label);
  }

  // ---- 4 sections inside the app's own screens keep the highlight truthful
  await clickSel(p, '#h2Side button[data-h2="engineering"]');
  const ebBtn = await clickSel(p, '#mainContent button[onclick="setSystemSub(\'brain_validation\')"]');
  check('Engineering › Brain Validation button keeps Engineering highlighted', ebBtn ? (await hl(p)) === 'engineering' : true, `highlight=${await hl(p)}`);
  await clickSel(p, '#h2Side button[data-h2="integrations"]');
  check('Integrations opens alone (no sub-tab row that repeats the sidebar)', !(await p.evaluate(() => !!document.querySelector('#mainContent button[onclick="setSystemSub(\'settings\')"]'))));
  await clickSel(p, '#h2Side button[data-h2="finance"]');
  check('Finance opens the Finance screen without a department-dashboard header', !FILLER.test(await text(p)) && !/^\s*finance\s*$/im.test((await text(p)).split('\n')[0] || ''));
  await clickSel(p, '#h2Side button[data-h2="analytics"]');
  check('Analytics (sidebar) shows both businesses and no business header', (await header(p)) === null && /Silk Road/i.test(await text(p)) && /Studio English/i.test(await text(p)));
  // legacy deep calls land in the right place
  for (const [call, want] of [["renderTab('tasks')", 'biz:' + ENG], ["renderTab('packages')", 'biz:' + ENG], ["renderTab('constitution')", 'brain'], ["renderTab('settings')", 'settings'], ["renderTab('integrations')", 'integrations'], ["renderTab('finance')", 'finance'], ["renderTab('engines')", 'analytics']]) {
    await clickSel(p, `#h2Side button[data-h2="biz:${ENG}"]`);   // establishes the last-used business
    await p.evaluate((c) => { (0, eval)(c); }, call); await W(p, 700);
    check(`router call ${call} lands on ${want}`, (await hl(p)) === want, `highlight=${await hl(p)}`);
  }
  await p.evaluate(() => { renderTab('home'); }); await W(p, 400);

  // ---- 5 keyboard and accessibility
  check('active sidebar item is marked aria-current', await p.evaluate(() => document.querySelectorAll('#h2Side button[aria-current="page"]').length === 1));
  const kb = await p.evaluate(async () => { const r = document.querySelector('#mainContent .h2-kv[data-h2="ws:SRV Farsi:analytics"]'); if (!r) return false; r.focus(); r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((x) => setTimeout(x, 600)); return document.querySelector('#h2Ws .h2-tabs button.on')?.innerText === 'Analytics'; });
  check('Enter on a Home row opens its destination (keyboard)', kb);
  check('no page errors during the whole Admin audit', on.pageErrors.length === errs0, on.pageErrors.slice(errs0).join(' | '));
  const log = (await fetchJson(stub.origin + '/__stub/log')).log;
  const bad = log.filter((e) => e.method !== 'GET' && e.method !== 'HEAD').map((e) => `${e.method} ${e.path}`).filter((w) => /packages|youtube_videos|youtube_channels/.test(w) && !/upsert|state/.test(w));
  check('navigating adds no write to packages or YouTube tables', bad.length === 0, bad.join(', '));
  await p.close();

  // ---- 6 mobile: sections and workspace tabs stay usable
  const mob = await session('admin', { width: 375, height: 812 }); const mp = mob.page;
  for (const id of ['home', `biz:${FARSI}`, `biz:${ENG}`, 'analytics', 'finance', 'brain', 'engineering', 'integrations', 'settings']) {
    await clickSel(mp, `#h2Side button[data-h2="${id}"]`);
    check(`mobile: "${id}" opens without horizontal overflow`, (await text(mp)).length > 40 && !(await hOverflow(mp)), `overflow=${await hOverflow(mp)}`);
  }
  await clickSel(mp, `#h2Side button[data-h2="biz:${FARSI}"]`);
  for (const tab of ['production', 'packages', 'analytics']) { await clickSel(mp, `#h2Ws button[data-h2="ws:${FARSI}:${tab}"]`); check(`mobile: ${FARSI} › ${tab} tab opens and fits`, (await header(mp)) && !(await hOverflow(mp))); }
  check('mobile: no page errors', mob.pageErrors.length === 0, mob.pageErrors.join(' | '));
  await mp.close();

  // ---- 7 Family and VA: their own navigation, every control works, no Admin chrome or Admin-only data
  for (const role of ['family', 'va']) {
    const o = await session(role); const fp = o.page; const e0 = o.pageErrors.length;
    check(`${role}: no Admin sidebar`, (await fp.evaluate(() => !document.getElementById('h2Side'))));
    const navs = await fp.evaluate(() => [...document.querySelectorAll('#navBar button')].filter((b) => b.getBoundingClientRect().width > 0).map((b, i) => ({ i, t: b.innerText.replace(/\s+/g, ' ').trim() })));
    for (const n of navs) {
      await fp.evaluate((i) => [...document.querySelectorAll('#navBar button')].filter((b) => b.getBoundingClientRect().width > 0)[i].click(), n.i); await W(fp, 600);
      const t = await text(fp);
      check(`${role}: nav "${n.t}" opens content`, t.length > 20, `len=${t.length}`);
      check(`${role}: nav "${n.t}" shows no Admin-only controls (PIN change, reset, developer options, publishing setup)`, !/Reset All Data|DEVELOPER OPTIONS|Set VA PIN|Change PIN|Require sign-in/i.test(t), (t.match(/Reset All Data|DEVELOPER OPTIONS|Set VA PIN|Change PIN|Require sign-in/i) || [''])[0]);
    }
    check(`${role}: no page errors`, o.pageErrors.length === e0, o.pageErrors.slice(e0).join(' | '));
    await fp.close();
  }
} finally { await browser.close(); await stub.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
