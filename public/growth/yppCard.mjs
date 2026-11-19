// R-C1 release B — Revenue/YPP card model: OFFICIAL dated YouTube Studio → Earn figures only. PURE (no network, database or clock except values passed in).
// Rules enforced in code and tests:
//  - every figure shown is OFFICIAL (copied from a dated Studio capture), a labeled APP COUNTER (never an Earn figure), or UNAVAILABLE ("Not available" — never 0);
//  - the eligibility status is derived ONLY from the captured official record; app analytics, API estimates and counters can never change it (they are not even inputs);
//  - the word "eligible" is only ever applied to a business when the capture itself carries studio_eligible === true; there is no "ready" state at all;
//  - a missing, invalid or stale capture is shown explicitly; each business uses only its own records (channel id keyed, foreign records rejected).
export const YPP_BUSINESSES = Object.freeze({
  silk_road_voices: Object.freeze({ name: 'Silk Road Voices', engine: 'SRV Farsi', channelId: 'UCCUa5BLzGh2eRBoqqWBCK_g' }),
  srv_studio: Object.freeze({ name: 'SRV Studio', engine: 'SRV English', channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' }),
});
export const YPP_FRESH_DAYS = 7;
export const YPP_STORE_KEY = 'ypp_earn_capture';
const DAY = 86400000;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s || '')) && Number.isFinite(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'));
const nn = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

// Validate ONE capture record. `channelId` is the business channel the record is stored under; a record that names another channel is refused.
export function validateCapture(rec, channelId) {
  const e = [];
  if (!rec || typeof rec !== 'object') return { ok: false, errors: ['not_an_object'] };
  if (rec.channel_id !== undefined && rec.channel_id !== channelId) e.push('record names another channel (isolation)');
  if (!isDate(rec.captured_at)) e.push('captured_at (date) required');
  if (!isDate(rec.data_as_of)) e.push('data_as_of (date shown by Studio) required');
  for (const k of ['subscribers', 'public_watch_hours_12m', 'shorts_views_90d', 'uploads_90d']) if (!nn(rec[k])) e.push(k + ' must be a number >= 0');
  if (typeof rec.status_text !== 'string' || !rec.status_text.trim()) e.push('status_text (verbatim from Studio) required');
  if (typeof rec.captured_by !== 'string' || !rec.captured_by.trim()) e.push('captured_by required');
  if (rec.source !== 'YouTube Studio > Earn') e.push('source must be "YouTube Studio > Earn"');
  for (const t of ['tier_early', 'tier_full']) { const x = rec[t]; if (x !== undefined && x !== null && !(x && typeof x === 'object' && nn(x.subscribers) && nn(x.watch_hours) && nn(x.shorts_views) && (x.uploads === undefined || nn(x.uploads)))) e.push(t + ' thresholds invalid'); }
  if (rec.studio_eligible !== undefined && typeof rec.studio_eligible !== 'boolean') e.push('studio_eligible must be true/false when present');
  return { ok: e.length === 0, errors: e };
}
// The stored value: { "<channel_id>": [ capture, … ] }. Unreadable JSON, unknown channel keys and non-array values are reported, never trusted.
export function parseCaptureStore(raw) {
  const errors = [], byChannel = {};
  if (raw === null || raw === undefined || raw === '') return { byChannel, errors, present: false };
  let v; try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { byChannel, errors: ['unreadable_store'], present: true }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { byChannel, errors: ['store_not_an_object'], present: true };
  const ids = Object.values(YPP_BUSINESSES).map((b) => b.channelId);
  for (const k of Object.keys(v)) { if (!ids.includes(k)) { errors.push('unknown_channel_key_ignored'); continue; } if (!Array.isArray(v[k])) { errors.push('records_not_an_array:' + k); continue; } byChannel[k] = v[k]; }
  return { byChannel, errors, present: true };
}
const fmt = (n) => Number(n).toLocaleString('en-US');
// ONE business → the card model. `appCounters` (e.g. {subscribers}) is accepted ONLY for display as a labeled app counter; it never enters the status.
export function buildYppModel({ business, records, nowMs, appCounters = null }) {
  const b = YPP_BUSINESSES[business]; if (!b) throw new Error('unknown business');
  const valid = [], invalid = [];
  for (const r of Array.isArray(records) ? records : []) { const v = validateCapture(r, b.channelId); (v.ok ? valid : invalid).push(r); }
  valid.sort((x, y) => String(y.captured_at).localeCompare(String(x.captured_at)));
  const cap = valid[0] || null;
  const ageDays = cap ? Math.floor((nowMs - Date.parse(String(cap.captured_at).slice(0, 10) + 'T00:00:00Z')) / DAY) : null;
  let state = !cap ? (invalid.length ? 'invalid' : 'not_captured') : (ageDays < 0 ? 'invalid' : ageDays > YPP_FRESH_DAYS ? 'stale' : 'fresh');
  const m = { business, name: b.name, engine: b.engine, channelId: b.channelId, state, capturedAt: cap ? String(cap.captured_at).slice(0, 10) : null, dataAsOf: cap ? String(cap.data_as_of).slice(0, 10) : null, ageDays, invalidRecords: invalid.length,
    source: 'YouTube Studio → Earn', official: null, studioWording: null, thresholds: null, eligibility: null, appCounter: null, unavailable: [], notes: [] };
  if (cap && state !== 'invalid') {
    m.official = [
      { key: 'subscribers', label: 'Subscribers', value: cap.subscribers, text: fmt(cap.subscribers) },
      { key: 'uploads_90d', label: 'Public uploads (90 days)', value: cap.uploads_90d, text: fmt(cap.uploads_90d) },
      { key: 'public_watch_hours_12m', label: 'Qualified public watch hours (365 days)', value: cap.public_watch_hours_12m, text: fmt(cap.public_watch_hours_12m) },
      { key: 'shorts_views_90d', label: 'Qualified Shorts views (90 days)', value: cap.shorts_views_90d, text: (cap.shorts_views_rounded ? '≈ ' : '') + fmt(cap.shorts_views_90d) + (cap.shorts_views_rounded ? ' (rounded as shown by Studio)' : '') },
    ];
    m.studioWording = String(cap.status_text); m.thresholds = { early: cap.tier_early || null, full: cap.tier_full || null };
    // eligibility — from the capture ONLY
    const meets = (t) => t && cap.subscribers >= t.subscribers && (t.uploads === undefined || cap.uploads_90d >= t.uploads) && (cap.public_watch_hours_12m >= t.watch_hours || cap.shorts_views_90d >= t.shorts_views);
    if (state === 'stale') m.eligibility = { status: 'unknown_stale', text: `Unknown — the last Studio capture is ${ageDays} days old (${m.capturedAt}); capture again before relying on it` };
    else if (cap.studio_eligible === true) m.eligibility = { status: 'eligible_per_studio', text: `Eligible — Studio states eligibility (data as of ${m.dataAsOf})` };
    else if (meets(cap.tier_early) || meets(cap.tier_full)) m.eligibility = { status: 'figures_meet_threshold_unconfirmed', text: `Studio's figures meet a threshold shown by Studio, but Studio's own eligibility status was not confirmed in this capture — check Studio → Earn (data as of ${m.dataAsOf})` };
    else if (cap.tier_early || cap.tier_full) m.eligibility = { status: 'not_yet_eligible_per_studio', text: `Not yet eligible — Studio's figures are below Studio's thresholds (data as of ${m.dataAsOf})` };
    else m.eligibility = { status: 'unknown_no_thresholds', text: 'Unknown — the capture has no thresholds to compare with' };
  } else {
    m.eligibility = { status: state === 'invalid' ? 'unknown_invalid' : 'unknown_not_captured', text: state === 'invalid' ? 'Unknown — the stored capture is invalid and was ignored' : 'Unknown — no official Studio Earn capture has been stored yet' };
  }
  if (appCounters && nn(appCounters.subscribers)) m.appCounter = { label: 'Subscribers (app counter from the YouTube Data API — not an Earn figure; may differ from Studio by timing or rounding)', value: appCounters.subscribers, text: fmt(appCounters.subscribers) };
  m.unavailable = [
    { label: 'Qualified watch hours / Shorts views from the API', reason: 'YouTube provides no such field; API-derived estimates did not reconcile with Studio (SRV Studio: 31 h vs 6 h official). Studio → Earn is the only source.' },
    { label: 'Ad-excluded hours', reason: 'Not available outside Studio.' },
    { label: 'Revenue', reason: state === 'fresh' && /not yet eligible/i.test(m.eligibility.text) ? 'No YouTube revenue yet: Studio shows the channel is not in the Partner Program (official capture ' + m.capturedAt + ').' : 'Unknown until an official capture shows the Partner Program status.' },
  ];
  m.notes = ['Paid (advertising) views and Shorts-feed watch time do not count toward qualified watch hours.', 'Figures come from dated manual captures of YouTube Studio → Earn; nothing on this card is computed from app analytics.'];
  return m;
}
// Pure HTML renderer (the page passes its own escape function). It never contains a "ready" state.
export function renderYppCardHtml(m, esc = (s) => String(s)) {
  const chip = (t, c) => `<span style="color:${c};border:1px solid ${c};border-radius:8px;padding:0 6px;font-size:9px;margin-left:6px">${esc(t)}</span>`;
  const fr = m.state === 'fresh' ? chip(`captured ${m.ageDays} day${m.ageDays === 1 ? '' : 's'} ago`, '#22c55e') : m.state === 'stale' ? chip(`STALE — captured ${m.ageDays} days ago`, '#f59e0b') : m.state === 'invalid' ? chip('INVALID capture ignored', '#ef4444') : chip('NOT CAPTURED', '#6b7280');
  const col = { not_yet_eligible_per_studio: '#c9a84c', eligible_per_studio: '#22c55e', figures_meet_threshold_unconfirmed: '#f59e0b' }[m.eligibility.status] || '#6b7280';
  let h = `<div class="ypp-card" data-business="${esc(m.business)}" data-state="${esc(m.state)}" style="border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:12px;margin-bottom:10px;background:rgba(0,0,0,0.2)">`;
  h += `<div style="font-size:13px;font-weight:700;color:#fff">${esc(m.name)}${fr}</div>`;
  h += `<div style="font-size:11px;font-weight:700;color:${col};margin:6px 0">${esc(m.eligibility.text)}</div>`;
  if (m.official) {
    h += `<div style="font-size:9px;color:var(--dim);margin-bottom:4px">OFFICIAL · ${esc(m.source)} · data as of ${esc(m.dataAsOf)} · captured ${esc(m.capturedAt)}</div><table style="width:100%;border-collapse:collapse;font-size:10px;font-family:'JetBrains Mono',monospace">`;
    for (const o of m.official) h += `<tr style="border-top:1px solid rgba(255,255,255,0.05)"><td style="padding:2px 4px;color:#fff">${esc(o.label)}</td><td style="padding:2px 4px;text-align:right">${esc(o.text)}</td></tr>`;
    h += '</table>';
    const tr = (t, n) => t ? `<div style="font-size:10px;color:var(--dim);margin-top:3px">${esc(n)} (as shown by Studio): ${esc(fmt(t.subscribers))} subscribers${t.uploads !== undefined ? ' · ' + esc(t.uploads) + ' uploads in 90 days' : ''} · and one of: ${esc(fmt(t.watch_hours))} qualified watch hours (365 days) or ${esc(fmt(t.shorts_views))} qualified Shorts views (90 days)</div>` : '';
    h += tr(m.thresholds.early, 'Early tier') + tr(m.thresholds.full, 'Full tier');
    h += `<div style="font-size:10px;color:var(--dim);margin-top:6px">Studio wording, verbatim: “${esc(m.studioWording)}”</div>`;
  } else h += `<div style="font-size:10px;color:var(--dim);margin:4px 0">No official figures to show. Official figures are not computed by the app.</div>`;
  if (m.appCounter) h += `<div style="font-size:10px;color:var(--dim);margin-top:6px">${esc(m.appCounter.label)}: <b style="color:#fff">${esc(m.appCounter.text)}</b></div>`;
  h += `<details style="margin-top:6px"><summary style="font-size:10px;color:var(--dim);cursor:pointer">Not available (${m.unavailable.length}) · notes</summary><div style="font-size:10px;color:var(--dim);line-height:1.6;margin-top:4px">${m.unavailable.map((u) => '• <b style="color:#fff">' + esc(u.label) + '</b> — ' + esc(u.reason)).join('<br>')}<br>${m.notes.map((n) => '• ' + esc(n)).join('<br>')}</div></details></div>`;
  return h;
}
