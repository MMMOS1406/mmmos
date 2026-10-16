// SRV-STUDIO-V2-017 — bounded browser check of the CEO and VA publishing paths in the real public/index.html,
// against the CEO-008 stub server (synthetic data; nothing leaves this machine; no upload happens anywhere).
// Two server states: no VA PIN set (how production starts after release) and VA PIN set.
// Run: PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/platform/headless-publish-auth.mjs   (hard limit 3 min)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub } from '../preservation/stub-server.mjs';
import { makeFixture } from '../preservation/fixtures.mjs';
import { launch, openPage, settle } from '../preservation/driver.mjs';

const kill = setTimeout(() => { console.log('TIMEOUT after 180 s'); process.exit(2); }, 180000);
const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };

const browser = await launch();
async function session(operatorPin) {
  const fixture = makeFixture(); if (operatorPin) fixture.operatorPin = operatorPin;
  const stub = await startStub({ publicDir: path.resolve(here, '../../public'), fixture });
  const { page, pageErrors } = await openPage(browser, stub.origin);
  const bodies = [];
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/ops?action=')) { let b = null; try { b = JSON.parse(r.postData() || 'null'); } catch { b = null; } bodies.push({ action: new URL(u).searchParams.get('action'), body: b }); } });
  await page.waitForFunction(() => typeof USERS !== 'undefined' && typeof selectUser === 'function');
  const signIn = async (id, pin) => {
    await page.evaluate((u) => { try { logout(); } catch (e) {} selectUser(u); }, id);
    await page.evaluate((p) => { document.getElementById('pinInput').value = p; }, pin);
    await page.evaluate(() => tryLogin());
    await settle(page, stub.origin, 500);
    return page.evaluate(() => ({ inApp: document.getElementById('appScreen').classList.contains('show'), user: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null, err: (document.getElementById('pinErr') || {}).textContent || '', op: sessionStorage.getItem('mmm_operator_session'), ceo: sessionStorage.getItem('mmm_ceo_session') }));
  };
  // A real publishing function: the SRV Farsi thumbnail step (stub answers ok; nothing is uploaded).
  const publishThumb = async () => {
    bodies.length = 0;
    await page.evaluate(() => _srvFarsiSetYouTubeThumbnail({ id: 'p1', _srvThumbUrl: location.origin + '/x/thumb.jpg' }, 'vid1'));
    return bodies.find((b) => b.action === 'set_yt_thumbnail');
  };
  const publishUpload = async () => {
    bodies.length = 0;
    await page.evaluate(() => _publishFetch('/api/ops?action=youtube_upload_video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: 'https://example.invalid/srv-assets/p1/short.mp4', engine: 'SRV Farsi', privacyStatus: 'private' }) }));
    return bodies.find((b) => b.action === 'youtube_upload_video');
  };
  return { stub, page, pageErrors, signIn, publishThumb, publishUpload, bodies };
}

// ── A. No VA PIN set yet (production right after release) ──
{
  const S = await session(null);
  let st = await S.signIn('va', (await S.page.evaluate(() => USERS.find((u) => u.id === 'va').pin)));
  ok('A1 no VA PIN set: the VA still signs in with the existing browser PIN (no lock-out at release)', st.inApp && st.user === 'va' && !st.op, st);
  let b = await S.publishThumb();
  ok('A2 VA publishing call still goes out with the same request (unsigned → server logs it and forces private)', b && b.body.videoId === 'vid1' && b.body.engine === 'SRV Farsi' && !b.body.operator_session_token && !b.body.ceo_session_token, b);
  st = await S.signIn('admin', '0000');
  ok('A3 CEO signs in (server session)', st.inApp && st.user === 'admin' && !!st.ceo, st);
  b = await S.publishUpload();
  ok('A4 CEO publishing call carries the CEO session', b && b.body.ceo_session_token === 'stub.session' && b.body.videoUrl && !b.body.operator_session_token, b);
  const card = await S.page.evaluate(() => { try { return renderIntegrations().includes('id="pubauth-card"'); } catch (e) { return 'ERR ' + e.message; } });
  ok('A5 the CEO sees the Publishing sign-in card in Integrations', card === true, card);
  ok('A6 no page errors', S.pageErrors.length === 0, S.pageErrors);
  await S.page.close(); await S.stub.close();
}

// ── B. VA PIN set by the CEO (gate enforcing) ──
{
  const S = await session('246810');
  let st = await S.signIn('va', '0000');
  ok('B1 VA PIN set: the old public PIN 0000 is refused, VA stays on the sign-in screen', !st.inApp && /Incorrect PIN/.test(st.err), st);
  st = await S.signIn('va', '246810');
  ok('B2 VA signs in with the new PIN and receives a server VA session', st.inApp && st.user === 'va' && /stub\.operator/.test(st.op || ''), st);
  let b = await S.publishThumb();
  ok('B3 authorized VA publishing (SRV Farsi thumbnail, real function) carries the VA session', b && b.body.operator_session_token === 'stub.operator' && !b.body.ceo_session_token && b.body.videoId === 'vid1', b);
  b = await S.publishUpload();
  ok('B4 VA YouTube upload request carries the VA session and keeps its payload', b && b.body.operator_session_token === 'stub.operator' && b.body.engine === 'SRV Farsi', b);
  const card = await S.page.evaluate(() => { try { return renderIntegrations().includes('id="pubauth-card"'); } catch (e) { return 'ERR ' + e.message; } });
  ok('B5 the VA does not get the Publishing sign-in card', card === false, card);
  await S.page.evaluate(() => logout());
  const after = await S.page.evaluate(() => sessionStorage.getItem('mmm_operator_session'));
  ok('B6 logout clears the VA session', after === null, after);
  st = await S.signIn('admin', '0000');
  b = await S.publishUpload();
  ok('B7 CEO after a VA in the same tab: CEO session only, no VA session carried over', b && b.body.ceo_session_token === 'stub.session' && !b.body.operator_session_token, b);
  ok('B8 no page errors', S.pageErrors.length === 0, S.pageErrors);
  await S.page.close(); await S.stub.close();
}

await browser.close();
clearTimeout(kill);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
