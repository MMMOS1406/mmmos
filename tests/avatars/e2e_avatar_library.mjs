// SRV avatar library — browser end-to-end (CEO order 2026-11-11), against the local stub. The server API is emulated by a stateful fake that runs the REAL rules from
// lib/srvAvatarLibrary.mjs (the real handlers are covered by test_avatar_library_server.mjs). Nothing reaches production.
// PUPPETEER_CORE=<dir> node tests/avatars/e2e_avatar_library.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { startStub } from '../preservation/stub-server.mjs'; import { makeFixture } from '../preservation/fixtures.mjs'; import { launch, openPage, login, settle, hOverflow, fetchJson } from '../preservation/driver.mjs';
import { validateUpload, normalizeRegistry, applyUpdate, makeItem, newAvatarId, BUILTIN_AVATARS, LIMITS } from '../../lib/srvAvatarLibrary.mjs';
const pub = fs.realpathSync(new URL('../../public', import.meta.url).pathname);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

// ---- stateful fake of the three server actions ----
const reg = { srv_farsi: normalizeRegistry(null, 'srv_farsi'), srv_english: normalizeRegistry(null, 'srv_english') };
const usedIds = new Set(); let forceNoSession = false;
const dec = (u) => { const m = /^data:image\/(jpeg|png);base64,(.*)$/.exec(String(u || '')); return m ? Buffer.from(m[2], 'base64') : null; };
const authed = (b) => !forceNoSession && !!(b && (b.ceo_session_token || b.operator_session_token));
const who = (b) => (b.ceo_session_token ? 'ceo' : 'operator');
const api = {
  srv_avatar_library_get: (b) => authed(b) ? { ok: true, libraries: JSON.parse(JSON.stringify(reg)), builtins: BUILTIN_AVATARS, limits: LIMITS } : { ok: false, error: 'session_required' },
  srv_avatar_upload: (b) => {
    if (!authed(b)) return { ok: false, error: 'session_required' };
    const business = b.business, r = reg[business]; if (!r) return { ok: false, error: 'unknown_business' };
    const image = dec(b.image), thumb = dec(b.thumb); if (!image) return { ok: false, error: 'image_type_not_allowed' };
    const v = validateUpload({ business, artist: b.artist, label: b.label, focus: b.focus, image, thumb }, r); if (!v.ok) return { ok: false, error: v.error, detail: v.detail };
    const sha = 'sha' + image.length + image.subarray(20, 40).toString('hex');
    if (r.items.some((x) => x.status !== 'removed' && x.file.sha256 === sha && x.id !== b.replaceId)) return { ok: false, error: 'duplicate_image' };
    if (b.replaceId && usedIds.has(b.replaceId)) return { ok: false, error: 'avatar_in_use', detail: 'packages or tasks use this image' };
    const id = b.replaceId || newAvatarId(business), at = new Date().toISOString();
    const item = makeItem({ id, business, value: v.value, sha256: sha, bytes: image.length, paths: { src: id + '.jpg', thumb: id + '-t.jpg' }, urls: { src: b.image, thumb: b.thumb }, by: who(b), at });
    if (b.replaceId) { const old = r.items.find((x) => x.id === id); if (old) { item.createdAt = old.createdAt; item.createdBy = old.createdBy; } item.replacedBy = who(b); item.replacedAt = at; }
    r.items = r.items.filter((x) => x.id !== id).concat([item]); r.rev++; return { ok: true, item, rev: r.rev };
  },
  srv_avatar_update: (b) => {
    if (!authed(b)) return { ok: false, error: 'session_required' };
    const r = reg[b.business]; if (!r) return { ok: false, error: 'unknown_business' };
    const x = applyUpdate(r, { id: b.id, op: b.op, label: b.label, focus: b.focus }, { by: who(b), at: new Date().toISOString(), builtinsByArtist: BUILTIN_AVATARS[b.business] });
    if (!x.ok) return { ok: false, error: x.error, detail: x.detail }; reg[b.business] = x.registry; return { ok: true, registry: x.registry, inUse: b.op === 'remove' ? usedIds.has(b.id) : null };
  },
};
const fx = makeFixture(); fx.restFilter = true; Object.assign(fx.api, api);
const stub = await startStub({ publicDir: pub, fixture: fx }); const browser = await launch();
async function session(role, viewport) { const o = await openPage(browser, stub.origin, { viewport }); await fetchJson(stub.origin + '/__stub/reset'); await o.page.reload(); await login(o.page, stub.origin, role); await settle(o.page, stub.origin, 1500); return o; }
const W = (p, ms = 600) => settle(p, stub.origin, ms);
const text = (p) => p.evaluate(() => document.getElementById('mainContent').innerText);
const img = async (page, w, h, type = 'image/jpeg') => { const d = await page.evaluate(async (w, h, t) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')); g.addColorStop(1, '#223'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#eee'; x.beginPath(); x.arc(w * 0.45, h * 0.35, h * 0.1, 0, 7); x.fill(); return await new Promise((r) => c.toBlob((b) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }, t, 0.9)); }, w, h, type); const m = /^data:([^;]+);base64,(.*)$/.exec(d); const ext = /png/.test(m[1]) ? 'png' : /webp/.test(m[1]) ? 'webp' : 'jpg'; const f = path.join(os.tmpdir(), `avl-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`); fs.writeFileSync(f, Buffer.from(m[2], 'base64')); return f; };
const tab = async (p, biz, t) => { await p.evaluate(([b, x]) => Home2.go('ws:' + b + ':' + x), [biz, t]); await W(p, 900); };
const upload = async (p, file, { artist, label } = {}) => {
  const input = await p.$('#avlFile'); await input.uploadFile(file); await W(p, 900);
  if (artist) await p.select('#avlArtist', artist); if (label) { await p.$eval('#avlLabel', (e, v) => { e.value = v; }, label); }
  const msg1 = await p.$eval('#avlMsg', (e) => e.textContent);
  const canGo = await p.$eval('#avlGo', (e) => !e.disabled);
  if (canGo) { await p.click('#avlPrev'); await p.click('#avlGo'); await W(p, 1200); }
  return { msg1, msg2: await p.$eval('#avlMsg', (e) => e.textContent), canGo };
};
const files = [];
try {
  const on = await session('admin'); const p = on.page; const e0 = on.pageErrors.length;
  // ---- Admin: the Avatars tab, per business ----
  await p.evaluate(() => Home2.go('biz:SRV Farsi')); await W(p, 700);
  check('workspace tabs include Avatars (Overview, Production, Packages, Analytics, Avatars)', await p.evaluate(() => [...document.querySelectorAll('#h2Ws .h2-tabs button')].map((b) => b.innerText).join(',') === 'Overview,Production,Packages,Analytics,Avatars'));
  await tab(p, 'SRV Farsi', 'avatars');
  const g1 = await p.evaluate(() => [...document.querySelectorAll('.avl h3')].map((h) => h.innerText));
  check('SRV Farsi library: Female / Male / Duet groups with every built-in avatar (21 / 8 / 8 active)', g1.length >= 4 && /female avatars — 21 active/i.test(g1[0]) && /male avatars — 8 active/i.test(g1[1]) && /duet avatars — 8 active/i.test(g1[2]), g1.join(' | '));
  check('thumbnails render for the built-in avatars', await p.evaluate(() => { const i = document.querySelector('.avl .card img'); return !!i && i.getAttribute('src').includes('/assets/srv-farsi-avatars/'); }));
  await tab(p, 'SRV English', 'avatars');
  const g2 = await p.evaluate(() => [...document.querySelectorAll('.avl h3')].map((h) => h.innerText));
  check('SRV English library: Female only (19 active) — no Male or Duet group, separate from Farsi', /female avatars — 19 active/i.test(g2[0]) && !g2.some((h) => /duet|^male/i.test(h)) && !(await p.evaluate(() => !!document.querySelector('#avlArtist'))), g2.join(' | '));
  check('English: the held alternate is shown but not manageable', await p.evaluate(() => [...document.querySelectorAll('.avl .card')].some((c) => /Held alternate/.test(c.innerText) && !c.querySelector('button'))));

  // ---- upload (Farsi duet) ----
  await tab(p, 'SRV Farsi', 'avatars');
  const f1 = await img(p, 1920, 1080); files.push(f1);
  const u1 = await upload(p, f1, { artist: 'duet', label: 'Warm duet' });
  check('upload: a valid 16:9 JPEG is checked, framed and uploaded to the Farsi duet library', u1.canGo && /Image OK/.test(u1.msg1) && /added to the library/i.test(u1.msg2), JSON.stringify(u1));
  const duetLib = () => p.evaluate(() => ENGINES_CONFIG.find((e) => e.id === 'srv_farsi').avatarLibrary.duet.map((x) => x.id + (x.uploaded ? '*' : '')));
  let dl = await duetLib();
  check('the new avatar is in the live duet list the Generate/Build screens read (9 entries), built-ins untouched, other groups unchanged', dl.length === 9 && dl.filter((x) => x.endsWith('*')).length === 1 && await p.evaluate(() => { const L = ENGINES_CONFIG.find((e) => e.id === 'srv_farsi').avatarLibrary; return L.female.length === 21 && L.male.length === 8; }), dl.join(','));
  const newId = dl.find((x) => x.endsWith('*')).slice(0, -1);
  check('the manager shows it as Uploaded in the Duet group (9 active) and it is not in the English library', (await text(p)).includes('Warm duet') && /duet avatars — 9 active/i.test(await text(p)) && reg.srv_english.items.length === 0 && reg.srv_farsi.items.length === 1);
  check('the picker data (cover choice, framing, thumbnail) carries the uploaded avatar', await p.evaluate((id) => { const a = _srvFarsiAvatarById('duet', id); return !!a && a.uploaded === true && a.fw > 0 && !!a.thumb && !!a.src; }, newId));

  check('the Build-stage cover picker lists the uploaded avatar for its artist (and not for another artist)', await p.evaluate((id) => { const mk = (m) => ({ engine: 'SRV Farsi', mood: m, mode: m, isLong: true, id: 'x1', taskId: 'x1' }); return _srvFarsiAvatarPickerHtml(mk('Duet — Emotional')).includes(id) && !_srvFarsiAvatarPickerHtml(mk('Female — Emotional')).includes(id); }, newId));
  // ---- invalid files ----
  const bad = [];
  const txt = path.join(os.tmpdir(), 'avl-not-image.png'); fs.writeFileSync(txt, 'this is not an image at all'); files.push(txt);
  bad.push(['not an image (text renamed .png)', txt, /not one|Only JPEG or PNG/i]);
  const small = await img(p, 800, 450); files.push(small); bad.push(['too small', small, /at least 1280×720/i]);
  const portrait = await img(p, 1080, 1920); files.push(portrait); bad.push(['portrait / not 16:9', portrait, /1280×720|16:9/i]);
  const webp = await img(p, 1920, 1080, 'image/webp'); files.push(webp); bad.push(['WebP (not JPEG/PNG)', webp, /Only JPEG or PNG/i]);
  for (const [n, f, rx] of bad) { const before = reg.srv_farsi.items.length; const r = await upload(p, f, { artist: 'female' }); check(`invalid file refused before upload: ${n}`, !r.canGo && rx.test(r.msg1) && reg.srv_farsi.items.length === before, r.msg1); }
  await p.evaluate(() => { document.querySelector('#avlFile').value = ''; });
  const dupFile = f1; const r2 = await upload(p, dupFile, { artist: 'duet' });
  check('the same image again is refused by the server as a duplicate', /already in the library/i.test(r2.msg2), r2.msg2);

  // ---- remove / restore: reflected in the lists the production screens use ----
  const femLen = () => p.evaluate(() => ENGINES_CONFIG.find((e) => e.id === 'srv_farsi').avatarLibrary.female.map((x) => x.id));
  usedIds.add('female_03');
  check('usage is shown (female_03 is used by a package in this test)', await p.evaluate(() => { D.packages = (D.packages || []).concat([{ id: 'pkg_use1', engine: 'SRV Farsi', title: 'uses female_03', srvAvatarId: 'female_03', srvAvatarArtist: 'female' }]); return AvatarLibrary.usage('female_03'); }) === 1);
  await tab(p, 'SRV Farsi', 'avatars');
  await p.evaluate(() => { window.confirm = () => true; document.querySelector('.avl [data-avl="remove"][data-id="female_03"]').click(); }); await W(p, 1200);
  check('Remove: the avatar leaves the live female list and is marked Removed; the response notes it is still used', !(await femLen()).includes('female_03') && (await femLen()).length === 20 && /still used by existing packages/i.test(await p.$eval('#avlMsg', (e) => e.textContent)));
  check('a removed avatar is never offered as the next rotation pick (Farsi Generate/Build use this pointer over the live list)', await p.evaluate(() => { const t = { engine: 'SRV Farsi', mood: 'Female — Emotional', mode: 'Female — Emotional', isLong: true }; const seen = new Set(); for (let i = 0; i < 80; i++) { D.srvFarsiAvatarIdx = { 'lib.female': i }; const a = _srvFarsiNextAvatar(t); if (a && a.av) seen.add(a.av.id); } return !seen.has('female_03') && seen.size > 10; }));
  check('protected: a package/task that already chose the removed cover still resolves it (Rebuild keeps working)', await p.evaluate(() => { const t = { srvAvatarId: 'female_03', srvAvatarArtist: 'female', engine: 'SRV Farsi', mood: 'Female — Emotional', mode: 'Female — Emotional', isLong: true }; const a = _srvFarsiAvatarById('female', 'female_03'); return !!a && !!a.src && !!a.thumb; }));
  await p.evaluate(() => document.querySelector('.avl [data-avl="restore"][data-id="female_03"]').click()); await W(p, 1000);
  check('Restore: back in the live list', (await femLen()).includes('female_03') && (await femLen()).length === 21);
  // replace protection
  usedIds.add(newId);
  check('replace is disabled for an uploaded avatar that is in use (client)', await p.evaluate((id) => { D.packages = D.packages.concat([{ id: 'pkg_use2', engine: 'SRV Farsi', srvAvatar: { id } }]); return true; }, newId) && (await (async () => { await tab(p, 'SRV Farsi', 'avatars'); return p.evaluate((id) => { const b = document.querySelector('.avl [data-avl="replace"][data-id="' + id + '"]'); return !!b && b.disabled; }, newId); })()));
  const r3 = await p.evaluate(async (id) => { const r = await _publishAuthedFetch('/api/ops?action=srv_avatar_upload', { business: 'srv_farsi', artist: 'duet', focus: { fx: 0.5, fy: 0.3, fw: 0.2 }, image: 'data:image/jpeg;base64,/9j/4AAQ', thumb: 'x', replaceId: id }); return (await r.json()).error; }, newId);
  check('the server also refuses to replace an image in use / invalid payloads', r3 === 'image_type_not_allowed' || r3 === 'avatar_in_use', r3);
  // rename + unused replace
  usedIds.delete(newId);
  await p.evaluate(() => { window.prompt = () => 'Renamed duet'; D.packages = D.packages.filter((q) => q.id !== 'pkg_use2'); });
  await tab(p, 'SRV Farsi', 'avatars');
  await p.evaluate((id) => document.querySelector('.avl [data-avl="rename"][data-id="' + id + '"]').click(), newId); await W(p, 1000);
  check('Rename works and persists', (await text(p)).includes('Renamed duet') && reg.srv_farsi.items[0].label === 'Renamed duet');
  const f2 = await img(p, 2048, 1152); files.push(f2);
  await p.evaluate((id) => document.querySelector('.avl [data-avl="replace"][data-id="' + id + '"]').click(), newId);
  const rr = await upload(p, f2, {}); check('Replace image works for an unused uploaded avatar (same id, new picture)', rr.canGo && /replaced/i.test(rr.msg2) && reg.srv_farsi.items.length === 1 && reg.srv_farsi.items[0].id === newId && reg.srv_farsi.items[0].replacedBy === 'ceo', rr.msg2);
  // the last avatar of an artist is protected
  const mlist = BUILTIN_AVATARS.srv_farsi.male; let refused = null;
  await tab(p, 'SRV Farsi', 'avatars');
  for (const id of mlist) { await p.evaluate((i) => { window.confirm = () => true; const b = document.querySelector('.avl [data-avl="remove"][data-id="' + i + '"]'); if (b) b.click(); }, id); await W(p, 700); const m = await p.$eval('#avlMsg', (e) => e.textContent); if (/at least one active/i.test(m)) { refused = m; break; } }
  check('the last active avatar of an artist cannot be removed (message shown)', refused === null ? (await femLen()) && (await p.evaluate(() => ENGINES_CONFIG.find((e) => e.id === 'srv_farsi').avatarLibrary.male.length)) >= 1 : /at least one active/i.test(refused));
  for (const id of mlist) { if (reg.srv_farsi.overrides[id] && reg.srv_farsi.overrides[id].status === 'removed') await p.evaluate((i) => { const b = document.querySelector('.avl [data-avl="restore"][data-id="' + i + '"]'); if (b) b.click(); }, id), await W(p, 500); }

  // ---- persistence across a reload: the library is applied before anyone opens the manager ----
  await p.reload(); await login(p, stub.origin, 'admin'); await W(p, 2000);
  check('after a reload the library is already applied to the production lists (uploaded avatar present)', await p.evaluate((id) => _srvFarsiAvatarLibrary('duet').some((a) => a.id === id) && _srvFarsiAvatarLibrary('duet').length === 9, newId));

  // ---- SRV English: upload, rotation, removal ----
  await tab(p, 'SRV English', 'avatars');
  const fe = await img(p, 1672, 941); files.push(fe); const ue = await upload(p, fe, { label: 'English portrait' });
  check('English upload works (Female only, no artist choice)', ue.canGo && /added to the library/i.test(ue.msg2) && reg.srv_english.items.length === 1 && reg.srv_english.items[0].artist === 'female', ue.msg2);
  const eid = reg.srv_english.items[0].id;
  check('the English avatar is in the rotation pool the SRV English screens use', await p.evaluate((id) => !!srv2AvatarById(id) && srv2AvatarPool().some((x) => x.id === id), eid));
  check('English record shape: collection final, hdReady, native size, focus', await p.evaluate((id) => { const a = srv2AvatarById(id); return a.collection === 'final' && a.quality.hdReady === true && a.native.w > 1200 && a.focus.fw > 0 && a.orientation === 'landscape' && a.formats.includes('long'); }, eid));
  await p.evaluate(() => { window.confirm = () => true; document.querySelector('.avl [data-avl="remove"][data-id="srv2-fm-01"]').click(); }); await W(p, 1000);
  check('English remove: leaves the rotation pool but stays resolvable for packages that use it', await p.evaluate(() => !srv2AvatarPool().some((x) => x.id === 'srv2-fm-01') && !!srv2AvatarById('srv2-fm-01') && srv2AvatarPool().length === 19));
  check('English rotation never picks the removed avatar and does reach the uploaded one', await p.evaluate((id) => { const seen = new Set(); const hist = []; for (let i = 0; i < 60; i++) { const a = srv2AvatarPick({ history: hist, moodKey: 'emotional' }); seen.add(a.id); hist.push({ id: a.id, at: String(1000 + i) }); } return !seen.has('srv2-fm-01') && seen.has(id); }, eid));
  check('libraries stay separate: nothing English leaked into Farsi and vice versa', await p.evaluate(() => ENGINES_CONFIG.find((e) => e.id === 'srv_farsi').avatarLibrary.female.every((a) => !String(a.id).startsWith('up_e_')) && !SRV_STUDIO_V2_AVATARS.some((a) => String(a.id).startsWith('up_f_'))));

  // ---- errors: expired session ----
  forceNoSession = true; await tab(p, 'SRV Farsi', 'avatars');
  check('with no valid session the manager says so and the built-in libraries keep working', /could not be loaded|sign in/i.test(await text(p)) && await p.evaluate(() => _srvFarsiAvatarLibrary('female').length > 0));
  forceNoSession = false;
  check('no page errors in the Admin run', on.pageErrors.length === e0, on.pageErrors.slice(e0).join(' | '));
  // mobile
  await p.setViewport({ width: 390, height: 844 }); await tab(p, 'SRV Farsi', 'avatars'); check('mobile 390px: the Avatars tab fits without horizontal overflow', !(await hOverflow(p)));
  await p.close();

  // ---- VA ----
  const va = await session('va'); const vp = va.page;
  check('VA: the Operator view carries an Avatar libraries bar for both businesses', await vp.evaluate(async () => { renderTab('tasks'); await new Promise((r) => setTimeout(r, 900)); return [...document.querySelectorAll('#avlBar [data-avl-open]')].map((b) => b.getAttribute('data-avl-open')).join(',') === 'srv_farsi,srv_english'; }));
  check('VA: the library is applied for them as well (the uploaded Farsi duet is live)', await vp.evaluate((id) => _srvFarsiAvatarLibrary('duet').some((a) => a.id === id), newId));
  await vp.evaluate(() => document.querySelector('#avlBar [data-avl-open="srv_farsi"]').click()); await W(vp, 1200);
  check('VA: the manager opens as a dialog with the Farsi groups and the upload box', await vp.evaluate(() => !!document.querySelector('#avlModal .avl') && document.querySelectorAll('#avlModal .avl h3').length >= 4 && !!document.querySelector('#avlModal #avlUp')));
  const fv = await img(vp, 1920, 1080); files.push(fv); const uv = await (async () => { const input = await vp.$('#avlModal #avlFile'); await input.uploadFile(fv); await W(vp, 900); await vp.select('#avlModal #avlArtist', 'male'); await vp.click('#avlModal #avlPrev'); await vp.click('#avlModal #avlGo'); await W(vp, 1200); return vp.$eval('#avlModal #avlMsg', (e) => e.textContent); })();
  check('VA: uploads a Farsi male avatar (recorded as operator)', /added to the library/i.test(uv) && reg.srv_farsi.items.some((x) => x.artist === 'male' && x.createdBy === 'operator'), uv);
  check('VA: Close returns to the Operator view', await vp.evaluate(async () => { document.querySelector('#avlClose').click(); await new Promise((r) => setTimeout(r, 700)); return !document.getElementById('avlModal'); }));
  check('VA: no Admin sidebar / Avatars tab (VA uses the dialog only)', await vp.evaluate(() => !document.getElementById('h2Side')));
  check('no page errors in the VA run', va.pageErrors.length === 0, va.pageErrors.join(' | '));
  await vp.close();

  // ---- Family: no access ----
  const fam = await session('family');
  check('Family: no library bar, no manager, and the registry is never requested or applied', await fam.page.evaluate(async () => { const before = _srvFarsiAvatarLibrary('duet').length; const ok = await AvatarLibrary.load(true); return ok === false && !document.getElementById('avlBar') && _srvFarsiAvatarLibrary('duet').length === before; }));
  await fam.page.close();
} finally { await browser.close(); await stub.close(); for (const f of files) try { fs.unlinkSync(f); } catch {} }
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} checks passed`); process.exit(f ? 1 : 0);
