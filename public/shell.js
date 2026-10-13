/* MMMOS — Admin / CEO organizational shell (CEO-008, Phase 1).
 *
 * An ORGANIZATIONAL LAYER over the existing MMMOS. It is loaded only when the browser-local flag
 * `mmm_shell_admin_v1` is "on" (default OFF; see the loader at the end of index.html), and it only acts for
 * the Admin user. With the flag off — or for Family / VA — this file is never requested and nothing changes.
 *
 * What it does:  replaces the nine primary tabs, for the Admin only, with three surfaces — CEO · MONEY · COMPANY —
 * and gives every existing screen a drill-down path back through the ORIGINAL router.
 * What it does NOT do:  it removes, hides, rebuilds or rewires nothing; it writes nothing to the shared state and calls no
 * write action itself. Every number comes from the app's own computations.
 *
 * Role safety (CEO-010): the shell belongs to the signed-in Admin only. These are UI-level checks — the server's own
 * authentication and authorization are unchanged and remain the actual gate. On logout, or whenever a non-Admin is on screen,
 * every trace of the shell (bar, nav, state, shell_* tab alias, content) is removed, and every ShellApp.* entry point
 * refuses to act for anyone but the Admin.
 *
 * Reversible at any time: ?shell=off, or "Classic navigation" in the shell bar (this tab only).
 */
