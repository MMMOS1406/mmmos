// R-C1 release B — Revenue/YPP card: official-only model, property tests, REAL server handler executed with stubs, static review. node tests/ypp/test_ypp_card.mjs
// All figures below are synthetic. No real analytics values are used in this public test file.
import fs from 'node:fs';
import * as Y from '../../lib/yppCard.mjs';
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d !== undefined ? JSON.stringify(d).slice(0, 300) : ''); } };
const FARSI = Y.YPP_BUSINESSES.silk_road_voices.channelId, ENG = Y.YPP_BUSINESSES.srv_studio.channelId;
const NOW = Date.parse('2030-03-10T12:00:00Z');
const cap = (over = {}) => ({ captured_at: '2030-03-08', data_as_of: '2030-03-06', subscribers: 120, public_watch_hours_12m: 500, shorts_views_90d: 40000, shorts_views_rounded: true, uploads_90d: 4,
  tier_early: { subscribers: 500, uploads: 3, watch_hours: 3000, shorts_views: 3000000 }, tier_full: { subscribers: 1000, watch_hours: 4000, shorts_views: 10000000 },
  status_text: 'Not yet eligible. Keep going.', captured_by: 'CEO session (manual read of Studio)', source: 'YouTube Studio > Earn', ...over });
const model = (business, records, extra = {}) => Y.buildYppModel({ business, records, nowMs: NOW, ...extra });

// 1. capture validation
ok('a complete dated capture validates', Y.validateCapture(cap(), FARSI).ok);
ok('missing dates / numbers / verbatim wording / source are refused', ['captured_at', 'data_as_of', 'subscribers', 'status_text', 'source', 'captured_by'].every((k) => { const c = cap(); delete c[k]; return !Y.validateCapture(c, FARSI).ok; }));
ok('numbers must be real numbers >= 0 (a string, NaN, negative are refused — never coerced to 0)', ['120', NaN, -1, null, undefined].every((v) => !Y.validateCapture(cap({ subscribers: v }), FARSI).ok));
ok('ISOLATION: a record naming the other channel is refused', !Y.validateCapture(cap({ channel_id: ENG }), FARSI).ok && Y.validateCapture(cap({ channel_id: FARSI }), FARSI).ok);
ok('studio_eligible, when present, must be a boolean', !Y.validateCapture(cap({ studio_eligible: 'yes' }), FARSI).ok);
// 2. store parsing
ok('absent store → not present, nothing invented', (() => { const s = Y.parseCaptureStore(null); return !s.present && Object.keys(s.byChannel).length === 0; })());
ok('unreadable / non-object stores are reported, never trusted', Y.parseCaptureStore('{nope').errors.includes('unreadable_store') && Y.parseCaptureStore('[1]').errors.includes('store_not_an_object'));
ok('unknown channel keys are ignored and reported; non-array records are reported', (() => { const s = Y.parseCaptureStore(JSON.stringify({ UCsomethingelse: [cap()], [FARSI]: 'x', [ENG]: [cap()] })); return s.errors.includes('unknown_channel_key_ignored') && s.errors.some((e) => e.startsWith('records_not_an_array')) && !s.byChannel.UCsomethingelse && s.byChannel[ENG].length === 1; })());
// 3. model states
{ const m = model('silk_road_voices', []);
  ok('NO CAPTURE → "Not captured": no figures, eligibility unknown, revenue unknown — and no zero is displayed', m.state === 'not_captured' && m.official === null && /^Unknown/.test(m.eligibility.text) && m.unavailable.some((u) => /Revenue/.test(u.label) && /Unknown/.test(u.reason)) && !/\b0\b/.test(Y.renderYppCardHtml(m).replace(/<[^>]*>/g, ' ')), m); }
{ const m = model('silk_road_voices', [cap()]);
  ok('FRESH capture below Studio\'s thresholds → "Not yet eligible" with the capture date and Studio\'s data date; official figures exactly as captured', m.state === 'fresh' && m.eligibility.status === 'not_yet_eligible_per_studio' && /2030-03-06/.test(m.eligibility.text) && m.official.find((o) => o.key === 'subscribers').value === 120 && m.dataAsOf === '2030-03-06' && m.capturedAt === '2030-03-08', m);
  const html = Y.renderYppCardHtml(m, (s) => String(s));
  ok('rounded Shorts figures are shown as rounded, Studio wording is quoted verbatim, thresholds are attributed to Studio', /≈ 40,000/.test(html) && /rounded as shown by Studio/.test(html) && /Not yet eligible\. Keep going\./.test(html) && /as shown by Studio/.test(html));
  ok('revenue explanation names the official capture date, does not invent a figure', m.unavailable.find((u) => /Revenue/.test(u.label)).reason.includes('2030-03-08')); }
{ const m = model('silk_road_voices', [cap({ captured_at: '2030-02-20' })]);
  ok('STALE capture (> 7 days) is labelled stale with its age and eligibility becomes unknown', m.state === 'stale' && m.eligibility.status === 'unknown_stale' && m.ageDays === 18 && /18 days old/.test(m.eligibility.text) && /STALE/.test(Y.renderYppCardHtml(m))); }
{ const m = model('silk_road_voices', [cap({ captured_at: '2030-04-01' })]);
  ok('a capture dated in the FUTURE is invalid, not fresh', m.state === 'invalid' && m.official === null); }
{ const m = model('silk_road_voices', [{ subscribers: 5 }]);
  ok('an INVALID record is ignored and said so — no figures', m.state === 'invalid' && m.official === null && /invalid/i.test(m.eligibility.text) && m.invalidRecords === 1); }
{ const mNo = model('srv_studio', [cap({ tier_early: { subscribers: 10, uploads: 3, watch_hours: 100, shorts_views: 1000 } })]);
  ok('figures that meet a Studio threshold are NOT called eligible unless the capture says Studio states eligibility', mNo.eligibility.status === 'figures_meet_threshold_unconfirmed' && !/^Eligible/.test(mNo.eligibility.text));
  const mYes = model('srv_studio', [cap({ studio_eligible: true, status_text: 'Eligible to apply' })]);
  ok('"Eligible" appears only with studio_eligible === true in the capture, attributed to Studio', mYes.eligibility.status === 'eligible_per_studio' && /Studio states eligibility/.test(mYes.eligibility.text)); }
{ const m = model('silk_road_voices', [cap({ captured_at: '2030-03-01' }), cap({ captured_at: '2030-03-09', subscribers: 130 }), cap({ captured_at: '2030-03-05', subscribers: 125 })]);
  ok('the NEWEST valid capture is used', m.capturedAt === '2030-03-09' && m.official.find((o) => o.key === 'subscribers').value === 130); }
