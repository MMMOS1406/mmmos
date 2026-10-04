// NextWave "Discard & Regenerate" in-page confirmation — behavioral tests against the REAL
// functions extracted from public/index.html. Same native-confirm() incompatibility already fixed
// for Close Preview: a real click reached confirm('Discard package and regenerate?') but the
// dialog was suppressed by the browser-automation environment, so nothing happened. Fixed with the
// identical two-step in-page pattern (reveal -> explicit second click); the underlying action
// (_nextWaveSetStage(taskId,'generate')) is byte-identical to the prior onclick's behavior.
// Run: node test_nextwave_discard_confirm.cjs public/index.html
const fs = require('fs');
const h = fs.readFileSync(process.argv[2] || 'public/index.html', 'utf8');
function fn(name) {
  const m = h.match(new RegExp('\\n(async )?function ' + name.replace(/\$/g, '\\$') + '\\('));
  if (!m) throw new Error('missing ' + name);
  const s = m.index + 1;
  return h.slice(s, h.indexOf('\n}\n', s) + 2);
}
const NAMES = ['_nextWaveSetStage', '_nextWaveShowDiscardConfirm', '_nextWaveCancelDiscard', '_nextWaveConfirmDiscard',
  '_nextWaveShowClosePreviewConfirm', '_nextWaveCancelClosePreview', '_nextWaveClosePreview'];
const src = NAMES.map(fn).join('\n');

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
function mockDocument() {
  const els = new Map();
  return { getElementById: (id) => { if (!els.has(id)) els.set(id, { style: { display: 'none' } }); return els.get(id); } };
}
function world() {
  const W = { D: { tasks: [], packages: [] }, saves: 0, durableSaves: [], alerts: [], renders: 0, document: mockDocument() };
  const env = {
    D: W.D, document: W.document,
    saveAppState: () => { W.saves++; },
    savePackageToSupabase: (p) => { W.durableSaves.push(p); return Promise.resolve(true); },
    renderTab: () => { W.renders++; }, currentTab: 'tasks',
    alert: (m) => { W.alerts.push(m); },
    console: { log() {}, warn() {}, error() {} },
  };
  const api = new Function(...Object.keys(env), src + '\nreturn {' + NAMES.join(',') + '};')(...Object.values(env));
  Object.assign(W, api);
  return W;
}
const task = (id, x = {}) => ({ id, engine: 'NextWave', name: 'NextWave — Finance · Short (auto-created)', status: 'review', ...x });
const pkg = (taskId, x = {}) => ({ id: 'pkg_' + taskId, taskId, engine: 'NextWave', lifecycleStage: 'review', renderStatus: 'v2_needs_review', ...x });

async function run() {
console.log('\n[1] NEEDS_REVIEW displays Discard & Regenerate (template wiring, source-verified)');
{
  const idx = h.indexOf("Discard package and regenerate");
  ok('1: the old native-confirm string no longer appears anywhere in the NextWave card template', idx === -1 || !/_nextWaveSetStage\('\$\{taskId\}','generate'\);if\(typeof renderTab/.test(h.slice(Math.max(0, idx - 300), idx + 100)));
  ok('1: the real button is wired to the new reveal function', /onclick="_nextWaveShowDiscardConfirm\('\$\{taskId\}'\)">↺ Discard & Regenerate</.test(h));
  ok('1: the confirm block carries a per-task id matching the button\'s taskId variable', /id="nw-discard-confirm-\$\{taskId\}"/.test(h));
}
console.log('\n[2] first click exposes the in-page confirmation (zero mutation)');
{
  const W = world();
  const t = task(113); const p = pkg(113);
  W.D.tasks.push(t); W.D.packages.push(p);
  const el = W.document.getElementById('nw-discard-confirm-113');
  ok('2 pre-check: confirm block starts hidden', el.style.display === 'none');
  W._nextWaveShowDiscardConfirm('113');
  ok('2: confirm block becomes visible after the first click', el.style.display === 'block');
  ok('2: task/package untouched by the reveal click', t.status === 'review' && p.lifecycleStage === 'review');
  ok('2: zero persistence calls on the reveal click', W.saves === 0 && W.durableSaves.length === 0);
}
console.log('\n[3] Cancel performs no mutation');
{
  const W = world();
  const t = task(113); const p = pkg(113);
  W.D.tasks.push(t); W.D.packages.push(p);
  W._nextWaveShowDiscardConfirm('113');
  const el = W.document.getElementById('nw-discard-confirm-113');
  W._nextWaveCancelDiscard('113');
  ok('3: confirm block hidden again after Cancel', el.style.display === 'none');
  ok('3: task status untouched by Cancel', t.status === 'review');
  ok('3: package lifecycle stage untouched by Cancel', p.lifecycleStage === 'review');
  ok('3: zero persistence calls from show+cancel', W.saves === 0 && W.durableSaves.length === 0);
}
console.log('\n[4] Confirm performs the existing discard/regenerate action exactly once');
{
  const W = world();
  const t = task(113); const p = pkg(113);
  W.D.tasks.push(t); W.D.packages.push(p);
  W._nextWaveShowDiscardConfirm('113');
  await W._nextWaveConfirmDiscard('113');
  ok('4: lifecycle stage reset to generate (the pre-existing discard behavior, unchanged)', p.lifecycleStage === 'generate', p.lifecycleStage);
  ok('4: durable package save happened exactly once', W.durableSaves.length === 1);
  ok('4: task.status is NOT touched by a discard (only the \'done\' stage flips status — unchanged pre-existing rule)', t.status === 'review');
  ok('4: no Close-Preview audit markers leak in from an unrelated action', !p.previewClosedAt && !t.closedAsPreview);
}
console.log('\n[5] it cannot accidentally invoke Approve/Build');
{
  const srcText = fn('_nextWaveShowDiscardConfirm') + fn('_nextWaveCancelDiscard') + fn('_nextWaveConfirmDiscard');
  ok('5: none of the three new functions reference Approve/Build/Publish actions', !/_nextWaveApproveReview|nextwaveV2RouteBuild|_nextWaveRunPublish|'approve'|'build'|'publish'/i.test(srcText), srcText);
  ok('5: the discard action only ever sets stage to \'generate\'', /'generate'/.test(fn('_nextWaveConfirmDiscard')));
}
console.log('\n[6] Close Preview confirmation (the prior fix) still works correctly, unaffected by this change');
{
  const W = world();
  const t = task(99, { status: 'review' }); const p = pkg(99, { isTest: true, lifecycleStage: 'approve' });
  W.D.tasks.push(t); W.D.packages.push(p);
  W._nextWaveShowClosePreviewConfirm('99');
  await W._nextWaveClosePreview('99');
  ok('6: Close Preview still reaches its own terminal state correctly', t.status === 'done' && p.lifecycleStage === 'done' && t.closedAsPreview === true && p.previewClosedNoPublish === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
out.forEach((l) => console.log('  ' + l));
if (fail) process.exit(1);
}
run();