(function () {
  'use strict';
  if (window.ShellApp) return;

  var FLAG_KEY = 'mmm_shell_admin_v1';           // browser-local flag. NEVER stored in the shared state (D).
  var CLASSIC_KEY = 'mmm_shell_classic';          // per-tab override: show the classic navigation
  function flagOn() { try { return localStorage.getItem(FLAG_KEY) === 'on'; } catch (e) { return false; } }
  function classicOverride() { try { return sessionStorage.getItem(CLASSIC_KEY) === '1'; } catch (e) { return false; } }
  function isAdmin() { return typeof currentUser !== 'undefined' && !!currentUser && currentUser.id === 'admin'; }
  function isActive() { return flagOn() && isAdmin() && !classicOverride(); }
  function authorized() { return flagOn() && isAdmin(); }   // may this user use the shell at all (even if currently in classic navigation)?

  var _renderTab = window.renderTab;               // the ORIGINAL router — every existing screen still renders through it
  var _renderNav = window.renderNav;
  if (typeof _renderTab !== 'function' || typeof _renderNav !== 'function') return;

  /* ------------------------------------------------------------------ state */
  var S = { user: null, ownerId: null, mode: null, arg: null, surface: 'ceo', stack: [], legacyTab: null, legacySub: null, legacyLabel: '', consoleNode: null, timer: null };
  var SURFACES = { ceo: 1, money: 1, company: 1 };
  var ALIAS = { ceo: 'home', money: 'shell_money', company: 'shell_company' };

  /* ------------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString('en-US'); }
  function safe(fn, fb) { try { return fn(); } catch (e) { try { console.warn('[shell] block unavailable:', e && e.message); } catch (_) { /* ignore */ } return fb == null ? '' : fb; } }
  function fin() { return safe(function () { return computeFinanceState(); }, null); }
  function health(F) { return safe(function () { return _ceoHQDeptHealth(F); }, {}); }
  var TRAFFIC = { green: '#22c55e', yellow: '#f59e0b', red: '#ef4444', gray: '#6b7280' };
  function dot(state) { return '<span class="shl-dot" style="background:' + (TRAFFIC[state] || TRAFFIC.gray) + '"></span>'; }

  var LEGACY_LABEL = {
    home: 'CEO Headquarters', finance: 'Finance', tasks: 'Tasks · production workspace', engines: 'Operations', marketing: 'Marketing & Sales',
    human_resources: 'Human Resources', legal_compliance: 'Legal & Compliance', system: 'Technology', social_media_manager: 'Social Media Manager',
    analytics: 'Engine analytics', packages: 'Packages', integrations: 'Integrations', settings: 'Settings',
    constitution: 'Constitution', continuity: 'Continuity', factory: 'Factory'
  };
  var LEGACY_OWNER = { home: 'ceo', finance: 'money' };      // everything else belongs to Company

  /* ------------------------------------------------------------------ data (read-only, from the app's own functions) */
  function execCdp(c) {
    if (c.decision_type === 'content_mix') return true;
    var t = (c.proposed_exact_change && c.proposed_exact_change.type) || '';
    return t === 'pipeline_flag' || t === 'automation_recovery';
  }
  function ceoDecisions() {
    var esc2 = (D.ceoEscalatedNotifications || []).map(function (n) { return { title: n.title || 'Escalated notification', why: n.message || '', tag: 'Escalated' }; });
    var cdp = (D.cdpPendingDecisions || []).filter(execCdp).map(function (c) { return { title: c.recommendation_title || 'Decision', why: (c.analysis_summary || '').slice(0, 180), impact: c.expected_business_impact || '', tag: 'Decision protocol' }; });
    return esc2.concat(cdp).slice(0, 5);                      // same cap and same filter as the existing Executive Inbox
  }
  function advisoryCount() { return (D.cdpPendingDecisions || []).filter(function (c) { return !execCdp(c); }).length; }
  function pendingApprovals() { return safe(function () { return (typeof approvalItems !== 'undefined' ? approvalItems : []).filter(function (a) { return a.status === 'pending'; }); }, []); }
  function ownerActions() { return pendingApprovals().filter(function (a) { return a.item_type === 'platform_connection'; }); }
  function otherApprovals() { return pendingApprovals().filter(function (a) { return a.item_type !== 'platform_connection'; }); }
  function engines() {
    return safe(function () {
      return ENGINES_CONFIG.map(function (e) {
        var st = _getEngineState(e.name);
        var open = (D.tasks || []).filter(function (t) { return t && t.engine === e.name && t.status !== 'done' && t.status !== 'uploaded' && t.status !== 'posted'; }).length;
        return { name: e.name, icon: e.icon || '', state: st, open: open };
      });
    }, []);
  }
  var ENGINE_STATE = { running: ['Running', '#22c55e'], test: ['Test', '#3b82f6'], paused: ['Paused', '#6b7280'], maintenance: ['Maintenance', '#f59e0b'] };

  /* ------------------------------------------------------------------ styles */
  function ensureStyle() {
    if ($('shlStyle')) return;
    var s = document.createElement('style'); s.id = 'shlStyle';
    s.textContent = [
      '.content.shl-wide{max-width:1120px}',
      '.shl-wrap{max-width:1120px;margin:0 auto;padding:4px 2px 30px;font-family:"Syne",sans-serif}',
      '.shl-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%;max-width:1120px;margin:0 auto 10px;padding:6px 2px;font-size:12px}',
      '.shl-bar .sp{flex:1}',
      '.shl-link{background:none;border:1px solid rgba(255,255,255,.12);color:var(--dim);border-radius:999px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit}',
      '.shl-link:hover{color:var(--text);border-color:rgba(255,255,255,.3)}',
      '.shl-back{color:var(--text)}',
      '.shl-crumb{color:var(--dim);font-family:"JetBrains Mono",monospace;font-size:11px}',
      '.shl-hero{background:linear-gradient(160deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:12px}',
      '.shl-eyebrow{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--gold);font-family:"JetBrains Mono",monospace;text-transform:uppercase}',
      '.shl-big{font-size:34px;font-weight:800;line-height:1.1;margin-top:6px;color:#fff}.shl-big small{font-size:14px;color:var(--dim);font-weight:500;margin-left:6px;font-family:"JetBrains Mono",monospace}',
      '.shl-track{height:8px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:12px}',
      '.shl-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--gold),var(--gold2));min-width:4px}',
      '.shl-foot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:11.5px;color:var(--dim)}',
      '.shl-state{margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:12.5px;color:#8b9cc4;display:flex;gap:8px;align-items:flex-start}',
      '.shl-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;flex-shrink:0}',
      '.shl-kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}@media(min-width:700px){.shl-kpis{grid-template-columns:repeat(3,1fr)}}',
      '.shl-kpi{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:12px;padding:12px 14px}',
      '.shl-kpi .k{font-size:9.5px;letter-spacing:1px;color:var(--dim);font-family:"JetBrains Mono",monospace;text-transform:uppercase;margin-bottom:5px}',
      '.shl-kpi .v{font-size:20px;font-weight:800;color:#fff}',
      '.shl-cols{display:grid;gap:14px;grid-template-columns:minmax(0,1fr)}@media(min-width:900px){.shl-cols{grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);align-items:start}}',
      '.shl-stack{display:flex;flex-direction:column;gap:12px}',
      '.shl-label{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--dim);font-family:"JetBrains Mono",monospace;text-transform:uppercase;margin:6px 0 2px}',
      '.shl-label span{text-transform:none;letter-spacing:0;font-weight:400;opacity:.8}',
      '.shl-card{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:var(--radius);padding:14px}',
      '.shl-card.gold{border-color:rgba(201,168,76,.28);background:rgba(201,168,76,.03)}',
      '.shl-card.blue{border-color:rgba(59,130,246,.3)}',
      '.shl-item{border-top:1px solid var(--border);padding:11px 0}.shl-item:first-child{border-top:0;padding-top:0}.shl-item:last-child{padding-bottom:0}',
      '.shl-item b{display:block;color:#fff;font-size:13px;line-height:1.4}.shl-item p{margin:4px 0 0;font-size:11.5px;color:#8b9cc4;line-height:1.55}',
      '.shl-empty{font-size:12px;color:var(--dim);padding:6px 0}',
      '.shl-btn{background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.4);color:var(--gold);border-radius:8px;padding:8px 13px;font-size:11.5px;font-weight:800;cursor:pointer;font-family:inherit;margin-top:10px}',
      '.shl-btn.plain{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);color:var(--text)}',
      '.shl-btn:hover{filter:brightness(1.15)}',
      '.shl-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:12px;padding:12px 14px;color:var(--text);cursor:pointer;font-family:inherit}',
      '.shl-row:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14)}',
      '.shl-row .m{flex:1;min-width:0}.shl-row .t{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.shl-row .s{font-size:11.5px;color:#8b9cc4;margin-top:2px;line-height:1.5}',
      '.shl-row .go{color:var(--dim);font-size:16px}',
      '.shl-pill{font-size:9.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid;font-family:"JetBrains Mono",monospace}',
      '.shl-list{display:flex;flex-direction:column;gap:8px}',
      '.shl-grid2{display:grid;gap:8px;grid-template-columns:minmax(0,1fr)}@media(min-width:760px){.shl-grid2{grid-template-columns:1fr 1fr}}',
      '.shl-chips{display:flex;flex-wrap:wrap;gap:8px}',
      '.shl-chip{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;background:none;color:var(--text);cursor:pointer;font-family:inherit}',
      'details.shl-acc{border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.02);margin-bottom:8px}',
      'details.shl-acc>summary{cursor:pointer;list-style:none;padding:13px 14px;font-weight:700;font-size:13.5px;display:flex;gap:10px;align-items:baseline}',
      'details.shl-acc>summary::-webkit-details-marker{display:none}details.shl-acc>summary .pv{margin-left:auto;font-weight:400;font-size:11.5px;color:var(--dim)}',
      'details.shl-acc[open]>summary{border-bottom:1px solid var(--border)}details.shl-acc .bd{padding:12px 14px;font-size:12.5px;color:#8b9cc4}',
      '@media(max-width:520px){details.shl-acc>summary .pv{display:none}}',
      '.shl-kv{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12.5px}.shl-kv:last-child{border-bottom:0}.shl-kv span:last-child{color:#fff;font-weight:700}',
      '.shl-goal{margin-bottom:11px}.shl-goal .gt{display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;color:#8b9cc4}',
      '.shl-note{font-size:11px;color:var(--dim);line-height:1.6;margin-top:10px}',
      '.shl-warn{border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.06);border-radius:12px;padding:14px;font-size:12.5px;color:#d6c08a;line-height:1.6}',
      '.shl-title{font-size:20px;font-weight:800;color:#fff;margin:2px 0 4px}.shl-sub{font-size:12.5px;color:#8b9cc4;line-height:1.55;margin-bottom:12px}',
      '.nav-btn.shl-on{background:rgba(201,168,76,.15);border-color:rgba(201,168,76,.45);color:var(--gold)}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ chrome: nav + bar */
  var NAV = [['ceo', '🏛️ CEO', '🏛️'], ['money', '💰 Money', '💰'], ['company', '🏢 Company', '🏢']];
  function owner() { return S.surface || 'ceo'; }
  function paintNav() {
    var nb = $('navBar'); if (!nb) return;
    var cur = owner();
    nb.innerHTML = NAV.map(function (n) {
      return '<button class="nav-btn ' + (cur === n[0] ? 'active shl-on' : '') + '" onclick="ShellApp.go(\'' + n[0] + '\')"><span class="nav-full">' + n[1] + '</span><span class="nav-short">' + n[2] + ' ' + n[1].split(' ')[1] + '</span></button>';
    }).join('');
  }
  function bar() {
    var b = $('shellBar');
    if (!b) { var m = $('mainContent'); if (!m) return null; b = document.createElement('div'); b.id = 'shellBar'; b.className = 'shl-bar'; m.parentNode.insertBefore(b, m); }
    return b;
  }
  function labelOf(e) {
    if (!e) return 'Company';
    if (SURFACES[e.view]) return { ceo: 'CEO', money: 'Money', company: 'Company' }[e.view];
    if (e.view === 'fn') return (FN[e.arg] || {}).name || 'Company';
    if (e.view === 'all') return 'All existing areas';
    if (e.view === 'legacy') return e.label || 'previous screen';
    return 'previous screen';
  }
  function paintBar() {
    var b = bar(); if (!b) return;
    var left = '';
    if (!SURFACES[S.mode]) {
      var top = S.stack[S.stack.length - 1];
      left = '<button class="shl-link shl-back" onclick="ShellApp.back()">← Back to ' + esc(labelOf(top)) + '</button>' +
        '<span class="shl-crumb">' + (S.mode === 'legacy' ? 'Existing MMMOS › ' + esc(S.legacyLabel) : esc(titleFor(S.mode, S.arg))) + '</span>';
    }
    b.innerHTML = left + '<span class="sp"></span>' +
      '<button class="shl-link" onclick="ShellApp.show(\'all\')">All existing MMMOS areas</button>' +
      '<button class="shl-link" onclick="ShellApp.classic()">Classic navigation</button>';
  }
  function titleFor(mode, arg) {
    if (mode === 'fn') return (FN[arg] || {}).name || 'Function';
    if (mode === 'all') return 'All existing MMMOS areas';
    return '';
  }

  /* ------------------------------------------------------------------ surfaces */
  function heroRevenue(F, extra) {
    var m = F ? F.machineIncome : 0, g = F ? F.machineGoal : 10000, pct = F ? F.machineIncomeProgress : 0;
    return '<div class="shl-hero"><div class="shl-eyebrow">MMM machine revenue · monthly target</div>' +
      '<div class="shl-big">' + money(m) + '<small>/ ' + money(g) + '</small></div>' +
      '<div class="shl-track"><div class="shl-fill" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>' +
      '<div class="shl-foot"><span>' + pct + '% of target</span><span>Only machine income counts toward this target</span></div>' + (extra || '') + '</div>';
  }
  function openBtn(label, js, cls) { return '<button class="shl-btn ' + (cls || '') + '" onclick="' + js + '">' + label + '</button>'; }

  function viewCEO() {
    var F = fin(), H = F ? health(F) : {};
    var decisions = ceoDecisions(), owner = ownerActions(), other = advisoryCount() + otherApprovals().length;
    var core = ['finance', 'operations', 'marketing_sales', 'technology'].map(function (k) { return H[k] || { state: 'gray' }; });
    var worst = core.some(function (d) { return d.state === 'red'; }) ? 'red' : core.some(function (d) { return d.state === 'yellow'; }) ? 'yellow' : 'green';
    var attention = core.filter(function (d) { return d.state === 'red' || d.state === 'yellow'; }).length;
    var stateLine = '<div class="shl-state">' + dot(worst) + '<span>' + attention + ' of 4 monitored functions need attention · ' + decisions.length + ' CEO decision' + (decisions.length === 1 ? '' : 's') + ' · ' + owner.length + ' owner action' + (owner.length === 1 ? '' : 's') + ' need you</span></div>';

    var eng = engines(), running = eng.filter(function (e) { return e.state === 'running'; }).length;
    var kpis = F ? '<div class="shl-kpis">' +
      '<div class="shl-kpi"><div class="k">Net worth</div><div class="v">' + money(F.netWorth) + '</div></div>' +
      '<div class="shl-kpi"><div class="k">Monthly cash flow</div><div class="v" style="color:' + (F.cashflow >= 0 ? '#22c55e' : '#ef4444') + '">' + (F.cashflow >= 0 ? '+' : '') + money(F.cashflow) + '</div></div>' +
      '<div class="shl-kpi"><div class="k">Engines running</div><div class="v">' + running + ' of ' + eng.length + '</div></div></div>' : '';

    var decHtml = decisions.length ? decisions.map(function (d) {
      return '<div class="shl-item"><b>' + esc(d.title) + '</b><p><span class="shl-pill" style="color:var(--gold);border-color:rgba(201,168,76,.4)">' + esc(d.tag) + '</span></p>' +
        (d.why ? '<p>' + esc(d.why) + '</p>' : '') + (d.impact ? '<p style="color:var(--gold)">Impact: ' + esc(d.impact) + '</p>' : '') + '</div>';
    }).join('') + openBtn('Review and decide in the Executive Inbox →', "ShellApp.open('home')") : '<div class="shl-empty">No CEO decisions require approval right now.</div>';

    var ownHtml = owner.length ? owner.map(function (a) {
      return '<div class="shl-item"><b>' + esc(a.item_title || a.item_id || 'Owner action') + '</b>' + (a.notes ? '<p>' + esc(a.notes) + '</p>' : '') + '</div>';
    }).join('') + openBtn('Open the existing approvals list →', "ShellApp.mount('approvals')", 'plain') : '<div class="shl-empty">Nothing needs your manual action right now.</div>';

    var otherHtml = other ? '<div class="shl-card"><b style="font-size:13px;color:#fff">Other pending reviews and approvals (' + other + ')</b><p class="shl-note" style="margin-top:6px">These stay exactly where they are today. Their final placement has not been decided.</p>' +
      openBtn('Open in CEO Headquarters →', "ShellApp.open('home')", 'plain') + ' ' + openBtn('Open approvals →', "ShellApp.mount('approvals')", 'plain') + '</div>' : '';

    var chips = [['finance', 'Finance', H.finance], ['growth', 'Growth', H.marketing_sales], ['operations', 'Operations', H.operations], ['technology', 'Technology', H.technology], ['governance', 'Governance', null]].map(function (c) {
      return '<button class="shl-chip" onclick="ShellApp.show(\'fn\',\'' + c[0] + '\')">' + dot(c[2] ? c[2].state : 'gray') + c[1] + '</button>';
    }).join('');
    var healthCard = '<div class="shl-card"><div class="shl-label" style="margin:0 0 6px">Company health</div><div style="font-weight:800;font-size:14px;color:' + TRAFFIC[worst] + '">' +
      (worst === 'red' ? 'Needs attention' : worst === 'yellow' ? 'Stable — minor items open' : 'Healthy') + '</div><div class="shl-chips" style="margin-top:10px">' + chips + '</div>' +
      '<p class="shl-note">Each function shows the same status the existing Department Status uses.</p></div>';

    var engHtml = eng.length ? '<div class="shl-list">' + eng.map(function (e) {
      var st = ENGINE_STATE[e.state] || [e.state, '#6b7280'];
      return '<button class="shl-row" onclick="ShellApp.show(\'fn\',\'operations\')"><span class="m"><span class="t">' + esc((e.icon ? e.icon + ' ' : '') + e.name) + ' <span class="shl-pill" style="color:' + st[1] + ';border-color:' + st[1] + '66">' + st[0] + '</span></span><span class="s">' + e.open + ' open task' + (e.open === 1 ? '' : 's') + '</span></span><span class="go">›</span></button>';
    }).join('') + '</div>' : '';

    var alerts = [];
    [['finance', 'Finance', 'finance'], ['operations', 'Operations', 'operations'], ['marketing_sales', 'Growth', 'growth'], ['technology', 'Technology', 'technology']].forEach(function (k) {
      var h = H[k[0]]; if (h && (h.state === 'red' || h.state === 'yellow')) alerts.push('<button class="shl-row" onclick="ShellApp.show(\'fn\',\'' + k[2] + '\')"><span class="m"><span class="t">' + dot(h.state) + k[1] + '</span><span class="s">' + esc(h.label || '') + '</span></span><span class="go">›</span></button>');
    });
    var risks = (F && F.signals ? F.signals : []).slice(0, 4).map(function (s) { return '<div class="shl-item"><p style="margin:0;color:#c9d3ec">' + esc(s.text) + '</p></div>'; }).join('');
    var alertHtml = (alerts.join('') ? '<div class="shl-list">' + alerts.join('') + '</div>' : '') + (risks ? '<div class="shl-card" style="margin-top:8px"><div class="shl-label" style="margin:0 0 6px">Major risks (existing signals)</div>' + risks + '</div>' : '');

    var more = '<div class="shl-list">' +
      '<button class="shl-row" onclick="ShellApp.open(\'home\')"><span class="m"><span class="t">Full CEO Headquarters (existing)</span><span class="s">Weekly CEO Brief · net worth chart · balance sheet · P&amp;L · cash position · goals · major risks · Executive Inbox · other pending reviews · department status · portfolio intelligence · executive calendar</span></span><span class="go">›</span></button></div>';

    return '<div class="shl-wrap">' + heroRevenue(F, stateLine) + kpis +
      '<div class="shl-cols"><div class="shl-stack">' +
      '<div class="shl-label">CEO decisions <span>— needs your judgment or authorization</span></div><div class="shl-card gold">' + decHtml + '</div>' +
      '<div class="shl-label">Needs you to do <span>— owner actions nobody else can take</span></div><div class="shl-card blue">' + ownHtml + '</div>' + otherHtml +
      '<div class="shl-label">Ask MMM</div><div id="shlConsole"></div>' +
      '</div><div class="shl-stack">' + healthCard +
      '<div class="shl-label">Production engines <span>— tap to open Operations</span></div>' + engHtml +
      (alertHtml ? '<div class="shl-label">Alerts and risks <span>— for awareness</span></div>' + alertHtml : '') +
      '<div class="shl-label">More from CEO Headquarters</div>' + more + '</div></div></div>';
  }

  function acc(key, title, preview, body) {
    return '<details class="shl-acc" data-k="' + key + '"><summary><span>' + title + '</span><span class="pv">' + preview + '</span></summary><div class="bd">' + body + '</div></details>';
  }
  function kv(a, b) { return '<div class="shl-kv"><span>' + a + '</span><span>' + b + '</span></div>'; }
  function goal(label, cur, tgt, pct, col) {
    return '<div class="shl-goal"><div class="gt"><span>' + label + '</span><span>' + cur + ' / ' + tgt + '</span></div><div class="shl-track" style="margin-top:0"><div class="shl-fill" style="width:' + Math.max(0, Math.min(100, pct)) + '%;background:' + col + '"></div></div></div>';
  }
  function viewMoney() {
    var F = fin();
    if (!F) return '<div class="shl-wrap"><div class="shl-warn">Financial figures are not available right now. The full existing Finance screen is below.</div>' + openBtn('Open Finance (existing) →', "ShellApp.open('finance')") + '</div>';
    var sum = '<div class="shl-kpis" style="grid-template-columns:1fr 1fr">' +
      '<div class="shl-kpi"><div class="k">Net worth</div><div class="v">' + money(F.netWorth) + '</div></div>' +
      '<div class="shl-kpi"><div class="k">Monthly cash flow</div><div class="v" style="color:' + (F.cashflow >= 0 ? '#22c55e' : '#ef4444') + '">' + (F.cashflow >= 0 ? '+' : '') + money(F.cashflow) + '</div></div>' +
      '<div class="shl-kpi"><div class="k">Available cash</div><div class="v">' + money(F.availableCash) + '</div></div>' +
      '<div class="shl-kpi"><div class="k">Savings rate</div><div class="v">' + Math.round(F.savingsRate) + '%</div></div></div>' +
      '<p class="shl-note" style="margin:0">Figures come from MMMOS\'s own finance computation (the same one the Finance screen and CEO Headquarters use). Nothing here is recalculated or reconciled.</p>';
    var accs = [
      acc('income', 'Income and machine income', money(F.machineIncome) + ' machine',
        kv('Monthly income (total)', money(F.incomeTotal)) + kv('Machine income (counts toward the target)', money(F.machineIncome)) + kv('Machine target', money(F.machineGoal)) + kv('Progress', F.machineIncomeProgress + '%')),
      acc('cash', 'Cash, expenses and coverage', money(F.availableCash),
        kv('Available cash', money(F.availableCash)) + kv('Monthly expenses', money(F.expenseTotal)) + kv('Emergency fund', money(F.emergencyFund) + ' of ' + money(F.efTarget)) + kv('Cash runway', (F.runway || 0) + ' months') + kv('Emergency coverage', (F.emergencyCoverage || 0) + ' months')),
      acc('invest', 'Investments', money(F.portfolioTotal), kv('Portfolio total', money(F.portfolioTotal)) + '<p class="shl-note">Holdings, the Investment Engine monthly card and manual entries are in the full Finance screen.</p>'),
      acc('debt', 'Debt', money(F.debtTotal), kv('Debt total', money(F.debtTotal)) + kv('Debt-freedom goal', money(F.debtGoal)) + '<p class="shl-note">The itemized debt list and manual debt entry are in the full Finance screen.</p>'),
      acc('goals', 'Goals', '4 goals',
        goal('Machine = job income', money(F.machineIncome), money(F.machineGoal), F.machineIncomeProgress, '#3b82f6') + goal('Emergency fund', money(F.emergencyFund), money(F.efTarget), F.efProgress, '#22c55e') +
        goal('Portfolio', money(F.portfolioTotal), money(F.portfolioGoal), F.portfolioProgress, '#c9a84c') + goal('Debt freedom', money(Math.max(0, F.debtGoal - F.debtTotal)), money(F.debtGoal), F.debtProgress, '#ef4444')),
      acc('pi', 'Machine portfolio and opportunities (existing)', 'portfolio intelligence', safe(function () { return _renderPortfolioIntelligence(computePortfolioIntelligence()); }, '<div class="shl-empty">Not available right now.</div>'))
    ].join('');
    var drill = '<div class="shl-list">' +
      '<button class="shl-row" onclick="ShellApp.open(\'finance\')"><span class="m"><span class="t">Full Finance (existing)</span><span class="s">Plaid bank connections · manual debts and holdings · Investment Engine · engine revenue entry · goals · charts</span></span><span class="go">›</span></button>' +
      '<button class="shl-row" onclick="ShellApp.open(\'home\')"><span class="m"><span class="t">Net worth chart, balance sheet and P&amp;L (existing CEO Headquarters)</span><span class="s">Net worth trend with range filters, balance sheet, monthly P&amp;L, cash position</span></span><span class="go">›</span></button></div>';
    return '<div class="shl-wrap">' + heroRevenue(F) + '<div class="shl-cols"><div class="shl-stack"><div class="shl-label">Executive summary</div><div class="shl-card">' + sum + '</div>' +
      '<div class="shl-label">Existing financial screens</div>' + drill + '</div><div class="shl-stack"><div class="shl-label">Detail <span>— tap to expand</span></div>' + accs + '</div></div></div>';
  }

  var FN = {
    finance: { name: 'Finance', icon: '💵', key: 'finance', blurb: 'Income, expenses, debt, investments, goals, bank connections.',
      links: [['Finance — the full existing screen', 'Plaid · manual debts and holdings · Investment Engine · engine revenue entry · goals · charts', "open('finance')"], ['Net worth chart, balance sheet, P&L', 'In the existing CEO Headquarters', "open('home')"]] },
    growth: { name: 'Growth', icon: '📈', key: 'marketing_sales', blurb: 'Marketing & Sales: analytics, weekly intelligence, growth recommendations.',
      links: [['Marketing & Sales — existing screen', 'Department dashboard with the analytics view', "open('marketing')"], ['Engine analytics', 'YouTube and TikTok detail, sync', "open('engines','setEnginesSub','analytics')"], ['Weekly intelligence report', 'Existing section that is not shown in today\'s navigation', "mount('weekly')"], ['Weekly CEO Brief', 'In the existing CEO Headquarters', "open('home')"]] },
    operations: { name: 'Operations', icon: '🏭', key: 'operations', blurb: 'The production layer. Company → Operations → Production / operator workspace. Today\'s production system is untouched underneath.',
      links: [['Production / operator workspace (Tasks)', 'Task console, cadence controls, per-engine lifecycles, exec mode. Opening it runs the weekly cadence creation exactly as it does today.', "open('tasks')"], ['Engines overview', 'Per-engine cards and live status', "open('engines','setEnginesSub','overview')"], ['Packages', 'Package history and viewer', "open('engines','setEnginesSub','packages')"], ['Engine analytics', 'YouTube and TikTok detail', "open('engines','setEnginesSub','analytics')"], ['Social Media Manager', 'Business registry, planning, VA tasks, video production, assets', "open('social_media_manager')"], ['Operations dashboard — existing screen', 'Department status plus the engines shell', "open('engines')"], ['Factory (existing, not in today\'s navigation)', 'Package creation, catalog memory, asset libraries, CapCut templates', "open('factory')"], ['Continuity (existing, not in today\'s navigation)', 'Task aging, rotation topics, notification table', "open('continuity')"]] },
    technology: { name: 'Technology', icon: '🖥️', key: 'technology', blurb: 'Engineering, integrations, reliability, security.',
      links: [['Technology dashboard — existing screen', 'Department status with Settings, Integrations, Engineering', "open('system')"], ['Settings', 'Profile, upload defaults, PIN, system', "open('system','setSystemSub','settings')"], ['Integrations', 'YouTube, TikTok, Instagram, HeyGen, Submagic, diagnostics', "open('system','setSystemSub','integrations')"], ['Engineering', 'Engineering Brain: tasks, decisions, regressions, release authorization, platform connections', "open('system','setSystemSub','engineering')"], ['Brain Validation (admin-only)', 'Verification tool', "open('system','setSystemSub','brain_validation')"], ['Constitution (existing, not in today\'s navigation)', 'System status, priorities, roadmap, operator principles', "open('constitution')"]] },
    governance: { name: 'Governance', icon: '⚖️', key: null, blurb: 'The CEO decision protocol and release authorization.',
      links: [['Executive Inbox and decision protocol', 'In the existing CEO Headquarters', "open('home')"], ['Engineering decisions and release authorization', 'In Engineering', "open('system','setSystemSub','engineering')"], ['Constitution (existing, not in today\'s navigation)', 'Operating principles and roadmap', "open('constitution')"]] },
    human_resources: { name: 'Human Resources', icon: '👥', key: 'human_resources', blurb: 'A supporting function. It keeps its place in the company and activates when needed.',
      links: [['Human Resources — existing screen', 'Department template', "open('human_resources')"]] },
    legal_compliance: { name: 'Legal & Compliance', icon: '⚖️', key: 'legal_compliance', blurb: 'A supporting function. It surfaces here when something needs attention.',
      links: [['Legal & Compliance — existing screen', 'Department template', "open('legal_compliance')"]] }
  };
  function fnCard(id) {
    var f = FN[id], F = fin(), H = F ? health(F) : {};
    var h = f.key ? H[f.key] : null;
    var st = h ? h.state : 'gray';
    var reason = id === 'governance' ? (ceoDecisions().length + ' decision' + (ceoDecisions().length === 1 ? '' : 's') + ' pending in the Executive Inbox') : (h ? h.label : 'No status available');
    var label = { green: 'Working', yellow: 'Attention', red: 'Attention', gray: 'No data yet' }[st];
    return '<button class="shl-row" onclick="ShellApp.show(\'fn\',\'' + id + '\')"><span style="font-size:20px">' + f.icon + '</span><span class="m"><span class="t">' + f.name + ' <span class="shl-pill" style="color:' + TRAFFIC[st] + ';border-color:' + TRAFFIC[st] + '66">' + label + '</span></span><span class="s">' + esc(reason) + '</span></span><span class="go">›</span></button>';
  }
  function viewCompany() {
    return '<div class="shl-wrap"><div class="shl-title">Is the organization doing its job?</div><div class="shl-sub">Each function shows its status and reason. Tap one to reach everything that exists under it.</div>' +
      '<div class="shl-grid2">' + ['finance', 'growth', 'operations', 'technology', 'governance'].map(fnCard).join('') + '</div>' +
      '<div class="shl-label" style="margin-top:14px">Support functions <span>— they activate when needed</span></div><div class="shl-grid2">' + ['human_resources', 'legal_compliance'].map(fnCard).join('') + '</div>' +
      '<div class="shl-label" style="margin-top:14px">Find anything</div><div class="shl-list"><button class="shl-row" onclick="ShellApp.show(\'all\')"><span class="m"><span class="t">All existing MMMOS areas</span><span class="s">Every existing screen and section, including ones not in today\'s navigation. Nothing was removed.</span></span><span class="go">›</span></button></div></div>';
  }
  function viewFn(id) {
    var f = FN[id]; if (!f) return viewCompany();
    return '<div class="shl-wrap"><div class="shl-title">' + f.icon + ' ' + f.name + '</div><div class="shl-sub">' + esc(f.blurb) + '</div><div class="shl-list">' +
      f.links.map(function (l) { return '<button class="shl-row" onclick="ShellApp.' + l[2].replace(/'/g, "'") + '"><span class="m"><span class="t">' + esc(l[0]) + '</span><span class="s">' + esc(l[1]) + '</span></span><span class="go">›</span></button>'; }).join('') + '</div></div>';
  }

  /* Everything that exists today, including screens with no navigation entry and sections no screen mounts. */
  var ALL = [
    ['Existing screens', [['CEO Headquarters', "open('home')"], ['Finance', "open('finance')"], ['Operations', "open('engines')"], ['Marketing & Sales', "open('marketing')"], ['Human Resources', "open('human_resources')"], ['Legal & Compliance', "open('legal_compliance')"], ['Technology', "open('system')"], ['Tasks (production workspace)', "open('tasks')"], ['Social Media Manager', "open('social_media_manager')"]]],
    ['Sub-screens', [['Engines overview', "open('engines','setEnginesSub','overview')"], ['Engine analytics', "open('engines','setEnginesSub','analytics')"], ['Packages', "open('engines','setEnginesSub','packages')"], ['Settings', "open('system','setSystemSub','settings')"], ['Integrations', "open('system','setSystemSub','integrations')"], ['Engineering', "open('system','setSystemSub','engineering')"], ['Brain Validation', "open('system','setSystemSub','brain_validation')"]]],
    ['Not in today\'s navigation (code and routes exist)', [['Constitution', "open('constitution')"], ['Continuity', "open('continuity')"], ['Factory', "open('factory')"]]],
    ['Sections defined in code that no screen currently shows', [['Operator tasks', "mount('optasks')"], ['Production pipeline', "mount('pipeline')"], ['Approvals (request, approve, reject, revise)', "mount('approvals')"], ['Weekly intelligence report', "mount('weekly')"], ['API queue health', "mount('queue')"], ['System intelligence panel', "mount('sysintel')"], ['Previous CEO Headquarters layout', "mount('legacyhome')"]]]
  ];
  function viewAll() {
    return '<div class="shl-wrap"><div class="shl-title">All existing MMMOS areas</div><div class="shl-sub">Nothing was removed or hidden. Everything that exists is reachable here, through the same code it always ran on. Items whose final home has not been decided stay here until it is.</div>' +
      ALL.map(function (g) {
        return '<div class="shl-label" style="margin-top:14px">' + esc(g[0]) + '</div><div class="shl-grid2">' + g[1].map(function (l) { return '<button class="shl-row" onclick="ShellApp.' + l[1] + '"><span class="m"><span class="t">' + esc(l[0]) + '</span></span><span class="go">›</span></button>'; }).join('') + '</div>';
      }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ painting */
  function paintContent() {
    var m = $('mainContent'); if (!m) return;
    ensureStyle(); m.classList.add('shl-wide');                // wider column for shell views only; existing screens keep their own width
    var open = {}; Array.prototype.forEach.call(m.querySelectorAll('details[data-k]'), function (d) { open[d.getAttribute('data-k')] = d.open; });
    var html = '';
    try {
      if (S.mode === 'ceo') html = viewCEO(); else if (S.mode === 'money') html = viewMoney(); else if (S.mode === 'company') html = viewCompany();
      else if (S.mode === 'fn') html = viewFn(S.arg); else if (S.mode === 'all') html = viewAll();
    } catch (e) { html = '<div class="shl-wrap"><div class="shl-warn">This view could not be built (' + esc(e && e.message) + '). Use “All existing MMMOS areas” or “Classic navigation” — nothing was changed.</div></div>'; }
    m.innerHTML = html;
    Array.prototype.forEach.call(m.querySelectorAll('details[data-k]'), function (d) { if (open[d.getAttribute('data-k')]) d.open = true; });
    if (S.mode === 'ceo') {                                   // keep the Ask MMM console alive across repaints (typed text + answer survive)
      var slot = $('shlConsole');
      if (slot) {
        if (!S.consoleNode) { S.consoleNode = document.createElement('div'); S.consoleNode.innerHTML = safe(function () { return renderOperatorConsole(); }, '<div class="shl-empty">Ask MMM is not available right now.</div>'); }
        slot.appendChild(S.consoleNode);
      }
    }
  }
  function paintAll() { ensureStyle(); paintNav(); paintBar(); paintContent(); }
  function schedule() {
    if (S.timer) return;
    S.timer = setTimeout(function () { S.timer = null; if (isActive() && SURFACES[S.mode]) paintContent(); }, 120);
  }

  /* ------------------------------------------------------------------ navigation */
  function resetState() { S.user = null; S.ownerId = null; S.mode = null; S.arg = null; S.surface = 'ceo'; S.stack = []; S.legacyTab = null; S.legacySub = null; S.legacyLabel = ''; S.consoleNode = null; }
  function resetIfNewUser() {
    var id = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    if (S.user !== currentUser || S.ownerId !== id) { resetState(); S.user = currentUser; S.ownerId = id; }   // a different person (or a fresh sign-in) never inherits a previous view or history
  }

  /* ------------------------------------------------------------------ role safety (CEO-010) */
  function ownTab() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.id === 'va') ? 'tasks' : 'home'; }   // the landing tab the app itself uses for this user
  function appShown() { var a = $('appScreen'); return !!a && a.classList.contains('show'); }
  function stale() {                                              // does anything of the shell remain on the page?
    var mc = $('mainContent');
    return S.mode !== null || S.ownerId !== null || !!$('shellBar') || !!document.querySelector('.shl-newlayout') || (!!mc && mc.classList.contains('shl-wide')) ||
      (typeof currentTab === 'string' && currentTab.indexOf('shell_') === 0);
  }
  function scrub() {                                              // remove every trace of the shell's presentation and state; returns true if there was anything to remove
    var had = stale();
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    resetState();
    var b = $('shellBar'); if (b) b.remove();
    var mc = $('mainContent'); if (mc) mc.classList.remove('shl-wide');
    var chip = document.querySelector('.shl-newlayout'); if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
    if (typeof currentTab === 'string' && currentTab.indexOf('shell_') === 0) currentTab = ownTab();
    return had;
  }
  function rebuildOwn() {                                         // give whoever is signed in their own, original navigation and landing screen
    if (!appShown() || typeof currentUser === 'undefined' || !currentUser) return;
    try { _renderNav.call(window); _renderTab.call(window, ownTab()); } catch (e) { /* the original screen shows its own state */ }
  }
  function refuse() { if (scrub()) rebuildOwn(); }                // a caller who may not use the shell: clear any leftover and restore their own view
  function onLogout() {                                           // the previous user's shell presentation must not survive the sign-out
    var had = stale();
    scrub();
    try { sessionStorage.removeItem(CLASSIC_KEY); } catch (e) { /* ignore */ }
    if (had) { var mc = $('mainContent'); if (mc) mc.innerHTML = ''; var nb = $('navBar'); if (nb) nb.innerHTML = ''; }
  }
  function relinquish() {                                         // called when a request is passed straight to the original app
    if (authorized()) { var b = $('shellBar'); if (b) b.remove(); var mc = $('mainContent'); if (mc) mc.classList.remove('shl-wide'); return; }   // Admin in classic navigation
    scrub();
  }
  function reconcile() {                                          // the app screen opened or closed: make sure the shell matches who is actually signed in
    if (!appShown()) { onLogout(); return; }
    if (!authorized()) { refuse(); return; }
    if (S.ownerId && typeof currentUser !== 'undefined' && currentUser && S.ownerId !== currentUser.id) resetState();
  }
  function guarded(fn) { return function () { if (!authorized()) { refuse(); return; } return fn.apply(this, arguments); }; }
  function pushCurrent() {
    if (S.mode == null) return;
    if (S.mode === 'legacy') S.stack.push({ view: 'legacy', tab: S.legacyTab, sub: S.legacySub, label: S.legacyLabel });
    else S.stack.push({ view: S.mode, arg: S.arg });
  }
  function enter(view, arg) {                                   // paint a shell view (no history bookkeeping)
    S.mode = view; S.arg = arg || null;
    if (view === 'ceo') {
      // Run the ORIGINAL router for Home first, so Home's own once-per-session behavior (analytics sync, data loads) fires exactly as it does
      // today; then paint the shell over it. currentTab stays "home" so the existing loaders that refresh Home also refresh this surface.
      try { _renderTab.call(window, 'home'); } catch (e) { /* the shell surface still renders */ }
      currentTab = ALIAS.ceo;
    } else if (view === 'company') {
      currentTab = ALIAS.company;
      safe(function () { _ensureBrainDeptDataLoaded(); _ensureYouTubeAnalyticsLoaded(); });
    } else { currentTab = ALIAS[view] || ('shell_' + view); }
    paintAll(); window.scrollTo(0, 0);
  }
  function go(surface) { resetIfNewUser(); S.stack = []; S.surface = surface; enter(surface); }
  function show(view, arg) { resetIfNewUser(); pushCurrent(); enter(view, arg); }
  function noteHtml(tab, err) {
    return '<div class="shl-wrap"><div class="shl-warn"><b>This existing screen could not render right now.</b><br>' + esc(LEGACY_LABEL[tab] || tab) + ' threw “' + esc(err && err.message) + '”. This is how it behaves in the classic navigation too — the shell did not change it. It is preserved as-is for a separate fix.</div></div>';
  }
  function renderLegacy(tab, subFn, subArg) {
    S.mode = 'legacy'; S.legacyTab = tab; S.legacySub = subFn ? [subFn, subArg] : null; S.legacyLabel = LEGACY_LABEL[tab] || tab;
    var threw = null; var mc = $('mainContent'); if (mc) mc.classList.remove('shl-wide');
    try { _renderTab.call(window, tab); if (subFn && typeof window[subFn] === 'function') window[subFn](subArg); } catch (e) { threw = e; }
    if (threw) { var m = $('mainContent'); if (m) { ensureStyle(); m.innerHTML = noteHtml(tab, threw); } }
    paintNav(); paintBar(); window.scrollTo(0, 0);
  }
  function open(tab, subFn, subArg) { resetIfNewUser(); pushCurrent(); renderLegacy(tab, subFn, subArg); }
  function back() {
    var t = S.stack.pop();
    if (!t) return go('company');
    if (t.view === 'legacy') return renderLegacy(t.tab, t.sub && t.sub[0], t.sub && t.sub[1]);
    enter(t.view, t.arg);
  }
  function classic() {
    try { sessionStorage.setItem(CLASSIC_KEY, '1'); } catch (e) { /* ignore */ }
    var b = $('shellBar'); if (b) b.remove(); var mc = $('mainContent'); if (mc) mc.classList.remove('shl-wide');
    _renderNav.call(window); _renderTab.call(window, 'home'); addNewLayoutChip();
  }
  function newLayout() { try { sessionStorage.removeItem(CLASSIC_KEY); } catch (e) { /* ignore */ } S.mode = null; S.stack = []; window.renderTab('home'); }
  function addNewLayoutChip() {
    var nb = $('navBar'); if (!nb || !flagOn() || !isAdmin() || !classicOverride() || nb.querySelector('.shl-newlayout')) return;
    var b = document.createElement('button'); b.className = 'nav-btn shl-newlayout'; b.setAttribute('onclick', 'ShellApp.newLayout()');
    b.innerHTML = '<span class="nav-full">🧭 New layout</span><span class="nav-short">🧭</span>'; nb.appendChild(b);
  }

  /* Mount sections that exist in code but that no screen currently shows. Each is rendered by its own existing function; nothing new is written. */
  function mount(which) {
    resetIfNewUser(); pushCurrent();
    S.mode = 'legacy'; S.legacyTab = 'shell_all'; S.legacySub = null; currentTab = 'shell_all';
    var titles = { optasks: 'Operator tasks', pipeline: 'Production pipeline', approvals: 'Approvals', weekly: 'Weekly intelligence report', queue: 'API queue health', sysintel: 'System intelligence panel', legacyhome: 'Previous CEO Headquarters layout' };
    S.legacyLabel = titles[which] || which;
    var html = '', after = null;
    try {
      if (which === 'optasks') { html = renderOperatorTasksSection(); after = function () { loadOperatorTasks(); }; }
      else if (which === 'pipeline') { html = renderPipelineSection(); after = function () { loadPipeline(); }; }
      else if (which === 'approvals') { html = renderApprovalsSection(); after = function () { loadApprovals(); }; }
      else if (which === 'weekly') { html = '<div class="card" style="margin-top:12px"><div id="weekly-report-panel"></div></div>'; after = function () { loadWeeklyReport(); }; }
      else if (which === 'queue') { html = '<div class="card" style="margin-top:12px"><div id="queue-health-panel"></div></div>'; after = function () { loadQueueStatus(); }; }
      else if (which === 'sysintel') { html = '<div class="card" style="margin-top:12px">' + renderSystemIntelligencePanel(computeContentHealth()) + '</div>'; }
      else if (which === 'legacyhome') { html = _renderHomeLegacy(); }
    } catch (e) { html = noteHtml(which, e); }
    var m = $('mainContent'); ensureStyle(); if (m) { m.classList.remove('shl-wide'); m.innerHTML = '<div class="shl-wrap">' + html + '</div>'; }
    paintNav(); paintBar(); window.scrollTo(0, 0);
    if (after) { try { after(); } catch (e) { /* the section shows its own state */ } }
  }

  /* ------------------------------------------------------------------ routing hooks (the ONLY places the original behavior is intercepted) */
  window.renderTab = function (tab) {
    if (!isActive()) {
      relinquish();
      var args = arguments;
      if (typeof tab === 'string' && tab.indexOf('shell_') === 0) { args = Array.prototype.slice.call(arguments); args[0] = ownTab(); }   // a shell alias is never a route for anyone who is not in the shell
      return _renderTab.apply(this, args);
    }
    resetIfNewUser();
    if (S.mode === null) return go('ceo');                                   // first call after login lands on the CEO surface
    if (typeof tab === 'string' && tab.indexOf('shell_') === 0) {            // a refresh of a shell view
      var v = tab.slice(6);
      if (SURFACES[v]) { if (S.mode === v) { paintContent(); return; } return go(v); }
      if (v === 'fn' || v === 'all') { if (S.mode === v) { paintContent(); return; } return show(v, S.arg); }
      return _renderTab.apply(this, arguments);
    }
    if (S.mode === 'legacy') { S.legacyTab = tab; S.legacyLabel = LEGACY_LABEL[tab] || tab; return _renderTab.apply(this, arguments); }  // inside an existing screen: exactly as today
    if (tab === 'home' || tab === ALIAS[S.mode]) { paintContent(); return; }  // a background refresh of Home must never move the user; repaint what they are looking at
    return open(tab);                                                         // explicit navigation from a link on a shell view (e.g. an Ask MMM link)
  };
  // The app's own save routine re-renders Home directly (syncState), bypassing the router. When the CEO surface is showing, repaint the surface instead.
  var _syncState = window.syncState;
  if (typeof _syncState === 'function') {
    window.syncState = function () {
      if (isActive() && S.mode === 'ceo' && currentTab === ALIAS.ceo) { paintContent(); return; }
      if (!isActive()) relinquish();
      return _syncState.apply(this, arguments);
    };
  }
  window.renderNav = function () {
    if (!isActive()) { relinquish(); var r = _renderNav.apply(this, arguments); addNewLayoutChip(); return r; }
    paintNav(); schedule();
  };

  window.ShellApp = { go: guarded(go), show: guarded(show), open: guarded(open), back: guarded(back), classic: guarded(classic), newLayout: guarded(newLayout), mount: guarded(mount), _state: S };

  // Sign-out never reloads this app, so the shell must clean up after itself — by hooking logout() AND by watching the app screen,
  // so that it does not depend on any single call path (and again when a page is restored from the browser's back/forward cache).
  var _logout = window.logout;
  if (typeof _logout === 'function') {
    window.logout = function () { try { return _logout.apply(this, arguments); } finally { try { onLogout(); } catch (e) { /* never block a sign-out */ } } };
  }
  try { var app = $('appScreen'); if (app && window.MutationObserver) new MutationObserver(function () { try { reconcile(); } catch (e) { /* ignore */ } }).observe(app, { attributes: true, attributeFilter: ['class'] }); } catch (e) { /* ignore */ }
  window.addEventListener('pageshow', function (ev) { if (ev && ev.persisted) { try { reconcile(); } catch (e) { /* ignore */ } } });

  // If the app was already showing a screen when this file finished loading (session restore), switch to the shell now.
  if (isActive() && $('appScreen') && $('appScreen').classList.contains('show')) { S.user = null; S.mode = null; window.renderTab('home'); }
  else if (flagOn() && isAdmin() && classicOverride()) { addNewLayoutChip(); }
})();
