// Renders the approved Home against a READ-ONLY COPY of real production data in the local stub (nothing reaches production, nothing is written there)
// and checks every figure on the three business cards and the finance row against an independent calculation from the same rows.
// CLI_FIXTURE=<file from tools/home2/fetch-real-fixture.mjs> PUPPETEER_CORE=<dir> node tests/home2/real_data_replay.mjs [screenshotDir]
import fs from 'node:fs'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
const real = JSON.parse(fs.readFileSync(process.env.CLI_FIXTURE || path.join(process.env.HOME, 'mmm-backups/home2-real-fixture-20261109.json'), 'utf8'));
const shotDir = process.argv[2];
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const fx = makeFixture(); fx.restFilter = true; fx.settings.mmm_finance_v118 = real.state;
fx.tables.packages = real.packages; fx.tables.youtube_channels = real.youtube_channels; fx.tables.youtube_videos_analytics = real.youtube_videos_analytics;
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const stub = await startStub({ publicDir: pub, fixture: fx }); const browser = await launch();
const trunc = (v, n) => { v = String(v); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
const BIZ = ['SRV Farsi', 'SRV English']; const st = JSON.parse(real.state);
try {
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [375, 812, 'mobile']]) {
    const o = await openPage(browser, stub.origin, { viewport: { width: w, height: h }, realClock: true });
    await o.page.evaluate(() => localStorage.removeItem('mmm_home_v2'));   // default behaviour: no flag
    await o.page.evaluateOnNewDocument(() => localStorage.removeItem('mmm_home_v2'));
    await o.page.reload(); await login(o.page, stub.origin, 'admin'); await settle(o.page, stub.origin, 1200);
    await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 1200);
    const cards = await o.page.evaluate(() => [...document.querySelectorAll('#mainContent .h2-grid.c2 .h2-card')].map((c) => ({ name: c.querySelector('h3').innerText.trim(), kv: Object.fromEntries([...c.querySelectorAll('.h2-kv')].map((r) => [r.children[0].innerText, r.children[1].innerText])), dot: c.querySelector('.h2-dot').style.background })));
    if (tag === 'desktop') {
      check('two business cards rendered', cards.length === 2 && cards.map((c) => c.name).join() === BIZ.join(), cards.map((c) => c.name).join());
      const text = JSON.stringify(cards);
      check('no card says "No packages yet", "No analytics yet", "Could not load" or "Loading…"', !/No packages yet|No analytics yet|Could not load|Loading/.test(text), (text.match(/No packages yet|No analytics yet|Could not load|Loading/g) || []).join());
      for (const [i, b] of BIZ.entries()) {
        const c = cards[i].kv;
        const pk = real.packages.filter((p) => p.engine === b).sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
        check(`${b}: last package = newest package row (#${pk.id})`, trunc(pk.title || '#' + pk.id, 48).trim() === String(c['Last package']).trim(), c['Last package']);
        const fp = JSON.parse(pk.full_package); const vid = pk.youtube_video_id || fp._srvYtLongId || fp.youtubeVideoId || (fp.srvPublish || {}).videoId;
        const exp = vid ? ((fp.srvPublish || {}).privacyStatus === 'private' ? 'On YouTube (private)' : 'On YouTube') : (fp.lifecycleStage ? 'In production · ' + fp.lifecycleStage : fp.srvRender ? 'Rendered, not uploaded' : 'Generated (draft)');
        check(`${b}: stage "${c['Stage']}" matches the package's own markers`, c['Stage'] === exp, `expected ${exp}`);
        const open = st.tasks.filter((t) => t.engine === b && !['done', 'uploaded', 'posted'].includes(t.status)).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
        const expTask = open.length ? trunc(open[0].name || open[0].title || 'Open task', 44) + ' · ' + open[0].status + (open.length > 1 ? ` (+${open.length - 1})` : '') : 'Nothing waiting';
        check(`${b}: next action = oldest open task (${open.length} open)`, c['Next action'] === expTask, c['Next action']);
        const ch = real.youtube_channels.find((x) => x.mmm_engine === b); const rows = real.youtube_videos_analytics.filter((r) => r.channel_id === ch.channel_id);
        const views = rows.reduce((a, r) => a + (Number(r.views) || 0), 0), subs = rows.reduce((a, r) => a + (Number(r.subs_gained) || 0), 0), last = rows.map((r) => r.analytics_synced_at).sort().pop();
        check(`${b}: views ${views.toLocaleString()} = sum over ALL ${rows.length} synced videos`, c['Views (all synced videos)'] === views.toLocaleString(), c['Views (all synced videos)']);
        check(`${b}: subscribers gained +${subs} = sum over all synced videos`, c['Subscribers gained (from videos)'] === '+' + subs.toLocaleString(), c['Subscribers gained (from videos)']);
        const age = (Date.now() - new Date(last).getTime()) / 86400000;
        check(`${b}: YouTube health reflects last sync (${age.toFixed(1)} days ago)`, age <= 3 ? /^Connected/.test(c['YouTube']) && /22c55e|34, 197, 94/.test(cards[i].dot) : /^Needs attention/.test(c['YouTube']), c['YouTube']);
      }
      // the shared loader would have understated the totals — prove the capped loader differs so the per-channel read is needed
      const capped = real.youtube_videos_analytics.slice().sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0)).slice(0, 200);
      const farsi = real.youtube_channels.find((x) => x.mmm_engine === 'SRV Farsi').channel_id;
      const fullN = real.youtube_videos_analytics.filter((r) => r.channel_id === farsi).length, capN = capped.filter((r) => r.channel_id === farsi).length;
      check('info: the app-wide analytics loader (200-row cap) would have counted fewer SRV Farsi videos than exist', true, `${capN} of ${fullN}`);
      // finance
      const money = await o.page.evaluate(() => { const g = [...document.querySelectorAll('#mainContent .h2-grid.c4 .h2-card')]; const F = computeFinanceState(); return { cards: g.map((c) => c.innerText.replace(/\n+/g, ' | ')), income: F.incomeTotal, spend: F.expenseTotal, plaid: !!D.plaidConnected }; });
      const expInc = st.plaidConnected ? parseFloat(st.plaidMonthlyIncome) || 0 : (st.income || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const expSp = st.plaidConnected ? parseFloat(st.plaidMonthlyBurn) || 0 : (st.expenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const f = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
      check(`monthly income ${f(expInc)} equals the app's finance data (${st.plaidConnected ? 'bank-linked' : 'manual entries'})`, money.income === expInc && money.cards[0].includes(f(expInc)), money.cards[0]);
      check(`monthly spend ${f(expSp)} equals the app's finance data`, money.spend === expSp && money.cards[1].includes(f(expSp)), money.cards[1]);
      check(`net ${f(expInc - expSp)} = income minus spend, labelled`, money.cards[2].includes(f(expInc - expSp)) && /income minus spend/.test(money.cards[2]), money.cards[2]);
      check('source of the figures is stated', /Source: (linked bank accounts|entries in Finance)/.test(money.cards[2]) && (money.plaid ? /linked bank/.test(money.cards[2]) : /entries in Finance/.test(money.cards[2])));
      const fin = await o.page.evaluate(() => { renderTab('finance'); return document.getElementById('mainContent').innerText; });
      check('the same income and spend appear on the existing Finance screen', fin.includes(f(expInc).replace('$', '')) || fin.includes(Math.round(expInc).toLocaleString()), 'looked for ' + f(expInc));
    }
    check(`${tag}: no horizontal overflow`, !(await o.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
    check(`${tag}: no page errors`, o.pageErrors.length === 0, o.pageErrors.join(' | '));
    if (shotDir) { await o.page.evaluate(() => renderTab('home')); await settle(o.page, stub.origin, 1000); await o.page.screenshot({ path: path.join(shotDir, `home2-real-${tag}.png`) }); }
    const writes = (await (await fetch(stub.origin + '/__stub/log')).json()).log.filter((e) => e.method !== 'GET' && e.method !== 'HEAD' && /packages|youtube_|rest\/v1\/(?!rpc)/.test(e.path));
    check(`${tag}: no write to packages or YouTube tables`, writes.filter((e) => /packages|youtube_/.test(e.path)).length === 0);
    await o.page.close();
  }
} finally { await browser.close(); await stub.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
