// SRV avatar library — pure rules (no network, no database): image validation, registry shape, and every registry change.
// CEO order 2026-11-11: authorized CEO/Admin and VA users add, upload, select, replace and remove avatar photos; SRV Farsi and SRV English keep SEPARATE libraries;
// artist modes are unchanged (SRV Farsi: Female / Male / Duet; SRV English: Female only); images used by packages are protected; files are never deleted.
//
// The built-in avatars (public/assets/...) stay exactly where they are. A registry (one JSON document per business, stored by the server) adds the uploaded avatars
// and records "overrides" for built-ins (removed / renamed). "Removed" is always a reversible retirement: the image stays on disk and stays resolvable, so every
// package that already uses it keeps working and can still be rebuilt — it is simply no longer offered or picked for new work.

export const BUSINESSES = {
  srv_farsi: { name: 'SRV Farsi', artists: ['female', 'male', 'duet'] },
  srv_english: { name: 'SRV English', artists: ['female'] },
};
export const LIMITS = {
  maxImageBytes: 3_000_000,      // decoded JPEG/PNG (the page re-encodes to ~0.5–1.5 MB; the request body limit is 4.5 MB including base64)
  maxThumbBytes: 300_000,
  minWidth: 1280, minHeight: 720, // 16:9 landscape source, same bar as the built-in libraries (HD for a 720p frame)
  minAspect: 1.6, maxAspect: 1.95, // 16:9 ± tolerance (built-ins are 1.77–1.78)
  maxItemsPerBusiness: 80,
  maxLabel: 80,
  minActivePerArtist: 1,
};
// The built-in avatars (ids only; the images live under public/assets/). A test keeps this list identical to the page (ENGINES_CONFIG.srv_farsi.avatarLibrary and
// SRV_STUDIO_V2_AVATARS) so the server can validate overrides and count active avatars without importing the page.
export const BUILTIN_AVATARS = {
  srv_farsi: {"female": ["female_01", "female_02", "female_03", "female_04", "female_05", "female_06", "female_07", "female_08", "female_09", "female_10", "female_11", "female_12", "female_13", "female_14", "female_15", "female_16", "female_17", "female_18", "female_19", "female_20", "female_21"], "male": ["male_01", "male_02", "male_03", "male_04", "male_05", "male_06", "male_07", "male_08"], "duet": ["duet_01", "duet_02", "duet_03", "duet_04", "duet_05", "duet_06", "duet_07", "duet_08"]},
  srv_english: { female: ["srv2-fm-01", "srv2-fm-02", "srv2-fm-03", "srv2-fm-04", "srv2-fm-05", "srv2-fm-06", "srv2-fm-07", "srv2-fm-08", "srv2-fm-10", "srv2-fm-11", "srv2-fm-12", "srv2-fm-13", "srv2-fm-14", "srv2-fm-15", "srv2-fm-16", "srv2-fm-17", "srv2-fm-18", "srv2-fm-19", "srv2-fm-20"] },   // the 19 rotation-eligible final images; srv2-fm-09 is the held alternate and is not managed here
};
export const REGISTRY_KEY = (business) => 'srv_avatar_library_' + business;

const eq = (buf, off, bytes) => bytes.every((b, i) => buf[off + i] === b);

// Reads the real type and pixel size from the bytes themselves (never from the file name or the declared content type).
export function parseImage(buf) {
  if (!buf || buf.length < 24) return { type: null };
  if (eq(buf, 0, [0xff, 0xd8, 0xff])) {                       // JPEG: walk the segments to the first SOF marker
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
      if (len < 2) break;
      i += 2 + len;
    }
    return { type: 'jpeg', width: 0, height: 0 };
  }
  if (eq(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && eq(buf, 12, [0x49, 0x48, 0x44, 0x52])) {   // PNG: IHDR
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return { type: null };
}

export function emptyRegistry(business) { return { business, rev: 0, items: [], overrides: {} }; }
export function normalizeRegistry(raw, business) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  if (!o || typeof o !== 'object') return emptyRegistry(business);
  return { business, rev: Number(o.rev) || 0, items: Array.isArray(o.items) ? o.items.filter((x) => x && typeof x.id === 'string') : [], overrides: (o.overrides && typeof o.overrides === 'object') ? o.overrides : {} };
}

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export function cleanLabel(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxLabel); }

