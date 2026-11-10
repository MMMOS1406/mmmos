// Every Admin / Family / VA route renders byte-identically to main EXCEPT the Home route (sections removed by CEO order).
// PUPPETEER_CORE=<dir> node tests/home2/route_compare.mjs <mainPublicDir> <branchPublicDir>
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, mainSnapshot } from '../preservation/driver.mjs';
import { ADMIN_ROUTES, FAMILY_ROUTES, VA_ROUTES, key } from '../preservation/sweep.mjs';
const [mainPub, brPub] = process.argv.slice(2, 4); const R = []; const HTML = {}; globalThis.__PUB = mainPub;
const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
async function run(pub, role, routes) {
  const stub = await startStub({ publicDir: fs.realpathSync(pub) }); const browser = await launch();
  try {
    const { page } = await openPage(browser, stub.origin); await login(page, stub.origin, role); const out = {};
    for (const r of routes) { for (let pass = 0; pass < 2; pass++) { await page.evaluate((route) => { try { renderTab(route.id); if (route.sub) window[route.sub[0]](route.sub[1]); } catch (e) {} }, r); await settle(page, stub.origin, 1200); }   // two passes: the first lets every lazy loader finish (main's Home render races them, the new Home does not), the second is the one compared
     out[key(r)] = (await page.evaluate(() => (document.getElementById('mainContent') || { innerHTML: '' }).innerHTML.replace(/(<canvas\b[^>]*?)\swidth="\d+"/g, '$1').replace(/(<canvas\b[^>]*?)\sheight="\d+"/g, '$1').replace(/Loaded [^<]*</g, 'Loaded <')));   // also ignore the wall-clock "Loaded <time>" stamps   // chart canvases size themselves to the content column (wider with the sidebar layout): compare everything except their pixel width/height
    HTML[role + '|' + key(r) + '|' + (pub === globalThis.__PUB ? 'main' : 'branch')] = out[key(r)];
    out[key(r)] = String(out[key(r)].length) + ':' + out[key(r)].split('').reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7); }
    return out;
  } finally { await browser.close(); await stub.close(); }
}
for (const [role, routes] of [['admin', ADMIN_ROUTES], ['family', FAMILY_ROUTES], ['va', VA_ROUTES]]) {
  const a = await run(mainPub, role, routes), b = await run(brPub, role, routes);
  const diff = Object.keys(a).filter((k) => a[k] !== b[k]);
  const allowed = (k) => /^(home|social_media_manager)\b/.test(k);   // Home (sections removed by CEO order); social_media_manager is a retired route that now falls through to Home
  check(`${role}: ${Object.keys(a).length} routes compared; only Home may differ`, diff.every(allowed), `differing: ${diff.join(', ') || 'none'}`);
  for (const k of diff.filter((x) => !allowed(x))) { const m = HTML[role + '|' + k + '|main'] || '', b = HTML[role + '|' + k + '|branch'] || ''; let i = 0; while (i < m.length && m[i] === b[i]) i++; console.log(`  first difference in ${k} at ${i}/${m.length}/${b.length}\n    main  : ${JSON.stringify(m.slice(Math.max(0, i - 100), i + 160))}\n    branch: ${JSON.stringify(b.slice(Math.max(0, i - 100), i + 160))}`); }
}
const f = R.filter((x) => !x).length; console.log(`${R.length - f}/${R.length}`); process.exit(f ? 1 : 0);
