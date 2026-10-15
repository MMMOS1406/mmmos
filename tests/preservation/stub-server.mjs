// CEO-008 Phase 0 — preservation harness: stub backend.
//
// Serves the REAL public/ app and answers every Supabase REST call and every /api/* call from
// synthetic fixtures held in memory. Nothing here can reach production:
//   * index.html is served with SUPABASE_URL rewritten to this server (/__sb);
//   * every response carries a CSP of connect-src 'self', so a real browser cannot fetch/XHR
//     anywhere else even if some code path hard-coded another host;
//   * every non-GET request, and every API action classified as a write, is recorded in a log.
//
// Used by run.mjs (automated checks) and preview.mjs (a human-navigable, write-safe preview).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture } from './fixtures.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain', '.mp3': 'audio/mpeg',
};

const READISH = /(^|_)(list|get|status|check|probe|state|matrix|health|config|poll|load|summary|metrics|detail|debug|verify|login|report|queue_status|rankings|recommendations|dashboard|foundation|learning|performance|memory|notifications|catalog)(_|$)/;
const WRITEISH = /(^|_)(create|update|save|delete|set|add|approve|reject|revise|revision|request|start|generate|publish|upload|register|authorize|execute|rollback|seed|clean|sync|mark|apply|toggle|recompute|contain|finish|chunk|render|export|link|exchange|pull|remove|revoke|pair|pairing|reset|submit|record|run|regen|build|compose|slice|concat|prepare|enable|disable|retry|resolve|log|review|curate|materialize|ingest|brand|pause|resume|reconcile)(_|$)/;

export function classifyAction(action) {
  if (!action) return 'unknown';
  if (WRITEISH.test(action) && !/^(list|get)_/.test(action) && !/_(list|get|status)$/.test(action)) return 'write';
  if (READISH.test(action)) return 'read';
  return 'unclassified';
}

export function startStub({ publicDir, port = 0, fixture = makeFixture(), quiet = true } = {}) {
  const store = { settings: { ...fixture.settings }, tables: JSON.parse(JSON.stringify(fixture.tables)) };
  const log = [];
  const unknown = new Set();
  const statics = [];                       // every static file served (so tests can prove what the page did and did not request)
  let origin = '';

  const send = (res, code, body, headers = {}) => {
    const h = {
      'Content-Security-Policy': "connect-src 'self'; frame-src *; img-src * data: blob:; media-src * data: blob:;",
      'Cache-Control': 'no-store', ...headers,
    };
    if (typeof body === 'object' && !Buffer.isBuffer(body)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    res.writeHead(code, h); res.end(body);
  };

  function record(req, extra) {
    const u = new URL(req.url, 'http://x');
    log.push({ method: req.method, path: u.pathname, action: u.searchParams.get('action') || '', ...extra });
  }

  async function readBody(req) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { /* not json */ }
    return { raw, json };
  }

  async function handleSupabase(req, res, u) {
    const rest = u.pathname.replace(/^\/__sb/, '');
    if (req.method === 'GET' || req.method === 'HEAD') {
      const m = rest.match(/^\/rest\/v1\/([a-z0-9_]+)/);
      if (!m) { record(req, { kind: 'sb-read', note: 'non-rest' }); return send(res, 200, []); }
      const table = m[1];
      record(req, { kind: 'sb-read', table });
      if (table === 'app_settings') {
        const k = (u.searchParams.get('key') || '').replace(/^eq\./, '');
        if (k && k in store.settings) return send(res, 200, [{ key: k, value: store.settings[k] }]);
        return send(res, 200, []);
      }
      return send(res, 200, store.tables[table] || []);
    }
    const { json } = await readBody(req);
    const rpc = rest.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)/);
    if (rpc) {
      record(req, { kind: 'sb-write', rpc: rpc[1], key: json && json.p_key });
      if (rpc[1] === 'mmm_state_save' && json && json.p_key) store.settings[json.p_key] = JSON.stringify(json.p_new);
      return send(res, 200, null);
    }
    const t = rest.match(/^\/rest\/v1\/([a-z0-9_]+)/);
    record(req, { kind: 'sb-write', table: t && t[1] });
    return send(res, 201, []);
  }

  async function handleApi(req, res, u) {
    const { json } = req.method === 'GET' ? { json: null } : await readBody(req);
    const action = u.searchParams.get('action') || (json && json.action) || '';
    const cls = classifyAction(action);
    const isWrite = req.method !== 'GET' ? cls !== 'read' : cls === 'write';
    record(req, { kind: 'api', cls, write: isWrite });
    if (u.pathname === '/api/ops') {
      if (action === 'ceo_login') return send(res, 200, { ok: true, ceo_session_token: 'stub.session', expires_at: new Date(Date.now() + 3600e3).toISOString() });
      if (action === 'ceo_check_session') return send(res, 200, { ok: true });
      // SRV-STUDIO-V2-017 — VA sign-in, modelled on production: no VA PIN set → operator_not_configured (the
      // browser keeps its legacy PIN); with fixture.operatorPin set → server-verified session or invalid_credentials.
      if (action === 'operator_login') {
        if (!fixture.operatorPin) return send(res, 200, { ok: false, error: 'operator_not_configured' });
        return json && json.pin === fixture.operatorPin
          ? send(res, 200, { ok: true, operator_session_token: 'stub.operator', expires_at: new Date(Date.now() + 3600e3).toISOString() })
          : send(res, 401, { ok: false, error: 'invalid_credentials' });
      }
      const canned = fixture.api[action];
      if (canned !== undefined) return send(res, 200, typeof canned === 'function' ? canned(json, store) : canned);
      unknown.add(action || '(none)');
      return send(res, 200, { ok: true });
    }
    if (/^\/api\/(youtube|tiktok|instagram)\/(status|sync)/.test(u.pathname)) return send(res, 200, { ok: true, connected: false, connections: [] });
    if (u.pathname === '/api/reports/weekly') return send(res, 200, fixture.api.__weekly || { ok: true, report: null });
    if (u.pathname.startsWith('/api/queue')) return send(res, 200, { ok: true, queue: [], pending: 0 });
    unknown.add(u.pathname);
    return send(res, 200, { ok: true });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/__stub/log') return send(res, 200, { log, unknown: [...unknown], statics });
      if (u.pathname === '/__stub/reset') { log.length = 0; unknown.clear(); statics.length = 0; store.settings = { ...fixture.settings }; return send(res, 200, { ok: true }); }
      if (u.pathname === '/__stub/state') return send(res, 200, { value: store.settings[u.searchParams.get('key') || 'mmm_finance_v118'] || null });
      if (u.pathname.startsWith('/__sb/')) return await handleSupabase(req, res, u);
      if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u);
      let p = decodeURIComponent(u.pathname);
      if (p === '/') p = '/index.html';
      const file = path.join(publicDir, p);
      if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { record(req, { kind: 'static-404' }); return send(res, 404, 'not found', { 'Content-Type': 'text/plain' }); }
      statics.push(p);
      let body = fs.readFileSync(file);
      if (p === '/index.html') {
        body = Buffer.from(body.toString('utf8').replace("const SUPABASE_URL='https://tldcwvtwjypmwynsklsd.supabase.co'", `const SUPABASE_URL='${origin}/__sb'`), 'utf8');
      }
      return send(res, 200, body, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    } catch (e) {
      if (!quiet) console.error(e);
      send(res, 500, { ok: false, error: String(e && e.message) });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port; origin = `http://127.0.0.1:${p}`;
      resolve({ origin, port: p, log, unknown, store, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
