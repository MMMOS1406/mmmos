// Proof for the CEO portfolio reduction: pausing ONE engine through D.engineState (the per-engine control NextWave and SMM already use) stops new task
// generation for that engine only, deletes nothing, and changes nothing for SRV Farsi / SRV English. Runs on a read-only copy of the real production state, in the local stub.
// CLI_FIXTURE=<fixture> PUPPETEER_CORE=<dir> node tests/home2/engine_pause_proof.mjs
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
const real = JSON.parse(fs.readFileSync(process.env.CLI_FIXTURE || path.join(process.env.HOME, 'mmm-backups/home2-real-fixture-20261109.json'), 'utf8'));
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname); const browser = await launch();
async function run(engineState, enginePaused) {
  const st = JSON.parse(real.state); st.engineState = engineState; st.enginePaused = enginePaused || {};
  // force a clean cadence week so every running engine WOULD create tasks: drop the claimed-slot memory and open tasks of the engines under test
  st.cadenceAutoCreatedSlots = {}; st.tasks = st.tasks.filter((t) => !['SRV Farsi', 'SRV English', 'AI Studio', 'NextWave', 'SMM'].includes(t.engine) || ['done', 'uploaded', 'posted'].includes(t.status));
  const fx = makeFixture(); fx.restFilter = true; fx.settings.mmm_finance_v118 = JSON.stringify(st);
  const stub = await startStub({ publicDir: pub, fixture: fx });
  try {
    const o = await openPage(browser, stub.origin, { realClock: true }); await login(o.page, stub.origin, 'admin'); await settle(o.page, stub.origin, 1200);
    const res = await o.page.evaluate(() => {
      const before = D.tasks.length; _cadenceAutoRanThisSession = false;
      const r = autoCreateCadenceTasksForCurrentWeek();
      const created = D.tasks.slice(before).map((t) => t.engine);
      const purged = _purgePausedEngineOrphans(); const pick = pickAutoAssignEngine();
      return { created: created.reduce((a, e) => (a[e] = (a[e] || 0) + 1, a), {}), purged, pick: pick && pick.name, tasksAfter: D.tasks.length, tasksBefore: before };
    });
    await o.page.close(); return res;
  } finally { await stub.close(); }
}
try {
  const base = await run({ SMM: 'test', NextWave: 'test' });                                    // production state BEFORE the pause
  const paused = await run({ SMM: 'test', NextWave: 'test', 'AI Studio': 'paused' });           // production state AFTER the pause
  console.log('before pause:', JSON.stringify(base)); console.log('after pause :', JSON.stringify(paused));
  check('before the pause AI Studio would still generate tasks (this is why it is paused)', (base.created['AI Studio'] || 0) > 0);
  check('NextWave and SMM generate nothing in either state (already stopped by their test state)', !base.created.NextWave && !paused.created.NextWave && !base.created.SMM && !paused.created.SMM);
  check('after the pause AI Studio generates no task', !(paused.created['AI Studio'] > 0));
  // the run creates at most 8 tasks in total: before the pause AI Studio used 2 of them, which can crowd out SRV Farsi's last (long-form) slot — after the pause it is never fewer
  check('SRV Farsi never generates fewer tasks after the pause (it may get the slot AI Studio was using)', (paused.created['SRV Farsi'] || 0) >= (base.created['SRV Farsi'] || 0) && (base.created['SRV Farsi'] || 0) > 0, `${base.created['SRV Farsi']} before, ${paused.created['SRV Farsi']} after`);
  check('SRV English generates exactly the same tasks before and after', (base.created['SRV English'] || 0) === (paused.created['SRV English'] || 0), `${base.created['SRV English'] || 0} vs ${paused.created['SRV English'] || 0}`);
  check('the paused-engine purge deletes nothing (enginePaused is not set, existing tasks are kept)', paused.purged === 0);
  check('auto-assign never picks AI Studio, NextWave or SMM after the pause', ['SRV Farsi', 'SRV English'].includes(paused.pick) || paused.pick === null, String(paused.pick));
} finally { await browser.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