// 4. PROPERTY: app numbers can never change status or official figures; no "ready" state exists
{ let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; let same = true, noReady = true;
  for (let i = 0; i < 400; i++) {
    const base = cap({ subscribers: Math.floor(rnd() * 3000), public_watch_hours_12m: Math.floor(rnd() * 6000), shorts_views_90d: Math.floor(rnd() * 2e7), captured_at: rnd() < 0.5 ? '2030-03-08' : '2030-02-01', studio_eligible: rnd() < 0.2 ? true : undefined });
    const a = model('silk_road_voices', [base]); const b = model('silk_road_voices', [base], { appCounters: { subscribers: Math.floor(rnd() * 1e7) } });
    if (a.eligibility.status !== b.eligibility.status || a.eligibility.text !== b.eligibility.text || JSON.stringify(a.official) !== JSON.stringify(b.official)) same = false;
    const h = Y.renderYppCardHtml(b, (s) => String(s)); if (/\bready\b|YPP-READY|READY/i.test(h)) noReady = false;
  }
  ok('PROPERTY (400 random captures): app counters never change the status, the text or the official figures', same);
  ok('PROPERTY: the rendered card never contains a "ready" state', noReady); }
ok('the app counter is shown only as a labelled non-Earn figure', (() => { const m = model('silk_road_voices', [cap()], { appCounters: { subscribers: 999 } }); return /app counter/.test(m.appCounter.label) && /not an Earn figure/.test(m.appCounter.label); })());
// 5. isolation of businesses
{ const farsiRecs = [cap({ channel_id: FARSI })]; const m = model('srv_studio', farsiRecs);
  ok('ISOLATION: another business\'s capture is never shown on this business\'s card', m.state === 'invalid' && m.official === null); }
ok('HTML is escaped by the caller\'s escape function (verbatim Studio wording cannot inject markup)', (() => { const m = model('silk_road_voices', [cap({ status_text: '<img src=x onerror=alert(1)>' })]); const html = Y.renderYppCardHtml(m, (s) => String(s).replace(/</g, '&lt;')); return !html.includes('<img'); })());

