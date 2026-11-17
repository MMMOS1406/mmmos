// SRV Farsi Mix — SAVE / RE-SAVE / REOPEN of an already-saved Mix when this browser's package list lacks it (2026-11-13 incident: "Could not save the Mix: the database refused the package").
// Reproduces the incident, then proves the fix: no second package, same id, repeat-save safe, lookup failure refuses without writing. (base harness copied from farsi_mix_upload_e2e.mjs)
// SRV Farsi Mix — app-level end-to-end (CEO order 2026-11-12): complete published-song inventory (paged), view-all, Finglish confirmation, media probe, and the INTEGRATED chunked upload
// from the browser through the relay policy to an in-memory YouTube: retries, pause + resume, one YouTube session, bit-identical file, private, thumbnail, playlist, temporary-copy cleanup,
// reload recovery, server flag OFF. Local stub, synthetic data; nothing leaves this machine.   PUPPETEER_CORE=<dir> node tests/srv/farsi_mix_upload_e2e.mjs
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle, fetchJson } from '../preservation/driver.mjs';
import { createStubMixApi } from './farsi-mix-preview/stub-mix-api.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const T0 = Date.now(); setTimeout(() => { console.log(`WATCHDOG: no completion after 6 minutes (normal run: ~90 s) — aborting; ${R.length} checks had completed`); process.exit(3); }, 6 * 60e3).unref(); const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`[+${Math.round((Date.now() - T0) / 1000)}s] ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 500) : ''}`); };
const N = 130; const arts = ['Female', 'Male', 'Duet']; const moods = ['Romantic', 'Happy', 'Emotional'];
const pkgs = Array.from({ length: N }, (_, i) => { const id = 'pkg_I' + String(i).padStart(3, '0'), a = arts[i % 3], m = moods[i % 3 === 0 ? 0 : (i % 7) % 3]; const yt = 'INVvid' + String(i).padStart(5, '0'); const dead = i === 7 || i === 8; const noFg = i === 2 || i === 3;
  return { id, engine: 'SRV Farsi', title: i === 11 ? 'همان عنوان' : i === 12 ? 'همان عنوان' : 'آهنگ شماره ' + (i + 1), ...(noFg ? {} : { titleFinglish: 'Ahang Shomareh ' + (i + 1) }), artist: a, mood: a + ' — ' + m, contentType: 'LongScript', contentFormat: 'long', isTest: false, _srvLongVideoUrl: dead ? '/does-not-exist.webm' : '/home2.js', _srvYtLongId: yt, _srvLongDurationSec: 200 + (i % 40), srvPublish: { privacyStatus: 'public' }, _srvAvatarChoice: { id: a.toLowerCase() + '_01', artist: a.toLowerCase() }, generatedAt: new Date(Date.UTC(2026, 9, 1) + i * 3600e3).toISOString() }; });
let lastFx = null;
const fx = (mixApi) => { const f = makeFixture(); lastFx = f; f.persistTableWrites = true; f.restFilter = true; f.persistTableWrites = true; const st = JSON.parse(f.settings.mmm_finance_v118);
  st.tasks.push({ id: 901, engine: 'SRV Farsi', name: 'SRV Farsi — Female — Romantic · Short', status: 'assigned', isoDate: '2026-10-06', day: 'Tuesday', createdAt: 1790000000901, channel: '', platform: 'All', srvTaskUid: 'srvf_901', mood: 'Female — Romantic', mode: 'Female — Romantic', contentType: 'Short Video', contentFormat: 'short', isLong: false });
  f.settings.mmm_finance_v118 = JSON.stringify(st); f.tables.packages = pkgs.map((p) => ({ package_id: p.id, engine: 'SRV Farsi', youtube_video_id: p._srvYtLongId, generated_at: p.generatedAt, full_package: JSON.stringify(p) })); f.tables.youtube_channels = []; f.tables.youtube_videos_analytics = [];
  f.api.srv_farsi_mix = mixApi.api; return f; };
