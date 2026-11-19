// Release gate: which signed-in roles run upload detection? (real Chrome, stub server, synthetic). node tests/upload/e2e_role_polling.mjs [publicDir]
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public');
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const stub = await startStub({ publicDir: pub, fixture: makeFixture(), quiet: true }); const browser = await launch();
try {
  const { users } = await (async () => { const { page } = await openPage(browser, stub.origin, { realClock: true }); await page.waitForFunction(() => typeof USERS !== 'undefined'); const users = await page.evaluate(() => USERS.map((u) => ({ id: u.id, role: u.role || null }))); await page.close(); return { users }; })();
  const roles = ['admin', 'va', ...users.filter((u) => /family/i.test(u.id + (u.role || '')) ).map((u) => u.id).slice(0, 1)];
  const seen = {};
  for (const id of roles) {
    const { page, pageErrors } = await openPage(browser, stub.origin, { realClock: true });
    await page.evaluateOnNewDocument(() => { window.__sync = []; const f = window.fetch; window.fetch = function (u, i) { try { if (String(u && u.url || u).indexOf('youtube_sync_performance') >= 0) window.__sync.push(JSON.stringify((i && i.headers) || {})); } catch (e) {} return f.apply(this, arguments); }; });
    await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, id); await settle(page, stub.origin, 2500);
    seen[id] = { sync: await page.evaluate(() => window.__sync), errors: pageErrors.length, bell: await page.evaluate(() => { const b = document.getElementById('notifBell'); return !!b && b.style.display !== 'none'; }) }; await page.close();
  }
  ok('CEO (admin) tab: runs detection with the CEO session header', seen.admin.sync.length >= 1 && /X-MMM-CEO-Session/.test(seen.admin.sync[0]), seen.admin);
  ok('VA tab: never polled before and does not now (polling is an admin-tab feature) — so the CEO-session requirement removes nothing from VA operations; no alarm, no page error', seen.va.sync.length === 0 && seen.va.errors === 0 && !seen.va.bell, seen.va);
  for (const id of roles.filter((x) => x !== 'admin' && x !== 'va')) ok('family tab ' + id + ': no detection requests', seen[id].sync.length === 0, seen[id]);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
