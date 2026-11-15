// Release 1 — every consumer of the shared package loader / paged proxy reads, in a real browser, main vs the release build, for CEO, VA and Family.
// Synthetic data only. The page is the LOCKED build (no direct database calls possible); the proxy policy is the REAL lib/dataProxy.mjs decide().
//   PUPPETEER_CORE=<dir> node tests/ceo017f/e2e_loader_consumers.mjs <mainPublicDir> <releasePublicDir>
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs'; import { makeLockdown } from '../preservation/lockdown-layer.mjs';
const [mainPub, relPub] = process.argv.slice(2, 4).map((p) => fs.realpathSync(p));
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const pad = 'x'.repeat(30000);
const row = (id, engine, ct, title, extra, age) => { const g = new Date(Date.UTC(2026, 9, 1) - age * 60000).toISOString(); return { package_id: id, engine, content_type: ct, title, generated_at: g, youtube_video_id: extra && extra._srvYtLongId || null, full_package: JSON.stringify({ id, engine, title, contentType: ct, generatedAt: g, _pad: pad, ...extra }) }; };
const rows = []; let age = 0;
for (let i = 0; i < 6; i++) rows.push(row('pkg_179' + (1000 + i), 'SRV English', 'Short', 'Eng Song ' + i, { srvShortOf: { longPkgId: 'pkg_178' + (1000 + i) } }, age++));
for (let i = 0; i < 40; i++) rows.push(row('pkg_178' + (2000 + i), i % 3 ? 'SRV Farsi' : 'NextWave', i % 3 ? 'Short' : 'Short Script', 'Mixed ' + i, {}, age++));
for (let i = 0; i < 8; i++) rows.push(row('pkg_178' + (1000 + i), 'SRV English', 'Long', i < 6 ? 'Eng Song ' + i : 'Eng Other ' + i, { _srvLongVideoUrl: 'https://x/e' + i + '.webm', _srvAudioUrl: 'https://x/e' + i + '.mp3', srvRender: { durationSec: 210 } }, age++));
for (let i = 0; i < 60; i++) rows.push(row('pkg_177' + (3000 + i), 'AI Studio', 'Short', 'AI ' + i, {}, age++));
for (let i = 0; i < 10; i++) rows.push(row('pkg_177' + (1000 + i), 'SRV Farsi', 'Long', 'Farsi Long ' + i, { _srvLongVideoUrl: 'https://x/f' + i + '.webm', _srvYtLongId: 'yt' + i, _srvLongDurationSec: 200, srvTaskUid: 'srvf_1_' + i }, age++));
for (let i = 0; i < 60; i++) rows.push(row('pkg_176' + (1000 + i), i % 2 ? 'SRV Farsi' : 'NextWave', 'Short', 'Old ' + i, {}, age++));
async function snap(browser, pub, role, delay) {
  const fixture = makeFixture(); const st = JSON.parse(fixture.settings.mmm_finance_v118);
  st.tasks.push({ id: 9101, engine: 'SRV English', name: 'SRV English — Female · Long (auto-created)', status: 'assigned', isoDate: '2026-10-05', day: 'Monday', contentType: 'Long', contentFormat: 'long', isLong: true, srvUid: 'srve_1_9101', mood: 'Female — Emotional', autoCreated: true, createdAt: 1 });
  st.tasks.push({ id: 9102, engine: 'SRV Farsi', name: 'SRV Farsi — Female — Romantic · Short', status: 'assigned', isoDate: '2026-10-05', day: 'Monday', contentType: 'Short', contentFormat: 'short', srvUid: 'srvf_1_9102', mode: 'Female — Romantic' });
  fixture.settings.mmm_finance_v118 = JSON.stringify(st); fixture.tables.packages = rows; fixture.lockdown = makeLockdown();
  const lockedPub = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-')); fs.cpSync(pub, lockedPub, { recursive: true });
  const stub = await startStub({ publicDir: lockedPub, fixture, quiet: true });
  try {
    const { page } = await openPage(browser, stub.origin, { realClock: true });
    await page.evaluateOnNewDocument((d) => { const f = window.fetch; window.fetch = function (u, i) { if (String(u && u.url || u).indexOf('db_proxy') < 0) return f.call(window, u, i); return new Promise((r) => setTimeout(r, d)).then(() => f.call(window, u, i)); }; }, delay);
    await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, role); await settle(page, stub.origin, 2500);
    const out = await page.evaluate(async () => {
      const o = { ids: (D.packages || []).map((p) => p.id), per: {} }; (D.packages || []).forEach((p) => { o.per[p.engine] = (o.per[p.engine] || 0) + 1; });
      if (typeof _srvFarsiEnsureSourceLongs === 'function') { await _srvFarsiEnsureSourceLongs('9102'); const t = D.tasks.find((x) => String(x.id) === '9102'); try { o.farsiSources = _srvFarsiShortSources(t, true).length; } catch (e) { o.farsiSources = 'err ' + e.message; } }
      const te = D.tasks.find((x) => String(x.id) === '9101'); if (typeof _srvEnglishV2EnsureLongSources === 'function') { _srvEnglishV2EnsureLongSources('9101'); for (let i = 0; i < 150 && !_srvEnglishLongLoadedAt && !_srvEnglishLongFailed; i++) await new Promise((r) => setTimeout(r, 100)); }
      try { o.englishSources = _srvEnglishV2PromoSources(te).length; } catch (e) { o.englishSources = 'err ' + e.message; } return o;
    });
    const lk = (await (await fetch(stub.origin + '/__stub/log')).json()).lockdown; out.direct = lk.direct.length; out.denied = lk.proxyDenied.filter((x) => x.path === 'packages').length; return out;
  } finally { await stub.close(); }
}
const browser = await launch();
try {
  for (const [role, label] of [['admin', 'CEO'], ['va', 'VA'], ['family', 'Family']]) {
    const m = await snap(browser, mainPub, role, 0), r = await snap(browser, relPub, role, 0);
    check(`${label}: package list identical on main and release (same ids, same order, ${r.ids.length} packages after the app's own de-dupe)`, JSON.stringify(m.ids) === JSON.stringify(r.ids) && r.ids.length > 100);
    check(`${label}: per-business package counts identical on main and release (no business gains or loses a package)`, JSON.stringify(m.per) === JSON.stringify(r.per), JSON.stringify(r.per));
    check(`${label}: SRV Farsi Short-source consumer returns the same sources on main and release`, m.farsiSources === r.farsiSources && typeof r.farsiSources === 'number', `main ${m.farsiSources} / release ${r.farsiSources}`);
    check(`${label}: zero direct database calls and no refused package read (locked build, real proxy policy)`, r.direct === 0 && r.denied === 0 && m.direct === 0, `direct ${r.direct}, refused ${r.denied}`);
    if (role !== 'family') { const slow = await snap(browser, relPub, role, 900), slowM = await snap(browser, mainPub, role, 900); check(`${label}: under production-like latency (900 ms/call) the release loads ${slow.ids.length} packages; main loads ${slowM.ids.length}`, slow.ids.length === r.ids.length && slowM.ids.length < r.ids.length); if (role === 'va') check('VA: English Short sources = all 8 built Longs on the release (main cannot offer them under latency)', slow.englishSources === 8, `release ${slow.englishSources}`); }
  }
} finally { await browser.close(); }
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
