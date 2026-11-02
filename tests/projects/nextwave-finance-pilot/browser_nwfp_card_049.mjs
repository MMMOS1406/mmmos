// Order 049 — NextWave Finance Pilot L2 card in the REAL CEO Engineering Review (public/index.html),
// headless Chrome, synthetic admin from the preservation fixtures. The card's single read is answered
// with a stand-in status built by the real pilot module; nothing reaches production.
// Run: PUPPETEER_CORE=<dir> node tests/projects/nextwave-finance-pilot/browser_nwfp_card_049.mjs [--shot FILE]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, login } from '../../preservation/driver.mjs';
import { startStub } from '../../preservation/stub-server.mjs';
import { buildStatus } from '../../../projects/nextwave-finance-pilot/lib/pilotState.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../../public');
const args = process.argv.slice(2); const si = args.indexOf('--shot'); const shot = si >= 0 ? args[si + 1] : null;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && x ? '  — ' + x : ''}`); };

const status = buildStatus({ stateValue: null, writesFlag: false, tasks: [], evidence: [], environment: 'production' });
const CACHE = { ok: true, packets: [], pendingAuth: [], needsReauth: [], retroactiveReleases: [], releasePackets: [] };
const stub = await startStub({ publicDir });
const browser = await launch();
try {
  const { page, pageErrors, blocked } = await openPage(browser, stub.origin);
  await login(page, stub.origin, 'admin');
  const blockedBefore = blocked.length;
  const out = await page.evaluate(async (cache, st) => {
    const calls = [];
    window._ceoAuthedFetch = async (url, body) => { calls.push(url); return { json: async () => ({ ok: true, status: st }) }; };
    _ebV2Cache['b2_engreview'] = cache;
    renderTab('system');
    if (typeof setSystemSub === 'function') setSystemSub('engineering');
    _ebSetSub('b2_engreview');
    await new Promise((r) => setTimeout(r, 300));
    const card = document.querySelector('[data-nwfp-card]');
    const before = card ? card.innerText : '';
    const artifactsBefore = !!document.querySelector('[data-eng-artifacts]');
    const panelCalls = calls.splice(0); // the panel's own existing loads (e.g. engineering_task_list), not the card
    card && card.querySelector('button').click();
    await new Promise((r) => setTimeout(r, 300));
    const body = document.getElementById('nwfp-card-body');
    card && card.scrollIntoView();
    return {
      hasCard: !!card, before, artifactsBefore, calls, panelCalls,
      text: body ? body.innerText : '', badges: [...document.querySelectorAll('[data-nwfp-badge]')].map(b => b.getAttribute('data-nwfp-badge')),
      stages: [...document.querySelectorAll('[data-nwfp-stage]')].map(e => e.getAttribute('data-nwfp-stage')),
      buttons: card ? card.querySelectorAll('button').length : 0, inputs: card ? card.querySelectorAll('input,textarea,select').length : 0,
      panel: (document.getElementById('appScreen') || document.body).innerText.includes('CEO ENGINEERING REVIEW'),
    };
  }, CACHE, status);
  ok('the CEO Engineering Review still renders, with Stored artifacts and the new pilot card', out.panel && out.artifactsBefore && out.hasCard);
  ok('SHOW makes exactly one read, nwfp_status, through the CEO session helper', out.calls.length === 1 && out.calls[0] === '/api/ops?action=nwfp_status', out.calls.join(','));
  ok('the card makes no request until SHOW is clicked', !out.panelCalls.some(u => /nwfp_/.test(u)), out.panelCalls.join(','));
  ok('the card shows identity, REGISTERED, NOT OPERATIONAL, generation and publishing DISABLED',
    out.text.includes('NextWave Finance Pilot (nextwave_finance_pilot)') && out.badges.includes('REGISTERED') && out.badges.includes('NOT OPERATIONAL') && out.badges.filter(b => b === 'DISABLED').length === 2, out.badges.join(','));
  ok('all 8 lifecycle stages are listed; only registration is LIVE', out.stages.length === 8 && out.badges.filter(b => b === 'LIVE').length === 1);
  ok('L1 shows DEPLOYED \u2014 WRITES OFF and L2 DEPLOYED \u2014 READ ONLY; checkpoint 050', out.badges.includes('DEPLOYED \u2014 WRITES OFF') && out.badges.includes('DEPLOYED \u2014 READ ONLY') && out.text.includes('050'), out.badges.join(','));
  ok('the card is read-only (one button, no inputs)', out.buttons === 1 && out.inputs === 0);
  ok('no page errors and no outside requests while rendering', pageErrors.length === 0 && blocked.length === blockedBefore, pageErrors.concat(blocked.slice(blockedBefore)).join(' | ').slice(0, 300));
  if (shot) {
    const el = await page.$('[data-nwfp-card]');
    await el.screenshot({ path: shot });
    console.log('screenshot saved: ' + shot);
  }
} finally {
  await browser.close(); await stub.close?.();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
