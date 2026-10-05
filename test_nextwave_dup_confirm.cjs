// NextWave duplicate-concept confirmation — in-page two-step modal (2026-10-05 blocker correction).
// Same native-confirm() incompatibility already fixed twice this session (Close Preview, Discard &
// Regenerate): the browser-automation VA production environment suppresses confirm(), which
// silently discarded otherwise-valid generated NextWave packages 5 of 6 times in the latest real
// task-123 run. Scoped to NextWave only — every other engine (SRV, AI Studio, SMM) must still hit
// the unchanged native confirm().
// Run: node test_nextwave_dup_confirm.cjs public/index.html
const fs = require('fs');
const h = fs.readFileSync(process.argv[2] || 'public/index.html', 'utf8');
function fn(name) {
  const m = h.match(new RegExp('\\n(async )?function ' + name.replace(/\$/g, '\\$') + '\\('));
  if (!m) throw new Error('missing ' + name);
  const s = m.index + 1;
  return h.slice(s, h.indexOf('\n}\n', s) + 2);
}
const NAMES = ['_confirmDupSave', '_nextWaveShowDupConfirm'];
const src = NAMES.map(fn).join('\n');

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };

function world(confirmReturn) {
  const els = new Map();
  const body = { appendChild: (el) => { els.set('__body_has__' + el.id, el); } };
  const mkEl = (id) => ({
    id, style: {}, _innerHTML: '',
    set innerHTML(v) {
      this._innerHTML = v;
      // simulate real DOM parsing: register every id="..." found in the markup as a clickable mock
      const re = /id="([\w-]+)"/g; let m;
      while ((m = re.exec(v))) { if (!els.has(m[1])) els.set(m[1], { onclick: null, remove: () => { els.delete(id); } }); }
    },
    get innerHTML() { return this._innerHTML; },
    remove: () => { els.delete(id); },
  });
  const document = {
    getElementById: (id) => els.has(id) ? els.get(id) : (els.has('__body_has__' + id) ? els.get('__body_has__' + id) : null),
    createElement: (tag) => mkEl(undefined),
    body,
  };
  let confirmCalls = 0;
  const confirmFn = (msg) => { confirmCalls++; return confirmReturn; };
  const env = {
    document, confirm: confirmFn, console: { log() {}, warn() {}, error() {} },
    _srvFarsiGuardActive: false,
  };
  const api = new Function(...Object.keys(env), src + '\nreturn { _confirmDupSave, _nextWaveShowDupConfirm, get _confirmCalls(){return confirmCalls;} };')(...Object.values(env));
  return { api, els, getConfirmCalls: () => confirmCalls };
}
const existing = { id: 'pkg_old', title: 'Your Car Loan Rate Costs You Thousands', engine: 'NextWave', generatedAt: '2026-10-04T00:00:00.000Z' };

