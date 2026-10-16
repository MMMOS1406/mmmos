// SRV Studio V2 — Checkpoint A (order SRV-STUDIO-V2-002): flag, identity, task-level TEST, editable
// Review with persistence, caption regeneration. Runs the REAL code extracted from public/index.html
// and api/ops.js inside a sandbox (fake DOM, mocked Supabase REST). Touches no network and no database.
// Run: node tests/srv/test_srv_studio_v2_lifecycle.cjs [public/index.html] [api/ops.js]
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');
const H = fs.readFileSync(process.argv[2] || 'public/index.html', 'utf8');
const OPS = fs.readFileSync(process.argv[3] || 'api/ops.js', 'utf8');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
function slice(src, start, end) { const s = src.indexOf(start); if (s < 0) throw new Error('missing ' + start); const e = src.indexOf(end, s); if (e < 0) throw new Error('missing end ' + end); return src.slice(s, e); }
function top(src, name) { const m = src.match(new RegExp('\\n(async )?function ' + name + '\\(')); if (!m) throw new Error('missing ' + name); const s = m.index + 1; return src.slice(s, src.indexOf('\n}\n', s) + 2); }

// ── sandbox ───────────────────────────────────────────────────────────────────
function makeEnv({ flag = null, search = '', saveOk = true, captionOk = true, src = H } = {}) {
  const els = {};
  const el = (id, value = '') => (els[id] = { id, value, textContent: '', style: {}, disabled: false });
  const calls = { upserts: [], caption: [], generate: 0, renders: 0, alerts: [] };
  const table = {}; // package_id -> row (mock packages table)
  const fetch = async (url, opt = {}) => {
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/rest/v1/app_settings?key=eq.srv_studio_v2_enabled')) return json(flag === null ? [] : [{ value: flag }]);
    if (u.includes('/rest/v1/packages?on_conflict')) {
      const row = JSON.parse(opt.body); calls.upserts.push(row);
      if (!saveOk) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      table[row.package_id] = row; return json(null);
    }
    if (u.includes('/rest/v1/packages?order=')) return json(Object.values(table).sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at))));
    if (u.includes('/rest/v1/app_settings')) return json(null);
    if (u.includes('action=srv_english_regen_caption')) {
      const b = JSON.parse(opt.body); calls.caption.push(b);
      return json(captionOk ? { ok: true, captionYT: 'Caption for ' + b.title + '\n#SRVStudio #NightDrive', hashtags: '#SRVStudio #NightDrive' } : { ok: false, error: 'model down' });
    }
    return json({ ok: true });
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, setTimeout: (f, ms) => setTimeout(() => {}, 0), fetch, AbortSignal: { timeout: () => undefined }, JSON, Date, Math, Number, String, Object, Array, Set, Promise, RegExp, Error, isNaN, isFinite, parseInt,
    location: { search }, alert: (m) => calls.alerts.push(m), confirm: () => true,
    document: {
      getElementById: (id) => els[id] || null, querySelector: () => null,
      createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} },
    },
    D: { tasks: [], packages: [], srvLifecycleStages: {} },
    ENGINES_CONFIG: [{ id: 'srv_english', lifecycle: { requireApprove: true } }],
    SUPABASE_URL: 'https://stub.invalid', SUPABASE_KEY: 'k', SB_PACKAGES_BACKUP_KEY: 'mmm_packages_backup',
    saveAppState: () => {}, renderTab: () => { calls.renders++; }, openExec: (id) => { calls.opened = (calls.opened || []).concat(String(id)); }, closeExec: () => {}, currentTab: 'tasks', activeExec: null,
    _getEngineState: () => 'running',
    escHTML: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  };
  vm.createContext(ctx);
  const code = [
    top(src, 'savePackageToSupabase'), slice(src, 'const _farsiPkgSaveQueues={};', '// Write all packages as a backup'),
    top(src, 'writePackagesBackup'), top(src, 'fetchPackagesFromTable'),
    slice(src, '// ── Lifecycle helpers', '// ── Stage transition actions'),
    top(src, 'vaGeneratePackage'),
  ].join('\n');
  vm.runInContext(code, ctx);
  ctx.generatePackage = async (taskId) => {
    calls.generate++;
    const t = ctx.D.tasks.find((x) => String(x.id || x.taskId || '') === String(taskId));
    ctx.D.packages.unshift({ id: 'pkg_gen_' + calls.generate, taskId, engine: t.engine, generatedAt: new Date().toISOString(), title: 'Generated ' + calls.generate, lyrics: 'L', shortLyrics: 'S', sunoPrompt: 'P', shortSunoPrompt: 'SP' });
  };
  return { ctx, els, el, calls, table, settle: () => new Promise((r) => setTimeout(r, 20)) };
}

const T0 = Date.UTC(2026, 9, 1);
const task = (id, extra = {}) => ({ id, engine: 'SRV English', name: 'SRV English — Female · Short', status: 'assigned', contentType: 'Short Video', createdAt: T0 + id * 1000, ...extra });
const pkgOf = (id, taskId, extra = {}) => ({ id, taskId, engine: 'SRV English', generatedAt: new Date(T0 + 86400000).toISOString(), title: 'Stay Tonight', lyrics: '[HOOK]\nfull lyric', shortLyrics: 'short lyric', sunoPrompt: 'full prompt', shortSunoPrompt: 'short prompt', captionYT: 'old caption', hashtags: '#old', ...extra });

