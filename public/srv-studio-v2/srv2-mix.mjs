// SRV-STUDIO-V2-033 — Monthly Mix Builder (SRV Studio only; loaded by the app only when app_settings.srv_studio_v2_mix
// is enabled). Lifecycle: Generate → Select → Arrange & Preview → Visual → Metadata → Build → Approve → Private upload → Done.
// Audio: each song's ORIGINAL MP3 when kept (order 029), else its Long video soundtrack — never modified. Songs are
// analysed one at a time (edges + loudness), then rendered in real time with ROLLING decoding (at most two songs in
// memory), equal-power crossfades, −14 LUFS normalisation and a true-peak limiter. Upload: resumable to storage (TUS),
// then the server moves it to YouTube PRIVATELY one chunk per call. Nothing here can make a video public.
import * as R from './srv2-render.mjs';
import * as M from './lib/srvStudioV2Mix.mjs';
import * as A from './lib/srvStudioV2MixAudio.mjs';

export const SRV2_MIX_UI_VERSION = 'srv2-mix-1';
export const SR = 48000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortErr = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── audio ──
async function decodeFrom(url, fetchImpl, signal) {
  const r = await fetchImpl(url, { signal }); if (!r.ok) throw new Error('could not load song audio (HTTP ' + r.status + ')');
  const ab = await r.arrayBuffer(); const ctx = new OfflineAudioContext(2, SR, SR); return ctx.decodeAudioData(ab);
}
const chans = (b) => [b.getChannelData(0), b.getChannelData(Math.min(1, b.numberOfChannels - 1))];
// One song: edges (lead silence, tail silence, built-in fade) and loudness of the part that is used.
export async function analyseSong(song, { fetchImpl = fetch, signal } = {}) {
  const buf = await decodeFrom(song.sourceUrl, fetchImpl, signal);
  const ch = chans(buf); const edges = A.srv2Edges(ch, SR, song.audioSource);
  const i0 = Math.round(edges.inSec * SR), i1 = Math.round(edges.outSec * SR);
  const lufs = M.srv2Loudness(ch.map((c) => c.subarray(i0, i1)), SR).lufs; const g = A.srv2NormGain(lufs);
  return { pkgId: song.pkgId, audioSource: song.audioSource, edges, lufs, gainDb: g.gainDb, gain: g.gain, boostCapped: g.capped, sampleRate: buf.sampleRate, analysedAt: new Date().toISOString(), version: SRV2_MIX_UI_VERSION };
}
export function timelineFrom(tracks, analysis, crossfadeSec = M.SRV2_MIX_CONFIG.crossfadeSec) {
  return M.srv2MixTimeline(tracks.map((t) => ({ pkgId: t.pkgId, title: t.title, youtubeVideoId: t.youtubeVideoId, source: t.audioSource, durationSec: analysis[t.pkgId] ? analysis[t.pkgId].edges.usedSec : Math.max(30, t.durationSec - 3.5) })), { crossfadeSec });
}
// Transition preview: tail of song A + head of song B with the production rules (trim, gains, crossfade, limiter).
export async function transitionPreview(a, b, analysis, { fetchImpl = fetch, signal, padSec = 10, crossfadeSec = M.SRV2_MIX_CONFIG.crossfadeSec } = {}) {
  const [ba, bb] = await Promise.all([decodeFrom(a.sourceUrl, fetchImpl, signal), decodeFrom(b.sourceUrl, fetchImpl, signal)]);
  const ea = analysis[a.pkgId].edges, eb = analysis[b.pkgId].edges;
  const ta = Math.min(ea.usedSec, padSec + crossfadeSec), tb = Math.min(eb.usedSec, padSec + crossfadeSec);
  const cut = (buf, from, len) => chans(buf).map((c) => c.slice(Math.round(from * SR), Math.round((from + len) * SR)));
  const src = [cut(ba, ea.outSec - ta, ta), cut(bb, eb.inSec, tb)];
  const tl = M.srv2MixTimeline([{ pkgId: 'a', title: a.title, durationSec: ta }, { pkgId: 'b', title: b.title, durationSec: tb }], { crossfadeSec });
  const cfg = { ...M.SRV2_MIX_CONFIG, introFadeSec: 0.01, outroFadeSec: 0.01 };
  const mix = M.srv2MixPcm(src, tl, [analysis[a.pkgId].gain, analysis[b.pkgId].gain], SR, cfg);
  const lim = new A.Srv2Limiter(SR); const o = lim.process(mix); const f = lim.flush();
  const out = [0, 1].map((c) => { const x = new Float32Array(mix[0].length); x.set(o[c].subarray(lim.latency)); x.set(f[c].subarray(0, lim.latency), o[c].length - lim.latency); return x; });
  const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: 2, sampleRate: SR }); buf.copyToChannel(out[0], 0); buf.copyToChannel(out[1], 1);
  return { buffer: buf, joinAtSec: tl.items[1].startSec, continuity: M.srv2JoinContinuity(out, SR, tl, Math.min(padSec, 6))[0] };
}