async function run() {
console.log('\n[1] NextWave duplicate warning remains active — the modal is actually shown, not silently skipped');
{
  const { api, els } = world(false);
  // fire the confirm call, but don't resolve yet — just prove the modal DOM was created
  const p = api._nextWaveShowDupConfirm(existing, 'NextWave');
  ok('1: the modal element is created and appended to the page (duplicate warning is visible, not bypassed)', els.has('__body_has__nw-dup-confirm-modal'));
  ok('1: both decision buttons exist in the rendered modal', els.has('nw-dup-confirm-save') && els.has('nw-dup-confirm-cancel'));
  els.get('nw-dup-confirm-cancel').onclick(); // drain the pending promise so the test process can exit cleanly
  await p;
}
console.log('\n[2] NextWave can intentionally Save Anyway through in-page confirmation');
{
  const { api, els } = world(false);
  const p = api._nextWaveShowDupConfirm(existing, 'NextWave');
  els.get('nw-dup-confirm-save').onclick();
  const result = await p;
  ok('2: clicking "Save Anyway" resolves true', result === true);
}
console.log('\n[3] NextWave can Cancel / regenerate through in-page confirmation');
{
  const { api, els } = world(false);
  const p = api._nextWaveShowDupConfirm(existing, 'NextWave');
  els.get('nw-dup-confirm-cancel').onclick();
  const result = await p;
  ok('3: clicking "Cancel / Regenerate" resolves false', result === false);
}
console.log('\n[4] no native confirm() dependency remains on the NextWave path');
{
  ok('4: _nextWaveShowDupConfirm never calls the native confirm()', !/\bconfirm\(/.test(fn('_nextWaveShowDupConfirm')));
  const { api, els, getConfirmCalls } = world(true);
  const p = api._confirmDupSave(existing, 'NextWave');
  ok('4: _confirmDupSave(engine=NextWave) does not call native confirm() at all', getConfirmCalls() === 0);
  els.get('nw-dup-confirm-save').onclick();
  const result = await p;
  ok('4: the NextWave branch still resolves correctly end-to-end through _confirmDupSave', result === true);
}
await (async () => {
  console.log('\n[4b] "NextWave Systems" engine name variant also routes to the in-page modal (not just "NextWave")');
  const { api, els, getConfirmCalls } = world(true);
  const p = api._confirmDupSave(existing, 'NextWave Systems');
  ok('4b: no native confirm() for the "NextWave Systems" engine-name variant', getConfirmCalls() === 0);
  els.get('nw-dup-confirm-cancel').onclick();
  await p;
})();
console.log('\n[5] other engines\' behavior is completely unchanged — still the native confirm(), same message, same return value');
{
  for (const eng of ['SRV Farsi', 'SRV English', 'AI Creation Studio', 'SMM', 'Social Media Manager', '']) {
    const { api, getConfirmCalls } = world(true);
    const result = await api._confirmDupSave({ ...existing, engine: eng }, eng);
    ok(`5: engine="${eng || '(empty)'}" still calls native confirm() exactly once`, getConfirmCalls() === 1, eng);
    ok(`5: engine="${eng || '(empty)'}" still returns the native confirm()'s own value unchanged`, result === true, eng);
  }
}
console.log('\n[5b] SRV Farsi guard-active auto-accept path is completely unchanged (zero confirm() calls, zero modal calls, returns true)');
{
  const els = new Map();
  const document = { getElementById: () => null, createElement: () => ({ style: {}, set innerHTML(v) {} }), body: { appendChild() {} } };
  let confirmCalls = 0;
  const env = { document, confirm: () => { confirmCalls++; return false; }, console: { log() {}, warn() {}, error() {} }, _srvFarsiGuardActive: true };
  const api = new Function(...Object.keys(env), src + '\nreturn { _confirmDupSave };')(...Object.values(env));
  const result = await api._confirmDupSave(existing, 'SRV Farsi');
  ok('5b: guard-active path returns true without calling confirm() or the NextWave modal', result === true && confirmCalls === 0);
}
console.log('\n[6] both real call sites now await the async _confirmDupSave (source-verified — an un-awaited call would always be truthy and silently disable the dup gate for every engine)');
{
  const genIdx = h.indexOf('async function generatePackage(taskId)');
  const genBody = h.slice(genIdx, h.indexOf('\n}\n', genIdx));
  ok('6: generatePackage() awaits _confirmDupSave', /await _confirmDupSave\(/.test(genBody));
  const injIdx = h.indexOf('async function injectToTask()');
  ok('6: injectToTask() was converted to async (previously synchronous — required for the await below to work for the Factory path\'s own dup-check)', injIdx > -1);
  ok('6: injectToTask() awaits _confirmDupSave', /await _confirmDupSave\(/.test(h.slice(injIdx, injIdx + 2000)));
  ok('6: exactly 2 call sites total, both covered above (no un-awaited 3rd caller silently exists)', (h.match(/_confirmDupSave\(/g) || []).length === 3); // 1 definition + 2 calls
}

console.log(`\n${pass} passed, ${fail} failed`);
out.forEach((l) => console.log('  ' + l));
if (fail) process.exit(1);
}
run();
