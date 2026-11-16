// An in-memory stand-in for the Google endpoints the SRV Farsi Mix upload uses (OAuth refresh, YouTube resumable upload, videos.list, thumbnails.set, playlists). NOTHING leaves this machine.
// It checks what a real resumable upload checks (Content-Range continuity, 256 KiB alignment, total size) and hashes every byte it receives, so a test can prove the uploaded file is bit-identical.
import { createHash } from 'node:crypto';
export function createMockYouTube({ channelId = 'UCfarsiMixTestChannel01', publicVideos = [] } = {}) {
  const S = { channelId, videos: new Map(), sessions: new Map(), thumbnails: [], playlistItems: [], calls: [], failChunks: 0, expireAll: false, fileInfo: null, processing: 'succeeded', processingProgress: null, aiUnreported: false, apiDown: false, failPlaylistPost: false, plSeq: 0, listLagReads: 0, byIdLagReads: 0, srcDurations: {}, durationMode: 'ms', initCount: 0, chunkPuts: 0,
    playlists: [{ id: 'PL64rNOGmVdtJ0uL2K6ydiaPtzMnW244Fw', title: 'Silk Road Voices Remix' }, { id: 'PL64rNOGmVdtKqungN55qcnPEDNJwMRZN7', title: 'Silk Road Voices Mixes' }, { id: 'PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF', title: 'Silk Road Voices | Emotional ❤️' }, { id: 'PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh', title: 'Silk Road Voices |Shorts' }, { id: 'PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3', title: 'Silk Road Voices | Happy Romantic 🌹' }] };
  for (const v of publicVideos) S.videos.set(v, { id: v, channelId, privacyStatus: 'public' });
  const R = (status, body, headers = {}) => new Response(body == null ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  const bytesOf = (b) => (b == null ? Buffer.alloc(0) : Buffer.isBuffer(b) ? b : b instanceof ArrayBuffer ? Buffer.from(b) : ArrayBuffer.isView(b) ? Buffer.from(b.buffer, b.byteOffset, b.byteLength) : Buffer.from(String(b)));
  async function fetchImpl(input, init = {}) {
    const u = new URL(String(input)); const m = (init.method || 'GET').toUpperCase(); const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])); S.calls.push(m + ' ' + u.host + u.pathname);
    if (u.host === 'oauth2.googleapis.com') { try { const f = Object.fromEntries(new URLSearchParams(String(init.body || ''))); (S.oauthRequests || (S.oauthRequests = [])).push({ client_id: f.client_id, client_secret: f.client_secret, refresh_token: f.refresh_token, grant_type: f.grant_type }); } catch (_) {} if (S.tokenError) return R(401, { error: S.tokenError, error_description: 'Unauthorized' }); return R(200, { access_token: 'mock-access', expires_in: 3600, scope: 'youtube.upload youtube.force-ssl' }); }
    if (u.host === 'www.googleapis.com' && u.pathname === '/upload/youtube/v3/videos' && m === 'POST') {
      S.initCount++; const id = 'sess' + S.initCount; const meta = JSON.parse(init.body || '{}');
      S.sessions.set(id, { id, total: Number(h['x-upload-content-length']), mime: h['x-upload-content-type'], meta, received: 0, hash: createHash('sha256'), done: null });
      return R(200, '', { location: 'https://upload.mock/session/' + id });
    }
    if (u.host === 'upload.mock' && m === 'PUT') {
      const s = S.sessions.get(u.pathname.split('/').pop()); if (!s || S.expireAll) return R(404, 'gone');
      const cr = h['content-range'] || ''; const body = bytesOf(init.body);
      if (/^bytes \*\//.test(cr)) { if (s.done) return R(200, s.done); return s.received ? R(308, '', { range: `bytes=0-${s.received - 1}` }) : R(308, ''); }
      const mt = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr); if (!mt) return R(400, 'bad range');
      if (S.failChunks > 0) { S.failChunks--; return R(503, 'try later'); }
      const a = +mt[1], b = +mt[2], t = +mt[3]; S.chunkPuts++;
      if (a !== s.received || t !== s.total || body.length !== b - a + 1) return R(400, 'range mismatch');
      if (body.length % (256 * 1024) !== 0 && b + 1 !== t) return R(400, 'not aligned');
      s.hash.update(body); s.received = b + 1;
      if (s.received === s.total) { const vid = 'MixVid' + String(S.initCount).padStart(5, '0'); const v = { id: vid, snippet: { channelId: S.channelId, title: s.meta.snippet.title }, status: { privacyStatus: s.meta.status.privacyStatus } }; S.videos.set(vid, { id: vid, channelId: S.channelId, privacyStatus: s.meta.status.privacyStatus, sha256: s.hash.copy().digest('hex'), bytes: s.total, meta: s.meta }); s.done = JSON.stringify(v); return R(200, s.done); }
      return R(308, '', { range: `bytes=0-${s.received - 1}` });
    }
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/channels' && m === 'GET') { if (/contentDetails/.test(u.searchParams.get('part') || '')) return S.noUploads ? R(200, { items: [{ id: S.channelId }] }) : R(200, { items: [{ id: S.channelId, contentDetails: { relatedPlaylists: { uploads: 'UU' + S.channelId.slice(2) } } }] }); return R(200, { items: S.ownedChannels || [{ id: S.channelId }] }); }
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/videos' && m === 'GET') {
      if (S.apiDown) return R(500, { error: 'backend' });
      const ids = (u.searchParams.get('id') || '').split(',').filter(Boolean); const parts = (u.searchParams.get('part') || '').split(',');
      return R(200, { items: ids.map((i) => S.videos.get(i)).filter(Boolean).map((v) => { const o = { id: v.id, snippet: { channelId: v.channelId, ...(v.title ? { title: v.title } : {}), ...(v.publishedAt ? { publishedAt: v.publishedAt } : {}) }, status: { privacyStatus: v.privacyStatus } };
        if (v.meta) { o.snippet = { channelId: v.channelId, title: v.meta.snippet.title, description: v.meta.snippet.description, tags: v.meta.snippet.tags, categoryId: v.meta.snippet.categoryId }; o.status = { privacyStatus: v.privacyStatus, uploadStatus: S.processing === 'succeeded' ? 'processed' : 'uploaded', ...(S.aiUnreported ? {} : { containsSyntheticMedia: v.meta.status.containsSyntheticMedia }), publishAt: v.meta.status.publishAt }; }
        if (parts.includes('contentDetails')) { const sec = v.meta ? (S.fileInfo ? S.fileInfo.durationSec : null) : (S.srcDurations[v.id] != null ? S.srcDurations[v.id] : null); if (sec != null && S.durationMode !== 'none' && S.durationMode !== 'garbage-only') o.contentDetails = { duration: 'PT' + Math.floor(sec / 60) + 'M' + Math.round(sec % 60) + 'S' }; }
        if (parts.includes('processingDetails') && v.meta) o.processingDetails = { processingStatus: S.processing, ...(S.processingProgress ? { processingProgress: S.processingProgress } : {}) };
        if (parts.includes('fileDetails') && v.meta && S.fileInfo && S.processing === 'succeeded') o.fileDetails = { fileSize: String(v.bytes), ...(S.durationMode === 'ms' ? { durationMs: String(Math.round(S.fileInfo.durationSec * 1000)) } : (S.durationMode === 'garbage' || S.durationMode === 'garbage-only') ? { durationMs: 'abc' } : S.durationMode === 'wrong' ? { durationMs: String(Math.round((S.fileInfo.durationSec + 90) * 1000)) } : {}), videoStreams: [{ widthPixels: S.fileInfo.width || 1920, heightPixels: S.fileInfo.height || 1080 }], audioStreams: [{ codec: 'aac' }] };
        return o; }) });
    }
    if (u.host === 'www.googleapis.com' && u.pathname === '/upload/youtube/v3/thumbnails/set' && m === 'POST') { S.thumbnails.push({ videoId: u.searchParams.get('videoId'), bytes: bytesOf(init.body).length, jpeg: bytesOf(init.body)[0] === 0xff }); return R(200, { items: [{}] }); }
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/playlists' && m === 'GET') return R(200, { items: S.playlists.map((p) => ({ id: p.id, snippet: { title: p.title } })) });
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/playlistItems' && m === 'GET' && u.searchParams.get('playlistId') === 'UU' + S.channelId.slice(2)) { // the channel's uploads playlist: every video of THIS channel, newest first, 50 per page
      const all = [...S.videos.values()].filter((v) => v.channelId === S.channelId && !(S.uploadsHidden && S.uploadsHidden.has(v.id))).map((v) => v.id).concat(S.uploadsExtra || []).reverse(); const off = Number(u.searchParams.get('pageToken') || 0), max = Math.min(50, Number(u.searchParams.get('maxResults') || 5)); S.uploadPageReads = (S.uploadPageReads || 0) + 1; if (S.uploadsFailPage && Math.floor(off / max) + 1 === S.uploadsFailPage) return R(500, { error: 'backend' });
      return R(200, { items: all.slice(off, off + max).map((id) => ({ contentDetails: { videoId: id } })), ...(off + max < all.length ? { nextPageToken: String(off + max) } : {}) }); }
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/playlistItems' && m === 'GET') { const pl = u.searchParams.get('playlistId'), vv = u.searchParams.get('videoId'), byId = u.searchParams.get('id'); const mk = (x) => ({ id: x.id, snippet: { playlistId: x.playlistId, resourceId: x.resourceId } });
      if (byId) { const x = S.playlistItems.find((y) => y.id === byId); if (x && x.fresh && S.byIdLagReads > 0) { S.byIdLagReads--; return R(200, { items: [] }); } return R(200, { items: x ? [mk(x)] : [] }); }
      const lag = S.listLagReads > 0; if (lag) S.listLagReads--; let rows = S.playlistItems.filter((x) => x.playlistId === pl && (!vv || x.resourceId.videoId === vv) && !(lag && x.fresh)); const max = Math.min(50, Number(u.searchParams.get('maxResults') || 5)); const off = Number(u.searchParams.get('pageToken') || 0); const page = rows.slice(off, off + max);
      return R(200, { items: page.map(mk), ...(off + max < rows.length ? { nextPageToken: String(off + max) } : {}) }); }
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/playlistItems' && m === 'POST') { if (S.failPlaylistPost) return R(403, { error: 'forbidden' }); const b = JSON.parse(init.body); const id = 'pli' + (++S.plSeq); S.playlistItems.push({ ...b.snippet, id, fresh: S.listLagReads > 0 || S.byIdLagReads > 0 }); return R(200, { id, snippet: b.snippet }); }
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/playlistItems' && m === 'DELETE') { const id = u.searchParams.get('id'); const i = S.playlistItems.findIndex((x) => x.id === id); S.calls.push('DELETE playlistItems ' + id); if (i < 0) return R(404, { error: 'notFound' }); S.playlistItems.splice(i, 1); return R(204, null); }
    return R(599, 'UNEXPECTED ' + m + ' ' + u.href);
  }
  return { fetch: fetchImpl, state: S };
}
