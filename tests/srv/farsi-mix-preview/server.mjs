// Isolated local preview server for the SRV Farsi Mix (CEO order 2026-11-12). Serves the repo's public/ folder and the preview page only; nothing here talks to production.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), pub = path.resolve(here, '../../../public');
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.css': 'text/css' };
export function startPreview({ port = 0, mediaDir = null } = {}) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
    const send = (f) => { try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(b); } catch { res.writeHead(404); res.end('not found'); } };
    if (p === '/' || p === '/farsi-mix') return send(path.join(here, 'page.html'));
    if (p.startsWith('/preview/')) return send(path.join(here, p.slice(9)));
    if (mediaDir && p.startsWith('/media/')) return send(path.join(mediaDir, p.slice(7)));
    const f = path.join(pub, p); if (!f.startsWith(pub)) { res.writeHead(403); return res.end(); } send(f);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ origin: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise((x) => srv.close(x)) })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const s = await startPreview({ port: Number(process.env.PORT || 4177), mediaDir: process.env.MEDIA_DIR || null }); console.log('SRV Farsi Mix preview: ' + s.origin + '/farsi-mix'); }