// 6. REAL server handler with stubs
const ops = fs.readFileSync(new URL('../../api/ops.js', import.meta.url), 'utf8');
const h0 = ops.indexOf('async function revenueDashboard('), h1 = ops.indexOf('// v13.58.1 PRIORITY B — Decision Engine.'), handlerSrc = ops.slice(h0, h1);
const world = (over = {}) => { const w = { ceo: true, reads: [], writes: [], store: null, ...over };
  const stubs = { requireCeoSession: async () => w.ceo, sbGet: async (q) => { w.reads.push(q);
      if (/^youtube_channels/.test(q)) return [{ channel_id: FARSI, title: 'A', mmm_engine: 'SRV Farsi', subscribers: 150 }, { channel_id: ENG, title: 'B', mmm_engine: 'SRV English', subscribers: 20 }];
      if (/^youtube_videos_analytics/.test(q)) return [{ video_id: 'v' }]; if (/^youtube_channel_snapshots/.test(q)) return [{ snapshot_date: '2030-01-01', subscribers: 100 }];
      if (/^app_settings/.test(q)) return w.store === null ? [] : [{ value: typeof w.store === 'string' ? w.store : JSON.stringify(w.store) }]; return []; },
    sbInsert: () => { w.writes.push('insert'); throw new Error('write attempted'); }, sbPatch: () => { w.writes.push('patch'); throw new Error('write attempted'); }, sbUpsert: () => { w.writes.push('upsert'); throw new Error('write attempted'); }, fetch: () => { throw new Error('network attempted'); },
    _yppParseStore: Y.parseCaptureStore, _yppBuild: Y.buildYppModel, _yppBusinesses: Y.YPP_BUSINESSES, _yppStoreKey: Y.YPP_STORE_KEY, _yppFreshDays: Y.YPP_FRESH_DAYS, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } } };
  const names = Object.keys(stubs);
  w.handler = new Function(...names, handlerSrc + '\nreturn revenueDashboard;')(...names.map((k) => stubs[k]));
  w.call = async () => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(x) { res.body = x; return res; } }; await w.handler({ method: 'GET', query: {}, headers: {} }, res); return res; };
  return w; };
{ const w = world({ ceo: false }); const r = await w.call();
  ok('WITHOUT a CEO session: no official model and the capture store is never read', r.code === 200 && r.body.ypp === null && !w.reads.some((q) => /^app_settings/.test(q))); }
{ const w = world(); const r = await w.call();
  ok('CEO, store ABSENT → both businesses "not captured"; store key read once; nothing written', r.body.ypp.storePresent === false && r.body.ypp.cards.length === 2 && r.body.ypp.cards.every((c) => c.state === 'not_captured') && w.reads.filter((q) => /^app_settings/.test(q)).length === 1 && w.writes.length === 0); }
{ const w = world({ store: { [FARSI]: [cap()] } }); const r = await w.call(); const f = r.body.ypp.cards.find((c) => c.business === 'silk_road_voices'), e = r.body.ypp.cards.find((c) => c.business === 'srv_studio');
  ok('CEO, capture only for Silk Road Voices → that card is fresh; SRV Studio stays "not captured" (no cross-business bleed)', f.state === 'fresh' && f.official.find((o) => o.key === 'subscribers').value === 120 && e.state === 'not_captured' && e.official === null);
  ok('READ-ONLY: the handler made no write of any kind and no external request', w.writes.length === 0);
  ok('the app subscriber counter reaches the card only as a labelled app counter', f.appCounter && f.appCounter.value === 150 && f.official.find((o) => o.key === 'subscribers').value === 120); }
{ const w = world({ store: '{broken' }); const r = await w.call();
  ok('a corrupted store is reported and shows "not captured" — never zeros', r.body.ypp.storeErrors.includes('unreadable_store') && r.body.ypp.cards.every((c) => c.state === 'not_captured' && c.official === null)); }
{ const w = world(); const r = await w.call(); const keys = JSON.stringify(r.body);
  ok('the calculated-readiness fields are GONE from the response (yppReady, watchHours12m, shortsViews90d, progress, etaToYppDays, thresholds)', !/yppReady|watchHours12m|shortsViews90d|etaToYppDays|"progress"|"thresholds":\{"subs"/.test(keys));
  ok('fields strategyRecompute still depends on are kept (uploads30d, engine)', r.body.perChannel.every((c) => typeof c.uploads30d === 'number' && c.engine) && /rev && rev\.uploads30d/.test(ops)); }
// 7. static review
const page = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
ok('page: no "YPP-READY", no 4000/10M progress bars, no ETA, no computed readiness left', !/YPP-READY|WATCH HRS \/ 4000|SHORTS VIEWS \/ 10M|etaToYppDays|c\.yppReady/.test(page));
ok('server: the calculated thresholds are gone', !/YPP_WATCH_HOURS_12M|YPP_SHORTS_VIEWS_90D|yppReady/.test(ops));
ok('page: Marketing no longer claims "N subs to monetization" from the app counter', !/subs to monetization|subs from monetization/.test(page));
ok('page copy of the card module is byte-identical to the library', fs.readFileSync(new URL('../../lib/yppCard.mjs', import.meta.url), 'utf8') === fs.readFileSync(new URL('../../public/growth/yppCard.mjs', import.meta.url), 'utf8'));
ok('the card module has no network/database/clock access', !/\b(fetch|XMLHttpRequest|require\(|process\.|Date\.now|new Date\()/.test(fs.readFileSync(new URL('../../lib/yppCard.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
