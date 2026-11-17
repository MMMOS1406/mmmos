// SRV Farsi Mix — lifecycle stages inside the existing SRV Farsi task card (CEO order 2026-11-12, preview only, behind a default-OFF flag).
// GENERATE (pick category + mood + songs) → REVIEW (tracklist/title/background) → BUILD (render the 1920×1080 video in this browser) → APPROVE → PUBLISH → DONE.
// The page (index.html) supplies a small `host` object; nothing here touches another business, the Long/Short flows, storage policies or any server route.
// PUBLISH (CEO correction 2026-11-12): integrated, resumable, PRIVATE-first upload to the retained SRV Farsi channel through the server relay (srv_farsi_mix); a temporary copy of the built file
// lives only in this browser's private storage until the upload finishes. The manual download/record path remains only as a clearly-labelled fallback when the server upload is not enabled.
import * as F from './lib/srvFarsiMix.mjs';
import { mountMixBuilder } from './ui.mjs';
import * as U from './upload.mjs';

const VID = /^[A-Za-z0-9_-]{11}$/;
const live = new Map();                                    // taskId -> { blobs, building, abort } (in-memory only; the rendered video is never uploaded anywhere by this module)
const st = (taskId) => { const k = String(taskId); if (!live.has(k)) live.set(k, { blobs: null, building: false, abort: null, msg: '', frac: 0 }); return live.get(k); };
const btn = (act, label, kind = 'gold', extra = '') => `<button type="button" data-mix-act="${act}" ${extra} style="padding:11px 14px;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;${kind === 'green' ? 'background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.45);color:#22c55e' : kind === 'ghost' ? 'background:transparent;border:1px solid rgba(255,255,255,.14);color:var(--dim)' : 'background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.45);color:#c9a84c'}">${label}</button>`;
const box = (inner, col = '201,168,76') => `<div style="padding:12px 14px;background:rgba(${col},.06);border:1px solid rgba(${col},.25);border-radius:10px;margin-bottom:10px;font-size:12px;line-height:1.6">${inner}</div>`;
const mono = "font-family:'JetBrains Mono',monospace";

// The description/chapters use the timeline of the file that was ACTUALLY built (after trimming), else the planned one.
export function timelineOf(mix) { return mix.build && mix.build.items ? { items: mix.build.items, totalSec: mix.build.durationSec } : F.srvfMixTimeline(mix.tracks); }
export function descriptionOf(mix) { return F.srvfMixDescription({ title: mix.title, category: mix.category, mood: mix.mood }, timelineOf(mix)); }
export function mixOf(pkg) { return pkg && pkg.farsiMix ? pkg.farsiMix : null; }
// COMPLETION (CEO correction 2026-11-17). A Mix is COMPLETE — and its task is marked Done — only when the upload is verified: the server acknowledged a finished upload with an 11-character video id, it is Private, and the independent YouTube
// read confirms the same video on the exact channel, still Private and not scheduled. YouTube's own later processing (transcoding / HD) is shown separately and never blocks completion; the thumbnail, the playlist and the description
// match are reported as warnings on the card. Anything short of that keeps the task open at Publish so it can be re-checked — nothing is reset prematurely.
const CORE_CHECKS = ['video_found', 'channel_is_exact_srv_farsi_channel', 'privacy_is_private', 'not_scheduled_for_public_release'];
export function completionGate(mix) {
  const up = (mix && mix.upload) || {}; const v = mix && mix.verification;
  if (up.status !== 'uploaded' || !VID.test(String(up.youtubeVideoId || ''))) return { ok: false, why: 'the server has not acknowledged a finished upload' };
  if (up.privacy !== 'private') return { ok: false, why: 'the upload is not recorded as Private' };
  if (!v || v.error) return { ok: false, why: 'the independent YouTube check has not run yet' };
  const by = Object.fromEntries((v.checks || []).map((c) => [c.name, c])); const bad = CORE_CHECKS.filter((n) => !by[n] || !by[n].ok);
  if (bad.length) return { ok: false, why: 'the check failed: ' + bad.map((n) => n.replace(/_/g, ' ')).join(', ') };
  if (v.videoId && v.videoId !== up.youtubeVideoId) return { ok: false, why: 'the checked video id differs from the uploaded one' };
  return { ok: true, why: '' };
}
const mix0 = mixOf;
// The four monthly releases: one Female, one Male, one Duet, one All Artists — shown on the Generate step so nobody has to remember which are done.
export function monthSlots(pkgs, monthKey) {
  const rows = F.SRVF_MIX_CATEGORIES.map((c) => ({ id: c.id, label: c.label, pkg: null }));
  for (const p of pkgs || []) { const m = mixOf(p); if (!m || p.engine !== 'SRV Farsi' || String(p.srvTaskUid || '').startsWith('set-aside:')) continue; if (String(m.key || '').indexOf('fmix_' + monthKey.replace('-', '')) !== 0) continue; const r = rows.find((x) => x.id === m.category); if (r && (!r.pkg || String(p.generatedAt) > String(r.pkg.generatedAt))) r.pkg = p; }
  return rows;
}
const slotsHtml = (host, monthKey) => `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${monthSlots(host.packages(), monthKey).map((r) => { const m = mixOf(r.pkg); return `<span style="font-size:10px;font-weight:700;padding:4px 9px;border-radius:999px;border:1px solid ${m ? 'rgba(34,197,94,.45)' : 'rgba(255,255,255,.16)'};color:${m ? '#22c55e' : 'var(--dim)'};${mono}">${host.esc(r.label.split(' (')[0])} ${m ? '· ' + F.srvfClock(m.runtimeSec) + (m.validation && m.validation.ok ? '' : ' (too short)') : '· not yet'}</span>`; }).join('')}</div>`;

