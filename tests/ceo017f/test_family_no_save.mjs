// Stage 1 follow-up — a Family session never sends a shared-state write (the server refuses it and the app would show "save failed"); CEO and VA still save.
// PUPPETEER_CORE=<dir> node tests/ceo017f/test_family_no_save.mjs [publicDir]     (publicDir defaults to ./public; pass main's public to see the problem)
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { launch, openPage, login, settle, fetchJson } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || new URL('../../public', import.meta.url).pathname);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const stub = await startStub({ publicDir: pub }); const browser = await launch();
const saves = async () => (await fetchJson(stub.origin + '/__stub/log')).log.filter((e) => e.method === 'POST' && (e.rpc === 'mmm_state_save' || /mmm_state_save/.test(e.path || ''))).length;
try {
  const out = {};
  for (const role of ['family', 'admin', 'va']) {
    await fetchJson(stub.origin + '/__stub/reset');
    const o = await openPage(browser, stub.origin); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 1200);
    const atLoad = await saves();
    await o.page.evaluate(async () => { await saveAppState(); });   // an explicit save, as any screen's save button does
    await settle(o.page, stub.origin, 800);
    const total = await saves();
    const badge = await o.page.evaluate(() => { const b = document.getElementById('savedBadge'); return b ? b.innerText : ''; });
    out[role] = { atLoad, total, badge };
    await o.page.close();
  }
  check('Family: no shared-state write at load', out.family.atLoad === 0, JSON.stringify(out.family));
  check('Family: an explicit save sends no write either', out.family.total === 0);
  check('Family: no "save failed" badge', !/fail/i.test(out.family.badge));
  check('CEO still saves at load and on demand', out.admin.atLoad >= 1 && out.admin.total > out.admin.atLoad, JSON.stringify(out.admin));
  check('VA still saves on demand', out.va.total >= 1, JSON.stringify(out.va));
} finally { await browser.close(); await stub.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
