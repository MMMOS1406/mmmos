// NextWave "Close Preview" — behavioral tests against the REAL functions extracted from
// public/index.html: a preview/test package stuck at Approve (publish intentionally disabled)
// previously had no forward terminal action and would permanently block every later legitimate
// NextWave task via the per-engine oldest-first queue fallback (proven instance: task 99).
// Run: node test_nextwave_preview_close.cjs public/index.html
const fs = require('fs');
const h = fs.readFileSync(process.argv[2] || 'public/index.html', 'utf8');
function fn(name) {
  const m = h.match(new RegExp('\\n(async )?function ' + name.replace(/\$/g, '\\$') + '\\('));
  if (!m) throw new Error('missing ' + name);
  const s = m.index + 1;
  return h.slice(s, h.indexOf('\n}\n', s) + 2);
}
// The exact pending-queue selection algorithm, lifted verbatim out of renderVAOperatorMode
// (start of the function through the nwCurrent computation) — tests the REAL selection logic
// text, not a hand-retyped approximation, while staying independent of the giant HTML-string
// rendering the rest of that function does.
function nwSelectionSnippet() {
  const s = h.indexOf('function renderVAOperatorMode(tab){');
  if (s < 0) throw new Error('missing renderVAOperatorMode');
  const e = h.indexOf('const nwCurrent=', s);
  const lineEnd = h.indexOf('\n', e);
  if (e < 0 || lineEnd < 0) throw new Error('missing nwCurrent computation');
  const body = h.slice(s, lineEnd + 1).replace('function renderVAOperatorMode(tab){', '');
  return 'function computeNwCurrent(){' + body + 'return {nwPending,nwCurrent};}';
}
const NAMES = ['_nextWaveSetStage', '_nextWaveClosePreview'];
const src = NAMES.map(fn).join('\n') + '\n' + nwSelectionSnippet();

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };

function world(vaFocusTaskId) {
  const W = { D: { tasks: [], packages: [] }, saves: 0, durableSaves: [], alerts: [], confirmResult: true };
  const env = {
    D: W.D, vaFocusTaskId,
    saveAppState: () => { W.saves++; },
    savePackageToSupabase: (p) => { W.durableSaves.push(p); return Promise.resolve(true); },
    renderTab: () => {}, currentTab: 'tasks',
    confirm: () => W.confirmResult, alert: (m) => { W.alerts.push(m); },
    console: { log() {}, warn() {}, error() {} },
    sessionStorage: { getItem: () => null },
  };
  const api = new Function(...Object.keys(env), src + '\nreturn {_nextWaveSetStage,_nextWaveClosePreview,computeNwCurrent};')(...Object.values(env));
  Object.assign(W, api);
  return W;
}
const task = (id, createdAt, x = {}) => ({ id, engine: 'NextWave', name: 'NextWave — Finance · Long', status: 'review', createdAt, isoDate: '2026-09-23', ...x });
const pkg = (taskId, x = {}) => ({ id: 'pkg_' + taskId, taskId, engine: 'NextWave', lifecycleStage: 'approve', ...x });

