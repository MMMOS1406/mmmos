// MMMOS Engineering Integration R2 — Engineering Workers / CEO Adviser / runner button
// escaping test. Renders the REAL panels (public/index.html) in headless Chrome, signed in
// as the synthetic admin, with markup AND attribute break-outs planted in every value they
// show (pairing labels are attacker-controlled: pairing requests need no login).
// Run: PUPPETEER_CORE=<dir> node tests/preservation/engineering-r2-screens.mjs [--public DIR]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, login } from './driver.mjs';
import { startStub } from './stub-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pi = args.indexOf('--public');
const publicDir = path.resolve(pi >= 0 ? args[pi + 1] : path.join(here, '../../public'));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && x ? '  — ' + x : ''}`); };

const TAG = (n) => `<img data-pwn src="x" onerror="window.__pwned=(window.__pwned||0)+1" alt="${n}">`;
const BREAK = (n) => `x" data-pwn="1" onmouseover="window.__pwned=1" title="${n}`;   // attribute break-out
const JSBREAK = `x'); window.__pwned=1; ('`;                                            // inline-JS break-out
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WORKERS = {
  ok: true, advisersOk: true,
  pending: [{ id: uuid(1), label: `Pairing ${TAG('pairing')} ${BREAK('pb')}`, created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-01T00:15:00Z' }],
  workers: [{ id: uuid(2), label: `Worker ${JSBREAK} ${BREAK('wb')} ${TAG('worker')}`, active: true, created_at: '2026-10-01T00:00:00Z' }],
  advisers: [{ id: `${uuid(3)}" data-pwn="1`, label: `Adviser ${TAG('adviser')} ${BREAK('ab')} ${JSBREAK}`, active: true, created_at: '2026-10-01T00:00:00Z' },
             { id: uuid(4), label: 'Old adviser', active: false, created_at: '2026-09-01T00:00:00Z', revoked_at: '2026-09-02T00:00:00Z' }],
};
const task = (n, packet) => ({ id: uuid(10 + n), status: 'open', problem: `Task ${n}`, affected_engine: 'x', packet });
const REVIEW = {
  ok: true, packets: [], releasePackets: [], needsReauth: [], retroactiveReleases: [],
  pendingAuth: [
    task(1, { derived_from: 'ceo_adviser_submission', business: 'mmmos', origin_decision: { authorization_boundary: 'only docs/platform' } }),
    task(2, { business: 'srv_english', origin_decision: { authorization_boundary: 'b' } }),   // no runner folders → no button
    task(3, { business: 'mmmos' }),                                                           // no boundary → no button
    { ...task(4, { business: 'nextwave', origin_decision: { authorization_boundary: 'b' } }), id: `${uuid(14)}" data-pwn="1` },
  ],
};

const stub = await startStub({ publicDir });
const browser = await launch();
try {
  const { page, pageErrors } = await openPage(browser, stub.origin);
  await login(page, stub.origin, 'admin');
  const out = await page.evaluate(async (workers, review) => {
    window.__pwned = 0;
    const root = document.getElementById('appScreen') || document.body;
    const render = async (sub, data) => {
      _ebV2Cache[sub] = data;
      renderTab('system'); if (typeof setSystemSub === 'function') setSystemSub('engineering');
      _ebSetSub(sub);
      await new Promise(r => setTimeout(r, 600));
      // fire hover handlers on everything, in case an attribute break-out planted one
      root.querySelectorAll('*').forEach(el => { try { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } catch {} });
      await new Promise(r => setTimeout(r, 200));
      return { text: root.innerText, planted: root.querySelectorAll('[data-pwn]').length, onerrors: [...root.querySelectorAll('img')].filter(i => i.getAttribute('onerror')).length };
    };
    const w = await render('b2_workers', workers);
    const advBtns = [...root.querySelectorAll('[data-eng-adviser] button')].map(b => ({ id: b.dataset.id, handler: b.getAttribute('onclick') }));
    const workerBtn = [...root.querySelectorAll('button')].find(b => /_engWorkerRevoke/.test(b.getAttribute('onclick') || ''));
    const workerBtnInfo = workerBtn ? { id: workerBtn.dataset.id, label: workerBtn.dataset.label, handler: workerBtn.getAttribute('onclick') } : null;
    const createBtn = [...root.querySelectorAll('button')].some(b => /_engAdviserCreate/.test(b.getAttribute('onclick') || ''));
    const r = await render('b2_engreview', review);
    const runnerBtns = [...root.querySelectorAll('[data-eng-runner-btn]')].map(b => ({ id: b.dataset.id, text: b.innerText }));
    return { pwned: window.__pwned, w, r, advBtns, workerBtnInfo, createBtn, runnerBtns };
  }, WORKERS, REVIEW);

  ok('workers panel: no planted element and no handler ran', out.pwned === 0 && out.w.planted === 0 && out.w.onerrors === 0, JSON.stringify({ pwned: out.pwned, planted: out.w.planted }));
  ok('pairing, worker and adviser names appear as plain text', out.w.text.includes('<img data-pwn') && out.w.text.includes(`x" data-pwn="1" onmouseover`) && out.w.text.includes(`x'); window.__pwned=1; ('`));
  ok('worker revoke button carries the name only as data (handler has no spliced text)', !!out.workerBtnInfo && out.workerBtnInfo.handler === '_engWorkerRevoke(this.dataset.id,this.dataset.label)' && out.workerBtnInfo.label.includes(`x'); window.__pwned=1;`));
  ok('adviser section: Create button, one Revoke for the active adviser only', out.createBtn && out.advBtns.length === 1 && out.advBtns[0].handler === '_engAdviserRevoke(this.dataset.id)' && out.advBtns[0].id === `${uuid(3)}" data-pwn="1`);
  ok('revoked adviser shows as REVOKED with no button', /REVOKED/.test(out.w.text));
  ok('engineering review: no planted element and no handler ran', out.r.planted === 0 && out.pwned === 0);
  ok('runner button only where the business has runner folders AND a boundary exists', out.runnerBtns.length === 2 && out.runnerBtns.some(b => b.id === uuid(11) && /mmmos folders only/.test(b.text)) && out.runnerBtns.some(b => /nextwave folders only/.test(b.text)));
  ok('runner button id is data, never spliced into the handler', out.runnerBtns.some(b => b.id === `${uuid(14)}" data-pwn="1`));
  ok('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
