// SRV-STUDIO-V2-031 — the CEO-approved SRV Studio weekly release schedule (approved 2026-10-24).
//   Long  → Friday 7:00 AM America/New_York
//   Short → Sunday 6:00 PM America/New_York, the Sunday after the Long it promotes
// This only PLANS the manual public release. Uploads stay private, publishAt is never set, and nothing is ever made
// public automatically — the VA makes the video public in YouTube Studio at the planned time.
// The same rules run in the app (public/index.html, _srvEnglishV2SchedulePlan); a test checks both give the same slots.
export const SRV2_RELEASE_SLOTS = Object.freeze({
  tz: 'America/New_York', status: 'approved', approvedAt: '2026-10-24', minLeadMinutes: 60,
  long: Object.freeze({ weekday: 5, hour: 7, minute: 0 }),
  short: Object.freeze({ weekday: 0, hour: 18, minute: 0 }),
});
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function srv2TzParts(ms, tz) {
  const o = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', timeZoneName: 'short' })
    .formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday), tzName: o.timeZoneName };
}
// UTC instant of a wall-clock time in tz; the offset is re-read at the candidate instant (DST-correct).
export function srv2ZonedToUtc(y, mo, d, h, mi, tz) {
  const want = Date.UTC(y, mo - 1, d, h, mi); let t = want;
  for (let i = 0; i < 4; i++) { const p = srv2TzParts(t, tz); const diff = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - want; if (!diff) break; t -= diff; }
  return t;
}
// Next free slot for `kind`: at least minLeadMinutes after nowMs, strictly after afterMs (a Short's Long release), and
// not one of `taken` (UTC ISO strings already planned for the same format) — one release per slot.
export function srv2PlanRelease(kind, nowMs, taken = [], afterMs = null, S = SRV2_RELEASE_SLOTS) {
  const slot = S[kind]; if (!slot) return null;
  const tk = new Set(taken || []);
  const earliest = Math.max(nowMs + S.minLeadMinutes * 60000, afterMs != null && isFinite(afterMs) ? afterMs + 60000 : -Infinity);
  const p = srv2TzParts(Math.max(nowMs, afterMs != null && isFinite(afterMs) ? afterMs : nowMs), S.tz);
  for (let add = 0; add < 140; add++) {
    const day = new Date(Date.UTC(p.y, p.mo - 1, p.d + add));
    if (day.getUTCDay() !== slot.weekday) continue;
    const utc = srv2ZonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), slot.hour, slot.minute, S.tz);
    if (utc < earliest) continue;
    const iso = new Date(utc).toISOString(); if (tk.has(iso)) continue;
    const lp = srv2TzParts(utc, S.tz);
    return { kind, tz: S.tz, tzName: lp.tzName, utcIso: iso, localDate: lp.y + '-' + String(lp.mo).padStart(2, '0') + '-' + String(lp.d).padStart(2, '0'), localTime: String(lp.h).padStart(2, '0') + ':' + String(lp.mi).padStart(2, '0'), weekday: WD[lp.wd], status: S.status, mode: 'manual-public' };
  }
  return null;
}
// Plan for a production upload from the ledger (server-authoritative, inside the claim compare-and-set):
// taken = live entries of the same format; a Short goes after its Long's planned release when the Long has one.
export function srv2PlanFromLedger(kind, ledger, nowMs, longPkgId = null) {
  const live = (ledger && ledger.entries || []).filter((e) => (e.status === 'pending' || e.status === 'uploaded') && e.plannedRelease && e.plannedRelease.utcIso);
  const taken = live.filter((e) => e.kind === kind).map((e) => e.plannedRelease.utcIso);
  let after = null;
  if (kind === 'short' && longPkgId) {
    const L = live.find((e) => e.kind === 'long' && e.pkgId === longPkgId);
    if (L) after = Date.parse(L.plannedRelease.utcIso);
  }
  const plan = srv2PlanRelease(kind, nowMs, taken, after);
  return plan ? { ...plan, ...(after != null ? { afterLongRelease: new Date(after).toISOString() } : {}) } : null;
}