const procColor = (st) => (st === 'succeeded' ? '#22c55e' : st === 'failed' || st === 'terminated' ? '#ef4444' : '#f59e0b');
const agoText = (iso) => { const t = Date.parse(iso); if (!t) return ''; const sec = Math.max(0, Math.round((Date.now() - t) / 1000)); return sec < 90 ? sec + ' s ago' : sec < 5400 ? Math.round(sec / 60) + ' min ago' : Math.round(sec / 3600) + ' h ago'; };
const localTime = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }); };
const verificationHtml = (host, mix, S) => {
  const v = mix.verification; const busy = !!(S && S.verifying), fixing = !!(S && S.fixing);
  const btnv = btn('verify', busy ? '↻ Checking YouTube now…' : '↻ Re-check on YouTube', 'ghost', busy || fixing ? 'disabled style="opacity:.5;cursor:wait"' : '');
  const err = (S && S.verifyErr) || mix.verifyError; const errHtml = err ? `<div style="font-size:11px;color:#ef4444;margin-top:6px">✗ The last attempt to check YouTube failed (${host.esc(localTime(err.at))}): ${host.esc(err.error)} — the result below is the last successful check, nothing was changed.</div>` : '';
  if (!v) return box(`<strong>Independent check on YouTube</strong>: not run yet.${errHtml}<div style="margin-top:6px">${btnv}</div>`, '245,158,11');
  const warnOf = (c) => c.warn || /markers/.test(c.name); const rows = (v.checks || []).map((c) => `<div style="font-size:10px;${mono};color:${c.ok ? '#22c55e' : warnOf(c) ? '#f59e0b' : '#ef4444'}">${c.ok ? '✓' : warnOf(c) ? '⚠' : '✗'} ${host.esc(c.name.replace(/_/g, ' '))} — <span style="color:var(--dim)">${host.esc(c.detail)}</span></div>`).join('');
  const pr = v.processing || null; const parts = pr && pr.partsTotal ? ` · ${pr.partsProcessed == null ? '?' : pr.partsProcessed}/${pr.partsTotal} parts` : ''; const left = pr && pr.timeLeftMs ? ` · about ${Math.max(1, Math.round(pr.timeLeftMs / 60000))} min left` : '';
  const procLine = pr ? `<div style="font-size:11px;margin-top:6px;${mono}">YouTube processing (reported separately — the Mix is already DONE and Private): <span style="color:${procColor(pr.state)}">${host.esc(pr.state)}</span>${pr.uploadStatus ? ' · upload status ' + host.esc(pr.uploadStatus) : ''} · file details ${host.esc(pr.fileDetails)}${host.esc(parts)}${host.esc(left)}${pr.failureReason ? ' · ' + host.esc(pr.failureReason) : ''}</div>` : (v.pending ? '<div style="font-size:11px;margin-top:6px;color:#f59e0b">YouTube processing: still processing</div>' : '');
  const integrity = v.integrityOk != null ? v.integrityOk : v.overall; const plBad = (v.checks || []).some((c) => !c.ok && /^(in_the_mixes_playlist|not_in_individual_song_playlists)$/.test(c.name));
  const head = v.error ? '✗ ' + host.esc(v.error) : v.overall && !v.pending ? '<span style="color:#22c55e">all checks passed</span>' : integrity && v.pending ? '<span style="color:#22c55e">upload, metadata and playlist checks passed</span> <span style="color:#f59e0b">— YouTube is still processing the file (checked again automatically every minute while this card is open)</span>' : integrity ? '<span style="color:#22c55e">upload and metadata checks passed</span>' : '<span style="color:#ef4444">some checks failed</span>';
  const fixBtn = plBad ? `<div style="margin-top:8px">${btn('fix-playlist', fixing ? 'Moving…' : 'Move to “Silk Road Voices Mixes” playlist', 'green', fixing || busy ? 'disabled style="opacity:.5;cursor:wait"' : '')}<span style="font-size:10px;color:var(--dim);margin-left:8px">adds it to the Mixes playlist, confirms, then removes it from the individual-song playlist(s); nothing else changes</span></div>` : '';
  return box(`<strong>Independent check on YouTube</strong> — checked <strong>${host.esc(localTime(v.at))}</strong> (${host.esc(agoText(v.at))}), read live from the YouTube API: ${head}${procLine}<div style="margin-top:6px">${rows}</div>${fixBtn}${errHtml}<div style="margin-top:6px">${btnv}</div>`, integrity && !v.error ? '34,197,94' : '245,158,11');
};
const headerHtml = (host, task, mix) => mix ? `<div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px;direction:auto">${host.esc(mix.title)}</div><div style="font-size:11px;color:var(--dim);margin-bottom:10px;${mono}">${host.esc((F.srvfCategory(mix.category) || {}).label || '')} · ${host.esc((F.srvfMood(mix.mood) || {}).label || '')} · ${mix.tracks.length} songs · ${F.srvfClock(mix.runtimeSec)} · background ${host.esc(mix.background)}</div>` : '';
const tracksHtml = (host, mix) => `<ol style="margin:0 0 10px;padding:0;list-style:none;font-size:11px">${mix.tracks.map((t, i) => { const it = (mix.timeline || F.srvfMixTimeline(mix.tracks).items)[i]; return `<li style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="${mono};color:#c9a84c;min-width:22px">${String(i + 1).padStart(2, '0')}</span><span style="flex:1;direction:auto">${host.esc(t.title)}</span><span style="${mono};color:var(--dim)">${it ? it.timestamp : ''}</span></li>`; }).join('')}</ol>`;

