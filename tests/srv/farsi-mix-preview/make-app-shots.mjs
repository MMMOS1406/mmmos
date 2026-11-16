// Screenshots of the REAL app (local stub, synthetic data): the Mix lifecycle inside the SRV Farsi task card for the CEO and the VA, and the repaired SRV English Short selector.
// PUPPETEER_CORE=<dir> node tests/srv/farsi-mix-preview/make-app-shots.mjs <outDir>
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../../preservation/stub-server.mjs'; import { launch, openPage, login, settle, fetchJson } from '../../preservation/driver.mjs';
const out = process.argv[2] || '.'; fs.mkdirSync(out, { recursive: true });
const pub = fs.realpathSync(new URL('../../../public', import.meta.url).pathname);
import { farsiFx, engFx } from './fixtures-app.mjs';
const T = null;
const browser = await launch();
async function sess(fx, role, flag) { const stub = await startStub({ publicDir: pub, fixture: fx }); const o = await openPage(browser, stub.origin, { viewport: { width: 1100, height: 900 } }); await fetchJson(stub.origin + '/__stub/reset'); await o.page.evaluate((f) => { try { f ? localStorage.setItem('srvfMix', '1') : localStorage.removeItem('srvfMix'); } catch (e) {} }, flag); await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 1500); return { stub, ...o }; }
const shot = async (p, name, sel) => { await new Promise((r) => setTimeout(r, 900)); const el = sel ? await p.$(sel) : null; await (el || p).screenshot({ path: `${out}/${name}`, ...(el ? {} : { fullPage: false }) }); console.log('shot', name); };
try {
  for (const role of ['admin', 'va']) {
    const tag = role === 'admin' ? 'ceo' : 'va'; const r = await sess(farsiFx({ songsDir: path.join(out, 'songs') }), role, true), p = r.page;
    await p.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'format', 'Mix'); currentTab = 'tasks'; openExec('901'); }); await settle(p, r.stub.origin, 1800);
    await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const b = m._test.st(901).builder; b.set({ category: 'all', mood: 'romantic', allMoods: true, background: 'teal-dusk' }); b.selectIds(['pkg_M0', 'pkg_M1', 'pkg_M2', 'pkg_M3', 'pkg_M4', 'pkg_M5', 'pkg_M6', 'pkg_M7']); });
    await shot(p, `app-${tag}-1-generate-mix-selection.png`, '#mainContent');
    if (role === 'admin') {
      await p.evaluate(() => { const cb = document.querySelector('[data-mix-host="901"] [data-fgok]'); if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } }); await new Promise((r) => setTimeout(r, 600));
      await p.evaluate(() => { document.querySelector('[data-mix-host="901"] #viewall').click(); }); await shot(p, 'app-ceo-1b-view-all-eligible-songs.png', '#mainContent');
      await p.evaluate(() => { document.querySelector('[data-mix-host="901"] #viewall').click(); });
      await p.evaluate(() => { document.querySelector('[data-mix-host="901"] #save').click(); }); await new Promise((r) => setTimeout(r, 1200)); await p.waitForSelector('[data-mix-host="901"] #proceed', { timeout: 8000 }); await p.evaluate(() => document.querySelector('[data-mix-host="901"] #proceed').click()); await settle(p, r.stub.origin, 1200);
      await shot(p, 'app-ceo-2-review.png', '#mainContent');
      await p.evaluate(() => [...document.querySelectorAll('#srvfMixRoot-901 [data-mix-act]')].find((b) => b.dataset.mixAct === 'approve-tracklist').click()); await settle(p, r.stub.origin, 900);
      await shot(p, 'app-ceo-3-build.png', '#mainContent');
      // PUBLISH / DONE with a small stand-in file (the real 27-minute build + 1.2 GB upload is in the full-render evidence)
      await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const blob = new Blob([crypto.getRandomValues(new Uint8Array(65536)), new Uint8Array(3_000_000)], { type: 'video/webm' }); const thumb = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], { type: 'image/jpeg' }); m._test.st(901).blobs = { blob, url: URL.createObjectURL(blob), thumbBlob: thumb, thumbUrl: URL.createObjectURL(thumb), mime: 'video/webm', stats: {} }; const pk = _srvFarsiPkgForTask(D.tasks.find((x) => x.id === 901)); const tl = (await import('/srv-farsi-mix/lib/srvFarsiMix.mjs')).srvfMixTimeline(pk.farsiMix.tracks); pk.farsiMix.build = { at: new Date().toISOString(), items: tl.items.map((x) => ({ pkgId: x.pkgId, title: x.title, finglish: x.finglish, youtubeVideoId: x.youtubeVideoId, timestamp: x.timestamp, chapterSec: x.chapterSec })), durationSec: tl.totalSec, bytes: blob.size, mime: 'video/webm' }; _srvFarsiSetStage(901, 'approve'); openExec('901'); });
      await new Promise((r) => setTimeout(r, 1500)); await p.evaluate(() => document.querySelector('#srvfMixRoot-901 [data-mix-act="approve"]').click()); await new Promise((r) => setTimeout(r, 1500));
      await new Promise((r) => setTimeout(r, 1800)); await shot(p, 'app-ceo-4-publish-private-upload.png', '#mainContent');
      await p.evaluate(() => document.querySelector('#srvfMixRoot-901 [data-mix-act="upload"]').click()); await p.waitForFunction(() => _srvFarsiGetStage(901) === 'done', { timeout: 60000 }); await new Promise((r) => setTimeout(r, 1200));
      await shot(p, 'app-ceo-5-done-private.png', '#mainContent');
    }
    await p.close(); await r.stub.close();
  }
  // short mix → blocked screen
  { const r = await sess(farsiFx({ songsDir: path.join(out, 'songs') }), 'va', true), p = r.page; await p.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'format', 'Mix'); currentTab = 'tasks'; openExec('901'); }); await settle(p, r.stub.origin, 1800);
    await p.evaluate(async () => { const m = await import('/srv-farsi-mix/lifecycle.mjs'); const b = m._test.st(901).builder; b.set({ category: 'all', mood: 'romantic', allMoods: true }); b.selectIds(['pkg_M0']); });
    await shot(p, 'app-va-2-one-song-blocked.png', '#mainContent'); await p.close(); await r.stub.close(); }
  // English repaired selector
  for (const role of ['admin', 'va']) { const r = await sess(engFx(), role, false), p = r.page;
    await p.evaluate(() => { _srvStudioV2Flag.state = 'on'; _srvEnglishV2ChooseFormat(801, 'short'); _srvEnglishLongLoadedAt = 0; currentTab = 'tasks'; openExec('801'); }); await settle(p, r.stub.origin, 2500);
    await shot(p, `app-english-short-selector-${role === 'admin' ? 'ceo' : 'va'}.png`, '#mainContent'); await p.close(); await r.stub.close(); }
} finally { await browser.close(); }
