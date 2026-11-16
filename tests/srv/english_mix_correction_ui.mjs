// SRV Studio Mix Builder — CEO correction 2026-11-16, real browser: every catalog song is listed with one of four states; any two or more songs make a valid Mix; the length is dynamic.
// Mounts the REAL srv2-mix.mjs page module with mocked server answers. Synthetic data only. PUPPETEER_CORE=<dir> CHROME_PATH=<chrome> node tests/srv/english_mix_correction_ui.mjs
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
import { launch } from '../preservation/driver.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname); const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.ttf': 'font/ttf' };
const srv = http.createServer((q, s) => { const f = path.join(pub, decodeURIComponent(q.url.split('?')[0])); if (q.url === '/blank') { s.setHeader('content-type', 'text/html'); s.end('<!doctype html><div id="root"></div>'); return; } fs.readFile(f, (e, b) => { if (e) { s.statusCode = 404; s.end(); } else { s.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); s.end(b); } }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + srv.address().port;
const browser = await launch(); const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
try {
  await page.goto(origin + '/blank');
  const out = await page.evaluate(async () => {
    const { mount } = await import('/srv-studio-v2/srv2-mix.mjs');
    const mk = (i, o) => Object.assign({ pkgId: 'pkg_' + i, title: 'Song ' + i, youtubeVideoId: 'vid' + String(i).padStart(8, '0'), durationSec: 200 + i * 7, audioSource: 'long-video-aac', sourceUrl: 'https://x/' + i, thumbUrl: null, generatedAt: '2026-10-' + String(10 + i), privacyStatus: 'public', reason: null, eligible: true }, o);
    const songs = [mk(1), mk(2), mk(3), mk(4), mk(5, { eligible: false, reason: 'not_public', privacyStatus: 'private' }), mk(6, { eligible: false, reason: 'no_audio_source', audioSource: 'long-video-aac' }), mk(7, { eligible: false, reason: 'not_built', durationSec: 0, youtubeVideoId: null }), mk(8, { eligible: false, reason: 'not_found_on_youtube' })];
    songs.forEach((s) => { s.state = s.eligible ? 'ready' : null; });
    const el = { ok: true, songs, eligibleCount: 4, possibleSec: 800, ready: true, readiness: 'ready' };
    const op = async (b) => b.op === 'eligibility' ? el : b.op === 'list' ? { ok: true, mixes: {}, config: { playlistId: null, maxBytes: 524288000 } } : b.op === 'save' ? { ok: true, mix: { ...b.mix, ready: true, problems: [] } } : { ok: false, error: 'unexpected_' + b.op };
    const root = document.getElementById('root'); const api = mount(root, { op, avatars: [{ id: 'a1', number: 1, src: 'x.jpg', title: 't' }], month: '2026-11', now: () => Date.parse('2026-11-16T12:00:00Z'), fetchImpl: fetch, close() {} });
    for (let i = 0; i < 60 && !root.querySelector('#mx-catalog'); i++) await new Promise((r) => setTimeout(r, 50));
    const rows = () => [...root.querySelectorAll('table.mx-t tr[data-state]')].map((r) => ({ state: r.getAttribute('data-state'), text: r.textContent.replace(/\s+/g, ' '), pick: !!r.querySelector('[data-pick]') }));
    const res = { rows: rows(), catalog: root.querySelector('#mx-catalog').textContent.replace(/\s+/g, ' '), banner: root.querySelector('.mx-ready').textContent.replace(/\s+/g, ' '), h3: root.querySelector('section h3').textContent, hasTarget: /target 30:00|30-minute/.test(root.textContent) };
    // pick exactly TWO songs through the real checkboxes
    for (const id of ['pkg_2', 'pkg_1']) { const cb = root.querySelector('[data-pick="' + id + '"]'); cb.checked = true; cb.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 30)); }
    res.two = { order: api.state.order.slice(), head: [...root.querySelectorAll('section h3')].map((h) => h.textContent).find((t) => /Arrange/.test(t)) || '', ok: /Ready to build/.test(root.textContent), problems: [...root.querySelectorAll('.warn')].map((x) => x.textContent).join(' | ') };
    // add every ready song, then remove all but one -> not buildable
    root.querySelector('#mx-addall').click(); await new Promise((r) => setTimeout(r, 30)); res.all = { n: api.state.order.length, head: [...root.querySelectorAll('section h3')].find((h) => /Arrange/.test(h.textContent)).textContent };
    api.state.order = ['pkg_1']; api.actions.draw(); res.one = { build: !!root.querySelector('#mx-build') && root.querySelector('#mx-build').disabled, problems: root.textContent.includes('at least 2 songs') };
    return res;
  });
  const by = (s) => out.rows.filter((r) => r.state === s);
  check('every song in the catalog is listed (8 of 8) — none silently dropped', out.rows.length === 8, out.rows.length);
  check('four states are shown: ready (4), source audio unavailable (1), private or unpublished (2: private + not on the channel), not built (1)', by('ready').length === 4 && by('source_unavailable').length === 1 && by('private').length === 2 && by('not_built').length === 1, out.rows.map((r) => r.state).join());
  check('only ready songs have a checkbox; the others state their reason in plain words', out.rows.every((r) => r.pick === (r.state === 'ready')) && /private or not public on YouTube/.test(by('private')[0].text) && /its audio file is missing/.test(by('source_unavailable')[0].text) && /no finished Long video yet/.test(by('not_built')[0].text));
  check('the counts line names the four states', /8 songs in the catalog/.test(out.catalog) && /4 Published — ready to use/.test(out.catalog) && /1 Published — source audio unavailable/.test(out.catalog) && /2 Private or unpublished/.test(out.catalog) && /1 Not built/.test(out.catalog), out.catalog);
  check('no fixed-length wording: the banner says any two or more songs, in any order; no "target 30:00"', /any two or more/.test(out.banner) && !out.hasTarget, out.banner);
  check('TWO songs are a valid Mix: order kept as picked (song 2 then song 1), "Ready to build", runtime shown, no length rule', out.two.order.join() === 'pkg_2,pkg_1' && out.two.ok && /your 2 songs, any length/.test(out.two.head) && !/30:00/.test(out.two.head), JSON.stringify(out.two));
  check('"Add every ready song" adds all 4 (no cap)', out.all.n === 4 && /your 4 songs/.test(out.all.head), JSON.stringify(out.all));
  check('ONE song cannot be built (at least 2 songs), Build is disabled', out.one.build && out.one.problems, JSON.stringify(out.one));
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally { await browser.close(); srv.close(); }
const bad = R.filter((x) => !x).length; console.log(`${R.length - bad}/${R.length} checks passed`); process.exit(bad ? 1 : 0);
