/* MMMOS — SRV avatar library manager (CEO order 2026-11-11).
 *
 * Authorized CEO/Admin and VA users add, upload, select, replace and remove avatar photos. SRV Farsi (Female / Male / Duet) and SRV English (Female only) keep SEPARATE libraries.
 * The built-in avatars stay where they are (public/assets). A server-held registry (action srv_avatar_*, CEO or VA session only) adds uploaded avatars and records
 * removals/renames. This file (1) loads that registry and applies it IN PLACE to the lists the existing screens already read —
 *   ENGINES_CONFIG.srv_farsi.avatarLibrary[artist]  (Generate/Build/Rebuild, the cover picker, the rotation)  and  SRV_STUDIO_V2_AVATARS (SRV English rotation)
 * — so every existing production step sees library changes without being changed, and (2) draws the manager UI.
 * "Remove" is a reversible retirement: files are never deleted and a removed image stays resolvable, so packages that already use it keep working and can be rebuilt.
 * Without a session, or if the registry cannot be read, nothing is applied and the built-in libraries behave exactly as before.
 */
(function () {
  'use strict';
  if (window.AvatarLibrary) return;
  var ARTISTS = { srv_farsi: ['female', 'male', 'duet'], srv_english: ['female'] };
  var NAMES = { srv_farsi: 'SRV Farsi', srv_english: 'SRV English' };
  var S = { reg: { srv_farsi: null, srv_english: null }, builtins: null, limits: { minWidth: 1280, minHeight: 720, maxImageBytes: 3000000 }, loadedAt: 0, loading: null, ui: {} };
  var MOODS = ['emotional', 'romantic', 'hopeful'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function role() { return (typeof currentUser !== 'undefined' && currentUser && (currentUser.id === 'admin' || currentUser.id === 'va')) ? currentUser.id : null; }
  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

  /* ---- snapshots of the built-in libraries, taken once, before anything is applied ---- */
  var BASE_FARSI = safe(function () {
    var cfg = ENGINES_CONFIG.filter(function (e) { return e.id === 'srv_farsi'; })[0], L = cfg.avatarLibrary, o = {};
    ARTISTS.srv_farsi.forEach(function (a) { o[a] = (L[a] || []).map(function (x) { return Object.assign({}, x); }); }); return o;
  }, null);
  var BASE_ENG = safe(function () { var o = {}; SRV_STUDIO_V2_AVATARS.forEach(function (a) { o[a.id] = { elig: !!a.rotationEligible, focus: a.focus ? Object.assign({}, a.focus) : null }; }); return o; }, null);

  function api(action, body) {
    return _publishAuthedFetch('/api/ops?action=' + action, body || {}).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }

  /* ---- applying the registry to the lists the existing screens read ---- */
  function applyFarsi() {
    if (!BASE_FARSI) return;
    var reg = S.reg.srv_farsi || { items: [], overrides: {} }, lib = ENGINES_CONFIG.filter(function (e) { return e.id === 'srv_farsi'; })[0].avatarLibrary;
    ARTISTS.srv_farsi.forEach(function (a) {
      var eff = [];
      BASE_FARSI[a].forEach(function (b) {
        var o = reg.overrides[b.id] || {}; if (o.status === 'removed') return;
        var e = Object.assign({}, b); if (o.focus) { e.fx = o.focus.fx; e.fy = o.focus.fy; e.fw = o.focus.fw; } if (o.label) e.label = o.label; eff.push(e);
      });
      reg.items.filter(function (x) { return x.artist === a && x.status !== 'removed'; }).forEach(function (x) { eff.push({ id: x.id, src: x.src, thumb: x.thumb, fx: x.fx, fy: x.fy, fw: x.fw, label: x.label, uploaded: true }); });
      if (!eff.length) eff = BASE_FARSI[a].map(function (b) { return Object.assign({}, b); });    // never leave a group empty
      lib[a].length = 0; eff.forEach(function (e) { lib[a].push(e); });
    });
  }
  function retiredFarsi(artist, id) {
    var reg = S.reg.srv_farsi; if (!reg) return null;
    var b = (BASE_FARSI && BASE_FARSI[artist] || []).filter(function (x) { return x.id === id; })[0]; if (b) return Object.assign({}, b);
    var u = reg.items.filter(function (x) { return x.id === id && x.artist === artist; })[0];
    return u ? { id: u.id, src: u.src, thumb: u.thumb, fx: u.fx, fy: u.fy, fw: u.fw, label: u.label, uploaded: true, retired: true } : null;
  }
  function engRecord(x) {
    var w = x.file ? x.file.width : 1672, h = x.file ? x.file.height : 941;
    return { id: x.id, number: 100, collection: 'final', title: x.label || 'Uploaded avatar', file: String(x.src).split('/').pop(), originalFile: '', src: x.src, sha256: x.file ? x.file.sha256 : '', native: { w: w, h: h }, crop: { x: 0, y: 0, w: w, h: h },
      orientation: 'landscape', aspect: +(w / h).toFixed(3), focus: { fx: x.fx, fy: x.fy, fw: x.fw }, moods: MOODS.slice(), pose: 'uploaded', scene: 'uploaded', formats: ['long', 'short'], tone: 'uploaded',
      rotationEligible: x.status !== 'removed', uploaded: true, thumb: x.thumb,
      quality: { status: 'uploaded-master', hdReady: w >= 1280 && h >= 720, fullHD: w >= 1920 && h >= 1080, detail: 'ok', sharpness: 100, scale: { thumbnail1280x720: +(1280 / w).toFixed(2), long1920x1080: +(1920 / w).toFixed(2), shortSquareCard1080: +(1080 / h).toFixed(2) } }, flags: [] };
  }
  function applyEnglish() {
    if (!BASE_ENG) return;
    var reg = S.reg.srv_english || { items: [], overrides: {} };
    for (var i = SRV_STUDIO_V2_AVATARS.length - 1; i >= 0; i--) if (SRV_STUDIO_V2_AVATARS[i].uploaded) SRV_STUDIO_V2_AVATARS.splice(i, 1);
    SRV_STUDIO_V2_AVATARS.forEach(function (a) {
      var b = BASE_ENG[a.id]; if (!b) return; var o = reg.overrides[a.id] || {};
      a.rotationEligible = b.elig && o.status !== 'removed';
      if (o.focus) a.focus = { fx: o.focus.fx, fy: o.focus.fy, fw: o.focus.fw }; else if (b.focus) a.focus = Object.assign({}, b.focus);
    });
    reg.items.forEach(function (x) { SRV_STUDIO_V2_AVATARS.push(engRecord(x)); });   // removed uploads stay in the list (resolvable) but are not rotation-eligible
  }
  function apply() { safe(applyFarsi); safe(applyEnglish); }
  // a removed Farsi cover that a task already chose (or a package already used) must still resolve
  var _byId = window._srvFarsiAvatarById;
  if (typeof _byId === 'function') window._srvFarsiAvatarById = function (artist, id) { return _byId(artist, id) || retiredFarsi(artist, id); };

  function load(force) {
    if (!role()) return Promise.resolve(false);
    if (S.loading) return S.loading;
    if (!force && S.loadedAt && Date.now() - S.loadedAt < 5 * 60 * 1000) return Promise.resolve(true);
    S.loading = api('srv_avatar_library_get', {}).then(function (r) {
      S.loading = null;
      if (r.status !== 200 || !r.body || !r.body.ok || !r.body.libraries || typeof r.body.libraries !== 'object') return false;   // malformed or unavailable reply: apply nothing, the built-in libraries keep working
      S.reg = { srv_farsi: r.body.libraries.srv_farsi || { items: [], overrides: {} }, srv_english: r.body.libraries.srv_english || { items: [], overrides: {} } };
      S.reg.srv_farsi.items = S.reg.srv_farsi.items || []; S.reg.srv_farsi.overrides = S.reg.srv_farsi.overrides || {}; S.reg.srv_english.items = S.reg.srv_english.items || []; S.reg.srv_english.overrides = S.reg.srv_english.overrides || {};
      S.builtins = r.body.builtins; if (r.body.limits) S.limits = r.body.limits; S.loadedAt = Date.now(); apply(); return true;
    }).catch(function () { S.loading = null; return false; });
    return S.loading;
  }

  /* ---- usage (client-side, from what is loaded: advisory; the server re-checks before it refuses a replace) ---- */
  function usage(id) {
    var n = 0;
    (typeof D !== 'undefined' && D.packages || []).forEach(function (p) { if (p && (p.srvAvatarId === id || (p.srvAvatar && p.srvAvatar.id === id) || (p._srvAvatarChoice && p._srvAvatarChoice.id === id))) n++; });
    (typeof D !== 'undefined' && D.tasks || []).forEach(function (t) { if (t && t.srvAvatarId === id) n++; });
    return n;
  }

  /* ---- image preparation (browser): type by bytes, size, 16:9, re-encode to JPEG, thumbnail ---- */
  function readHead(file) { return file.slice(0, 12).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function prepare(file) {
    var L = S.limits;
    return readHead(file).then(function (h) {
      var jpg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff, png = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
      if (!jpg && !png) throw new Error('Only JPEG or PNG images are accepted (this file is not one).');
      if (file.size > 25 * 1024 * 1024) throw new Error('This file is too large (' + Math.round(file.size / 1048576) + ' MB). Use an image under 25 MB.');
      return createImageBitmap(file);
    }).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      if (w < L.minWidth || h < L.minHeight) throw new Error('The image is ' + w + '×' + h + ' px; at least ' + L.minWidth + '×' + L.minHeight + ' is needed.');
      var ar = w / h; if (ar < 1.6 || ar > 1.95) throw new Error('The image must be a 16:9 landscape picture (this one is ' + ar.toFixed(2) + ':1).');
      var cw = Math.min(w, 2400), ch = Math.round(cw / ar), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; cv.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
      var enc = function (c, q) { return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', q); }); };
      var q = 0.92;
      return enc(cv, q).then(function step(b) { if (b && b.size > L.maxImageBytes && q > 0.5) { q -= 0.1; return enc(cv, q).then(step); } return b; }).then(function (img) {
        if (!img || img.size > L.maxImageBytes) throw new Error('The image is still above ' + Math.round(L.maxImageBytes / 1048576) + ' MB after compression; use a smaller picture.');
        var tw = 480, tc = document.createElement('canvas'); tc.width = tw; tc.height = Math.round(tw / ar); tc.getContext('2d').drawImage(bmp, 0, 0, tc.width, tc.height);
        return enc(tc, 0.82).then(function (th) { return Promise.all([blobUrl(img), blobUrl(th)]).then(function (u) { return { image: u[0], thumb: u[1], width: cw, height: ch, bytes: img.size, previewUrl: u[0] }; }); });
      });
    });
  }
  function blobUrl(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('Could not read the image.')); }; r.readAsDataURL(b); }); }

  var ERR = { session_required: 'Your session has ended. Sign in again and retry.', image_too_large: 'The image is too large.', image_too_small: 'The image is too small.', image_not_landscape_16_9: 'The image must be a 16:9 landscape picture.', image_type_not_allowed: 'Only JPEG or PNG images are accepted.',
    duplicate_image: 'This image is already in the library.', avatar_in_use: 'Packages or tasks use this image, so it cannot be replaced. Add a new avatar and remove this one from the library instead.', last_active_avatar: 'Every artist keeps at least one active avatar — this is the last one.',
    artist_not_allowed: 'That artist is not allowed for this business.', library_full: 'The library is full.', focus_out_of_range: 'The face position is outside the picture.', upload_failed: 'The upload failed. Nothing was changed; try again.', update_failed: 'The change failed. Nothing was changed; try again.' };
  function errText(r) { var e = r && r.body && r.body.error; return (ERR[e] || ('Could not complete this (' + (e || 'HTTP ' + (r && r.status)) + ').')) + (r && r.body && r.body.detail ? ' ' + r.body.detail : ''); }

  /* ---- manager UI ---- */
  function css() {
    if ($('avlStyle')) return;
    var s = document.createElement('style'); s.id = 'avlStyle';
    s.textContent = '.avl{font-family:"Syne",sans-serif;color:var(--text)}.avl h3{font-size:13px;letter-spacing:1.2px;color:var(--gold);margin:18px 0 8px;font-family:"JetBrains Mono",monospace;text-transform:uppercase}.avl .note{font-size:11px;color:var(--dim);line-height:1.6;margin-bottom:8px}' +
      '.avl .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.avl .card{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:8px;font-size:11px}.avl .card.off{opacity:.55}' +
      '.avl .card img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;display:block;background:#0b0d12}.avl .meta{margin:6px 0 4px;line-height:1.5;word-break:break-word}.avl .tag{display:inline-block;font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;border:1px solid var(--border);color:var(--dim);margin-right:4px}.avl .tag.up{color:#22c55e;border-color:rgba(34,197,94,.4)}.avl .tag.rm{color:#ef4444;border-color:rgba(239,68,68,.4)}' +
      '.avl button{background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.4);color:var(--gold);border-radius:6px;padding:4px 8px;font-size:10px;font-weight:800;cursor:pointer;font-family:inherit;margin:2px 2px 0 0}.avl button[disabled]{opacity:.4;cursor:not-allowed}.avl button.danger{color:#ef4444;border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.08)}' +
      '.avl .up-box{border:1px dashed rgba(201,168,76,.4);border-radius:10px;padding:12px;margin:10px 0}.avl .up-box label{display:block;font-size:10px;color:var(--dim);margin:8px 0 3px;letter-spacing:1px}.avl .up-box input[type=text],.avl .up-box select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:7px 9px;color:var(--text);font-size:12px;font-family:inherit}' +
      '.avl .prev{position:relative;max-width:520px;margin-top:8px;cursor:crosshair;border:1px solid var(--border);border-radius:8px;overflow:hidden}.avl .prev img{width:100%;display:block}.avl .prev .ring{position:absolute;border:2px solid #22c55e;border-radius:50%;box-shadow:0 0 0 9999px rgba(0,0,0,.35);transform:translate(-50%,-50%);pointer-events:none}' +
      '.avl .msg{font-size:11px;margin-top:8px;line-height:1.5}.avl .msg.err{color:#ef4444}.avl .msg.ok{color:#22c55e}.avl-modal{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;overflow:auto;padding:20px}.avl-modal .box{max-width:920px;margin:0 auto;background:var(--surface,#0f1218);border:1px solid var(--border);border-radius:14px;padding:16px}.avl-modal .close{float:right}';
    document.head.appendChild(s);
  }
  function groups(business) {
    var reg = S.reg[business] || { items: [], overrides: {} }, out = [];
    ARTISTS[business].forEach(function (a) {
      var cards = [];
      if (business === 'srv_farsi') {
        (BASE_FARSI[a] || []).forEach(function (b) { var o = reg.overrides[b.id] || {}; cards.push({ id: b.id, thumb: b.thumb, label: o.label || b.id, builtin: true, removed: o.status === 'removed', fx: o.focus ? o.focus.fx : b.fx, fy: o.focus ? o.focus.fy : b.fy, fw: o.focus ? o.focus.fw : b.fw }); });
      } else {
        SRV_STUDIO_V2_AVATARS.filter(function (x) { return !x.uploaded && BASE_ENG[x.id]; }).forEach(function (b) { var o = reg.overrides[b.id] || {}; var held = !BASE_ENG[b.id].elig; cards.push({ id: b.id, thumb: b.src, label: b.title || b.id, builtin: true, removed: o.status === 'removed', held: held, fx: b.focus && b.focus.fx, fy: b.focus && b.focus.fy, fw: b.focus && b.focus.fw }); });
      }
      reg.items.filter(function (x) { return x.artist === a; }).forEach(function (x) { cards.push({ id: x.id, thumb: x.thumb, label: x.label || x.id, uploaded: true, removed: x.status === 'removed', fx: x.fx, fy: x.fy, fw: x.fw }); });
      out.push({ artist: a, cards: cards });
    });
    return out;
  }
  function cardHtml(business, g, c) {
    var n = usage(c.id), idx = (business === 'srv_farsi' && !c.removed) ? ENGINES_CONFIG.filter(function (e) { return e.id === 'srv_farsi'; })[0].avatarLibrary[g.artist].map(function (x) { return x.id; }).indexOf(c.id) : -1;
    return '<div class="card' + (c.removed ? ' off' : '') + '"><img loading="lazy" src="' + esc(c.thumb) + '" alt=""><div class="meta"><b>' + esc(c.label) + '</b><br>' + (c.uploaded ? '<span class="tag up">Uploaded</span>' : '<span class="tag">Built-in</span>') +
      (c.removed ? '<span class="tag rm">Removed</span>' : (c.held ? '<span class="tag">Held alternate</span>' : '<span class="tag">In library</span>')) + '<br><span style="color:var(--dim)">' + (n ? 'Used by ' + n + ' package' + (n > 1 ? 's' : '') + '/task' + (n > 1 ? 's' : '') : 'Not used yet') + '</span></div>' +
      (c.held ? '' : (c.removed ? '<button data-avl="restore" data-id="' + esc(c.id) + '">Restore</button>' :
        '<button data-avl="remove" data-id="' + esc(c.id) + '" class="danger">Remove</button>' + '<button data-avl="rename" data-id="' + esc(c.id) + '">Rename</button>' +
        (c.uploaded ? '<button data-avl="replace" data-id="' + esc(c.id) + '" data-art="' + esc(g.artist) + '"' + (n ? ' disabled title="Used by packages or tasks — add a new avatar instead"' : '') + '>Replace image</button>' : '') +
        (idx >= 0 ? '<button data-avl="next" data-id="' + esc(c.id) + '" data-art="' + esc(g.artist) + '" data-idx="' + idx + '">Use next</button>' : ''))) + '</div>';
  }
  function render(el, business) {
    css(); var G = groups(business), U = S.ui[business] || (S.ui[business] = { fx: 0.5, fy: 0.35, fw: business === 'srv_farsi' ? 0.2 : 0.17 });
    var farsi = business === 'srv_farsi';
    el.innerHTML = '<div class="avl" data-business="' + business + '"><div class="note">' + (farsi ? 'SRV Farsi avatars, one library per artist (Female / Male / Duet). Shorts and Longs share them: the build picks the next one in rotation unless a cover is chosen for that task.' : 'SRV English avatars (Female artist only). New productions pick from the active images in rotation.') +
      ' <b>Remove</b> hides an image from selection and rotation; packages that already use it keep working and it can be restored — files are never deleted.</div>' +
      G.map(function (g) { var act = g.cards.filter(function (c) { return !c.removed && !c.held; }).length; return '<h3>' + (farsi ? esc(g.artist) + ' avatars' : 'Female avatars') + ' — ' + act + ' active</h3><div class="grid">' + g.cards.map(function (c) { return cardHtml(business, g, c); }).join('') + '</div>'; }).join('') +
      '<h3>Add or upload an avatar</h3><div class="up-box" id="avlUp"><div class="note">JPEG or PNG, 16:9 landscape, at least ' + S.limits.minWidth + '×' + S.limits.minHeight + ' px. Click the face(s) in the preview and set how wide they are — the Short crop is framed on it' + (farsi ? ' (for a duet, set the width to cover both faces)' : '') + '.</div>' +
      '<input type="file" id="avlFile" accept="image/jpeg,image/png"><div id="avlPrevWrap"></div>' +
      (farsi ? '<label>ARTIST</label><select id="avlArtist"><option value="female">Female</option><option value="male">Male</option><option value="duet">Duet</option></select>' : '') +
      '<label>NAME (OPTIONAL)</label><input type="text" id="avlLabel" maxlength="80" placeholder="e.g. Golden hour portrait"><div id="avlReplaceNote" class="note" style="margin-top:6px"></div>' +
      '<div style="margin-top:10px"><button id="avlGo" disabled>Upload to the ' + esc(NAMES[business]) + ' library</button> <button id="avlCancel" style="display:none">Cancel replace</button></div><div class="msg" id="avlMsg"></div></div></div>';
    wire(el, business, U);
  }
  function msg(el, text, kind) { var m = el.querySelector('#avlMsg'); if (m) { m.textContent = text || ''; m.className = 'msg ' + (kind || ''); } }
  function wire(el, business, U) {
    var P = { prep: null, replaceId: null, art: null }, up = el.querySelector('#avlUp'), go = el.querySelector('#avlGo');
    function paintPrev() {
      var w = el.querySelector('#avlPrevWrap'); if (!P.prep) { w.innerHTML = ''; return; }
      w.innerHTML = '<div class="prev" id="avlPrev"><img src="' + P.prep.previewUrl + '" alt="preview"><div class="ring" id="avlRing"></div></div><label style="display:block;font-size:10px;color:var(--dim);margin:8px 0 3px;letter-spacing:1px">FACE WIDTH</label><input type="range" id="avlFw" min="3" max="60" value="' + Math.round(U.fw * 100) + '">';
      ring();
      el.querySelector('#avlPrev').addEventListener('click', function (ev) { var r = this.getBoundingClientRect(); U.fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)); U.fy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)); ring(); });
      el.querySelector('#avlFw').addEventListener('input', function () { U.fw = Math.min(0.6, Math.max(0.03, this.value / 100)); ring(); });
    }
    function ring() { var r = el.querySelector('#avlRing'), p = el.querySelector('#avlPrev'); if (!r || !p) return; var w = p.getBoundingClientRect().width || 480; r.style.left = (U.fx * 100) + '%'; r.style.top = (U.fy * 100) + '%'; r.style.width = r.style.height = (U.fw * w) + 'px'; }
    el.querySelector('#avlFile').addEventListener('change', function () {
      var f = this.files && this.files[0]; P.prep = null; go.disabled = true; msg(el, f ? 'Checking the image…' : '', '');
      if (!f) { paintPrev(); return; }
      prepare(f).then(function (p) { P.prep = p; go.disabled = false; msg(el, 'Image OK: ' + p.width + '×' + p.height + ', ' + Math.round(p.bytes / 1024) + ' KB. Mark the face, then upload.', 'ok'); paintPrev(); }).catch(function (e) { msg(el, e.message || String(e), 'err'); paintPrev(); });
    });
    el.querySelector('#avlCancel').addEventListener('click', function () { P.replaceId = null; el.querySelector('#avlReplaceNote').textContent = ''; this.style.display = 'none'; });
    go.addEventListener('click', function () {
      if (!P.prep) return; go.disabled = true; msg(el, 'Uploading…', '');
      var art = P.replaceId ? P.art : (el.querySelector('#avlArtist') ? el.querySelector('#avlArtist').value : 'female');
      api('srv_avatar_upload', { business: business, artist: art, label: el.querySelector('#avlLabel').value, focus: { fx: U.fx, fy: U.fy, fw: U.fw }, image: P.prep.image, thumb: P.prep.thumb, replaceId: P.replaceId || undefined }).then(function (r) {
        if (r.status === 200 && r.body.ok) { done(el, business, P.replaceId ? 'Image replaced.' : 'Avatar added to the library.'); } else { go.disabled = false; msg(el, errText(r), 'err'); }
      }).catch(function () { go.disabled = false; msg(el, 'Network error — nothing was changed. Try again.', 'err'); });
    });
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-avl]'); if (!b || b.disabled) return; var id = b.getAttribute('data-id'), a = b.getAttribute('data-avl');
      if (a === 'replace') { P.replaceId = id; P.art = b.getAttribute('data-art'); el.querySelector('#avlReplaceNote').textContent = 'Replacing the image of ' + id + ' — choose the new file above, mark the face, then upload.'; el.querySelector('#avlCancel').style.display = ''; el.querySelector('#avlUp').scrollIntoView({ block: 'center' }); return; }
      if (a === 'next') { var key = 'lib.' + b.getAttribute('data-art'); if (!D.srvFarsiAvatarIdx || typeof D.srvFarsiAvatarIdx !== 'object') D.srvFarsiAvatarIdx = {}; D.srvFarsiAvatarIdx[key] = Number(b.getAttribute('data-idx')); if (typeof saveAppState === 'function') saveAppState(); msg(el, id + ' will be used for the next ' + b.getAttribute('data-art') + ' build in rotation.', 'ok'); return; }
      var body = { business: business, id: id, op: a };
      if (a === 'rename') { var nm = window.prompt('New name for ' + id, ''); if (nm == null) return; body.op = 'update'; body.label = nm; }
      if (a === 'remove' && !window.confirm('Remove ' + id + ' from the library?\n\nIt is hidden from selection and rotation. Packages that already use it keep working, and you can restore it later. The file is not deleted.')) return;
      msg(el, 'Saving…', ''); api('srv_avatar_update', body).then(function (r) {
        if (r.status === 200 && r.body.ok) done(el, business, a === 'remove' ? (r.body.inUse ? 'Removed from the library (still used by existing packages, which keep working).' : 'Removed from the library.') : a === 'restore' ? 'Restored.' : 'Saved.'); else msg(el, errText(r), 'err');
      }).catch(function () { msg(el, 'Network error — nothing was changed.', 'err'); });
    });
  }
  function done(el, business, text) { load(true).then(function () { render(el, business); msg(el, text, 'ok'); if (typeof renderTab === 'function' && typeof currentTab !== 'undefined' && role() === 'va' && currentTab === 'tasks') { /* the VA's Operator view re-renders when the dialog closes */ } }); }

  function mount(el, business) { if (!el || !ARTISTS[business]) return; css(); el.innerHTML = '<div class="avl"><div class="note">Loading the avatar library…</div></div>'; load(true).then(function (okLoad) { if (!okLoad) { el.innerHTML = '<div class="avl"><div class="msg err">The avatar library could not be loaded (sign in again, or try later). The built-in avatars keep working.</div></div>'; return; } render(el, business); }); }
  function modal(business) {
    css(); var m = document.createElement('div'); m.className = 'avl-modal'; m.id = 'avlModal';
    m.innerHTML = '<div class="box"><button class="close" id="avlClose" style="padding:6px 12px;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer">Close ✕</button><div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:6px">🖼 ' + esc(NAMES[business]) + ' avatar library</div><div id="avlModalBody"></div></div>';
    document.body.appendChild(m);
    m.querySelector('#avlClose').addEventListener('click', function () { m.remove(); if (typeof renderTab === 'function' && typeof currentTab !== 'undefined') renderTab(currentTab); });
    mount(m.querySelector('#avlModalBody'), business);
  }

  /* ---- VA entry point: the Operator view gets one bar with both libraries (the VA has no sidebar) ---- */
  function vaBar() {
    if (role() !== 'va') return; var c = $('mainContent'); if (!c || $('avlBar')) return;
    if (!/OPERATOR MODE/.test(c.innerText || '')) return;
    var d = document.createElement('div'); d.id = 'avlBar'; d.style.cssText = 'max-width:480px;margin:0 auto 10px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;font-size:11px;color:var(--dim);display:flex;gap:6px;align-items:center;flex-wrap:wrap';
    d.innerHTML = '🖼 Avatar libraries: <button type="button" data-avl-open="srv_farsi" style="background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.4);color:var(--gold);border-radius:6px;padding:5px 10px;font-weight:800;cursor:pointer;font-family:inherit">SRV Farsi</button><button type="button" data-avl-open="srv_english" style="background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.4);color:var(--gold);border-radius:6px;padding:5px 10px;font-weight:800;cursor:pointer;font-family:inherit">SRV English</button>';
    c.insertBefore(d, c.firstChild);
  }
  document.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('[data-avl-open]'); if (b && role()) modal(b.getAttribute('data-avl-open')); });
  var cEl = $('mainContent'); if (cEl && window.MutationObserver) new MutationObserver(function () { vaBar(); }).observe(cEl, { childList: true });

  /* ---- load once per session as soon as someone with access is signed in, before they reach Generate/Build ---- */
  var _rt = window.renderTab;
  if (typeof _rt === 'function') window.renderTab = function () { if (role() && !S.loadedAt && !S.loading) load(false); return _rt.apply(this, arguments); };
  window.AvatarLibrary = { mount: mount, modal: modal, load: load, apply: apply, state: S, usage: usage };
  if (role()) load(false);
})();
