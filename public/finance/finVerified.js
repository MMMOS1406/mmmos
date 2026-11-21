/* MMMOS Finance — verified-only display rules (Finance V2 phase 3B). PURE and READ-ONLY: reads the Finance context built by FinSrc; never writes, saves, recalculates or deletes anything.
 * CEO directive 2026-11-20: no prototype or invented financial figures in operational views. A number is displayed ONLY when its source, its reporting period and its verification status are known.
 * That means (1) a figure read from a CONNECTED provider with a known sync date, (2) household income / spending / net from an authorized EXPORT month that the CEO has explicitly compared with the source app and confirmed (reporting period, provenance and freshness stay visible), or (3) a Rocket Money headline figure the CEO TYPED from Rocket Money with its as-of date, reporting definition and an explicit confirmation (phase 3C). (3) is always labelled "Rocket Money — CEO-attested": never live, never provider-verified. Typed-in, default (seeded), reconstructed and legacy values are PRESERVED in the database but never shown as figures:
 * the view says "No verified data" (never 0) and explains why. Market gains are never earned income; goals are optional targets and a default target is never shown as CEO-approved.
 * Loaded as a classic script (window.FinVerified) after financeSources.js, and as plain text by the tests (no module syntax on purpose).
 */
(function (root) {
  'use strict';
  function fs() { return root.FinSrc; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function isoDay(t) { if (!t) return null; var d = new Date(t); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  var LABELS = {
    income: 'Household income', expenses: 'Household spending', cashflow: 'Net (income minus spending)', availableCash: 'Cash', debts: 'Debt', emergencyFund: 'Emergency fund',
    netWorth: 'Net worth', assets: 'Assets', liabilities: 'Liabilities', savings: 'Savings', investmentValue: 'Investment value', investmentGain: 'Investment market gain / loss (not income)', businessRevenue: 'Business revenue',
    machineIncome: 'Machine income (earned business revenue only)', savingsRate: 'Savings rate', runway: 'Runway'
  };
  var HOUSEHOLD = ['income', 'expenses', 'cashflow', 'netWorth', 'assets', 'liabilities', 'availableCash', 'savings', 'debts', 'emergencyFund', 'machineIncome'];
  // Rocket Money headline figures typed by the CEO (phase 3C). Same freshness rule as lib/finSnapshot.mjs (a test keeps the two in step).
  var SNAP_FRESH_DAYS = 35, SNAP_EXPIRE_DAYS = 120;
  var SNAP_MAP = { netWorth: 'net_worth', assets: 'assets', liabilities: 'liabilities', availableCash: 'cash', savings: 'savings', debts: 'debt' };
  // goals: label, stored key in D.finGoals, FinSrc target key, the metric that measures progress
  var GOALS = [
    { id: 'emergency', label: 'Emergency Fund', stored: 'emergencyFundTarget', tkey: 'efTarget', metric: 'emergencyFund', unit: '$' },
    { id: 'investment', label: 'Investment Goal', stored: 'portfolioGoal', tkey: 'portfolioGoal', metric: 'investmentValue', unit: '$' },
    { id: 'debt', label: 'Debt Freedom', stored: 'debtFreedomGoal', tkey: 'debtGoal', metric: 'debts', unit: '$' },
    { id: 'machine', label: 'Machine Income', stored: 'machineIncomeGoal', tkey: 'machineGoal', metric: 'machineIncome', unit: '$/mo' },
    { id: 'runway', label: 'Runway', stored: 'runwayGoal', tkey: 'runwayGoal', metric: 'runway', unit: 'months' }
  ];
  var REASON = {
    manual: 'Typed-in entries exist but are not verified against any source.',
    seeded: 'Only a default value shipped with the app exists.',
    reconstructed: 'Only reconstructed history exists; it is not connected.',
    legacy: 'Only an old sample record exists.',
    unavailable: 'No source is connected or imported.',
    noperiod: 'A source is connected but its reporting period is unknown.'
  };
  // ── the one rule: shown only from a connected provider with a known reporting period ───────────────────────────────────────────────────────────────────
  function status(key, ctx) {
    var F = fs();
    if (key === 'runway') { var a = status('availableCash', ctx), b = status('expenses', ctx); var sh = a.shown && b.shown && a.kind === 'connected' && b.kind === 'connected'; return { key: key, label: LABELS[key], shown: sh, kind: sh ? 'connected' : 'unavailable', source: sh ? 'connected accounts' : '', period: sh ? a.period : null, reason: sh ? '' : 'Needs cash and spending from a connected source (attested or imported figures are not combined).' }; }
    if (key === 'machineIncome') { var r = status('businessRevenue', ctx); return { key: key, label: LABELS[key], shown: r.shown, kind: r.kind, source: r.source, period: r.period, reason: r.shown ? '' : (r.kind === 'unavailable' ? 'No business revenue source is connected or imported. Investment market gains are never counted as earned income.' : r.reason + ' Investment market gains are never counted as earned income.') }; }
    var d = F.describe(key, ctx); var kind = d.kind, period = isoDay(d.asOf);
    var shown = kind === 'connected' && !!period;
    if (!shown) { var imp = importFigure(key, ctx); if (imp) return { key: key, label: LABELS[key] || key, shown: true, kind: 'import_verified', source: imp.sourceLabel, period: imp.month, reason: '', fromImport: imp }; }
    if (!shown && SNAP_MAP[key]) { var sn = snapFigure(key, ctx); if (sn && sn.shown) return { key: key, label: LABELS[key] || key, shown: true, kind: 'ceo_attested', source: 'Rocket Money — CEO-attested', period: sn.asOf, reason: '', fromSnapshot: sn }; if (sn && sn.reason) return { key: key, label: LABELS[key] || key, shown: false, kind: kind, source: '', period: null, reason: sn.reason }; }
    var pend = !shown ? importPending(key, ctx) : null;
    if (pend) return { key: key, label: LABELS[key] || key, shown: false, kind: kind, source: '', period: null, reason: pend };
    return { key: key, label: LABELS[key] || key, shown: shown, kind: kind, source: shown ? d.label : '', period: period, reason: shown ? '' : (kind === 'connected' ? REASON.noperiod : (REASON[kind] || REASON.unavailable)) };
  }
  // ── imported months: only a month the CEO has compared with the source app and confirmed can supply income / spending / net ─────────────────────────────────────────────
  var FROM_IMPORT = { income: 'income', expenses: 'expense', cashflow: 'net' };
  function srcName(list) { var x = (list || [])[0]; return x === 'rocket_money' ? 'Rocket Money export' : (x ? 'Imported export (' + x + ')' : 'Imported export'); }
  function importFigure(key, ctx) {
    var f = FROM_IMPORT[key]; var ms = ctx && ctx.importMonths; if (!f || !Array.isArray(ms)) return null;
    var v = ms.filter(function (m) { return m && m.verification === 'verified'; }).sort(function (a, b) { return a.month < b.month ? 1 : -1; })[0]; if (!v) return null;
    return { month: v.month, cents: f === 'net' ? v.net : v[f], verifiedAt: isoDay(v.verified_at), importedAt: isoDay(v.imported_at), freshness: v.freshness || 'unknown', sourceLabel: srcName(v.sources), unclassifiedCents: (v.unclassified_in || 0) + (v.unclassified_out || 0), transfersCents: v.transfer_excluded || 0 };
  }
  function importPending(key, ctx) {
    var ms = ctx && ctx.importMonths; if (!FROM_IMPORT[key] || !Array.isArray(ms) || !ms.length) return null;
    var p = ms.filter(function (m) { return m && m.verification !== 'verified'; }).sort(function (a, b) { return a.month < b.month ? 1 : -1; })[0]; if (!p) return null;
    return 'An import for ' + p.month + ' exists but is pending your comparison and confirmation (Finance → Imports).';
  }
  // ── Rocket Money snapshot typed by the CEO: ONE snapshot (the latest as-of) is used; a figure it does not contain is unavailable; > 120 days old it is not shown ──────────────────────────────────────
  function snapAge(asOf, now) { var t = Date.parse(asOf + 'T00:00:00Z'); return isNaN(t) ? null : Math.floor(((now || Date.now()) - t) / 86400000); }
  function snapFigure(key, ctx) {
    var sn = ctx && ctx.rmSnapshot; var f = SNAP_MAP[key]; if (!sn || !f || !sn.figures) return null;
    var age = snapAge(sn.as_of, ctx.now); if (age == null) return null;
    var state = age <= SNAP_FRESH_DAYS ? 'fresh' : (age <= SNAP_EXPIRE_DAYS ? 'stale' : 'expired');
    if (state === 'expired') return { shown: false, reason: 'The last Rocket Money snapshot (as of ' + sn.as_of + ') is older than ' + SNAP_EXPIRE_DAYS + ' days, so it is no longer shown. Enter a new snapshot.' };
    var c = sn.figures[f]; if (c === null || c === undefined) return { shown: false, reason: 'The latest Rocket Money snapshot (as of ' + sn.as_of + ') does not include this figure.' };
    return { shown: true, cents: c, asOf: sn.as_of, ageDays: age, freshness: state, definition: sn.definition || {}, key: key };
  }
  function snapNotes(f, key) {
    var d = f.definition || {}, n = [];
    if ((key === 'netWorth' || key === 'assets') && d.assets_include_investments && d.assets_include_investments !== 'no') n.push('Includes investments as recorded in Rocket Money (' + (d.assets_include_investments === 'yes_manual' ? 'entered by hand there' : 'a linked account there') + '). Not added to, and not taken from, the Investment page.');
    if ((key === 'liabilities' || key === 'netWorth') && d.liabilities_include_credit_cards === 'no') n.push('Rocket Money\'s debts figure excludes credit cards.');
    if (key === 'liabilities' && d.liabilities_include_credit_cards === 'unknown') n.push('Whether credit cards are included is not known.');
    if (key === 'debts') n.push('Total of the debt balances listed in Rocket Money; it can include balances its net-worth debts figure leaves out. Not added to Liabilities.');
    if (key === 'netWorth') n.push('Net worth = Assets − Debts, as calculated by Rocket Money.');
    if (key === 'availableCash' || key === 'savings') n.push('Part of Assets; never added to it.');
    return n;
  }
  function snapLine(s, key) {
    var f = s.fromSnapshot, stale = f.freshness === 'stale';
    return '<div class="fin-vsrc fin-attested" data-attested="rocket-money-ceo" style="font-size:8px;color:#a78bfa;margin-top:2px;letter-spacing:0.5px">ROCKET MONEY — CEO-ATTESTED · as of ' + esc(f.asOf) + ' · <span class="fin-fresh" style="color:' + (stale ? '#f59e0b' : '#22c55e') + '">' + (stale ? 'STALE (' + f.ageDays + ' days)' : 'FRESH') + '</span> · typed by the CEO, not live, not provider-verified</div>' +
      snapNotes(f, key).map(function (t) { return '<div style="font-size:8px;color:var(--dim);margin-top:1px;line-height:1.4">' + esc(t) + '</div>'; }).join('');
  }
  function usd(cents) { var v = (cents || 0) / 100; try { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); } catch (e) { return '$' + v.toFixed(2); } }
  function withSnapshots(ctx, snapStatus) { if (ctx) ctx.rmSnapshot = (snapStatus && snapStatus.latest && snapStatus.latest.figures) ? snapStatus.latest : null; return ctx; }
  function withImports(ctx, importsStatus) { if (ctx) ctx.importMonths = (importsStatus && Array.isArray(importsStatus.months)) ? importsStatus.months : []; return ctx; }
  function nvHtml(key, ctx, opt) {
    opt = opt || {}; var s = status(key, ctx);
    return '<span class="fin-nv" data-key="' + esc(key) + '" title="' + esc(s.reason) + '" style="color:var(--dim);font-weight:700">No verified data</span>' + (opt.reason === false ? '' : '<div class="fin-nv-why" style="font-size:9px;color:var(--dim);margin-top:2px;line-height:1.4">' + esc(s.reason) + '</div>');
  }
  function importLine(s) {
    var f = s.fromImport, stale = f.freshness === 'stale';
    return '<div class="fin-vsrc" data-verified-by="ceo-comparison" style="font-size:8px;color:#22c55e;margin-top:2px;letter-spacing:0.5px">VERIFIED · ' + esc(f.sourceLabel) + ' · period ' + esc(f.month) + ' · confirmed by CEO ' + esc(f.verifiedAt || '') + ' · imported ' + esc(f.importedAt || 'date unknown') + ' · <span class="fin-fresh" style="color:' + (stale ? '#f59e0b' : '#22c55e') + '">' + (stale ? 'STALE' : 'FRESH') + '</span></div>' +
      '<div style="font-size:8px;color:var(--dim);margin-top:1px;line-height:1.4">Classified rows only; transfers' + (f.transfersCents ? ' (' + esc(usd(f.transfersCents)) + ')' : '') + ' and unclassified rows' + (f.unclassifiedCents ? ' (' + esc(usd(f.unclassifiedCents)) + ')' : '') + ' are excluded.</div>';
  }
  function srcLine(s) { return '<div class="fin-vsrc" style="font-size:8px;color:#22c55e;margin-top:2px;letter-spacing:0.5px">VERIFIED · ' + esc(s.source) + ' · as of ' + esc(s.period) + '</div>'; }
  // valueHtml is evaluated by the caller only when needed; pass a function to avoid computing a hidden figure at all
  function show(key, ctx, valueHtml, opt) {
    var s = status(key, ctx); if (!s.shown) return nvHtml(key, ctx, opt);
    if (s.fromImport) return esc(usd(s.fromImport.cents)) + importLine(s);   // the figure comes from the CEO-confirmed import month itself
    if (s.fromSnapshot) return esc(usd(s.fromSnapshot.cents)) + snapLine(s, key);   // the figure is the CEO-attested Rocket Money figure itself
    return (typeof valueHtml === 'function' ? valueHtml() : valueHtml) + srcLine(s);
  }
  // ── goals: optional targets, never a default shown as approved ────────────────────────────────────────────────────────────────────────────────────────
  function target(g, ctx) {
    var v = ctx.goals && ctx.goals[g.tkey]; var d = fs().describeTarget(g.tkey, ctx);
    // a target counts as the CEO's only when the CEO explicitly set it (marker written by _finSetGoalTarget); a stored number alone — default or not — is never shown as approved
    var confirmed = !!(ctx.goalsConfirmed && ctx.goalsConfirmed[g.stored]) && v != null && isFinite(v) && v > 0;
    return { confirmed: confirmed, value: confirmed ? v : null, kind: d.kind };
  }
  function fmtTarget(g, v) { return g.unit === 'months' ? v + ' months' : '$' + Math.round(v).toLocaleString('en-US') + (g.unit === '$/mo' ? '/mo' : ''); }
  function goalRows(ctx, opt) {
    opt = opt || {};
    return GOALS.map(function (g) {
      var t = target(g, ctx), cur = status(g.metric, ctx);
      return '<div class="fin-goal" data-goal="' + g.id + '" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b>' + esc(g.label) + '</b><div style="font-size:10px;color:var(--dim)">Optional target</div></div>' +
        '<div style="text-align:right;font-size:12px">' + (t.confirmed ? '<span class="fin-tgt" style="font-weight:800">Target ' + esc(fmtTarget(g, t.value)) + '</span><div style="font-size:8px;color:#fbbf24;letter-spacing:0.5px">TARGET SET BY YOU</div>' : '<span class="fin-tgt-none" style="color:var(--dim)">No target set</span>') + '</div></div>' +
        '<div style="font-size:11px;margin-top:4px;color:var(--dim)">Current: ' + (cur.shown ? '<b style="color:var(--text)">' + (cur.kind === 'ceo_attested' ? 'Rocket Money — CEO-attested' : 'verified') + '</b>' : '<span>No verified data</span>') + (cur.shown ? '' : '<span style="font-size:9px"> — ' + esc(cur.reason) + '</span>') + '</div>' +
        (opt.editable ? '<div style="margin-top:4px;font-size:10px;color:var(--dim)">Set target: <input type="number" min="0" placeholder="optional" value="' + (t.confirmed ? esc(t.value) : '') + '" onchange="_finSetGoalTarget(\'' + g.stored + '\',this.value)" style="background:transparent;border:none;border-bottom:1px dashed rgba(201,168,76,0.4);color:var(--text);width:80px;font-size:11px;outline:none"></div>' : '') + '</div>';
    }).join('');
  }
  // ── what is stored (preserved) but not displayed ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function preserved(ctx) {
    var p = []; function add(n, l) { if (n) p.push(n + ' ' + l); }
    add(ctx.income, 'income entries'); add(ctx.expenses, 'expense entries'); add(ctx.debts, 'debt entries'); add(ctx.ie && ctx.ie.entries, 'Investment monthly entries'); add(ctx.ie && ctx.ie.holdings, 'holdings');
    add(ctx.revenueEntries, 'business revenue entries'); add(ctx.snaps && ctx.snaps.length, 'history points');
    return p;
  }
  function preservedHtml(ctx) {
    var p = preserved(ctx);
    return '<div class="fin-preserved" style="font-size:10px;color:var(--dim);line-height:1.5;margin-top:8px">Stored records are preserved and not deleted' + (p.length ? ' (' + esc(p.join(', ')) + ')' : '') + '. They are not displayed as figures because they are not verified.</div>';
  }
  // ── source-status panel: connected / import-only / stale / unavailable ────────────────────────────────────────────────────────────────────────────────
  var STATE = { attested: { t: 'CEO-ATTESTED', c: '#a78bfa' }, connected: { t: 'CONNECTED', c: '#22c55e' }, import_only: { t: 'IMPORT ONLY', c: '#60a5fa' }, stale: { t: 'STALE', c: '#f59e0b' }, unavailable: { t: 'UNAVAILABLE', c: '#6b7280' } };
  function ageDays(iso, now) { var d = new Date(iso); return isNaN(d.getTime()) ? null : (now - d.getTime()) / 86400000; }
  // imports: the fin_import_status payload (or null while loading). A source never becomes "connected" by an import: imports are one-time files, not live synchronization.
  function sources(ctx, imports, now) {
    now = now || Date.now(); var out = [];
    var bank = ctx.plaidConnected && ctx.plaidItems > 0;
    var ba = bank && ctx.plaidLastSync ? ageDays(ctx.plaidLastSync, now) : null;
    out.push({ id: 'bank', label: 'Bank accounts', state: bank ? (ba != null && ba <= 3 ? 'connected' : 'stale') : 'unavailable', detail: bank ? 'Linked accounts, last sync ' + (isoDay(ctx.plaidLastSync) || 'unknown') : 'No bank is connected. Direct bank connections are not part of the plan.' });
    var list = (imports && imports.imports) || [];
    var vm = ((imports && imports.months) || []).filter(function (m) { return m.verification === 'verified' && (m.sources || []).indexOf('rocket_money') >= 0; });
    var vtxt = vm.length ? vm.length + ' month' + (vm.length === 1 ? '' : 's') + ' compared and confirmed by the CEO (latest ' + vm[vm.length - 1].month + ').' : 'Verification pending.';
    var rm = list.filter(function (i) { return i.source === 'rocket_money'; })[0];
    if (rm) { var ra = ageDays(rm.imported_at, now); out.push({ id: 'rocket_money', label: 'Rocket Money', state: ra != null && ra <= 35 ? 'import_only' : 'stale', detail: 'Imported file, period ' + rm.period.from + ' to ' + rm.period.to + ' (imported ' + isoDay(rm.imported_at) + '). One-time export, not live synchronization. ' + vtxt }); }
    else out.push({ id: 'rocket_money', label: 'Rocket Money', state: 'unavailable', detail: 'Export-only app with no official API. Import a Rocket Money transactions export (Finance → Imports): a one-time file you provide — not connected, not live.' });
    var sn = ctx.rmSnapshot, sa = sn ? snapAge(sn.as_of, ctx.now || now) : null;
    out.push(sn && sa != null ? { id: 'rm_snapshot', label: 'Rocket Money headline figures (typed by the CEO)', state: sa <= SNAP_FRESH_DAYS ? 'attested' : 'stale', detail: 'As of ' + sn.as_of + (sa > SNAP_EXPIRE_DAYS ? ' — older than ' + SNAP_EXPIRE_DAYS + ' days, no longer shown.' : (sa > SNAP_FRESH_DAYS ? ' — STALE (' + sa + ' days).' : '.')) + ' Read in Rocket Money and entered by the CEO: not live, not provider-verified.' } : { id: 'rm_snapshot', label: 'Rocket Money headline figures (typed by the CEO)', state: 'unavailable', detail: 'No snapshot entered. Rocket Money has no supported API, so these figures exist in MMMOS only when you type them from Rocket Money.' });
    out.push({ id: 'robinhood', label: 'Robinhood (read-only, via SnapTrade)', state: 'unavailable', detail: 'Not connected. A CEO-controlled read-only link has not been authorized.' });
    var other = list.filter(function (i) { return i.source !== 'rocket_money'; })[0];
    if (other) { var oa = ageDays(other.imported_at, now); out.push({ id: 'other_import', label: 'Other import (' + other.source + ')', state: oa != null && oa <= 35 ? 'import_only' : 'stale', detail: 'Period ' + other.period.from + ' to ' + other.period.to + '. Not live synchronization. Verification pending unless confirmed by the CEO.' }); }
    return out;
  }
  function sourcesHtml(rows) {
    return '<div class="fin-sources">' + rows.map(function (r) { var s = STATE[r.state] || STATE.unavailable;
      return '<div class="fin-source" data-source="' + esc(r.id) + '" data-state="' + esc(r.state) + '" style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="flex-shrink:0;font-size:8px;font-weight:700;letter-spacing:0.6px;color:' + s.c + ';border:1px solid ' + s.c + '66;border-radius:4px;padding:2px 6px;margin-top:2px">' + s.t + '</span><div><div style="font-size:12px;font-weight:700">' + esc(r.label) + '</div><div style="font-size:10px;color:var(--dim);line-height:1.5">' + esc(r.detail) + '</div></div></div>'; }).join('') + '</div>';
  }
  function metricsHtml(ctx, keys) {
    return '<div class="fin-metrics" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">' + (keys || HOUSEHOLD).map(function (k) {
      return '<div class="fin-metric" data-key="' + k + '" style="padding:10px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">' + esc(LABELS[k]) + '</div><div style="font-size:14px;font-weight:800">' + nvOrCaller(k, ctx) + '</div></div>'; }).join('') + '</div>';
  }
  // a verified figure needs a number; the caller supplies the formatter through window.FinVerified.valueOf (set by the page), so the library itself never holds a figure
  function nvOrCaller(k, ctx) { var s = status(k, ctx); if (!s.shown) return nvHtml(k, ctx); if (s.fromImport || s.fromSnapshot) return show(k, ctx, null); return root.FinVerified && typeof root.FinVerified.valueOf === 'function' ? show(k, ctx, function () { return esc(root.FinVerified.valueOf(k)); }) : nvHtml(k, ctx); }
  var api = { LABELS: LABELS, HOUSEHOLD: HOUSEHOLD, GOALS: GOALS, status: status, nvHtml: nvHtml, show: show, target: target, goalRows: goalRows, preserved: preserved, preservedHtml: preservedHtml, withImports: withImports, withSnapshots: withSnapshots, snapFigure: snapFigure, importFigure: importFigure, sources: sources, sourcesHtml: sourcesHtml, metricsHtml: metricsHtml, valueOf: null };
  root.FinVerified = api;
})(typeof window !== 'undefined' ? window : this);