// ── full-length render: rolling decode + scheduled gapless segments + true-peak limiter ──
export async function renderMix({ tracks, analysis, tl, avatar, monthLabel, videoBitsPerSecond, canvas, onProgress, signal, fetchImpl = fetch, fx }) {
  const cfg = M.SRV2_MIX_CONFIG; const say = (m, f) => { try { onProgress && onProgress(m, f); } catch (_) {} };
  if (!R.srv2AvatarProductionReady(avatar)) throw new Error('Only an approved final image can be used');
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video');
  const mime = R.srv2PickMime((m) => MediaRecorder.isTypeSupported(m)); if (!mime) throw new Error('No supported video format'); const info = R.srv2MimeInfo(mime);
  const edges = tracks.map((t) => analysis[t.pkgId].edges), gains = tracks.map((t) => analysis[t.pkgId].gain);
  say('Loading fonts and image…', 0);
  const [fontsOk, img] = await Promise.all([R.srv2LoadFonts(), R.srv2LoadImage(avatar.src)]);
  const duration = tl.totalSec; const prepared = R.srv2PrepareSource(img, avatar.crop);
  const scene = R.srv2CreateScene({ kind: 'long', img, avatar, title: 'Monthly Mix', hook: '', timeline: R.srv2LongTimeline({ duration, chorusStart: null, hook: '', seed: avatar.id + '|mix|' + monthLabel }), logo: null, prepared, fx: R.srv2NormalizeFx(fx === undefined ? R.SRV2_FX_DEFAULTS : fx) });
  canvas.width = cfg.width; canvas.height = cfg.height; const ctx = canvas.getContext('2d', { alpha: false });
  // audio graph: segment sources → bus → (recorder, analyser)
  const actx = new AudioContext({ sampleRate: SR }); const bus = actx.createGain(); const an = actx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.6;
  const dest = actx.createMediaStreamDestination(); bus.connect(dest); bus.connect(an);
  const segs = A.srv2MixSegments(tl); const decoded = new Map(); const pending = new Map();
  const getSong = (i) => { if (decoded.has(i)) return Promise.resolve(decoded.get(i)); if (!pending.has(i)) pending.set(i, decodeFrom(tracks[i].sourceUrl, fetchImpl, signal).then((b) => { const c = chans(b); decoded.set(i, c); pending.delete(i); return c; })); return pending.get(i); };
  const lim = new A.Srv2Limiter(SR); let toDrop = lim.latency, outPos = 0; const live = new Set(); let t0 = 0; let peakSongs = 0;
  const prepare = async (k) => {
    const src = []; for (const i of segs[k].needs) src[i] = await getSong(i);
    peakSongs = Math.max(peakSongs, decoded.size);
    const pcm = A.srv2MixSegmentPcm(k, tl, src, edges, gains, SR);
    for (const i of [...decoded.keys()]) if (i < k) decoded.delete(i); // song k−1 is no longer needed after segment k
    return lim.process(pcm);
  };
  const schedule = (pcm) => {
    let a = pcm; if (toDrop) { const d = Math.min(toDrop, a[0].length); a = a.map((c) => c.subarray(d)); toDrop -= d; }
    const n = a[0].length; if (!n) return;
    const b = actx.createBuffer(2, n, SR); b.copyToChannel(a[0], 0); b.copyToChannel(a[1], 1);
    const s = actx.createBufferSource(); s.buffer = b; s.connect(bus); s.start(t0 + outPos / SR); outPos += n; live.add(s); s.onended = () => { live.delete(s); s.disconnect(); };
  };
  say('Preparing song 1…', 0);
  const first = await prepare(0); if (segs.length > 1) getSong(1);
  let stream = canvas.captureStream(0); let vt = stream.getVideoTracks()[0]; if (!vt || typeof vt.requestFrame !== 'function') { stream = canvas.captureStream(cfg.fps); vt = null; }
  const rec = new MediaRecorder(new MediaStream(stream.getVideoTracks().concat(dest.stream.getAudioTracks())), { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: cfg.audioBitsPerSecond });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); }; const stopped = new Promise((r) => { rec.onstop = r; });
  const bins = new Uint8Array(an.frequencyBinCount); const binHz = SR / an.fftSize; const bass = R.srv2BassFollower(); const mon = new R.Srv2FrameMonitor(cfg.fps);
  let hidden = 0; const onVis = () => { if (document.hidden) hidden++; }; document.addEventListener('visibilitychange', onVis);
  await actx.resume(); for (let c0 = actx.currentTime, i = 0; actx.currentTime === c0 && i < 300; i++) await sleep(10);
  t0 = actx.currentTime + 0.4; schedule(first);
  // keep one segment ahead: prepare segment k+1 while segment k plays
  let failure = null;
  // Rolling: segment k is prepared only once segment k−1 is playing (≈ 4 min of slack); at most two segments and two
  // decoded songs exist at any time. Played segments are released by their 'ended' handler.
  let finished = false;
  const waitPlaying = async (sec) => { while (!finished && !(signal && signal.aborted) && actx.currentTime < t0 + sec) await sleep(250); };
  const feeder = (async () => { try { for (let k = 1; k < segs.length; k++) { await waitPlaying(segs[k - 1].fromSec); if (finished || (signal && signal.aborted)) return; const p = await prepare(k); schedule(p); if (k + 1 < segs.length) getSong(k + 1).catch((e) => { failure = e; }); } schedule(lim.flush()); } catch (e) { failure = e; } })();
  rec.start(1000); const started = performance.now(); let frame = 0;
  try {
    await new Promise((resolve, reject) => {
      const step = () => {
        if (signal && signal.aborted) { reject(abortErr()); return; }
        if (failure) { reject(failure); return; }
        const t = actx.currentTime - t0; if (t >= duration + 0.2) { resolve(); return; }
        an.getByteFrequencyData(bins); const lv = bass(bins, binHz);
        const p0 = performance.now(); R.srv2DrawFrame(ctx, scene, Math.max(0, t), lv, frame++); drawMixOverlay(ctx, tl, Math.max(0, t), monthLabel); if (vt) vt.requestFrame(); mon.tick(performance.now() / 1000, performance.now() - p0);
        if (frame % 30 === 0) say(`Rendering ${M.srv2Clock(Math.max(0, t))} / ${M.srv2Clock(duration)}${hidden ? ' — keep this tab in front' : ''}`, Math.min(1, t / duration));
        setTimeout(step, 1000 / cfg.fps - 2);
      };
      step();
    });
  } finally {
    finished = true;
    try { rec.stop(); } catch (_) {} await stopped.catch(() => {});
    for (const s of live) { try { s.stop(); } catch (_) {} }
    document.removeEventListener('visibilitychange', onVis); try { await actx.close(); } catch (_) {}
    stream.getTracks().forEach((x) => x.stop()); await feeder; decoded.clear();
  }
  const blob = new Blob(chunks, { type: info.type });
  const tc = document.createElement('canvas'); tc.width = 1280; tc.height = 720; const tctx = tc.getContext('2d');
  R.srv2PaintThumbnail(tctx, prepared, avatar, { title: 'Monthly Mix', W: 1280, H: 720, logo: null }); drawThumbBadge(tctx, monthLabel, tl);
  const thumbBlob = await new Promise((r) => tc.toBlob(r, 'image/jpeg', 0.9));
  return { blob, mime, ext: info.ext, thumbBlob, stats: { version: SRV2_MIX_UI_VERSION, width: cfg.width, height: cfg.height, fps: cfg.fps, codec: info.video + '/' + info.audio, durationSec: +duration.toFixed(2), sizeBytes: blob.size, measuredKbps: Math.round(blob.size * 8 / duration / 1000), targetVideoKbps: Math.round(videoBitsPerSecond / 1000), renderSec: +((performance.now() - started) / 1000).toFixed(1), frames: mon.summary(duration), hiddenDuringRender: hidden > 0, fontsLoaded: !!fontsOk, limiter: lim.stats(), maxSongsDecoded: peakSongs, avatarId: avatar.id } };
}
export function drawMixOverlay(ctx, tl, t, monthLabel) {
  // placement avoids the scene's own text: wordmark top-right, corner tag bottom-left, title card right
  const H = ctx.canvas.height; const cur = tl.items.filter((x) => x.chapterSec <= t).pop(); if (!cur) return;
  const since = t - cur.chapterSec; const a = since < 0.8 ? since / 0.8 : since > 9 ? Math.max(0, 10 - since) : 1;
  ctx.save(); ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 14;
  if (t < 8) { ctx.globalAlpha = t < 1 ? t : t > 7 ? 8 - t : 1; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `600 22px ${R.SRV2_FONTS.sans}`; ctx.fillText(('Monthly Mix · ' + monthLabel).toUpperCase(), 72, 96); }
  if (a > 0) { ctx.globalAlpha = a; ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.font = `600 19px ${R.SRV2_FONTS.sans}`; ctx.fillText(String(cur.index + 1).padStart(2, '0') + ' / ' + String(tl.items.length).padStart(2, '0') + '  ·  NOW PLAYING', 72, H - 214); ctx.fillStyle = '#fff'; ctx.font = `600 42px ${R.SRV2_FONTS.display}`; ctx.fillText(cur.title.slice(0, 40), 72, H - 164); }
  ctx.restore();
}
function drawThumbBadge(ctx, monthLabel, tl) { ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `600 26px ${R.SRV2_FONTS.sans}`; ctx.textAlign = 'right'; ctx.fillText(monthLabel.toUpperCase() + ' · ' + Math.round(tl.totalSec / 60) + ' MIN', 1232, 668); ctx.restore(); }

