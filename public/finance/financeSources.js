/* MMMOS Finance — source transparency (Finance V2 phase 1). PURE and READ-ONLY: it only reads the Finance state object it is given; it never writes, saves, recalculates or deletes anything.
 * Every financial figure the UI shows is described as exactly one of:
 *   manual        typed in by the CEO (no connected source)            seeded        a default shipped in the code, never confirmed
 *   reconstructed history rebuilt from a stored timeline (not connected) legacy        old sample/seed record kept for reference
 *   connected     read from a linked provider (Plaid etc.)              unavailable   no source exists, so no number is shown (never 0)
 * Loaded as a classic script (window.FinSrc) and as plain text by the tests (no module syntax on purpose).
 */
(function (root) {
  'use strict';
  var SEEDS = { efCurrent: 1800, efTarget: 12000, portfolioGoal: 100000, debtGoal: 13500, machineGoal: 10000, runwayGoal: 6 };   // the defaults shipped in index.html (finGoals)
  var KINDS = {
    manual:        { text: 'MANUAL ENTRY',                  color: '#fbbf24' },
    seeded:        { text: 'DEFAULT VALUE — NOT VERIFIED',  color: '#f97316' },
    reconstructed: { text: 'RECONSTRUCTED — NOT CONNECTED', color: '#a78bfa' },
    legacy:        { text: 'LEGACY SAMPLE',                 color: '#9ca3af' },
    connected:     { text: 'CONNECTED',                     color: '#22c55e' },
    unavailable:   { text: 'UNAVAILABLE',                   color: '#6b7280' }
  };
  function n(x) { var v = parseFloat(x); return isFinite(v) ? v : null; }
  function isoDay(t) { if (!t) return null; var d = new Date(t); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  // ctx is built from the Finance state; nothing here mutates it.
  function buildCtx(D, nowMs) {
    D = D || {}; var g = D.finGoals || {}, ie = D.investmentEngine || {}, monthly = ie.monthly || {}, hold = (D.portfolio && D.portfolio.holdings) || [];
    var lastIE = null; Object.keys(monthly).forEach(function (k) { var t = monthly[k] && monthly[k].recordedAt; if (t && (!lastIE || new Date(t) > new Date(lastIE))) lastIE = t; });
    var lastHold = null; hold.forEach(function (h) { var t = h && (h.lastEditedAt || h.updatedAt); if (t && (!lastHold || new Date(t) > new Date(lastHold))) lastHold = t; });
    var lastIEAny = lastIE && lastHold ? (new Date(lastIE) > new Date(lastHold) ? lastIE : lastHold) : (lastIE || lastHold);
    var ym = null; if (typeof D.__ym === 'string') ym = D.__ym; else { var d0 = new Date(nowMs || Date.now()); ym = d0.toISOString().slice(0, 7); }
    var rev = D.engineRevenue || {}, revEntries = 0; Object.keys(rev).forEach(function (e) { var m = rev[e] || {}; Object.keys(m).forEach(function (k) { if (n(m[k]) !== null) revEntries++; }); });
    return {
      now: nowMs || Date.now(), plaidConnected: !!D.plaidConnected, plaidItems: arr(D.plaidItems).length, plaidLastSync: D.plaidLastSync || null, plaidInvestments: n(D.plaidInvestments) || 0, plaidLiabilities: arr(D.plaidLiabilities).length,
      efSource: D.efSourceAccountId || null, efCurrent: n(g.emergencyFundCurrent), goals: { efTarget: n(g.emergencyFundTarget), portfolioGoal: n(g.portfolioGoal), debtGoal: n(g.debtFreedomGoal), machineGoal: n(g.machineIncomeGoal), runwayGoal: n(g.runwayGoal) }, goalsConfirmed: (g._confirmed && typeof g._confirmed === 'object') ? g._confirmed : {},
      ie: { entries: Object.keys(monthly).length, holdings: hold.length, lastRecordedAt: lastIEAny, mode: D.portfolioMode || null }, revenueEntries: revEntries,
      snaps: arr(D.fsnapshots && D.fsnapshots.length ? D.fsnapshots : D.snapshots), debts: arr(D.debts).length, income: arr(D.income).length, expenses: arr(D.expenses).length, ym: ym
    };
  }
  function asOfText(iso) { var d = isoDay(iso); return d ? 'updated ' + d : 'last update not recorded'; }
  function mk(key, kind, extra) { var o = { key: key, kind: kind, label: KINDS[kind].text, color: KINDS[kind].color, asOf: null, asOfText: '', note: '' }; for (var k in extra) o[k] = extra[k]; return o; }
  function describe(key, c) {
    var connectedBank = c.plaidConnected && c.plaidItems > 0;
    switch (key) {
      case 'income': case 'expenses': case 'cashflow':
        return connectedBank ? mk(key, 'connected', { asOf: c.plaidLastSync, asOfText: 'synced ' + (isoDay(c.plaidLastSync) || 'time unknown'), note: 'Read from linked bank accounts' })
                             : mk(key, 'manual', { asOfText: 'last update not recorded', note: 'Typed-in entries; no bank is connected' });
      case 'availableCash':
        return connectedBank ? mk(key, 'connected', { asOf: c.plaidLastSync, asOfText: 'synced ' + (isoDay(c.plaidLastSync) || 'time unknown') }) : mk(key, 'manual', { asOfText: 'last update not recorded', note: 'Typed-in balance; not read from a bank' });
      case 'debts':
        return c.plaidLiabilities > 0 ? mk(key, 'connected', { asOf: c.plaidLastSync, asOfText: 'synced ' + (isoDay(c.plaidLastSync) || 'time unknown') }) : (c.debts ? mk(key, 'manual', { asOfText: 'last update not recorded', note: 'Typed-in debts' }) : mk(key, 'unavailable', { note: 'No debt entered or connected' }));
      case 'investmentValue':
        if (c.plaidInvestments > 0) return mk(key, 'connected', { asOf: c.plaidLastSync, asOfText: 'synced ' + (isoDay(c.plaidLastSync) || 'time unknown') });
        if (c.ie.entries || c.ie.holdings) return mk(key, 'manual', { asOf: c.ie.lastRecordedAt, asOfText: asOfText(c.ie.lastRecordedAt), note: 'Monthly manual entry; not connected to a brokerage', ageDays: c.ie.lastRecordedAt ? Math.floor((c.now - new Date(c.ie.lastRecordedAt).getTime()) / 86400000) : null });
        return mk(key, 'unavailable', { note: 'No Investment Engine entry' });
      case 'investmentGain':
        return mk(key, c.plaidInvestments > 0 ? 'connected' : 'manual', { label: 'MARKET GAIN / LOSS — NOT INCOME', asOf: c.ie.lastRecordedAt, asOfText: asOfText(c.ie.lastRecordedAt), note: 'Market gain or loss on investments — NOT earned income' });
      case 'businessRevenue':
        return c.revenueEntries ? mk(key, 'manual', { asOfText: 'last update not recorded', note: 'Typed-in engine revenue' }) : mk(key, 'unavailable', { note: 'No business revenue source is connected or entered' });
      case 'emergencyFund':
        if (connectedBank && c.efSource && c.efSource !== 'manual') return mk(key, 'connected', { asOf: c.plaidLastSync, asOfText: 'synced ' + (isoDay(c.plaidLastSync) || 'time unknown') });
        if (c.efCurrent === SEEDS.efCurrent) return mk(key, 'seeded', { note: 'The default shipped with the app (' + SEEDS.efCurrent.toLocaleString('en-US') + '); not a verified account balance' });
        return mk(key, 'manual', { asOfText: 'last update not recorded', note: 'Typed-in amount; not read from an account' });
      case 'goalTarget': return null;   // per target: describeTarget()
      case 'netWorth':
        var parts = [describe('availableCash', c), describe('investmentValue', c), describe('debts', c)], allConn = parts.every(function (p) { return p.kind === 'connected'; });
        return allConn ? mk(key, 'connected', { note: 'Calculated from connected accounts' }) : mk(key, 'manual', { label: 'CALCULATED FROM MANUAL ENTRIES', note: 'Cash, Investment Engine and debts are typed-in values; no account is connected', parts: parts.map(function (p) { return p.key + ':' + p.kind; }) });
      case 'machineIncome':
        return mk(key, 'manual', { label: 'MIXED — INCLUDES MARKET GAIN', note: 'Business revenue (' + (c.revenueEntries ? 'typed-in' : 'none entered') + ') plus the average monthly investment market gain, which is not earned income' });
      case 'savingsRate': return mk(key, connectedBank ? 'connected' : 'manual', { asOfText: connectedBank ? 'synced' : 'last update not recorded', note: 'Derived from income and expenses above' });
      default: return mk(key, 'unavailable', { note: 'Unknown figure' });
    }
  }
  function describeTarget(goalKey, c) {   // goalKey: efTarget | portfolioGoal | debtGoal | machineGoal | runwayGoal
    var v = c.goals[goalKey], seed = SEEDS[goalKey], stored = { efTarget: 'emergencyFundTarget', portfolioGoal: 'portfolioGoal', debtGoal: 'debtFreedomGoal', machineGoal: 'machineIncomeGoal', runwayGoal: 'runwayGoal' }[goalKey];
    var confirmed = !!(c.goalsConfirmed && stored && c.goalsConfirmed[stored]);   // phase 3B: a target the CEO explicitly set (even if it equals the old default) is confirmed
    return (v === seed && !confirmed) ? mk('target:' + goalKey, 'seeded', { label: 'DEFAULT TARGET — NOT CONFIRMED', note: 'The default target shipped with the app' }) : mk('target:' + goalKey, 'manual', { label: 'TARGET SET BY YOU', note: 'Typed-in target' });
  }
  // Net-worth chart history: which points are reconstructed, which are computed from manual entries, which are connected.
  function historyProfile(snaps) {
    var rec = 0, drv = 0, con = 0, lastRec = null, firstDrv = null;
    arr(snaps).forEach(function (s) { var src = s && s.source, d = s && (s.date || s.d); if (src === 'backfill') { rec++; if (!lastRec || d > lastRec) lastRec = d; } else if (src === 'live' || src === 'migrated' || src === undefined) { if (s && s.plaidActive) con++; else { drv++; if (!firstDrv || d < firstDrv) firstDrv = d; } } });
    var parts = []; if (rec) parts.push(rec + ' reconstructed points' + (lastRec ? ' up to ' + String(lastRec).slice(0, 10) : '') + ' (rebuilt from a stored timeline — not connected)');
    if (drv) parts.push(drv + ' points computed from manual entries' + (firstDrv ? ' from ' + String(firstDrv).slice(0, 10) : ''));
    if (con) parts.push(con + ' points from a connected bank');
    return { reconstructed: rec, derived: drv, connected: con, lastReconstructed: lastRec, firstDerived: firstDrv, text: parts.length ? 'Chart history: ' + parts.join('; ') + '. No point is a verified balance.' : 'No history points.' };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function chip(d, opt) {
    if (!d) return ''; opt = opt || {}; var asof = d.asOfText && d.kind !== 'seeded' && d.kind !== 'unavailable' ? ' · ' + d.asOfText : '';
    return '<span class="fin-src" data-kind="' + esc(d.kind) + '" data-key="' + esc(d.key) + '" title="' + esc(d.note || '') + '" style="display:inline-block;font-size:8px;font-weight:700;letter-spacing:0.6px;color:' + d.color + ';border:1px solid ' + d.color + ';border-radius:8px;padding:0 6px;margin:' + (opt.margin || '2px 0 0 0') + ';font-family:\'JetBrains Mono\',monospace;white-space:normal;line-height:1.35;max-width:100%">' + esc(d.label) + esc(asof) + '</span>';
  }
  var api = { SEEDS: SEEDS, KINDS: KINDS, buildCtx: buildCtx, describe: describe, describeTarget: describeTarget, historyProfile: historyProfile, chip: chip };
  if (typeof module === 'object' && module && module.exports) module.exports = api; else root.FinSrc = api;
})(typeof window !== 'undefined' ? window : this);
