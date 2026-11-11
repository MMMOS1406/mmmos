// SRV avatar library — server rules and the REAL api/ops.js actions (CEO order 2026-11-11).
// Every network call (Supabase REST + storage) goes to an in-memory fake; nothing leaves this machine. Run: node tests/avatars/test_avatar_library_server.mjs
import { createHash } from 'node:crypto';
import { parseImage, validateUpload, normalizeRegistry, applyUpdate, BUILTIN_AVATARS, LIMITS } from '../../lib/srvAvatarLibrary.mjs';

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); };
const SB = 'https://tldcwvtwjypmwynsklsd.supabase.co';
const CEO_PIN = '914273', CEO_SECRET = 'test-ceo-session-secret', sha = (s) => createHash('sha256').update(String(s)).digest('hex');
// ── synthetic images: real headers (type + pixel size), invented content ──
const jpeg = (w, h, size = 40_000, salt = 0) => { const b = Buffer.alloc(size, 7 + salt); Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]).copy(b, 0); return b; };
const png = (w, h, size = 40_000, salt = 0) => { const b = Buffer.alloc(size, 9 + salt); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const url = (buf, type = 'jpeg') => `data:image/${type};base64,${buf.toString('base64')}`;
const THUMB = jpeg(480, 270, 9000, 50);

// ── pure rules ──
ok('parseImage reads JPEG and PNG sizes from the bytes', parseImage(jpeg(1672, 941)).width === 1672 && parseImage(jpeg(1672, 941)).height === 941 && parseImage(png(1920, 1080)).type === 'png' && parseImage(png(1920, 1080)).height === 1080);
ok('parseImage rejects GIF, text and short buffers', parseImage(Buffer.from('GIF89a' + 'x'.repeat(40))).type === null && parseImage(Buffer.from('hello world, not an image at all')).type === null && parseImage(Buffer.alloc(5)).type === null);
const reg0 = normalizeRegistry(null, 'srv_farsi');
const good = { business: 'srv_farsi', artist: 'duet', label: 'Studio duet', focus: { fx: 0.5, fy: 0.35, fw: 0.2 }, image: jpeg(1672, 941), thumb: THUMB };
ok('a valid Farsi duet upload passes', validateUpload(good, reg0).ok === true);
for (const [n, mut, err] of [
  ['unknown business', { business: 'nextwave' }, 'unknown_business'], ['artist not in the list', { artist: 'child' }, 'artist_not_allowed'],
  ['too small', { image: jpeg(800, 450) }, 'image_too_small'], ['portrait / not 16:9', { image: jpeg(1080, 1920) }, 'image_too_small'], ['square-ish large', { image: jpeg(2000, 1800) }, 'image_not_landscape_16_9'],
  ['over the size limit', { image: jpeg(1672, 941, LIMITS.maxImageBytes + 1) }, 'image_too_large'], ['not an image', { image: Buffer.from('MZ' + 'x'.repeat(100)) }, 'image_type_not_allowed'],
  ['missing thumb', { thumb: null }, 'thumb_missing'], ['focus out of range', { focus: { fx: 1.4, fy: 0.3, fw: 0.2 } }, 'focus_out_of_range'], ['focus width too wide', { focus: { fx: 0.5, fy: 0.3, fw: 0.9 } }, 'focus_out_of_range'], ['focus missing', { focus: null }, 'focus_invalid'],
]) { const r = validateUpload(Object.assign({}, good, mut), reg0); ok(`validation refuses: ${n}`, r.ok === false && r.error === err, r); }
ok('SRV English accepts Female (or no artist) and refuses Male and Duet', validateUpload(Object.assign({}, good, { business: 'srv_english', artist: 'female' }), reg0).ok && validateUpload(Object.assign({}, good, { business: 'srv_english', artist: undefined }), reg0).value.artist === 'female' && validateUpload(Object.assign({}, good, { business: 'srv_english', artist: 'male' }), reg0).error === 'artist_not_allowed' && validateUpload(Object.assign({}, good, { business: 'srv_english', artist: 'duet' }), reg0).error === 'artist_not_allowed');
ok('built-in manifests: Farsi 21 female / 8 male / 8 duet, English 19 female', BUILTIN_AVATARS.srv_farsi.female.length === 21 && BUILTIN_AVATARS.srv_farsi.male.length === 8 && BUILTIN_AVATARS.srv_farsi.duet.length === 8 && BUILTIN_AVATARS.srv_english.female.length === 19 && !BUILTIN_AVATARS.srv_english.male);

// the server's built-in manifest must stay identical to what the page actually ships
import { readFileSync } from 'node:fs';
{
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8'), farsi = {};
  for (const a of ['female', 'male', 'duet']) { const i = html.indexOf('     ' + a + ':['); const seg = html.slice(i, html.indexOf('}],', i) + 2); farsi[a] = [...seg.matchAll(/\{id:'([a-z_0-9]+)'/g)].map((m) => m[1]); }
  const sj = readFileSync(new URL('../../lib/srvStudioV2Avatars.mjs', import.meta.url), 'utf8'); const fin = JSON.parse(/const SRV_STUDIO_V2_AVATARS=(\[.*?\]);\n/s.exec(sj)[1]);
  ok('server built-in manifest == page: Farsi female/male/duet ids', JSON.stringify(farsi) === JSON.stringify(BUILTIN_AVATARS.srv_farsi), { farsi });
  ok('server built-in manifest == SRV Studio: the 19 rotation-eligible finals', JSON.stringify(fin.filter((a) => a.rotationEligible && !a.archived).map((a) => a.id)) === JSON.stringify(BUILTIN_AVATARS.srv_english.female));
}

// ── the real handler, with fakes ──
const db = { ceo_auth_config: [{ key: 'ceo_session_secret_production', value: CEO_SECRET }, { key: 'ceo_pin_hash_production', value: sha(CEO_PIN) }], app_settings: [], packages: [] };
const storage = new Map(); const calls = [];
const like = (rows, k, pat) => { const rx = new RegExp(pat.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*')); return rows.filter((r) => rx.test(String(r[k] == null ? '' : r[k]))); };
function sbFilter(rows, qs) { let r = rows; for (const [k, v] of qs) { if (['select', 'limit', 'order'].includes(k)) continue; if (v.startsWith('eq.')) r = r.filter((x) => String(x[k]) === decodeURIComponent(v.slice(3))); else if (v.startsWith('like.')) r = like(r, k, decodeURIComponent(v.slice(5))); } return r; }
globalThis.fetch = async (input, init = {}) => {
  const u = String(input); calls.push({ url: u, method: init.method || 'GET' });
  const resp = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  if (u.startsWith(SB + '/rest/v1/')) { const t = new URL(u).pathname.split('/').pop(), rows = db[t] || [], qs = [...new URL(u).searchParams.entries()], m = init.method || 'GET';
    if (m === 'GET') return resp(200, sbFilter(rows, qs)); const body = JSON.parse(init.body || '{}'); if (m === 'POST') { rows.push(body); db[t] = rows; return resp(201, [body]); } if (m === 'PATCH') { const hit = sbFilter(rows, qs); hit.forEach((x) => Object.assign(x, body)); return resp(200, hit); } }
  if (u.startsWith(SB + '/storage/v1/object/srv-assets/') && (init.method === 'POST')) { storage.set(u.slice((SB + '/storage/v1/object/srv-assets/').length), Buffer.from(init.body)); return resp(200, { Key: 'ok' }); }
  return resp(599, 'UNEXPECTED ' + u);
};
process.env.SUPABASE_SERVICE_KEY = 'svc';
const warn = console.warn, err = console.error, log = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
const { default: handler } = await import('../../api/ops.js');
async function call(action, body = {}, method = 'POST') {
  const res = { code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, end() { return this; }, setHeader() {}, removeHeader() {}, getHeader() {} };
  await handler({ method, query: { action }, body, headers: {} }, res); return res;
}
const login = await call('ceo_login', { pin: CEO_PIN }); const CEO = login.body && login.body.ceo_session_token;
ok('setup: CEO session', !!CEO);
let r = await call('publish_auth_set_operator_pin', { pin: '482913', ceo_session_token: CEO }); ok('setup: CEO sets a VA PIN', r.body.ok === true, r.body);
r = await call('operator_login', { pin: '482913' }); const VA = r.body && r.body.operator_session_token; ok('setup: VA session', !!VA, r.body);
const as = (role, extra = {}) => Object.assign({}, role === 'ceo' ? { ceo_session_token: CEO } : role === 'va' ? { operator_session_token: VA } : {}, extra);
const dl = (extra = {}) => as('ceo', Object.assign({ business: 'srv_farsi', artist: 'duet', label: 'Warm duet', focus: { fx: 0.5, fy: 0.35, fw: 0.2 }, image: url(jpeg(1672, 941)), thumb: url(THUMB) }, extra));

// ── access control ──
for (const a of ['srv_avatar_library_get', 'srv_avatar_upload', 'srv_avatar_update']) {
  r = await call(a, { business: 'srv_farsi' }); ok(`${a}: unsigned is refused`, r.code === 401, r.body);
  r = await call(a, { business: 'srv_farsi', family_session_token: 'stub.family', ceo_session_token: 'forged.token', operator_session_token: 'forged.token' }); ok(`${a}: forged / Family tokens are refused`, r.code === 401, r.body);
}
r = await call('srv_avatar_library_get', as('ceo')); ok('CEO can read both libraries (+ built-in manifest and limits)', r.code === 200 && r.body.ok && r.body.libraries.srv_farsi.items.length === 0 && r.body.libraries.srv_english.items.length === 0 && r.body.builtins.srv_farsi.duet.length === 8, r.body);
r = await call('srv_avatar_library_get', as('va')); ok('VA can read both libraries', r.code === 200 && r.body.ok === true, r.body);

// ── upload ──
const before = storage.size;
r = await call('srv_avatar_upload', dl()); const farsiItem = r.body && r.body.item;
ok('CEO uploads a Farsi duet avatar', r.code === 200 && r.body.ok && farsiItem && farsiItem.artist === 'duet' && farsiItem.business === 'srv_farsi' && farsiItem.origin === 'uploaded' && farsiItem.status === 'active', r.body);
ok('image and thumbnail are stored under avatars/srv_farsi/ in srv-assets and the URLs point at them', storage.size === before + 2 && [...storage.keys()].every((k) => k.startsWith('avatars/srv_farsi/')) && farsiItem.src.includes('/storage/v1/object/public/srv-assets/avatars/srv_farsi/') && farsiItem.thumb.endsWith('-thumb.jpg') && farsiItem.file.sha256.length === 64);
ok('the registry is persisted (app_settings) with the item, revision 1', (() => { const row = db.app_settings.find((x) => x.key === 'srv_avatar_library_srv_farsi'); const o = row && JSON.parse(row.value); return o && o.rev === 1 && o.items.length === 1 && o.items[0].id === farsiItem.id; })());
r = await call('srv_avatar_upload', dl()); ok('the same image again is refused as a duplicate', r.code === 409 && r.body.error === 'duplicate_image', r.body);
r = await call('srv_avatar_upload', as('va', { business: 'srv_farsi', artist: 'male', label: 'VA male', focus: { fx: 0.3, fy: 0.3, fw: 0.15 }, image: url(png(1920, 1080, 50_000, 3), 'png'), thumb: url(THUMB) })); const vaItem = r.body && r.body.item;
ok('VA uploads a Farsi male PNG avatar', r.code === 200 && vaItem && vaItem.artist === 'male' && vaItem.createdBy === 'operator' && vaItem.file.type === 'png' && vaItem.src.endsWith('.png'), r.body);
r = await call('srv_avatar_upload', as('ceo', { business: 'srv_english', artist: 'female', label: 'English portrait', focus: { fx: 0.5, fy: 0.35, fw: 0.17 }, image: url(jpeg(1672, 941, 41_000, 9)), thumb: url(THUMB) })); const engItem = r.body && r.body.item;
ok('CEO uploads an English (female) avatar', r.code === 200 && engItem && engItem.artist === 'female' && engItem.business === 'srv_english', r.body);
r = await call('srv_avatar_upload', as('ceo', { business: 'srv_english', artist: 'male', label: 'x', focus: { fx: 0.5, fy: 0.3, fw: 0.2 }, image: url(jpeg(1672, 941, 42_000, 11)), thumb: url(THUMB) })); ok('English refuses a Male avatar (Female only)', r.code === 400 && r.body.error === 'artist_not_allowed', r.body);
r = await call('srv_avatar_library_get', as('va'));
ok('libraries stay separate: Farsi has 2 uploaded, English has 1, nothing leaks across', r.body.libraries.srv_farsi.items.length === 2 && r.body.libraries.srv_english.items.length === 1 && !r.body.libraries.srv_english.items.some((x) => x.business === 'srv_farsi') && !r.body.libraries.srv_farsi.items.some((x) => x.business === 'srv_english'));
for (const [n, mut, code, e] of [
  ['a GIF', { image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, 400, 'image_type_not_allowed'], ['not a data URL', { image: 'https://evil.example/x.jpg' }, 400, 'image_type_not_allowed'],
  ['too small', { image: url(jpeg(640, 360, 20000, 20)) }, 400, 'image_too_small'], ['not 16:9', { image: url(jpeg(2000, 1800, 20000, 21)) }, 400, 'image_not_landscape_16_9'],
  ['over 3 MB', { image: url(jpeg(1672, 941, 3_100_000, 22)) }, 413, 'image_too_large'], ['bad focus', { focus: { fx: 2, fy: 0, fw: 0.1 }, image: url(jpeg(1672, 941, 20000, 23)) }, 400, 'focus_out_of_range'],
  ['unknown business', { business: 'smm', image: url(jpeg(1672, 941, 20000, 24)) }, 400, 'unknown_business'], ['a script disguised as an image', { image: url(Buffer.from('<script>alert(1)</script>' + ' '.repeat(100))) }, 400, 'image_type_not_allowed'],
]) { const n0 = storage.size; r = await call('srv_avatar_upload', dl(mut)); ok(`upload refused: ${n}`, r.code === code && r.body.error === e && storage.size === n0, { code: r.code, body: r.body }); }

// ── protection and removal ──
db.packages.push({ package_id: 'pkg_x', full_package: JSON.stringify({ id: 'pkg_x', srvAvatarId: 'female_03', srvAvatarArtist: 'female', note: 'published' }) });
db.packages.push({ package_id: 'pkg_y', full_package: JSON.stringify({ id: 'pkg_y', srvAvatar: { id: vaItem.id } }) });
r = await call('srv_avatar_upload', dl({ replaceId: vaItem.id, artist: 'male', image: url(jpeg(1920, 1080, 44_000, 31)) })); ok('replace is refused while a package uses the avatar (images used by packages are protected)', r.code === 409 && r.body.error === 'avatar_in_use', r.body);
r = await call('srv_avatar_upload', dl({ replaceId: farsiItem.id, image: url(jpeg(1920, 1080, 45_000, 32)) })); const replaced = r.body && r.body.item;
ok('replace works for an unused uploaded avatar: same id, new image/paths, history kept', r.code === 200 && replaced && replaced.id === farsiItem.id && replaced.src !== farsiItem.src && replaced.createdAt === farsiItem.createdAt && replaced.replacedBy === 'ceo' && storage.has(farsiItem.file.path), r.body);
r = await call('srv_avatar_upload', dl({ replaceId: 'female_03', artist: 'female', image: url(jpeg(1920, 1080, 46_000, 33)) })); ok('a built-in avatar cannot be replaced (it is not an uploaded one)', r.code === 404, r.body);
r = await call('srv_avatar_update', as('va', { business: 'srv_farsi', id: 'female_03', op: 'remove' }));
ok('VA can remove a built-in avatar that a package uses: allowed as a reversible retirement, and the response says it is in use', r.code === 200 && r.body.registry.overrides.female_03.status === 'removed' && r.body.inUse === true, r.body);
ok('nothing is ever deleted from storage and no file is removed by a removal', !calls.some((c) => c.method === 'DELETE') && storage.has(farsiItem.file.path) && storage.has(vaItem.file.path));
r = await call('srv_avatar_update', as('ceo', { business: 'srv_farsi', id: 'female_03', op: 'restore' })); ok('restore brings it back', r.code === 200 && r.body.registry.overrides.female_03.status === 'active', r.body);
r = await call('srv_avatar_update', as('ceo', { business: 'srv_farsi', id: vaItem.id, op: 'update', label: '  Renamed <b>avatar</b>  ', focus: { fx: 0.4, fy: 0.3, fw: 0.18 } })); const upd = r.body.registry && r.body.registry.items.find((x) => x.id === vaItem.id);
ok('rename + re-frame an uploaded avatar (label sanitized, focus stored)', r.code === 200 && upd.label === 'Renamed b avatar /b' || (upd && !/[<>]/.test(upd.label) && upd.fx === 0.4 && upd.fw === 0.18), upd);
r = await call('srv_avatar_update', as('ceo', { business: 'srv_farsi', id: 'nope', op: 'remove' })); ok('unknown avatar → 404', r.code === 404, r.body);
r = await call('srv_avatar_update', as('ceo', { business: 'srv_farsi', id: 'female_03', op: 'delete' })); ok('there is no delete operation', r.code === 400 && r.body.error === 'op_not_allowed', r.body);
// a group can never be emptied
let lastErr = null; for (const id of BUILTIN_AVATARS.srv_farsi.male.concat([vaItem.id])) { r = await call('srv_avatar_update', as('ceo', { business: 'srv_farsi', id, op: 'remove' })); if (!r.body.ok) { lastErr = r.body.error; break; } }
ok('an artist group always keeps at least one active avatar (Male: 8 built-in + 1 uploaded; removing them one by one, the last one is refused)', lastErr === 'last_active_avatar', lastErr);
const engIds = BUILTIN_AVATARS.srv_english.female.concat([engItem.id]); let engLast = null; for (const id of engIds) { r = await call('srv_avatar_update', as('va', { business: 'srv_english', id, op: 'remove' })); if (!r.body.ok) { engLast = r.body.error; break; } }
ok('English likewise keeps at least one active avatar (19 built-in + 1 uploaded: removing them one by one, the last is refused)', engLast === 'last_active_avatar', engLast);
r = await call('srv_avatar_library_get', as('ceo'));
ok('persistence: a fresh read returns every change; revisions only go up', r.body.libraries.srv_farsi.rev >= 5 && r.body.libraries.srv_farsi.overrides.female_03 && r.body.libraries.srv_farsi.items.length === 2 && r.body.libraries.srv_english.items.length === 1);
ok('Family-session style tokens still cannot reach the library after all changes', (await call('srv_avatar_library_get', { family_session_token: 'stub.family' })).code === 401);
console.warn = warn; console.error = err; console.log = log;
for (const l of out) console.log(l);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