// ── resumable storage upload (TUS, Supabase Storage) ──
export async function tusUpload({ supabaseUrl, supabaseKey, bucket = 'srv-assets', objectName, blob, contentType, onProgress, signal, chunkSize = 6 * 1024 * 1024, retries = 8, fetchImpl = fetch, backoffMs = 1000 }) {
  const ep = supabaseUrl + '/storage/v1/upload/resumable';
  const h = { authorization: 'Bearer ' + supabaseKey, apikey: supabaseKey, 'tus-resumable': '1.0.0' };
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const meta = { bucketName: bucket, objectName, contentType, cacheControl: '3600' };
  const c = await fetchImpl(ep, { method: 'POST', headers: { ...h, 'upload-length': String(blob.size), 'upload-metadata': Object.entries(meta).map(([k, v]) => k + ' ' + b64(v)).join(','), 'x-upsert': 'true' }, signal });
  if (c.status !== 201) throw new Error('storage upload could not start (HTTP ' + c.status + ')');
  let loc = c.headers.get('location'); if (!loc) throw new Error('storage upload: no upload address'); if (!/^https?:/.test(loc)) loc = new URL(loc, ep).href;
  let offset = 0, fails = 0, resumes = 0;
  while (offset < blob.size) {
    if (signal && signal.aborted) throw abortErr();
    try {
      const p = await fetchImpl(loc, { method: 'PATCH', headers: { ...h, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' }, body: blob.slice(offset, Math.min(blob.size, offset + chunkSize)), signal });
      if (p.status !== 204) throw new Error('HTTP ' + p.status);
      offset = Number(p.headers.get('upload-offset')); fails = 0; onProgress && onProgress(offset, blob.size);
    } catch (e) {
      if (signal && signal.aborted) throw abortErr();
      if (++fails > retries) throw new Error('storage upload stopped at ' + offset + ' of ' + blob.size + ' bytes: ' + e.message);
      await sleep(Math.min(30000, backoffMs * 2 ** (fails - 1)));
      const hd = await fetchImpl(loc, { method: 'HEAD', headers: h, signal }).catch(() => null);
      if (hd && hd.ok && hd.headers.get('upload-offset') != null) { offset = Number(hd.headers.get('upload-offset')); resumes++; }
    }
  }
  return { objectName, bytes: blob.size, resumes };
}
// ── server upload loop (one chunk per call; resumes from YouTube's offset after any failure) ──
const RETRYABLE = new Set(['chunk_failed_retry', 'storage_read_failed', 'storage_read_short', 'status_failed', 'mix_ledger_busy_try_again', 'mixes_busy_try_again', 'network']);
export async function serverUpload({ op, mixId, entryId, onProgress, signal, maxRetries = 8, backoffMs = 1500 }) {
  let id = entryId;
  if (!id) { const init = await op({ op: 'upload_init', mixId }); if (!init.ok) throw Object.assign(new Error(init.error || 'upload_init_failed'), { result: init }); id = init.entryId; onProgress && onProgress(0, init.total, id); }
  let fails = 0, retries = 0;
  for (;;) {
    if (signal && signal.aborted) throw Object.assign(abortErr(), { entryId: id });
    let r; try { r = await op({ op: 'upload_chunk', mixId, entryId: id }); } catch (e) { r = { ok: false, error: 'network', message: e.message }; }
    if (r.ok && r.done) return { ...r, entryId: id, retries };
    if (r.ok) { fails = 0; onProgress && onProgress(r.offset, r.total, id); continue; }
    if (RETRYABLE.has(r.error) && ++fails <= maxRetries) { retries++; await sleep(Math.min(30000, backoffMs * 2 ** (fails - 1))); continue; }
    throw Object.assign(new Error(r.error || 'upload_failed'), { result: r, entryId: id });
  }
}

// ── VA user interface ──
export function mount(root, deps) {
  const S = { step: 'select', month: deps.month || nextMixMonth(deps.now ? deps.now() : Date.now()), el: null, order: [], analysis: {}, avatarId: null, meta: null, metaEdited: {}, build: null, approved: false, upload: null, busy: null, msg: '', mixes: {}, config: {}, abort: null };
  root.__mixState = S;
  const lib = deps.avatars || []; S.avatarId = (lib.find((a) => a.id === 'srv2-fm-06') || lib[0] || {}).id;
  const songs = () => (S.el ? S.el.songs : []); const song = (id) => songs().find((x) => x.pkgId === id);
  const tracks = () => S.order.map(song).filter(Boolean);
  const tl = () => (S.order.length ? timelineFrom(tracks(), S.analysis) : null);
  const allAnalysed = () => S.order.length && S.order.every((id) => S.analysis[id]);
  const draftKey = () => 'srv2mix.draft.' + S.month;
  const saveLocal = () => { try { localStorage.setItem(draftKey(), JSON.stringify({ order: S.order, analysis: S.analysis, avatarId: S.avatarId, metaEdited: S.metaEdited })); } catch (_) {} };
  const loadLocal = () => { try { const d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); if (d) Object.assign(S, { order: d.order || [], analysis: d.analysis || {}, avatarId: d.avatarId || S.avatarId, metaEdited: d.metaEdited || {} }); } catch (_) {} };
  const monthLabel = () => new Date(S.month + '-15T12:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const record = () => {
    const t = tl(); if (!t) return null;
    const mixId = M.srv2MixKey(S.month, t);
    const title = S.metaEdited.title != null ? S.metaEdited.title : M.srv2MixTitle(S.month, t);
    const description = S.metaEdited.description != null ? S.metaEdited.description : M.srv2MixDescription(S.month, t);
    const tags = S.metaEdited.tags != null ? S.metaEdited.tags : M.srv2MixTags(t);
    return { mixId, monthKey: S.month, title, description, tags, crossfadeSec: t.crossfadeSec, totalSec: t.totalSec, version: SRV2_MIX_UI_VERSION,
      tracks: t.items.map((x, i) => { const s = song(x.pkgId), a = S.analysis[x.pkgId] || {}; return { order: i + 1, pkgId: x.pkgId, taskUid: s.taskUid, title: x.title, youtubeVideoId: s.youtubeVideoId, audioSource: s.audioSource, sourceUrl: s.sourceUrl, sourceDurationSec: a.edges ? a.edges.durationSec : s.durationSec, inSec: a.edges ? a.edges.inSec : null, outSec: a.edges ? a.edges.outSec : null, usedSec: x.durationSec, lufs: a.lufs ?? null, gainDb: a.gainDb ?? null, chapterSec: x.chapterSec, timestamp: x.timestamp, analysed: !!a.edges }; }),
      image: { avatarId: S.avatarId }, plannedRelease: M.srv2MixMonthlySlot(S.month), playlist: { id: S.config.playlistId || null, title: 'SRV Studio Mixes' },
      render: S.build ? S.build.stats : null, output: S.output || null, status: S.approved ? 'approved' : S.build ? 'built' : 'draft' };
  };
  async function loadMonth() {
    S.busy = 'Checking which SRV Studio songs are public on YouTube…'; draw();
    const [el, ls] = await Promise.all([deps.op({ op: 'eligibility' }), deps.op({ op: 'list' })]);
    S.busy = null; if (!el.ok) { S.msg = 'Could not load songs: ' + (el.error || 'error'); draw(); return; }
    S.el = el; S.mixes = (ls.ok && ls.mixes) || {}; S.config = (ls.ok && ls.config) || {};
    const saved = Object.values(S.mixes).filter((m) => m.monthKey === S.month).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (saved && ['uploading', 'uploaded', 'public'].includes(saved.status)) { S.saved = saved; S.step = 'done'; }
    else if (saved) { S.order = saved.tracks.map((t) => t.pkgId).filter((id) => song(id) && song(id).eligible); for (const t of saved.tracks) if (t.analysed) S.analysis[t.pkgId] = { edges: { inSec: t.inSec, outSec: t.outSec, usedSec: t.usedSec, durationSec: t.sourceDurationSec }, lufs: t.lufs, gainDb: t.gainDb, gain: Math.pow(10, (t.gainDb || 0) / 20) }; S.avatarId = (saved.image && saved.image.avatarId) || S.avatarId; { S.metaEdited = {}; const g = record(); if (g) { if (saved.title !== g.title) S.metaEdited.title = saved.title; if (saved.description !== g.description) S.metaEdited.description = saved.description; if (JSON.stringify(saved.tags) !== JSON.stringify(g.tags)) S.metaEdited.tags = saved.tags; } } S.msg = 'Draft restored (' + saved.updatedAt.slice(0, 16).replace('T', ' ') + ' UTC).'; }
    else loadLocal();
    draw();
  }
  async function analyseAll() {
    const ts = tracks().filter((t) => !S.analysis[t.pkgId]);
    for (let i = 0; i < ts.length; i++) { S.busy = `Analysing ${i + 1}/${ts.length}: ${ts[i].title} (${ts[i].audioSource === 'original-mp3' ? 'original MP3' : 'Long soundtrack'})…`; draw(); S.analysis[ts[i].pkgId] = await analyseSong(ts[i], { fetchImpl: deps.fetchImpl }); saveLocal(); }
    S.busy = null; draw();
  }
  async function saveDraft(status) {
    const rec = record(); if (!rec) return;
    const r = await deps.op({ op: 'save', mix: { ...rec, status: status || rec.status } });
    S.msg = r.ok ? (r.mix.ready ? 'Saved.' : 'Saved as a draft — ' + (r.mix.problems || []).join('; ')) : 'Not saved: ' + (r.problems || [r.error]).join('; ');
    if (r.ok) S.mixes[rec.mixId] = r.mix; saveLocal(); draw(); return r;
  }
  async function build() {
    if (!allAnalysed()) await analyseAll();
    const t = tl(); const chk = M.srv2MixRecordCheck(record()); if (!chk.ok) { S.msg = 'Fix before building: ' + chk.problems.join('; '); draw(); return; }
    const plan = M.srv2MixBitratePlan(t.totalSec); const avatar = lib.find((a) => a.id === S.avatarId);
    S.abort = new AbortController(); S.busy = 'Rendering…'; draw();
    try {
      const out = await renderMix({ tracks: tracks(), analysis: S.analysis, tl: t, avatar, monthLabel: monthLabel(), videoBitsPerSecond: plan.videoBitsPerSecond, canvas: root.querySelector('#mx-canvas'), signal: S.abort.signal, fetchImpl: deps.fetchImpl, onProgress: (m) => { S.busy = m; const b = root.querySelector('#mx-busy'); if (b) b.textContent = m; } });
      if (out.blob.size > (S.config.maxBytes || M.SRV2_MIX_CONFIG.maxFileBytes)) throw new Error('the video is ' + Math.round(out.blob.size / 1048576) + ' MB — over the 500 MB limit');
      S.build = out; S.approved = false; S.output = null; S.step = 'approve'; S.msg = 'Built. Watch it, then approve.';
      await saveDraft('built');
    } catch (e) { S.msg = e.name === 'AbortError' ? 'Build cancelled — nothing was saved.' : 'Build failed: ' + e.message + ' (press Build to try again)'; }
    S.busy = null; S.abort = null; draw();
  }
  async function approveAndUpload() {
    const rec = record(); S.abort = new AbortController();
    try {
      if (!S.output) {
        const obj = `mixes/${rec.mixId}/mix_${Date.now()}.${S.build.ext}`;
        await tusUpload({ supabaseUrl: deps.supabaseUrl, supabaseKey: deps.supabaseKey, objectName: obj, blob: S.build.blob, contentType: S.build.blob.type.split(';')[0], signal: S.abort.signal, fetchImpl: deps.fetchImpl, onProgress: (o, n) => { S.busy = `Saving the video to storage ${Math.round(o / n * 100)}% (${Math.round(o / 1048576)} / ${Math.round(n / 1048576)} MB)`; const b = root.querySelector('#mx-busy'); if (b) b.textContent = S.busy; } });
        S.output = { storagePath: obj, bytes: S.build.blob.size, mime: S.build.blob.type.split(';')[0] };
        if (S.build.thumbBlob) { const tp = `mixes/${rec.mixId}/thumbnail.jpg`; S.busy = 'Saving the thumbnail…'; draw(); await tusUpload({ supabaseUrl: deps.supabaseUrl, supabaseKey: deps.supabaseKey, objectName: tp, blob: S.build.thumbBlob, contentType: 'image/jpeg', signal: S.abort.signal, fetchImpl: deps.fetchImpl }); S.output.thumbnailPath = tp; }
      }
      S.approved = true; const sv = await saveDraft('approved'); if (!sv || !sv.ok) throw new Error('the approval could not be saved');
      S.busy = 'Uploading privately to YouTube…'; draw();
      const r = await serverUpload({ op: deps.op, mixId: rec.mixId, entryId: S.upload && S.upload.entryId, signal: S.abort.signal, onProgress: (o, n, id) => { S.upload = { entryId: id, offset: o, total: n }; S.busy = `Uploading privately to YouTube ${Math.round((o || 0) / n * 100)}%`; const b = root.querySelector('#mx-busy'); if (b) b.textContent = S.busy; } });
      S.result = r; let note = '';
      if (S.output && S.output.thumbnailPath) { S.busy = 'Setting the thumbnail…'; draw(); const th = await deps.op({ op: 'thumbnail', mixId: rec.mixId }).catch(() => null); if (!th || !th.ok) note = ' The thumbnail was not set — press "Retry thumbnail".'; }
      const ls = await deps.op({ op: 'list' }); if (ls.ok) { S.mixes = ls.mixes; S.saved = ls.mixes[rec.mixId]; }
      S.step = 'done'; S.msg = 'Uploaded PRIVATELY to SRV Studio.' + note;
    } catch (e) { S.msg = e.name === 'AbortError' ? 'Upload paused — press "Approve & upload privately" to resume.' : 'Upload stopped: ' + (e.result && e.result.error || e.message) + ' — press the button again to resume.'; if (e.entryId) S.upload = { ...(S.upload || {}), entryId: e.entryId }; }
    S.busy = null; S.abort = null; draw();
  }
  async function confirmPublic() { const id = S.saved && S.saved.mixId; const r = await deps.op({ op: 'confirm_public', mixId: id }); S.msg = r.ok ? (r.publicConfirmation.verifiedByApi ? 'Confirmed: YouTube reports PUBLIC.' : 'Recorded. YouTube still reports ' + r.publicConfirmation.youtubeReports + ' — make it public in YouTube Studio, then confirm again.') : 'Could not confirm: ' + r.error; const ls = await deps.op({ op: 'list' }); if (ls.ok) S.saved = ls.mixes[id]; draw(); }
  async function retryThumbnail() { const r = await deps.op({ op: 'thumbnail', mixId: S.saved.mixId }); S.msg = r.ok ? 'Thumbnail set.' : 'Thumbnail: ' + r.error; const ls = await deps.op({ op: 'list' }); if (ls.ok) S.saved = ls.mixes[S.saved.mixId]; draw(); }
  async function retryPlaylist() { const r = await deps.op({ op: 'playlist', mixId: S.saved.mixId }); S.msg = r.ok ? 'Playlist: ' + r.playlist.status : 'Playlist: ' + r.error; const ls = await deps.op({ op: 'list' }); if (ls.ok) S.saved = ls.mixes[S.saved.mixId]; draw(); }
  function suggest() { const el = songs().filter((s) => s.eligible).sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || ''))); S.order = []; let tot = 0; for (const s of el) { if (S.order.length >= 8 || tot >= 1800 - 60) break; S.order.push(s.pkgId); tot += (s.durationSec - 3.5) - (S.order.length > 1 ? 6 : 0); } changed(); }
  function changed() { S.build = null; S.approved = false; S.output = null; saveLocal(); draw(); }

  function draw() {
    const t = tl(); const rec = record(); const chk = rec ? M.srv2MixRecordCheck(rec) : null; const slot = M.srv2MixMonthlySlot(S.month);
    const slotLabel = new Date(slot.utcIso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const steps = ['Generate mix', 'Select songs', 'Arrange & preview', 'Visual', 'Metadata', 'Build', 'Approve', 'Private upload', 'Done'];
    const at = { select: 2, approve: 6, done: 8 }[S.step] ?? 2;
    root.innerHTML = `
    <div class="mx-head"><div><div class="mx-eyebrow">SRV STUDIO · MONTHLY MIX</div><div class="mx-title">${esc(monthLabel())}</div></div>
      <div class="mx-row"><label>Month <input id="mx-month" type="month" value="${esc(S.month)}" ${S.busy ? 'disabled' : ''}></label><button id="mx-close" class="mx-ghost">Close</button></div></div>
    <div class="mx-steps">${steps.map((s, i) => `<span class="${i <= at ? 'on' : ''}">${i + 1} · ${s}</span>`).join('')}</div>
    ${S.el ? `<div class="mx-ready ${S.el.ready ? 'ok' : 'warn'}">${S.el.ready ? '✓ Enough public SRV Studio songs for a ~30-minute mix' : '⏳ ' + esc(S.el.readiness) + ` — ${S.el.eligibleCount} public songs (≈ ${M.srv2Clock(S.el.possibleSec)} possible). Your draft is kept; you can prepare a later month.`} · Planned public release: <b>${esc(slotLabel)}</b> (last Saturday, 2:00 PM ET) — uploads stay PRIVATE</div>` : ''}
    <div id="mx-busy" class="mx-busy" ${S.busy ? '' : 'hidden'}>${esc(S.busy || '')}</div>
    ${S.busy && S.abort ? '<button id="mx-cancel" class="mx-ghost">Cancel</button>' : ''}
    <div class="mx-msg">${esc(S.msg)}</div>
    ${S.step === 'done' && S.saved ? doneHtml() : `
    <section><h3>Songs</h3><table class="mx-t"><tr><th></th><th></th><th>Song</th><th>Length</th><th>YouTube</th><th>Public</th><th>Audio</th><th>Package</th><th></th></tr>
      ${songs().map((s) => `<tr class="${s.eligible ? '' : 'dim'}"><td>${s.eligible ? `<input type="checkbox" data-pick="${esc(s.pkgId)}" ${S.order.includes(s.pkgId) ? 'checked' : ''}>` : ''}</td><td>${s.thumbUrl ? `<img src="${esc(s.thumbUrl)}" alt="" width="64" height="36">` : ''}</td><td>${esc(s.title)}</td><td>${s.durationSec ? M.srv2Clock(s.durationSec) : '—'}</td><td>${esc(s.youtubeVideoId || '—')}</td><td>${esc(s.privacyStatus || '—')}</td><td>${s.audioSource === 'original-mp3' ? 'original MP3' : 'Long soundtrack'}</td><td>${esc(s.pkgId)}</td><td>${s.eligible ? '<span class="ok">eligible</span>' : `<span class="warn">${esc(reasonText(s.reason))}</span>`}</td></tr>`).join('')}
    </table><div class="mx-row"><button id="mx-suggest">Suggest ~30 min</button><button id="mx-analyse" ${S.order.length ? '' : 'disabled'}>Analyse songs (exact timing &amp; loudness)</button><button id="mx-save" ${S.order.length ? '' : 'disabled'}>Save draft</button></div></section>
    ${t ? `<section><h3>Arrange &amp; preview — ${t.totalLabel} <span class="dim">(target 30:00 ± 4 · ${t.items.length} songs · ${t.crossfadeSec} s crossfades${allAnalysed() ? ' · exact' : ' · estimated until analysed'})</span></h3>
      ${chk && !chk.ok ? `<div class="warn">${chk.problems.map(esc).join('<br>')}</div>` : '<div class="ok">✓ Ready to build</div>'}
      <table class="mx-t"><tr><th>#</th><th>Chapter</th><th>Song</th><th>Used</th><th>Loudness</th><th>Order</th><th>Transition</th></tr>
      ${t.items.map((x, i) => { const a = S.analysis[x.pkgId]; return `<tr><td>${i + 1}</td><td>${x.timestamp}</td><td>${esc(x.title)}</td><td>${M.srv2Clock(x.durationSec)}</td><td>${a ? `${a.lufs} LUFS → ${a.gainDb >= 0 ? '+' : ''}${a.gainDb} dB` : '—'}</td>
        <td><button data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button data-down="${i}" ${i < t.items.length - 1 ? '' : 'disabled'}>↓</button><button data-rm="${i}">✕</button><select data-rep="${i}"><option value="">replace…</option>${songs().filter((s) => s.eligible && !S.order.includes(s.pkgId)).map((s) => `<option value="${esc(s.pkgId)}">${esc(s.title)}</option>`).join('')}</select></td>
        <td>${i && S.analysis[x.pkgId] && S.analysis[t.items[i - 1].pkgId] ? `<button data-join="${i}">▶ preview</button>` : ''}</td></tr>`; }).join('')}</table></section>
    <section><h3>Visual — approved library (${lib.length})</h3><div class="mx-lib">${lib.map((a) => `<button data-av="${a.id}" class="${a.id === S.avatarId ? 'on' : ''}" title="${esc(a.title)}"><img src="${esc(a.src)}" alt="SRV Studio image ${a.number}" loading="lazy"><b>${String(a.number).padStart(2, '0')}</b></button>`).join('')}</div></section>
    <section><h3>Metadata</h3>
      <label>Title (${rec.title.length}/100)<input id="mx-title" value="${esc(rec.title)}" maxlength="100"></label>
      <label>Description<textarea id="mx-desc" rows="12">${esc(rec.description)}</textarea></label>
      <label>Tags<input id="mx-tags" value="${esc(rec.tags.join(', '))}"></label>
      <div class="dim">Playlist: ${S.config.playlistId ? 'SRV Studio Mixes (' + esc(S.config.playlistId) + ')' : 'SRV Studio Mixes — not configured yet (added by hand after upload)'} · AI disclosure must stay in the description · <button id="mx-meta-reset" class="mx-ghost">Reset to generated</button></div>
    </section>
    <section><h3>Build</h3><canvas id="mx-canvas" class="mx-canvas"></canvas>
      <div class="mx-row"><button id="mx-build" ${chk && chk.ok && !S.busy ? '' : 'disabled'}>⚡ Build 1920×1080 mix (≈ ${Math.ceil(t.totalSec / 60) + 2} min — keep this tab in front)</button></div>
      ${S.build ? `<video id="mx-video" controls src="${URL.createObjectURL(S.build.blob)}"></video><div class="dim">${S.build.stats.width}×${S.build.stats.height} · ${Math.round(S.build.blob.size / 1048576)} MB · ${S.build.stats.measuredKbps} kbps · ${S.build.stats.frames.droppedPct}% dropped frames · limiter ${S.build.stats.limiter.minGainDb} dB${S.build.stats.hiddenDuringRender ? ' · ⚠ the tab was hidden during the build — rebuild for best quality' : ''}</div>
        <div class="mx-row"><button id="mx-approve" ${S.busy ? 'disabled' : ''}>✓ Approve &amp; upload privately</button></div>` : ''}
    </section>` : ''}`}`;
    bind();
  }
  function doneHtml() {
    const m = S.saved; const u = m.upload || {}; const pl = m.playlist || {}; const pc = m.publicConfirmation;
    const slotLabel = m.plannedRelease ? new Date(m.plannedRelease.utcIso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '—';
    return `<section><h3>Done — ${esc(m.title)}</h3><table class="mx-t">
      <tr><td>Status</td><td>${esc(m.status)}</td></tr><tr><td>YouTube</td><td>${esc(u.youtubeVideoId || '—')} (PRIVATE until the VA makes it public)</td></tr>
      <tr><td>Playlist</td><td>${pl.status === 'added' || pl.status === 'already' ? '✓ in SRV Studio Mixes (verified)' : pl.status === 'not_configured' ? 'SRV Studio Mixes not configured yet — add it in YouTube Studio' : esc(pl.error || pl.status || '—')} ${pl.status !== 'added' && pl.status !== 'already' && S.config.playlistId ? '<button id="mx-pl">Retry playlist</button>' : ''}</td></tr>
      <tr><td>Thumbnail</td><td>${m.thumbnail && m.thumbnail.status === 'set' ? '✓ custom 1280×720 thumbnail set' : (m.output && m.output.thumbnailPath ? 'not set yet <button id="mx-thumb">Retry thumbnail</button>' : 'none — set one in YouTube Studio')}</td></tr>
      <tr><td>Public release</td><td>At <b>${esc(slotLabel)}</b>: YouTube Studio → this video → Visibility → Public → Save. Do not use YouTube scheduling.</td></tr>
      <tr><td>Confirmation</td><td>${pc ? esc((pc.verifiedByApi ? '✓ ' : '') + 'YouTube reports ' + pc.youtubeReports + ' (' + String(pc.confirmedAt).slice(0, 16).replace('T', ' ') + ' UTC)') : 'not yet'} <button id="mx-public">I made it public</button></td></tr>
      <tr><td>Songs</td><td>${m.tracks.map((t) => esc(t.timestamp + ' ' + t.title)).join('<br>')}</td></tr></table>
      ${u.youtubeVideoId ? `<a href="https://studio.youtube.com/video/${esc(u.youtubeVideoId)}/edit" target="_blank" rel="noopener">Open in YouTube Studio</a>` : ''}</section>`;
  }
  function bind() {
    const q = (s) => root.querySelector(s), on = (s, f) => { const e = q(s); if (e) e.onclick = f; };
    on('#mx-close', () => { if (S.busy && !confirm('A build or upload is running. Close anyway?')) return; if (S.abort) S.abort.abort(); deps.close && deps.close(); });
    on('#mx-cancel', () => S.abort && S.abort.abort()); on('#mx-suggest', suggest); on('#mx-analyse', () => analyseAll().catch((e) => { S.busy = null; S.msg = 'Analysis failed: ' + e.message; draw(); }));
    on('#mx-save', () => saveDraft()); on('#mx-build', build); on('#mx-approve', approveAndUpload); on('#mx-public', confirmPublic); on('#mx-pl', retryPlaylist); on('#mx-thumb', retryThumbnail);
    on('#mx-meta-reset', () => { S.metaEdited = {}; changed(); });
    const mm = q('#mx-month'); if (mm) mm.onchange = () => { S.month = mm.value; Object.assign(S, { order: [], analysis: {}, build: null, approved: false, output: null, saved: null, step: 'select', msg: '' }); loadMonth(); };
    const ti = q('#mx-title'), de = q('#mx-desc'), tg = q('#mx-tags');
    if (ti) ti.onchange = () => { S.metaEdited.title = ti.value; changed(); };
    if (de) de.onchange = () => { S.metaEdited.description = de.value; changed(); };
    if (tg) tg.onchange = () => { S.metaEdited.tags = tg.value.split(',').map((x) => x.trim()).filter(Boolean); changed(); };
    root.querySelectorAll('[data-pick]').forEach((e) => { e.onchange = () => { const id = e.dataset.pick; if (e.checked) { if (!S.order.includes(id)) S.order.push(id); } else S.order = S.order.filter((x) => x !== id); changed(); }; });
    root.querySelectorAll('[data-up]').forEach((e) => { e.onclick = () => { const i = +e.dataset.up; [S.order[i - 1], S.order[i]] = [S.order[i], S.order[i - 1]]; changed(); }; });
    root.querySelectorAll('[data-down]').forEach((e) => { e.onclick = () => { const i = +e.dataset.down; [S.order[i + 1], S.order[i]] = [S.order[i], S.order[i + 1]]; changed(); }; });
    root.querySelectorAll('[data-rm]').forEach((e) => { e.onclick = () => { S.order.splice(+e.dataset.rm, 1); changed(); }; });
    root.querySelectorAll('[data-rep]').forEach((e) => { e.onchange = () => { if (e.value) { S.order[+e.dataset.rep] = e.value; changed(); } }; });
    root.querySelectorAll('[data-av]').forEach((e) => { e.onclick = () => { S.avatarId = e.dataset.av; changed(); }; });
    root.querySelectorAll('[data-join]').forEach((e) => { e.onclick = async () => { const i = +e.dataset.join; const t = tl(); S.busy = 'Preparing the transition…'; draw(); try { const p = await transitionPreview(song(t.items[i - 1].pkgId), song(t.items[i].pkgId), S.analysis, { fetchImpl: deps.fetchImpl }); S.lastJoin = { i, continuity: p.continuity }; const ac = new AudioContext({ sampleRate: SR }); const s = ac.createBufferSource(); s.buffer = p.buffer; s.connect(ac.destination); s.start(); s.onended = () => ac.close(); S.msg = `▶ ${t.items[i - 1].title} → ${t.items[i].title}: level through the join ${p.continuity.minDb}…${p.continuity.maxDb} dBFS (no gap)`; } catch (err) { S.msg = 'Transition preview failed: ' + err.message; } S.busy = null; draw(); }; });
  }
  loadMonth().catch((e) => { S.busy = null; S.msg = 'Could not load: ' + e.message; draw(); });
  return { state: S, actions: { loadMonth, analyseAll, saveDraft, build, approveAndUpload, confirmPublic, retryPlaylist, retryThumbnail, suggest, draw } };
}
const REASONS = { not_public: 'not public yet', not_uploaded: 'not uploaded', not_built: 'not built', no_audio_source: 'audio missing', unknown_duration: 'length unknown', other_channel: 'another channel', not_found_on_youtube: 'not found on YouTube' };
const reasonText = (r) => REASONS[r] || r;
// The month whose mix is due next: this month if its last-Saturday slot is still ahead, otherwise next month.
export function nextMixMonth(nowMs) {
  const d = new Date(nowMs); let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const key = (yy, mm) => yy + '-' + String(mm).padStart(2, '0');
  if (Date.parse(M.srv2MixMonthlySlot(key(y, m)).utcIso) <= nowMs) { m++; if (m > 12) { m = 1; y++; } }
  return key(y, m);
}
export const SRV2_MIX_CSS = `
.mx-overlay{position:fixed;inset:0;z-index:2147483000;background:#0b0b0e;color:#ececef;overflow:auto;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;padding:18px max(16px,env(safe-area-inset-left,0px)) 60px}
.mx-overlay section{background:#141418;border:1px solid #26262d;border-radius:12px;padding:14px;margin:12px 0}.mx-overlay h3{font:700 13px ui-monospace,Menlo,monospace;letter-spacing:.12em;color:#c9a84c;margin:0 0 10px;text-transform:uppercase}
.mx-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}.mx-eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.14em;color:#9a9aa4}.mx-title{font:700 24px Georgia,serif}
.mx-steps{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.mx-steps span{font:700 10px ui-monospace,monospace;padding:5px 8px;border-radius:6px;background:#1d1d23;color:#9a9aa4}.mx-steps span.on{background:#c9a84c;color:#111}
.mx-ready{padding:10px 12px;border-radius:10px;border:1px solid #26262d;background:#141418}.mx-ready.warn{border-color:rgba(245,158,11,.5)}.mx-ready.ok{border-color:rgba(34,197,94,.5)}
.mx-busy{margin:10px 0;padding:10px;border-radius:8px;background:rgba(139,92,246,.12);color:#c4b5fd;font:12px ui-monospace,monospace}.mx-msg{margin:6px 0;color:#c9a84c}
.mx-t{width:100%;border-collapse:collapse;font:12px ui-monospace,Menlo,monospace}.mx-t th,.mx-t td{text-align:left;padding:5px 7px;border-bottom:1px solid #26262d;vertical-align:middle}.mx-t img{border-radius:3px;display:block}
.mx-overlay button,.mx-overlay select{font:700 12px system-ui;padding:6px 10px;border-radius:8px;border:1px solid rgba(201,168,76,.45);background:rgba(201,168,76,.12);color:#c9a84c;cursor:pointer;margin:2px}.mx-overlay button:disabled{opacity:.4}.mx-ghost{background:transparent!important;border-color:#33333b!important;color:#9a9aa4!important}
.mx-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}.mx-overlay label{display:block;margin:8px 0;color:#9a9aa4;font-size:12px}.mx-overlay input,.mx-overlay textarea{width:100%;background:#0f0f13;border:1px solid #33333b;border-radius:8px;color:#ececef;padding:8px;font:13px ui-monospace,Menlo,monospace}
.mx-overlay input[type=checkbox]{width:auto}.mx-overlay input[type=month]{width:auto}.mx-lib{display:flex;flex-wrap:wrap;gap:8px}.mx-lib button{padding:0!important;width:120px;height:68px;overflow:hidden;position:relative;border:2px solid transparent!important;background:#000!important}.mx-lib button.on{border-color:#c9a84c!important}
.mx-lib img{width:100%;height:100%;object-fit:cover;filter:grayscale(1) contrast(1.08)}.mx-lib b{position:absolute;left:4px;bottom:2px;font-size:10px;color:#fff;text-shadow:0 1px 2px #000}
.mx-canvas{width:100%;max-width:640px;border-radius:8px;background:#000;display:block}.mx-overlay video{width:100%;max-width:960px;border-radius:8px;background:#000;margin-top:8px}.ok{color:#22c55e}.warn{color:#f59e0b}.dim{color:#9a9aa4}tr.dim td{color:#6b6b74}`;
