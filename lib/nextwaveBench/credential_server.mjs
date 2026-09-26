// LOCAL-ONLY credential entry for the benchmark session. Binds to 127.0.0.1, one-time secret path, no logging of values.
// Writes ~/mmm-static/.env.bench.local (mode 600) only after confirming the file is git-ignored, verifies each key with a
// minimum-safe vendor call, and writes ONLY {IDEOGRAM, ELEVENLABS: VERIFIED|FAILED} to the status file.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const ENV = new URL('../../.env.bench.local', import.meta.url).pathname;
const STATUS = '/tmp/bench/cred_status.json';
const SECRET = randomBytes(12).toString('hex');
const PORT = Number(process.env.PORT || 47831);

function ignored() { try { execFileSync('git', ['check-ignore', '-q', '.env.bench.local'], { cwd: new URL('../../', import.meta.url).pathname }); return true; } catch { return false; } }

async function verifyEleven(key) {
  // restricted keys may lack user/voices read permission, so verify with the operation we actually need: a 3-character synthesis
  try { const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/cjVigY5qzO86Huf0OWal', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'OK.', model_id: 'eleven_turbo_v2_5' }) }); return r.status === 200 ? 'VERIFIED' : 'FAILED'; } catch { return 'FAILED'; }
}
// Ideogram has no read endpoint: an empty generate request is rejected AFTER authentication (401 = bad key; 400/422 = key accepted). Costs nothing.
async function verifyIdeogram(key) {
  try { const f = new FormData(); const r = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', { method: 'POST', headers: { 'Api-Key': key }, body: f }); return r.status === 401 || r.status === 403 ? 'FAILED' : (r.status >= 400 && r.status < 500) || r.ok ? 'VERIFIED' : 'FAILED'; } catch { return 'FAILED'; }
}
const page = (msg = '') => `<!doctype html><meta charset=utf-8><title>NextWave benchmark credentials</title>
<style>body{font-family:-apple-system,Inter,sans-serif;background:#F7F4EE;color:#1A2744;display:flex;justify-content:center;padding:60px}
.c{background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(26,39,68,.15);padding:36px 40px;max-width:560px;width:100%}
h1{font-size:22px;margin:0 0 6px}p{color:#5b6478;font-size:14px;line-height:1.5}label{display:block;font-weight:700;font-size:13px;margin:18px 0 6px}
input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cfd6e4;border-radius:8px;font-size:15px}
button{margin-top:24px;background:#1A2744;color:#fff;border:0;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer}
.m{margin-top:18px;font-weight:700}</style><div class=c><h1>Benchmark session credentials</h1>
<p>Local page on this computer only. The keys are written to a git-ignored file and never displayed, logged or committed.</p>
<form method=post action="/${SECRET}/save" autocomplete=off><label>Ideogram API key</label><input name=ideogram type=password autocomplete=off placeholder="leave blank to keep the saved key">
<label>ElevenLabs API key</label><input name=eleven type=password autocomplete=off placeholder="leave blank to keep the saved key"><button>Save and verify</button></form><div class=m>${msg}</div></div>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === `/${SECRET}`) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page(ignored() ? '' : 'Refusing: .env.bench.local is not git-ignored.')); }
  if (req.method === 'POST' && req.url === `/${SECRET}/save`) {
    if (!ignored()) { res.writeHead(400); return res.end('refused: not git-ignored'); }
    let body = ''; for await (const ch of req) body += ch; const p = new URLSearchParams(body);
    // a blank field keeps the value already saved (never displayed)
    const saved = {}; if (existsSync(ENV)) for (const l of readFileSync(ENV, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) saved[m[1]] = m[2]; }
    const ik = (p.get('ideogram') || '').trim() || saved.IDEOGRAM_API_KEY || '', ek = (p.get('eleven') || '').trim() || saved.ELEVENLABS_API_KEY || '';
    writeFileSync(ENV, `IDEOGRAM_API_KEY=${ik}\nELEVENLABS_API_KEY=${ek}\n`, { mode: 0o600 }); chmodSync(ENV, 0o600);
    const [i, e] = await Promise.all([verifyIdeogram(ik), verifyEleven(ek)]);
    writeFileSync(STATUS, JSON.stringify({ IDEOGRAM: i, ELEVENLABS: e }));
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page(`IDEOGRAM: ${i} &nbsp;·&nbsp; ELEVENLABS: ${e}. ${i === 'VERIFIED' && e === 'VERIFIED' ? 'You can close this page.' : 'Please re-enter the failed key(s).'}`));
    if (i === 'VERIFIED' && e === 'VERIFIED') setTimeout(() => process.exit(0), 1500);
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, '127.0.0.1', () => { writeFileSync('/tmp/bench/cred_url.txt', `http://127.0.0.1:${PORT}/${SECRET}`); });