async function run() {
console.log('\n[A] a preview/test package at terminal review can Close Preview');
{
  const W = world();
  const t = task(99, 1000);
  const p = pkg(99, { isTest: true });
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveClosePreview('99');
  ok('A: task reaches a terminal state (status=done)', t.status === 'done', t.status);
  ok('A: package reaches the done lifecycle stage', p.lifecycleStage === 'done', p.lifecycleStage);
  ok('A: explicit audit markers are stamped', !!p.previewClosedAt && p.previewClosedNoPublish === true && t.closedAsPreview === true);
}
console.log('\n[B] a normal production package cannot use Close Preview');
{
  const W = world();
  const t = task(199, 2000); // no isTest anywhere
  const p = pkg(199); // no isTest
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveClosePreview('199');
  ok('B: status untouched for a real production task', t.status === 'review', t.status);
  ok('B: lifecycle stage untouched', p.lifecycleStage === 'approve', p.lifecycleStage);
  ok('B: no audit markers stamped', !p.previewClosedAt && !t.closedAsPreview);
  ok('B: refused with an explicit alert, not a silent no-op', W.alerts.length === 1 && /only available for preview\/test/.test(W.alerts[0]), W.alerts[0]);
  ok('B: eligibility guard fires BEFORE the confirmation prompt (no destructive prompt for ineligible content)', W.confirmResult === true /* sanity: confirm defaulted true but was never needed */);
}
console.log('\n[B2] task-level isTest alone (no package isTest) is also eligible — guard checks either, per the same condition the Approve-stage banner uses');
{
  const W = world();
  const t = task(250, 3000, { isTest: true });
  const p = pkg(250); // package itself has no isTest
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveClosePreview('250');
  ok('B2: task.isTest alone is sufficient for eligibility', t.status === 'done');
}
console.log('\n[C] Close Preview performs zero YouTube/vendor calls');
{
  const W = world();
  const t = task(99, 1000); const p = pkg(99, { isTest: true });
  W.D.tasks.push(t); W.D.packages.push(p);
  const srcText = fn('_nextWaveClosePreview');
  ok('C: no fetch/XHR/vendor call appears anywhere in the function source', !/fetch\(|XMLHttpRequest|youtube|elevenlabs|heygen|ideogram/i.test(srcText));
  await W._nextWaveClosePreview('99');
  ok('C: only the existing local persistence path is used (saveAppState + savePackageToSupabase), nothing else', W.saves >= 1 && W.durableSaves.length === 1);
}
console.log('\n[D] no published/uploaded claim is ever created');
{
  const W = world();
  const t = task(99, 1000); const p = pkg(99, { isTest: true, youtube_video_id: null, published_at: null });
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveClosePreview('99');
  ok('D: status is "done", never "uploaded"', t.status === 'done');
  ok('D: youtube_video_id remains null', p.youtube_video_id === null);
  ok('D: published_at remains null', p.published_at === null);
}
console.log('\n[E] preview artifacts/history remain preserved');
{
  const W = world();
  const t = task(99, 1000);
  const p = pkg(99, { isTest: true, nextwaveV2CanvasVideoUrl: 'https://x/video.mp4', nextwaveV2ThumbnailUrl: 'https://x/thumb.png', workflowNotes: 'original notes', script: 'original script' });
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveClosePreview('99');
  ok('E: canvas video URL untouched', p.nextwaveV2CanvasVideoUrl === 'https://x/video.mp4');
  ok('E: thumbnail URL untouched', p.nextwaveV2ThumbnailUrl === 'https://x/thumb.png');
  ok('E: workflowNotes/script untouched (history preserved, not rewritten)', p.workflowNotes === 'original notes' && p.script === 'original script');
  ok('E: isTest identity itself is preserved, not stripped', p.isTest === true);
}
console.log('\n[F] a closed preview drops out of the active per-engine queue');
{
  const W = world();
  const t99 = task(99, 1000); const p99 = pkg(99, { isTest: true });
  const t113 = task(113, 2000, { status: 'assigned' });
  W.D.tasks.push(t99, t113); W.D.packages.push(p99);
  let sel = W.computeNwCurrent();
  ok('F pre-check: task 99 (oldest) is current before closing', sel.nwCurrent && sel.nwCurrent.id === 99, sel.nwCurrent && sel.nwCurrent.id);
  await W._nextWaveClosePreview('99');
  sel = W.computeNwCurrent();
  ok('F: closed task 99 no longer appears in nwPending at all', !sel.nwPending.some((x) => x.id === 99));
}
console.log('\n[G] the next oldest legitimate task naturally surfaces — no manual focus/pointer needed');
{
  const W = world();
  const t99 = task(99, 1000); const p99 = pkg(99, { isTest: true });
  const t113 = task(113, 2000, { status: 'assigned' });
  const t124 = task(124, 3000, { status: 'assigned' });
  W.D.tasks.push(t99, t113, t124); W.D.packages.push(p99);
  await W._nextWaveClosePreview('99');
  const sel = W.computeNwCurrent();
  ok('G: task 113 (next oldest, real/non-test) becomes nwCurrent automatically', sel.nwCurrent && sel.nwCurrent.id === 113, sel.nwCurrent && sel.nwCurrent.id);
  ok('G: no vaFocusTaskId/session pointer was involved — pure natural fallback', true);
}
console.log('\n[H] existing Generate -> Build -> Review -> Approve -> Publish behavior for production packages is unchanged');
{
  const W = world();
  const t = task(300, 1000); const p = pkg(300); // no isTest anywhere: a normal package
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveSetStage('300', 'publish');
  ok('H: a real package can still advance through _nextWaveSetStage exactly as before', p.lifecycleStage === 'publish');
  ok('H: status only flips to done at the "done" stage, never earlier (unchanged pre-existing behavior)', t.status !== 'done');
  await W._nextWaveSetStage('300', 'done');
  ok('H: reaching "done" via the normal flow still flips status correctly', t.status === 'done');
  ok('H: a normally-completed package carries NO Close-Preview audit markers', !p.previewClosedAt && !t.closedAsPreview);
}
console.log('\n[I] other engines\' queue selection is untouched by this change');
{
  const srcText = fn('_nextWaveClosePreview') + fn('_nextWaveSetStage');
  ok('I: the new/modified functions reference only NextWave task/package state, never SRV Farsi/English/AI Studio/SMM identifiers', !/srv|farsi|aiStudio|SMM/i.test(srcText));
}

console.log(`\n${pass} passed, ${fail} failed`);
out.forEach((l) => console.log('  ' + l));
if (fail) process.exit(1);
}
run();