// ── stage HTML (synchronous: the page calls this while rendering the task card; interaction is wired in afterRender) ──
export function stageHtml(host, task, stage, pkg) {
  const mix = mixOf(pkg); const taskId = String(task.taskId || task.id); const S = st(taskId);
  if (stage === 'generate') {
    return `<div style="padding:14px;background:rgba(201,168,76,.05);border:1px solid rgba(201,168,76,.2);border-radius:10px">
      <div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:4px">🎼 SRV Farsi Mix — choose the Artist category and the Mix mood separately, then pick songs</div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px">Songs come only from published SRV Farsi Long songs (never regenerated; the originals are only read). The runtime is simply what your songs add up to (at least two valid songs); the video's tracklist shows each song's Finglish spelling.</div>
      <div id="srvfMixSrv" style="font-size:11px;color:var(--dim);margin-bottom:8px">Checking the server upload…</div>${slotsHtml(host, host.month())}<div data-mix-host="${host.esc(taskId)}" style="min-height:120px"><div style="font-size:11px;color:var(--dim)">Loading the published Long songs…</div></div></div>`;
  }
  if (!mix) return box('This Mix has no saved tracklist yet. Go back to Generate and save the tracklist.', '239,68,68') + `<div>${btn('back-generate', '← Back to Generate', 'ghost')}</div>`;
  const v = F.srvfMixValidate(F.srvfMixTimeline(mix.tracks), { category: mix.category, mood: mix.mood, songs: mix.tracks });
  const gate = v.ok ? '' : box('⛔ <strong>Blocked:</strong> ' + host.esc(v.problems.join('; ')) + '. It cannot move on until this is fixed.', '239,68,68');
  const warn = v.warnings.length ? box('⚠ ' + host.esc(v.warnings.join(' · ')), '245,158,11') : '';
  if (stage === 'review') return headerHtml(host, task, mix) + tracksHtml(host, mix) + gate + warn + `<div style="display:flex;gap:8px;flex-wrap:wrap">${btn('approve-tracklist', 'Approve tracklist → Build', 'green', v.ok ? '' : 'disabled style="opacity:.4;cursor:not-allowed"')}${btn('edit', '✎ Edit songs / title / background', 'gold')}</div>`;
  if (stage === 'build') {
    const b = S.blobs; const built = mix.build && mix.build.at;
    return headerHtml(host, task, mix) + gate + box(`Builds the 1920×1080 video in <strong>this browser tab</strong> in real time (about ${F.srvfClock(mix.runtimeSec)}). Keep the tab open and the computer awake. Nothing is uploaded at this step; the song audio is only read. A temporary copy of the finished file is kept in this browser's private storage (so a reload does not lose it) and is deleted when the upload finishes.`)
      + (S.building ? box(`<div id="srvfMixProg" style="${mono}">${host.esc(S.msg || 'Starting…')}</div><div style="height:8px;background:rgba(255,255,255,.1);border-radius:4px;margin-top:8px"><div id="srvfMixBar" style="height:8px;border-radius:4px;background:#c9a84c;width:${Math.round(S.frac * 100)}%"></div></div>`) : '')
      + (b ? box(`✓ Built in this session — ${(b.blob.size / 1048576).toFixed(0)} MB · ${host.esc(b.stats.mime || '')}`, '34,197,94') : built ? box('A build was made earlier (' + host.esc(mix.build.at) + '); the file is not kept on a server, so build again to approve.', '245,158,11') : '')
      + `<div style="display:flex;gap:8px;flex-wrap:wrap">${S.building ? btn('cancel-build', 'Cancel build', 'ghost') : btn('build', b ? '↻ Build again' : '🎬 Build Mix video', 'gold', v.ok ? '' : 'disabled style="opacity:.4;cursor:not-allowed"')}${b && !S.building ? btn('to-approve', 'Send to Approve →', 'green') : ''}${b && !S.building ? btn('discard-temp', '🗑 Discard temporary file', 'ghost') : ''}${btn('back-review', '← Review', 'ghost')}</div>`;
  }
  if (stage === 'approve' || stage === 'publish') {
    const b = S.blobs; const tl = timelineOf(mix); const desc = descriptionOf(mix); const tags = F.srvfMixTags({ category: mix.category, mood: mix.mood }, tl);
    const media = b ? `<video controls preload="metadata" src="${b.url}" style="width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.1);margin-bottom:8px"></video><img src="${b.thumbUrl}" alt="Thumbnail" style="width:100%;max-width:420px;border-radius:8px;border:1px solid rgba(255,255,255,.1);margin-bottom:8px">` : box('The built file is no longer in this browser session — go back to Build and build again.', '245,158,11');
    const meta = `<details style="margin-bottom:10px"><summary style="cursor:pointer;font-size:11px;color:#c9a84c;${mono}">YouTube title, description (with chapters), tags</summary><div style="font-size:11px;margin-top:6px;direction:auto">${host.esc(mix.title)}</div><pre style="white-space:pre-wrap;font-size:10px;max-height:240px;overflow:auto;background:rgba(0,0,0,.25);padding:8px;border-radius:6px">${host.esc(desc)}</pre><div style="font-size:10px;color:var(--dim)">${host.esc(tags.join(', '))}</div></details>`;
    if (stage === 'approve') return headerHtml(host, task, mix) + media + meta + gate + box('🤖 <strong>AI Use / Altered content: YES</strong> — set automatically at upload. The video is uploaded as <strong>Private</strong> first; making it public stays your separate decision.', '245,158,11')
      + `<div style="display:flex;gap:8px;flex-wrap:wrap">${btn('approve', 'Approve → Publish', 'green', v.ok && b ? '' : 'disabled style="opacity:.4;cursor:not-allowed"')}${btn('back-build', '← Rebuild', 'ghost')}</div>`;
    const up = mix.upload || {}; const U2 = S.up || {}; const pct = U2.total ? Math.round((U2.offset / U2.total) * 100) : 0;
    if (up.status === 'uploaded' && !mix.completion) {
      const g = completionGate(mix); const idu = up.youtubeVideoId;
      return headerHtml(host, task, mix) + box(`<strong>Uploaded to YouTube as Private</strong> (video <span style="${mono}">${host.esc(idu || '')}</span>). The upload is safe and will not be repeated. The task is marked <strong>Done</strong> as soon as the independent check confirms the video (this channel, Private, not scheduled).${S.completing ? ' <span style="color:#f59e0b">Checking YouTube now…</span>' : g.ok ? '' : `<div style="margin-top:6px;color:#f59e0b">Not confirmed yet: ${host.esc(g.why)}. Nothing is lost.</div>`}${U2.error ? `<div style="margin-top:6px;color:#f59e0b">${host.esc(U2.error)}</div>` : ''}`, '245,158,11')
        + verificationHtml(host, mix, S) + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${btn('complete', S.completing ? 'Checking…' : '✓ Check and complete', 'green', S.completing ? 'disabled style="opacity:.5;cursor:wait"' : '')}</div>` + tracksHtml(host, mix);
    }
    const checks = [[v.ok, 'Rules (songs, Finglish, title)'], [!!b, 'Built file present (this browser)'], [!!(b && b.thumbBlob), 'Thumbnail ready']].map(([k, t]) => `<span style="${mono};font-size:10px;margin-right:10px;color:${k ? '#22c55e' : '#ef4444'}">${k ? '✓' : '✗'} ${t}</span>`).join('');
    const prog = U2.running ? box(`<div id="srvfUpMsg" style="${mono}">${host.esc(U2.msg || 'Starting upload…')}</div><div style="height:8px;background:rgba(255,255,255,.1);border-radius:4px;margin-top:8px"><div id="srvfUpBar" style="height:8px;border-radius:4px;background:#22c55e;width:${pct}%"></div></div>`) : '';
    const interrupted = !U2.running && (U2.error || up.status === 'interrupted') ? box('⚠ ' + host.esc(U2.error || ('Upload interrupted at ' + (up.offset && up.bytes ? Math.round(up.offset / up.bytes * 100) : 0) + '% — nothing was lost. Resume continues from where YouTube stopped.')), '245,158,11') : '';
    return headerHtml(host, task, mix) + box('<strong>Publish — private first.</strong> The video is uploaded <strong>directly from MMMOS</strong> to the SRV Farsi channel as <strong>Private</strong> (AI-content = Yes, chapters and description included), then the thumbnail is set and the video is added to the <strong>Silk Road Voices Mixes</strong> playlist. Making it public stays your separate decision in YouTube Studio.')
      + `<div style="margin-bottom:8px">${checks}</div><div id="srvfMixSrv" style="font-size:11px;color:var(--dim);margin-bottom:8px">Checking the server upload…</div>` + media + prog + interrupted
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${U2.running ? btn('pause-upload', '⏸ Pause', 'ghost') : btn('upload', up.status === 'interrupted' || U2.error ? '▶ Resume upload' : '⬆ Upload to YouTube (private)', 'green', v.ok && b ? '' : 'disabled style="opacity:.4;cursor:not-allowed"')}${!U2.running && (up.status === 'interrupted' || U2.error) ? btn('restart-upload', '↺ Start over', 'ghost') : ''}${b && !U2.running ? btn('discard-temp', '🗑 Discard temporary file', 'ghost') : ''}${btn('back-build', '← Rebuild', 'ghost')}</div>`
      + `<details style="margin-bottom:6px"><summary style="cursor:pointer;font-size:10px;color:var(--dim);${mono}">Fallback — only if the server upload is not enabled (manual upload in YouTube Studio)</summary><div style="margin-top:6px"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${b ? btn('dl-video', '⬇ Video', 'ghost') + btn('dl-thumb', '⬇ Thumbnail', 'ghost') : ''}${btn('copy-title', 'Copy title', 'ghost')}${btn('copy-desc', 'Copy description', 'ghost')}${btn('copy-tags', 'Copy tags', 'ghost')}</div>`
      + `<div style="display:flex;gap:8px"><input id="srvfMixYt" placeholder="YouTube video link or 11-character id" style="flex:1;padding:9px;background:rgba(0,0,0,.3);border:1px solid rgba(201,168,76,.35);border-radius:8px;color:var(--text);font-size:12px;box-sizing:border-box">${btn('record-published', 'Record as uploaded → Done', 'ghost', v.ok ? '' : 'disabled')}</div><div id="srvfMixMsg" style="font-size:11px;color:#ef4444"></div></div></details>`;
  }
  if (stage === 'done') {
    const id = pkg.youtubeVideoId || pkg.youtube_video_id;
    const pl = (mix.playlists || []).map((x) => (x.ok ? '✓ ' : '✗ ') + host.esc(x.playlistName || x.key || '') + (x.ok ? '' : ' (' + host.esc(x.error || 'failed') + ')')).join(' · ') || 'not added';
    const th = mix.thumbnail ? (mix.thumbnail.status === 'set' ? '✓ set' : '✗ ' + host.esc(mix.thumbnail.error || 'failed')) : 'manual / not set';
    const nx = host.nextTask ? host.nextTask(task) : null; const cp = mix.completion;
    const nextBox = cp ? box(`✓ <strong>Completed</strong> ${host.esc(localTime(cp.at))} — the upload was verified (video ${host.esc(cp.youtubeVideoId || id || '')}, Private). YouTube's own processing is reported separately below and does not hold this task open. This record stays in your history.${nx ? `<div style="margin-top:6px">Next scheduled task: <strong>${host.esc(nx.name)}</strong>${nx.isoDate ? ' · ' + host.esc(nx.isoDate) : ''}</div>` : '<div style="margin-top:6px">No other SRV Farsi task is waiting.</div>'}${S.resetTimer ? '<div style="margin-top:4px;color:var(--dim)">Opening it automatically in a few seconds.</div>' : ''}<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${btn('open-next', nx ? 'Open the next task now →' : '← Back to Tasks', 'green')}${S.resetTimer ? btn('stay', 'Stay on this record', 'ghost') : ''}</div>`, '34,197,94') : '';
    return headerHtml(host, task, mix) + nextBox + box('✓ <strong>Uploaded — Private.</strong> ' + (id ? `<a href="https://studio.youtube.com/video/${host.esc(id)}/edit" target="_blank" style="color:#ef4444">Open in YouTube Studio</a>` : '') + `<div style="font-size:11px;margin-top:4px;color:var(--dim)">Thumbnail: ${th} · Playlist: ${pl}</div><div style="font-size:11px;color:var(--dim)">It stays Private until you publish it in YouTube Studio. Analytics appear after the next channel sync.</div>`, '34,197,94') + verificationHtml(host, mix, S) + tracksHtml(host, mix);
  }
  return '';
}

// ── interaction (called by the page right after the card is in the DOM) ──
export async function afterRender(host, task, stage, root) {
  const taskId = String(task.taskId || task.id); const el = (root || document).querySelector(`[data-mix-host="${taskId}"]`); let pkg = host.pkgFor(task);
  if (!pkg && host.ensurePkg) { const look = await host.ensurePkg(task); if (look && look.pkg) { host.rerender(taskId); return; } }   // saved Mix missing from this browser's list: restore it from the database, then draw the card again
  const scope = (root || document);
  const srvLine = (r, e) => { const ok = r.body && r.body.ok, pr = r.body && r.body.probe; e.style.color = ok && (!pr || (pr.ok && pr.channelOwned)) ? '#22c55e' : '#f59e0b'; const vtag = ok && r.body.credentialSource === 'validation' ? ' [TEMPORARY VALIDATION credential until ' + String(r.body.validationUntil || '').replace('T', ' ').slice(0, 16) + ' UTC]' : ''; e.textContent = (!ok ? 'Server upload is not enabled yet (' + ((r.body && r.body.error) || 'unavailable') + ') — use the fallback below.' : !r.body.channelConnected ? '⚠ Server upload enabled but the SRV Farsi channel is not connected' : pr ? (pr.ok ? (pr.channelOwned ? '✓ Server upload ready — YouTube credential valid and the connection owns the SRV Farsi channel' : '⚠ YouTube credential valid but the connection does NOT own the pinned SRV Farsi channel') : '✗ YouTube credential check failed: ' + pr.credential + (pr.credential === 'invalid_client' ? ' (the server\'s OAuth client secret is wrong or missing)' : pr.credential === 'invalid_grant' ? ' (re-authorize the channel in Integrations)' : '')) : '✓ Server upload ready — SRV Farsi channel (Silk Road Voices) connected') + vtag; };
  if (stage === 'publish' || stage === 'generate') host.api('status', { mixKey: mix0(pkg) && mix0(pkg).key, probe: true }).then((r) => { const e = scope.querySelector('#srvfMixSrv'); if (!e) return; srvLine(r, e); }).catch(() => {});
  if (stage === 'generate' && el) {
    if (el.dataset.mounted) return; el.dataset.mounted = '1';                                // a stale timer must not mount a second builder
    el.innerHTML = box('<div id="srvfCatLoad">Loading the complete catalog of published Long songs from MMMOS and checking each with YouTube (channel, visibility, length)…</div>', '245,158,11');
    const tick = (n, rows) => { const d = el.querySelector('#srvfCatLoad'); if (d) d.textContent = 'Loading the complete catalog of published Long songs… page ' + n + ' (' + rows + ' packages so far)'; };
    let cands; try { cands = await host.candidates(tick); } catch (e) { el.innerHTML = box('Could not read the published Long songs: ' + host.esc(e.message) + '<div style="margin-top:8px"><button type="button" id="srvfCatRetry" style="padding:8px 12px;border-radius:8px;font-weight:700;cursor:pointer">Try again</button></div>', '239,68,68'); const rb = el.querySelector('#srvfCatRetry'); if (rb) rb.onclick = () => { el.dataset.mounted = ''; host.rerender(taskId); }; return; }
    if (!el.isConnected) return;
    el.innerHTML = ''; const lib = host.libraryCovers();
    const S = st(taskId); S.builder = mountMixBuilder(el, { candidates: cands, reload: () => { if (host.reloadCatalog) host.reloadCatalog(); el.dataset.mounted = ''; host.rerender(taskId); }, attachSource: (q) => host.attachSource(q), removeSource: (id) => host.removeSource(id), cover: (c) => host.cover(c), libraryCovers: lib, month: host.month(), saved: mixOf(pkg) || null, draft: S.draft || null, onChange: (d) => { S.draft = d; },
      onSave: (rec) => host.saveMix(task, rec).then(() => { S.draft = null; }).catch((e) => alert('Could not save the Mix: ' + e.message)),
      onProceed: async (rec) => { try { await host.saveMix(task, rec); host.setStage(taskId, 'review'); host.rerender(taskId); } catch (e) { alert('Could not save the Mix: ' + e.message); } } });
    return;
  }
  if (['build', 'approve', 'publish'].includes(stage) && mix0(pkg) && !st(taskId).blobs && !st(taskId).restoreTried) {                // a page reload must not lose a long build
    const S0 = st(taskId); S0.restoreTried = true; const f = await U.opfsLoad(mix0(pkg).key);
    if (f) { S0.blobs = { blob: f.blob, url: URL.createObjectURL(f.blob), thumbBlob: f.thumbBlob, thumbUrl: f.thumbBlob ? URL.createObjectURL(f.thumbBlob) : '', mime: (f.meta && f.meta.mime) || f.blob.type || 'video/webm', stats: (f.meta && f.meta.stats) || { mime: f.blob.type } }; return host.rerender(taskId); }
  }
  if (stage === 'publish' && mix0(pkg) && mix0(pkg).upload && mix0(pkg).upload.status === 'uploaded' && !mix0(pkg).completion && !st(taskId).completing && !st(taskId).autoCompleted) { st(taskId).autoCompleted = true; setTimeout(() => { const p2 = host.pkgFor(task); if (p2) completeMix(host, task, p2, mix0(p2), st(taskId), false); }, 0); }
  if (stage === 'done' && mix0(pkg) && mix0(pkg).upload && mix0(pkg).upload.entryId) {                                       // YouTube still processing? look again now, then every minute while this card is open
    const S1 = st(taskId), m1 = mix0(pkg), v1 = m1.verification;
    if (!S1.autoChecked && (!v1 || v1.pending)) { S1.autoChecked = true; setTimeout(() => { const p2 = host.pkgFor(task); if (p2) verifyUpload(host, task, p2, mix0(p2), false); }, 0); }
    if (!S1.pollTimer && (!v1 || v1.pending)) { S1.pollCount = 0; S1.pollTimer = setInterval(() => { const live = document.getElementById('srvfMixRoot-' + taskId); const p2 = host.pkgFor(task); const mm = p2 && mix0(p2);
      if (!live || !mm || (mm.verification && !mm.verification.pending) || ++S1.pollCount > 20) { clearInterval(S1.pollTimer); S1.pollTimer = null; return; } verifyUpload(host, task, p2, mm, false); }, 60000); }
  }
  if (scope.dataset && scope.dataset.wired) return; if (scope.dataset) scope.dataset.wired = '1';   // one set of listeners per rendered card
  scope.querySelectorAll('[data-mix-act]').forEach((b) => b.addEventListener('click', () => act(host, task, b.getAttribute('data-mix-act'), scope)));
}
async function act(host, task, a, scope) {
  const taskId = String(task.taskId || task.id); const pkg = host.pkgFor(task); const mix = mixOf(pkg); const S = st(taskId);
  const go = (stage) => { host.setStage(taskId, stage); host.rerender(taskId); };
  const val = () => F.srvfMixValidate(F.srvfMixTimeline(mix.tracks), { category: mix.category, mood: mix.mood, songs: mix.tracks });
  if (a === 'back-generate' || a === 'edit') return go('generate');
  if (a === 'back-review') return go('review');
  if (a === 'back-build') return go('build');
  if (a === 'approve-tracklist') { if (!mix || !val().ok) return; return go('build'); }                       // the 30-minute rule again, at the gate
  if (a === 'to-approve') { if (!S.blobs) return; return go('approve'); }
  if (a === 'approve') {
    if (!mix || !val().ok || !S.blobs) return; const at = new Date().toISOString();
    // The approval record freezes EXACTLY what will be published (title, description with chapters, tags) and is what the server checks before any upload.
    mix.approved = { at, by: host.who(), title: mix.title, description: descriptionOf(mix), tags: F.srvfMixTags({ category: mix.category, mood: mix.mood }, timelineOf(mix)) }; mix.approvedAt = at;
    try { await host.savePkg(pkg); } catch (e) { delete mix.approved; delete mix.approvedAt; alert('The approval could not be saved: ' + e.message); return; }
    return go('publish');
  }
  if (a === 'complete') return completeMix(host, task, pkg, mix, S, false);
  if (a === 'stay') { if (S.resetTimer) { clearTimeout(S.resetTimer); S.resetTimer = null; } return host.rerender(taskId); }
  if (a === 'open-next') { if (S.resetTimer) { clearTimeout(S.resetTimer); S.resetTimer = null; } return host.resetToNext ? host.resetToNext(task) : host.rerender(taskId); }
  if (a === 'verify') return verifyUpload(host, task, pkg, mix);
  if (a === 'fix-playlist') return fixPlaylist(host, task, pkg, mix);
  if (a === 'discard-temp') { if (!confirm('Delete the temporary copy of the built video from this browser? You would have to build it again.')) return; await U.opfsDelete(mix.key); if (S.blobs) { try { URL.revokeObjectURL(S.blobs.url); if (S.blobs.thumbUrl) URL.revokeObjectURL(S.blobs.thumbUrl); } catch (_) {} S.blobs = null; S.restoreTried = true; } return host.rerender(taskId); }
  if (a === 'cancel-build') { if (S.abort) S.abort.abort(); return; }
  if (a === 'dl-video' && S.blobs) return download(S.blobs.url, 'srv-farsi-mix-' + mix.key + (S.blobs.mime.includes('mp4') ? '.mp4' : '.webm'));
  if (a === 'dl-thumb' && S.blobs) return download(S.blobs.thumbUrl, 'srv-farsi-mix-' + mix.key + '-thumbnail.jpg');
  const tl = mix ? timelineOf(mix) : null;
  if (a === 'copy-title') return host.copy(mix.title);
  if (a === 'copy-desc') return host.copy(descriptionOf(mix));
  if (a === 'copy-tags') return host.copy(F.srvfMixTags({ category: mix.category, mood: mix.mood }, tl).join(', '));
  if (a === 'record-published') {
    const raw = String((scope.querySelector('#srvfMixYt') || {}).value || '').trim(); const m = raw.match(/(?:v=|youtu\.be\/|\/video\/|\/shorts\/|^)([A-Za-z0-9_-]{11})(?:[&?\/]|$)/); const id = m && m[1]; const msg = scope.querySelector('#srvfMixMsg');
    if (!id || !VID.test(id)) { if (msg) msg.textContent = 'Paste the YouTube link or the 11-character video id.'; return; }
    if (!val().ok) { if (msg) msg.textContent = 'This Mix does not meet the rules yet (see the list above).'; return; }
    const dupe = host.packages().find((p) => p !== pkg && (p.youtubeVideoId || p.youtube_video_id) === id); if (dupe) { if (msg) msg.textContent = 'That video id is already recorded on another package.'; return; }
    pkg.youtubeVideoId = id; pkg.youtube_video_id = id; pkg.youtubeWatchUrl = 'https://www.youtube.com/watch?v=' + id; pkg.published_at = new Date().toISOString(); pkg.performance_status = 'published'; pkg.youtubePublishState = 'uploaded-private'; mix.publishedAt = pkg.published_at;
    await host.savePkg(pkg); return go('done');
  }
  if (a === 'build') return build(host, task, pkg, mix, S);
  if (a === 'upload') return upload(host, task, pkg, mix, S);
  if (a === 'pause-upload') { if (S.upAbort) S.upAbort.abort(); return; }
  if (a === 'restart-upload') { try { if (mix.upload && mix.upload.entryId) await host.api('abort', { entryId: mix.upload.entryId, mixKey: mix.key }); } catch (_) {} mix.upload = null; S.up = null; await host.savePkg(pkg); return upload(host, task, pkg, mix, S); }
}
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

async function build(host, task, pkg, mix, S) {
  const taskId = String(task.taskId || task.id); if (S.building) return; if (mix.upload && mix.upload.status === 'uploaded') return; delete mix.approved; delete mix.approvedAt; S.building = true; S.abort = new AbortController(); S.msg = 'Loading the render engine…'; S.frac = 0; host.rerender(taskId);
  const upd = (m, f) => { S.msg = m; S.frac = f || 0; const p = document.getElementById('srvfMixProg'), bar = document.getElementById('srvfMixBar'); if (p) p.textContent = m; if (bar) bar.style.width = Math.round((f || 0) * 100) + '%'; };
  try {
    const cap = await U.capacity(mix.runtimeSec); if (cap.known && !cap.ok) throw new Error(`This browser has about ${(cap.free / 1073741824).toFixed(1)} GB of free storage but this Mix needs about ${(cap.need / 1073741824).toFixed(1)} GB while it is built. Free some disk space or shorten the Mix.`);
    const R = await import('./render.mjs'); const cands = await host.candidates(); const by = new Map(cands.map((c) => [c.pkgId, c]));
    const unusable = mix.tracks.map((t) => { const c = by.get(t.pkgId); return !c ? t.finglish + ': no longer in the published Long list' : !c.eligible ? t.finglish + ': ' + (F.SRVF_REASON_TEXT[c.reason] || c.reason) : null; }).filter(Boolean);
    if (unusable.length) throw new Error('Not built (nothing was rendered): ' + unusable.join('; ') + '. Open Generate to fix the tracklist.');
    const tracks = mix.tracks.map((t) => ({ ...by.get(t.pkgId), finglish: t.finglish, finglishAuto: t.finglishAuto, finglishConfirmed: t.finglishConfirmed }));
    const analysis = {}; for (let i = 0; i < tracks.length; i++) { upd(`Analysing song ${i + 1} of ${tracks.length}…`, i / tracks.length); analysis[tracks[i].pkgId] = await R.analyseSong(tracks[i], { signal: S.abort.signal }); }
    const tl = R.timelineFrom(tracks, analysis); const covers = {}; tracks.forEach((t) => { covers[t.pkgId] = host.cover(t); });
    const bg = String(mix.background || ''); const bgCover = bg.startsWith('cover:') ? host.libraryCovers().find((c) => c.id === bg.slice(6)) : null;
    const canvas = document.createElement('canvas'); const mt = mix.title.split('|');
    const out = await R.renderFarsiMix({ tracks, analysis, tl, mix: { ...mix, titleLatin: mt[0].trim(), titleFa: (mt[1] || '').trim(), background: bgCover ? 'ice' : bg }, covers, bgCoverSrc: bgCover ? bgCover.src : null, canvas, onProgress: upd, signal: S.abort.signal });
    if (S.blobs) { URL.revokeObjectURL(S.blobs.url); URL.revokeObjectURL(S.blobs.thumbUrl); }
    S.blobs = { blob: out.blob, url: URL.createObjectURL(out.blob), thumbBlob: out.thumbBlob, thumbUrl: URL.createObjectURL(out.thumbBlob), mime: out.mime, stats: { ...out.stats, mime: out.mime } }; upd('Keeping a temporary copy in this browser so a reload does not lose the build…', 1); const kept = await U.opfsSave(mix.key, { blob: out.blob, thumbBlob: out.thumbBlob, meta: { mime: out.mime, stats: S.blobs.stats } });
    mix.build = { at: new Date().toISOString(), stats: out.stats, items: tl.items.map((x) => ({ pkgId: x.pkgId, title: x.title, finglish: x.finglish, youtubeVideoId: x.youtubeVideoId || null, timestamp: x.timestamp, chapterSec: x.chapterSec })), durationSec: tl.totalSec, bytes: out.blob.size, mime: out.mime, temp: kept ? 'browser-private-storage' : 'memory-only', analysis: Object.fromEntries(Object.entries(analysis).map(([k, v]) => [k, { lufs: v.lufs, gainDb: v.gainDb, edges: v.edges, audioSource: v.audioSource }])) }; mix.chaptersFromBuild = tl.items.map((x) => ({ at: x.timestamp, title: x.title }));
    await host.savePkg(pkg);
  } catch (e) { S.error = e; if (e && e.name !== 'AbortError') alert('The Mix could not be built: ' + e.message); }
  finally { S.building = false; S.abort = null; host.rerender(taskId); }
}
// Test hook only (read/inject in-memory session state; has no effect on production behaviour).
export const _test = { st };

async function upload(host, task, pkg, mix, S) {
  const taskId = String(task.taskId || task.id); if (S.up && S.up.running) return;
  if (mix.upload && mix.upload.status === 'uploaded') return completeMix(host, task, pkg, mix, S, false);   // already on YouTube: never a second upload (refresh / retry / double click) — only the completion check
  if (!S.blobs) { S.up = { error: 'The built file is not in this browser any more — go back to Build.' }; return host.rerender(taskId); }
  S.up = { running: true, msg: 'Starting…', offset: 0, total: S.blobs.blob.size }; S.upAbort = new AbortController(); host.rerender(taskId);
  const tl = timelineOf(mix); const payload = { key: mix.key, category: mix.category, mood: mix.mood, title: mix.title, description: descriptionOf(mix), tags: F.srvfMixTags({ category: mix.category, mood: mix.mood }, tl),
    tracks: mix.tracks.map((t) => ({ pkgId: t.pkgId, title: t.title, youtubeVideoId: t.youtubeVideoId, finglish: t.finglish, finglishAuto: !!t.finglishAuto, finglishConfirmed: !!t.finglishConfirmed })) };
  let lastSave = 0; const t0 = Date.now();
  const show = (m, frac) => { S.up.msg = m; if (frac != null) S.up.offset = frac; const e = document.getElementById('srvfUpMsg'), b = document.getElementById('srvfUpBar'); if (e) e.textContent = m; if (b) b.style.width = Math.round((S.up.offset / S.up.total) * 100) + '%'; };
  try {
    const res = await U.uploadFile({ api: host.api, file: S.blobs.blob, mime: S.blobs.mime, mix: payload, initExtra: { packageId: pkg.id }, signal: S.upAbort.signal,
      onProgress: (p) => { S.up.offset = p.offset; S.up.total = p.total; const mb = (p.offset / 1048576).toFixed(0), tot = (p.total / 1048576).toFixed(0), rate = p.offset ? (p.offset / 1048576) / Math.max(1, (Date.now() - t0) / 1000) : 0; show(`Uploading ${mb} / ${tot} MB (${Math.round(p.offset / p.total * 100)}%)${p.resumed ? ' · resumed' : ''}${rate ? ' · ' + rate.toFixed(1) + ' MB/s' : ''}`);
        mix.upload = { status: 'uploading', entryId: p.entryId, offset: p.offset, bytes: p.total, at: new Date().toISOString() }; if (Date.now() - lastSave > 15000) { lastSave = Date.now(); host.savePkg(pkg).catch(() => {}); } } });
    show('Upload finished — setting thumbnail and playlist…');
    mix.upload = { status: 'uploaded', entryId: res.entryId, youtubeVideoId: res.youtubeVideoId, bytes: res.bytes, privacy: 'private', at: new Date().toISOString() };
    pkg.youtubeVideoId = res.youtubeVideoId; pkg.youtube_video_id = res.youtubeVideoId; pkg.youtubeWatchUrl = 'https://www.youtube.com/watch?v=' + res.youtubeVideoId; pkg.performance_status = 'uploaded_private'; pkg.youtubePublishState = 'uploaded-private'; pkg.youtubePublishError = null; mix.publishedAt = null;
    await host.savePkg(pkg);                                                                                      // the video id is recorded BEFORE the optional steps below
    try { if (S.blobs.thumbBlob) { const r = await host.api('thumbnail', { entryId: res.entryId, mixKey: mix.key, data: await U.blobToBase64(S.blobs.thumbBlob) }); mix.thumbnail = r.body && r.body.thumbnail ? r.body.thumbnail : { status: 'failed', error: (r.body && r.body.error) || 'thumbnail_failed' }; } } catch (e) { mix.thumbnail = { status: 'failed', error: String(e.message).slice(0, 120) }; }
    try { const r = await host.api('playlist', { entryId: res.entryId, mixKey: mix.key }); mix.playlists = (r.body && r.body.playlists) || [{ ok: false, error: (r.body && r.body.error) || 'playlist_failed' }]; } catch (e) { mix.playlists = [{ ok: false, error: String(e.message).slice(0, 120) }]; }
    S.up = null; await completeMix(host, task, pkg, mix, S, true);
  } catch (e) {
    const code = e && (e.code || e.name); const why = explainProblems(mix, e && e.detail && e.detail.problems);
    S.up = { running: false, offset: S.up.offset, total: S.up.total, error: e && e.name === 'AbortError' ? 'Upload paused. Resume continues from where YouTube stopped.' : code === 'session_expired_start_again' ? 'The YouTube upload session expired. Use "Start over" — your built file is still here.' : code === 'retries_exhausted' ? 'The connection kept failing. Nothing was lost — Resume when the connection is back.' : 'Upload stopped: ' + (why ? why + ' (' + ((e && e.detail && e.detail.error) || code) + ')' : ((code || e.message) + (e && e.detail && e.detail.error ? ' (' + e.detail.error + ')' : ''))) };
    if (mix.upload && mix.upload.status !== 'uploaded') mix.upload.status = 'interrupted'; try { await host.savePkg(pkg); } catch (_) {}
  } finally { S.upAbort = null; host.rerender(taskId); }
}

// Verify, then complete. Idempotent: a refresh, a retry or a double click re-runs only the check and never uploads again. `fresh` = this session just finished the upload (so the card resets to the next task after a short pause).
async function completeMix(host, task, pkg, mix, S, fresh) {
  const taskId = String(task.taskId || task.id); if (S.completing) return; if (mix.completion) { if (host.pkgFor(task) && host.setStage) host.setStage(taskId, 'done'); return host.rerender(taskId); }
  S.completing = true; host.rerender(taskId);
  try {
    await verifyUpload(host, task, pkg, mix, true); const g = completionGate(mix);
    if (!g.ok) { S.up = { running: false, error: 'The upload is on YouTube but is not confirmed yet (' + g.why + '). Nothing is lost — press "Check and complete" again.' }; try { await host.savePkg(pkg); } catch (_) {} return; }
    mix.completion = { at: new Date().toISOString(), by: host.who(), youtubeVideoId: mix.upload.youtubeVideoId, privacy: 'private', verifiedAt: (mix.verification && mix.verification.at) || null, processing: (mix.verification && mix.verification.processing && mix.verification.processing.state) || null };
    await host.savePkg(pkg); try { await U.opfsDelete(mix.key); } catch (_) {}                                  // the temporary copy goes only once the upload is verified
    if (S.blobs) { try { URL.revokeObjectURL(S.blobs.url); if (S.blobs.thumbUrl) URL.revokeObjectURL(S.blobs.thumbUrl); } catch (_) {} S.blobs = null; }
    S.up = null; host.setStage(taskId, 'done');                                                                    // the task is marked Done here and only here
    if (fresh && host.resetToNext) { if (S.resetTimer) clearTimeout(S.resetTimer); S.resetTimer = setTimeout(() => { S.resetTimer = null; if (document.getElementById('srvfMixRoot-' + taskId)) host.resetToNext(task); }, (typeof window !== 'undefined' && window.__SRVF_RESET_MS) || 15000); }   // the delay can be overridden only by tests
  } finally { S.completing = false; host.rerender(taskId); }
}
// Independent check through the YouTube API (server side): ALWAYS a fresh read of the video, processing state, playlists and thumbnail result — never a cached copy. The result carries the time it was taken.
// A failed attempt never replaces the last good result (it is shown beside it), and the lifecycle stays DONE: YouTube's own processing is displayed separately.
async function verifyUpload(host, task, pkg, mix, quiet) {
  const taskId = String(task.taskId || task.id); const up = mix.upload || {}; const S = st(taskId); if (S.verifying) return; S.verifying = true; S.verifyErr = null; if (!quiet) host.rerender(taskId);
  try {
    const r = await host.api('verify', { entryId: up.entryId, mixKey: mix.key, fresh: Date.now() });
    if (r.body && r.body.ok) { mix.verification = r.body.verification; delete mix.verifyError; S.verifyErr = null; }
    else { S.verifyErr = { at: new Date().toISOString(), error: (r.body && (r.body.detail ? r.body.error + ' — ' + r.body.detail : r.body.error)) || 'verify_failed' }; mix.verifyError = S.verifyErr; }
  } catch (e) { S.verifyErr = { at: new Date().toISOString(), error: String((e && e.message) || e).slice(0, 120) }; mix.verifyError = S.verifyErr; }
  S.verifying = false; if (!quiet) { try { await host.savePkg(pkg); } catch (_) {} host.rerender(taskId); }
}
// Move an existing upload to the dedicated Mixes playlist (server: exact id + title check, add, CONFIRM, only then remove from the individual-song playlists), then show the fresh verification it returns.
async function fixPlaylist(host, task, pkg, mix) {
  const taskId = String(task.taskId || task.id); const up = mix.upload || {}; const S = st(taskId); if (S.fixing) return; S.fixing = true; S.verifyErr = null; host.rerender(taskId);
  try {
    const r = await host.api('playlist_fix', { entryId: up.entryId, mixKey: mix.key });
    if (r.body && r.body.ok) { mix.playlists = r.body.playlists; mix.playlistFix = { at: new Date().toISOString(), removed: r.body.removed || [], failedRemovals: r.body.failedRemovals || [] }; if (r.body.verification) mix.verification = r.body.verification; delete mix.verifyError; }
    else { S.verifyErr = { at: new Date().toISOString(), error: 'playlist correction not applied: ' + ((r.body && r.body.error) || 'failed') }; mix.verifyError = S.verifyErr; }
  } catch (e) { S.verifyErr = { at: new Date().toISOString(), error: 'playlist correction not applied: ' + String((e && e.message) || e).slice(0, 100) }; mix.verifyError = S.verifyErr; }
  S.fixing = false; try { await host.savePkg(pkg); } catch (_) {} host.rerender(taskId);
}

// Plain-language text for the server's refusal reasons (the codes themselves are kept in the package/ledger).
export function explainProblems(mix, problems) {
  if (!Array.isArray(problems) || !problems.length) return '';
  const name = (id) => { const t = (mix.tracks || []).find((x) => x.pkgId === id); return t ? '“' + t.finglish + '”' : 'a song'; };
  const out = problems.map((p) => { const m = /^source_not_public:(.+)$/.exec(p); if (m) return name(m[1]) + ' is not Public on YouTube (it is Private or Unlisted). Make it public in YouTube Studio, or use a different song — nothing was uploaded.';
    const o = /^source_other_channel:(.+)$/.exec(p); if (o) return name(o[1]) + ' belongs to a different YouTube channel — nothing was uploaded.'; const n = /^source_not_on_youtube:(.+)$/.exec(p); if (n) return name(n[1]) + ' was not found on YouTube — nothing was uploaded.';
    const e = /^source_not_eligible:([^:]+):(.+)$/.exec(p); if (e) return name(e[1]) + ' is no longer an eligible published Long (' + (F.SRVF_REASON_TEXT[e[2]] || e[2]) + ').'; return p; });
  return 'The server refused this Mix: ' + out.join(' ');
}
