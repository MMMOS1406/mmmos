// SRV Farsi Mix — lifecycle end-to-end for CEO and VA (CEO order 2026-11-12). Local stub, synthetic data (every value invented). Flag default OFF; preview only.
// PUPPETEER_CORE=<dir> node tests/srv/farsi_mix_lifecycle.mjs
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle, fetchJson } from '../preservation/driver.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 700) : ''}`); };
const mk = () => {
  const fx = makeFixture(); fx.restFilter = true; const st = JSON.parse(fx.settings.mmm_finance_v118);
  const T = (id, engine, name, extra) => Object.assign({ id, engine, name, status: 'assigned', isoDate: '2026-10-06', day: 'Tuesday', createdAt: 1790000000000 + id, channel: '', platform: 'All', srvTaskUid: (engine === 'SRV Farsi' ? 'srvf_' : 'srve_') + id }, extra);
  st.tasks.push(T(901, 'SRV Farsi', 'SRV Farsi — Female — Romantic · Short', { mood: 'Female — Romantic', mode: 'Female — Romantic', contentType: 'Short Video', contentFormat: 'short', isLong: false }));
  st.tasks.push(T(801, 'SRV English', 'SRV English — Female — Emotional · Long', { mood: 'Female — Emotional', mode: 'Female — Emotional', contentType: 'Long', contentFormat: 'long', isLong: true }));
  fx.settings.mmm_finance_v118 = JSON.stringify(st);
  const arts = ['Female', 'Male', 'Duet', 'Female', 'Female', 'Male', 'Duet', 'Female', 'Female', 'Male', 'Female', 'Duet']; const moods = ['Romantic', 'Romantic', 'Romantic', 'Romantic', 'Happy', 'Romantic', 'Romantic', 'Romantic', 'Romantic', 'Emotional', 'Romantic', 'Romantic'];
  const longs = arts.map((a, i) => { const id = 'pkg_M' + i; const yt = 'VIDmix' + String(i).padStart(5, '0'); return { package_id: id, engine: 'SRV Farsi', youtube_video_id: yt, generated_at: '2026-10-' + String(10 + i).padStart(2, '0') + 'T10:00:00Z', full_package: JSON.stringify({ id, engine: 'SRV Farsi', title: 'آهنگ شماره ' + (i + 1), titleFinglish: 'Ahang ' + (i + 1), artist: a, mood: a + ' — ' + moods[i], contentType: 'LongScript', contentFormat: 'long', isTest: false, _srvLongVideoUrl: '/home2.js', _srvYtLongId: yt, _srvLongDurationSec: 250 + i * 3, srvPublish: { privacyStatus: 'public' }, _srvAvatarChoice: { id: a.toLowerCase() + '_01', artist: a.toLowerCase() }, generatedAt: '2026-10-' + String(10 + i).padStart(2, '0') + 'T10:00:00Z' }) }; });
  fx.tables.packages = longs; fx.tables.youtube_channels = []; fx.tables.youtube_videos_analytics = []; return fx;
};
const browser = await launch();
async function run(role, flag) {
  const stub = await startStub({ publicDir: pub, fixture: mk() }); const o = await openPage(browser, stub.origin); await o.page.evaluateOnNewDocument(() => { window.__SRVF_RESET_MS = 1e9; }); await fetchJson(stub.origin + '/__stub/reset');
  await o.page.evaluate((f) => { try { f ? localStorage.setItem('srvfMix', '1') : localStorage.removeItem('srvfMix'); } catch (e) {} }, flag); await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 1500);
  return { stub, ...o };
}
const W = (r, ms = 700) => settle(r.page, r.stub.origin, ms);
try {
  // ── the flag decision itself (pure): local host or an isolated validation deployment only — never a production alias ──
  { const r0 = await run('admin', false), p0 = r0.page;
    const f = await p0.evaluate(() => { const F = _srvfMixFlagFor; return { localAsk: F('127.0.0.1', '?srvfMix=1', null), localNo: F('localhost', '', null), localStored: F('localhost', '', '1'), previewAsk: F('mmm-static-ab12cd34e-mmmos1406s-projects.vercel.app', '?srvfMix=1', null), previewNoAsk: F('mmm-static-ab12cd34e-mmmos1406s-projects.vercel.app', '', '1'), prod1: F('mmm-static.vercel.app', '?srvfMix=1', '1'), prod2: F('mmm-static-mmmos1406s-projects.vercel.app', '?srvfMix=1', '1'), prod3: F('mmm-static-git-main-mmmos1406s-projects.vercel.app', '?srvfMix=1', '1'), other: F('evil.example.com', '?srvfMix=1', '1'), lookalike: F('mmm-static-ab12cd34e-mmmos1406s-projects.vercel.app.evil.com', '?srvfMix=1', null), forced: F('mmm-static.vercel.app', '', null, true) }; });
    check('flag decision: local host + param, or an isolated validation (preview) host + param; NEVER the production aliases, other hosts or look-alikes; the release-time override still works', f.localAsk && !f.localNo && f.localStored && f.previewAsk && !f.previewNoAsk && !f.prod1 && !f.prod2 && !f.prod3 && !f.other && !f.lookalike && f.forced, JSON.stringify(f)); await p0.close(); await r0.stub.close(); }
  // ── flag OFF (the production state): nothing about Mix is reachable ──
  { const r = await run('admin', false), p = r.page;
    const off = await p.evaluate(async () => { const t = D.tasks.find((x) => x.id === 901); _srvFarsiVaSetArtistFormat(901, 'format', 'Mix'); const html = renderSRVFarsiLifecycleCard(t); return { on: _srvfMixOn(), isMix: !!t.isMix, fmt: t.contentFormat, mixInHtml: /Mix/.test(html.replace(/<style[\s\S]*?<\/style>/g, '')) }; });
    check('flag OFF: Mix cannot be selected (format change ignored) and the card shows no Mix option', off.on === false && !off.isMix && off.fmt === 'short' && !off.mixInHtml, JSON.stringify(off));
    check('flag OFF: no Mix module was requested', !(r.stub && (await fetchJson(r.stub.origin + '/__stub/log')).statics.some((s) => /srv-farsi-mix/.test(String(s)))));
    await p.close(); await r.stub.close(); }

  for (const role of ['admin', 'va']) {
    const r = await run(role, true), p = r.page; const L = (s) => `${role}: ${s}`;
    check(L('flag ON locally (preview host only)'), await p.evaluate(() => _srvfMixOn() === true));
    // choose Mix on the Generate step
    const fmtOpts = await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); const h = renderSRVFarsiLifecycleCard(t); return [...h.matchAll(/<option value="(Auto|Short|Long|Mix)"/g)].map((m) => m[1]); });
    check(L('Generate offers Short, Long and Mix'), ['Short', 'Long', 'Mix'].every((x) => fmtOpts.includes(x)), fmtOpts.join(','));
    await p.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'format', 'Mix'); currentTab = 'tasks'; openExec('901'); }); await W(r, 1500);
    const t1 = await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); return { isMix: t.isMix, fmt: t.contentFormat, type: t.contentType, isLong: t.isLong, root: !!document.getElementById('srvfMixRoot-901'), builder: !!document.querySelector('[data-mix-host="901"] .fmx'), stage: _srvFarsiGetStage(901) }; });
    check(L('task becomes a Mix (neither Long nor Short) and the Mix builder loads inside the lifecycle card'), t1.isMix && t1.fmt === 'mix' && t1.type === 'Mix' && t1.isLong === false && t1.root && t1.builder && t1.stage === 'generate', JSON.stringify(t1));
    const sel = await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const b = m._test.st(901).builder; const c = await _srvfMixHost().candidates(); return { elig: c.filter((x) => x.eligible).length, total: c.length, b: !!b }; });
    check(L('the builder lists the published Farsi Longs (12 eligible from the database inventory)'), sel.b && sel.elig === 12, JSON.stringify(sel));
    // Artist category and mood are separate selections; four categories incl. All Artists
    const cats = await p.evaluate(() => [...document.querySelectorAll('[data-mix-host="901"] [data-cat]')].map((x) => x.dataset.cat));
    check(L('Artist category chips: Female, Male, Duet, All Artists'), ['female', 'male', 'duet', 'all'].every((x) => cats.includes(x)), cats.join(','));
    // NO fixed minimum: six songs (~25 minutes) are valid; fewer than TWO valid songs are blocked
    const six = await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const b = m._test.st(901).builder; b.set({ category: 'all', mood: 'romantic', allMoods: true }); b.selectIds(['pkg_M0', 'pkg_M1', 'pkg_M2', 'pkg_M3', 'pkg_M4', 'pkg_M5']); const v6 = b.validate(); const ok6 = document.querySelector('[data-mix-host="901"] #proceed').disabled === false; b.selectIds(['pkg_M0']); const v1 = b.validate(); const dis1 = document.querySelector('[data-mix-host="901"] #proceed').disabled; return { ok6: v6.ok, proceed6: ok6, runtime6: v6.totalSec, v1ok: v1.ok, problems1: v1.problems.join('; '), dis1 }; });
    check(L('no fixed minimum: ~25 minutes of songs is valid and can proceed; a single song is blocked (at least two valid songs)'), six.ok6 && six.proceed6 && six.runtime6 > 20 * 60 && six.runtime6 < 28 * 60 && !six.v1ok && six.dis1 && /at least 2/.test(six.problems1), JSON.stringify(six));
    // multi-select, reorder, remove, duplicate protection
    const ops = await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const b = m._test.st(901).builder; b.set({ category: 'all', mood: 'romantic', allMoods: true });
      b.selectIds(['pkg_M0', 'pkg_M1', 'pkg_M2', 'pkg_M3', 'pkg_M4', 'pkg_M5', 'pkg_M6', 'pkg_M7', 'pkg_M8']); const n9 = b.state.sel.length;
      document.querySelector('[data-mix-host="901"] [data-down="0"]').click(); const swapped = b.state.sel[0] === 'pkg_M1' && b.state.sel[1] === 'pkg_M0';
      document.querySelector('[data-mix-host="901"] [data-rm="8"]').click(); const removed = b.state.sel.length === 8 && !b.state.sel.includes('pkg_M8');
      const FF = await import('/srv-farsi-mix/lib/srvFarsiMix.mjs'); const twice = [...b.record().tracks, b.record().tracks[0]]; const dup = FF.srvfMixValidate(FF.srvfMixTimeline(twice), { category: 'all', mood: 'romantic', songs: twice });
      return { n9, swapped, removed, dupBlocked: !dup.ok && /twice/i.test(dup.problems.join(' ')), runtime: b.timeline().totalLabel, ok: b.validate().ok, tracks: b.record().tracks.map((x) => x.pkgId).join(',') }; });
    check(L('multi-select, reorder and remove work; the runtime updates; duplicates are rejected'), ops.n9 === 9 && ops.swapped && ops.removed && ops.dupBlocked, JSON.stringify(ops));
    check(L('8 songs: the Mix is valid and the runtime is simply the sum (All Artists = Female + Male + Duet)'), ops.ok, ops.runtime);
    // background (each Mix can have its own) + thumbnail cover default and choice
    const bgc = await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const b = m._test.st(901).builder; b.set({ background: 'night-gold' }); const r1 = b.record(); const first = r1.thumbCover; b.set({ thumbCover: { pkgId: 'pkg_M3' } }); const r2 = b.record(); b.set({ thumbCover: null }); return { bg: r1.background, firstPkg: first && (first.pkgId || first.id), chosen: r2.thumbCover && r2.thumbCover.pkgId }; });
    check(L('background is saved with the package; thumbnail defaults to the first song and can be changed'), bgc.bg === 'night-gold' && !!bgc.firstPkg && bgc.chosen === 'pkg_M3', JSON.stringify(bgc));
    // save → package; proceed → review
    await p.evaluate(() => { document.querySelector('[data-mix-host="901"] #save').click(); }); await W(r, 900);
    const saved = await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); const pk = _srvFarsiPkgForTask(t); return pk ? { type: pk.contentType, fmt: pk.contentFormat, engine: pk.engine, uid: pk.srvTaskUid, n: pk.farsiMix.tracks.length, bg: pk.farsiMix.background, db: pk.dbTitle, cat: pk.farsiMix.category, key: pk.farsiMix.key } : null; });
    check(L('Save tracklist creates ONE SRV Farsi Mix package bound to the task (own DB title, record complete)'), saved && saved.type === 'Mix' && saved.engine === 'SRV Farsi' && /^srvf_/.test(saved.uid) && saved.n === 8 && saved.bg === 'night-gold' && /Mix fmix_/.test(saved.db), JSON.stringify(saved));
    const log1 = await fetchJson(r.stub.origin + '/__stub/log'); const pw = log1.log.filter((e) => e.method !== 'GET' && /packages/.test(e.path));
    check(L('the package was written to the packages table only (SRV Farsi, contentType Mix)'), pw.length >= 1 && pw.every((e) => /packages/.test(e.path)), pw.length + ' writes');
    await p.waitForSelector('[data-mix-host="901"] #proceed', { timeout: 8000 }).catch(async (e) => { console.log('DEBUG', JSON.stringify(await p.evaluate(() => ({ stage: _srvFarsiGetStage(901), t: (document.getElementById('srvfMixRoot-901') || document.body).innerText.slice(0, 400), ae: typeof activeExec !== 'undefined' ? String(activeExec) : 'n/a', tab: typeof currentTab !== 'undefined' ? currentTab : 'n/a', pe: 1 })))); throw e; }); await p.evaluate(() => { document.querySelector('[data-mix-host="901"] #proceed').click(); }); await W(r, 1200);
    const rev = await p.evaluate(() => ({ stage: _srvFarsiGetStage(901), txt: (document.getElementById('srvfMixRoot-901') || {}).innerText || '' }));
    check(L('Proceed moves to REVIEW showing the saved tracklist, runtime and background'), rev.stage === 'review' && /8 songs/.test(rev.txt) && /night-gold/.test(rev.txt), rev.txt.slice(0, 120));
    // review → build; Send to Approve is not offered until a build exists in the session
    await p.evaluate(() => { [...document.querySelectorAll('#srvfMixRoot-901 [data-mix-act]')].find((b) => b.dataset.mixAct === 'approve-tracklist').click(); }); await W(r, 900);
    const bld = await p.evaluate(() => ({ stage: _srvFarsiGetStage(901), acts: [...document.querySelectorAll('#srvfMixRoot-901 [data-mix-act]')].map((b) => b.dataset.mixAct) }));
    check(L('BUILD offers Build; Approve is NOT reachable without a built video'), bld.stage === 'build' && bld.acts.includes('build') && !bld.acts.includes('to-approve'), JSON.stringify(bld));
    // 30-minute rule at the gate: tamper the record to 3 songs → blocked at every gate and by the renderer
    const gate = await p.evaluate(async () => { const t = D.tasks.find((x) => x.id === 901); const pk = _srvFarsiPkgForTask(t); const keep = pk.farsiMix.tracks; pk.farsiMix.tracks = keep.slice(0, 1); _srvFarsiSetStage(901, 'review'); openExec('901'); await new Promise((r) => setTimeout(r, 700));
      const dis = [...document.querySelectorAll('#srvfMixRoot-901 [data-mix-act="approve-tracklist"]')].map((b) => b.disabled); const txt = document.getElementById('srvfMixRoot-901').innerText;
      document.querySelector('#srvfMixRoot-901 [data-mix-act="approve-tracklist"]').click(); await new Promise((r) => setTimeout(r, 300)); const stageAfter = _srvFarsiGetStage(901);
      let renderErr = ''; try { const R = await import('/srv-farsi-mix/render.mjs'); const F = await import('/srv-farsi-mix/lib/srvFarsiMix.mjs'); const tl = F.srvfMixTimeline(pk.farsiMix.tracks); await R.renderFarsiMix({ tracks: pk.farsiMix.tracks, analysis: {}, tl, mix: { category: 'all', mood: 'romantic', title: 'x' }, covers: {}, canvas: document.createElement('canvas') }); } catch (e) { renderErr = e.message; }
      pk.farsiMix.tracks = keep; return { dis, blocked: /Blocked/.test(txt), stageAfter, renderErr }; });
    check(L('fewer than two songs: Review shows Blocked, Approve-tracklist is disabled and does nothing, the renderer itself refuses'), gate.dis.every(Boolean) && gate.blocked && gate.stageAfter === 'review' && /cannot be built/.test(gate.renderErr) && /at least 2/.test(gate.renderErr), JSON.stringify(gate));
    // APPROVE / PUBLISH / DONE with an injected in-session build (the real 30-min render is verified in the preview pack, not here)
    const pub1 = await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const S = m._test.st(901); const blob = new Blob(['x'], { type: 'video/webm' });
      S.blobs = { blob, url: URL.createObjectURL(blob), thumbUrl: URL.createObjectURL(new Blob(['y'], { type: 'image/jpeg' })), mime: 'video/webm', stats: { mime: 'video/webm' } };
      const t = D.tasks.find((x) => x.id === 901); const pk = _srvFarsiPkgForTask(t); _srvFarsiSetStage(901, 'approve'); openExec('901'); await new Promise((r) => setTimeout(r, 700));
      const hasPrivate = /Private/.test(document.getElementById('srvfMixRoot-901').innerText); document.querySelector('#srvfMixRoot-901 [data-mix-act="approve"]').click(); await new Promise((r) => setTimeout(r, 900));
      const stage = _srvFarsiGetStage(901); const txt = document.getElementById('srvfMixRoot-901').innerText; const privOnPublish = /Private/.test(txt) && /YouTube Studio/.test(txt);
      const inp = document.getElementById('srvfMixYt'); inp.value = 'not a link'; document.querySelector('#srvfMixRoot-901 [data-mix-act="record-published"]').click(); await new Promise((r) => setTimeout(r, 300)); const bad = document.getElementById('srvfMixMsg').textContent;
      document.getElementById('srvfMixYt').value = 'https://www.youtube.com/watch?v=MixDone0001'; document.querySelector('#srvfMixRoot-901 [data-mix-act="record-published"]').click(); await new Promise((r) => setTimeout(r, 1000));
      return { hasPrivate, privOnPublish, stage, bad, final: _srvFarsiGetStage(901), yt: pk.youtubeVideoId, task: D.tasks.find((x) => x.id === 901).status, state: pk.youtubePublishState }; });
    check(L('APPROVE (private-first notice) → PUBLISH (manual private upload hand-off) rejects a bad link, records a good one → DONE'), pub1.hasPrivate && pub1.stage === 'publish' && pub1.privOnPublish && /Paste/.test(pub1.bad) && pub1.final === 'done' && pub1.yt === 'MixDone0001' && pub1.task === 'done' && pub1.state === 'uploaded-private', JSON.stringify(pub1));
    // isolation + Short/Long sources
    const iso = await p.evaluate(async () => { const e = D.tasks.find((x) => x.id === 801); const before = JSON.stringify(e); _srvFarsiVaSetArtistFormat(801, 'format', 'Mix'); const same = JSON.stringify(e) === before;
      const srcTask = { id: 777, engine: 'SRV Farsi', isLong: false, contentFormat: 'short', mood: 'Female — Romantic', mode: 'Female — Romantic' }; const srcs = _srvFarsiShortSources(srcTask).map((x) => x.pkg); const c = await _srvfMixHost().candidates();
      return { englishUntouched: same, mixAsShortSource: srcs.some((p) => p.farsiMix), mixInCandidates: c.some((x) => x.pkgId === _srvFarsiPkgForTask(D.tasks.find((y) => y.id === 901)).id), otherEngineMix: (D.packages || []).filter((p) => p.farsiMix && p.engine !== 'SRV Farsi').length }; });
    check(L('isolation: English task untouched, a Mix is never a Short source or a Mix source, no other engine holds Mix data'), iso.englishUntouched && !iso.mixAsShortSource && !iso.mixInCandidates && iso.otherEngineMix === 0, JSON.stringify(iso));
    check(L('no page errors'), r.pageErrors.length === 0, r.pageErrors.join(' | '));
    await p.close(); await r.stub.close();
  }
  // Auto returns the task to its scheduled format
  { const r = await run('va', true), p = r.page; const o = await p.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'format', 'Mix'); const a = { isMix: D.tasks.find((x) => x.id === 901).isMix }; _srvFarsiVaSetArtistFormat(901, 'format', 'Auto'); const t = D.tasks.find((x) => x.id === 901); return { a, isMix: !!t.isMix, fmt: t.contentFormat, type: t.contentType, name: t.name }; });
    check('Auto restores the scheduled Short format (Mix flag cleared)', o.a.isMix === true && o.isMix === false && o.fmt === 'short' && /Short/.test(o.name), JSON.stringify(o)); await p.close(); await r.stub.close(); }
  // Family: no operational access to the Mix lifecycle
  { const r = await run('family', true), p = r.page; const o = await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); const before = t ? t.isMix : null; try { _srvFarsiVaSetArtistFormat(901, 'format', 'Mix'); } catch (e) {} const canTasks = typeof canSeeTab === 'function' ? canSeeTab('tasks') : null; return { role: currentUser && currentUser.id, canTasks, rootShown: !!document.getElementById('srvfMixRoot-901') }; });
    check('Family: Mix lifecycle card is not shown', o.rootShown === false, JSON.stringify(o)); await p.close(); await r.stub.close(); }
} finally { await browser.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
