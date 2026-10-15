// SRV Studio V2 preview server — order SRV-STUDIO-V2-002. ISOLATED: SAMPLE DATA, NO PRODUCTION ACCESS.
//
// Serves the REAL public/ app from this branch and answers every Supabase REST call and every /api/*
// call itself (same isolation model as tests/preservation/stub-server.mjs):
//   * index.html is served with SUPABASE_URL rewritten to this server (/__sb), so the app's database
//     traffic never leaves this machine;
//   * every response carries a CSP of connect-src 'self', so the browser refuses any fetch/XHR to
//     another host even if some code path had the production URL hard-coded;
//   * every request is logged (/__stub/log) and any request naming the production project is counted
//     in `productionHits` (expected: 0);
//   * real publishing, uploads and rendering are refused with a clear "disabled in preview" message.
// Unlike the preservation stub, this one STORES package upserts and state saves, so edits survive a
// page reload. State is kept in memory and mirrored to a JSON file so it also survives a restart.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { classifyAction } from '../../preservation/stub-server.mjs';
import { makeStudioFixture, sampleGeneratedPackage, sampleCaption } from './fixture.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
const PROD_MARK = /tldcwvtwjypmwynsklsd/;
const DISABLED = (what) => ({ ok: false, error: `Preview: ${what} is disabled in the SRV Studio V2 preview (no real uploads, renders or publishing).` });

// Preview-only task launcher, injected into the served page (never part of the app code). Lists the
// sample SRV English tasks with their live stage and opens one with a click, after sign-in.
const LAUNCHER = `<div id="srv2-launcher" style="position:fixed;right:12px;bottom:30px;z-index:2147483646;width:250px;background:#15121f;border:1px solid #7c3aed;border-radius:10px;padding:10px 12px;font:12px/1.45 system-ui,sans-serif;color:#eee;box-shadow:0 6px 24px rgba(0,0,0,.5)">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><strong style="color:#c4b5fd;font-size:11px;letter-spacing:.06em">SRV STUDIO V2 · TEST TASKS</strong><button onclick="var b=document.getElementById('srv2-l-body');b.hidden=!b.hidden" style="background:none;border:0;color:#aaa;cursor:pointer">▾</button></div>
<div id="srv2-l-body"><div id="srv2-l-list" style="display:flex;flex-direction:column;gap:5px">Sign in as Mansoor to begin.</div>
<div style="margin-top:8px;padding-top:6px;border-top:1px solid #333;display:flex;flex-wrap:wrap;gap:8px;font-size:11px"><a href="/?srvStudioV2=off" style="color:#c4b5fd">Legacy view (V2 off)</a><a href="/" style="color:#c4b5fd">V2 view</a><a href="#" onclick="if(confirm('Reset all preview tasks and edits to the original sample data?')){fetch('/__stub/reset').then(function(){try{localStorage.clear()}catch(e){};location.reload()})};return false" style="color:#f87171">Reset sample data</a></div></div></div>
<script>(function(){var ids=['201','202','203','204','205'];function draw(){var box=document.getElementById('srv2-l-list');if(!box)return;var ready=typeof D!=='undefined'&&Array.isArray(D.tasks)&&typeof currentUser!=='undefined'&&currentUser&&typeof openExec==='function';if(!ready){return;}var h='';ids.forEach(function(id){var t=D.tasks.find(function(x){return String(x.id)===id&&x.engine==='SRV English';});if(!t)return;var st=typeof _srvEnglishGetStage==='function'?_srvEnglishGetStage(id):'?';var f=t.contentFormat==='long'?'Long':'Short';h+='<button onclick="if(typeof renderTab===\\'function\\')renderTab(\\'tasks\\');openExec(\\''+id+'\\')" style="text-align:left;padding:6px 8px;background:#221c33;border:1px solid #3b2f5c;border-radius:6px;color:#eee;cursor:pointer;font:12px system-ui"><b>#'+id+'</b> · '+f+' · <span style="color:#c4b5fd">'+String(st).toUpperCase()+'</span></button>';});h=h||'No sample tasks found — use Reset sample data.';if(box.__h!==h){box.__h=h;box.innerHTML=h;}}setInterval(draw,1500);})();</script>`;

