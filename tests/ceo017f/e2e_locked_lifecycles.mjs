// CEO-017F — production lifecycles AFTER the database lockdown (Stage 3a page + Stage 3b database/storage), in a real browser.
// The page is the LOCKED build (MMM_DIRECT_FALLBACK=false). The stub models the locked production: a direct /rest/v1 call is REFUSED, db_proxy applies the REAL
// authorization policy (lib/dataProxy.mjs decide), and srv-assets storage accepts only the app's real upload shapes and never replaces an object.
//   PUPPETEER_CORE=<dir> node tests/ceo017f/e2e_locked_lifecycles.mjs [publicDir=public]
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs';
import { launch, openPage, login, settle, fetchJson } from '../preservation/driver.mjs'; import { makeLockdown } from '../preservation/lockdown-layer.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const lockedPub = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-life-')); fs.cpSync(pub, lockedPub, { recursive: true });
const hp = path.join(lockedPub, 'index.html'); const h = fs.readFileSync(hp, 'utf8'); if (!/const MMM_DIRECT_FALLBACK=(true|false);/.test(h)) throw new Error('switch not found'); fs.writeFileSync(hp, h.replace(/const MMM_DIRECT_FALLBACK=(true|false);/, process.env.MUTATION_UNLOCKED === '1' ? 'const MMM_DIRECT_FALLBACK=true;' : 'const MMM_DIRECT_FALLBACK=false;'));   // MUTATION_UNLOCKED=1 proves the test can detect an unlocked page
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const row = (id, engine, title) => ({ package_id: id, engine, content_type: 'Long', title, full_package: JSON.stringify({ id, engine, title, contentType: 'Long', generatedAt: '2026-10-01T00:00:00.000Z', _srvLongVideoUrl: 'https://x/y.webm' }), generated_at: '2026-10-01T00:00:00Z' });
const fixture = makeFixture(); fixture.tables.packages = [row('pkg_1790000000001', 'SRV Farsi', 'Existing Farsi Long'), row('pkg_1790000000002', 'SRV English', 'Existing English Long'), row('pkg_1790000000003', 'SRV Farsi', 'Existing Farsi Long Two')];
fixture.lockdown = makeLockdown(); const stub = await startStub({ publicDir: lockedPub, fixture, quiet: true }); const browser = await launch();
const rep = async () => (await fetchJson(stub.origin + '/__stub/log')).lockdown; const snap = async () => { const r = await rep(); return { direct: r.direct.length, allowed: r.proxyAllowed.length, denied: r.proxyDenied.length, sAllow: r.storageAllowed.length, sDeny: r.storageDenied.length }; };
const slice = (r, a) => ({ direct: r.direct.slice(a.direct), allowed: r.proxyAllowed.slice(a.allowed), denied: r.proxyDenied.slice(a.denied), sAllow: r.storageAllowed.slice(a.sAllow), sDeny: r.storageDenied.slice(a.sDeny) });
// one business lifecycle, performed with the APP'S OWN functions: save a package, upload its media, save the shared state, load the package list
const lifecycle = async (eng, kinds) => {
  // The preservation harness fakes the clock and its Date.now() is FRACTIONAL (e.g. 1791208800066.8); a real browser's is an integer, and the storage policy (correctly) refuses a '.' in a file name. Make it integer, as in production.
  { const dn = Date.now.bind(Date); Date.now = () => Math.floor(dn()); }
  const out = { uploads: [] }; const pid = 'pkg_' + String(Date.now()).slice(0, 13);
  const bytes = (n) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (i * 7) % 251; return a; };
  try { await savePackageToSupabase({ id: pid, taskId: 1, engine: eng, contentType: 'Long', title: 'Lifecycle ' + eng + ' ' + pid, generatedAt: '2026-11-15T00:00:00.000Z' }); out.save = 'ok'; } catch (e) { out.save = 'err ' + e.message; }
  for (const [kind, name, type, n] of kinds) { try { const url = await _srvUploadToStorage(pid, new File([bytes(n)], name, { type }), kind); const g = await fetch(url); const b = new Uint8Array(await g.arrayBuffer()); out.uploads.push({ kind, name, ok: g.ok && b.length === n }); } catch (e) { out.uploads.push({ kind, name, ok: false, err: String(e.message).slice(0, 90) }); } }
  try { out.state = await _persistFinancePayloadToSupabase({ availableCash: 1, probe: true }); } catch (e) { out.state = 'err ' + e.message; }
  try { const l = await fetchPackagesFromTable(); out.list = l.length; out.listTitles = l.map((p) => p.title).slice(0, 5); } catch (e) { out.list = 'err ' + e.message; }
  return out;
};
const FARSI = [['photo', 'photo.jpg', 'image/jpeg', 3000], ['audio', 'original song.mp3', 'audio/mpeg', 5000], ['long', 'srv_farsi_long.webm', 'video/webm', 9000], ['short', 'srv_short.webm', 'video/webm', 4000], ['thumb', 'thumb.jpg', 'image/jpeg', 2000]];
const ENGLISH = [['long', 'srv2_long.mp4', 'video/mp4', 9000], ['short', 'srv2_short.webm', 'video/webm', 4000], ['thumb', 'srv2_thumb.jpg', 'image/jpeg', 2000], ['audio', 'suno original.mp3', 'audio/mpeg', 5000]];
try {
  for (const [role, label] of [['admin', 'CEO'], ['va', 'VA']]) {
    const { page } = await openPage(browser, stub.origin); await login(page, stub.origin, role);
    for (const [eng, kinds] of [['SRV Farsi', FARSI], ['SRV English', ENGLISH]]) {
      const before = await snap(); const res = await page.evaluate(lifecycle, eng, kinds); await settle(page, stub.origin, 500); const d = slice(await rep(), before);
      check(`${label} · ${eng} lifecycle: the package saves through the proxy (POST packages allowed for the role)`, d.allowed.some((x) => x.method === 'POST' && x.path === 'packages'), res.save);
      check(`${label} · ${eng} lifecycle: all ${kinds.length} media uploads are accepted by the real storage policy and served back byte-for-byte`, res.uploads.every((u) => u.ok) && d.sAllow.length === kinds.length, JSON.stringify(res.uploads.filter((u) => !u.ok)));
      check(`${label} · ${eng} lifecycle: the shared-state save (mmm_state_save) goes through the proxy`, d.allowed.some((x) => /rpc\/mmm_state_save/.test(x.path)));
      check(`${label} · ${eng} lifecycle: the existing package records load (3 seeded) through the proxy`, res.list === 3, String(res.list));
      check(`${label} · ${eng} lifecycle: NOT ONE direct database call and nothing refused by the proxy`, d.direct.length === 0 && d.denied.length === 0, JSON.stringify([d.direct, d.denied].flat().slice(0, 3)));
    }
    if (role === 'va') {
      const b = await snap(); const x = await page.evaluate(async () => { const g = async (k) => { const r = await fetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.' + k + '&select=value'); return r.status; }; return { creative: await g('srv_farsi_creative_v2'), retain: await g('srv_farsi_retain_original_audio'), mixLedger: await g('srv_farsi_mix_ledger'), ceoKey: await g('ceo_auth_config'), state: await g('mmm_finance_v118') }; });
      check('VA settings reads: Creative V2 flag, the retention switch and the shared state are readable; the Mix ledger and CEO keys are not', x.creative === 200 && x.retain === 200 && x.state === 200 && x.mixLedger === 403 && x.ceoKey === 403, JSON.stringify(x));
      void b;
    }
    await page.close();
  }
  { // Family: read-only business overview
    const { page } = await openPage(browser, stub.origin); await login(page, stub.origin, 'family'); const before = await snap();
    const res = await page.evaluate(async () => { const o = {}; try { o.list = (await fetchPackagesFromTable()).length; } catch (e) { o.list = 'err'; } try { await savePackageToSupabase({ id: 'pkg_1799999999999', taskId: 1, engine: 'SRV Farsi', contentType: 'Long', title: 'Family must not save' }); } catch (e) {} try { await _persistFinancePayloadToSupabase({ probe: true }); } catch (e) {} return o; });
    await settle(page, stub.origin, 500); const d = slice(await rep(), before);
    check('Family: can read the package list (3 records)', res.list === 3, String(res.list));
    check('Family: a package save and a state save are REFUSED by the proxy (read_only_role) — nothing is written', d.denied.filter((x) => x.reason === 'read_only_role').length >= 1 && !d.allowed.some((x) => x.method === 'POST'), JSON.stringify(d.denied.map((x) => x.reason)));
    check('Family: no direct database call', d.direct.length === 0); await page.close();
  }
  { // before sign-in: only the two public switches
    const { page } = await openPage(browser, stub.origin); await page.evaluate(() => 1); const before = await snap();
    const x = await page.evaluate(async () => { const g = async (k) => (await fetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.' + k + '&select=value')).status; const t = async (tbl) => (await fetch(SUPABASE_URL + '/rest/v1/' + tbl + '?select=*&limit=1')).status; return { enabled: await g('srv_studio_v2_enabled'), mix: await g('srv_studio_v2_mix'), creative: await g('srv_farsi_creative_v2'), state: await g('mmm_finance_v118'), packages: await t('packages'), brain: await t('brain_adr') }; });
    check('before sign-in: the two public switches are readable through the proxy', x.enabled === 200 && x.mix === 200, JSON.stringify(x));
    check('before sign-in: every other setting and table is refused (401) — including srv_farsi_creative_v2, the shared state, packages and the engineering records', x.creative === 401 && x.state === 401 && x.packages === 401 && x.brain === 401, JSON.stringify(x));
    const d = slice(await rep(), before); check('before sign-in: nothing goes direct to the database', d.direct.length === 0); await page.close();
  }
  { // storage rules in the locked world
    const { page } = await openPage(browser, stub.origin); await login(page, stub.origin, 'admin'); const before = await snap();
    const x = await page.evaluate(async () => { const post = async (p) => (await fetch(SUPABASE_URL + '/storage/v1/object/srv-assets/' + p, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' }, body: new Uint8Array(100) })).status; const T = String(Date.now()).slice(0, 13); const ok1 = await post(`pkg_${T}/audio_${T}_a.mp3`); return { fresh: ok1, again: await post(`pkg_${T}/audio_${T}_a.mp3`), arbitrary: await post('evil/anything.mp3'), traversal: await post(`pkg_${T}/../x.mp3`), wrongKind: await post(`pkg_${T}/video_${T}_a.mp3`), otherArea: await post('avatars/srv-farsi/a.png'), sources: await post('srv-farsi-sources/ivJbmQiZ79Y/' + T + '_abc.mp3') }; });
    check('storage: a fresh upload in the real shape works', x.fresh === 200, JSON.stringify(x));
    check('storage: re-uploading the same name (even with x-upsert) is refused — an existing file can never be replaced', x.again === 409, String(x.again));
    check('storage: arbitrary paths, traversal, unknown kinds and the server-only areas (avatars, Mix sources) are refused for the browser', x.arbitrary === 403 && x.traversal === 403 && x.wrongKind === 403 && x.otherArea === 403 && x.sources === 403, JSON.stringify(x)); await page.close();
  }
  const all = await rep();
  check('ACROSS EVERYTHING: zero direct database calls from any role or any lifecycle', all.direct.length === 0, JSON.stringify(all.direct.slice(0, 3)));
  const errs = (await fetchJson(stub.origin + '/__stub/log')).unknown || []; check('no unknown server action was needed by these lifecycles', !errs.some((a) => /db_proxy/.test(a)));
} finally { await browser.close(); await stub.close(); }
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
