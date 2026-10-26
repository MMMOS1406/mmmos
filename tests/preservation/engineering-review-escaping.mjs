// MMMOS Engineering Integration R1-UI — Engineering Review escaping regression test.
// Renders the REAL CEO Engineering Review panel (public/index.html) in headless Chrome,
// signed in as the synthetic admin from the preservation fixtures, with markup planted in
// every text field the panel shows. Passes only if no planted element is created, no
// planted handler runs, the text still appears literally, and the Authorize card shows the
// business, the authorization boundary and the task's source.
// Run: PUPPETEER_CORE=<dir> node tests/preservation/engineering-review-escaping.mjs [--public DIR]
// Never touches production: every request is served by the local stub or refused.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, login, settle } from './driver.mjs';
import { startStub } from './stub-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pi = args.indexOf('--public');
const publicDir = path.resolve(pi >= 0 ? args[pi + 1] : path.join(here, '../../public'));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && x ? '  — ' + x : ''}`); };

// Each payload carries data-pwn so a created element can be counted, and a handler that
// bumps window.__pwned so an executed one can be detected.
const P = (tag) => `<img data-pwn src="x" onerror="window.__pwned=(window.__pwned||0)+1" alt="${tag}"><b data-pwn>${tag}</b>`;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'a'.repeat(40);
const task = (n, extra = {}) => ({
  id: uuid(n), status: 'open', problem: `Problem ${n} ${P('problem' + n)}`, expected_result: `Expected ${P('expected' + n)}`,
  affected_engine: `Engine ${P('engine' + n)}`, ...extra,
});
const adviserTask = task(1, { packet: { derived_from: 'ceo_adviser_submission', submitted_by_adviser_label: `Adviser ${P('advlabel')}`, business: 'srv_farsi', origin_decision: { id: null, source: 'ceo_adviser', authorization_boundary: `Branch + PR only ${P('boundary-auth')}` } } });
const plainTask = task(2, { packet: { created_via: 'task_generator' } }); // no boundary → card must say so
const reauthTask = task(3, { agent_authorized_at: '2026-10-01T00:00:00Z', packet: { derived_from: 'engineering_worker_submission', submitted_by_worker_label: `Worker ${P('wlabel')}`, business: 'mmmos', origin_decision: { authorization_boundary: `Reauth boundary ${P('boundary-reauth')}` } } });
const retroTask = task(4, { release_kind: 'retroactive_release', git_commit_sha: SHA });
const reviewTask = task(5, { status: 'ready_for_ceo' });
const CACHE = {
  ok: true,
  pendingAuth: [adviserTask, plainTask],
  needsReauth: [reauthTask],
  retroactiveReleases: [retroTask],
  packets: [{
    ok: true, task: reviewTask,
    origin_decision: { recommendation_title: `Decision ${P('decision')}` },
    authorization_boundary: `Packet boundary ${P('boundary-packet')}`,
    agent_run_id: 'f'.repeat(32), agent_claimed_at: '2026-10-01T00:00:00Z',
    workspace_files: [{ path: `sandbox/${P('path')}.js`, baseline_hash: 'b1', current_hash: 'c1', baseline_content: 'old', current_content: 'new' }],
    test_runs: [{ test_name: `validate:${P('test')}`, status: 'passed' }],
    evidence: [{ title: `Evidence ${P('evidence')}`, evidence_type: 'note', created_at: '2026-10-01T00:00:00Z' }],
  }],
  releasePackets: [
    { ok: true, task: task(6, { ceo_decision: 'approved', ceo_decision_at: '2026-10-01T00:00:00Z' }), production_deployments: [], production_release_authorizations: [] },
    { ok: true, task: task(7, { ceo_decision: 'approved', git_commit_sha: SHA }), production_deployments: [{ status: 'reconciled_already_deployed', vercel_deployment_id: 'dpl_x' }], production_release_authorizations: [] },
    { ok: true, task: task(8, { ceo_decision: 'approved', git_commit_sha: SHA }), production_deployments: [], production_release_authorizations: [] },
  ],
};

const stub = await startStub({ publicDir });
const browser = await launch();
try {
  const { page, pageErrors, blocked } = await openPage(browser, stub.origin);
  await login(page, stub.origin, 'admin');
  // The page's own fonts/Plaid script are refused at load by the harness (as in every
  // preservation run); only requests made while rendering the panel count here.
  const blockedBefore = blocked.length;
  const outcome = await page.evaluate(async (cache) => {
    window.__pwned = 0;
    _ebV2Cache['b2_engreview'] = cache;           // preloaded: the panel renders without fetching
    renderTab('system');
    if (typeof setSystemSub === 'function') setSystemSub('engineering');
    _ebSetSub('b2_engreview');
    await new Promise((r) => setTimeout(r, 800));  // give any planted onerror time to fire
    const root = document.getElementById('appScreen') || document.body;
    const text = root.innerText;
    const authCards = [...root.querySelectorAll('[data-eng-auth-details]')].map((e) => e.innerText);
    return {
      pwned: window.__pwned, planted: root.querySelectorAll('[data-pwn]').length,
      plantedImgs: [...root.querySelectorAll('img')].filter((i) => i.getAttribute('onerror')).length,
      hasPanel: text.includes('CEO ENGINEERING REVIEW'), text, authCards,
    };
  }, CACHE);
  await settle(page, stub.origin, 300);

  ok('the Engineering Review panel rendered', outcome.hasPanel, outcome.text.slice(0, 200));
  ok('no planted handler ran (window.__pwned stays 0)', outcome.pwned === 0, `ran ${outcome.pwned} time(s)`);
  ok('no planted element was created anywhere in the panel', outcome.planted === 0 && outcome.plantedImgs === 0, `${outcome.planted} elements, ${outcome.plantedImgs} img handlers`);
  const fields = ['problem1', 'expected5', 'engine1', 'problem4', 'decision', 'boundary-packet', 'path', 'test', 'evidence', 'problem6', 'engine7', 'problem8', 'boundary-auth', 'boundary-reauth', 'advlabel', 'wlabel'];
  for (const f of fields) ok(`text shown literally, not as markup: ${f}`, outcome.text.includes(`<b data-pwn>${f}</b>`));
  const [advCard, plainCard, reauthCard] = outcome.authCards;
  ok('Authorize cards carry the details block (2 authorize + 1 re-authorize)', outcome.authCards.length === 3, String(outcome.authCards.length));
  ok('adviser task: CEO Adviser badge, business and boundary shown', !!advCard && /SUBMITTED BY CEO ADVISER/.test(advCard) && /srv_farsi/.test(advCard) && advCard.includes('Branch + PR only'));
  ok('adviser task: source line names the CEO Adviser', /Submitted by CEO Adviser \(Adviser /.test(outcome.text));
  ok('task without a boundary says none is recorded', !!plainCard && /none recorded/.test(plainCard));
  ok('re-authorize card shows business, boundary and worker source', !!reauthCard && /mmmos/.test(reauthCard) && reauthCard.includes('Reauth boundary') && /Submitted by Engineering Worker/.test(outcome.text));
  ok('no page errors while rendering', pageErrors.length === 0, pageErrors.join(' | '));
  ok('rendering the panel made no outside request (planted src=x never fetched externally)', blocked.length === blockedBefore, blocked.slice(blockedBefore).join(' | '));
  await page.close();
} finally {
  await browser.close(); await stub.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
