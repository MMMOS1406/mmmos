// CEO-017D Release 2 — nothing left in the served app that can authenticate or reveal a credential, the server is unchanged, and sessions expire.
//   node tests/ceo017a/test_release2.mjs      (no network, throw-away secrets only)
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { pathToFileURL } from 'node:url'; import { createHmac, createHash } from 'node:crypto';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); process.chdir(repo);
const R = []; const check = (n, ok, d = '') => { R.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const html = fs.readFileSync('public/index.html', 'utf8'); const users = html.slice(html.indexOf('const USERS=['), html.indexOf('];', html.indexOf('const USERS=[')) + 2);
/* ---- A. the served app ---- */
check('USERS carries no PIN for any role', !/\bpin\s*:/.test(users) && /id:"admin"/.test(users) && /id:"family"/.test(users) && /id:"va"/.test(users));
check('no browser-side PIN comparison remains', !/\.pin\s*===?/.test(html) && !/selectedUser\.pin/.test(html));
check('the sign-in screen shows no PIN hint', !/class="pin-hint/.test(html) && !/(Family|VA|Admin)\s*:\s*[0-9]{3,}/.test(html));
check('no plaintext PIN storage path: nothing assigns settings.pins / adminPin (only the purge deletes them)', !/settings\.pins\s*[\[=]/.test(html.replace(/delete D\.settings\.pins/g, '')) && !/adminPin\s*[:=]/.test(html.replace(/delete D\.settings\.adminPin/g, '')));
check('sign-in fails closed when the server cannot confirm the PIN', /CEO-017D RELEASE 2[\s\S]{0,400}Could not sign in/.test(html));
const files = fs.readdirSync('public').sort(); const expected = ['about.html', 'assets', 'audit.txt', 'index.html', 'mmm-icon.png', 'privacy.html', 'shell.js', 'srv-studio-v2', 'terms.html'];
check('public/ holds only the expected files (no staging/old copies of the app)', expected.every((f) => files.includes(f)) && !files.some((f) => /staging|old|backup|copy/i.test(f)) && files.filter((f) => /\.html$/.test(f)).length === 4, files.join(','));
check('the old root index.html and public/index_staging.html are gone', !fs.existsSync('index.html') && !fs.existsSync('public/index_staging.html'));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const PATS = [/\b(pin|passcode|password)\s*[:=]\s*["'][0-9A-Za-z!@#$%^&*._-]{3,}["']/i, /sb_secret_[A-Za-z0-9]/, /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, /\bsk-[A-Za-z0-9]{20,}/, /\bghp_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/];
const hits = []; for (const f of walk('public')) { if (/\.(png|jpg|jpeg|woff2?|ttf|mp3|mp4)$/i.test(f)) continue; const t = fs.readFileSync(f, 'utf8'); for (const re of PATS) { const m = t.match(re); if (m && !/Must differ from the (CEO|VA) PIN/.test(m[0])) hits.push(`${f}: ${re.source.slice(0, 20)}`); } }
check('credential-pattern scan of every served file finds nothing (the only keys are the public database key and the public sign-in constants)', hits.length === 0, hits.join(' | '));
/* ---- B. server unchanged from Release 1 (deployed) => rollback to Release 1 is trivially compatible ---- */
const REL1 = process.env.REL1_SHA || '4d63ee3';
let srvDiff = ''; try { srvDiff = execFileSync('git', ['diff', '--stat', REL1, 'HEAD', '--', 'api', 'lib', 'vercel.json', 'package.json']).toString().trim(); } catch (e) { srvDiff = 'git error ' + e.message; }
check(`api/, lib/, vercel.json and package.json are byte-identical to the deployed Release 1 (${REL1}) — Release 2 changes the page only`, srvDiff === '', srvDiff);
/* ---- C. sessions expire (server, real handler) ---- */
const SECRET = 'r2-secret', H = (s) => createHash('sha256').update(s).digest('hex'); const scrypt = await import(pathToFileURL(path.join(repo, 'lib', 'pinHash.mjs')).href);
const cfg = new Map([['ceo_session_secret_production', SECRET], ['ceo_pin_hash_production', await scrypt.hashPin('r2-ceo-pin-1')], ['operator_pin_hash_production', H('r2-va-pin-2')], ['family_pin_hash_production', await scrypt.hashPin('r2-family-pin-3')]]);
const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (url, opts = {}) => { const u = String(url); if (u.includes('/rest/v1/ceo_auth_config')) { if ((opts.method || 'GET') === 'GET') { const m = /key=in\.\(([^)]*)\)/.exec(u), e = /key=eq\.([^&]+)/.exec(u); const ks = m ? m[1].split(',') : e ? [decodeURIComponent(e[1])] : []; return json(ks.filter((k) => cfg.has(k)).map((k) => ({ key: k, value: cfg.get(k) }))); } const b = JSON.parse(opts.body || '{}'); if (b.key) cfg.set(b.key, b.value); return json([]); } return json([]); };
process.env.SUPABASE_URL = 'https://s.test'; process.env.SUPABASE_SERVICE_KEY = 'k';
const mod = await import(pathToFileURL(path.join(repo, 'api', 'ops.js')).href + '?r2');
const call = async (action, body) => { const r = { code: 200, body: null, setHeader() {}, removeHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } }; await mod.default({ method: 'POST', query: { action }, headers: { origin: 'https://mmm-static.vercel.app' }, body }, r); return r; };
const sign = (o, secret) => { const p = Buffer.from(JSON.stringify(o)).toString('base64url'); return p + '.' + createHmac('sha256', secret).update(p).digest('base64url'); };
const opSecret = createHmac('sha256', SECRET).update('mmmos-operator-session-v1').digest('base64url'), famSecret = createHmac('sha256', SECRET).update('mmmos-family-session-v1').digest('base64url');
const past = Date.now() - 1000, future = Date.now() + 3600e3;
check('CEO: a live session is accepted, an expired one is refused', (await call('ceo_check_session', { ceo_session_token: sign({ sub: 'ceo', exp: future }, SECRET) })).body.ok === true && (await call('ceo_check_session', { ceo_session_token: sign({ sub: 'ceo', exp: past }, SECRET) })).body.ok === false);
check('VA: a live session is accepted, an expired one is refused', (await call('operator_check_session', { operator_session_token: sign({ sub: 'operator', exp: future, pv: H('r2-va-pin-2').slice(0, 12) }, opSecret) })).body.ok === true && (await call('operator_check_session', { operator_session_token: sign({ sub: 'operator', exp: past, pv: H('r2-va-pin-2').slice(0, 12) }, opSecret) })).body.ok === false);
const famFp = (await import(pathToFileURL(path.join(repo, 'lib', 'pinHash.mjs')).href)).pinFingerprint(cfg.get('family_pin_hash_production'));
check('Family: a live session is accepted, an expired one is refused', (await call('family_check_session', { family_session_token: sign({ sub: 'family', exp: future, pv: famFp }, famSecret) })).body.ok === true && (await call('family_check_session', { family_session_token: sign({ sub: 'family', exp: past, pv: famFp }, famSecret) })).body.ok === false);
check('a token signed for one role is refused by the others', (await call('operator_check_session', { operator_session_token: sign({ sub: 'family', exp: future, pv: famFp }, famSecret) })).body.ok === false && (await call('family_check_session', { family_session_token: sign({ sub: 'operator', exp: future, pv: H('r2-va-pin-2').slice(0, 12) }, opSecret) })).body.ok === false);
check('server-side sign-in works for all three roles with the configured PINs (scrypt for CEO/Family, SHA-256 for VA)', (await call('ceo_login', { pin: 'r2-ceo-pin-1' })).body.ok === true && (await call('operator_login', { pin: 'r2-va-pin-2' })).body.ok === true && (await call('family_login', { pin: 'r2-family-pin-3' })).body.ok === true);
check('and refuses wrong PINs for all three', (await call('ceo_login', { pin: 'nope-nope' })).code === 401 && (await call('operator_login', { pin: 'nope-nope' })).code === 401 && (await call('family_login', { pin: 'nope-nope' })).code === 401);
const failed = R.filter((x) => !x).length; console.log(`\n${R.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
