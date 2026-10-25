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
function makeEnv({ flag = null, search = '', saveOk = true, captionOk = true, readbackLie = false, settings = {}, upsertDelayMs = 0, src = H, titleUnique = true } = {}) {
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
      if (upsertDelayMs) await new Promise((r) => setTimeout(r, upsertDelayMs)); // production package writes take seconds
      if (!saveOk) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      // production has UNIQUE (engine, title) on packages
      // titleUnique: the pre-029 database rule; false models it after the 029 migration (SRV English exempt)
      if ((titleUnique || row.engine !== 'SRV English') && Object.values(table).some((r) => r.package_id !== row.package_id && r.engine === row.engine && r.title === row.title)) return { ok: false, status: 409, text: async () => '{"code":"23505","message":"duplicate key value violates unique constraint \\"packages_engine_title_unique\\""}', json: async () => ({}) };
      table[row.package_id] = row; return json(null);
    }
    if (u.includes('/rest/v1/packages?package_id=eq.') || u.includes('/rest/v1/packages?engine=eq.')) {
      const q = new URL(u).searchParams;
      if (u.includes('/rest/v1/packages?package_id=eq.')) { calls.readbacks = (calls.readbacks || 0) + 1; const r = table[q.get('package_id').slice(3)]; return json(r && !readbackLie ? [{ title: r.title, full_package: r.full_package }] : r ? [{ title: r.title + ' (stale)', full_package: r.full_package }] : []); }
      if (u.includes('/rest/v1/packages?engine=eq.')) { const e = q.get('engine').slice(3), t = q.get('title').slice(3); return json(Object.values(table).filter((r) => r.engine === e && r.title === t).map((r) => ({ package_id: r.package_id, task_id: r.task_id, full_package: r.full_package }))); }
    }
    if (u.includes('/rest/v1/packages?order=')) return json(Object.values(table).sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at))));
    { const k = (u.match(/app_settings\?key=eq\.([a-z0-9_]+)/) || [])[1]; if (k && k in settings) return json([{ value: settings[k] }]); }
    if (u.includes('/rest/v1/app_settings?key=eq.srv_studio_v2_')) return json([]);
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
  // seed(p): the package already exists in the database (as every production package does), without counting an upsert
  const seed = (p) => { table[p.id] = { package_id: p.id, task_id: p.taskId, engine: p.engine, title: p.title, full_package: JSON.stringify(p) }; };
  return { ctx, els, el, calls, table, seed, settle: () => new Promise((r) => setTimeout(r, 20)) };
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
    ctx.D.tasks = [task(5, { contentType: 'Long', contentFormat: 'long', isLong: true })]; ctx.D.packages = [pkgOf('p1', 5)]; vm.runInContext("_srvEnglishSetStage('5','review')", ctx);
    const v2 = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('V2 Review shows the SRV Studio V2 quality panel (Checkpoint B) instead of the V1 pop scorer', /SRV STUDIO V2 QUALITY · LONG/.test(v2) && !/Kiss Fixation|Commercial Potential/.test(v2));
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
    // 026: SRV Studio is Long-only — an unfinished Short in Review is retired on its first render (nothing editable).
    ok('Review (026/029): an unfinished pre-029 Short task is retired on first render — no editable fields; a Short is made only from a Long', !/id="srv2f_p1_/.test(html) && /created as a <strong[^>]*>Short<\/strong> before SRV Studio Shorts became promotional extracts/.test(html) && ctx.D.tasks[0].status === 'done' && !!ctx.D.tasks[0].srvRetired);
    const lh = await (async () => { const L = makeEnv({ flag: 'true' }); await L.settle(); L.ctx.D.tasks = [task(5, { contentType: 'Long', contentFormat: 'long', isLong: true })]; L.ctx.D.packages = [pkgOf('p1', 5)]; vm.runInContext("_srvEnglishSetStage('5','review')", L.ctx); return vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', L.ctx); })();
    ok('Review (Long): only title, full lyrics, full-song Suno prompt and the caption are editable boxes', ['title', 'lyrics', 'sunoPrompt', 'captionYT'].every((k) => lh.includes('id="srv2f_p1_' + k + '"')) && !lh.includes('id="srv2f_p1_shortLyrics"') && !lh.includes('id="srv2f_p1_shortSunoPrompt"'));
    ok('Review (Long): Short lyrics and the Short Suno prompt are not displayed at all', !/SHORT LYRICS|SUNO STYLE PROMPT — SHORT/.test(lh) && !lh.includes('short lyric') && !lh.includes('short prompt'));
    ok('Review: title is a text input, full lyrics / full prompt / caption are textareas', /<input type="text" id="srv2f_p1_title"/.test(lh) && (lh.match(/<textarea id="srv2f_p1_/g) || []).length === 3);
    ok('Review: Long task marks full lyrics + full-song prompt as USED IN BUILD', /FULL LYRICS<span[^>]*>USED IN BUILD/.test(lh) && /SUNO STYLE PROMPT — FULL SONG<span[^>]*>USED IN BUILD/.test(lh));
    ok('Review: Approve / Regenerate / Cancel present', /Save &amp; Approve Package → Build/.test(lh) && /_srvEnglishV2RegeneratePackage/.test(lh) && /_srvEnglishV2CancelTask/.test(lh));
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
    ok('Failure: database error → Save resolves false with a visible message', (await vm.runInContext("_srvEnglishV2SaveField('p1','shortLyrics')", ctx)) === false && /Not saved — the database refused the write/.test(els.srv2st_p1_shortLyrics.textContent));
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
    const LONG = { contentType: 'Long', contentFormat: 'long', isLong: true }; // 026: SRV Studio generates Long tasks only
    ctx.D.tasks = [task(5, { isTest: true, ...LONG })];
    await vm.runInContext("vaGeneratePackage('5')", ctx); await E.settle();
    const g = ctx.D.packages[0];
    ok('Generate: package stamped with srvTaskUid and isTest, task moved to Review', g && g.srvTaskUid === 'srve_' + (T0 + 5000) + '_5' && g.isTest === true && vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'review');
    ok('Generate: stamped package saved to the database', calls.upserts.some((r) => JSON.parse(r.full_package).srvTaskUid === g.srvTaskUid));
    await vm.runInContext(`_srvEnglishV2RegeneratePackage('5','${g.id}')`, ctx); await E.settle();
    ok('Regenerate: old package replaced by a new stamped one', ctx.D.packages.length === 1 && ctx.D.packages[0].id !== g.id && ctx.D.packages[0].srvTaskUid === g.srvTaskUid && vm.runInContext("_srvEnglishPkgForTask(D.tasks[0])", ctx) === ctx.D.packages[0]);
    ctx.D.tasks = [{ id: 7, engine: 'NextWave', createdAt: T0 }, task(7, LONG)];
    const before = calls.generate;
    await vm.runInContext("vaGeneratePackage('7')", ctx);
    ok('Generate: refused when the numeric id is shared with another engine\'s task', calls.generate === before && calls.alerts.some((a) => /shared with another engine/.test(a)));
    ctx.generatePackage = async () => { throw new Error('model timeout'); };
    ctx.D.tasks = [task(5, LONG)]; const keep = pkgOf('p_keep', 5, { srvTaskUid: 'srve_' + (T0 + 5000) + '_5' }); ctx.D.packages = [keep];
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
    // 026: the Short itself is retired on render; the other-format notice is checked on the Long analog.
    const lnh = await (async () => { const L = makeEnv({ flag: 'true' }); await L.settle(); L.ctx.D.tasks = [task(5, { contentType: 'Long', contentFormat: 'long', isLong: true })]; L.ctx.D.packages = [pkgOf('p1', 5, { shortLyrics: 'edited short text', _srvV2Edits: { shortLyrics: '2026-10-16T01:15:41.838Z' } })]; vm.runInContext("_srvEnglishSetStage('5','review')", L.ctx); return vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', L.ctx); })();
    ok('021 other-format edit: Review explains it and offers to copy it into this format (Long analog)', /SHORT LYRICS<\/strong> \(Short content\) was edited on 2026-10-16 01:15 UTC/.test(lnh) && /_srvEnglishV2CopyFromOther\('p1','shortLyrics','lyrics'\)/.test(lnh));
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

  // ── 11. SRV-STUDIO-V2-022: verified saves, unique titles, one authoritative title, revalidation ──
  const pubEl = (E, id) => { const st = E.el('srv-lc-publish-status-' + id); st.appendChild = () => {}; return st; };
  {
    // Exact production reproduction (read-only copy of the live rows, 2026-10-16): #131 was cancelled at 01:24 UTC
    // and its package holds "The part you left behind"; the CEO then works in #133, whose package is titled
    // "Your Hand Found Mine", and retitles it — production returned 409 (packages_engine_title_unique).
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, els, calls } = E;
    const t131 = task(131, { status: 'done', cancelledAt: Date.UTC(2026, 9, 16, 1, 24, 22) }), t133 = task(133);
    const old = pkgOf('pkg_1792112629901', 131, { title: 'The part you left behind', shortLyrics: 'Touch my hand first', captionYT: 'I need to feel you choose me' });
    const cur = pkgOf('pkg_1792116542283', 133, { title: 'Your Hand Found Mine', shortLyrics: 'The part you left behind\nStill reaches out for you\nI gave you all of me\nThen you changed your mind', captionYT: 'The part you left behind still reaches out for you' });
    ctx.D.tasks = [t131, t133]; ctx.D.packages = [cur, old]; E.seed(old);
    cur._srvV2Meta = { src: vm.runInContext('_srvEnglishV2MetaSrc(D.tasks[1],D.packages[0])', ctx), at: '2026-10-16T02:12:09.491Z' }; E.seed(cur);
    const P = cur.id; const f = (k, v) => { E.el('srv2f_' + P + '_' + k, v); E.el('srv2st_' + P + '_' + k); E.el('srv2fa_' + P + '_' + k); };
    f('title', cur.title); f('shortLyrics', cur.shortLyrics); f('shortSunoPrompt', cur.shortSunoPrompt); f('captionYT', cur.captionYT);
    ['srv2capst_', 'srv2capact_', 'srv2approve_st_', 'srv2prev_'].forEach((x) => E.el(x + P));
    vm.runInContext("_srvEnglishSetStage('133','review')", ctx);
    els['srv2f_' + P + '_title'].value = 'The part you left behind';
    const r = await vm.runInContext(`_srvEnglishV2SaveField('${P}','title')`, ctx); await E.settle();
    ok('022 reproduction: the title save fails and says exactly why (duplicate title held by cancelled task #131)', r === false && /another SRV English package already uses this title \(task #131, cancelled, package pkg_1792112629901\)/.test(els['srv2st_' + P + '_title'].textContent));
    // 029: titles may repeat, so there is no pre-check any more; while the database still has the old unique rule the
    // write is refused there, explained, and nothing is stored.
    ok('022/029 with the old database rule: the refused title is not stored (the package row keeps its saved title)', E.table[P].title === 'Your Hand Found Mine' && /database still has the old one-title-per-business rule/.test(els['srv2st_' + P + '_title'].textContent));
    ok('022 failed save is not silent: the typed title stays in the box and is listed as NOT saved; the package keeps the saved title', els['srv2f_' + P + '_title'].value === 'The part you left behind' && cur.title === 'Your Hand Found Mine' && JSON.stringify(vm.runInContext(`_srvEnglishV2DirtyKeys('${P}')`, ctx)) === '["title"]');
    ok('022 "Up to date" is never shown while the title is unsaved; the screen names the saved title the payload still uses', /Not up to date — SONG TITLE is not saved/.test(els['srv2capact_' + P].innerHTML) && /Your Hand Found Mine/.test(els['srv2capact_' + P].innerHTML) && !/Up to date with/.test(els['srv2capact_' + P].innerHTML));
    await vm.runInContext(`_srvEnglishV2ApprovePackage('133','${P}')`, ctx); await E.settle();
    ok('022 failed save blocks Approve', vm.runInContext("_srvEnglishGetStage('133')", ctx) === 'review' && /could not be saved/.test(els['srv2approve_st_' + P].textContent));
    vm.runInContext("_srvEnglishSetStage('133','build')", ctx); E.el('srv-lc-build-status-' + P); ctx._srvAudioData = { [P]: { file: {} } };
    vm.runInContext(`_srvEnglishV2Build('${P}','133')`, ctx); await E.settle();
    ok('022 failed save blocks Build', /Not saved: SONG TITLE/.test(els['srv-lc-build-status-' + P].textContent));
    cur._srvShortVideoUrl = 'https://stub.invalid/storage/v1/object/public/srv-assets/' + P + '/short.webm';
    const st = pubEl(E, P); const nUp = calls.upserts.length;
    await vm.runInContext(`_srvEnglishV2Publish('${P}','133')`, ctx); await E.settle();
    ok('022 failed save blocks Publish (before any slot, pilot claim or upload)', /Publish refused — not saved: SONG TITLE/.test(st.textContent) && calls.upserts.length === nUp);
    vm.runInContext("_srvEnglishSetStage('133','review')", ctx);
    ok('022 the cancelled, never-uploaded draft can release the title — the action is offered', /_srvEnglishV2ReleaseTitle\('pkg_1792116542283','pkg_1792112629901'\)/.test(els['srv2fa_' + P + '_title'].innerHTML));
    const rel = await vm.runInContext(`_srvEnglishV2ReleaseTitle('${P}','pkg_1792112629901')`, ctx); await E.settle();
    const oldRow = JSON.parse(E.table['pkg_1792112629901'].full_package);
    ok('022 release: the old draft is renamed (and only that), recorded as retired; its lyrics and caption are untouched', rel === true && /^The part you left behind · retired draft 629901$/.test(E.table['pkg_1792112629901'].title) && oldRow._srvV2RetiredTitle.from === 'The part you left behind' && oldRow.shortLyrics === 'Touch my hand first' && oldRow.captionYT === 'I need to feel you choose me');
    ok('022 release: the new title is saved AND read back from the database', cur.title === 'The part you left behind' && E.table[P].title === 'The part you left behind' && JSON.parse(E.table[P].full_package).title === 'The part you left behind' && /Saved and verified/.test(els['srv2st_' + P + '_title'].textContent));
    ok('022 the caption is regenerated from the authoritative title + Short lyrics', calls.caption[calls.caption.length - 1].title === 'The part you left behind' && calls.caption[calls.caption.length - 1].lyrics === cur.shortLyrics && vm.runInContext('_srvEnglishV2CaptionState(D.tasks[1],D.packages[0]).fresh', ctx) === true);
    await vm.runInContext(`_srvEnglishV2ApprovePackage('133','${P}')`, ctx); await E.settle();
    ok('022 Approve revalidates against the database and records what was approved', vm.runInContext("_srvEnglishGetStage('133')", ctx) === 'build' && cur._srvV2Approved && cur._srvV2Approved.title === 'The part you left behind' && JSON.parse(E.table[P].full_package)._srvV2Approved.src === cur._srvV2Approved.src);
    const m = R.srv2YouTubeMetadata('short', cur, { test: false, moodKey: 'romantic' });
    ok('022 final payload: YouTube title, description, caption and tags all carry "The part you left behind"; branding kept (023 title convention)', m.title === 'The part you left behind - Emotional Deep House | Night Drive SRV Studio' && m.description.startsWith('The part you left behind — ') && m.description.includes('Caption for The part you left behind') && m.tags.includes('The part you left behind') && m.tags.includes('shorts') && !/Your Hand Found Mine/.test(JSON.stringify(m)));
    // Publish revalidation: the video must be built from the approved content, and the database must still match.
    vm.runInContext("_srvEnglishSetStage('133','approve')", ctx);
    const st2 = pubEl(E, P);
    await vm.runInContext(`_srvEnglishV2Publish('${P}','133')`, ctx); await E.settle();
    ok('022 Publish refuses a video built before the latest approval', /built before the latest approval/.test(st2.textContent));
    cur.srvRender = { approvedSrc: cur._srvV2Approved.src };
    const row = E.table[P]; const saved = row.title; row.title = 'Something Else';
    await vm.runInContext(`_srvEnglishV2Publish('${P}','133')`, ctx); await E.settle();
    ok('022 Publish refuses when the database differs from this screen (title column)', /database holds different values for SONG TITLE/.test(st2.textContent));
    row.title = saved;
    ['title', 'shortLyrics', 'shortSunoPrompt', 'captionYT'].forEach((k) => delete els['srv2f_' + P + '_' + k]); // Approve stage: no Review boxes on screen
    cur.captionYT = 'changed after approval'; cur.captionYouTube = cur.captionYT; E.seed(cur);
    await vm.runInContext(`_srvEnglishV2Publish('${P}','133')`, ctx); await E.settle();
    ok('022 Publish refuses content changed after approval', /changed after approval/.test(st2.textContent));
  }
  {
    // A title held by a live or published package is never released.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, els } = E;
    const other = pkgOf('p_other', 9, { title: 'Taken Title', srvPublish: { videoId: 'abc' } });
    ctx.D.tasks = [task(5), task(9)]; const p = pkgOf('p1', 5); ctx.D.packages = [p, other]; E.seed(other); E.seed(p); fieldEls(E, p, SHORT_KEYS); E.el('srv2fa_p1_title');
    els.srv2f_p1_title.value = 'Taken Title';
    ok('022 duplicate with a published package: refused, explained, and no release offered', (await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx)) === false && /already uses this title \(task #9, package p_other\)/.test(els.srv2st_p1_title.textContent) && !els.srv2fa_p1_title.innerHTML);
  }
  {
    // Read-back verification: a write the database does not return identically is NOT a successful save.
    const E = makeEnv({ flag: 'true', readbackLie: true }); await E.settle(); const { ctx, els } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p]; fieldEls(E, p, SHORT_KEYS);
    els.srv2f_p1_title.value = 'Verified Or Not';
    ok('022 read-back mismatch → Save fails, says which field, and keeps the field unsaved', (await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx)) === false && /database returned different values for SONG TITLE/.test(els.srv2st_p1_title.textContent) && vm.runInContext("_srvEnglishV2DirtyKeys('p1')", ctx).includes('title'));
  }
  {
    // Lyrics save + read-back; Long workflow approve records a Long approval.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, els, calls } = E;
    ctx.D.tasks = [task(5, { contentType: 'Long', isLong: true })]; const p = pkgOf('p1', 5); ctx.D.packages = [p]; E.seed(p); fieldEls(E, p, LONG_KEYS);
    els.srv2f_p1_lyrics.value = '[Chorus]\nnew long chorus\nline two';
    const rb0 = calls.readbacks || 0;
    ok('022 lyrics Save is verified by reading the row back', (await vm.runInContext("_srvEnglishV2SaveField('p1','lyrics')", ctx)) === true && (calls.readbacks || 0) > rb0 && JSON.parse(E.table.p1.full_package).lyrics === '[Chorus]\nnew long chorus\nline two' && /Saved and verified/.test(els.srv2st_p1_lyrics.textContent));
    await E.settle();
    await vm.runInContext("_srvEnglishV2ApprovePackage('5','p1')", ctx); await E.settle();
    ok('022 Long workflow: Approve verifies and records a Long approval built on the full lyrics', vm.runInContext("_srvEnglishGetStage('5')", ctx) === 'build' && p._srvV2Approved.kind === 'long' && p._srvV2Approved.src === vm.runInContext('_srvEnglishV2MetaSrc(D.tasks[0],D.packages[0])', ctx));
    p.sunoPrompt = 'edited behind the screen'; E.seed(p);
    E.el('srv-lc-build-status-p1'); ctx._srvAudioData = { p1: { file: {} } };
    vm.runInContext("_srvEnglishV2Build('p1','5')", ctx); await E.settle();
    ok('022 Build refuses content changed after approval', /changed after approval/.test(els['srv-lc-build-status-p1'].textContent));
  }

  // ── 12. SRV-STUDIO-V2-026: one production line — Female · Emotional Deep House · Long ──
  {
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx, calls } = E;
    const LONG = { contentType: 'Long', contentFormat: 'long', isLong: true };
    const tl = task(150, { ...LONG, name: 'SRV English — Female — Romantic · Long', mood: 'Female — Romantic' });
    const ts = task(151, { name: 'SRV English — Female — Emotional · Short (auto-created)', mood: 'Female — Emotional' });
    ctx.D.tasks = [tl, ts];
    vm.runInContext("_srvEnglishSetStage('150','generate')", ctx); vm.runInContext("_srvEnglishSetStage('151','generate')", ctx);
    const hl = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    ok('026/029 Generate (Long): one fixed line, no mood choice; the 029 LONG/SHORT format selector is shown', /SRV Studio — Female Emotional Deep House — Long/.test(hl) && /id="srv2fmtsel_150"/.test(hl) && !/<select/.test(hl) && !/Romantic|Happy/.test(hl.replace(/Female — Romantic · Long/, '')) && /vaGeneratePackage\('150'\)/.test(hl));
    ok('026 the 023 format dropdown is gone from the app; the kept function name refuses every change', !/srv2fmt_|onchange="_srvEnglishV2SetFormat/.test(H) && vm.runInContext("_srvEnglishV2SetFormat('150','Short')", ctx) === false && tl.isLong === true);
    await vm.runInContext("vaGeneratePackage('150')", ctx); await E.settle();
    ok('026 a Long task created with another mood is generated as Emotional: mood, name and a logged change; format untouched', tl.mood === 'Female — Emotional' && tl.name === 'SRV English — Female — Emotional · Long' && tl.vaOverrides.some((o) => o.field === 'mood' && o.from === 'Female — Romantic') && tl.isLong === true && vm.runInContext("_srvEnglishGetStage('150')", ctx) === 'review');
    const n0 = calls.generate;
    await vm.runInContext("vaGeneratePackage('151')", ctx); await E.settle();
    ok('026 a Short task is never generated and never relabelled as Long', calls.generate === n0 && ts.isLong !== true && ts.contentType !== 'Long' && calls.alerts.some((a) => /A Short is never generated/.test(a)));
  }
  {
    // Retire unfinished Shorts once; uploaded/completed Shorts and every Long are untouched; packages kept.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx } = E;
    const LONG = { contentType: 'Long', contentFormat: 'long', isLong: true };
    const s137 = task(137, { status: 'generating', contentType: 'Short Video', contentFormat: 'short', isLong: false }); // switched to Short, built, refused at publish
    const s143 = task(143, { status: 'assigned', contentType: 'Short', contentFormat: 'short' });
    const s133 = task(133, { status: 'done' });
    const s160 = task(160, { status: 'review' }); // unfinished Short whose package was uploaded → keep
    const l138 = task(138, { ...LONG, status: 'assigned' });
    ctx.D.tasks = [s137, s143, s133, s160, l138];
    const p137 = pkgOf('pkg_137', 137, { srvRender: { kind: 'short' }, _srvShortVideoUrl: 'https://x/s.mp4' }); const p160 = pkgOf('pkg_160', 160, { srvVa: { youtubeVideoId: 'abc' } });
    ctx.D.packages = [p137, p160];
    vm.runInContext("_srvEnglishSetStage('137','publish')", ctx);
    vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[4])', ctx);
    ok('026 unfinished Shorts (#137 built, #143 not started) are retired: done, reason recorded, stage removed', s137.status === 'done' && s137.srvRetired && /Long-only/.test(s137.srvRetired.reason) && s137.srvRetired.fromStage === 'publish' && s137.srvRetired.packageId === 'pkg_137' && s143.status === 'done' && !!s143.srvRetired && vm.runInContext("_srvEnglishGetStage('137')", ctx) === 'generate');
    ok('026 retiring keeps the package and its media, and never relabels the task', ctx.D.packages.includes(p137) && p137._srvShortVideoUrl === 'https://x/s.mp4' && s137.contentType === 'Short Video' && s137.isLong === false);
    ok('026 completed Shorts, Shorts with an upload record, and Long tasks are untouched', s133.status === 'done' && !s133.srvRetired && s160.status === 'review' && !s160.srvRetired && l138.status === 'assigned' && !l138.srvRetired);
  }
  {
    // Rotation and task creation: Emotional + Long only (SRV English); the Farsi helpers are not touched.
    const ctx = { D: { tasks: [], srvLifecycleStages: {} }, Date, Math, Number, String, Array, Object, JSON, saveAppState() {}, saveData() {}, renderTab() {}, window: { scrollTo() {} }, document: { getElementById: () => ({}) }, alert() {},
      ENGINES_CONFIG: [{ id: 'srv_english', name: 'SRV English' }], _getEngineState: () => 'test', _srvEnglishPlaylistCategory: () => 'x', _srvEnglishNextPublishDate: () => '2026-10-23', renderVAOperatorMode: () => '' };
    vm.createContext(ctx);
    const cst = (name) => { const a = H.indexOf('const ' + name + '='); return H.slice(a, H.indexOf(';\n', a) + 2); };
    vm.runInContext([cst('SRV_STUDIO_MODE'), top(H, '_srvEnglishNextMode'), top(H, '_srvEnglishPeekNextMode'), top(H, '_srvEnglishNextFormat'), top(H, '_srvEnglishPeekFormat'), top(H, 'vaStartEnglishProductionTask')].join('\n'), ctx);
    const r = [0, 1, 2, 3, 4].map(() => vm.runInContext('_srvEnglishNextMode()+"/"+_srvEnglishNextFormat()', ctx));
    ok('026 rotation: every next task is Female — Emotional / long (no Romantic, Happy or Short)', r.every((x) => x === 'Female — Emotional/long') && vm.runInContext('_srvEnglishPeekNextMode()+"/"+_srvEnglishPeekFormat()', ctx) === 'Female — Emotional/long');
    vm.runInContext('vaStartEnglishProductionTask()', ctx);
    const t = ctx.D.tasks[0];
    ok('026 the VA one-click production task is Female · Emotional · Long', t && t.mood === 'Female — Emotional' && t.isLong === true && t.contentType === 'Long' && t.contentFormat === 'long' && /Female — Emotional · Long \[TEST\]$/.test(t.name));
    const cad = top(H, 'autoCreateCadenceTasksForCurrentWeek');
    ok('026 cadence: SRV English slots are created as Long Emotional (slot keeps its cadence format); other engines unchanged', /if\(cfg\.id==='srv_english'&&cfg\.productionFormat==='long'\)\{\n\s*Object\.assign\(task,\{name:cfg\.name\+' — '\+\(mode\|\|'Female — Emotional'\)\+' · Long \(auto-created\)',contentType:'Long',contentFormat:'long',isLong:true,cadenceSlotFormat:'short'\}\);/.test(cad) && /modes:\["Female — Emotional"\]/.test(H) && /productionFormat:'long'/.test(H));
  }
  {
    const VA = JSON.stringify({ enabled: true, maxUploads: 2, perKind: { long: 2, short: 0 }, expires: new Date(Date.now() + 5 * 86400000).toISOString(), channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' });
    const t137 = task(137, { contentType: 'Long', isLong: true }); const t140 = task(140, { contentType: 'Long', isLong: true });
    const pilotCfg = (uid) => JSON.stringify({ enabled: true, tasks: { long: uid, short: 'srve_1791661404055_133' }, maxUploads: 2, expires: new Date(Date.now() + 5 * 86400000).toISOString(), channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' });
    const route = async (settings, ceo, t, kind) => { const E = makeEnv({ flag: 'true', settings }); await E.settle(); E.ctx.D.tasks = [t]; E.ctx._ceoGetSessionToken = () => (ceo ? 'tok' : null); return vm.runInContext(`_srvEnglishV2PublishRoute(D.tasks[0],'${kind}')`, E.ctx); };
    const uid137 = 'srve_' + t137.createdAt + '_137';
    const sh = await route({ srv_studio_v2_va_allowance: VA }, true, task(141), 'short');
    const a = await route({ srv_studio_v2_pilot: pilotCfg(uid137) }, true, t137, 'long');
    const b = await route({ srv_studio_v2_pilot: pilotCfg(uid137) }, false, t137, 'long');
    const e = await route({ srv_studio_v2_va_allowance: VA }, false, t140, 'long');
    ok('026/029 routing: an ordinary (non-promotional) Short is never uploaded, whoever publishes and whatever allowance exists', !!sh.blocked && /only as a promotional extract/.test(sh.blocked));
    ok('026 routing: CEO + pilot Long → CEO pilot; VA on a CEO pilot task without a VA allowance → blocked', !!(a.pilot && a.pilot.kind === 'long') && !!b.blocked);
    ok('026 routing: VA Long under the Long-only VA allowance → VA path', !!(e.va && !e.pilot));
    ok('023 VA path posts with the VA/CEO session to the VA action; pilot path keeps the CEO-only call', /_publishAuthedFetch\('\/api\/ops\?action=srv_studio_v2_va_upload'/.test(top(H, '_srvEnglishV2Publish')) && /_ceoAuthedFetch\('\/api\/ops\?action=srv_studio_v2_pilot_upload'/.test(top(H, '_srvEnglishV2Publish')));
  }

  // ── 14. SRV-STUDIO-V2-028: normal SRV Studio production route ──
  {
    const PROD = JSON.stringify({ enabled: true, format: 'long', dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' });
    const VA = JSON.stringify({ enabled: true, maxUploads: 2, perKind: { long: 2, short: 0 }, expires: new Date(Date.now() + 5 * 86400000).toISOString(), channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' });
    const LONG = { contentType: 'Long', contentFormat: 'long', isLong: true };
    const route = async (settings, t, kind, ceo = false) => { const E = makeEnv({ flag: 'true', settings }); await E.settle(); E.ctx.D.tasks = [t]; E.ctx._ceoGetSessionToken = () => (ceo ? 'tok' : null); return vm.runInContext(`_srvEnglishV2PublishRoute(D.tasks[0],'${kind}')`, E.ctx); };
    const a = await route({ srv_studio_v2_production: PROD, srv_studio_v2_va_allowance: VA }, task(170, LONG), 'long');
    const b = await route({ srv_studio_v2_production: PROD }, task(171, { ...LONG, srvRetired: { reason: 'x' } }), 'long');
    const c = await route({ srv_studio_v2_production: PROD }, task(172, { ...LONG, cancelledAt: 1 }), 'long');
    const d = await route({ srv_studio_v2_production: PROD }, task(173), 'short');
    const e = await route({}, task(174, LONG), 'long');
    ok('028 routing: with production on, an ordinary new Long goes to the production upload (not the pilot or VA allowance)', !!(a.production && !a.va && !a.pilot));
    ok('028 routing: cancelled or retired tasks are never uploaded', !!b.blocked && /cancelled or retired/.test(b.blocked) && !!c.blocked);
    ok('028/029 routing: an ordinary (non-promotional) Short is still never uploaded', !!d.blocked && /only as a promotional extract/.test(d.blocked));
    ok('028 routing: production off → previous behaviour (no production route)', !e.production);
    const pub = top(H, '_srvEnglishV2Publish');
    ok('028 Publish: production posts with the VA/CEO session, forces private + no schedule, records the upload; no [TEST] prompt', /_publishAuthedFetch\('\/api\/ops\?action=srv_studio_v2_production_upload'/.test(pub) && /if\(production\)\{\n\s*pkg\.isTest=true;_srvEnglishV2ReleaseSlot\(pkg\);[^\n]*\n\s*meta=R\.srv2YouTubeMetadata\(kind,pkg,\{test:false,moodKey,publishAt:null\}\);meta\.publishAt=null;meta\.privacyStatus='private';meta\.containsSyntheticMedia=true;/.test(pub) && /if\(production\)pkg\.srvProduction=/.test(pub) && /if\(!pilot&&!va&&!production&&test&&!confirm\(/.test(pub));
    ok('028 Approve preview names the production upload (private, not scheduled, SRV Studio)', /SRV STUDIO PRODUCTION UPLOAD \('\+kind\.toUpperCase\(\)\+'\) — normal title, PRIVATE, not scheduled, SRV Studio channel/.test(top(H, '_srvEnglishV2FillMeta')));
  }

  // ── 13. SRV-STUDIO-V2-025: overlapping saves (VA, Long #136, 2026-10-16 14:39 UTC) ──
  {
    // Production: title saved at 14:39:35.7, lyrics Save pressed at 14:39:37.2 while the title write (slowed by the
    // shared packages-backup timeout) was still in flight. Both writes reached the database, but each read-back
    // compared against memory that already held the other edit → "different values for _srvV2Edits", and memory was
    // rolled back to the old title.
    const E = makeEnv({ flag: 'true', upsertDelayMs: 40 }); await E.settle(); const { ctx, els } = E;
    ctx.D.tasks = [task(136, { contentType: 'Long', isLong: true })];
    const p = pkgOf('pkg_1792160628322', 136, { title: 'Say My Name Like That', lyrics: '[Verse]\nold lyrics' }); ctx.D.packages = [p]; E.seed(p);
    const P = p.id; const f = (k, v) => { E.el('srv2f_' + P + '_' + k, v); E.el('srv2st_' + P + '_' + k); E.el('srv2fa_' + P + '_' + k); };
    f('title', p.title); f('lyrics', p.lyrics); f('sunoPrompt', p.sunoPrompt); f('captionYT', p.captionYT);
    ['srv2capst_', 'srv2capact_', 'srv2approve_st_', 'srv2prev_'].forEach((x) => E.el(x + P));
    els['srv2f_' + P + '_title'].value = 'You never saw me break';
    const t1 = vm.runInContext(`_srvEnglishV2SaveField('${P}','title',{skipCaption:true})`, ctx);
    await new Promise((r) => setTimeout(r, 5));
    els['srv2f_' + P + '_lyrics'].value = 'You never saw me break...\nI waited till you left\n\n[Verse 1]\nnew lyrics';
    const t2 = vm.runInContext(`_srvEnglishV2SaveField('${P}','lyrics',{skipCaption:true})`, ctx);
    const [r1, r2] = await Promise.all([t1, t2]); await E.settle();
    const row = JSON.parse(E.table[P].full_package);
    ok('025 overlapping title + lyrics saves: both succeed and both say "Saved and verified"', r1 === true && r2 === true && /Saved and verified/.test(els['srv2st_' + P + '_title'].textContent) && /Saved and verified/.test(els['srv2st_' + P + '_lyrics'].textContent), [r1, r2, els['srv2st_' + P + '_title'].textContent, els['srv2st_' + P + '_lyrics'].textContent]);
    ok('025 database holds the new title and lyrics with both edit stamps', E.table[P].title === 'You never saw me break' && row.title === 'You never saw me break' && /new lyrics/.test(row.lyrics) && row._srvV2Edits.title && row._srvV2Edits.lyrics);
    ok('025 memory equals the database (the payload uses the saved title), nothing marked unsaved', p.title === 'You never saw me break' && p.lyrics === row.lyrics && JSON.stringify(p._srvV2Edits) === JSON.stringify(row._srvV2Edits) && vm.runInContext(`_srvEnglishV2DirtyKeys('${P}')`, ctx).length === 0);
    ok('025 the caption is now flagged out of date for the new song (refreshed at Approve), never shown "up to date"', vm.runInContext('_srvEnglishV2CaptionState(D.tasks[0],D.packages[0]).fresh', ctx) === false);
  }
  {
    // A write that reached the database but whose read-back disagrees: memory adopts what is stored, never an older value.
    const E = makeEnv({ flag: 'true', readbackLie: true }); await E.settle(); const { ctx, els } = E;
    ctx.D.tasks = [task(5)]; const p = pkgOf('p1', 5); ctx.D.packages = [p]; E.seed(p); fieldEls(E, p, SHORT_KEYS);
    els.srv2f_p1_title.value = 'Typed Title';
    await vm.runInContext("_srvEnglishV2SaveField('p1','title')", ctx);
    const stored = JSON.parse(E.table.p1.full_package).title;
    ok('025 failed verification after a landed write: memory takes the stored value (never the older one) and the field stays listed as not saved', stored === 'Typed Title' && p.title === stored && /Not saved/.test(els.srv2st_p1_title.textContent) && vm.runInContext("_srvEnglishV2DirtyKeys('p1')", ctx).includes('title'), [p.title, stored, els.srv2st_p1_title.textContent]);
  }
  {
    // Writes to one package are serialized: a read-back can never run while another save of it is still writing.
    ok('025 V2 package saves and approval read-backs run through one per-package queue', /return _srvEnglishV2Serial\(pkg\.id,async function\(\)\{/.test(H) && /_srvEnglishV2Serial\(pkg\.id,\(\)=>_srvEnglishV2ReadBack\(pkg\.id\)\)/.test(H));
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
    // 2026-10-16 platform fix (tests/platform/test_packages_backup.mjs): the per-save full packages backup was removed
    // from savePackageToSupabase; that exact change is the only one allowed in a shared function.
    const unBackup = (src) => (fn === 'savePackageToSupabase' ? src.replace("      // 2026-10-16 — the per-save full backup (every package as one app_settings value, ~8.6 MB) is no longer written\n      // here: it exceeds the browser role's 3 s statement timeout, has failed on every save since 2026-05-23 and added\n      // seconds to every package save in every business. The packages table written above is the record.\n", "      // Also write packages backup to app_settings for redundancy\n      await writePackagesBackup();\n") : src);
    ok('Shared unchanged (index.html): ' + fn, unBackup(top(H, fn)) === top(base, fn));
  }
  {
    // Checkpoint B adds one flag-gated request field to generatePackage(); everything else is unchanged.
    const g = top(H, 'generatePackage');
    const restored = g.replace(",taskName:t.name,recentPackages,\n        ...(t.engine==='SRV English'&&typeof _srvStudioV2On==='function'&&_srvStudioV2On()?{srvStudioV2:true}:{})}) // SRV Studio V2: request V2 music direction only while the flag is on", ',taskName:t.name,recentPackages})');
    ok('Shared (index.html): generatePackage unchanged apart from the flag-gated srvStudioV2 request field', restored === top(base, 'generatePackage'));
  }

  // ── SRV-STUDIO-V2-029: Long + promotional Short, full avatar library, repeated titles ──
  {
    const LONG = { contentType: 'Long', contentFormat: 'long', isLong: true, name: 'SRV English — Female — Emotional · Long' };
    const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co/storage/v1/object/public/srv-assets/';
    const E = makeEnv({ flag: 'true', titleUnique: false }); await E.settle(); const { ctx, calls } = E;
    const tLong = task(300, LONG), tNew = task(301, LONG), tOther = task(302, { ...LONG, engine: 'SRV Farsi' });
    const uid = (t) => 'srve_' + t.createdAt + '_' + t.id;
    const longPkg = pkgOf('pkg_long_300', 300, { title: 'Headlights In The Rain', srvTaskUid: uid(tLong), contentFormat: 'long', _srvLongVideoUrl: SB + 'pkg_long_300/long.mp4', _srvAudioUrl: SB + 'pkg_long_300/audio.mp3', srvRender: { width: 1920, height: 1080, durationSec: 200, audioDurationSec: 200 }, srvAvatar: { id: 'srv2-fm-03', by: 'rotation' }, srvProduction: { youtubeVideoId: 'YT_LONG_1' } });
    const farsiPkg = pkgOf('pkg_farsi_1', 900, { engine: 'SRV Farsi', title: 'Farsi Long', _srvLongVideoUrl: SB + 'pkg_farsi_1/long.mp4' });
    const unbuilt = pkgOf('pkg_long_unbuilt', 299, { title: 'Not Built', contentFormat: 'long' });
    ctx.D.tasks = [tLong, tNew, tOther]; ctx.D.packages = [longPkg, farsiPkg, unbuilt]; E.seed(longPkg); E.seed(farsiPkg);
    vm.runInContext("_srvEnglishSetStage('301','generate')", ctx);
    const g0 = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[1])', ctx);
    ok('029 Generate shows the LONG / SHORT selector (Long selected by default)', /id="srv2fmtsel_301"/.test(g0) && /_srvEnglishV2ChooseFormat\('301','short'\)/.test(g0) && /aria-pressed="true"[^>]*><div[^>]*>LONG/.test(g0));
    ok('029 SHORT: an explicit, logged choice — task becomes a promotional Short', vm.runInContext("_srvEnglishV2ChooseFormat('301','short')", ctx) === true && tNew.srvPromo === true && tNew.isLong === false && tNew.contentFormat === 'short' && tNew.name === 'SRV English — Female — Emotional · Short' && tNew.vaOverrides.some((o) => o.field === 'format' && o.to.startsWith('short')));
    const src = vm.runInContext('_srvEnglishV2PromoSources(D.tasks[1]).map(x=>x.pkg.id)', ctx);
    ok('029 Long picker lists only built SRV Studio Longs — never another business, never an unbuilt Long', JSON.stringify(src) === '["pkg_long_300"]');
    const g1 = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[1])', ctx);
    ok('029 Short Generate: Long picker, 25–35 s section, preview and Create (no Claude generation button)', /srv2promo_long_301/.test(g1) && /min="25" max="35"/.test(g1) && /Preview this section/.test(g1) && /_srvEnglishV2CreatePromoShort\('301'\)/.test(g1) && !/vaGeneratePackage\('301'\)/.test(g1));
    ok('029 LONG again restores exactly what the task was', vm.runInContext("_srvEnglishV2ChooseFormat('301','long')", ctx) === true && tNew.isLong === true && tNew.contentType === 'Long' && tNew.contentFormat === 'long' && !tNew.srvPromo && tNew.name === LONG.name);
    vm.runInContext("_srvEnglishV2ChooseFormat('301','short')", ctx);
    const sel = (st, d) => vm.runInContext(`_srvEnglishV2PromoSel['301']={longPkgId:'pkg_long_300',startSec:${st},durationSec:${d}}`, ctx);
    E.el('srv2promo_st_301');
    for (const [st, d, why] of [[60, 24, 'under 25 s'], [60, 36, 'over 35 s'], [190, 30, 'past the end of the song']]) {
      sel(st, d); const r = await vm.runInContext("_srvEnglishV2CreatePromoShort('301')", ctx); await E.settle();
      ok('029 Short section refused when ' + why, r === false && !vm.runInContext('_srvEnglishV2PkgForTask(D.tasks[1])', ctx));
    }
    sel(62, 30); const gen0 = calls.generate;
    const made = await vm.runInContext("_srvEnglishV2CreatePromoShort('301')", ctx); await E.settle();
    const sp = vm.runInContext('_srvEnglishV2PkgForTask(D.tasks[1])', ctx);
    ok('029 Short created from the Long: same song title, the Long\'s lyrics, no new song or lyrics generated', made === true && sp && sp.title === longPkg.title && sp.lyrics === longPkg.lyrics && sp.sunoPrompt === longPkg.sunoPrompt && calls.generate === gen0 && !sp.shortLyrics);
    ok('029 Short records its Long: package, task, section 62 s + 30 s, audio source, Long YouTube id', sp.srvShortOf.longPkgId === 'pkg_long_300' && sp.srvShortOf.longTaskUid === uid(tLong) && sp.srvShortOf.startSec === 62 && sp.srvShortOf.durationSec === 30 && sp.srvShortOf.audioSource === 'long-mp3' && sp.srvShortOf.longYoutubeVideoId === 'YT_LONG_1');
    ok('029 Long and Short share the exact title and both rows are stored (own package ids, own task)', E.table[sp.id] && E.table[sp.id].title === E.table['pkg_long_300'].title && sp.id !== 'pkg_long_300' && sp.srvTaskUid === uid(tNew) && vm.runInContext("_srvEnglishGetStage('301')", ctx) === 'review');
    ok('029 the Short keeps the Long\'s cover image by default', sp.srvAvatar.id === 'srv2-fm-03' && sp.srvAvatar.by === 'from-long');
    const used = vm.runInContext('JSON.stringify([_srvEnglishV2BuildKeys(D.tasks[1],_srvEnglishV2PkgForTask(D.tasks[1])),_srvEnglishV2FieldsFor(D.tasks[1],_srvEnglishV2PkgForTask(D.tasks[1])).length])', ctx);
    ok('029 promotional Short builds from the Long\'s song text; the song is not editable at Review (caption only)', used === JSON.stringify([{ isLong: false, promo: true, lyrics: 'lyrics', sunoPrompt: 'sunoPrompt', otherLyrics: 'shortLyrics', otherSunoPrompt: 'shortSunoPrompt' }, 0]));
    ok('029 the Long is unchanged (its task, format and package untouched)', tLong.isLong === true && !tLong.srvPromo && JSON.parse(E.table['pkg_long_300'].full_package).title === 'Headlights In The Rain' && !JSON.parse(E.table['pkg_long_300'].full_package).srvShortOf);
    ok('029 the format can no longer change once the Short exists', vm.runInContext("_srvEnglishV2ChooseFormat('301','long')", ctx) === false && tNew.srvPromo === true);
    ok('029 promotional Shorts are production: the 026 retirement never touches them', vm.runInContext('_srvEnglishV2RetireShorts()', ctx) === 0 && tNew.status === 'assigned' && !tNew.srvRetired);
    const rv = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[1])', ctx);
    ok('029 Review (promotional Short): source panel, caption field only — no title / lyrics / prompt editors', /PROMOTIONAL SHORT · FROM AN SRV STUDIO LONG/.test(rv) && /id="srv2f_[^"]*_captionYT"/.test(rv) && !/id="srv2f_[^"]*_(title|lyrics|sunoPrompt|shortLyrics)"/.test(rv));
  }
  {
    // Routing — promotional Shorts upload only through production, and only when the CEO setting includes Shorts.
    const PROD_L = JSON.stringify({ enabled: true, format: 'long', dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' });
    const PROD_LS = JSON.stringify({ enabled: true, formats: ['long', 'short'], dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' });
    const VA = JSON.stringify({ enabled: true, maxUploads: 2, perKind: { long: 1, short: 1 }, expires: new Date(Date.now() + 5 * 86400000).toISOString(), channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' });
    const promoT = (id) => task(id, { isLong: false, contentFormat: 'short', contentType: 'Short', srvPromo: true });
    const promoP = (id, t) => pkgOf('pkg_promo_' + id, id, { srvTaskUid: 'srve_' + t.createdAt + '_' + id, srvShortOf: { longPkgId: 'pkg_long_x', startSec: 10, durationSec: 30 } });
    const route = async (settings, t, p, kind) => { const E = makeEnv({ flag: 'true', settings }); await E.settle(); E.ctx.D.tasks = [t]; E.ctx.D.packages = p ? [p] : []; return vm.runInContext(`_srvEnglishV2PublishRoute(D.tasks[0],'${kind}')`, E.ctx); };
    const t1 = promoT(310), t2 = promoT(311), t3 = task(312), t4 = promoT(313), t5 = task(314, { contentType: 'Long', contentFormat: 'long', isLong: true });
    const a = await route({ srv_studio_v2_production: PROD_L }, t1, promoP(310, t1), 'short');
    const b = await route({ srv_studio_v2_production: PROD_LS }, t2, promoP(311, t2), 'short');
    const c = await route({ srv_studio_v2_production: PROD_LS }, t3, null, 'short');
    const d = await route({ srv_studio_v2_va_allowance: VA }, t4, promoP(313, t4), 'short');
    const e = await route({ srv_studio_v2_production: PROD_LS }, t5, null, 'long');
    ok('029 routing: a promotional Short is blocked while production authorizes Long only (today\'s setting)', !!a.blocked && /not switched on/.test(a.blocked));
    ok('029 routing: with Shorts authorized, a promotional Short goes through normal production (private)', !!(b.production && b.production.formats.includes('short')));
    ok('029 routing: an ordinary Short is never uploaded, even with Shorts authorized', !!c.blocked && /only as a promotional extract/.test(c.blocked));
    ok('029 routing: a Short never uses the VA allowance or pilot (production only)', !!d.blocked && !d.va && !d.pilot);
    ok('029 routing: Longs unchanged with the new setting', !!(e.production && !e.blocked));
  }
  {
    // Repeated titles: two different Longs may share a title once the database rule is scoped (029 migration);
    // before it, the write is refused by the database, explained, and nothing is stored.
    for (const unique of [false, true]) {
      const E = makeEnv({ flag: 'true', titleUnique: unique }); await E.settle(); const { ctx, els } = E;
      const L = { contentType: 'Long', contentFormat: 'long', isLong: true };
      const a = pkgOf('pkg_a', 320, { title: 'Same Song' }), b = pkgOf('pkg_b', 321, { title: 'Other Song' });
      ctx.D.tasks = [task(320, L), task(321, L)]; ctx.D.packages = [a, b]; E.seed(a); E.seed(b);
      const P = 'pkg_b'; ['title', 'lyrics', 'sunoPrompt', 'captionYT'].forEach((k) => { E.el('srv2f_' + P + '_' + k, b[k]); E.el('srv2st_' + P + '_' + k); E.el('srv2fa_' + P + '_' + k); });
      ['srv2capst_', 'srv2capact_', 'srv2approve_st_', 'srv2prev_'].forEach((x) => E.el(x + P));
      vm.runInContext("_srvEnglishSetStage('321','review')", ctx);
      els['srv2f_' + P + '_title'].value = 'Same Song';
      const r = await vm.runInContext(`_srvEnglishV2SaveField('${P}','title')`, ctx); await E.settle();
      if (!unique) ok('029 duplicate titles save: a second Long saves the same title, verified (no pre-check, no rename)', r === true && E.table[P].title === 'Same Song' && E.table['pkg_a'].title === 'Same Song');
      else ok('029 before the migration: the database refuses the repeat, the screen says the database rule is not changed yet, nothing stored', r === false && E.table[P].title === 'Other Song' && /database still has the old one-title-per-business rule/.test(els['srv2st_' + P + '_title'].textContent));
    }
  }
  {
    // Full approved avatar library — the picker offers every approved image with a preview.
    const E = makeEnv({ flag: 'true' }); await E.settle(); const { ctx } = E;
    const lib = vm.runInContext('_srvEnglishV2AvatarLibrary().map(a=>({id:a.id,hd:a.quality&&a.quality.hdReady,arch:!!a.archived,col:a.collection}))', ctx);
    const all = vm.runInContext('SRV_STUDIO_V2_AVATARS.length+"/"+SRV_STUDIO_V2_AVATARS_ARCHIVED.length', ctx);
    const emo = vm.runInContext("srv2AvatarPool().filter(a=>(a.moods||[]).includes('emotional')).length", ctx);
    ok('029 library: every approved image (19 of 20 finals; held alternate #09 excluded), all HD-ready finals — more than the ' + emo + ' the rotation shows for Emotional', lib.length === 19 && !lib.some((a) => a.id === 'srv2-fm-09') && lib.every((a) => a.hd === true && !a.arch && a.col === 'final') && lib.length > emo, { all, n: lib.length });
    ok('029 library: archived concept images are never offered', !lib.some((a) => /^srv2-av-/.test(a.id)));
    const t = task(330, { contentType: 'Long', contentFormat: 'long', isLong: true }); const p = pkgOf('pkg_av', 330, { srvAvatar: { id: 'srv2-fm-01', by: 'rotation' } });
    ctx.D.tasks = [t]; ctx.D.packages = [p]; E.seed(p);
    vm.runInContext("_srvEnglishSetStage('330','review')", ctx);
    const h = vm.runInContext('renderSRVEnglishLifecycleCard(D.tasks[0])', ctx);
    const tiles = (h.match(/_srvEnglishV2ChooseAvatar\('330','pkg_av','srv2-fm-\d+'\)/g) || []).length;
    ok('029 Review shows "Choose from library (19)" with 19 previews (grayscale, the registry crop)', /Choose from library \(19\)/.test(h) && tiles === 19 && /srv2avlib_pkg_av/.test(h) && /APPROVED SRV STUDIO LIBRARY · 19 images/.test(h));
    const bad = await vm.runInContext("_srvEnglishV2ChooseAvatar('330','pkg_av','srv2-av-01')", ctx);
    const held = await vm.runInContext("_srvEnglishV2ChooseAvatar('330','pkg_av','srv2-fm-09')", ctx);
    ok('029 an archived or held image can never be chosen', bad === false && held === false && p.srvAvatar.id === 'srv2-fm-01');
    const pick = await vm.runInContext("_srvEnglishV2ChooseAvatar('330','pkg_av','srv2-fm-17')", ctx); await E.settle();
    ok('029 choosing an image saves it (verified) and records it as the operator\'s choice', pick === true && p.srvAvatar.id === 'srv2-fm-17' && p.srvAvatar.by === 'operator-choice' && JSON.parse(E.table['pkg_av'].full_package).srvAvatar.id === 'srv2-fm-17');
  }

  // ── SRV-STUDIO-V2-030: planned release schedule (America/New_York), release preview, publishing checklist ──
  {
    const E = makeEnv({ flag: 'true', titleUnique: false }); await E.settle(); const { ctx } = E;
    const plan = (kind, iso, taken) => vm.runInContext(`_srvEnglishV2SchedulePlan('${kind}', ${Date.parse(iso)}, ${JSON.stringify(taken || [])})`, ctx);
    const a = plan('long', '2026-10-26T12:00:00Z');
    ok('031 schedule (CEO-approved): Long → next Friday 7:00 AM Eastern (Fri 30 Oct 2026, EDT = 11:00 UTC)', a.utcIso === '2026-10-30T11:00:00.000Z' && a.weekday === 'Friday' && a.localTime === '07:00' && a.tz === 'America/New_York' && a.tzName === 'EDT' && /Fri Oct 30, 2026 · 7:00 AM EDT/.test(a.label), a);
    const b = plan('long', '2026-10-31T12:00:00Z');
    ok('031 schedule: across the autumn DST change the wall time stays 7:00 AM (Fri 6 Nov 2026, EST = 12:00 UTC)', b.utcIso === '2026-11-06T12:00:00.000Z' && b.tzName === 'EST' && b.localTime === '07:00', b);
    const c = plan('short', '2026-10-26T12:00:00Z');
    ok('030 schedule: Short → next Sunday 6:00 PM Eastern (Sun 1 Nov 2026 — DST ends that morning → EST, 23:00 UTC)', c.utcIso === '2026-11-01T23:00:00.000Z' && c.weekday === 'Sunday' && c.tzName === 'EST', c);
    const spring = plan('long', '2027-03-08T12:00:00Z');
    ok('031 schedule: spring DST (Fri 12 Mar 2027 7:00 AM EST = 12:00 UTC; Fri 19 Mar EDT = 11:00 UTC)', spring.utcIso === '2027-03-12T12:00:00.000Z' && plan('long', '2027-03-13T12:00:00Z').utcIso === '2027-03-19T11:00:00.000Z');
    const lead = plan('long', '2026-10-30T10:30:00Z'); // Friday 6:30 AM EDT — less than the 60-minute lead
    ok('031 schedule: an upload less than 60 minutes before the slot moves to the following Friday', lead.utcIso === '2026-11-06T12:00:00.000Z', lead);
    const taken = plan('long', '2026-10-26T12:00:00Z', ['2026-10-30T11:00:00.000Z']);
    ok('031 schedule: one release per slot — a Friday already planned by another SRV Studio Long moves to the next Friday', taken.utcIso === '2026-11-06T12:00:00.000Z');
    ok('031 schedule: plans are CEO-approved and manual (no automatic public release)', a.status === 'approved' && a.mode === 'manual-public');
    const afterLong = (iso, longIso) => vm.runInContext(`_srvEnglishV2SchedulePlan('short', ${Date.parse(iso)}, [], ${Date.parse(longIso)})`, ctx);
    ok('031 the Short promotes the preceding Long: Long Fri 30 Oct 7:00 AM → Short Sun 1 Nov 6:00 PM; Long Fri 6 Nov → Short Sun 8 Nov', afterLong('2026-10-26T12:00:00Z', '2026-10-30T11:00:00.000Z').utcIso === '2026-11-01T23:00:00.000Z' && afterLong('2026-10-26T12:00:00Z', '2026-11-06T12:00:00.000Z').utcIso === '2026-11-08T23:00:00.000Z');
    const S = await import(require('url').pathToFileURL(require('path').resolve(__dirname, '../../lib/srvStudioV2Schedule.mjs')).href);
    let mism = []; for (let i = 0; i < 400; i++) { const t = Date.UTC(2026, 0, 1) + i * 37 * 3600000 + i * 61000; for (const k of ['long', 'short']) { const c = vm.runInContext(`_srvEnglishV2SchedulePlan('${k}', ${t}, [], ${i % 3 ? 'null' : t + 86400000 * 3})`, ctx); const l = S.srv2PlanRelease(k, t, [], i % 3 ? null : t + 86400000 * 3); if (!c || !l || c.utcIso !== l.utcIso) mism.push([k, new Date(t).toISOString()]); } }
    ok('031 app and server planners agree on every slot (800 cases across 2026–2027, both DST changes)', mism.length === 0, mism.slice(0, 3));
    // taken slots read SRV Studio packages only; the shared slot pool is never read or written
    ctx.D._publishSlots = { 'fri-2026-10-30': 'pkg_farsi_1' };
    ctx.D.packages = [pkgOf('pkg_l1', 400, { srvSchedulePlan: { kind: 'long', utcIso: '2026-10-30T11:00:00.000Z' } }), pkgOf('pkg_s1', 401, { srvSchedulePlan: { kind: 'short', utcIso: '2026-11-01T23:00:00.000Z' } }), pkgOf('pkg_f1', 402, { engine: 'SRV Farsi', srvSchedulePlan: { kind: 'long', utcIso: '2026-11-06T12:00:00.000Z' } })];
    const tk = vm.runInContext("JSON.stringify(_srvEnglishV2TakenSlots('long','pkg_x'))", ctx);
    ok('030/031 schedule isolation: taken slots come from SRV Studio packages of the same format only; D._publishSlots untouched', tk === '["2026-10-30T11:00:00.000Z"]' && JSON.stringify(ctx.D._publishSlots) === '{"fri-2026-10-30":"pkg_farsi_1"}');
    // release preview (Approve)
    const pv = vm.runInContext("_srvEnglishV2PlanPreviewHtml({},{id:'pkg_p',srvShortOf:{longTitle:'Passenger Seat Witness',longYoutubeVideoId:'s34SXDqU0jk'}},'short')", ctx);
    ok('030 release preview (Short): format, playlist name + ID, planned date/time/timezone, related Long, PRIVATE notice', /Short · 1080×1920/.test(pv) && /SRV Studio Full Short Collection · PLATi-bbiaU30/.test(pv) && /America\/New_York/.test(pv) && /Passenger Seat Witness · s34SXDqU0jk/.test(pv) && /stays <b>PRIVATE<\/b>/.test(pv) && /automatic public release is not switched on/.test(pv));
    const pvL = vm.runInContext("_srvEnglishV2PlanPreviewHtml({},{id:'pkg_q'},'long')", ctx);
    ok('030 release preview (Long): Long playlist and the end-screen VA step', /SRV Studio, the full Collection · PLXCBPiF9p6SA/.test(pvL) && /End screen/.test(pvL));
    // publishing checklist (Done)
    const T = task(410, { contentType: 'Long', contentFormat: 'long', isLong: true }); const pk = pkgOf('pkg_done_l', 410, { srvProduction: { kind: 'long', youtubeVideoId: 's34SXDqU0jk' }, srvPublish: { kind: 'long', videoId: 's34SXDqU0jk', production: true, privacyStatus: 'private', title: 't', thumbnail: 'set' }, srvPlaylist: { status: 'failed', error: 'insufficient_scope', playlistId: 'PLXCBPiF9p6SA' } });
    ctx.D.tasks = [T]; ctx.D.packages = [pk]; E.seed(pk);
    const ch = vm.runInContext("_srvEnglishV2PublishChecklistHtml(D.tasks[0],D.packages[0],'410')", ctx);
    ok('031 checklist: public-release VA step with the planned time, "Visibility → Public" instruction, no YouTube scheduling, confirm button', /Public release \(VA step — done by hand in YouTube Studio\)/.test(ch) && /Visibility<\/b> → <b>Public/.test(ch) && /Do not use YouTube's own scheduling/.test(ch) && /I made it public/.test(ch));
    ok('030 checklist (Long): playlist not added explained (playlist permission), Studio fallback link, end-screen VA step with the playlist ID and the Studio Editor link', /playlist permission/.test(ch) && /studio\.youtube\.com\/video\/s34SXDqU0jk\/edit/.test(ch) && /studio\.youtube\.com\/video\/s34SXDqU0jk\/editor/.test(ch) && /PLXCBPiF9p6SA/.test(ch) && /no API for end screens/.test(ch));
    const mp = await vm.runInContext("_srvEnglishV2MarkVaStep('410','pkg_done_l','madePublic')", ctx); await E.settle();
    ok('031 "I made it public" records the VA confirmation (who/when); the app itself never changes visibility', mp === true && pk.srvVaSteps.madePublic.doneAt && pk.srvVaSteps.madePublic.verifiedBy === 'va-confirmation');
    const marked = await vm.runInContext("_srvEnglishV2MarkVaStep('410','pkg_done_l','endScreen')", ctx); await E.settle();
    ok('030 "I added the end screen" saves (verified) who/when, labelled VA-confirmed — never API-verified', marked === true && pk.srvVaSteps.endScreen.doneAt && pk.srvVaSteps.endScreen.verifiedBy === 'va-confirmation' && JSON.parse(E.table['pkg_done_l'].full_package).srvVaSteps.endScreen.doneAt === pk.srvVaSteps.endScreen.doneAt);
    ok('030 an unknown VA step is refused', (await vm.runInContext("_srvEnglishV2MarkVaStep('410','pkg_done_l','publishNow')", ctx)) === false);
    const pkS = pkgOf('pkg_done_s', 411, { srvShortOf: { longTitle: 'Passenger Seat Witness', longYoutubeVideoId: 's34SXDqU0jk' }, srvProduction: { kind: 'short', youtubeVideoId: '7LGUuXX1YnI' }, srvPublish: { kind: 'short', production: true }, srvPlaylist: { status: 'added', playlistId: 'PLATi-bbiaU30', playlistTitle: 'SRV Studio Full Short Collection' }, srvPlaylistSync: { at: '2026-10-25T01:00:00Z', related: { eligible: true, privacyStatus: 'public', longVideoId: 's34SXDqU0jk' } } });
    const chS = vm.runInContext(`_srvEnglishV2PublishChecklistHtml({},${JSON.stringify(pkS)},'411')`, ctx);
    ok('030 checklist (Short): playlist ✓ verified via API, Related-video VA step naming the Long (title + ID), Long public → can be linked, Studio link for the Short', /✓ in "SRV Studio Full Short Collection" \(verified via YouTube API\)/.test(chS) && /Related video \(VA step — YouTube has no API for this\)/.test(chS) && /Passenger Seat Witness/.test(chS) && /s34SXDqU0jk/.test(chS) && /Long is public — can be linked/.test(chS) && /studio\.youtube\.com\/video\/7LGUuXX1YnI\/edit/.test(chS));
  }

  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
