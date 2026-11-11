// MMMOS final functional corrections (CEO order 2026-11-11) — checks against the local stub (nothing reaches production).
//   1 business analytics isolation   2 Brain retired   3 HeyGen / Submagic UI retired   4 SRV Farsi Long/Short + artist selection and source-Long eligibility   6 Settings cleanup
// PUPPETEER_CORE=<dir> node tests/home2/final_corrections.mjs
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle, fetchJson } from '../preservation/driver.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

// ---- synthetic data (every value invented): two full-length published Farsi Longs (Female, Duet), one test-length Long, open Short and Long tasks
const fx = makeFixture(); fx.restFilter = true;
const st = JSON.parse(fx.settings.mmm_finance_v118);
const T = (id, name, extra) => Object.assign({ id, engine: 'SRV Farsi', name, status: 'assigned', isoDate: '2026-10-06', day: 'Tuesday', createdAt: 1790000000000 + id, channel: '', platform: 'All' }, extra);
st.tasks.push(T(901, 'SRV Farsi — Female — Happy · Short', { mood: 'Female — Happy', mode: 'Female — Happy', contentType: 'Short Video', contentFormat: 'short', isLong: false }));
st.tasks.push(T(903, 'SRV Farsi — Duet — Romantic · Short', { mood: 'Duet — Romantic', mode: 'Duet — Romantic', contentType: 'Short Video', contentFormat: 'short', isLong: false }));
st.tasks.push(T(902, 'SRV Farsi — Long · Duet — Emotional', { mood: 'Duet — Emotional', mode: 'Duet — Emotional', contentType: 'Long Script', contentFormat: 'long', isLong: true }));
fx.settings.mmm_finance_v118 = JSON.stringify(st);
const longPkg = (id, title, artist, sec, yt, extra = {}) => ({ package_id: id, engine: 'SRV Farsi', youtube_video_id: yt, generated_at: '2026-10-' + String(10 + (sec % 15)).padStart(2, '0') + 'T10:00:00Z', full_package: JSON.stringify(Object.assign({ id, engine: 'SRV Farsi', title, artist, contentType: 'LongScript', contentFormat: 'long', isTest: false, _srvLongVideoUrl: '/assets/fixture-long.webm', _srvYtLongId: yt, _srvLongDurationSec: sec, generatedAt: '2026-10-10T10:00:00Z' }, extra)) });
fx.tables.packages = [longPkg('pkg_fx_female', 'Long Female A', 'Female', 244, 'AAAAAAAAAAA'), longPkg('pkg_fx_duet', 'Long Duet B', 'Duet', 203, 'BBBBBBBBBBB'), longPkg('pkg_fx_short_len', 'Test-length Long', 'Female', 34, 'CCCCCCCCCCC')];
fx.tables.youtube_channels = []; fx.tables.youtube_videos_analytics = [];
const stub = await startStub({ publicDir: pub, fixture: fx }); const browser = await launch();
async function session(role, viewport) { const o = await openPage(browser, stub.origin, { viewport }); await fetchJson(stub.origin + '/__stub/reset'); await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 1500); return o; }
const W = (p, ms = 600) => settle(p, stub.origin, ms);
const text = (p) => p.evaluate(() => document.getElementById('mainContent').innerText);
try {
  const on = await session('admin'); const p = on.page; const e0 = on.pageErrors.length;

  // ---------------- 1 analytics isolation ----------------
  await p.evaluate(() => {
    D.integrations.tiktok = Object.assign(D.integrations.tiktok || {}, { connected: true, accounts: [
      { openId: 'tt-f', engine: 'SRV Farsi', displayName: 'FARSI-TIKTOK', followerCount: 111, likesCount: 5, videoCount: 3, recentVideos: [], lastSync: new Date().toISOString() },
      { openId: 'tt-e', engine: 'SRV English', displayName: 'ENGLISH-TIKTOK', followerCount: 222, likesCount: 6, videoCount: 4, recentVideos: [], lastSync: new Date().toISOString() },
      { openId: 'tt-u', engine: null, displayName: 'UNASSIGNED-TIKTOK', followerCount: 1, likesCount: 1, videoCount: 1, recentVideos: [], lastSync: new Date().toISOString() },
    ] });
    D.youtubeAnalytics = { loadedAt: new Date().toISOString(), perEngine: [
      { engine: 'SRV Farsi', channelTitle: 'SRV — Silk Road Voices', views: 1000, watchHours: 5, avgRetentionPct: 40, subsGained: 7, videoCount: 10, lastSync: new Date().toISOString(), icon: '🌹' },
      { engine: 'SRV English', channelTitle: 'SRV Studio English', views: 2000, watchHours: 6, avgRetentionPct: 41, subsGained: 8, videoCount: 11, lastSync: new Date().toISOString(), icon: '🎵' },
    ] };
  });
  const go = async (id) => { await p.evaluate((i) => Home2.go(i), id); await W(p, 800); return text(p); };
  const en = await go('ws:SRV English:analytics'), fa = await go('ws:SRV Farsi:analytics'), agg = await go('analytics');
  check('SRV English workspace: no SRV Farsi TikTok account', !/FARSI-TIKTOK/.test(en) && /ENGLISH-TIKTOK/.test(en), (en.match(/FARSI-TIKTOK/) || [''])[0]);
  check('SRV English workspace: no unassigned TikTok account either', !/UNASSIGNED-TIKTOK/.test(en));
  check('SRV Farsi workspace: its own TikTok account is kept, English and unassigned are not', /FARSI-TIKTOK/.test(fa) && !/ENGLISH-TIKTOK/.test(fa) && !/UNASSIGNED-TIKTOK/.test(fa));
  check('SRV English workspace: YouTube channel card and detailed row are English only', /Studio English/.test(en) && !/Silk Road/.test(en) && /2,000/.test(en) && !/\b1,000\b/.test(en));
  check('SRV Farsi workspace: YouTube channel card and detailed row are Farsi only', /Silk Road/.test(fa) && !/Studio English/.test(fa) && /1,000/.test(fa) && !/\b2,000\b/.test(fa));
  check('workspace analytics headings name their business', /YOUTUBE ANALYTICS — SRV ENGLISH ONLY/i.test(en) && /TIKTOK ANALYTICS — SRV FARSI ONLY/i.test(fa));
  check('aggregate Analytics shows every account, each labelled with its business (Unassigned when none)', /FARSI-TIKTOK/.test(agg) && /ENGLISH-TIKTOK/.test(agg) && /UNASSIGNED-TIKTOK/.test(agg) && /SRV Farsi/.test(agg) && /SRV English/.test(agg) && /Unassigned/.test(agg));
  check('aggregate Analytics headings say each business is shown separately', /EACH BUSINESS SHOWN SEPARATELY/i.test(agg));
  check('the business scope is cleared after leaving a workspace (aggregate shows both channels)', /Silk Road/.test(agg) && /Studio English/.test(agg));
  check('the TikTok sync button inside a workspace syncs only that business', await p.evaluate(async () => { Home2.go('ws:SRV Farsi:analytics'); await new Promise((r) => setTimeout(r, 700)); const b = [...document.querySelectorAll('#mainContent button')].find((x) => /ttSyncAll\(/.test(x.getAttribute('onclick') || '')); return !!b && /SRV Farsi/.test(b.getAttribute('onclick')); }));

  // ---------------- 2 Brain retired ----------------
  const sideLabels = await p.evaluate(() => [...document.querySelectorAll('#h2Side button')].map((b) => b.innerText));
  check('sidebar: Brain is gone, the other eight sections remain', !sideLabels.includes('Brain') && JSON.stringify(sideLabels) === JSON.stringify(['Home', 'SRV Farsi', 'SRV English', 'Analytics', 'Finance', 'Engineering', 'Integrations', 'Access / Settings']), sideLabels.join(' | '));
  check('top bar has no Brain button', await p.evaluate(() => ![...document.querySelectorAll('.topbar button, .notif-bell')].some((b) => /🧠/.test(b.innerText) || /goToBrain/.test(b.getAttribute('onclick') || ''))));
  check('Brain code is retired: renderConstitution and goToBrain no longer exist', await p.evaluate(() => typeof renderConstitution === 'undefined' && typeof goToBrain === 'undefined'));
  check('the retired Constitution route lands on Home (no broken page)', await p.evaluate(async () => { renderTab('constitution'); await new Promise((r) => setTimeout(r, 400)); return /Your two businesses/i.test(document.getElementById('mainContent').innerText); }));
  check('Engineering is intact: opens, and its own Constitution tab still works', await p.evaluate(async () => { Home2.go('engineering'); await new Promise((r) => setTimeout(r, 600)); const a = document.getElementById('mainContent').innerText.length > 200; if (typeof _ebSetSub === 'function') { _ebSetSub('constitution'); await new Promise((r) => setTimeout(r, 500)); } return a && document.getElementById('mainContent').innerText.length > 200 && (await (async () => document.querySelector('#h2Side button.on').getAttribute('data-h2') === 'engineering')()); }));

  // ---------------- 3 HeyGen / Submagic UI retired ----------------
  await p.evaluate(() => Home2.go('integrations')); await W(p, 800);
  const ig = await text(p);
  check('Integrations: no HeyGen or Submagic card, panel or test button', !/heygen|submagic/i.test(ig));
  const missingInt = ['YouTube', 'TikTok', 'Suno', 'Canva'].filter((n) => !ig.includes(n));
  check('Integrations: the unrelated connected integrations are all still there (YouTube, TikTok, Suno, Canva)', missingInt.length === 0, 'missing: ' + missingInt.join(',') + ' | ' + ig.slice(0, 200).replace(/\n/g, ' '));
  check('HeyGen/Submagic test handlers no longer exist in the page', await p.evaluate(() => ['heygenTestApi', 'heygenDiscoverAvatars', 'heygenDiscoverVoices', 'heygenTestRender', 'heygenResolveSophia', 'heygenListGroups', 'heygenResolveSophiaVoice', 'heygenResolvePaulLooks', 'heygenPaulFramingTest', 'submagicTestApi', 'submagicListTemplatesUI', 'submagicTestEnhanceLatest', 'submagicEnhanceManualUrl', 'submagicCheckManualStatus'].every((f) => typeof window[f] === 'undefined')));
  check('the publishing-authorization card on Integrations is unaffected', /Set VA PIN|Require sign-in/.test(ig));

  // ---------------- 6 Settings cleanup ----------------
  const before = await p.evaluate(() => JSON.stringify({ up: D.settings && D.settings.uploadPlatforms, day: D.settings && D.settings.uploadDay }));
  await p.evaluate(() => Home2.go('settings')); await W(p, 800);
  const sg = await text(p);
  check('Settings: Upload Defaults and System cards are gone', !/UPLOAD DEFAULTS|DEFAULT PLATFORMS|DEFAULT UPLOAD DAY|MMM OS Version|Reset All Data|^SYSTEM$/im.test(sg));
  check('Settings: Profile, PIN management and the rest are intact', /PROFILE/i.test(sg) && /Change PIN/i.test(sg) && /Save Profile/i.test(sg));
  check('Settings: the stored upload defaults are unchanged (publishing defaults are not touched)', (await p.evaluate(() => JSON.stringify({ up: D.settings && D.settings.uploadPlatforms, day: D.settings && D.settings.uploadDay }))) === before, before);
  check('Settings: the old handlers are gone and nothing else referenced them', await p.evaluate(() => ['settingsTogglePlatform', 'settingsSaveUploadDay', 'settingsShowReset', 'settingsResetConfirm', 'settingsResetCancel'].every((f) => typeof window[f] === 'undefined')));
  check('the version is still shown in the top bar', await p.evaluate(() => /v\d+\.\d+/.test(document.querySelector('.topbar').innerText)));

  // ---------------- 4 SRV Farsi production selection and source-Long eligibility ----------------
  const farsiShort = async () => p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); return t ? { artist: _srvFarsiVaCurrentArtistFormat(t), id: t.id } : null; });
  const card = (id) => p.evaluate((i) => { const t = D.tasks.find((x) => x.id === i); const h = renderSRVFarsiLifecycleCard(t); const d = document.createElement('div'); d.innerHTML = h; return { text: d.innerText, selects: [...d.querySelectorAll('select')].map((s) => s.getAttribute('onchange') || ''), options: [...d.querySelectorAll('select')].map((s) => [...s.options].map((o) => o.text)), btns: [...d.querySelectorAll('button')].map((b) => (b.innerText || '').trim()) }; }, id);
  const c0 = await card(901);
  check('Short task: Artist (Auto/Male/Female/Duet) and Format (Auto/Short/Long) selectors are offered', c0.selects.some((s) => /'artist'/.test(s)) && c0.selects.some((s) => /'format'/.test(s)) && c0.options[0].length === 4 && /^Auto/.test(c0.options[0][0]) && JSON.stringify(c0.options[0].slice(1)) === JSON.stringify(['Male', 'Female', 'Duet']) && /^Auto/.test(c0.options[1][0]) && c0.options[1].includes('Short') && c0.options[1].includes('Long'), JSON.stringify(c0.options));
  check('Auto: the Short offers every published full-length Long (Female and Duet), not the test-length one', await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); const s = _srvFarsiShortSources(t).map((x) => x.pkg.title); return s.includes('Long Female A') && s.includes('Long Duet B') && !s.includes('Test-length Long'); }));
  // an explicit artist choice different from the rotation value filters the Long list: Duet on the Female-rotation task, Female on the Duet-rotation task
  for (const [tid, artist, want, notWant] of [[901, 'Duet', 'Long Duet B', 'Long Female A'], [903, 'Female', 'Long Female A', 'Long Duet B']]) {
    await p.evaluate(([i, a]) => { _srvFarsiVaSetArtistFormat(i, 'artist', a); }, [tid, artist]); await W(p, 300);
    check(`task ${tid}, artist ${artist}: only ${artist} Longs are offered as the source`, await p.evaluate(([i, w, n]) => { const t = D.tasks.find((x) => x.id === i); const s = _srvFarsiShortSources(t).map((x) => x.pkg.title); return s.includes(w) && !s.includes(n); }, [tid, want, notWant]));
  }
  await p.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'artist', 'Auto'); _srvFarsiVaSetArtistFormat(903, 'artist', 'Auto'); }); await W(p, 200);
  await p.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'artist', 'Male'); }); await W(p, 300);
  const male = await card(901);
  check('artist Male (no Male Long exists): the message is accurate, not "no Long on YouTube"', /No published full-length Male Long yet/.test(male.text) && /Female \(1\)/.test(male.text) && /Duet \(1\)/.test(male.text) && !/No published full-length SRV Farsi Long yet/.test(male.text), male.text.slice(0, 300).replace(/\n/g, ' '));
  check('artist Male: a one-click "Show all artists (Auto)" is offered', male.btns.some((b) => /Show all artists/.test(b)));
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Show all artists/.test(x.innerText)); if (b) b.click(); else _srvFarsiVaSetArtistFormat(901, 'artist', 'Auto'); }); await W(p, 300);
  check('Show all artists returns to Auto and the Longs are listed again', await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); return _srvFarsiShortSources(t).length === 2 && _srvFarsiVaCurrentArtistFormat(t).artist === 'Female'; }));
  // Long / Short and every artist combination
  const combos = [];
  for (const format of ['Long', 'Short']) for (const artist of ['Female', 'Male', 'Duet']) {
    const r = await p.evaluate((f, a) => { const t = D.tasks.find((x) => x.id === 901); _srvFarsiVaSetArtistFormat(901, 'format', f); _srvFarsiVaSetArtistFormat(901, 'artist', a); const cur = _srvFarsiVaCurrentArtistFormat(t); const h = renderSRVFarsiLifecycleCard(t); return { cur, isLong: t.isLong, ct: t.contentType, moodHead: String(t.mood).split(' — ')[0], gen: /Generate Package/.test(h), picker: /PUBLISHED LONG|No published full-length|published SRV Farsi Long/.test(h) }; }, format, artist);
    combos.push(r.cur.artist === artist && r.cur.format === format && r.moodHead === artist && r.isLong === (format === 'Long') && (format === 'Long' ? r.gen && !r.picker : !r.gen && r.picker));
  }
  check('all six format × artist combinations apply: Long → Generate Package; Short → source-Long picker; mood/artist/contentType follow', combos.every(Boolean), JSON.stringify(combos));
  await p.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'format', 'Auto'); _srvFarsiVaSetArtistFormat(901, 'artist', 'Auto'); }); await W(p, 200);
  check('Auto restores the rotation-assigned artist and format', await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); const c = _srvFarsiVaCurrentArtistFormat(t); return c.artist === 'Female' && c.format === 'Short'; }));
  check('the Short-from-Long policy is unchanged: a Short task still has no "Generate Package" and no new song', await p.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); return !/Generate Package/.test(renderSRVFarsiLifecycleCard(t)); }));
  // an older published Long that has fallen out of the app's in-memory package window is loaded again
  const lost = await p.evaluate(async () => { D.packages = D.packages.filter((q) => q.id !== 'pkg_fx_duet'); const t = D.tasks.find((x) => x.id === 901); const before = _srvFarsiShortSources(t).some((x) => x.pkg.id === 'pkg_fx_duet'); _srvFarsiSrcLoadedAt = 0; await _srvFarsiEnsureSourceLongs(901); const after = _srvFarsiShortSources(t).some((x) => x.pkg.id === 'pkg_fx_duet'); return { before, after }; });
  check('a published Long that dropped out of the newest-200 window is re-read and eligible again', lost.before === false && lost.after === true, JSON.stringify(lost));
  check('reading the source Longs wrote nothing', !(await fetchJson(stub.origin + '/__stub/log')).log.some((e) => e.method !== 'GET' && e.method !== 'HEAD' && /packages/.test(e.path) && !/upsert|state/.test(e.path)));
  check('no page errors in the Admin run', on.pageErrors.length === e0, on.pageErrors.slice(e0).join(' | '));
  await p.close();

  // VA can use the same selectors (existing role rules), Family cannot reach production
  const va = await session('va'); const vp = va.page;
  const vcard = await vp.evaluate(() => { const t = D.tasks.find((x) => x.id === 901); const h = renderSRVFarsiLifecycleCard(t); return { sel: (h.match(/_srvFarsiVaSetArtistFormat\([^)]*'artist'/g) || []).length > 0 && (h.match(/_srvFarsiVaSetArtistFormat\([^)]*'format'/g) || []).length > 0, user: currentUser.id }; });
  check('VA: Long/Short and artist selectors are available on the Generate step', vcard.user === 'va' && vcard.sel);
  check('VA: choosing Duet + Long works and keeps the audit trail', await vp.evaluate(() => { _srvFarsiVaSetArtistFormat(901, 'artist', 'Duet'); _srvFarsiVaSetArtistFormat(901, 'format', 'Long'); const t = D.tasks.find((x) => x.id === 901); return t.isLong === true && /^Duet/.test(t.mood) && (t.vaOverrides || []).some((o) => o.by === 'va'); }));
  await vp.close();
  const fam = await session('family');
  check('Family: no production controls (no Operator Mode, no artist/format selector)', await fam.page.evaluate(() => { renderTab('home'); return !/OPERATOR MODE/.test(document.getElementById('mainContent').innerText) && !document.getElementById('h2Side'); }));
  await fam.page.close();
} finally { await browser.close(); await stub.close(); }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
