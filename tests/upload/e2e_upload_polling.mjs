// R-C1 release A in the REAL page (real Chrome, stub server): upload-detection polling — 5-minute cadence, visible tab only, CEO session header, visible problems, single flight. node tests/upload/e2e_upload_polling.mjs [publicDir]
import fs from 'node:fs';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle } from '../preservation/driver.mjs';
const pub = fs.realpathSync(process.argv[2] || 'public');
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + String(JSON.stringify(x)).slice(0, 300))); };
const stub = await startStub({ publicDir: pub, fixture: (() => { const f = makeFixture(); f.restFilter = true; return f; })(), quiet: true }); const browser = await launch();
try {
  const { page } = await openPage(browser, stub.origin, { realClock: true });
  await page.reload({ waitUntil: 'domcontentloaded' }); await login(page, stub.origin, 'admin'); await settle(page, stub.origin, 1500);
  const R = await page.evaluate(async () => {
    const out = {}; const calls = []; let notif = 0; const realFetch = window.fetch; let reply = { status: 200, body: { synced: 0, matched: 0, advanced: 0, channels: [{ business: 'SRV Farsi', status: 'ok' }, { business: 'SRV English', status: 'ok' }] } };
    window.fetch = async (u, i) => { const url = String(u && u.url || u); if (/action=youtube_sync_performance/.test(url)) { calls.push({ method: i && i.method, hdr: Object.keys((i && i.headers) || {}).join(), body: i && i.body }); await new Promise((r) => setTimeout(r, 30)); return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } }); } return realFetch(u, i); };
    window.loadNotifications = function () { notif++; };
    const vis = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    out.shouldRun = [_ydShouldRun(1000000, 0, true), _ydShouldRun(1000000, 800000, true), _ydShouldRun(1000000, 700000, true), _ydShouldRun(1000000, 0, false), _ydShouldRun(1000000, 700001, true)];
    // timer: notifications every 60 s; detection decided by the tick
    const delays = []; const realSI = window.setInterval; window.setInterval = function (f, d) { delays.push(d); return realSI.call(window, f, 3600000); };
    stopNotifPolling(); vis('visible'); startNotifPolling(); await new Promise((r) => setTimeout(r, 120)); out.intervalDelays = delays.slice(); out.callsAtStart = calls.length; window.setInterval = realSI;
    const t0 = calls.length; _ydLastSyncAt = Date.now() - 1000; _notifPollTick(); await new Promise((r) => setTimeout(r, 80)); out.tickTooSoon = calls.length - t0;
    _ydLastSyncAt = Date.now() - 301000; const n0 = notif; _notifPollTick(); await new Promise((r) => setTimeout(r, 120)); out.tickDue = calls.length - t0 - out.tickTooSoon; out.notifRefreshOnTick = notif - n0;
    vis('hidden'); _ydLastSyncAt = Date.now() - 600000; const h0 = calls.length, hn0 = notif; _notifPollTick(); await new Promise((r) => setTimeout(r, 120)); out.hiddenCalls = calls.length - h0; out.hiddenNotifRefresh = notif - hn0;
    vis('visible'); document.dispatchEvent(new Event('visibilitychange')); await new Promise((r) => setTimeout(r, 150)); out.visibleAgain = calls.length - h0;
    out.callShape = calls[calls.length - 1]; out.bellNoteOk = (document.getElementById('notifBell') || {}).title;
    // single flight
    _ydLastSyncAt = 0; const s0 = calls.length; await Promise.all([_ydRunSync(), _ydRunSync(), _ydRunSync()]); out.singleFlight = calls.length - s0;
    // problems become visible
    reply = { status: 401, body: { ok: false, error: 'ceo_authorization_required' } }; await _ydRunSync(); out.note401 = window._uploadDetectionNote; out.bellOutline = (document.getElementById('notifBell') || {}).style.outline;
    reply = { status: 200, body: { synced: 0, matched: 0, advanced: 0, channels: [{ business: 'SRV Farsi', status: 'quota_exceeded', reason: 'quotaExceeded' }, { business: 'SRV English', status: 'ok' }] } }; await _ydRunSync(); out.noteQuota = window._uploadDetectionNote;
    reply = { status: 200, body: { synced: 0, matched: 0, advanced: 0, channels: [{ business: 'SRV Farsi', status: 'throttled' }, { business: 'SRV English', status: 'in_progress' }] } }; await _ydRunSync(); out.noteThrottled = window._uploadDetectionNote;
    reply = { status: 200, body: { synced: 0, matched: 0, advanced: 0, channels: [{ business: 'SRV Farsi', status: 'ok' }, { business: 'SRV English', status: 'ok' }] } }; await _ydRunSync(); out.noteCleared = window._uploadDetectionNote; out.bellOutlineCleared = (document.getElementById('notifBell') || {}).style.outline;
    const src = String(_ydRunSync) + String(_notifPollTick) + String(startNotifPolling); out.noSearch = !/search/.test(src) && !/channelIds/.test(src) && !/googleapis/.test(src);
    stopNotifPolling(); window.fetch = realFetch; return out;
  });
  ok('the cadence rule: asks only when the tab is visible AND at least 5 minutes (300,000 ms) passed since the last ask: due, 200 s ago, exactly 300 s ago, hidden, 299.999 s ago', R.shouldRun.join() === 'true,false,true,false,false', R.shouldRun);
  ok('notifications still refresh on the 60-second timer (unchanged); detection is NOT a separate 60-second poll any more', R.intervalDelays.length === 1 && R.intervalDelays[0] === 60000, R.intervalDelays);
  ok('login with a visible tab asks the server once at once; a tick 1 s later does NOT ask again (5-minute cadence)', R.callsAtStart === 1 && R.tickTooSoon === 0, [R.callsAtStart, R.tickTooSoon]);
  ok('a tick more than 5 minutes after the last ask does ask, and the notification refresh also runs on every tick', R.tickDue === 1 && R.notifRefreshOnTick === 1, [R.tickDue, R.notifRefreshOnTick]);
  ok('a HIDDEN tab does not ask (even when overdue) but still refreshes notifications; when it becomes visible again it asks at once', R.hiddenCalls === 0 && R.hiddenNotifRefresh === 1 && R.visibleAgain === 1, [R.hiddenCalls, R.hiddenNotifRefresh, R.visibleAgain]);
  ok('the request is a POST with the CEO session header and an EMPTY body — the page no longer sends channel ids (the server decides)', R.callShape.method === 'POST' && /x-mmm-ceo-session/i.test(R.callShape.hdr) && R.callShape.body === '{}', R.callShape);
  ok('SINGLE FLIGHT in the page: three simultaneous asks make one request', R.singleFlight === 1, R.singleFlight);
  ok('PROBLEMS ARE VISIBLE: 401 → "sign in again"; a quota error names the business and reason; the bell shows an amber outline; a healthy answer clears it', /sign in again/.test(R.note401) && R.bellOutline.length > 0 && /SRV Farsi — quota_exceeded \(quotaExceeded\)/.test(R.noteQuota) && !/SRV English/.test(R.noteQuota) && R.noteCleared === '' && R.bellOutlineCleared === '', R);
  ok('throttled / in-progress answers are normal (no alarm)', R.noteThrottled === '', R.noteThrottled);
  ok('the page code that polls contains no search call, no channel ids and no direct Google host', R.noSearch);
} finally { await browser.close(); await stub.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
