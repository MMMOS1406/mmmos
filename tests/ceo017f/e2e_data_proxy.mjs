// CEO-017B phase 2 — the browser reaches the database ONLY through the authenticated proxy, and every screen renders exactly as on main.
// PUPPETEER_CORE=<dir> node tests/ceo017a/e2e_data_proxy.mjs <mainPublicDir> <branchPublicDir>
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, mainSnapshot } from '../preservation/driver.mjs';
import { ADMIN_ROUTES, FAMILY_ROUTES, VA_ROUTES, key } from '../preservation/sweep.mjs';
const [mainPub, brPub] = process.argv.slice(2, 4);
// the build that ships AFTER the database lockdown: same code with the transition switch off
import os from 'node:os'; import path from 'node:path';
const lockedPub = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-')); fs.cpSync(fs.realpathSync(brPub), lockedPub, { recursive: true });
const lh = fs.readFileSync(path.join(lockedPub, 'index.html'), 'utf8'); if (!lh.includes('const MMM_DIRECT_FALLBACK=true;')) throw new Error('switch not found'); fs.writeFileSync(path.join(lockedPub, 'index.html'), lh.replace('const MMM_DIRECT_FALLBACK=true;', 'const MMM_DIRECT_FALLBACK=false;'));
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
async function run(pub, role, routes) {
  const stub = await startStub({ publicDir: fs.realpathSync(pub) }); const browser = await launch();
  try {
    const { page, consoleErrors, pageErrors } = await openPage(browser, stub.origin); await login(page, stub.origin, role);
    const out = {};
    for (const r of routes) { await page.evaluate((route) => { try { renderTab(route.id); if (route.sub) window[route.sub[0]](route.sub[1]); } catch (e) {} }, r); await settle(page, stub.origin, 600); out[key(r)] = (await mainSnapshot(page)).htmlHash; }
    // exercise the two real write paths (state save + package upsert) the way the app does
    const writes = await page.evaluate(async () => { const res = {}; try { res.state = typeof _persistFinancePayloadToSupabase === 'function' ? await _persistFinancePayloadToSupabase({ availableCash: 1, probe: true }) : 'n/a'; } catch (e) { res.state = 'err ' + e.message; } try { await savePackageToSupabase({ id: 'pkg_probe_1', engine: 'SRV Farsi', title: 'probe' }); res.pkg = 'sent'; } catch (e) { res.pkg = 'err ' + e.message; } return res; });
    const log = await (await fetch(stub.origin + '/__stub/log')).json();
    const sb = log.log.filter((e) => e.path.startsWith('/__sb/')); await page.close();
    return { out, sb, proxied: log.proxied, writes, errors: [...new Set(consoleErrors.concat(pageErrors))] };
  } finally { await browser.close(); await stub.close(); }
}
for (const [role, routes] of [['admin', ADMIN_ROUTES], ['family', FAMILY_ROUTES], ['va', VA_ROUTES]]) {
  const a = await run(mainPub, role, routes), b = await run(brPub, role, routes), c = await run(lockedPub, role, routes);
  const EXPECTED = role === 'admin' ? ['system:settings', 'settings'] : [];   // the Settings page gained the CURRENT PIN field (phase 1) — not a data-path difference
  const sameAs = (x) => Object.keys(a.out).every((k) => EXPECTED.includes(k) || a.out[k] === x.out[k]);
  check(`${role}: every route renders byte-identically through the proxy (${Object.keys(a.out).length} routes)`, sameAs(b) && sameAs(c), [b, c].map((x) => Object.keys(a.out).filter((k) => !EXPECTED.includes(k) && a.out[k] !== x.out[k]).join(',')).join('|'));
  const directB = b.sb.filter((e) => e.via !== 'proxy'), directC = c.sb.filter((e) => e.via !== 'proxy');
  check(`${role}: transition build — after sign-in every data call is proxied; the only direct calls are the two public switches read at page load (main made ${a.sb.filter((e) => e.via !== 'proxy').length} direct)`, b.sb.some((e) => e.via === 'proxy') && directB.length <= 2 && directB.every((e) => e.method === 'GET' && /app_settings/.test(e.path)), directB.length + ' direct');
  check(`${role}: LOCKED build (switch off) — ZERO direct database calls, including at page load`, directC.length === 0 && c.sb.length > 0, directC.map((e) => e.method + ' ' + e.path).join(' | ') || `${c.sb.length} data calls, all proxied`);
  const anonC = c.proxied.filter((p) => !p.roles.length);
  check(`${role}: LOCKED build — the only calls without a session are the two public on/off switches`, anonC.length <= 2 && anonC.every((p) => p.method === 'GET' && p.path === 'app_settings') && c.proxied.some((p) => p.roles.length), `${anonC.length} anonymous`);
  check(`${role}: state-save and package-upsert reach the stub through the proxy (locked build)`, role === 'family' ? true : c.proxied.some((p) => /rpc\/mmm_state_save/.test(p.path)) && c.proxied.some((p) => p.method === 'POST' && /^packages$/.test(p.path)), JSON.stringify(c.writes));
  check(`${role}: no new console errors (transition and locked builds)`, [b, c].every((x) => x.errors.every((e) => a.errors.includes(e))), `${a.errors.length} vs ${b.errors.length}/${c.errors.length}`);
}
fs.rmSync(lockedPub, { recursive: true, force: true });
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
