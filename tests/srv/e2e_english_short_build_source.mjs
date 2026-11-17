// SRV English Short — the Long of a Short is found even when the list drops it (CEO 2026-11-17: "The Long this Short comes from is not an SRV Studio Long in MMMOS — build refused"). Derived from e2e_english_short_sources.mjs.
// (older header follows) SRV English Short — Long-source availability (CEO 2026-11-15). Real browser, real page, synthetic data, production-like data-proxy latency.
// Reproduces the false "No SRV Studio Long has been built yet": the ~8 MB package list needs 13 proxy round trips (~0.9 s each in production); loaded one after another
// it ran past the loader's abort and the app saw NO packages. Also: a promo Short shares its Long's title, which hid that Long from the in-memory list.
//   PUPPETEER_CORE=<dir> node tests/srv/e2e_english_short_sources.mjs [publicDir=public]   (MAIN build => the first checks FAIL, proving the test detects the defect)
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public'); const DELAY = Number(process.env.PROXY_DELAY_MS || 900);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const pad = 'x'.repeat(36000); // ~36 KB per package: 200 packages ≈ 7.2 MB, like production (the proxy answers at most ~4 MB at a time)
const row = (id, engine, ct, title, extra, ageMin) => ({ package_id: id, engine, content_type: ct, title, generated_at: new Date(Date.UTC(2026, 9, 1) - ageMin * 60000).toISOString(), full_package: JSON.stringify({ id, engine, title, contentType: ct, generatedAt: new Date(Date.UTC(2026, 9, 1) - ageMin * 60000).toISOString(), _pad: pad, ...extra }) });
const rows = []; let age = 0;
for (let i = 0; i < 4; i++) rows.push(row('pkg_179' + (1000 + i), 'SRV English', 'Short', 'Song Number ' + i, { srvShortOf: { longPkgId: 'pkg_178' + (1000 + i) }, _srvShortVideoUrl: 'https://x/s' + i + '.webm' }, age++)); // newer Shorts, SAME title as the Longs below
for (let i = 0; i < 150; i++) rows.push(row('pkg_177' + String(1000 + i), i % 2 ? 'SRV Farsi' : 'NextWave', i % 2 ? 'Long' : 'Short Script', 'Filler ' + i, {}, age++));
const longs = []; for (let i = 0; i < 6; i++) { const id = 'pkg_178' + (1000 + i); longs.push(id); rows.push(row(id, 'SRV English', 'Long', i < 4 ? 'Song Number ' + i : 'Other Song ' + i, { _srvLongVideoUrl: 'https://x/l' + i + '.webm', _srvAudioUrl: 'https://x/l' + i + '.mp3', srvRender: { durationSec: 200 } }, age++)); }
for (let i = 0; i < 40; i++) rows.push(row('pkg_176' + String(1000 + i), 'SRV Farsi', 'Short', 'Older ' + i, {}, age++));
const fixture = makeFixture(); const st = JSON.parse(fixture.settings.mmm_finance_v118);
st.tasks.push({ id: 9101, engine: 'SRV English', name: 'SRV English — Female · Long (auto-created)', status: 'assigned', isoDate: '2026-10-05', day: 'Monday', contentType: 'Long', contentFormat: 'long', isLong: true, srvUid: 'srve_1_9101', mood: 'Female — Emotional', autoCreated: true, createdAt: 1 });
st.tasks.push({ ...st.tasks.find((x) => x.id === 9101), id: 9102, name: 'SRV English — Female · Short (auto-created)', contentType: 'Short', contentFormat: 'short', isLong: false, srvUid: 'srve_1_9102' });
fixture.settings.mmm_finance_v118 = JSON.stringify(st); fixture.tables.packages = rows;
const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
try {
  const { page } = await openPage(browser, stub.origin, { realClock: true });
  await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, 'va'); await settle(page, stub.origin, 2500);
  const out = await page.evaluate(async () => {
    const o = {}; const short = D.packages.find((p) => String(p.id) === 'pkg_1791000'); const longId = 'pkg_1781000';
    o.shortLoaded = !!short; o.longInList = !!D.packages.find((p) => String(p.id) === longId);   // the Long is dropped by the list de-dupe (same title as its Short)
    o.helperBefore = typeof _srvEnglishV2LongOfShort === 'function' ? !!_srvEnglishV2LongOfShort(short && short.srvShortOf) : 'missing';
    // 1) the review card: starts the one-time Long read and then shows the Long's real task and title instead of "task #?"
    const card0 = _srvEnglishV2PromoSourceHtml(short);
    for (let i = 0; i < 200 && !_srvEnglishLongLoadedAt && !_srvEnglishLongFailed; i++) await new Promise((r) => setTimeout(r, 100));
    const Lc = (typeof _srvEnglishLongCache !== 'undefined' ? _srvEnglishLongCache : []).find((p) => String(p.id) === 'pkg_1781000'); if (Lc) Lc.taskId = 7001;   // the fixture Long carries no task id; give the cached copy one
    const card1 = _srvEnglishV2PromoSourceHtml(short);
    o.cardBeforeHasLong = /task #\?/.test(card0); o.cardAfterHasTask = /task #7001/.test(card1) && /pkg_1781000/.test(card1);
    o.helperAfter = typeof _srvEnglishV2LongOfShort === 'function' ? !!_srvEnglishV2LongOfShort(short.srvShortOf) : false;
    // 2) the build gate: with the Long reachable the "not an SRV Studio Long" refusal must NOT be what stops it; a Short whose Long truly does not exist is still refused
    const bar = document.createElement('div'); bar.id = 'srv-lc-build-status-pkg_1791000'; document.body.appendChild(bar);
    const keepCache = _srvEnglishLongCache; _srvEnglishLongCache = []; const keepLoaded = _srvEnglishLongLoadedAt; _srvEnglishLongLoadedAt = 0;   // as after a reload: Long not in the list, cache empty
    short.title = short.title + ' (edited)';   // stop the build at the NEXT gate (title changed) so no render starts
    await _srvEnglishV2Build('pkg_1791000', '9102'); o.msgWithHiddenLong = bar.textContent;
    const ghost = JSON.parse(JSON.stringify(short)); ghost.id = 'pkg_ghost'; ghost.srvShortOf.longPkgId = 'pkg_nonexistent'; D.packages.push(ghost); bar.id = 'srv-lc-build-status-pkg_ghost';
    await _srvEnglishV2Build('pkg_ghost', '9102'); o.msgGhost = bar.textContent;
    D.packages = D.packages.filter((p) => p.id !== 'pkg_ghost'); _srvEnglishLongCache = keepCache; _srvEnglishLongLoadedAt = keepLoaded;
    return o;
  });
  check('REPRODUCED: the Short is loaded but its Long is dropped from the package list (same title)', out.shortLoaded && !out.longInList, JSON.stringify({ shortLoaded: out.shortLoaded, longInList: out.longInList }));
  check('the new lookup finds the Long (list first, then the SRV English Long cache) once the cache is read', out.helperAfter === true, String(out.helperAfter));
  check('the review card names the Long\'s task and package after the one-time read (no more "task #?")', out.cardAfterHasTask === true, String(out.cardAfterHasTask));
  check('BUILD with the Long hidden from the list is no longer refused as "not an SRV Studio Long" — it moves on to the next check', !/not an SRV Studio Long/.test(out.msgWithHiddenLong || '') && /title changed|Looking up/.test(out.msgWithHiddenLong || ''), out.msgWithHiddenLong);
  check('a Short whose Long really does not exist is STILL refused', /not an SRV Studio Long in MMMOS/.test(out.msgGhost || ''), out.msgGhost);
} finally { await browser.close(); await stub.close(); }
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
