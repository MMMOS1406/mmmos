// SRV English Short — Long-source availability (CEO 2026-11-15). Real browser, real page, synthetic data, production-like data-proxy latency.
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
fixture.settings.mmm_finance_v118 = JSON.stringify(st); fixture.tables.packages = rows;
const stub = await startStub({ publicDir: pub, fixture, quiet: true }); const browser = await launch();
try {
  const { page } = await openPage(browser, stub.origin, { realClock: true });
  await page.evaluateOnNewDocument((d) => { const f = window.fetch; window.__inflight = 0; window.__maxInflight = 0; window.fetch = function (u, i) { if (String(u && u.url || u).indexOf('db_proxy') < 0) return f.call(window, u, i); window.__inflight++; window.__maxInflight = Math.max(window.__maxInflight, window.__inflight); return new Promise((r) => setTimeout(r, d)).then(() => f.call(window, u, i)).finally(() => { window.__inflight--; }); }; }, DELAY);
  await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, 'va'); await settle(page, stub.origin, 2500);
  const out = await page.evaluate(async () => {
    const o = { loaded: D.packages.length, maxInflight: window.__maxInflight }; const t = D.tasks.find((x) => String(x.id) === '9101');
    o.sourcesBefore = _srvEnglishV2PromoSources(t).length;
    const hasCache = typeof _srvEnglishLongLoadedAt !== 'undefined'; o.hasCache = hasCache; _srvEnglishV2PromoGenerateHtml(t, '9101'); if (hasCache) for (let i = 0; i < 150 && !_srvEnglishLongLoadedAt && !_srvEnglishLongFailed; i++) await new Promise((r) => setTimeout(r, 100));
    o.sourcesAfter = _srvEnglishV2PromoSources(t).length; o.sourceIds = _srvEnglishV2PromoSources(t).map((x) => String(x.pkg.id));
    o.shortAllowed = _srvEnglishV2ChooseFormat('9101', 'short'); _srvEnglishV2ChooseFormat('9101', 'long');
    const keep = D.packages, keepC = hasCache ? _srvEnglishLongCache : null; D.packages = D.packages.filter((p) => p.engine !== 'SRV English'); if (hasCache) _srvEnglishLongCache = [];
    o.shortRefused = _srvEnglishV2ChooseFormat('9101', 'short') === false && D.tasks.find((x) => String(x.id) === '9101').contentFormat === 'long'; o.msg = _srvEnglishV2FormatSelectorHtml(D.tasks.find((x) => String(x.id) === '9101'), '9101').includes('kept as a LONG');
    D.packages = keep; if (hasCache) _srvEnglishLongCache = keepC; return o;
  });
  const expectLoaded = rows.length - 0; // 200 packages; the app's own title de-dupe removes the 4 older Longs that share a title with a newer Short
  check(`the package list loads completely under production-like proxy latency (${DELAY} ms per call)`, out.loaded >= 190, `D.packages=${out.loaded} of ${expectLoaded} rows (de-dupe hides ${expectLoaded - out.loaded})`);
  check('pages are fetched with limited parallelism (2-4 in flight), not strictly one after another', out.maxInflight >= 2 && out.maxInflight <= 4, 'max in flight ' + out.maxInflight);
  check('EVERY built SRV English Long is offered as a Short source — including the 4 whose title a newer Short shares (hidden by the list de-dupe)', out.sourcesAfter === 6 && longs.every((id) => out.sourceIds.includes(id)), `${out.sourcesAfter} sources (${out.sourcesBefore} before the Long cache loaded)`);
  check('SHORT is allowed for a Long task when Longs exist', out.shortAllowed === true);
  check('SHORT is REFUSED (task stays a Long) when no built Long exists, and the page says why', out.shortRefused && out.msg);
} finally { await browser.close(); await stub.close(); }
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
