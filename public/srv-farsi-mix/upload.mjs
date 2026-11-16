// SRV Farsi Mix — browser-side handling of the LARGE rendered file (CEO order 2026-11-12): a temporary copy in the browser's private storage (OPFS) so a page reload does not lose a
// long build, a capacity check before building, and the chunked, resumable, retrying upload to the server relay (which forwards each chunk to ONE private YouTube upload).
// Nothing here writes to our servers' storage; the temporary copy lives only in this browser and is deleted after the upload (or by "Discard").
const DIR = 'srvf-mix';
export const opfsOk = () => !!(typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory);
async function dir() { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle(DIR, { create: true }); }
async function putFile(d, name, data) { const fh = await d.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }
export async function opfsSave(key, { blob, thumbBlob, meta }) { if (!opfsOk()) return false; try { const d = await dir(); await putFile(d, key + '.video', blob); if (thumbBlob) await putFile(d, key + '.thumb', thumbBlob); await putFile(d, key + '.json', JSON.stringify(meta || {})); return true; } catch (e) { console.warn('[SRV Farsi Mix] temporary copy failed:', e && e.message); return false; } }
export async function opfsLoad(key) {
  if (!opfsOk()) return null;
  try { const d = await dir(); const v = await (await d.getFileHandle(key + '.video')).getFile(); let t = null, meta = {}; try { t = await (await d.getFileHandle(key + '.thumb')).getFile(); } catch (_) {} try { meta = JSON.parse(await (await (await d.getFileHandle(key + '.json')).getFile()).text()); } catch (_) {} return v.size ? { blob: v, thumbBlob: t, meta } : null; } catch (_) { return null; }
}
export async function opfsDelete(key) { if (!opfsOk()) return; try { const d = await dir(); for (const n of ['.video', '.thumb', '.json']) { try { await d.removeEntry(key + n); } catch (_) {} } } catch (_) {} }
// Free space check before a long build: the recording (kept by the browser) and its temporary copy both need room. bps = the render's video bitrate + audio.
export async function capacity(runtimeSec, bps = 6_192_000) {
  const need = Math.ceil((bps * runtimeSec) / 8 * 2.2) + 64 * 1048576;
  try { const e = await navigator.storage.estimate(); const free = (e.quota || 0) - (e.usage || 0); return { known: true, need, free, ok: free >= need }; } catch (_) { return { known: false, need, free: null, ok: true }; }
}
export const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error || new Error('read failed')); r.readAsDataURL(blob); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortErr = () => Object.assign(new Error('Upload paused'), { name: 'AbortError' });
export class UploadError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail || null; } }

// api(op, body) -> { status, body } (the page's signed-in call to the server relay). Resumes automatically after transient failures (network, 5xx, YouTube 503) with backoff; a
// browser reload resumes by calling this again — the server re-reads the true offset from YouTube. Throws UploadError for anything that needs a person.
export async function uploadFile({ api, file, mime, mix, initExtra = {}, onProgress, signal, retries = 6, sleepImpl = sleep }) {
  const init = await api('upload_init', { mix, bytes: file.size, mime, ...initExtra }); if (!init.body || !init.body.ok) throw new UploadError((init.body && init.body.error) || 'upload_init_failed', init.body);
  const entryId = init.body.entryId, chunk = init.body.chunkBytes; let offset = init.body.offset || 0; const total = file.size; let sent = 0;
  onProgress && onProgress({ offset, total, entryId, resumed: !!init.body.resumed });
  while (offset < total) {
    if (signal && signal.aborted) throw abortErr();
    const end = Math.min(total, offset + chunk); const data = await blobToBase64(file.slice(offset, end)); let tries = 0, r = null;
    for (;;) {
      if (signal && signal.aborted) throw abortErr();
      try { r = await api('upload_chunk', { entryId, mixKey: mix.key, offset, data }); } catch (e) { r = { status: 0, body: { error: 'network' } }; }
      if (r.body && r.body.ok) break;
      const err = r.body && r.body.error;
      if (err === 'offset_mismatch') { offset = r.body.offset; r = null; break; }                    // resync with YouTube's real position
      if (err === 'session_expired_start_again' || err === 'upload_not_resumable' || err === 'upload_not_found') throw new UploadError(err, r.body);
      if (r.status === 0 || r.status >= 500 || err === 'chunk_failed_retry' || err === 'status_failed') { if (++tries > retries) throw new UploadError('retries_exhausted', { offset, last: r.body }); await sleepImpl(Math.min(30000, 1000 * 2 ** (tries - 1))); continue; }
      throw new UploadError(err || 'chunk_refused', r.body);
    }
    if (!r) continue;
    sent += end - offset; offset = r.body.offset != null ? r.body.offset : end;
    onProgress && onProgress({ offset, total, entryId });
    if (r.body.done) return { entryId, youtubeVideoId: r.body.youtubeVideoId, bytes: total };
  }
  const st = await api('upload_status', { entryId, mixKey: mix.key }); if (st.body && st.body.done) { const s2 = await api('video_status', { entryId, mixKey: mix.key }); return { entryId, youtubeVideoId: s2.body && s2.body.youtubeVideoId, bytes: total }; }
  throw new UploadError('upload_not_confirmed', st.body);
}
