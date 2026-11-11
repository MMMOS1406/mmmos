/* MMMOS — CEO homepage and navigation (blueprint CEO_017_SIMPLIFIED_INTERFACE.md). DEFAULT for the Admin (CEO decisions 2026-11-10).
 *
 * Loaded for every session but acts ONLY for the Admin; Family and VA never see it (this file then only passes every call through).
 * One authoritative destination per function:
 *   Home ................ the two businesses + finance and analytics summaries (every card/row links to its destination)
 *   SRV Farsi / SRV English .. ONE workspace per business with five tabs: Overview, Production (tasks), Packages, Analytics, Avatars —
 *                         each tab is the app's existing screen, scoped to that business only
 *   Analytics ........... the cross-business analytics screen        Finance ........ the existing Finance screen
 *   Brain / Engineering / Integrations / Access-Settings ... the existing screens, shown on their own (no department-dashboard filler, no chip row that duplicates the sidebar)
 * It READS only (one packages read and one analytics read per business), writes nothing, calls no write action, and sends no credential.
 * There is no opt-in flag, no "classic navigation" switch and no second CEO homepage; rollback is a deployment rollback.
 */
(function () {
  'use strict';
  if (window.Home2) return;
  function isAdmin() { return typeof currentUser !== 'undefined' && !!currentUser && currentUser.id === 'admin'; }
  function authorized() { return isAdmin(); }
  function active() { return authorized(); }
  var _renderTab = window.renderTab;
  if (typeof _renderTab !== 'function') return;

  var BIZ = [['SRV Farsi', 'srv_farsi'], ['SRV English', 'srv_english']];   // CEO portfolio decision 2026-11-09: two retained businesses
  var CH = { 'SRV Farsi': /SRV Farsi|Silk Road/i, 'SRV English': /SRV English|Studio English/i };   // how each business is named on the analytics screen
  var SIDE = [
    ['home', 'Home'], ['biz:SRV Farsi', 'SRV Farsi'], ['biz:SRV English', 'SRV English'],
    ['analytics', 'Analytics'], ['finance', 'Finance'], ['engineering', 'Engineering'], ['integrations', 'Integrations'], ['settings', 'Access / Settings']
  ];
  var TABS = [['overview', 'Overview'], ['production', 'Production'], ['packages', 'Packages'], ['analytics', 'Analytics'], ['avatars', 'Avatars']];
  var AVKEY = { 'SRV Farsi': 'srv_farsi', 'SRV English': 'srv_english' };
  var S = { cur: 'home', biz: null, lastBiz: null, data: null, at: 0, loading: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function trunc(x, n) { x = String(x == null ? '' : x); return x.length > n ? x.slice(0, n - 1) + '…' : x; }
  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString('en-US'); }
  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function ago(t) { if (!t) return 'never'; var m = Math.round((Date.now() - new Date(t).getTime()) / 60000); if (isNaN(m)) return 'unknown'; if (m < 1) return 'just now'; return m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; }
  function ageDays(t) { var d = (Date.now() - new Date(t).getTime()) / 86400000; return isNaN(d) ? null : d; }
  function bizIndex(engine) { return BIZ.map(function (b) { return b[0]; }).indexOf(engine); }

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
      '#h2Side .sp{flex:1}',
      '@media(max-width:860px){#appScreen.show.h2-on{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto 1fr}',
      '#appScreen.h2-on>#h2Side{grid-column:1;grid-row:2;position:static;flex-direction:row;overflow-x:auto;min-height:0;border-right:0;border-bottom:1px solid var(--border);padding:6px;scrollbar-width:none}',
      '#h2Side button{white-space:nowrap;flex-shrink:0;padding:9px 11px}#h2Side .sp{display:none}#appScreen.h2-on>#mainContent{grid-column:1;grid-row:3}}',
      '.h2-wrap{font-family:"Syne",sans-serif;padding-bottom:30px}.h2-title{font-size:22px;font-weight:800;color:#fff;margin:2px 0 14px}',
      '.h2-lab{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--dim);font-family:"JetBrains Mono",monospace;text-transform:uppercase;margin:18px 0 8px}',
      '.h2-grid{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}@media(min-width:900px){.h2-grid.c2{grid-template-columns:repeat(2,minmax(0,1fr))}.h2-grid.c3{grid-template-columns:repeat(3,minmax(0,1fr))}.h2-grid.c4{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.h2-card{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:var(--radius);padding:14px;min-width:0}',
      '.h2-card.lnk{cursor:pointer}.h2-card.lnk:hover,.h2-card.lnk:focus{border-color:rgba(201,168,76,.5);background:rgba(201,168,76,.04);outline:0}',
      '.h2-card h3{margin:0 0 8px;font-size:15px;color:#fff;display:flex;align-items:center;gap:8px}',
      '.h2-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}',
      '.h2-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;color:#8b9cc4}.h2-kv:last-of-type{border-bottom:0}.h2-kv>span{flex-shrink:0;white-space:nowrap}.h2-kv b{color:#fff;text-align:right;min-width:0;overflow-wrap:anywhere}',
      '.h2-kv[data-h2]{cursor:pointer}.h2-kv[data-h2]:hover>span,.h2-kv[data-h2]:focus>span{color:var(--gold)}.h2-kv[data-h2]:focus{outline:0}',
      '.h2-btn{background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.4);color:var(--gold);border-radius:8px;padding:8px 13px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;margin-top:10px}',
      '.h2-big{font-size:20px;font-weight:800;color:#fff}.h2-sm{font-size:11px;color:var(--dim)}.h2-empty{font-size:12px;color:var(--dim);padding:6px 0}',
      '.h2-go{font-size:11px;color:var(--gold);font-weight:700;margin-top:6px}',
      '.h2-ws{font-family:"Syne",sans-serif;margin-bottom:14px}.h2-crumb{font-size:11px;color:var(--dim);margin-bottom:6px}.h2-crumb a{color:var(--gold);cursor:pointer;font-weight:700;text-decoration:none}',
      '.h2-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 4px;padding-bottom:10px;border-bottom:1px solid var(--border)}',
      '.h2-tabs button{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);color:var(--text);padding:7px 13px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}',
      '.h2-tabs button.on{background:rgba(201,168,76,.15);border-color:rgba(201,168,76,.45);color:var(--gold);font-weight:800}',
      '.h2-div{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--dim);font-family:"JetBrains Mono",monospace;text-transform:uppercase;margin:22px 0 10px;padding-top:14px;border-top:1px solid var(--border)}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------ chrome */
  function paintSide() {
    var el = $('h2Side'), app = $('appScreen'); if (!app) return;
    if (!el) { el = document.createElement('nav'); el.id = 'h2Side'; el.setAttribute('aria-label', 'Main'); app.insertBefore(el, $('mainContent')); }
    el.innerHTML = SIDE.map(function (s) { return '<button type="button" data-h2="' + s[0] + '" class="' + (S.cur === s[0] ? 'on' : '') + '"' + (S.cur === s[0] ? ' aria-current="page"' : '') + '>' + esc(s[1]) + '</button>'; }).join('') +
      '<div class="sp"></div>';
    app.classList.add('h2-on');
  }
  function scrub() {
    var el = $('h2Side'); if (el && el.parentNode) el.parentNode.removeChild(el);
    var app = $('appScreen'); if (app) app.classList.remove('h2-on');
  }
  function paintMain(html) { var c = $('mainContent'); if (c) c.innerHTML = html; }

  /* which sidebar item owns each router tab / system sub-tab (so the highlight always matches what is on screen) */
  function sysOwner(sub) { return { settings: 'settings', integrations: 'integrations', engineering: 'engineering', brain_validation: 'engineering' }[sub] || 'engineering'; }
  function curFor(tab) {
    if (S.biz && (tab === 'tasks' || tab === 'packages' || tab === 'analytics')) return 'biz:' + S.biz;
    if (tab === 'analytics' || tab === 'content' || tab === 'engines') return 'analytics';
    if (tab === 'finance' || tab === 'integrations' || tab === 'settings') return tab;
    if (tab === 'system') return sysOwner(typeof currentSystemSub !== 'undefined' ? currentSystemSub : 'engineering');
    return null;
  }

  /* ------------------------------------------------------------ business workspaces */
  function wsHeader(engine, tab) {
    return '<div class="h2-ws" id="h2Ws"><div class="h2-crumb"><a data-h2="home" role="link" tabindex="0">← Home</a> › ' + esc(engine) + ' › ' + esc((TABS.filter(function (t) { return t[0] === tab; })[0] || ['', ''])[1]) + '</div>' +
      '<div class="h2-title" style="margin-bottom:6px">' + esc(engine) + '</div>' +
      '<div class="h2-tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-h2="ws:' + esc(engine) + ':' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '"' + (t[0] === tab ? ' aria-selected="true"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div></div>';
  }
  function openWs(engine, tab) {
    if (bizIndex(engine) < 0) return go('home');
    tab = TABS.some(function (t) { return t[0] === tab; }) ? tab : 'overview';
    S.biz = engine; S.lastBiz = engine; S.wsTab = tab; S.cur = 'biz:' + engine;
    try { window.pkgFilterEngine = tab === 'packages' ? engine : ''; } catch (e) { /* ignore */ }
    try { if (tab === 'packages') viewingPackageId = null; } catch (e) { /* ignore */ }
    paintSide();
    if (tab === 'overview') { paintMain(wsHeader(engine, tab) + overviewPage(engine)); load(function () { if (S.biz === engine && S.wsTab === 'overview' && active()) paintMain(wsHeader(engine, tab) + overviewPage(engine)); }); return; }
    if (tab === 'avatars') {   // avatar library manager (avatar-library.js): add / upload / replace / remove, per business
      window._analyticsScope = '';
      paintMain(wsHeader(engine, tab) + '<div class="h2-wrap"><div id="h2AvBody"></div></div>');
      if (window.AvatarLibrary) window.AvatarLibrary.mount($('h2AvBody'), AVKEY[engine]); else $('h2AvBody').innerHTML = '<div class="h2-empty">The avatar library is not available.</div>';
      return;
    }
    var legacyTab = tab === 'production' ? 'tasks' : tab;
    window.renderTab(legacyTab);
  }
  /* scoping of the existing screens to ONE business. Analytics is scoped where its rows are built (window._analyticsScope, see renderEngineAnalytics);
     Packages through its own engine filter; Production (tasks) by hiding the other business's panel. */
  function scopeTasks(engine) {
    var c = $('mainContent'); if (!c) return;
    var other = BIZ.filter(function (b) { return b[0] !== engine; }).map(function (b) { return b[0].toUpperCase(); });
    var op = null;
    [].slice.call(c.children).forEach(function (el) { if (!op && /OPERATOR MODE/.test(el.innerText || '') && !el.classList.contains('h2-ws')) op = el; });
    if (op) {
      [].slice.call(op.querySelectorAll('.card')).forEach(function (card) { var head = (card.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40).toUpperCase(); if (other.some(function (n) { return head.indexOf(n) >= 0; })) card.style.display = 'none'; });
    }
    var planner = [];
    [].slice.call(c.children).forEach(function (el) {
      if (el === op || el.id === 'h2Ws') return;
      var head = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40).toUpperCase();
      if (/^CURRENT TASK/.test(head) || /^OPERATOR PROGRESS/.test(head)) { el.style.display = 'none'; return; }   // generic slots that count both businesses
      planner.push(el);
    });
    var ws = $('h2Ws');
    if (op && ws && ws.nextSibling !== op) c.insertBefore(op, ws.nextSibling);   // the business's own production panel first
    if (planner.length) { var d = document.createElement('div'); d.className = 'h2-div'; d.textContent = 'Shared planner and test controls — both businesses'; c.insertBefore(d, planner[0]); }
  }
  function scopePackages() {
    var el = $('pkgList'); if (!el) return;
    var sel = el.querySelector('select'); if (sel && /engine/i.test((sel.innerText || '') + (sel.options && sel.options[0] ? sel.options[0].text : ''))) sel.style.display = 'none';   // the engine filter would let the other business back in
    [].slice.call(el.querySelectorAll('button')).forEach(function (b) { if (/clear/i.test(b.innerText || '')) b.style.display = 'none'; });
  }

  /* ------------------------------------------------------------ navigation */
  function go(id) {
    if (id === 'home') { S.biz = null; window.renderTab('home'); return; }
    if (id.indexOf('biz:') === 0) return openWs(id.slice(4), 'overview');
    if (id.indexOf('ws:') === 0) { var p = id.split(':'); return openWs(p[1], p[2]); }
    S.biz = null; try { window.pkgFilterEngine = ''; } catch (e) { /* ignore */ }
    if (id === 'analytics') { window.renderTab('analytics'); return; }
    if (id === 'finance') { window.renderTab('finance'); return; }
    var sub = { engineering: 'engineering', integrations: 'integrations', settings: 'settings' }[id];
    if (sub) { window.renderTab('system'); window.setSystemSub(sub); return; }
    window.renderTab(id);
  }

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
    return d == null ? ['#6b7280', 'No analytics synced yet'] : d <= 3 ? ['#22c55e', 'Connected · last sync ' + ago(e.lastSync)] : ['#f59e0b', 'Needs attention · last sync ' + ago(e.lastSync)];
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
  function facts(i) {
    var b = BIZ[i], px = S.data && S.data.pkg[i], p = px && px.row, h = health(b[0]), e = S.data && S.data.yt[b[0]] && S.data.yt[b[0]].ok ? S.data.yt[b[0]] : null, t = openTasks(b[0]);
    return {
      b: b, px: px, p: p, h: h, e: e, t: t,
      next: t.length ? esc(trunc(t[0].name || t[0].title || 'Open task', 44)) + ' · ' + esc(t[0].status || '') + (t.length > 1 ? ' (+' + (t.length - 1) + ')' : '') : 'Nothing waiting',
      last: p ? esc(trunc(p.title || ('#' + p.id), 48)) : (S.data ? (px && px.ok ? 'None yet' : 'Could not load') : 'Loading…'),
      views: e && e.videos ? Number(e.views).toLocaleString() : '—', subs: e && e.videos ? '+' + Number(e.subs).toLocaleString() : '—'
    };
  }
  function row(label, value, dest) { return '<div class="h2-kv"' + (dest ? ' data-h2="' + esc(dest) + '" role="link" tabindex="0"' : '') + '><span>' + esc(label) + '</span><b>' + value + '</b></div>'; }
  function bizCard(i) {
    var f = facts(i), n = f.b[0];
    return '<div class="h2-card"><h3><span class="h2-dot" style="background:' + f.h[0] + '"></span>' + esc(n) + '</h3>' +
      row('Last package', f.last, 'ws:' + n + ':packages') + row('Stage', esc(stage(f.px)), 'ws:' + n + ':packages') + row('Next action', f.next, 'ws:' + n + ':production') +
      row('YouTube', esc(f.h[1]), 'ws:' + n + ':analytics') + row('Views (all synced videos)', f.views, 'ws:' + n + ':analytics') + row('Subscribers gained (from videos)', f.subs, 'ws:' + n + ':analytics') +
      '<button type="button" class="h2-btn" data-h2="biz:' + esc(n) + '">Open ' + esc(n) + '</button></div>';
  }
  function moneyStrip() {
    var F = safe(function () { return computeFinanceState(); }, null);
    if (!F) return '<div class="h2-empty">Finance data unavailable.</div>';
    var src = safe(function () { return D.plaidConnected ? 'Source: linked bank accounts' : 'Source: entries in Finance'; }, '');
    var lnk = function (inner) { return '<div class="h2-card lnk" data-h2="finance" role="link" tabindex="0">' + inner + '<div class="h2-go">Open Finance →</div></div>'; };
    var an = BIZ.map(function (b, i) { var f = facts(i); return '<div class="h2-kv"><span>' + esc(b[0]) + '</span><b>' + f.views + ' views · ' + f.subs + ' subs</b></div>'; }).join('');
    return '<div class="h2-grid c4">' +
      lnk('<div class="h2-sm">Monthly income</div><div class="h2-big">' + money(F.incomeTotal) + '</div>') +
      lnk('<div class="h2-sm">Monthly spend</div><div class="h2-big">' + money(F.expenseTotal) + '</div>') +
      lnk('<div class="h2-sm">Net per month (income minus spend)</div><div class="h2-big">' + money((F.incomeTotal || 0) - (F.expenseTotal || 0)) + '</div><div class="h2-sm">' + esc(src) + '</div>') +
      '<div class="h2-card lnk" data-h2="analytics" role="link" tabindex="0"><div class="h2-sm" style="margin-bottom:4px">Analytics (all synced videos)</div>' + an + '<div class="h2-go">Open Analytics →</div></div></div>';
  }
  function homePage() {
    return '<div class="h2-wrap"><div class="h2-title">Home</div>' +
      '<div class="h2-lab">Your two businesses</div><div class="h2-grid c2">' + bizCard(0) + bizCard(1) + '</div>' +
      '<div class="h2-lab">Finance and analytics</div>' + moneyStrip() + '</div>';
  }
  function overviewPage(engine) {
    var i = bizIndex(engine), f = facts(i), n = engine;
    var lnk = function (title, line, dest) { return '<div class="h2-card lnk" data-h2="' + esc(dest) + '" role="link" tabindex="0"><h3>' + esc(title) + '</h3><div class="h2-sm">' + line + '</div><div class="h2-go">Open ' + esc(title) + ' →</div></div>'; };
    return '<div class="h2-wrap"><div class="h2-grid c2"><div class="h2-card"><h3><span class="h2-dot" style="background:' + f.h[0] + '"></span>' + esc(n) + ' — status</h3>' +
      row('Last package', f.last) + row('Stage', esc(stage(f.px))) + row('Next action', f.next) + row('YouTube', esc(f.h[1])) + row('Views (all synced videos)', f.views) + row('Subscribers gained (from videos)', f.subs) + '</div>' +
      '<div class="h2-grid" style="grid-template-columns:minmax(0,1fr)">' +
      lnk('Production', f.t.length ? f.t.length + ' open task' + (f.t.length > 1 ? 's' : '') + ' · next: ' + f.next : 'No open tasks', 'ws:' + n + ':production') +
      lnk('Packages', 'Package history for ' + esc(n) + ' only', 'ws:' + n + ':packages') +
      lnk('Analytics', esc(n) + ' channel only · ' + f.views + ' views', 'ws:' + n + ':analytics') +
      lnk('Avatars', 'Add, upload, replace or remove ' + esc(n) + ' avatar photos', 'ws:' + n + ':avatars') + '</div></div></div>';
  }

  /* ------------------------------------------------------------ router hook */
  var KNOWN = ['home', 'finance', 'tasks', 'engines', 'marketing', 'human_resources', 'legal_compliance', 'system', 'analytics', 'content', 'packages', 'integrations', 'factory', 'continuity', 'settings'];
  window.renderTab = function (tab) {
    if (active() && KNOWN.indexOf(tab) < 0) tab = 'home';
    if (!active()) { var r0 = _renderTab.apply(this, arguments); if (!authorized()) scrub(); return r0; }
    if (tab === 'home') {
      if (typeof currentTab !== 'undefined') currentTab = 'home';
      S.biz = null; S.cur = 'home'; style(); paintSide(); paintMain(homePage()); load(function () { if (S.cur === 'home' && active()) paintMain(homePage()); });
      return;
    }
    // the shared Tasks/Packages screens carry both businesses: only ever open them inside a business workspace
    if ((tab === 'tasks' || tab === 'packages') && !S.biz) { return openWs(S.lastBiz || BIZ[0][0], tab === 'tasks' ? 'production' : 'packages'); }
    if (tab === 'engines') { tab = 'analytics'; S.biz = null; }   // the Operations overview repeated Home; its Analytics/Packages tabs now live in Analytics and the business workspaces
    if (tab !== 'tasks' && tab !== 'packages' && tab !== 'analytics') S.biz = null;
    window._analyticsScope = (S.biz && tab === 'analytics') ? S.biz : '';
    var r = _renderTab.apply(this, [tab].concat([].slice.call(arguments, 1)));
    if (S.biz && (tab === 'tasks' || tab === 'packages' || tab === 'analytics')) {
      var c = $('mainContent');
      if (c) { c.insertAdjacentHTML('afterbegin', wsHeader(S.biz, tab === 'tasks' ? 'production' : tab)); S.wsTab = tab === 'tasks' ? 'production' : tab; }
      if (tab === 'tasks') scopeTasks(S.biz); else if (tab === 'packages') scopePackages();
    }
    var cur = curFor(tab); S.cur = cur; style(); paintSide();
    return r;
  };
  /* Sub-tab changes made by the screens' own buttons (and the business-scoping above) must keep the sidebar highlight truthful */
  var _setSys = window.setSystemSub;
  if (typeof _setSys === 'function') window.setSystemSub = function (sub) { var r = _setSys.apply(this, arguments); if (active()) { S.biz = null; S.cur = sysOwner(sub); paintSide(); } return r; };
  var _loadPk = window.loadAndShowPackages;
  if (typeof _loadPk === 'function') window.loadAndShowPackages = function () { var r = _loadPk.apply(this, arguments); Promise.resolve(r).then(function () { if (active() && S.biz) scopePackages(); }); return r; };
  /* Admin: Finance, and the Technology sections, show their own content only — the department-dashboard header (placeholder mission / manager / SOP rows) and the sub-tab chip row that repeated the sidebar are not shown */
  var _fin = window.renderFinanceWithDept;
  if (typeof _fin === 'function' && typeof window.renderFinance === 'function') window.renderFinanceWithDept = function () { return active() ? window.renderFinance() : _fin.apply(this, arguments); };
  var _sys = window.renderSystemShell;
  if (typeof _sys === 'function') window.renderSystemShell = function () {
    if (!active()) return _sys.apply(this, arguments);
    var cur = typeof currentSystemSub !== 'undefined' ? currentSystemSub : 'engineering', body = '';
    try {
      if (cur === 'settings' && typeof renderSettings === 'function') body = renderSettings();
      else if (cur === 'integrations' && typeof renderIntegrations === 'function') body = renderIntegrations();
      else if (cur === 'factory' && typeof renderFactory === 'function') body = renderFactory();
      else if (cur === 'continuity' && typeof renderContinuity === 'function') body = renderContinuity();
      else if (cur === 'engineering' && typeof renderEngineeringBrain === 'function') body = renderEngineeringBrain();
      else if (cur === 'brain_validation' && typeof renderBrainValidation === 'function') body = renderBrainValidation();
    } catch (e) { body = '<div style="color:#ef4444;padding:12px">Render error in ' + esc(cur) + ': ' + esc(e.message) + '</div>'; }
    return body || _sys.apply(this, arguments);
  };
  /* The app's own saveAppState() ends in syncState(), which writes the LEGACY Home straight into #mainContent (it bypasses the router).
     For the Admin that would bring the old dashboard back after the first save, so it repaints the new Home instead. Other roles: untouched. */
  var _syncState = window.syncState;
  if (typeof _syncState === 'function') {
    window.syncState = function () {
      if (active() && typeof currentTab !== 'undefined' && currentTab === 'home' && $('mainContent')) { paintMain(homePage()); return; }
      return _syncState.apply(this, arguments);
    };
  }
  function activate(ev, t) {
    if (!t || !active()) return;
    var id = t.getAttribute('data-h2'); if (!id) return;
    if (ev) ev.preventDefault();
    go(id);
  }
  document.addEventListener('click', function (ev) { activate(ev, ev.target && ev.target.closest && ev.target.closest('[data-h2]')); });
  document.addEventListener('keydown', function (ev) { if (ev.key !== 'Enter' && ev.key !== ' ') return; var t = ev.target && ev.target.closest && ev.target.closest('[data-h2][role="link"]'); if (t && t.tagName !== 'BUTTON') activate(ev, t); });
  var app = $('appScreen');
  if (app && window.MutationObserver) new MutationObserver(function () { if (!app.classList.contains('show') || !authorized()) { if ($('h2Side') || app.classList.contains('h2-on')) scrub(); } }).observe(app, { attributes: true, attributeFilter: ['class'] });
  window.Home2 = { active: active, go: go };
  style();
  if (active() && $('appScreen') && $('appScreen').classList.contains('show')) window.renderTab('home');
})();