const browser = await launch();
async function session(role, mixApi) { const stub = await startStub({ publicDir: pub, fixture: fx(mixApi) }); const o = await openPage(browser, stub.origin); await o.page.evaluateOnNewDocument(() => { window.__SRVF_RESET_MS = 1e9; }); await fetchJson(stub.origin + '/__stub/reset'); await o.page.evaluate(() => { try { localStorage.setItem('srvfMix', '1'); } catch (e) {} }); await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 1500); return { stub, ...o }; }
const W = (r, ms = 700) => settle(r.page, r.stub.origin, ms);
const openMix = async (r) => { await r.page.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'format', 'Mix'); currentTab = 'tasks'; openExec('901'); }); await W(r, 1800); await r.page.waitForSelector('[data-mix-host="901"] #save', { timeout: 15000 }); };
try {
  const mixApi = createStubMixApi({ publicVideos: pkgs.map((p) => p._srvYtLongId), packages: () => pkgs, enabled: true }); const r = await session('admin', mixApi), p = r.page; const msgs = [];
  p.on('dialog', (d) => { msgs.push(d.message()); d.accept().catch(() => {}); });
  const mixRows = async () => (await fetchJson(r.stub.origin + '/__sb/rest/v1/packages?content_type=eq.Mix&select=package_id,title,engine,task_id')) || [];
  const inPage = () => p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); const k = _srvFarsiPkgForTask(t); return { id: k && k.id, key: k && k.farsiMix && k.farsiMix.key, n: (D.packages || []).filter((x) => x && x.farsiMix).length }; });
  const dropFromList = () => p.evaluate(() => { D.packages = (D.packages || []).filter((x) => !(x && x.farsiMix)); return !_srvFarsiPkgForTask(D.tasks.find((x) => x.id === 901)); });
  const clickSave = async () => { await p.evaluate(() => document.querySelector('[data-mix-host="901"] #save').click()); await W(r, 1200); };
  await openMix(r);
  await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const b = m._test.st(901).builder; b.set({ category: 'all', mood: 'romantic', allMoods: true }); b.selectIds(['pkg_I000', 'pkg_I001', 'pkg_I004']); });
  await clickSave(); const first = await inPage(); let rows = await mixRows();
  check('the first save creates exactly one Mix package', rows.length === 1 && first.id === rows[0].package_id && !msgs.length, JSON.stringify({ rows: rows.length, first, msgs }));
  const baseId = first.id, baseTitle = rows[0] && rows[0].title;

  // INCIDENT: this browser's package list does not contain the saved Mix (fresh browser / package load cut short) and the CEO saves the tracklist again.
  check('(setup) the page list lacks the saved Mix', await dropFromList());
  await clickSave(); let now = await inPage(); rows = await mixRows();
  check('INCIDENT FIX: saving again never creates a second package — still ONE row, same package id, same title, no error shown', rows.length === 1 && rows[0].package_id === baseId && rows[0].title === baseTitle && now.id === baseId && !msgs.length, JSON.stringify({ rows: rows.map((x) => x.package_id), baseId, now, msgs }));
  check('and no two packages share the same (engine, title) — what the database constraint protects', new Set(rows.map((x) => x.engine + '|' + x.title)).size === rows.length);

  // repeat-save is idempotent
  await clickSave(); await clickSave(); await clickSave(); now = await inPage(); rows = await mixRows();
  check('repeat-save (3 more clicks): still one row, same id, same key, no error', rows.length === 1 && rows[0].package_id === baseId && now.id === baseId && now.key === first.key && !msgs.length, JSON.stringify({ n: rows.length, now, msgs }));

  // opening the card restores the Mix from the database without any save
  check('(setup) the page list lacks the saved Mix again', await dropFromList());
  await p.evaluate(() => { currentTab = 'tasks'; openExec('901'); }); await W(r, 2500); now = await inPage();
  check('REOPEN: the card restores the existing Mix package from the database (same id) without writing anything', now.id === baseId && (await mixRows()).length === 1, JSON.stringify(now));

  // the lookup itself fails: refuse, change nothing (never guess "no package")
  check('(setup) the page list lacks the saved Mix + the lookup is blocked', await dropFromList());
  await p.evaluate(() => { window.__rf = window.fetch; window.fetch = (u, i) => (/content_type=eq\.Mix/.test(String(u)) ? Promise.reject(new Error('net down')) : window.__rf(u, i)); });
  const before = msgs.length; await clickSave(); rows = await mixRows();
  check('LOOKUP FAILURE: the save is refused with a clear message and writes nothing (still one row, same id)', rows.length === 1 && rows[0].package_id === baseId && msgs.length > before && /could not check whether this Mix is already saved/.test(msgs[msgs.length - 1]), JSON.stringify({ n: rows.length, last: msgs[msgs.length - 1] }));
  await p.evaluate(() => { window.fetch = window.__rf; });

  // a full reload (new page load) and save again
  await p.reload(); await login(p, r.stub.origin, 'admin'); await settle(p, r.stub.origin, 1500); await p.evaluate(() => { currentTab = 'tasks'; openExec('901'); }); await W(r, 2500); now = await inPage();
  check('after a full reload the saved Mix is found (same id, same key)', now.id === baseId && now.key === first.key, JSON.stringify(now));
  const nmsg = msgs.length; await p.evaluate(() => { const b = document.querySelector('[data-mix-host="901"] #save'); if (b) b.click(); }); await W(r, 1500); rows = await mixRows();
  check('and saving after the reload still keeps ONE row with the same id, no error', rows.length === 1 && rows[0].package_id === baseId && msgs.length === nmsg, JSON.stringify({ n: rows.length, msgs: msgs.slice(nmsg) }));
  await p.close(); await r.stub.close();
} finally { await browser.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
