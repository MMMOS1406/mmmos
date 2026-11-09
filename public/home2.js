/* MMMOS — simplified CEO homepage (blueprint CEO_017_SIMPLIFIED_INTERFACE.md). ISOLATED BRANCH, default OFF.
 *
 * Loaded only when this browser opted in (?home=on, stored locally as mmm_home_v2="on") and only acts for the Admin.
 * With the flag off — or for Family / VA — this file is never requested and nothing changes.
 * It adds a nine-item sidebar and a two-row Home (the two retained businesses; finance and analytics). It READS only (the app's own analytics loader plus one packages read per business),
 * writes nothing, calls no write action, and sends no credential. Every other screen still renders through the ORIGINAL router.
 * It stands down when the older CEO-008 shell is on (mmm_shell_admin_v1="on"). Reversible: ?home=off, or "Classic navigation" (this tab).
 */
(function () {
  'use strict';
  if (window.Home2) return;
  var FLAG = 'mmm_home_v2', CLASSIC = 'mmm_home_classic', SHELL = 'mmm_shell_admin_v1';
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ss(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function isAdmin() { return typeof currentUser !== 'undefined' && !!currentUser && currentUser.id === 'admin'; }
  function authorized() { return ls(FLAG) === 'on' && ls(SHELL) !== 'on' && isAdmin(); }
  function active() { return authorized() && ss(CLASSIC) !== '1'; }
  var _renderTab = window.renderTab;
  if (typeof _renderTab !== 'function') return;

  var BIZ = [['SRV Farsi', 'srv_farsi'], ['SRV English', 'srv_english']];   // CEO portfolio decision 2026-11-09: two retained businesses
  var SIDE = [
    ['home', 'Home'], ['biz:SRV Farsi', 'SRV Farsi'], ['biz:SRV English', 'SRV English'],
    ['analytics', 'Analytics'], ['finance', 'Finance'], ['brain', 'Brain'], ['engineering', 'Engineering'], ['integrations', 'Integrations'], ['settings', 'Access / Settings']
  ];
  var S = { cur: 'home', data: null, at: 0, loading: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function trunc(x, n) { x = String(x == null ? '' : x); return x.length > n ? x.slice(0, n - 1) + '…' : x; }
  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString('en-US'); }
  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function ago(t) { if (!t) return 'never'; var m = Math.round((Date.now() - new Date(t).getTime()) / 60000); if (isNaN(m)) return 'unknown'; return m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; }
  function ageDays(t) { var d = (Date.now() - new Date(t).getTime()) / 86400000; return isNaN(d) ? null : d; }

  /* ------------------------------------------------------------ styles */
  function style() {
    if ($('h2Style')) return;
    var s = document.createElement('style'); s.id = 'h2Style';
    s.textContent = [
      '#appScreen.show.h2-on{display:grid;grid-template-columns:230px minmax(0,1fr);grid-template-rows:auto 1fr;align-items:start}',
      '#appScreen.h2-on>.topbar{grid-column:1/-1}#appScreen.h2-on>#navBar{display:none}',
      '#appScreen.h2-on>#h2Side{grid-column:1;grid-row:2;position:sticky;top:58px;padding:14px 10px;border-right:1px solid var(--border);min-height:calc(100vh - 58px);display:flex;flex-direction:column;gap:2px}',
      '#appScreen.h2-on>#mainContent{grid-column:2;grid-row:2;max-width:1000px}',
      '#h2Side button{background:none;border:0;color:var(--dim);text-align:left;padding:10px 12px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}',
      '#h2Side button:hover{color:var(--text);background:rgba(255,255,255,.04)}#h2Side button.on{color:var(--gold);background:rgba(201,168,76,.12)}',
      '#h2Side .sp{flex:1}#h2Side .cl{font-size:11px;font-weight:600;opacity:.8}',
      '@media(max-width:860px){#appScreen.show.h2-on{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto 1fr}',
      '#appScreen.h2-on>#h2Side{grid-column:1;grid-row:2;position:static;flex-direction:row;overflow-x:auto;min-height:0;border-right:0;border-bottom:1px solid var(--border);padding:6px;scrollbar-width:none}',
      '#h2Side button{white-space:nowrap;flex-shrink:0;padding:9px 11px}#h2Side .sp{display:none}#appScreen.h2-on>#mainContent{grid-column:1;grid-row:3}}',
      '.h2-wrap{font-family:"Syne",sans-serif;padding-bottom:30px}.h2-title{font-size:22px;font-weight:800;color:#fff;margin:2px 0 14px}',
      '.h2-lab{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--dim);font-family:"JetBrains Mono",monospace;text-transform:uppercase;margin:18px 0 8px}',
      '.h2-grid{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}@media(min-width:900px){.h2-grid.c2{grid-template-columns:repeat(2,minmax(0,1fr))}.h2-grid.c3{grid-template-columns:repeat(3,minmax(0,1fr))}.h2-grid.c4{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.h2-card{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:var(--radius);padding:14px;min-width:0}',
      '.h2-card h3{margin:0 0 8px;font-size:15px;color:#fff;display:flex;align-items:center;gap:8px}',
      '.h2-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}',
      '.h2-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;color:#8b9cc4}.h2-kv:last-of-type{border-bottom:0}.h2-kv>span{flex-shrink:0;white-space:nowrap}.h2-kv b{color:#fff;text-align:right;min-width:0;overflow-wrap:anywhere}',
      '.h2-btn{background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.4);color:var(--gold);border-radius:8px;padding:8px 13px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;margin-top:10px}',
      '.h2-big{font-size:20px;font-weight:800;color:#fff}.h2-sm{font-size:11px;color:var(--dim)}.h2-empty{font-size:12px;color:var(--dim);padding:6px 0}',
      '.h2-item{border-top:1px solid var(--border);padding:10px 0;font-size:12.5px;color:#fff}.h2-item:first-child{border-top:0}.h2-item p{margin:3px 0 0;font-size:11.5px;color:#8b9cc4}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------ chrome */
  function paintSide() {
    var el = $('h2Side'), app = $('appScreen'); if (!app) return;
    if (!el) { el = document.createElement('nav'); el.id = 'h2Side'; el.setAttribute('aria-label', 'Main'); app.insertBefore(el, $('mainContent')); }
    el.innerHTML = SIDE.map(function (s) { return '<button type="button" data-h2="' + s[0] + '" class="' + (S.cur === s[0] ? 'on' : '') + '">' + esc(s[1]) + '</button>'; }).join('') +
      '<div class="sp"></div><button type="button" class="cl" data-h2="__classic">Classic navigation</button>';
    app.classList.add('h2-on');
  }
  function scrub() {
    var el = $('h2Side'); if (el && el.parentNode) el.parentNode.removeChild(el);
    var app = $('appScreen'); if (app) app.classList.remove('h2-on');
  }
  function legacy(tab, cur, then) { _renderTab(tab); if (then) safe(then); S.cur = cur || tab; paintSide(); }
  function go(id) {
    if (id === '__classic') { try { sessionStorage.setItem(CLASSIC, '1'); } catch (e) { /* ignore */ } scrub(); window.renderTab('home'); return; }
    if (id === 'home') { window.renderTab('home'); return; }
    if (id.indexOf('biz:') === 0) { S.cur = id; paintSide(); paintMain(bizPage(id.slice(4))); load(function () { paintMain(bizPage(id.slice(4))); }); return; }
    if (id === 'analytics') return legacy('engines', 'analytics', function () { setEnginesSub('analytics'); });
    if (id === 'brain') return legacy('system', 'brain', function () { setSystemSub('constitution'); });
    if (id === 'engineering') return legacy('system', 'engineering', function () { setSystemSub('engineering'); });
    if (id === 'integrations') return legacy('system', 'integrations', function () { setSystemSub('integrations'); });
    if (id === 'settings') return legacy('system', 'settings', function () { setSystemSub('settings'); });
    legacy(id);
  }
  function paintMain(html) { var c = $('mainContent'); if (c) c.innerHTML = html; }

  /* ------------------------------------------------------------ data (reads only) */
  function rest(path) {
    return fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' } })
      .then(function (r) { return r.ok ? r.json().then(function (rows) { return { ok: true, rows: Array.isArray(rows) ? rows : [] }; }) : { ok: false, rows: [] }; })
      .catch(function () { return { ok: false, rows: [] }; });
  }
  function load(done) {
    if (S.loading) return;
    if (S.data && Date.now() - S.at < 60000) { done(); return; }
    S.loading = true;
    var pk = BIZ.map(function (b) { return rest('packages?engine=eq.' + encodeURIComponent(b[0]) + '&select=id,title,created_at,published_at,youtube_video_id,full_package&order=created_at.desc&limit=1'); });
    // per-channel totals are read per channel: the app's shared analytics loader caps at 200 rows across ALL channels and so understates a business
    Promise.all([Promise.all(pk), rest('youtube_channels?select=channel_id,mmm_engine&mmm_engine=not.is.null')]).then(function (r) {
      var chans = r[1].rows, yt = {};
      return Promise.all(BIZ.map(function (b) {
        var ch = chans.filter(function (c) { return c.mmm_engine === b[0]; })[0];
        if (!ch) { yt[b[0]] = { ok: r[1].ok, channel: false }; return null; }
        return rest('youtube_videos_analytics?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&analytics_synced_at=not.is.null&select=views,subs_gained,analytics_synced_at&limit=1000').then(function (a) {
          var v = 0, s = 0, last = null; a.rows.forEach(function (x) { v += Number(x.views) || 0; s += Number(x.subs_gained) || 0; if (x.analytics_synced_at && (!last || x.analytics_synced_at > last)) last = x.analytics_synced_at; });
          yt[b[0]] = { ok: a.ok, channel: true, videos: a.rows.length, views: v, subs: s, lastSync: last };
        });
      })).then(function () {
        S.data = { pkg: r[0].map(function (x) { return { ok: x.ok, row: x.rows[0] || null }; }), yt: yt };
        S.at = Date.now(); S.loading = false; done();
      });
    }).catch(function () { S.data = S.data || { pkg: BIZ.map(function () { return { ok: false, row: null }; }), yt: {} }; S.loading = false; done(); });
  }
  function openTasks(engine) {
    return safe(function () { return (D.tasks || []).filter(function (t) { return t && t.engine === engine && t.status !== 'done' && t.status !== 'uploaded' && t.status !== 'posted'; }).sort(function (a, b) { return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0); }); }, []);
  }

  /* ------------------------------------------------------------ views */
  function health(engine) {
    var e = S.data && S.data.yt[engine];
    if (!S.data) return ['#6b7280', 'Loading…'];
    if (!e || !e.ok) return ['#6b7280', 'Could not load'];
    if (!e.channel) return ['#f59e0b', 'No YouTube channel linked'];
    var d = e.lastSync ? ageDays(e.lastSync) : null;
    return d == null ? ['#6b7280', 'No analytics synced yet'] : d <= 3 ? ['#22c55e', 'Syncing · last sync ' + ago(e.lastSync)] : ['#f59e0b', 'Needs attention · last sync ' + ago(e.lastSync)];
  }
  function stage(x) {
    if (!x) return 'Loading…'; if (!x.ok) return 'Could not load'; var p = x.row; if (!p) return 'No packages yet';
    var fp = {}; try { fp = typeof p.full_package === 'string' ? JSON.parse(p.full_package) : (p.full_package || {}); } catch (e) { fp = {}; }
    var pub = fp.srvPublish || {}, vid = p.youtube_video_id || fp.youtubeVideoId || fp._srvYtLongId || pub.videoId || (fp.srvProduction || {}).youtubeVideoId || (fp.srvVa || {}).youtubeVideoId || (fp.srvPilot || {}).youtubeVideoId;
    if (vid || p.published_at) return pub.privacyStatus === 'private' ? 'On YouTube (private)' : pub.privacyStatus === 'public' ? 'Published' : 'On YouTube';
    if (fp.lifecycleStage) return 'In production · ' + String(fp.lifecycleStage);
    if (fp.srvRender) return 'Rendered, not uploaded';
    return 'Generated (draft)';
  }
  function bizCard(i) {
    var b = BIZ[i], px = S.data && S.data.pkg[i], p = px && px.row, h = health(b[0]), e = S.data && S.data.yt[b[0]] && S.data.yt[b[0]].ok ? S.data.yt[b[0]] : null, t = openTasks(b[0]);
    var ta = t.length ? esc(trunc(t[0].name || t[0].title || 'Open task', 44)) + ' · ' + esc(t[0].status || '') + (t.length > 1 ? ' (+' + (t.length - 1) + ')' : '') : 'Nothing waiting';
    return '<div class="h2-card"><h3><span class="h2-dot" style="background:' + h[0] + '"></span>' + esc(b[0]) + '</h3>' +
      '<div class="h2-kv"><span>Last package</span><b>' + (p ? esc(trunc(p.title || ('#' + p.id), 48)) : (S.data ? (px && px.ok ? 'None yet' : 'Could not load') : 'Loading…')) + '</b></div>' +
      '<div class="h2-kv"><span>Stage</span><b>' + esc(stage(px)) + '</b></div>' +
      '<div class="h2-kv"><span>Next action</span><b>' + ta + '</b></div>' +
      '<div class="h2-kv"><span>YouTube</span><b>' + esc(h[1]) + '</b></div>' +
      '<div class="h2-kv"><span>Views (all synced videos)</span><b>' + (e && e.videos ? Number(e.views).toLocaleString() : '—') + '</b></div>' +
      '<div class="h2-kv"><span>Subscribers gained (from videos)</span><b>' + (e && e.videos ? '+' + Number(e.subs).toLocaleString() : '—') + '</b></div>' +
      '<button type="button" class="h2-btn" data-h2="biz:' + esc(b[0]) + '">Open ' + esc(b[0]) + '</button></div>';
  }
  function moneyStrip() {
    var F = safe(function () { return computeFinanceState(); }, null);
    if (!F) return '<div class="h2-empty">Finance data unavailable.</div>';
    var src = safe(function () { return D.plaidConnected ? 'Source: linked bank accounts' : 'Source: entries in Finance'; }, '');
    return '<div class="h2-grid c4"><div class="h2-card"><div class="h2-sm">Monthly income</div><div class="h2-big">' + money(F.incomeTotal) + '</div></div>' +
      '<div class="h2-card"><div class="h2-sm">Monthly spend</div><div class="h2-big">' + money(F.expenseTotal) + '</div></div>' +
      '<div class="h2-card"><div class="h2-sm">Net per month (income minus spend)</div><div class="h2-big">' + money((F.incomeTotal || 0) - (F.expenseTotal || 0)) + '</div><div class="h2-sm">' + esc(src) + '</div></div>' +
      '<div class="h2-card"><div class="h2-sm">More detail</div><button type="button" class="h2-btn" data-h2="finance">Finance</button> <button type="button" class="h2-btn" data-h2="analytics">Analytics</button></div></div>';
  }
  function homePage() {
    return '<div class="h2-wrap"><div class="h2-title">Home</div>' +
      '<div class="h2-lab">Your two businesses</div><div class="h2-grid c2">' + bizCard(0) + bizCard(1) + '</div>' +
      '<div class="h2-lab">Finance and analytics</div>' + moneyStrip() + '</div>';
  }
  function bizPage(engine) {
    var i = BIZ.map(function (b) { return b[0]; }).indexOf(engine);
    return '<div class="h2-wrap"><div class="h2-title">' + esc(engine) + '</div><div class="h2-grid c2">' + bizCard(i) + '</div>' +
      '<div class="h2-lab">Open the detailed screens</div><div class="h2-card"><div class="h2-sm" style="margin-bottom:6px">These are the existing screens, unchanged.</div>' +
      '<button type="button" class="h2-btn" data-h2="analytics">Analytics</button> <button type="button" class="h2-btn" data-h2="__tasks">Tasks</button> <button type="button" class="h2-btn" data-h2="__packages">Packages</button></div></div>';
  }

  /* ------------------------------------------------------------ router hook */
  window.renderTab = function (tab) {
    if (!active() || tab !== 'home') {
      var r = _renderTab.apply(this, arguments);
      if (active()) { S.cur = tab === 'home' ? 'home' : (SIDE.some(function (s) { return s[0] === tab; }) ? tab : S.cur); paintSide(); } else if (!authorized()) scrub();
      return r;
    }
    if (typeof currentTab !== 'undefined') currentTab = 'home';
    S.cur = 'home'; style(); paintSide(); paintMain(homePage()); load(function () { if (S.cur === 'home' && active()) paintMain(homePage()); });
  };
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('[data-h2]'); if (!t || !active()) return;
    var id = t.getAttribute('data-h2');
    if (id === '__tasks') { legacy('tasks'); return; }
    if (id === '__packages') { legacy('engines', S.cur, function () { setEnginesSub('packages'); }); return; }
    go(id);
  });
  var app = $('appScreen');
  if (app && window.MutationObserver) new MutationObserver(function () { if (!app.classList.contains('show') || !authorized()) { if ($('h2Side') || app.classList.contains('h2-on')) scrub(); } }).observe(app, { attributes: true, attributeFilter: ['class'] });
  window.Home2 = { active: active, go: go };
  style();
  if (active() && $('appScreen') && $('appScreen').classList.contains('show')) window.renderTab('home');
})();
