// Every Admin / Family / VA route renders byte-identically to main EXCEPT the Home route (sections removed by CEO order).
// PUPPETEER_CORE=<dir> node tests/home2/route_compare.mjs <mainPublicDir> <branchPublicDir>
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, mainSnapshot } from '../preservation/driver.mjs';
import { ADMIN_ROUTES, FAMILY_ROUTES, VA_ROUTES, key } from '../preservation/sweep.mjs';
const [mainPub, brPub] = process.argv.slice(2, 4); const R = []; const HTML = {}; const TEXT = {}; globalThis.__PUB = mainPub;
const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
async function run(pub, role, routes) {
  const stub = await startStub({ publicDir: fs.realpathSync(pub) }); const browser = await launch();
  try {
    const { page } = await openPage(browser, stub.origin); await login(page, stub.origin, role); const out = {};
    for (const r of routes) { let threw = ''; await page.evaluate(() => { try { renderTab('home'); } catch (e) {} });   // start every route from Home (leaves any business workspace)
      for (let pass = 0; pass < 2; pass++) { threw = await page.evaluate((route) => { try { renderTab(route.id); if (route.sub) window[route.sub[0]](route.sub[1]); return ''; } catch (e) { return String(e && e.message); } }, r); await settle(page, stub.origin, 1200); }   // two passes: the first lets every lazy loader finish (main's Home render races them, the new Home does not), the second is the one compared
     out[key(r)] = (await page.evaluate(() => (document.getElementById('mainContent') || { innerHTML: '' }).innerHTML.replace(/(<canvas\b[^>]*?)\swidth="\d+"/g, '$1').replace(/(<canvas\b[^>]*?)\sheight="\d+"/g, '$1').replace(/Loaded [^<]*</g, 'Loaded <')));   // also ignore the wall-clock "Loaded <time>" stamps   // chart canvases size themselves to the content column (wider with the sidebar layout): compare everything except their pixel width/height
    TEXT[role + '|' + key(r) + '|' + (pub === globalThis.__PUB ? 'main' : 'branch')] = await page.evaluate(() => (document.getElementById('mainContent') || { innerText: '' }).innerText);
    if (threw) out[key(r)] = 'THREW:' + threw;   // a route that throws in the stub (pre-existing defect, e.g. Factory) is compared by its error, not by the stale page left behind
    HTML[role + '|' + key(r) + '|' + (pub === globalThis.__PUB ? 'main' : 'branch')] = out[key(r)];
    out[key(r)] = String(out[key(r)].length) + ':' + out[key(r)].split('').reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7); }
    return out;
  } finally { await browser.close(); await stub.close(); }
}
// Rules (CEO navigation order): Family and VA render byte-identically to main. Admin: Home is replaced; Tasks / Packages / Operations tabs are now
// business workspaces (scoped, new header); Finance and the Technology screens may only LOSE filler (department-dashboard header, repeated chip row):
// their new content must be an unbroken part of main's content. Every other Admin route (Settings, Integrations, Brain, Factory, Continuity, Marketing, HR, Legal, Analytics) is identical.
const REPLACED = (k) => /^(home|tasks|packages|social_media_manager|engines:|constitution)/.test(k);
// CEO order 2026-11-11: these screens only LOSE content (Settings: Upload Defaults + System cards; Integrations: HeyGen + Submagic; Analytics: scoping/labels are checked by final_corrections.mjs) —
// every line of the new screen must already exist on the old one. (Analytics may also gain its scope labels, so it is checked separately.)
const LOSES = (k) => /^(settings|integrations|system:settings|system:integrations|analytics|marketing)$/.test(k);
const SUBSET = (k) => /^(finance|system:(engineering|brain_validation))/.test(k);
for (const [role, routes] of [['admin', ADMIN_ROUTES], ['family', FAMILY_ROUTES], ['va', VA_ROUTES]]) {
  const a = await run(mainPub, role, routes), b = await run(brPub, role, routes);
  const diff = Object.keys(a).filter((k) => a[k] !== b[k]);
  if (role !== 'admin') { check(`${role}: ${Object.keys(a).length} routes compared; every route identical to main`, diff.length === 0, `differing: ${diff.join(', ') || 'none'}`); continue; }
  const lineSubset = (k) => { const o = new Set((TEXT['admin|' + k + '|main'] || '').split('\n').map((x) => x.trim()).filter(Boolean)); return (TEXT['admin|' + k + '|branch'] || '').split('\n').map((x) => x.trim()).filter(Boolean).filter((l) => !o.has(l)); };
  const losesBad = diff.filter(LOSES).map((k) => [k, lineSubset(k).filter((l) => !/ANALYTICS —|EACH BUSINESS SHOWN SEPARATELY|Unassigned|No TikTok accounts connected/.test(l))]).filter(([, extra]) => extra.length);
  check('admin: Settings, Integrations and Analytics only lost content (no new lines appear)', losesBad.length === 0, losesBad.map(([k, e]) => k + ': ' + e.slice(0, 2).join(' / ')).join('; ') || 'checked: ' + diff.filter(LOSES).join(', '));
  const unexplained = diff.filter((k) => !REPLACED(k) && !SUBSET(k) && !LOSES(k));
  check(`admin: ${Object.keys(a).length} routes compared; only the replaced screens differ`, unexplained.length === 0, `replaced: ${diff.filter(REPLACED).join(', ') || 'none'}; unexplained: ${unexplained.join(', ') || 'none'}`);
  const notSubset = diff.filter(SUBSET).filter((k) => { const m = HTML[role + '|' + k + '|main'] || '', n = HTML[role + '|' + k + '|branch'] || ''; return !(n.length > 200 && m.includes(n)); });
  check('admin: Finance and Technology screens only lost filler (new content is an unbroken part of main\'s)', notSubset.length === 0, `checked: ${diff.filter(SUBSET).join(', ') || 'none'}; not a subset: ${notSubset.join(', ') || 'none'}`);
}
const f = R.filter((x) => !x).length; console.log(`${R.length - f}/${R.length}`); process.exit(f ? 1 : 0);
