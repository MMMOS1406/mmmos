// Per-channel background-sync switch (CEO portfolio decision 2026-11-09: NextWave, AI Creation Studio and SMM are being retired).
// One config row, app_settings key `sync_disabled_channels`: {"youtube":["<channel_id>",…],"tiktok":["<open_id>",…]}. Absent / empty / unreadable = nothing is disabled,
// i.e. today's behaviour exactly. It only makes the scheduled sync and the analytics pull SKIP a listed channel/account: it never touches a token, a connection row,
// a published video or any data. SRV Farsi and SRV English can never be skipped: a listed id is honoured only when the channel's own engine tag is known AND is not retained.
export const CONFIG_KEY = 'sync_disabled_channels';
export const RETAINED_ENGINES = Object.freeze(['SRV Farsi', 'SRV English']);
const asSet = (a) => new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.length > 0 && x.length < 200) : []);
export function parseDisabled(raw) {
  try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; return v && typeof v === 'object' ? { youtube: asSet(v.youtube), tiktok: asSet(v.tiktok) } : { youtube: new Set(), tiktok: new Set() }; }
  catch { return { youtube: new Set(), tiktok: new Set() }; }
}
/** Reads the switch row with the caller's own Supabase reader (sbGet(path) → rows|null). Any failure = nothing disabled (never blocks a retained business). */
export async function loadDisabled(sbGet) {
  try { const rows = await sbGet(`app_settings?key=eq.${CONFIG_KEY}&select=value`); return parseDisabled(rows && rows[0] && rows[0].value); }
  catch { return { youtube: new Set(), tiktok: new Set() }; }
}
/** True if this id is listed AND its engine is known and not retained. `engineOf(id)` returns the engine tag or null. */
export function isSkipped(set, id, engineOf) {
  if (!set || !set.has(id)) return false;
  const engine = engineOf(id);
  return !!engine && !RETAINED_ENGINES.includes(engine);
}
/** Filters rows ({channel_id|open_id, mmm_engine?}) — rows carry their own engine tag, or a lookup map is supplied. */
export function filterEnabled(rows, set, idKey, engineMap) {
  if (!Array.isArray(rows)) return rows;
  const engineOf = (id) => { const r = rows.find((x) => x[idKey] === id); return (r && r.mmm_engine) || (engineMap && engineMap[id]) || null; };
  return rows.filter((r) => !isSkipped(set, r[idKey], engineOf));
}
