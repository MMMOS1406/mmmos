#!/usr/bin/env node
// SRV Farsi Mix — ONE-TIME authorization for the isolated private-upload validation (CEO orders 2026-11-12). Run by the CEO on their own Mac, in a terminal where `vercel` is signed in.
//
//   node scripts/farsi-mix-validation-oauth.mjs --channel UCCUa5BLzGh2eRBoqqWBCK_g            authorize + store (Preview only)
//   node scripts/farsi-mix-validation-oauth.mjs --channel UCCUa5BLzGh2eRBoqqWBCK_g --client-json ~/Downloads/client_secret_XXXX.json   (no typing at all: reads Google's downloaded client file, never prints it, deletes it after success)
//   node scripts/farsi-mix-validation-oauth.mjs --cleanup                                      remove the three Preview variables again
//
// v3 (after the second incident the same night): `vercel env add` was seen to read but NOT write (Vercel's audit log showed three env-add READS and no create; the CLI had exited 0 in its non-interactive/agent mode), so v2 reported
// "stored" when nothing was. v3 writes through Vercel's REST API (`vercel api … --input -`, body on stdin) and then READS THE PROJECT'S VARIABLE LIST BACK (metadata only) to prove each variable exists, is `sensitive` and is Preview-only; any
// mismatch is a failure and unwinds. "stored" is printed only after that proof.
// v2 (after the 2026-11-12 incident): BOTH prompts are masked (a * per character; nothing typed or pasted is ever shown) and read in raw mode by this script itself (no dependence on readline internals); inputs are
// validated by SHAPE before use (a secret typed into the client-ID prompt, or the reverse, is refused without echoing it); a pre-flight asks Google's token endpoint whether the client exists / the secret matches BEFORE the browser
// opens (and waits while a brand-new client is still being activated); every output line is scrubbed of anything secret; if anything fails after something was stored, what this run stored is removed again.
// What it does: signs in to Google with a DEDICATED, TEMPORARY "Desktop app" OAuth client (PKCE + loopback listener on 127.0.0.1), proves the token owns the exact SRV Farsi channel, then hands the client id, client secret and refresh
// token to `vercel env add … preview --sensitive` through STDIN. Nothing secret is printed, logged, written to disk or put on a command line or URL. The production OAuth client, its secrets, the stored production tokens and every
// Production variable are never read or touched.
import http from 'node:http'; import crypto from 'node:crypto'; import { spawn } from 'node:child_process';
const ENV = process.env;
const AUTH_URL = ENV.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth', TOKEN_URL = ENV.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', API = ENV.GOOGLE_API_BASE || 'https://www.googleapis.com', REVOKE_URL = ENV.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const VERCEL = ENV.VERCEL_BIN || 'vercel'; const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube.readonly'];
const NAMES = { id: 'SRVF_MIX_OAUTH_CLIENT_ID', secret: 'SRVF_MIX_OAUTH_CLIENT_SECRET', rt: 'SRVF_MIX_OAUTH_REFRESH_TOKEN' };
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }; const has = (n) => process.argv.includes(n);

// ── nothing secret ever reaches the terminal: every output line is scrubbed of every secret value this run has seen ──
const SECRETS = new Set(); const watch = (v) => { if (v && String(v).length >= 6) SECRETS.add(String(v)); };
const scrub = (t) => { let o = String(t); for (const s of SECRETS) o = o.split(s).join('[hidden]'); return o.replace(/GOCSPX-[A-Za-z0-9_-]{8,}/g, '[hidden]').replace(/sk_(live|test)_[A-Za-z0-9]{6,}/g, '[hidden]').replace(/1\/\/[A-Za-z0-9_-]{20,}/g, '[hidden]').replace(/ya29\.[A-Za-z0-9_-]{20,}/g, '[hidden]'); };
const say = (m) => process.stdout.write(scrub(m) + '\n'); const warn = (m) => process.stderr.write(scrub(m) + '\n');
let rawOn = false; const restoreTty = () => { try { if (rawOn && process.stdin.isTTY) process.stdin.setRawMode(false); } catch (_) {} rawOn = false; };
const die = (code, m) => { restoreTty(); process.stderr.write('✗ ' + scrub(m) + '\n'); process.exit(code); };
process.on('SIGINT', () => { restoreTty(); process.stderr.write('\n✗ cancelled; nothing was stored\n'); process.exit(130); });
process.on('uncaughtException', (e) => die(1, 'unexpected error: ' + (e && e.message))); process.on('unhandledRejection', (e) => die(1, 'unexpected error: ' + (e && e.message)));
const b64u = (b) => Buffer.from(b).toString('base64url');