export async function startPreview({ publicDir, port = 4188, dataFile = null, quiet = true } = {}) {
  const fresh = () => { const f = makeStudioFixture(); return { settings: { ...f.settings }, packages: Object.fromEntries(f.tables.packages.map((r) => [r.package_id, r])), genCount: 4 /* samples 0-3 are the seeded packages */, fixtureApi: f.api }; };
  let store = fresh();
  if (dataFile && fs.existsSync(dataFile)) {
    try { const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8')); store = { ...fresh(), ...saved, fixtureApi: fresh().fixtureApi }; } catch { /* corrupt → fresh */ }
  }
  const persist = () => { if (!dataFile) return; const { fixtureApi, ...rest } = store; fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(rest)); };
  const log = []; let productionHits = 0; let origin = '';

  const send = (res, code, body, headers = {}) => {
    const h = { 'Content-Security-Policy': "connect-src 'self'; frame-src *; img-src * data: blob:; media-src * data: blob:;", 'Cache-Control': 'no-store', ...headers };
    if (typeof body === 'object' && !Buffer.isBuffer(body)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    res.writeHead(code, h); res.end(body);
  };
  const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); const raw = Buffer.concat(c).toString('utf8'); try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const record = (req, u, extra) => { const e = { t: new Date().toISOString(), method: req.method, path: u.pathname, action: u.searchParams.get('action') || '', ...extra }; log.push(e); if (log.length > 5000) log.shift(); };

  async function handleSupabase(req, res, u) {
    const rest = u.pathname.replace(/^\/__sb/, '');
    const m = rest.match(/^\/rest\/v1\/([a-z0-9_]+)/);
    const table = m && m[1];
    if (req.method === 'GET' || req.method === 'HEAD') {
      record(req, u, { kind: 'sb-read', table });
      if (table === 'app_settings') {
        const k = (u.searchParams.get('key') || '').replace(/^eq\./, '');
        if (k && k in store.settings) return send(res, 200, [{ key: k, value: store.settings[k], updated_at: new Date().toISOString() }]);
        return send(res, 200, []);
      }
      if (table === 'packages') {
        let rows = Object.values(store.packages).sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));
        const eng = (u.searchParams.get('engine') || '').replace(/^eq\./, ''); if (eng) rows = rows.filter((r) => r.engine === eng);
        return send(res, 200, rows.slice(0, Number(u.searchParams.get('limit')) || 200));
      }
      return send(res, 200, []);
    }
    const json = await readBody(req);
    const rpc = rest.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)/);
    if (rpc) {
      record(req, u, { kind: 'sb-write', rpc: rpc[1], key: json && json.p_key });
      if (rpc[1] === 'mmm_state_save' && json && json.p_key) { store.settings[json.p_key] = JSON.stringify(json.p_new); persist(); }
      return send(res, 200, null);
    }
    record(req, u, { kind: 'sb-write', table, id: json && (json.package_id || json.key) });
    if (table === 'packages' && json) {
      for (const row of Array.isArray(json) ? json : [json]) if (row && row.package_id) store.packages[row.package_id] = { ...(store.packages[row.package_id] || {}), ...row };
      persist(); return send(res, 201, []);
    }
    if (table === 'app_settings' && json && json.key) {
      if (json.key === 'srv_studio_v2_enabled') return send(res, 403, { message: 'preview: the flag row is fixed' });
      store.settings[json.key] = typeof json.value === 'string' ? json.value : JSON.stringify(json.value); persist(); return send(res, 201, []);
    }
    return send(res, 201, []);
  }

  async function handleApi(req, res, u) {
    const json = req.method === 'GET' ? null : await readBody(req);
    const action = u.searchParams.get('action') || (json && json.action) || '';
    record(req, u, { kind: 'api', cls: classifyAction(action) });
    if (u.pathname === '/api/generate') {
      if (!json || json.engine !== 'SRV English') return send(res, 200, { success: false, error: 'Preview: only SRV English generation is simulated here' });
      const pkg = sampleGeneratedPackage(store.genCount++); persist();
      return send(res, 200, { success: true, engineType: 'suno', package: pkg });
    }
    if (u.pathname === '/api/ops') {
      if (action === 'ceo_login') return send(res, 200, { ok: true, ceo_session_token: 'preview.session', expires_at: new Date(Date.now() + 8 * 3600e3).toISOString() });
      if (action === 'ceo_check_session') return send(res, 200, { ok: true });
      if (action === 'srv_english_regen_caption') return send(res, 200, sampleCaption(json && json.title, json && json.lyrics));
      if (action === 'srv_english_pexels_bg' || action === 'srv_english_build') return send(res, 200, DISABLED('video rendering'));
      if (/youtube_upload|set_yt_thumbnail|tiktok_|instagram_|publish/.test(action)) return send(res, 200, DISABLED('publishing'));
      const canned = store.fixtureApi[action];
      if (canned !== undefined) return send(res, 200, typeof canned === 'function' ? canned(json, store) : canned);
      return send(res, 200, { ok: true });
    }
    if (/^\/api\/(youtube|tiktok|instagram)\//.test(u.pathname)) return send(res, 200, { ok: true, connected: false, connections: [] });
    if (u.pathname.startsWith('/api/queue')) return send(res, 200, { ok: true, queue: [], pending: 0 });
    return send(res, 200, { ok: true });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (PROD_MARK.test(req.url) || PROD_MARK.test(String(req.headers.referer || ''))) productionHits++;
      if (u.pathname === '/__stub/log') return send(res, 200, { productionHits, count: log.length, log: log.slice(-400) });
      if (u.pathname === '/__stub/reset') { store = fresh(); persist(); log.length = 0; return send(res, 200, { ok: true, reset: true }); }
      if (u.pathname === '/__stub/state') return send(res, 200, { settings: Object.keys(store.settings), packages: Object.values(store.packages).map((r) => ({ id: r.package_id, title: r.title, task: r.task_id })) });
      if (u.pathname === '/__stub/package') { const r = store.packages[u.searchParams.get('id')]; return send(res, r ? 200 : 404, r ? JSON.parse(r.full_package) : { error: 'not found' }); }
      if (u.pathname.startsWith('/__sb/')) return await handleSupabase(req, res, u);
      if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u);
      let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
      const file = path.join(publicDir, p);
      if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
      let body = fs.readFileSync(file);
      if (p === '/index.html') {
        const src = body.toString('utf8');
        const needle = "const SUPABASE_URL='https://tldcwvtwjypmwynsklsd.supabase.co'";
        if (!src.includes(needle)) return send(res, 500, 'preview refused to start: Supabase URL not found for rewriting', { 'Content-Type': 'text/plain' });
        const banner = '<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:4px 10px;background:#7c3aed;color:#fff;font:600 11px/1.4 system-ui,sans-serif;text-align:center;pointer-events:none">SRV STUDIO V2 PREVIEW — sample data on this computer only · no production access · nothing is published</div>' + LAUNCHER;
        const self = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(String(req.headers.host || '')) ? 'http://' + req.headers.host : origin;
        body = Buffer.from(src.replace(needle, `const SUPABASE_URL='${self}/__sb'`), 'utf8');
        const at = body.lastIndexOf('</body>'); if (at > 0) body = Buffer.concat([body.subarray(0, at), Buffer.from(banner, 'utf8'), body.subarray(at)]);
      }
      return send(res, 200, body, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    } catch (e) {
      if (!quiet) console.error(e);
      send(res, 500, { ok: false, error: String(e && e.message) });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port; origin = `http://127.0.0.1:${p}`;
    resolve({ origin, port: p, log, get productionHits() { return productionHits; }, store: () => store, close: () => new Promise((r) => server.close(r)) });
  }));
}