// Validates an upload. `image`/`thumb` are Buffers. Returns { ok:true, value } or { ok:false, error, detail }.
export function validateUpload({ business, artist, label, focus, image, thumb }, registry) {
  const B = BUSINESSES[business];
  if (!B) return { ok: false, error: 'unknown_business' };
  let art = String(artist || '').toLowerCase();
  if (business === 'srv_english' && !art) art = 'female';               // SRV English is Female only: a missing artist means female, any other value is refused below
  if (!B.artists.includes(art)) return { ok: false, error: 'artist_not_allowed', detail: 'allowed: ' + B.artists.join(', ') };
  if (!Buffer.isBuffer(image) || !image.length) return { ok: false, error: 'image_missing' };
  if (image.length > LIMITS.maxImageBytes) return { ok: false, error: 'image_too_large', detail: image.length + ' bytes (max ' + LIMITS.maxImageBytes + ')' };
  const info = parseImage(image);
  if (!info.type) return { ok: false, error: 'image_type_not_allowed', detail: 'only JPEG or PNG images are accepted' };
  if (!info.width || !info.height) return { ok: false, error: 'image_unreadable' };
  if (info.width < LIMITS.minWidth || info.height < LIMITS.minHeight) return { ok: false, error: 'image_too_small', detail: info.width + '×' + info.height + ' (min ' + LIMITS.minWidth + '×' + LIMITS.minHeight + ')' };
  const aspect = info.width / info.height;
  if (aspect < LIMITS.minAspect || aspect > LIMITS.maxAspect) return { ok: false, error: 'image_not_landscape_16_9', detail: 'aspect ' + aspect.toFixed(2) + ' (need about 1.78, a 16:9 landscape image)' };
  if (!Buffer.isBuffer(thumb) || !thumb.length) return { ok: false, error: 'thumb_missing' };
  if (thumb.length > LIMITS.maxThumbBytes) return { ok: false, error: 'thumb_too_large' };
  const ti = parseImage(thumb); if (ti.type !== 'jpeg' && ti.type !== 'png') return { ok: false, error: 'thumb_type_not_allowed' };
  const f = focus && typeof focus === 'object' ? focus : {};
  const fx = Number(f.fx), fy = Number(f.fy), fw = Number(f.fw);
  if (![fx, fy, fw].every(Number.isFinite)) return { ok: false, error: 'focus_invalid', detail: 'fx, fy and fw are required numbers' };
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || fw < 0.03 || fw > 0.6) return { ok: false, error: 'focus_out_of_range', detail: 'fx,fy in 0..1 and fw in 0.03..0.6' };
  const L = cleanLabel(label);
  const active = registry.items.filter((x) => x.status !== 'removed');
  if (registry.items.length >= LIMITS.maxItemsPerBusiness) return { ok: false, error: 'library_full', detail: 'max ' + LIMITS.maxItemsPerBusiness + ' uploaded avatars' };
  return { ok: true, value: { artist: art, label: L, focus: { fx: +fx.toFixed(3), fy: +fy.toFixed(3), fw: +fw.toFixed(3) }, type: info.type, width: info.width, height: info.height, activeCount: active.length } };
}

export function newAvatarId(business, now = Date.now(), rand = Math.random()) {
  return 'up_' + (business === 'srv_farsi' ? 'f' : 'e') + '_' + now.toString(36) + '_' + Math.floor(rand * 36 ** 4).toString(36).padStart(4, '0');
}

// Registry item for an uploaded avatar. `paths` are storage paths inside srv-assets; `urls` the public URLs.
export function makeItem({ id, business, value, sha256, bytes, paths, urls, by, at }) {
  return { id, business, artist: value.artist, label: value.label || '', status: 'active', origin: 'uploaded',
    src: urls.src, thumb: urls.thumb, fx: value.focus.fx, fy: value.focus.fy, fw: value.focus.fw,
    file: { path: paths.src, thumbPath: paths.thumb, type: value.type, width: value.width, height: value.height, bytes, sha256 },
    createdBy: by, createdAt: at, updatedAt: at };
}

// All active avatars of an artist group, built-ins included. `builtinIds` = ids of the built-in avatars of the group (from the page / manifest).
export function activeCount(registry, artist, builtinIds) {
  const builtinsActive = (builtinIds || []).filter((id) => (registry.overrides[id] || {}).status !== 'removed').length;
  const uploadedActive = registry.items.filter((x) => x.artist === artist && x.status !== 'removed').length;
  return builtinsActive + uploadedActive;
}

// Applies a status/label/focus change. Never deletes anything: "removed" is a reversible retirement that keeps the image resolvable.
// builtinsByArtist: { female:[ids], ... } for this business (the built-in avatars the registry knows nothing about).
export function applyUpdate(registry, { id, op, label, focus }, { by, at, builtinsByArtist }) {
  const reg = JSON.parse(JSON.stringify(registry));
  const up = reg.items.find((x) => x.id === id);
  const bArtist = !up ? Object.keys(builtinsByArtist || {}).find((a) => (builtinsByArtist[a] || []).includes(id)) : null;
  if (!up && !bArtist) return { ok: false, error: 'avatar_not_found' };
  const artist = up ? up.artist : bArtist;
  const target = up || (reg.overrides[id] = reg.overrides[id] || {});
  if (op === 'remove') {
    const left = activeCount(reg, artist, (builtinsByArtist || {})[artist]) - ((up ? up.status : (target.status)) === 'removed' ? 0 : 1);
    if (left < LIMITS.minActivePerArtist) return { ok: false, error: 'last_active_avatar', detail: 'every artist keeps at least ' + LIMITS.minActivePerArtist + ' active avatar' };
    target.status = 'removed'; target.removedBy = by; target.removedAt = at;
  } else if (op === 'restore') {
    target.status = 'active'; delete target.removedBy; delete target.removedAt;
  } else if (op === 'update') {
    if (label !== undefined) target.label = cleanLabel(label);
    if (focus) {
      const fx = Number(focus.fx), fy = Number(focus.fy), fw = Number(focus.fw);
      if (![fx, fy, fw].every(Number.isFinite) || fx < 0 || fx > 1 || fy < 0 || fy > 1 || fw < 0.03 || fw > 0.6) return { ok: false, error: 'focus_out_of_range' };
      if (up) { up.fx = +fx.toFixed(3); up.fy = +fy.toFixed(3); up.fw = +fw.toFixed(3); } else { target.focus = { fx: +fx.toFixed(3), fy: +fy.toFixed(3), fw: +fw.toFixed(3) }; }
    }
  } else return { ok: false, error: 'op_not_allowed' };
  target.updatedAt = at; target.updatedBy = by;
  reg.rev = (reg.rev || 0) + 1;
  return { ok: true, registry: reg };
}