// ── shape checks (pure) ──
const ID_RX = /^\d{8,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com$/, SECRET_RX = /^GOCSPX-[A-Za-z0-9_-]{20,}$/;
const clean = (s) => String(s || '').replace(/\x1b\[20[01]~/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\s"'`]+/g, '');   // paste markers, escape sequences, whitespace, quotes
const looksSecret = (s) => /^GOCSPX-/.test(s) || /^sk_(live|test)_/.test(s) || /^1\/\//.test(s) || /^ya29\./.test(s);
function parseClientId(raw) { const v = clean(raw); if (!v) return { error: 'empty' }; if (looksSecret(v)) { watch(v); return { error: 'is_a_secret' }; } if (!ID_RX.test(v)) return { error: 'bad_shape' }; return { value: v }; }
function parseClientSecret(raw) { const v = clean(raw); watch(v); if (!v) return { error: 'empty' }; if (/^sk_(live|test)_/.test(v)) return { error: 'stripe' }; if (ID_RX.test(v)) return { error: 'is_a_client_id' }; if (!SECRET_RX.test(v)) return { error: 'bad_shape' }; return { value: v }; }

// ── masked input, read in raw mode by this script (works for typing and for pasting; shows only *) ──
// The terminal stays in raw / no-echo mode for the WHOLE input phase (both answers), not per question: in the 2026-11-12 incident the terminal's own echo was ON in the gap between two prompts, so an answer pasted ahead of
// the prompt was shown in plaintext by the terminal itself. Anything typed or pasted early is queued silently and shown only as *.
function makeReader() {
  if (!process.stdin.isTTY) { let data = null; return { ask: async () => { if (data == null) { data = await new Promise((r) => { let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (d += c)).on('end', () => r(d.split('\n'))); process.stdin.resume(); }); } return data.shift() || ''; }, close() {} }; }
  let buf = '', waiter = null, active = false; const queue = [];
  process.stdin.setRawMode(true); rawOn = true; process.stdin.resume(); process.stdin.setEncoding('utf8');
  const onData = (chunk) => {
    const text = String(chunk).replace(/\x1b\[20[01]~/g, '');                                                       // bracketed-paste markers are dropped
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (ch === '\x1b') { const m = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(text.slice(i)); i += m ? m[0].length - 1 : 0; continue; }   // arrow keys etc. are ignored
      if (ch === '\r' || ch === '\n') { const line = buf; buf = ''; if (waiter) { const w = waiter; waiter = null; active = false; process.stdout.write('\n'); w(line); } else queue.push(line); continue; }
      if (ch === '\x03') { restoreTty(); process.stdout.write('\n'); process.stderr.write('✗ cancelled; nothing was stored\n'); process.exit(130); }
      if (ch === '\x7f' || ch === '\b') { if (buf.length) { buf = buf.slice(0, -1); if (active) process.stdout.write('\b \b'); } continue; }
      if (ch === '\x15') { if (active) process.stdout.write('\b \b'.repeat(buf.length)); buf = ''; continue; }
      if (ch >= ' ') { buf += ch; if (active) process.stdout.write('*'); } } };
  process.stdin.on('data', onData);
  return {
    ask(prompt) { process.stdout.write(prompt); if (queue.length) { const line = queue.shift(); process.stdout.write('*'.repeat(line.length) + '\n'); return Promise.resolve(line); } active = true; if (buf.length) process.stdout.write('*'.repeat(buf.length)); return new Promise((res) => { waiter = res; }); },
    close() { process.stdin.removeListener('data', onData); restoreTty(); process.stdin.pause(); },
  };
}
// Vercel access: the REST API through the signed-in CLI (`vercel api`), body on stdin, response captured in memory and NEVER printed. Project ids come from the linked project's .vercel/project.json.
import fs from 'node:fs'; import path from 'node:path';
const VCWD = arg('--vercel-cwd') || process.cwd();
function linked() { try { const j = JSON.parse(fs.readFileSync(path.join(VCWD, '.vercel', 'project.json'), 'utf8')); return j.projectId && j.orgId ? { pid: j.projectId, org: j.orgId } : null; } catch (_) { return null; } }
function vapi(method, endpoint, body) {
  return new Promise((res) => { const args = ['api', endpoint, '-X', method, '--raw'].concat(body != null ? ['--input', '-'] : []).concat(method === 'DELETE' ? ['--dangerously-skip-permissions'] : []);
    const p = spawn(VERCEL, args, { stdio: ['pipe', 'pipe', 'ignore'], cwd: VCWD }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.on('error', () => res({ code: 127, json: null })); p.on('close', (c) => { let j = null; try { j = JSON.parse(out); } catch (_) {} res({ code: c, json: j }); });
    if (body != null) p.stdin.end(JSON.stringify(body)); else p.stdin.end(); });
}
const envUrl = (L, extra = '') => `/v10/projects/${L.pid}/env?teamId=${L.org}${extra}`;
async function listMine(L) { const r = await vapi('GET', envUrl(L)); if (r.code !== 0 || !r.json || !Array.isArray(r.json.envs)) return null; return r.json.envs.filter((e) => Object.values(NAMES).includes(e.key)).map((e) => ({ id: e.id, key: e.key, type: e.type, target: e.target })); }
// store one variable and PROVE it: the API must accept it and the project's variable list must then show it as sensitive and Preview-only (never Production/Development)
async function storeVar(L, name, value) {
  const r = await vapi('POST', envUrl(L, '&upsert=true'), { key: name, value, type: 'sensitive', target: ['preview'] }); if (r.code !== 0 || !r.json || r.json.error || (r.json.failed && r.json.failed.length)) return { ok: false, why: 'vercel_refused' };
  const mine = await listMine(L); if (!mine) return { ok: false, why: 'cannot_verify' }; const hit = mine.find((e) => e.key === name);
  if (!hit) return { ok: false, why: 'not_found_after_write' };
  if (hit.type !== 'sensitive' || !Array.isArray(hit.target) || hit.target.length !== 1 || hit.target[0] !== 'preview') return { ok: false, why: 'wrong_scope_or_type', id: hit.id };
  return { ok: true, id: hit.id };
}
async function removeVar(L, id) { if (!id) return false; const r = await vapi('DELETE', `/v9/projects/${L.pid}/env/${id}?teamId=${L.org}`); return r.code === 0; }
async function revoke(token) { try { await fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }); } catch (_) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (has('--cleanup')) {
  const L = linked(); if (!L) die(2, 'run this from the linked project directory (~/mmm-worktrees/home2: it must contain .vercel/project.json)');
  const mine = await listMine(L); if (!mine) die(1, 'could not read the project variable list from Vercel (are you signed in? `vercel whoami`)');
  let bad = 0; for (const e of mine) { const ok = e.target.length === 1 && e.target[0] === 'preview' ? await removeVar(L, e.id) : false; say(ok ? `✓ removed ${e.key} (Preview)` : `⚠ left ${e.key} alone (${e.target.join('+')}) — not a Preview-only validation variable`); if (!ok) bad++; }
  const left = await listMine(L); say(left && !left.length ? '✓ no validation variable remains in the project' : '⚠ some validation variables may remain — check the Vercel dashboard (Settings → Environment Variables)');
  say('Now delete the temporary OAuth client in Google Cloud Console (Auth Platform → Clients → the TEMP client → Delete): every token issued to it stops working immediately.'); process.exit(bad || !left || left.length ? 1 : 0);
}

const channel = arg('--channel'); if (!/^UC[A-Za-z0-9_-]{20,24}$/.test(channel || '')) die(2, 'give the exact channel id: --channel UCCUa5BLzGh2eRBoqqWBCK_g');
const LINK = linked(); if (!LINK) die(2, 'run this from the linked project directory (cd ~/mmm-worktrees/home2 — it must contain .vercel/project.json). Nothing was asked or sent.');
if ((await listMine(LINK)) === null) die(2, 'cannot read this Vercel project (are you signed in? run `vercel whoami`). Nothing was asked or sent.');
const reader = ((ENV.SRVF_MIX_OAUTH_CLIENT_ID != null && ENV.SRVF_MIX_OAUTH_CLIENT_SECRET != null) || has('--client-json')) ? { ask: async () => '', close() {} } : makeReader();   // raw / no-echo mode is on from here, before anything is printed
say('Both answers are masked: you will see only * while typing or pasting. Paste the CLIENT ID first (looks like 123456789012-abc….apps.googleusercontent.com), then the CLIENT SECRET (starts GOCSPX-).');
let idRaw = ENV.SRVF_MIX_OAUTH_CLIENT_ID, secretRaw = ENV.SRVF_MIX_OAUTH_CLIENT_SECRET; if (secretRaw) watch(clean(secretRaw));
// --client-json <file>: the file Google lets you download for a client (Desktop: {"installed":{client_id,client_secret,…}}). Read in memory, never printed; shape-checked like typed input; deleted (overwritten, then removed) after a successful run.
const CJ = arg('--client-json'); let cjPath = null;
if (CJ) { cjPath = CJ.replace(/^~(?=\/)/, process.env.HOME || '~'); let j; try { j = JSON.parse(fs.readFileSync(cjPath, 'utf8')); } catch (_) { reader.close(); die(2, 'cannot read that client file as JSON (' + path.basename(cjPath) + '). Nothing was sent.'); } const c = (j && (j.installed || j.web)) || {}; idRaw = c.client_id; secretRaw = c.client_secret; if (secretRaw) watch(clean(secretRaw)); if (c.client_id == null || c.client_secret == null) { reader.close(); die(2, 'that file has no client_id/client_secret (download the JSON from the client\'s creation dialog). Nothing was sent.'); } }
const wipeClientFile = () => { if (!cjPath || has('--keep-file')) return false; try { const n = fs.statSync(cjPath).size; fs.writeFileSync(cjPath, Buffer.alloc(n)); fs.unlinkSync(cjPath); return true; } catch (_) { return false; } };
if (idRaw == null) idRaw = await reader.ask('Temporary client ID (masked): ');
const idP = parseClientId(idRaw);
if (idP.error) { reader.close(); die(2, idP.error === 'is_a_secret' ? 'That looks like a SECRET, not a client ID. Nothing was shown or sent. Clear this terminal (⌘K), delete that secret/client in Google Cloud, create a fresh temporary client, and run this again.' : idP.error === 'empty' ? 'no client ID entered' : 'that is not a Google client ID (expected 123456789012-xxxxxxxx.apps.googleusercontent.com). Nothing was sent.'); }
say('✓ client ID accepted (…' + idP.value.slice(-24) + ')'); const clientId = idP.value;
if (secretRaw == null) secretRaw = await reader.ask('Temporary client secret (masked): ');
reader.close();
const secP = parseClientSecret(secretRaw);
if (secP.error) die(2, secP.error === 'stripe' ? 'That is a Stripe-style key, not a Google OAuth client secret (Google secrets begin GOCSPX-). Nothing was sent.' : secP.error === 'is_a_client_id' ? 'That is the client ID, not the secret. Nothing was sent. Run again: ID first, then the secret.' : secP.error === 'empty' ? 'no client secret entered' : 'that does not look like a Google client secret (they begin GOCSPX-). Nothing was sent.');
const clientSecret = secP.value; say('✓ client secret accepted (masked, ' + clientSecret.length + ' characters)');

// ── PKCE / state / loopback listener ──
const verifier = b64u(crypto.randomBytes(48)); watch(verifier); const challenge = b64u(crypto.createHash('sha256').update(verifier).digest()), state = b64u(crypto.randomBytes(16));
let resolveCode, rejectCode; const codeP = new Promise((a, b) => { resolveCode = a; rejectCode = b; });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1'); if (u.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
  const done = (m) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<h3>${m}</h3><p>You can close this tab and return to the terminal.</p>`); };
  if (u.searchParams.get('state') !== state) { done('State mismatch — nothing was stored.'); rejectCode(new Error('state_mismatch')); return; }
  if (u.searchParams.get('error')) { done('Google reported: ' + u.searchParams.get('error')); rejectCode(new Error('google_' + u.searchParams.get('error'))); return; }
  const c = u.searchParams.get('code'); watch(c); done('Authorized.'); resolveCode(c);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;

// ── pre-flight: does Google know this client, and does the secret belong to it? (a dummy code: a valid client answers invalid_grant) ──
async function preflight() {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: 'preflight-not-a-real-code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }).toString() });
  const j = await r.json().catch(() => ({})); const e = String(j.error || ''), d = String(j.error_description || '');
  if (e === 'invalid_grant' || e === 'invalid_request' || (r.status === 400 && e !== 'invalid_client')) return 'ok';
  if (e === 'invalid_client' && /not found/i.test(d)) return 'not_found'; if (e === 'invalid_client') return 'wrong_secret'; return 'other:' + (e || r.status);
}
const waitMs = Math.max(0, Number(arg('--wait-minutes') || ENV.PREFLIGHT_WAIT_MINUTES || 10)) * 60e3, pollMs = Number(ENV.PREFLIGHT_POLL_MS || 20000); const t0 = Date.now(); let pf, announced = false;
for (;;) { pf = await preflight(); if (pf !== 'not_found' || Date.now() - t0 >= waitMs) break; if (!announced) { say('Google does not know this client ID yet. A brand-new client can take a few minutes to be activated — waiting (up to ' + Math.round(waitMs / 60000) + ' min)…'); announced = true; } await sleep(pollMs); }
if (pf === 'wrong_secret') { server.close(); die(1, 'Google knows this client ID but rejected the secret: it belongs to a different client or was mistyped. Nothing was stored. Copy the secret again from the SAME client (or create a fresh client).'); }
if (pf === 'not_found') { server.close(); die(1, 'Google does not recognise this client ID' + (announced ? ' even after waiting' : '') + '. Check that it is the ID of the Desktop-app client you just created (in the same Google Cloud project), not its name or secret. Nothing was stored.'); }
if (pf !== 'ok') { server.close(); die(1, 'the Google pre-flight check failed (' + pf + '). Nothing was stored.'); }
say('✓ Google recognises the client and the secret matches it');

const url = AUTH_URL + '?' + new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
say('OPEN THIS URL: ' + url); say('Sign in with the Google account that owns the Silk Road Voices brand channel and choose THAT channel when asked.');
if (!ENV.NO_BROWSER && !has('--no-browser')) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
let code, timer; try { code = await Promise.race([codeP, new Promise((_, r) => { timer = setTimeout(() => r(new Error('timeout_5_minutes')), 5 * 60e3); })]); } catch (e) { server.close(); die(1, 'authorization did not complete (' + e.message + '); nothing was stored'); }
clearTimeout(timer); server.close();
const tr = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }).toString() });
const tj = await tr.json().catch(() => ({})); if (!tr.ok || !tj.refresh_token) die(1, 'token exchange failed (' + (tj.error || tr.status) + '); nothing was stored'); watch(tj.refresh_token); watch(tj.access_token);
const granted = String(tj.scope || '').split(' '); const missing = SCOPES.filter((s) => !granted.includes(s)); if (missing.length) { await revoke(tj.refresh_token); die(1, 'consent did not include: ' + missing.map((m) => m.split('/').pop()).join(', ') + '; token revoked, nothing was stored'); }
const cr = await fetch(API + '/youtube/v3/channels?part=id&mine=true', { headers: { authorization: 'Bearer ' + tj.access_token } }); const cj = await cr.json().catch(() => ({})); const ids = (cj.items || []).map((x) => x.id);
if (!ids.includes(channel)) { await revoke(tj.refresh_token); die(2, `this authorization belongs to a different channel (${ids.length} channel(s) seen, none is ${channel}); the new token was revoked and nothing was stored. Run again and pick the Silk Road Voices brand channel.`); }
say(`✓ the authorization owns ${channel} (scopes: upload, force-ssl, readonly)`);
const stored = []; const unwind = async () => { for (const id of stored.reverse()) await removeVar(LINK, id); await revoke(tj.refresh_token); };
for (const [name, val] of [[NAMES.id, clientId], [NAMES.secret, clientSecret], [NAMES.rt, tj.refresh_token]]) {
  const r = await storeVar(LINK, name, val);
  if (!r.ok) { if (r.id) stored.push(r.id); await unwind(); die(1, `Vercel did NOT store ${name} (${r.why}); what this run had already stored was removed and the new token revoked. Nothing is stored. Check \`vercel whoami\` and the linked project, then run this again`); }
  stored.push(r.id); say(`✓ ${name} verified in the project (Preview-only, sensitive; value never printed)`);
}
const final = await listMine(LINK); if (!final || final.length !== 3 || final.some((e) => e.type !== 'sensitive' || e.target.join() !== 'preview')) { await unwind(); die(1, 'final verification of the three variables failed; everything this run stored was removed and the new token revoked'); }
if (cjPath) say(wipeClientFile() ? '✓ the downloaded client file was overwritten and deleted' : '⚠ the downloaded client file was left in place — delete it yourself: ' + path.basename(cjPath));
say('Done. Tell Claude Code "validation credential added". The refresh token exists nowhere else: not on screen, not on disk, not in this terminal\'s history.');
process.exit(0);