(async () => {
  // ── 1. Flag: default OFF, only the app_settings row turns it on, URL can only force it off ──
  for (const [label, opt, want] of [['no flag row → OFF', {}, false], ['flag "false" → OFF', { flag: 'false' }, false], ['flag "true" → ON', { flag: 'true' }, true], ['flag true → ON', { flag: true }, true], ['flag ON + ?srvStudioV2=off → OFF', { flag: 'true', search: '?srvStudioV2=off' }, false], ['?srvStudioV2=on without the row → OFF', { search: '?srvStudioV2=on' }, false]]) {
    const E = makeEnv(opt); await E.settle();
    ok('flag: ' + label, vm.runInContext('_srvStudioV2On()', E.ctx) === want);
  }
  { const E = makeEnv({}); ok('flag: OFF before the flag row has loaded', vm.runInContext('_srvStudioV2On()', E.ctx) === false); }

  // ── 2. Flag OFF = original code path, byte for byte ──
  // db766dd = main before SRV Studio V2 shipped (PR #40): the protected baseline these checks diff against.
  const base = execSync('git show db766dd6ed3c561bdb5ea3577ab4e1bf68c98912:public/index.html', { maxBuffer: 64 << 20 }).toString('utf8');
  const strip = (s) => s.split('\n').filter((l) => !/SRV Studio V2|_srvStudioV2On\(\)\)return _srvEnglishV2|\/\/ V2:/.test(l)).join('\n');
  for (const fn of ['_srvEnglishGetStage', '_srvEnglishSetStage', '_srvEnglishPkgForTask', 'vaGeneratePackage', '_srvEnglishApprovePackage', '_srvEnglishRegeneratePackage', '_srvEnglishCancelTask']) {
    ok('OFF path unchanged: ' + fn, strip(top(H, fn)) === top(base, fn));
  }
  {
    const E = makeEnv({}); await E.settle(); const { ctx } = E;
    ctx.D.tasks = [task(5)]; ctx.D.packages = [pkgOf('p1', 5)];
    vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    ok('OFF: stage stored under the numeric key only', JSON.stringify(ctx.D.srvLifecycleStages) === '{"5":"review"}');
    const html = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('OFF: Review is the original read-only view (no edit boxes, no V2 badge)', !/<textarea|srv2f_/.test(html) && !/>V2</.test(html) && /Approve Package → Build/.test(html));
  }

  {
    // Every stage of the SRV English card renders the same HTML with the flag OFF as on main.
    const mk = async (src) => { const E = makeEnv({ src }); await E.settle(); return E; };
    const A = await mk(base), B = await mk(H);
    const same = [];
    for (const [stage, isLong, extra] of [['generate', false, {}], ['review', false, {}], ['review', true, {}], ['review', false, { title: 'Our First Kiss', concept: 'first kiss' }], ['build', false, {}], ['build', true, {}], ['approve', true, { _srvLongVideoUrl: 'https://x/v.webm' }], ['done', false, { _srvYtShortId: 'abc' }]]) {
      const html = [A, B].map(({ ctx }) => {
        ctx.D.tasks = [task(5, isLong ? { contentType: 'Long', isLong: true } : {})]; ctx.D.packages = [pkgOf('p1', 5, extra)]; ctx.D.srvLifecycleStages = { 5: stage };
        return vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
      });
      same.push(html[0] === html[1] ? 'ok' : stage + (isLong ? '/long' : ''));
    }
    ok('OFF: every lifecycle stage renders byte-identical HTML to main (incl. quality score + kiss gate)', same.every((x) => x === 'ok'), same.join(','));
  }
  {
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx } = E;
    ctx.D.tasks = [task(5)]; ctx.D.packages = [pkgOf('p1', 5)]; vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    const v2 = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('V2 Review shows the SRV Studio V2 quality panel (Checkpoint B) instead of the V1 pop scorer', /SRV STUDIO V2 QUALITY · SHORT/.test(v2) && !/Kiss Fixation|Commercial Potential/.test(v2));
  }

  // ── 3. Identity (srvUid) ──
  {
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx } = E;
    const oldT = task(5, { status: 'done', createdAt: T0 }); const oldPkg = pkgOf('p_old', 5, { generatedAt: new Date(T0 + 1000).toISOString() });
    ctx.D.tasks = [oldT]; ctx.D.packages = [oldPkg];
    ctx.D.srvLifecycleStages = { 5: 'approve' };
    ok('V2: legacy task keeps its numeric-key stage', vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'approve');
    ok('V2: legacy package still binds when unambiguous', vm.runInContext('_srvEnglishPkgForTask(D.tasks[0])', ctx) === oldPkg);
    // id 5 is recycled by a NEW task created after the identity epoch
    const epoch = ctx.D.srvLifecycleStages.__identityEpoch;
    ok('V2: identity epoch recorded in the stage map', typeof epoch === 'number');
    oldT.engine = 'SRV English'; ctx.D.tasks = [task(5, { createdAt: epoch + 5000 })];
    ok('V2: a recycled numeric id does NOT inherit the old stage', vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'generate');
    ok('V2: a recycled numeric id does NOT inherit a package that predates it', vm.runInContext('_srvEnglishPkgForTask(D.tasks[0])', ctx) === null);
    vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    const uid = 'srve_' + (epoch + 5000) + '_5';
    ok('V2: stage written under srvUid and the numeric back-compat key', ctx.D.srvLifecycleStages[uid] === 'review' && ctx.D.srvLifecycleStages['5'] === 'review');
    ok('V2: srvUid stamped on the task', ctx.D.tasks[0].srvUid === uid);
    const stamped = pkgOf('p_new', 5, { srvTaskUid: uid, generatedAt: new Date(epoch + 6000).toISOString() });
    ctx.D.packages.push(stamped);
    ok('V2: package bound by srvTaskUid', vm.runInContext('_srvEnglishPkgForTask(D.tasks[0])', ctx) === stamped);
    // cross-engine numeric collision
    ctx.D.tasks = [{ id: 9, engine: 'SRV Farsi', createdAt: T0 }, task(9)];
    ok('V2: numeric id shared with another engine resolves only the SRV English task', vm.runInContext("_srvEnglishTaskById('9')", ctx) === ctx.D.tasks[1]);
    ctx.D.tasks = [task(9), task(9, { createdAt: T0 + 99 })];
    ok('V2: duplicate SRV English ids → refuses to guess', vm.runInContext("_srvEnglishTaskById('9')", ctx) === null);
  }

  // ── 4. Task-level TEST ──
  {
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx } = E;
    ctx.D.tasks = [task(1, { isTest: true }), task(2, { name: 'SRV English — Female · Short [TEST]' }), task(3, { assignmentReason: 'x [manual-test]' }), task(4)];
    const r = [1, 2, 3, 4].map((i) => vm.runInContext(`_srvEnglishIsTestTask(D.tasks[${i - 1}])`, ctx));
    ok('TEST: isTest / [TEST] name / [manual-test] detected; plain task is not', JSON.stringify(r) === '[true,true,true,false]');
    ok('TEST: a test package forces test publish even on a real task', vm.runInContext("_srvEnglishV2IsTestPublish('4',{isTest:true})", ctx) === true);
    ok('TEST: real task + real package → not test', vm.runInContext("_srvEnglishV2IsTestPublish('4',{})", ctx) === false);
    const html = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('TEST: card shows V2 + TEST TASK badges', />V2</.test(html) && /TEST TASK/.test(html));
    const pub = top(H, '_srvEnglishRunPublish');
    const pub2 = top(H, '_srvEnglishV2Publish');
    ok('TEST: V2 publish (D2) adds task-level test on top of engine-wide test; V1 publish returns into it only when V2 is on', /if\(_srvStudioV2On\(\)\)return _srvEnglishV2Publish\(pkgId,taskId\);/.test(pub) && /const taskTest=_srvEnglishV2IsTestPublish\(taskId,pkg\);\n\s*const test=_getEngineState\('SRV English'\)==='test'\|\|taskTest;/.test(pub2));
  }

  // ── 5. Review editor + persistence ──
  {
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, el, els, calls } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p];
    vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    const html = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    const fields = ['title', 'lyrics', 'shortLyrics', 'sunoPrompt', 'shortSunoPrompt'];
    // SRV-STUDIO-V2-021: a Short shows only its own lyrics + Suno prompt (plus title and the editable caption).
    ok('Review (Short): only title, Short lyrics, Short Suno prompt and the caption are editable boxes', ['title', 'shortLyrics', 'shortSunoPrompt', 'captionYT'].every((k) => html.includes('id="srv2f_p1_' + k + '"')) && !html.includes('id="srv2f_p1_lyrics"') && !html.includes('id="srv2f_p1_sunoPrompt"'));
    ok('Review (Short): the Long lyrics and Long Suno prompt are not displayed at all', !/FULL LYRICS/.test(html) && !/SUNO STYLE PROMPT — FULL SONG/.test(html) && !html.includes('[HOOK]\nfull lyric') && !html.includes('full prompt'));
    ok('Review: title is a text input, Short lyrics / Short prompt / caption are textareas', /<input type="text" id="srv2f_p1_title"/.test(html) && (html.match(/<textarea id="srv2f_p1_/g) || []).length === 3);
    ok('Review: Short task marks short lyrics + short prompt as USED IN BUILD', /SHORT LYRICS<span[^>]*>USED IN BUILD/.test(html) && /SUNO STYLE PROMPT — SHORT<span[^>]*>USED IN BUILD/.test(html) && !/FULL LYRICS<span[^>]*>USED IN BUILD/.test(html));
    ok('Review: Approve / Regenerate / Cancel present', /Save &amp; Approve Package → Build/.test(html) && /_srvEnglishV2RegeneratePackage/.test(html) && /_srvEnglishV2CancelTask/.test(html));
    ok('Review: HTML in a field is escaped', (() => { p.title = '<b>x</b>'; const h2 = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx); p.title = 'Stay Tonight'; return !h2.includes('<b>x</b>'); })());
    fields.forEach((k) => el('srv2f_p1_' + k, p[k])); fields.forEach((k) => el('srv2st_p1_' + k)); el('srv2capst_p1'); el('srv2cap_p1'); el('srv2tags_p1'); el('srv2approve_st_p1');
    els.srv2f_p1_title.value = '  Night   Drive Home ';
    const rendersBefore = calls.renders;
    const r1 = await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx); await E.settle();
    ok('Save title: resolves true and normalizes whitespace', r1 === true && p.title === 'Night Drive Home');
    const last = calls.upserts[calls.upserts.length - 1];
    ok('Save title: database row carries the new title (column + full_package)', last && last.title === 'Night Drive Home' && JSON.parse(last.full_package).title === 'Night Drive Home');
    ok('Save title: caption regenerated from the edited title', calls.caption.length === 1 && calls.caption[0].title === 'Night Drive Home' && calls.caption[0].isLong === false && calls.caption[0].lyrics === 'short lyric');
    ok('Save title: new caption + hashtags saved on the package', p.captionYT.startsWith('Caption for Night Drive Home') && p.captionYouTube === p.captionYT && p.hashtags === '#SRVStudio #NightDrive');
    ok('Save title: caption box updated in place (other unsaved edits not wiped by a re-render)', els.srv2cap_p1.textContent === p.captionYT && calls.renders === rendersBefore, JSON.stringify([els.srv2cap_p1.textContent, calls.renders]));
    ok('Save title: edit timestamp recorded', !!(p._srvV2Edits && p._srvV2Edits.title));
    els.srv2f_p1_sunoPrompt.value = 'emotional deep house, night drive, female vocal';
    const nCap = calls.caption.length;
    await vm.runInContext("_srvEnglishV2SaveField('p1','sunoPrompt')", ctx); await E.settle();
    ok('Save Suno prompt: persisted', p.sunoPrompt === 'emotional deep house, night drive, female vocal' && JSON.parse(calls.upserts[calls.upserts.length - 1].full_package).sunoPrompt === p.sunoPrompt);
    ok('Save Suno prompt: does not regenerate the caption', calls.caption.length === nCap);
    els.srv2f_p1_shortSunoPrompt.value = 'deep house hook, 0:30';
    await vm.runInContext("_srvEnglishV2SaveField('p1','shortSunoPrompt')", ctx);
    els.srv2f_p1_lyrics.value = '[HOOK]\nedited full';
    await vm.runInContext("_srvEnglishV2SaveField('p1','lyrics')", ctx);
    els.srv2f_p1_shortLyrics.value = 'edited short';
    await vm.runInContext("_srvEnglishV2SaveField('p1','shortLyrics')", ctx); await E.settle();
    // reload: fetch packages back from the mock table through the REAL loader
    const reloaded = await vm.runInContext('fetchPackagesFromTable()', ctx);
    const rp = reloaded.find((x) => x.id === 'p1');
    ok('Reload: every edited field comes back from the database', rp && rp.title === 'Night Drive Home' && rp.lyrics === '[HOOK]\nedited full' && rp.shortLyrics === 'edited short' && rp.sunoPrompt === p.sunoPrompt && rp.shortSunoPrompt === 'deep house hook, 0:30');
    ok('Reload: regenerated caption comes back too', rp && rp.captionYT === p.captionYT);
    ctx.D.packages = reloaded;
    vm.runInContext("_srvEnglishSetStage('5','build')", ctx);
    const bh = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('Build: shows the saved title, short lyrics and short Suno prompt it will use', /THIS BUILD WILL USE \(SHORT\)/.test(bh) && bh.includes('Night Drive Home') && bh.includes('edited short') && bh.includes('deep house hook, 0:30'));
    // validation
    els.srv2f_p1_title.value = '   ';
    ok('Validation: empty title rejected, package untouched', (await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx)) === false && rp.title === 'Night Drive Home' && /cannot be empty/.test(els.srv2st_p1_title.textContent));
    els.srv2f_p1_title.value = 'x'.repeat(101);
    ok('Validation: title over 100 characters rejected', (await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx)) === false && /100 characters/.test(els.srv2st_p1_title.textContent));
  }

  // ── 6. Save failure is reported, Approve is blocked until saved ──
  {
    const E = makeEnv({ flag: 'true', saveOk: false }); await E.settle(); const { ctx, el, els } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p];
    vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    ['title', 'shortLyrics', 'shortSunoPrompt'].forEach((k) => { el('srv2f_p1_' + k, p[k]); el('srv2st_p1_' + k); }); el('srv2approve_st_p1'); el('srv2capst_p1');
    els.srv2f_p1_shortLyrics.value = 'changed';
    ok('Failure: database error → Save resolves false with a visible message', (await vm.runInContext("_srvEnglishV2SaveField('p1','shortLyrics')", ctx)) === false && /Not saved to the database/.test(els.srv2st_p1_shortLyrics.textContent));
    ok('Failure: package keeps the last saved value; typed text stays in the box', p.shortLyrics === 'short lyric' && els.srv2f_p1_shortLyrics.value === 'changed');
    await vm.runInContext("_srvEnglishV2ApprovePackage('5','p1')", ctx);
    ok('Failure: Approve does not advance while an edit is unsaved', vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'review' && /could not be saved/.test(els.srv2approve_st_p1.textContent));
  }
  {
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, el, els, calls } = E;
    ctx.D.tasks = [task(5, { contentType: 'Long', isLong: true })]; const p = pkgOf('p1', 5); ctx.D.packages = [p];
    vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    ['title', 'lyrics', 'shortLyrics', 'sunoPrompt', 'shortSunoPrompt'].forEach((k) => { el('srv2f_p1_' + k, p[k]); el('srv2st_p1_' + k); }); el('srv2approve_st_p1'); el('srv2capst_p1'); el('srv2cap_p1'); el('srv2tags_p1');
    els.srv2f_p1_title.value = 'Unsaved Title'; els.srv2f_p1_lyrics.value = 'unsaved full lyrics';
    await vm.runInContext("_srvEnglishV2ApprovePackage('5','p1')", ctx); await E.settle();
    ok('Approve: unsaved edits are saved first, then the task moves to Build', p.title === 'Unsaved Title' && p.lyrics === 'unsaved full lyrics' && vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'build');
    ok('Approve: the task stays open after moving to Build', (calls.opened || []).includes('5'));
    ok('Approve: one caption refresh for the batch, using the Long task\'s full lyrics', calls.caption.length === 1 && calls.caption[0].isLong === true && calls.caption[0].lyrics === 'unsaved full lyrics');
  }
  {
    const E = makeEnv({ flag: 'true', captionOk: false }); await E.settle(); const { ctx, el, els } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p];
    el('srv2f_p1_title', 'New'); el('srv2st_p1_title'); el('srv2capst_p1');
    await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx); await E.settle();
    ok('Caption failure: title still saved, previous caption kept, message shown', p.title === 'New' && p.captionYT === 'old caption' && /previous caption is kept/.test(els.srv2capst_p1.textContent));
  }

  // ── 7. Generate / regenerate bind the new package to the task ──
  {
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, calls } = E;
    ctx.D.tasks = [task(5, { isTest: true })];
    await vm.runInContext("vaGeneratePackage('5')", ctx); await E.settle();
    const g = ctx.D.packages[0];
    ok('Generate: package stamped with srvTaskUid and isTest, task moved to Review', g && g.srvTaskUid === 'srve_' + (T0 + 5000) + '_5' && g.isTest === true && vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'review');
    ok('Generate: stamped package saved to the database', calls.upserts.some((r) => JSON.parse(r.full_package).srvTaskUid === g.srvTaskUid));
    await vm.runInContext(`_srvEnglishV2RegeneratePackage('5','${g.id}')`, ctx); await E.settle();
    ok('Regenerate: old package replaced by a new stamped one', ctx.D.packages.length === 1 && ctx.D.packages[0].id !== g.id && ctx.D.packages[0].srvTaskUid === g.srvTaskUid && vm.runInContext("_srvEnglishPkgForTask(D.tasks[0])", ctx) === ctx.D.packages[0]);
    ctx.D.tasks = [{ id: 7, engine: 'NextWave', createdAt: T0 }, task(7)];
    const before = calls.generate;
    await vm.runInContext("vaGeneratePackage('7')", ctx);
    ok('Generate: refused when the numeric id is shared with another engine\'s task', calls.generate === before && calls.alerts.some((a) => /shared with another engine/.test(a)));
    ctx.generatePackage = async () => { throw new Error('model timeout'); };
    ctx.D.tasks = [task(5)]; const keep = pkgOf('p_keep', 5, { srvTaskUid: 'srve_' + (T0 + 5000) + '_5' }); ctx.D.packages = [keep];
    vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    await vm.runInContext("_srvEnglishV2RegeneratePackage('5','p_keep')", ctx);
    ok('Regenerate failure: the previous package is kept and the task stays in Review', ctx.D.packages.includes(keep) && vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'review');
  }

  // ── 8. Server caption action (parse + dispatch) ──
  {
    const parse = new Function(top(OPS, 'parseSrvEnglishCaption') + '\nreturn parseSrvEnglishCaption;')();
    const a = parse('CAPTION:\nHook line\nAbout the song.\nSubscribe.\n#DeepHouse #NightDrive #SRVStudio');
    ok('Server: CAPTION block parsed, hashtags extracted', a && a.captionYT.startsWith('Hook line') && a.hashtags === '#DeepHouse #NightDrive #SRVStudio');
    const b = parse('Just text #DeepHouse');
    ok('Server: unformatted reply still usable and #SRVStudio always present', b && b.captionYT === 'Just text #DeepHouse' && b.hashtags === '#DeepHouse #SRVStudio');
    ok('Server: empty reply rejected', parse('  ') === null);
    ok('Server: action dispatched', /action === 'srv_english_regen_caption'\)\s+return await srvEnglishRegenCaption\(req, res\)/.test(OPS));
    ok('Server: action writes nothing (its only Supabase access is the D4 read-only V2 flag check)', !/sbPost|sbPatch|sbGet/i.test(top(OPS, 'srvEnglishRegenCaption')) && !/supabase/i.test(top(OPS, 'srvEnglishRegenCaption').replace('srvStudioV2FlagEnabled({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_SERVICE_KEY })', '')) && /srvStudioV2FlagEnabled\(\{ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_SERVICE_KEY \}\)/.test(top(OPS, 'srvEnglishRegenCaption')));
  }

  // ── 10. SRV-STUDIO-V2-021: caption sync + format-specific content ──
  const R = await import(require('url').pathToFileURL(require('path').resolve(__dirname, '../../public/srv-studio-v2/srv2-render.mjs')).href);
  const fieldEls = (E, p, keys) => { keys.forEach((k) => { E.el('srv2f_p1_' + k, k === 'captionYT' ? (p.captionYT || '') : p[k]); E.el('srv2st_p1_' + k); }); ['srv2capst_p1', 'srv2capact_p1', 'srv2approve_st_p1', 'srv2prev_p1'].forEach((id) => E.el(id)); };
  const SHORT_KEYS = ['title', 'shortLyrics', 'shortSunoPrompt', 'captionYT'], LONG_KEYS = ['title', 'lyrics', 'sunoPrompt', 'captionYT'];
  {
    // Long Review: only Long content
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx } = E;
    ctx.D.tasks = [task(5, { contentType: 'Long', isLong: true })]; ctx.D.packages = [pkgOf('p1', 5)];
    vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    const html = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('021 Long Review: only title, full lyrics, full-song Suno prompt and caption are shown', LONG_KEYS.every((k) => html.includes('id="srv2f_p1_' + k + '"')) && !html.includes('id="srv2f_p1_shortLyrics"') && !html.includes('id="srv2f_p1_shortSunoPrompt"') && !/SHORT LYRICS|SUNO STYLE PROMPT — SHORT/.test(html) && !html.includes('short lyric'));
    ok('021 Long Review: the exact publish preview box is present (no misleading "auto hashtags" box)', html.includes('id="srv2prev_p1"') && !/HASHTAGS \(auto\)/.test(html));
    ok('021 format: task.isLong alone makes a Long everywhere (Review, caption, Build, Publish share one resolver)', vm.runInContext("_srvEnglishV2BuildKeys({isLong:true},{}).lyrics", ctx) === 'lyrics' && vm.runInContext("_srvEnglishV2IsLong({isLong:true},{})", ctx) === true && vm.runInContext("_srvEnglishV2BuildKeys({contentType:'Short Video'},{lyrics:'x'}).lyrics", ctx) === 'shortLyrics');
    ok('021 Build keys are strict: a Short with no Short lyrics does NOT fall back to the Long lyrics', vm.runInContext("_srvEnglishV2BuildKeys({contentType:'Short Video'},{lyrics:'only long'}).lyrics", ctx) === 'shortLyrics');
  }
  {
    // The CEO's live case (#131): a Short whose FULL LYRICS box was edited before this fix, caption stale.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, els, calls } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5, { title: 'The part you left behind', lyrics: 'The part you left behind\nStill reaches out for you', shortLyrics: 'Touch my hand first', captionYT: 'I need to feel you choose me', _srvV2Edits: { title: '2026-10-16T01:15:40.281Z', lyrics: '2026-10-16T01:15:41.838Z' } });
    ctx.D.packages = [p]; vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    const html = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('021 live case: Review explains the Full Lyrics edit and offers to copy it into Short Lyrics', /FULL LYRICS<\/strong> \(Long content\) was edited on 2026-10-16 01:15 UTC/.test(html) && /_srvEnglishV2CopyFromOther\('p1','lyrics','shortLyrics'\)/.test(html));
    ok('021 live case: the stale caption is detected', vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === false);
    fieldEls(E, p, SHORT_KEYS);
    vm.runInContext("_srvEnglishV2CopyFromOther('p1','lyrics','shortLyrics')", ctx);
    ok('021 copy: the Full Lyrics text is placed in the Short Lyrics box, unsaved, nothing deleted', els.srv2f_p1_shortLyrics.value === p.lyrics && p.shortLyrics === 'Touch my hand first' && /Unsaved/.test(els.srv2st_p1_shortLyrics.textContent));
    await vm.runInContext("_srvEnglishV2ApprovePackage('5','p1')", ctx); await E.settle();
    const c = calls.caption[calls.caption.length - 1];
    ok('021 Approve: saves the Short lyrics, refreshes the caption from the latest title + SHORT lyrics, then moves to Build', p.shortLyrics === p.lyrics && c && c.title === 'The part you left behind' && c.lyrics === p.shortLyrics && c.isLong === false && p.captionYT.startsWith('Caption for The part you left behind') && vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'build');
    ok('021 Approve: the Long lyrics are still stored untouched', p.lyrics === 'The part you left behind\nStill reaches out for you');
    ok('021 caption now fresh and recorded against the saved song', vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === true && p._srvV2Meta && p._srvV2Meta.src === vm.runInContext('_srvEnglishV2MetaSrc(D.tasks[0],D.packages[0])', ctx));
    const meta = R.srv2YouTubeMetadata('short', p, { test: false, moodKey: 'emotional' });
    ok('021 publish payload: title and description come from the latest saved title + refreshed caption', meta.title.startsWith('The part you left behind') && meta.description.includes('Caption for The part you left behind') && !meta.description.includes('I need to feel you'));
  }
  {
    // Title edit → automatic caption regenerated and stamped; Suno-prompt edit does not touch it.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, els, calls } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p]; fieldEls(E, p, SHORT_KEYS);
    els.srv2f_p1_title.value = 'Midnight Signal';
    await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx); await E.settle();
    ok('021 edit title: caption regenerated from the new title and the Short lyrics; caption box updated in place', calls.caption.length === 1 && calls.caption[0].title === 'Midnight Signal' && calls.caption[0].lyrics === 'short lyric' && els.srv2f_p1_captionYT.value === p.captionYT && p.captionYT.startsWith('Caption for Midnight Signal'));
    ok('021 edit title: caption is fresh; the database row carries the new caption', vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === true && JSON.parse(calls.upserts[calls.upserts.length - 1].full_package).captionYT === p.captionYT);
    els.srv2f_p1_shortLyrics.value = 'a brand new short lyric';
    await vm.runInContext("_srvEnglishV2SaveField('p1','shortLyrics')", ctx); await E.settle();
    ok('021 edit lyrics: caption regenerated from the edited Short lyrics', calls.caption.length === 2 && calls.caption[1].lyrics === 'a brand new short lyric' && vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === true);
    els.srv2f_p1_shortSunoPrompt.value = 'female vocal, deep house';
    await vm.runInContext("_srvEnglishV2SaveField('p1','shortSunoPrompt')", ctx); await E.settle();
    ok('021 edit Suno prompt: no caption refresh, caption stays fresh', calls.caption.length === 2 && vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === true);
  }
  {
    // Manual caption: kept as written, never overwritten; the CEO chooses.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, els, calls } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p]; fieldEls(E, p, SHORT_KEYS);
    els.srv2f_p1_captionYT.value = 'My own words about this song.';
    await vm.runInContext("_srvEnglishV2SaveField('p1','captionYT')", ctx); await E.settle();
    ok('021 manual caption: saved as written (YouTube field mirrored), recorded as manual, no model call', p.captionYT === 'My own words about this song.' && p.captionYouTube === p.captionYT && p._srvV2Meta.manual.captionYT && calls.caption.length === 0 && JSON.parse(calls.upserts[calls.upserts.length - 1].full_package)._srvV2Meta.manual.captionYT);
    els.srv2f_p1_title.value = 'A Different Title';
    await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx); await E.settle();
    ok('021 manual caption + title edit: the manual caption is NOT overwritten; the new caption is only offered', p.captionYT === 'My own words about this song.' && p._srvV2Meta.suggest && p._srvV2Meta.suggest.captionYT.startsWith('Caption for A Different Title'));
    ok('021 manual caption + title edit: the caption is flagged for the CEO and Approve is blocked', vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).reason', ctx) === 'manual_outdated' && /Keep my caption/.test(els.srv2capact_p1.innerHTML) && /Use the new caption/.test(els.srv2capact_p1.innerHTML));
    await vm.runInContext("_srvEnglishV2ApprovePackage('5','p1')", ctx); await E.settle();
    ok('021 Approve refused while the manual caption is unconfirmed (stays in Review, nothing regenerated over it)', vm.runInContext("_srvEnglishGetStage('5')", ctx) !== 'build' && /Keep my caption/.test(els.srv2approve_st_p1.textContent) && p.captionYT === 'My own words about this song.');
    await vm.runInContext("_srvEnglishV2KeepManualCaption('p1')", ctx); await E.settle();
    ok('021 Keep my caption: manual text kept and now counts as up to date', p.captionYT === 'My own words about this song.' && vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === true && !p._srvV2Meta.suggest);
    els.srv2f_p1_shortLyrics.value = 'lyrics changed again';
    await vm.runInContext("_srvEnglishV2SaveField('p1','shortLyrics')", ctx); await E.settle();
    await vm.runInContext("_srvEnglishV2UseSuggestedCaption('p1')", ctx); await E.settle();
    ok('021 Use the new caption: replaces the manual text with the caption generated from the latest song; automatic again', p.captionYT.startsWith('Caption for A Different Title') && calls.caption[calls.caption.length - 1].lyrics === 'lyrics changed again' && !(p._srvV2Meta.manual && p._srvV2Meta.manual.captionYT) && vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === true);
    els.srv2f_p1_captionYT.value = 'Manual again';
    await vm.runInContext("_srvEnglishV2SaveField('p1','captionYT')", ctx); await E.settle();
    const nCap = calls.caption.length;
    els.srv2f_p1_captionYT.value = '';
    await vm.runInContext("_srvEnglishV2SaveField('p1','captionYT')", ctx); await E.settle();
    ok('021 clearing the caption and saving hands it back to automatic generation', calls.caption.length === nCap + 1 && p.captionYT.startsWith('Caption for') && !(p._srvV2Meta.manual && p._srvV2Meta.manual.captionYT));
  }
  {
    // Caption service down: Approve is blocked rather than letting a stale caption through.
    const E = makeEnv({ flag: 'true', captionOk: false }); await E.settle(); const { ctx, els } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p]; fieldEls(E, p, SHORT_KEYS);
    els.srv2f_p1_title.value = 'Edited Title';
    await vm.runInContext("_srvEnglishV2ApprovePackage('5','p1')", ctx); await E.settle();
    ok('021 caption refresh failure: title saved, old caption kept, Approve refused with a retry instruction', p.title === 'Edited Title' && p.captionYT === 'old caption' && vm.runInContext("_srvEnglishGetStage('5')", ctx) !== 'build' && /Refresh caption now/.test(els.srv2approve_st_p1.textContent));
    // Publish gate: a stale caption never reaches an upload (checked before any slot or pilot claim).
    vm.runInContext("_srvEnglishSetStage('5','approve')", ctx); p._srvShortVideoUrl = 'https://stub.invalid/storage/v1/object/public/srv-assets/p1/short.webm';
    const st = E.el('srv-lc-publish-status-p1'); st.appendChild = () => {};
    const nUp = E.calls.upserts.length;
    await vm.runInContext("_srvEnglishV2Publish('p1','5')", ctx); await E.settle();
    ok('021 Publish refused for a stale caption: no upload, no pilot claim, no package write', /caption is out of date/.test(st.textContent) && E.calls.upserts.length === nUp);
  }
  {
    // Empty format content is refused at Approve and Build.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, els } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5, { shortLyrics: '' }); ctx.D.packages = [p]; fieldEls(E, p, SHORT_KEYS);
    await vm.runInContext("_srvEnglishV2ApprovePackage('5','p1')", ctx); await E.settle();
    ok('021 Approve: a Short with no Short lyrics is refused (the Long lyrics are never used instead)', vm.runInContext("_srvEnglishGetStage('5')", ctx) !== 'build' && /needs SHORT LYRICS/.test(els.srv2approve_st_p1.textContent));
    ok('021 Build: refuses a package with no lyrics for its own format', /if\(!String\(pkg\[used\.lyrics\]\|\|''\)\.trim\(\)\)\{setStatus\(.*build refused/.test(top(H, '_srvEnglishV2Build')));
  }
  {
    // Build hook: the generated hook is used only while it is still in this format's saved lyrics.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx } = E;
    ctx.R = R;
    const keep = vm.runInContext("_srvEnglishV2HookFor(R,{isLong:true},{hook:'Hold on tonight',lyrics:'[Chorus]\\nHold on tonight\\nstay'})", ctx);
    const swap = vm.runInContext("_srvEnglishV2HookFor(R,{isLong:true},{hook:'Hold on tonight',lyrics:'[Chorus]\\nNew line after the edit\\nmore'})", ctx);
    const shortH = vm.runInContext("_srvEnglishV2HookFor(R,{contentType:'Short Video'},{hook:'',lyrics:'[Chorus]\\nLONG chorus',shortLyrics:'Short first line\\nnext'})", ctx);
    ok('021 Build hook: kept while in the lyrics, re-derived from the edited lyrics, and a Short uses Short lyrics', keep === 'Hold on tonight' && swap === 'New line after the edit' && shortH === 'Short first line');
    ok('021 Build passes the format hook, not the raw package hook', /hook:_srvEnglishV2HookFor\(R,task,pkg\)/.test(top(H, '_srvEnglishV2Build')));
    ok('021 Review preview and Publish build metadata with the same function', /R\.srv2YouTubeMetadata\(kind,pkg/.test(top(H, '_srvEnglishV2FillPreview')) && /R\.srv2YouTubeMetadata\(kind,pkg/.test(top(H, '_srvEnglishV2Publish')));
  }

  // ── 9. Shared systems untouched ──
  const baseOps = execSync('git show db766dd6ed3c561bdb5ea3577ab4e1bf68c98912:api/ops.js', { maxBuffer: 64 << 20 }).toString('utf8');
  // youtubeUploadVideo/_getYoutubeConnectionByTitle: unchanged by the V2 checkpoints (pre-017 tip); SRV-STUDIO-V2-017 hardens them,
  // covered by tests/platform/test_publish_auth.mjs.
  const pre017Ops = execSync('git show 1724aed:api/ops.js', { maxBuffer: 64 << 20 }).toString('utf8');
  for (const fn of ['farsiRegenCaption', 'youtubeUploadVideo', '_getYoutubeConnectionByTitle']) {
    let same = false; try { same = top(fn === 'farsiRegenCaption' ? OPS : pre017Ops, fn) === top(baseOps, fn); } catch (e) { same = false; }
    ok('Shared unchanged (ops.js): ' + fn, same);
  }
  for (const fn of ['savePackageToSupabase', '_srvSavePackageQueued', 'fetchPackagesFromTable', 'renderSRVFarsiLifecycleCard', '_farsisaveEdit', '_srvFarsiSetStage', '_srvRenderVideo', 'saveAppState', 'loadAppState']) {
    ok('Shared unchanged (index.html): ' + fn, top(H, fn) === top(base, fn));
  }
  {
    // Checkpoint B adds one flag-gated request field to generatePackage(); everything else is unchanged.
    const g = top(H, 'generatePackage');
    const restored = g.replace(",taskName:t.name,recentPackages,\n        ...(t.engine==='SRV English'&&typeof _srvStudioV2On==='function'&&_srvStudioV2On()?{srvStudioV2:true}:{})}) // SRV Studio V2: request V2 music direction only while the flag is on", ',taskName:t.name,recentPackages})');
    ok('Shared (index.html): generatePackage unchanged apart from the flag-gated srvStudioV2 request field', restored === top(base, 'generatePackage'));
  }

  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
