/* MMMOS — CEO homepage and navigation (blueprint CEO_017_SIMPLIFIED_INTERFACE.md). DEFAULT for the Admin (CEO decisions 2026-11-10).
 *
 * Loaded for every session but acts ONLY for the Admin; Family and VA never see it (this file then only passes every call through).
 * One authoritative destination per function:
 *   Home ................ the two businesses + finance and analytics summaries (every card/row links to its destination)
 *   Silk Road Voices (identifier SRV Farsi) / SRV Studio (identifier SRV English) .. ONE workspace per business with five tabs: Overview, Production (tasks), Packages, Analytics, Avatars —
 *                         each tab is the app's existing screen, scoped to that business only
 *   Investment .......... its own business page (Finance V2 3B): verified data only, isolated from the music businesses
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
  // CEO-facing display names ONLY. Stored identifiers, engine keys, package/task/analytics queries and channel mappings keep their existing values (the music business is still engine 'SRV English' / srv_english).
  // CEO decision (PM correction order, Phase 3B): 'Silk Road Voices' is the CEO-facing name for SRV Farsi. Display only — the engine key 'SRV Farsi', srv_farsi, silk_road_voices, channel titles and published text are unchanged.
  var DISPLAY = { 'SRV Farsi': 'Silk Road Voices', 'SRV English': 'SRV Studio' };
  function dn(name) { return DISPLAY[name] || name; }
  var SIDE = [
    ['home', 'Home'], ['biz:SRV Farsi', dn('SRV Farsi')], ['biz:SRV English', dn('SRV English')], ['invest', 'Investment'],
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
      '.h2-div{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--dim);font-family:"JetBrains Mono",monospace;text-transform:uppercase;margin:22px 0 10px;padding-top:14px;border-top:1px solid var(--border)}',
      '.h2d-stack{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}',
      '.h2d{background:rgba(255,255,255,.025);border:1px solid var(--border);border-radius:var(--radius);padding:16px;min-width:0;font-family:"Syne",sans-serif;color:var(--text)}',
      '.h2d-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.h2d-h h3{margin:0;font-size:19px;color:#fff}',
      '.h2d-pill{border:1px solid;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:800;letter-spacing:.5px}',
      '.h2d-fresh{display:flex;gap:6px 18px;flex-wrap:wrap;font-size:12px;color:var(--dim);margin:6px 0 2px}.h2d-fresh b{color:#fff}',
      '.h2d-why{font-size:14px;color:#fff;margin:8px 0 4px;line-height:1.45}',
      '.h2d-sm{font-size:11px;color:var(--dim);line-height:1.4}.h2d-na{font-size:12px;color:var(--dim);padding:4px 0}',
      '.h2d-warn{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);color:#fbbf24;border-radius:8px;padding:8px 10px;font-size:12px;margin:8px 0}',
      '.h2d-tiles{display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr));margin:10px 0}@media(min-width:900px){.h2d-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.h2d-t{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:10px;min-width:0}',
      '.h2d-l{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--dim);font-weight:700}.h2d-v{font-size:24px;font-weight:800;color:#fff;margin:2px 0}.h2d-mute{color:#9aa4bd}.h2d-s{font-size:12px;color:#c3cde6}',
      '.h2d-d{font-weight:800}.h2d-d.up{color:#22c55e}.h2d-d.dn{color:#ef4444}',
      '.h2d-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:#222;margin:6px 0}.h2d-bar i{background:#34d399;display:block}.h2d-bar b{background:#f59e0b;display:block}',
      '.h2d-sec{font-size:10px;font-weight:700;letter-spacing:1.3px;color:var(--dim);font-family:"JetBrains Mono",monospace;text-transform:uppercase;margin:14px 0 6px}',
      '.h2d-cols{display:grid;gap:14px;grid-template-columns:minmax(0,1fr)}@media(min-width:760px){.h2d-cols{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.h2d-li{display:flex;flex-direction:column;gap:1px;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;color:#fff}.h2d-li em{font-style:normal;font-size:11px;color:var(--dim)}',
      '.h2d-ret{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:#c3cde6}.h2d-ret b{color:#fff}.h2d-ret i{color:var(--dim);font-style:normal}',
      '.h2d-money{display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}@media(min-width:760px){.h2d-money{grid-template-columns:repeat(2,minmax(0,1fr))}}.h2d-money>div{background:rgba(255,255,255,.03);border:1px dashed var(--border);border-radius:8px;padding:8px 10px;font-size:12px;color:#fff}',
      '.h2d-recs{list-style:none;margin:0;padding:0;display:grid;gap:10px}.h2d-rec{border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;padding:10px;background:rgba(255,255,255,.02)}',
      '.h2d-rt{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:#fff}.h2d-chip{border:1px solid;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:800;flex-shrink:0;margin-top:2px}',
      '.h2d-ra{font-size:13px;color:#e5e9f7;margin:6px 0 2px}.h2d-ra span{color:var(--gold);font-weight:800}',
      '.h2d details summary{cursor:pointer;font-size:11px;color:var(--dim)}.h2d-ev{font-size:11px;color:#9aa4bd;line-height:1.5;margin-top:4px}',
      '.h2d-ops{display:flex;gap:6px 20px;flex-wrap:wrap;font-size:12px;color:var(--dim);margin-top:14px;padding-top:10px;border-top:1px solid var(--border)}.h2d-ops b{color:#fff}',
      '.h2d-lim{margin-top:10px}.h2d-lim ul{margin:6px 0 0;padding-left:18px;font-size:11px;color:#9aa4bd;line-height:1.5}',
      '.h2d-btns{display:flex;gap:8px;flex-wrap:wrap}.h2d .h2d-tt{unicode-bidi:plaintext;text-align:left}',
      '.h2d-sum{display:grid;gap:10px;grid-template-columns:repeat(3,minmax(0,1fr));margin:10px 0 8px}@media(max-width:640px){.h2d-act>div{flex-direction:column;gap:2px;align-items:flex-start}.h2d-k{min-width:0}.h2d-sum{grid-template-columns:repeat(2,minmax(0,1fr))}.h2d-sum .h2d-st:first-child{grid-column:1/-1}}',
      '.h2d-st{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:9px 11px;min-width:0}.h2d-st .h2d-v{font-size:26px;line-height:1.1}.h2d-st .h2d-v small{font-size:11px;color:var(--dim);font-weight:600}.h2d-st .h2d-s{font-size:11px;color:#c3cde6;display:flex;flex-direction:column;gap:2px}',
      '.h2d-act{display:grid;gap:5px;margin:8px 0;padding:10px 12px;border:1px solid rgba(201,168,76,.35);border-left:3px solid var(--gold);border-radius:8px;background:rgba(201,168,76,.05)}.h2d-act>div{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:14px;color:#fff}.h2d-act b{font-weight:700}',
      '.h2d-k{font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--gold);font-weight:800;min-width:92px;font-family:"JetBrains Mono",monospace}.h2d-adv{font-size:10px;color:var(--dim)}',
      '.h2d-obs{font-size:11px;color:#9aa4bd;line-height:1.45;margin:2px 0}.h2d-obs b{color:#c3cde6}.h2d-cav{font-size:11px;color:#fbbf24;margin:3px 0}',
      '.h2d-meta{display:flex;gap:4px 16px;flex-wrap:wrap;font-size:11px;color:var(--dim);margin:6px 0 4px}.h2d-meta b{color:#fff}.h2d-stale{color:#fbbf24;font-weight:700}',
      '.h2d-more{margin-top:12px;border-top:1px solid var(--border);padding-top:8px}.h2d-more>summary{cursor:pointer;font-size:12px;color:var(--gold);font-weight:700}'
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
    return '<div class="h2-ws" id="h2Ws"><div class="h2-crumb"><a data-h2="home" role="link" tabindex="0">← Home</a> › ' + esc(dn(engine)) + ' › ' + esc((TABS.filter(function (t) { return t[0] === tab; })[0] || ['', ''])[1]) + '</div>' +
      '<div class="h2-title" style="margin-bottom:6px">' + esc(dn(engine)) + '</div>' +
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
    if (id === 'invest') return openInvest('overview');
    if (id.indexOf('inv:') === 0) return openInvest(id.slice(4));
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
  function load(done0) {
    // Home also needs the household import status (verified / pending months) — one CEO-only read, once; Home repaints when it arrives
    var done = function () {
      var f = window._finImpLoad, st = window._finImp, g = window._finSnapLoad, sn = window._finSnap, ps = [];
      if (typeof f === 'function' && st && !st.loaded && !st.loading) ps.push(f());
      if (typeof g === 'function' && sn && !sn.loaded && !sn.loading) ps.push(g());   // CEO-attested Rocket Money figures (one CEO-only read)
      if (ps.length) Promise.all(ps.map(function (x) { return Promise.resolve(x).catch(function () { return null; }); })).then(function () { done0(); }); else done0();
    };
    loadHome(done0);   // CEO dashboard cards (own request; Home repaints when it arrives)
    if (S.loading) return;
    if (S.data && Date.now() - S.at < 60000) { done(); return; }
    S.loading = true;
    var pk = BIZ.map(function (b) { return rest('packages?engine=eq.' + encodeURIComponent(b[0]) + '&select=id,title,created_at,published_at,youtube_video_id,full_package&order=created_at.desc&limit=1'); });
    // per-channel totals are read per channel: the app's shared analytics loader caps at 200 rows across ALL channels and so understates a business
    Promise.all([Promise.all(pk), rest('youtube_channels?select=channel_id,mmm_engine&mmm_engine=not.is.null')]).then(function (r) {
      var chans = r[1].rows, yt = {};
      // The corrected analytics rules live in ONE place (/growth/growthAnalytics.mjs, also used by the detailed Analytics screen): the numbers below are the
      // latest Analytics window of that business's own channel (older windows are never added in), so Home and the detailed screen always agree.
      var GM = import('/growth/growthAnalytics.mjs').catch(function () { return null; });
      return Promise.all(BIZ.map(function (b) {
        var ch = chans.filter(function (c) { return c.mmm_engine === b[0]; })[0];
        if (!ch) { yt[b[0]] = { ok: r[1].ok, channel: false }; return null; }
        return Promise.all([GM, rest('youtube_videos_analytics?channel_id=eq.' + encodeURIComponent(ch.channel_id) + '&analytics_synced_at=not.is.null&select=channel_id,video_id,title,views,watch_time_min,subs_gained,analytics_synced_at,synced_at&limit=1000')]).then(function (x) {
          var G = x[0], a = x[1], last = null;
          a.rows.forEach(function (r0) { if (r0.analytics_synced_at && (!last || r0.analytics_synced_at > last)) last = r0.analytics_synced_at; });
          var biz = G && Object.keys(G.GROWTH_BUSINESSES).map(function (k) { return G.GROWTH_BUSINESSES[k]; }).filter(function (q) { return q.channelId === ch.channel_id; })[0];
          var ws = null; try { if (G && biz && a.ok) ws = G.buildWorkspace(a.rows.map(G.normaliseRow), { business: biz }); } catch (e) { ws = null; }
          // no corrected figure available (module or data missing) => show "—", never a legacy sum
          yt[b[0]] = { ok: a.ok, channel: true, videos: ws ? ws.rows.inWindow : 0, views: ws ? ws.metrics.views_window.value : null, subs: ws ? ws.metrics.subs_attributed_window.value : null,
            lastSync: last, periodTo: ws && ws.period ? ws.period.to : null, periodDays: ws && ws.period ? ws.period.days : null, partial: !!(ws && ws.metrics.views_window.status === 'partial') };
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
      views: e && e.videos && e.views !== null ? Number(e.views).toLocaleString() + (e.partial ? ' (partial)' : '') : '—', subs: e && e.videos && e.subs !== null ? '+' + Number(e.subs).toLocaleString() : '—',
      win: e && e.periodTo ? e.periodDays + '-day window to ' + e.periodTo : 'latest analytics window'
    };
  }
  function row(label, value, dest) { return '<div class="h2-kv"' + (dest ? ' data-h2="' + esc(dest) + '" role="link" tabindex="0"' : '') + '><span>' + esc(label) + '</span><b>' + value + '</b></div>'; }
  function bizCard(i) {
    var f = facts(i), n = f.b[0];
    return '<div class="h2-card"><h3><span class="h2-dot" style="background:' + f.h[0] + '"></span>' + esc(dn(n)) + '</h3>' +
      row('Last package', f.last, 'ws:' + n + ':packages') + row('Stage', esc(stage(f.px)), 'ws:' + n + ':packages') + row('Next action', f.next, 'ws:' + n + ':production') +
      row('YouTube', esc(f.h[1]), 'ws:' + n + ':analytics') + row('Views (' + f.win + ')', f.views, 'ws:' + n + ':analytics') + row('Subscribers gained (from videos, same window)', f.subs, 'ws:' + n + ':analytics') +
      '<button type="button" class="h2-btn" data-h2="biz:' + esc(n) + '">Open ' + esc(dn(n)) + '</button></div>';
  }
  /* Finance V2 phase 3B — VERIFIED DATA ONLY. A figure is shown only when its source, reporting period and verification status are known (public/finance/finVerified.js);
     otherwise the tile says "No verified data" with the reason, never 0. Stored entries are preserved in the database and simply not displayed. Display only: nothing here writes, saves or recalculates anything. */
  function finCtx() { return safe(function () { var c = window.FinSrc ? window.FinSrc.buildCtx(D, Date.now()) : null; if (c && window.FinVerified) { window.FinVerified.withImports(c, window._finImp && window._finImp.status); window.FinVerified.withSnapshots(c, window._finSnap && window._finSnap.status); } return c; }, null); }   // import months (CEO-verified or pending) travel with the context
  function FV() { return window.FinVerified; }
  function nv(key) { return safe(function () { var c = finCtx(); return c && FV() ? FV().nvHtml(key, c) : '<span>No verified data</span>'; }, '<span>No verified data</span>'); }
  function verifiedFigure(key, fmt) { return safe(function () { var c = finCtx(); if (!c || !FV()) return nv(key); return FV().show(key, c, function () { return esc(fmt()); }); }, nv(key)); }
  function moneyStrip() {
    var lnk = function (inner) { return '<div class="h2-card lnk" data-h2="finance" role="link" tabindex="0">' + inner + '<div class="h2-go">Open Finance →</div></div>'; };
    var an = BIZ.map(function (b, i) { var f = facts(i); return '<div class="h2-kv"><span>' + esc(dn(b[0])) + '</span><b>' + f.views + ' views · ' + f.subs + ' subs</b></div>'; }).join('');
    var F = function () { return computeFinanceState(); };
    return '<div class="h2-grid c4">' +
      lnk('<div class="h2-sm">Household income</div><div class="h2-big">' + verifiedFigure('income', function () { return money(F().incomeTotal); }) + '</div>') +
      lnk('<div class="h2-sm">Household spending</div><div class="h2-big">' + verifiedFigure('expenses', function () { return money(F().expenseTotal); }) + '</div>') +
      lnk('<div class="h2-sm">Net (income minus spending)</div><div class="h2-big">' + verifiedFigure('cashflow', function () { return money(F().cashflow); }) + '</div>') +
      '<div class="h2-card lnk" data-h2="analytics" role="link" tabindex="0"><div class="h2-sm" style="margin-bottom:4px">Analytics (latest analytics window)</div>' + an + '<div class="h2-go">Open Analytics →</div></div></div>';
  }
  /* Goals are OPTIONAL targets. A target appears only after the CEO has set it; a default that shipped with the app is never shown as approved. Current values follow the same verified-only rule. */
  function goalsCard() {
    var c = finCtx();
    if (!c || !FV()) return '<div class="h2-card" id="h2Goals"><h3>Goals — optional targets</h3><div class="h2-empty">No verified data.</div></div>';
    return '<div class="h2-card lnk" data-h2="finance" role="link" tabindex="0" id="h2Goals"><h3>Goals — optional targets</h3>' + FV().goalRows(c, {}) + '<div class="h2-go">Open Finance →</div></div>';
  }
  /* Investment — its own business (sidebar and page); on Home it is a card beside the two music businesses. Value and performance follow the verified-only rule; nothing is typed-in or reconstructed. */
  function investCard() {
    var c = finCtx(), src = c && FV() ? FV().sources(c, null, Date.now()).filter(function (r) { return r.id === 'robinhood'; })[0] : null;
    return '<div class="h2-card" id="h2Invest"><h3><span class="h2-dot" style="background:#6b7280"></span>Investment</h3>' +
      row('Value', nv('investmentValue').split('<div')[0]) + row('Market gain / loss (not income)', nv('investmentGain').split('<div')[0]) + row('Data source', esc(src ? src.state === 'unavailable' ? 'Not connected' : src.state : 'Not connected'), 'inv:connection') +
      '<div class="h2-sm" style="margin-top:6px">Separate from the music businesses. Performance is never business revenue or household income.</div>' +
      '<button type="button" class="h2-btn" data-h2="invest">Open Investment</button></div>';
  }
  /* SRV Circle Advisors — placeholder only. No record of this business exists in the system yet, so nothing about it (status, revenue, activity) is shown or invented. */
  function circleCard() {
    return '<div class="h2-card" id="h2Circle"><h3><span class="h2-dot" style="background:#6b7280"></span>SRV Circle Advisors</h3>' +
      '<div class="h2-sm"><b>Unconfigured</b> — the business identity is not confirmed yet.</div>' +
      '<div class="h2-empty">No status, revenue or activity is shown: nothing is connected and no record exists for this business.</div></div>';
  }
  /* ------------------------------------------------------------ CEO business dashboard (G2): one card per music business, built by the server (api/ops.js growth_report {home:true} → lib/homeInsights.mjs).
     Display only. A figure is shown only when it was collected; otherwise the card says "Not available" and names the work required. Total views are never labelled organic. */
  var HBIZ = { silk_road_voices: 'SRV Farsi', srv_studio: 'SRV English' };
  var H = { at: 0, loading: false, cards: null, err: null };
  function loadHome(cb) {
    if (H.loading) return; if (H.cards && Date.now() - H.at < 60000) return;
    var tok = ''; try { tok = (typeof _ceoGetSessionToken === 'function' && _ceoGetSessionToken()) || ''; } catch (e) { tok = ''; }
    if (!tok) { H.err = 'no_session'; return; }
    H.loading = true;
    fetch('/api/ops?action=growth_report', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MMM-CEO-Session': tok }, body: JSON.stringify({ home: true }) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http_' + r.status)); })
      .then(function (j) { var m = {}; (j.reports || []).forEach(function (x) { if (x && x.business) m[x.business] = x.home_card || { state: 'unavailable', business: x.business, reason: 'The report could not be built.' }; }); H.cards = m; H.err = null; H.at = Date.now(); })
      .catch(function (e) { H.err = String(e && e.message || e).slice(0, 40); })
      .then(function () { H.loading = false; try { cb && cb(); } catch (e) { } });
  }
  function tsMs(t) { if (!t) return NaN; var s = String(t).replace(' ', 'T'); if (/[+-]\d\d$/.test(s)) s += ':00'; return Date.parse(s); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dShort(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : '—'; }
  function dTime(t) { var ms = tsMs(t); if (isNaN(ms)) return '—'; var d = new Date(ms); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ' UTC'; }
  function n0(x) { return x === null || x === undefined || isNaN(x) ? '—' : Math.round(x).toLocaleString('en-US'); }
  function sgn(x) { return x === null || x === undefined ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toLocaleString('en-US'); }
  function pct(x) { return x === null || x === undefined ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x) + '%'; }
  function dur(sec) { return sec === null || sec === undefined ? '—' : sec >= 60 ? Math.floor(sec / 60) + 'm ' + ('0' + Math.round(sec % 60)).slice(-2) + 's' : Math.round(sec) + 's'; }
  var PILL = { growing: ['#22c55e', '▲'], declining: ['#ef4444', '▼'], flat: ['#eab308', '■'], reset: ['#60a5fa', '◆'], unknown: ['#9ca3af', '?'] };
  function spark(tr) {
    if (!tr || !tr.length) return '';
    var mx = Math.max.apply(null, tr.map(function (t) { return t.views || 0; })) || 1, w = 26, g = 8, H0 = 54, out = '';
    tr.forEach(function (t, i) {
      var x = 4 + i * (w + g), tot = Math.max(1, Math.round((t.views || 0) / mx * H0)), org = t.organic === null || t.organic === undefined ? tot : Math.round(t.organic / mx * H0), paid = tot - org;
      out += '<rect x="' + x + '" y="' + (H0 - org + 4) + '" width="' + w + '" height="' + Math.max(org, t.views ? 1 : 0) + '" fill="#34d399"><title>' + esc(dShort(t.from) + ' – ' + dShort(t.to) + ': ' + n0(t.views) + ' views (' + n0(t.organic) + ' organic, ' + n0(t.paid) + ' paid)') + '</title></rect>';
      if (paid > 0) out += '<rect x="' + x + '" y="' + (H0 - tot + 4) + '" width="' + w + '" height="' + paid + '" fill="#f59e0b"><title>' + esc(dShort(t.from) + ' – ' + dShort(t.to) + ': ' + n0(t.paid) + ' paid views') + '</title></rect>';
      out += '<text x="' + (x + w / 2) + '" y="' + (H0 + 16) + '" text-anchor="middle" font-size="8" fill="#8b9cc4">' + esc(dShort(t.from).replace(/^\w+ /, function (m) { return m; })) + '</text>';
    });
    return '<svg viewBox="0 0 ' + (4 + tr.length * (w + g)) + ' ' + (H0 + 22) + '" role="img" aria-label="Weekly views, organic and paid" style="width:100%;max-width:' + (tr.length * 44) + 'px;height:auto;display:block">' + out + '</svg>';
  }
  function vlist(items, kind) {
    if (!items || !items.length) return '<div class="h2d-na">' + (kind === 'attn' ? 'Not enough recent uploads with views to rank.' : 'No video data.') + '</div>';
    return items.map(function (v) {
      var meta = kind === 'attn' ? n0(v.total_views) + (v.total_views === 1 ? ' view in ' : ' views in ') + Math.max(1, Math.round((Date.now() - Date.parse(v.published)) / 86400000)) + ' days (' + (v.per_day === null ? '—' : v.per_day) + '/day)' + (v.avg_pct !== null && v.avg_pct !== undefined ? ' · ' + v.avg_pct + '% viewed' : '') + (v.sample === 'insufficient' ? ' · too early to judge (under 100 views)' : '')
        : n0(v.views) + ' views (28 d)' + (v.avg_pct !== null && v.avg_pct !== undefined ? ' · ' + v.avg_pct + '% viewed' : '') + (v.subs ? ' · +' + v.subs + ' subs' : '');
      return '<div class="h2d-li"><span dir="auto" class="h2d-tt">' + esc(v.title) + '</span><em>' + esc(meta) + '</em></div>';
    }).join('');
  }
  function recItem(r) {
    var col = r.priority === 'High' ? '#ef4444' : r.priority === 'Medium' ? '#eab308' : '#9ca3af';
    return '<li class="h2d-rec"><div class="h2d-rt"><span class="h2d-chip" style="border-color:' + col + ';color:' + col + '">' + esc(r.priority) + '</span><b dir="auto" class="h2d-tt">' + esc(r.title) + '</b></div>' +
      '<div class="h2d-ra"><span>Do next:</span> ' + esc(r.action) + '</div>' +
      '<details><summary>Evidence and how we will know</summary><div class="h2d-ev">Evidence (' + esc(r.evidence_period || 'period n/a') + '): ' + esc(r.evidence) + '<br>' + esc(r.diagnosis) + '<br>Success: ' + esc(r.success) + '<br>Confidence: ' + esc(r.confidence) + ' · Owner: ' + esc(r.owner) + ' · Review by ' + esc(dShort(r.review_by)) + ' · Advisory only: nothing changes automatically.</div></details></li>';
  }
  function navBtns(engine) { var nm = dn(engine); return '<div class="h2d-btns"><button type="button" class="h2-btn" data-h2="biz:' + esc(engine) + '">Open ' + esc(nm) + '</button><button type="button" class="h2-btn" data-h2="ws:' + esc(engine) + ':analytics">Detailed analytics</button><button type="button" class="h2-btn" data-h2="ws:' + esc(engine) + ':production">Production tasks</button></div>'; }
  function dashCard(key) {
    var engine = HBIZ[key], nm = dn(engine), c = H.cards && H.cards[key];
    var head = function (pill, sub) { return '<div class="h2d-h"><h3>' + esc(nm) + '</h3>' + (pill || '') + '</div>' + (sub || ''); };
    if (!c) return '<section class="h2d" data-biz="' + key + '" aria-label="' + esc(nm) + '">' + head('', '<div class="h2d-na">' + (H.err ? 'The analytics report could not be loaded (' + esc(H.err) + '). The business pages below still work.' : 'Loading analytics…') + '</div>') + navBtns(engine) + '</section>';
    if (c.state !== 'ok') return '<section class="h2d" data-biz="' + key + '">' + head('', '<div class="h2d-na">' + esc(c.reason || 'No analytics are available for this business.') + '</div>') + navBtns(engine) + '</section>';
    var s = c.status, pc = PILL[s.code] || PILL.unknown, f = c.freshness, k = c.kpis, sp = c.split, rt = c.retention, co = c.content;
    var pill = '<span class="h2d-pill" style="background:' + pc[0] + '22;border-color:' + pc[0] + ';color:' + pc[0] + '">' + pc[1] + ' ' + esc(s.label) + '</span>';
    var fresh = '<div class="h2d-fresh"><span>Data through <b>' + esc(dShort(f.data_through)) + '</b>' + (f.age_days !== null ? ' (' + f.age_days + ' d ago)' : '') + '</span><span>Last successful sync <b>' + esc(dTime(f.last_ok_sync)) + '</b></span><span class="h2d-sm">Channel counters synced ' + esc(dTime(f.counters_synced_at)) + '</span></div>';
    var why = '<div class="h2d-why">' + esc(s.reason) + (s.momentum ? ' ' + esc(s.momentum.text) + '.' : '') + (s.weekly ? '<div class="h2d-sm">' + esc(s.weekly.text) + '</div>' : '') + '</div>';
    var stale = c.stale_banner ? '<div class="h2d-warn">' + esc(c.stale_banner) + '</div>' : '';
    var orgDelta = k.organic.comparable && k.organic.delta_pct !== null ? '<span class="h2d-d ' + (k.organic.delta_pct >= 0 ? 'up' : 'dn') + '">' + pct(k.organic.delta_pct) + '</span> vs ' + n0(k.organic.prev) + ' before' : '<span class="h2d-sm">previous 28 days: ' + n0(k.organic.prev) + ' — not comparable</span>';
    var t1 = '<div class="h2d-t"><div class="h2d-l">Organic views · last 28 d</div><div class="h2d-v">' + (k.organic.value === null ? 'Not available' : n0(k.organic.value)) + '</div><div class="h2d-s">' + orgDelta + '</div><div class="h2d-sm">' + esc(dShort(c.window.from)) + ' – ' + esc(dShort(c.window.to)) + ' vs ' + esc(dShort(c.window.prev_from)) + ' – ' + esc(dShort(c.window.prev_to)) + '</div></div>';
    var t2 = sp.verifiable ? '<div class="h2d-t"><div class="h2d-l">Paid vs organic</div><div class="h2d-v">' + (sp.paid_share_pct === 0 ? '0% paid' : sp.paid_share_pct + '% paid') + '</div><div class="h2d-bar" aria-hidden="true"><i style="width:' + (100 - (sp.paid_share_pct || 0)) + '%"></i><b style="width:' + (sp.paid_share_pct || 0) + '%"></b></div><div class="h2d-s">' + n0(sp.organic) + ' organic · ' + n0(sp.paid) + ' paid</div></div>'
      : '<div class="h2d-t"><div class="h2d-l">Paid vs organic</div><div class="h2d-v">Not available</div><div class="h2d-sm">' + esc(sp.note) + '</div></div>';
    var t3 = '<div class="h2d-t"><div class="h2d-l">Subscribers</div><div class="h2d-v">' + n0(k.subscribers.total) + '</div><div class="h2d-s"><b>' + sgn(k.subscribers.net_28d) + '</b> net from videos (28 d)' + (k.subscribers.prev_net_28d !== null ? ' vs ' + sgn(k.subscribers.prev_net_28d) + ' before' : '') + '</div><div class="h2d-sm">' + (k.subscribers.per_1000_organic !== null ? k.subscribers.per_1000_organic + ' per 1,000 organic views' + (k.subscribers.prev_per_1000_organic !== null ? ' (was ' + k.subscribers.prev_per_1000_organic + ')' : '') : 'Conversion not available') + '</div></div>';
    var t4 = '<div class="h2d-t"><div class="h2d-l">All views incl. paid · 28 d</div><div class="h2d-v h2d-mute">' + n0(k.total.value) + '</div><div class="h2d-s"><span class="h2d-sm">' + n0(k.watch_hours.value) + ' watch hours' + (k.watch_hours.value !== null ? '' : '') + '</span></div><div class="h2d-sm">Total, not organic.' + (f.since_through ? ' Since ' + esc(dShort(f.since_through.from)) + ': ' + sgn(f.since_through.views) + ' views, ' + sgn(f.since_through.subs) + ' subs (public counters, incl. paid).' : '') + '</div></div>';
    var cont = '<div class="h2d-cols"><div><div class="h2d-sec">Top content · last 28 d</div>' + vlist(co.top, 'top') + (c.policy ? '<div class="h2d-sm">Includes historical Shorts. ' + esc(c.policy.note) + '</div>' : '') + '</div><div><div class="h2d-sec">Lowest recent performers · early signals</div>' + vlist(co.attention, 'attn') +
      '<div class="h2d-sm">' + esc(co.attention_basis) + '. ' + (co.zero_view_uploads ? co.zero_view_uploads + ' recent upload' + (co.zero_view_uploads > 1 ? 's have' : ' has') + ' no views recorded. ' : '') + 'Uploads: ' + co.uploads.last28 + ' in the last 28 d vs ' + co.uploads.prev28 + ' before.</div></div></div>';
    var ret = '<div class="h2d-sec">Retention and engagement</div><div class="h2d-ret"><span>Avg view duration <b>' + dur(rt.avd_sec) + '</b>' + (rt.avd_prev_sec !== null ? ' <i>(was ' + dur(rt.avd_prev_sec) + ')</i>' : '') + '</span><span>Avg % viewed <b>' + (rt.avg_pct !== null ? rt.avg_pct + '%' : '—') + '</b></span><span>Watch ratio at 25% <b>' + (rt.median_at25 !== null ? rt.median_at25 : '—') + '</b> <i>(' + rt.curves + ' videos; ' + rt.early_loss + ' lose half early)</i></span><span>Views from subscribers <b>' + (rt.subscriber_view_share_pct !== null ? rt.subscriber_view_share_pct + '%' : '—') + '</b></span><span class="h2d-na">Likes, comments, shares: not available</span></div>';
    var money = '<div class="h2d-sec">Revenue and expenses</div><div class="h2d-money">' + c.money.map(function (m) { return '<div><b>' + esc(m.label) + ': Not available</b><div class="h2d-sm">' + esc(m.reason) + '<br><u>Needed:</u> ' + esc(m.needed) + '</div></div>'; }).join('') + '</div>';
    var recs = '<div class="h2d-sec">Top 3 recommended actions</div>' + (c.recommendations.length ? '<ol class="h2d-recs">' + c.recommendations.map(recItem).join('') + '</ol>' : '<div class="h2d-na">No recommendation has enough evidence yet.</div>');
    var lim = '<details class="h2d-lim"><summary>Not measured yet (' + c.limitations.length + ') and the work required</summary><ul>' + c.limitations.map(function (l) { return '<li><b>' + esc(l.label) + '</b> — ' + esc(l.reason) + ' <u>Work:</u> ' + esc(l.work) + '</li>'; }).join('') + '</ul></details>';
    var ix = bizIndex(engine), ff = ix >= 0 ? facts(ix) : null;
    var ops = ff ? '<div class="h2d-ops"><span>Production: next action <b>' + ff.next + '</b></span><span>Stage <b>' + esc(stage(ff.px)) + '</b></span></div>' : '';
    var btns = navBtns(engine);
    var sm = c.summary || { problem: '—', action: '—', owner: '—', observed: '', hypothesis: null, caveats: [] };
    var orgBig = k.organic.value === null ? 'Not available' : n0(k.organic.value);
    var orgSub = k.organic.comparable && k.organic.delta_pct !== null ? '<span class="h2d-d ' + (k.organic.delta_pct >= 0 ? 'up' : 'dn') + '">' + (k.organic.delta_pct >= 0 ? '▲ ' : '▼ ') + Math.abs(k.organic.delta_pct) + '%' + '</span> vs previous 28 days (' + n0(k.organic.prev) + ')' : 'Previous 28 days not comparable (' + n0(k.organic.prev) + ' views)';
    var paidBig = sp.verifiable ? sp.paid_share_pct + '%' : 'Not available';
    var paidSub = sp.verifiable ? '<div class="h2d-bar" aria-hidden="true"><i style="width:' + (100 - (sp.paid_share_pct || 0)) + '%"></i><b style="width:' + (sp.paid_share_pct || 0) + '%"></b></div><span>' + n0(sp.organic) + ' organic · ' + n0(sp.paid) + ' paid</span>' : '<span>Paid and organic cannot be separated for the whole period</span>';
    var subBig = (k.subscribers.net_28d === null ? '—' : sgn(k.subscribers.net_28d)) + ' <small>net, 28 d</small>';
    var subSub = n0(k.subscribers.total) + ' subscribers' + (k.subscribers.per_1000_organic !== null ? ' · ' + k.subscribers.per_1000_organic + ' per 1,000 organic views' : '');
    var stat = function (l, b, sub) { return '<div class="h2d-st"><div class="h2d-l">' + l + '</div><div class="h2d-v">' + b + '</div><div class="h2d-s">' + sub + '</div></div>'; };
    var staleFlag = f.stale ? '<span class="h2d-stale">⚠ Data is ' + f.age_days + ' days old</span>' : '';
    var summary = '<div class="h2d-sum">' + stat('Organic views · last 28 d', orgBig, orgSub) + stat('Advertising share of views', paidBig, paidSub) + stat('Subscriber growth', subBig, subSub) + '</div>' +
      '<div class="h2d-act"><div><span class="h2d-k">Main problem</span><b dir="auto" class="h2d-tt">' + esc(sm.problem) + '</b></div>' +
      '<div><span class="h2d-k">Next action</span><b dir="auto" class="h2d-tt">' + esc(sm.action) + '</b></div>' +
      '<div><span class="h2d-k">Owner</span><b>' + esc(sm.owner) + '</b> <span class="h2d-adv">advisory — nothing changes automatically</span></div></div>' +
      '<div class="h2d-obs"><b>Observed:</b> ' + esc(sm.observed) + (sm.hypothesis ? ' <b>' + esc(sm.hypothesis.replace(/: .*/, '')) + ':</b> ' + esc(sm.hypothesis.replace(/^[^:]*: /, '')) : '') + '</div>' +
      (sm.caveats && sm.caveats.length ? '<div class="h2d-cav">' + sm.caveats.map(esc).join(' ') + '</div>' : '') +
      '<div class="h2d-meta"><span>Data through <b>' + esc(dShort(f.data_through)) + '</b></span><span>Last successful sync <b>' + esc(dTime(f.last_ok_sync)) + '</b></span>' + staleFlag + '<span>Revenue and expenses: not available (see details)</span></div>';
    var more = '<details class="h2d-more"><summary>Detailed view — trend, content, retention, all recommendations, data notes</summary>' + fresh + why + stale + '<div class="h2d-tiles">' + t1 + t2 + t3 + t4 + '</div>' +
      '<div class="h2d-sec">Weekly views · <i style="color:#34d399">■</i> organic <i style="color:#f59e0b">■</i> paid</div>' + spark(c.trend) + cont + ret + money + recs + ops + lim + '</details>';
    return '<section class="h2d" data-biz="' + key + '" aria-label="' + esc(nm) + '">' + head(pill, '') + summary + btns + more + '</section>';
  }
  function homePage() {
    return '<div class="h2-wrap"><div class="h2-title">Home</div>' +
      '<div class="h2-lab">Your businesses — growth, content and next actions</div><div class="h2d-stack">' + dashCard('silk_road_voices') + dashCard('srv_studio') + '</div>' +
      '<div class="h2-lab">Other businesses</div><div class="h2-grid c2">' + investCard() + circleCard() + '</div>' +
      '<div class="h2-lab">Goals — optional targets</div>' + goalsCard() +
      '<div class="h2-lab">Finance and analytics</div>' + moneyStrip() + '</div>';
  }
  function overviewPage(engine) {
    var i = bizIndex(engine), f = facts(i), n = engine;
    var lnk = function (title, line, dest) { return '<div class="h2-card lnk" data-h2="' + esc(dest) + '" role="link" tabindex="0"><h3>' + esc(title) + '</h3><div class="h2-sm">' + line + '</div><div class="h2-go">Open ' + esc(title) + ' →</div></div>'; };
    return '<div class="h2-wrap"><div class="h2-grid c2"><div class="h2-card"><h3><span class="h2-dot" style="background:' + f.h[0] + '"></span>' + esc(dn(n)) + ' — status</h3>' +
      row('Last package', f.last) + row('Stage', esc(stage(f.px))) + row('Next action', f.next) + row('YouTube', esc(f.h[1])) + row('Views (' + f.win + ')', f.views) + row('Subscribers gained (from videos, same window)', f.subs) + '</div>' +
      '<div class="h2-grid" style="grid-template-columns:minmax(0,1fr)">' +
      lnk('Production', f.t.length ? f.t.length + ' open task' + (f.t.length > 1 ? 's' : '') + ' · next: ' + f.next : 'No open tasks', 'ws:' + n + ':production') +
      lnk('Packages', 'Package history for ' + esc(dn(n)) + ' only', 'ws:' + n + ':packages') +
      lnk('Analytics', esc(dn(n)) + ' channel only · ' + f.views + ' views', 'ws:' + n + ':analytics') +
      lnk('Avatars', 'Add, upload, replace or remove ' + esc(dn(n)) + ' avatar photos', 'ws:' + n + ':avatars') + '</div></div></div>';
  }

  /* ------------------------------------------------------------ Investment business page (Finance V2 3B) */
  var INV_TABS = [['overview', 'Overview'], ['holdings', 'Holdings & balances'], ['performance', 'Performance'], ['connection', 'Connection']];
  function invHeader(tab) {
    return '<div class="h2-ws" id="h2Ws"><div class="h2-crumb"><a data-h2="home" role="link" tabindex="0">← Home</a> › Investment › ' + esc((INV_TABS.filter(function (t) { return t[0] === tab; })[0] || ['', ''])[1]) + '</div>' +
      '<div class="h2-title" style="margin-bottom:6px">Investment</div>' +
      '<div class="h2-tabs" role="tablist">' + INV_TABS.map(function (t) { return '<button type="button" role="tab" data-h2="inv:' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '"' + (t[0] === tab ? ' aria-selected="true"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div></div>';
  }
  function invNote(t) { return '<div class="h2-sm" style="margin-top:8px;line-height:1.5">' + t + '</div>'; }
  function invFigure(key, fmt) { return verifiedFigure(key, fmt); }
  function invPage(tab) {
    var c = finCtx(), V = FV(); var F = function () { return computeFinanceState(); };
    var srcs = c && V ? V.sources(c, null, Date.now()) : [];
    var rh = srcs.filter(function (r) { return r.id === 'robinhood'; })[0];
    var preserved = c && V ? V.preservedHtml(c) : '';
    var iso = '<div class="h2-card"><h3>Isolation</h3><div class="h2-sm" style="line-height:1.5">Investment is a separate business. No music-business task, package, channel or analytics figure appears here, and investment performance is never counted as business revenue or household income. Household figures typed from Rocket Money (Finance) are never used or added here, and nothing here is added to them.</div></div>';
    if (tab === 'holdings') {
      return '<div class="h2-wrap"><div class="h2-card" id="h2InvHold"><h3>Holdings and balances</h3>' + row('Total value', invFigure('investmentValue', function () { return money(F().portfolioTotal); })) +
        invNote('Holdings and balances appear only from a connected read-only source with a known sync date. Nothing typed in, reconstructed or defaulted is shown. Nothing is connected today.') + preserved + '</div></div>';
    }
    if (tab === 'performance') {
      return '<div class="h2-wrap"><div class="h2-card" id="h2InvPerf"><h3>Performance</h3>' + row('Market gain / loss (not income)', nv('investmentGain').split('<div')[0]) +
        invNote('Market gain or loss is investment performance. It is <b>not</b> earned income, not household income and not business revenue, and it is never added to machine income. Performance appears only from verified source data with a stated reporting period.') + '</div>' + iso + '</div>';
    }
    if (tab === 'connection') {
      return '<div class="h2-wrap"><div class="h2-card" id="h2InvConn"><h3>Connection — CEO-controlled, read-only</h3>' +
        '<div class="h2-sm" style="margin-bottom:8px"><b>Status: ' + esc(rh && rh.state !== 'unavailable' ? rh.state : 'Not connected') + '.</b> No account has been connected and no vendor account has been created.</div>' +
        '<div class="h2-sm" style="line-height:1.6"><b>Planned route:</b> SnapTrade Personal, Robinhood by OAuth. SnapTrade lists Robinhood as read-only: it cannot place trades. The connection is requested as <b>read</b> only; trading is never requested.<br>' +
        '<b>Steps (each needs your explicit go-ahead):</b> 1) authorize creating the SnapTrade account and confirm the written cost terms; 2) engineering prepares the read-only link page; 3) <b>you</b> open the link and approve on Robinhood\'s own screen; 4) engineering verifies holdings, balances and the sync date, then you decide whether to keep it.<br>' +
        '<b>Stop rules:</b> abort if any screen asks for a Robinhood password, a trading permission, or a payment method.<br>' +
        '<b>Requirements before any connection (none is done):</b> (1) you authorize creating the SnapTrade account and obtain written Personal-plan terms; (2) the existing encrypted credential vault seals SnapTrade\'s per-user secret — no new secret store; (3) the link is requested as read-only (connection type read) with no trade permission; (4) you open the link and approve on Robinhood\'s own screen; (5) you compare the first holdings, balances and sync date with the Robinhood app before any figure is shown. Until then every Investment figure says "No verified data".<br>' +
        '<b>Freshness:</b> SnapTrade documents holdings once per day on daily plans and transactions once per day, so this is a daily snapshot, not live. <b>Cost:</b> Personal is listed as free for your own accounts, but SnapTrade also says personal access is free "for a limited time" with no end date, so written confirmation of the terms is required before connecting.</div></div>' + iso + '</div>';
    }
    return '<div class="h2-wrap"><div class="h2-grid c2"><div class="h2-card" id="h2InvOv"><h3>Investment — status</h3>' +
      row('Value', invFigure('investmentValue', function () { return money(F().portfolioTotal); })) + row('Market gain / loss (not income)', nv('investmentGain').split('<div')[0]) + row('Data source', esc(rh ? (rh.state === 'unavailable' ? 'Not connected' : rh.state) : 'Not connected'), 'inv:connection') +
      invNote('No value is shown until a read-only source is connected and verified.') + preserved + '</div>' + iso + '</div></div>';
  }
  function openInvest(tab) {
    tab = INV_TABS.some(function (t) { return t[0] === tab; }) ? tab : 'overview';
    S.biz = null; S.cur = 'invest'; S.invTab = tab;
    try { window.pkgFilterEngine = ''; window._analyticsScope = ''; } catch (e) { /* ignore */ }
    if (typeof currentTab !== 'undefined') currentTab = 'investment';
    style(); paintSide(); paintMain(invHeader(tab) + invPage(tab));
  }

  /* ------------------------------------------------------------ router hook */
  var KNOWN = ['home', 'investment', 'finance', 'tasks', 'engines', 'marketing', 'human_resources', 'legal_compliance', 'system', 'analytics', 'content', 'packages', 'integrations', 'factory', 'continuity', 'settings'];
  window.renderTab = function (tab) {
    if (active() && KNOWN.indexOf(tab) < 0) tab = 'home';
    if (!active()) { var r0 = _renderTab.apply(this, arguments); if (!authorized()) scrub(); return r0; }
    if (tab === 'investment') return openInvest(S.invTab || 'overview');
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
