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
const NAMES = ['_nextWaveSetStage', '_nextWaveShowClosePreviewConfirm', '_nextWaveCancelClosePreview', '_nextWaveClosePreview'];
const src = NAMES.map(fn).join('\n') + '\n' + nwSelectionSnippet();

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };

// Minimal getElementById mock: tracks one {style:{display}} object per id, exactly like the real
// DOM elements _nextWaveShowClosePreviewConfirm/_nextWaveCancelClosePreview toggle — this is the
// SAME in-page confirmation pattern already shipped for Settings' "Reset All Data"
// (settingsShowReset/settingsResetConfirm/settingsResetCancel), not a native confirm() dialog, so
// it's just plain DOM state a test (or real browser automation) can read and click through.
function mockDocument() {
  const els = new Map();
  return { getElementById: (id) => { if (!els.has(id)) els.set(id, { style: { display: 'none' } }); return els.get(id); } };
}
function world(vaFocusTaskId) {
  const W = { D: { tasks: [], packages: [] }, saves: 0, durableSaves: [], alerts: [], document: mockDocument() };
  const env = {
    D: W.D, vaFocusTaskId, document: W.document,
    saveAppState: () => { W.saves++; },
    savePackageToSupabase: (p) => { W.durableSaves.push(p); return Promise.resolve(true); },
    renderTab: () => {}, currentTab: 'tasks',
    alert: (m) => { W.alerts.push(m); },
    console: { log() {}, warn() {}, error() {} },
    sessionStorage: { getItem: () => null },
  };
  const api = new Function(...Object.keys(env), src + '\nreturn {_nextWaveSetStage,_nextWaveShowClosePreviewConfirm,_nextWaveCancelClosePreview,_nextWaveClosePreview,computeNwCurrent};')(...Object.values(env));
  Object.assign(W, api);
  return W;
}
const task = (id, createdAt, x = {}) => ({ id, engine: 'NextWave', name: 'NextWave — Finance · Long', status: 'review', createdAt, isoDate: '2026-09-23', ...x });
const pkg = (taskId, x = {}) => ({ id: 'pkg_' + taskId, taskId, engine: 'NextWave', lifecycleStage: 'approve', ...x });

