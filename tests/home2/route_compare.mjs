// Every Admin / Family / VA route renders byte-identically to main EXCEPT the Home route (sections removed by CEO order).
// PUPPETEER_CORE=<dir> node tests/home2/route_compare.mjs <mainPublicDir> <branchPublicDir>
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, mainSnapshot } from '../preservation/driver.mjs';
import { ADMIN_ROUTES, FAMILY_ROUTES, VA_ROUTES, key } from '../preservation/sweep.mjs';
const [mainPub, brPub] = process.argv.slice(2, 4); const R = [];
const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
async function run(pub, role, routes) {
  const stub = await startStub({ publicDir: fs.realpathSync(pub) }); const browser = await launch();
  try {
    const { page } = await openPage(browser, stub.origin); await login(page, stub.origin, role); const out = {};
    for (const r of routes) { await page.evaluate((route) => { try { renderTab(route.id); if (route.sub) window[route.sub[0]](route.sub[1]); } catch (e) {} }, r); await settle(page, stub.origin, 600); out[key(r)] = (await mainSnapshot(page)).htmlHash; }
    return out;
  } finally { await browser.close(); await stub.close(); }
}
for (const [role, routes] of [['admin', ADMIN_ROUTES], ['family', FAMILY_ROUTES], ['va', VA_ROUTES]]) {
  const a = await run(mainPub, role, routes), b = await run(brPub, role, routes);
  const diff = Object.keys(a).filter((k) => a[k] !== b[k]);
  const allowed = (k) => /^(home|social_media_manager)\b/.test(k);   // Home (sections removed by CEO order); social_media_manager is a retired route that now falls through to Home
  check(`${role}: ${Object.keys(a).length} routes compared; only Home may differ`, diff.every(allowed), `differing: ${diff.join(', ') || 'none'}`);
}
const f = R.filter((x) => !x).length; console.log(`${R.length - f}/${R.length}`); process.exit(f ? 1 : 0);