async function run() {
console.log('\n[A] first "Close Preview" click causes ZERO lifecycle mutation (only reveals the confirm block)');
{
  const W = world();
  const t = task(99, 1000);
  const p = pkg(99, { isTest: true });
  W.D.tasks.push(t); W.D.packages.push(p);
  W._nextWaveShowClosePreviewConfirm('99');
  ok('A: task status untouched by the reveal click', t.status === 'review', t.status);
  ok('A: package lifecycle stage untouched by the reveal click', p.lifecycleStage === 'approve', p.lifecycleStage);
  ok('A: no audit markers stamped by the reveal click', !p.previewClosedAt && !t.closedAsPreview);
  ok('A: zero persistence calls on the reveal click', W.saves === 0 && W.durableSaves.length === 0);
}
console.log('\n[B] the in-page confirmation UI appears (same pattern as Settings\' Reset All Data)');
{
  const W = world();
  const el = W.document.getElementById('nw-close-preview-confirm-99');
  ok('B pre-check: confirm block starts hidden', el.style.display === 'none');
  W._nextWaveShowClosePreviewConfirm('99');
  ok('B: confirm block becomes visible after the first click', el.style.display === 'block');
}
console.log('\n[C] "Cancel" causes ZERO mutation and hides the confirmation again');
{
  const W = world();
  const t = task(99, 1000); const p = pkg(99, { isTest: true });
  W.D.tasks.push(t); W.D.packages.push(p);
  W._nextWaveShowClosePreviewConfirm('99');
  const el = W.document.getElementById('nw-close-preview-confirm-99');
  ok('C pre-check: confirm block visible before Cancel', el.style.display === 'block');
  W._nextWaveCancelClosePreview('99');
  ok('C: confirm block hidden again after Cancel', el.style.display === 'none');
  ok('C: task status untouched by Cancel', t.status === 'review');
  ok('C: package lifecycle stage untouched by Cancel', p.lifecycleStage === 'approve');
  ok('C: no audit markers stamped by Cancel', !p.previewClosedAt && !t.closedAsPreview);
  ok('C: zero persistence calls from show+cancel', W.saves === 0 && W.durableSaves.length === 0);
}
console.log('\n[D] "Yes, Close Preview" executes the existing guarded close — full reveal -> confirm -> close flow');
{
  const W = world();
  const t = task(99, 1000);
  const p = pkg(99, { isTest: true });
  W.D.tasks.push(t); W.D.packages.push(p);
  W._nextWaveShowClosePreviewConfirm('99'); // step 1: reveal (as a real click would do)
  await W._nextWaveClosePreview('99'); // step 2: the confirm block's "Yes, Close Preview" button
  ok('D: task reaches a terminal state (status=done)', t.status === 'done', t.status);
  ok('D: package reaches the done lifecycle stage', p.lifecycleStage === 'done', p.lifecycleStage);
  ok('D: explicit audit markers are stamped', !!p.previewClosedAt && p.previewClosedNoPublish === true && t.closedAsPreview === true);
}
console.log('\n[E] ineligible production packages cannot expose/use the action');
{
  const W = world();
  const t = task(199, 2000); // no isTest anywhere
  const p = pkg(199); // no isTest
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveClosePreview('199'); // even a direct call, bypassing the (never-rendered) button entirely
  ok('E: status untouched for a real production task', t.status === 'review', t.status);
  ok('E: lifecycle stage untouched', p.lifecycleStage === 'approve', p.lifecycleStage);
  ok('E: no audit markers stamped', !p.previewClosedAt && !t.closedAsPreview);
  ok('E: refused with an explicit alert, not a silent no-op', W.alerts.length === 1 && /only available for preview\/test/.test(W.alerts[0]), W.alerts[0]);
}
console.log('\n[E2] task-level isTest alone (no package isTest) is also eligible — guard checks either, per the same condition the Approve-stage banner uses');
{
  const W = world();
  const t = task(250, 3000, { isTest: true });
  const p = pkg(250); // package itself has no isTest
  W.D.tasks.push(t); W.D.packages.push(p);
  await W._nextWaveClosePreview('250');
  ok('E2: task.isTest alone is sufficient for eligibility', t.status === 'done');
}
console.log('\n[F] no YouTube/vendor call occurs anywhere in the flow');
{
  const W = world();
  const t = task(99, 1000); const p = pkg(99, { isTest: true });
  W.D.tasks.push(t); W.D.packages.push(p);
  const srcText = fn('_nextWaveShowClosePreviewConfirm') + fn('_nextWaveCancelClosePreview') + fn('_nextWaveClosePreview');
  ok('F: no fetch/XHR/vendor call appears anywhere in the reveal/cancel/close function sources', !/fetch\(|XMLHttpRequest|youtube|elevenlabs|heygen|ideogram/i.test(srcText));
  W._nextWaveShowClosePreviewConfirm('99');
  await W._nextWaveClosePreview('99');
  ok('F: only the existing local persistence path is used (saveAppState + savePackageToSupabase), nothing else', W.saves >= 1 && W.durableSaves.length === 1);
}
console.log('\n[G] existing audit markers and truthful non-publish state remain correct');
{
  const W = world();
  const t = task(99, 1000);
  const p = pkg(99, { isTest: true, youtube_video_id: null, published_at: null, nextwaveV2CanvasVideoUrl: 'https://x/video.mp4', nextwaveV2ThumbnailUrl: 'https://x/thumb.png', workflowNotes: 'original notes', script: 'original script' });
  W.D.tasks.push(t); W.D.packages.push(p);
  W._nextWaveShowClosePreviewConfirm('99');
  await W._nextWaveClosePreview('99');
  ok('G: status is "done", never "uploaded"', t.status === 'done');
  ok('G: youtube_video_id remains null', p.youtube_video_id === null);
  ok('G: published_at remains null', p.published_at === null);
  ok('G: canvas video / thumbnail URLs untouched', p.nextwaveV2CanvasVideoUrl === 'https://x/video.mp4' && p.nextwaveV2ThumbnailUrl === 'https://x/thumb.png');
  ok('G: workflowNotes/script untouched (history preserved, not rewritten)', p.workflowNotes === 'original notes' && p.script === 'original script');
  ok('G: isTest identity itself is preserved, not stripped', p.isTest === true);
}
console.log('\n[G2] a closed preview drops out of the active per-engine queue and the next oldest task naturally surfaces');
{
  const W = world();
  const t99 = task(99, 1000); const p99 = pkg(99, { isTest: true });
  const t113 = task(113, 2000, { status: 'assigned' });
  const t124 = task(124, 3000, { status: 'assigned' });
  W.D.tasks.push(t99, t113, t124); W.D.packages.push(p99);
  let sel = W.computeNwCurrent();
  ok('G2 pre-check: task 99 (oldest) is current before closing', sel.nwCurrent && sel.nwCurrent.id === 99, sel.nwCurrent && sel.nwCurrent.id);
  W._nextWaveShowClosePreviewConfirm('99');
  await W._nextWaveClosePreview('99');
  sel = W.computeNwCurrent();
  ok('G2: closed task 99 no longer appears in nwPending at all', !sel.nwPending.some((x) => x.id === 99));
  ok('G2: task 113 (next oldest, real/non-test) becomes nwCurrent automatically — no manual focus/pointer needed', sel.nwCurrent && sel.nwCurrent.id === 113, sel.nwCurrent && sel.nwCurrent.id);
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
  const srcText = fn('_nextWaveShowClosePreviewConfirm') + fn('_nextWaveCancelClosePreview') + fn('_nextWaveClosePreview') + fn('_nextWaveSetStage');
  ok('I: the new/modified functions reference only NextWave task/package state, never SRV Farsi/English/AI Studio/SMM identifiers', !/srv|farsi|aiStudio|SMM/i.test(srcText));
}

console.log(`\n${pass} passed, ${fail} failed`);
out.forEach((l) => console.log('  ' + l));
if (fail) process.exit(1);
}
run();
