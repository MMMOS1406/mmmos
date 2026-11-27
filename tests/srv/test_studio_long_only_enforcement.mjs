// SRV Studio Long-only ENFORCEMENT at generation: REAL api/generate.js and REAL api/ops.js generate_package against one fake world (no network, SYNTHETIC keys).
// New Studio Shorts are refused before any model call; Studio Long and Silk Road Voices are unchanged; nothing historical is read or written. node tests/srv/test_studio_long_only_enforcement.mjs
import fs from 'node:fs';
import { world, resetWorld, loadPair, cleanup, mkRes, signCeo, repo, reporter } from '../g0safety/world.mjs';
import * as P from '../../lib/srvStudioPolicy.mjs';
const { check, done } = reporter();
const LONG_ONLY = JSON.stringify({ enabled: true, format: 'long', dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg', order: 'SRV-STUDIO-V2-028', note: 'x' });   // the production value applied 2026-11-24
const BOTH = JSON.stringify({ enabled: true, format: 'long', formats: ['long', 'short'], dailyCap: 5, channelId: 'UC0nzWQX6AaUqlF5FozNpWPg', order: 'SRV-STUDIO-V2-028' });             // the previous value
const log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\d+ passed)/.test(a[0])) log(...a); }; console.warn = () => {}; console.error = () => {};
resetWorld(); const gen = (await loadPair('generate.js', '7d3f81a')).cur.default, ops = (await loadPair('ops.js', '7d3f81a')).cur.default;
const G = async (body) => { world.anthropic = []; world.writes = []; const r = mkRes(); await gen({ method: 'POST', headers: {}, body }, r); return { r, n: world.anthropic.length, w: world.writes.length }; };
const O = async (body) => { world.anthropic = []; world.writes = []; const r = mkRes(); await ops({ method: 'POST', headers: { 'x-mmm-ceo-session': signCeo(), origin: 'https://mmm-static.vercel.app' }, query: { action: 'generate_package' }, body }, r); return { r, n: world.anthropic.length, w: world.writes.length }; };
const set = (v) => { if (v === undefined) delete world.flags.srv_studio_v2_production; else world.flags.srv_studio_v2_production = v; };
const SH = { engine: 'SRV English', mood: 'Female — Emotional', platform: 'YouTube', contentType: 'Short', contentFormat: 'short', taskName: 't', recentPackages: [] }, LG = { ...SH, contentType: 'Long', contentFormat: 'long' };

/* policy library */
check('policy: Long-only production config → Shorts not allowed; the previous (long+short) config → allowed', !P.shortsAllowed(LONG_ONLY) && P.shortsAllowed(BOTH));
check('policy: a missing, unreadable or malformed configuration means Long-only (fails closed to the policy)', [null, undefined, '', 'not json', '{}', '{"enabled":false}', 42].every((x) => !P.shortsAllowed(x)));
check('policy: an explicit contentFormat wins over free text; free text counts only when no format is given', P.isShortRequest({ contentFormat: 'short' }) && !P.isShortRequest({ contentFormat: 'long', contentType: 'Short' }) && P.isShortRequest({ contentType: 'Short Video' }) && !P.isShortRequest({ contentType: 'Long Script' }) && !P.isShortRequest(null));
check('policy: only the SRV English / srv_english engine is covered', P.isStudioEngine('SRV English') && P.isStudioEngine('srv_english') && !P.isStudioEngine('SRV Farsi') && !P.isStudioEngine('srv_farsi'));

/* api/generate.js */
set(LONG_ONLY);
{ const o = await G(SH); check('generate: a new SRV Studio Short is refused with 409 production_long_only, a plain-language message, ZERO model calls and ZERO writes', o.r.code === 409 && o.r.body.error === 'production_long_only' && /Long-only/.test(o.r.body.message) && o.n === 0 && o.w === 0, [o.r.code, o.r.body, o.n]); }
{ const o = await G({ ...SH, contentFormat: undefined, contentType: 'Short Video' }); check('generate: a Short identified only by its content type is refused too', o.r.code === 409 && o.n === 0); }
{ const o = await G(LG); check('generate: an SRV Studio Long is unchanged (reaches the model)', o.r.code !== 409 && o.n >= 1, [o.r.code, o.n]); }
{ const o = await G({ ...LG, contentType: 'Short' }); check('generate: an explicit Long format is never blocked because the free text says Short', o.r.code !== 409 && o.n >= 1); }
{ const o = await G({ ...SH, engine: 'SRV Farsi', mood: 'Female Voice — Romantic' }); check('generate: Silk Road Voices Shorts are untouched (policy is Studio-only)', o.r.code !== 409 && o.n >= 1, [o.r.code, o.n]); }
{ const o = await G({ ...SH, engine: 'NextWave', mood: 'Finance' }); check('generate: other engines are untouched', o.r.code !== 409); }
set(BOTH); { const o = await G(SH); check('single source of truth: when the production configuration lists "short" again the generation gate follows it (no second switch to change)', o.r.code !== 409 && o.n >= 1, [o.r.code, o.n]); }
set(undefined); { const o = await G(SH); check('missing configuration row → refused (policy default)', o.r.code === 409 && o.n === 0); }
{ const fetch0 = globalThis.fetch; globalThis.fetch = async (u, ...r) => (/srv_studio_v2_production/.test(String(u)) ? { ok: false, status: 500, json: async () => ({}), text: async () => '' } : fetch0(u, ...r)); const o = await G(SH); globalThis.fetch = fetch0; check('configuration read fails (database error) → refused (fails closed to the policy)', o.r.code === 409 && o.n === 0); }
/* api/ops.js generate_package (the Factory path) */
set(LONG_ONLY);
{ const o = await O({ engineId: 'srv_english', mode: 'Female — Emotional', contentFormat: 'short' }); check('ops generate_package: an srv_english Short is refused (409) with no model call', o.r.code === 409 && o.r.body.error === 'production_long_only' && o.n === 0, [o.r.code, o.n]); }
{ const o = await O({ engineId: 'srv_english', mode: 'Female — Emotional', contentFormat: 'long' }); check('ops generate_package: an srv_english Long is unchanged', o.r.code !== 409, o.r.code); }
{ const o = await O({ engineId: 'srv_farsi', mode: 'Female Voice — Romantic', contentFormat: 'short' }); check('ops generate_package: srv_farsi Shorts are unchanged', o.r.code !== 409, o.r.code); }
/* preservation */
{ world.writes = []; await G(SH); check('preservation: a refused Short writes nothing (historical Short packages and videos are never read, changed or deleted)', world.writes.length === 0); }
{ const src = fs.readFileSync(repo + '/lib/srvStudioPolicy.mjs', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'); check('preservation: the policy library only reads one configuration row (no package, video or schedule access)', !/packages|youtube_videos|sbPatch|sbInsert|method: 'POST'|method: 'DELETE'|method: 'PATCH'/.test(src)); }
/* client */
{ const html = fs.readFileSync(repo + '/public/index.html', 'utf8');
  check('client: the policy constant exists and the Studio "create Short" action refuses and explains', /const SRV_STUDIO_LONG_ONLY=true/.test(html) && /async function _srvEnglishV2CreatePromoShort\(taskId\)\{[\s\S]{0,400}SRV_STUDIO_LONG_ONLY\)\{say\('SRV Studio is Long-only/.test(html));
  check('client: the "create Short" button is disabled for Studio and the generation error shows the server\'s plain-language message', /_srvEnglishV2CreatePromoShort\('\$\{T\}'\)" \$\{SRV_STUDIO_LONG_ONLY\?'disabled/.test(html) && /throw new Error\(data\.message\|\|data\.error\|\|'Generation failed'\)/.test(html)); }
console.log = log; cleanup(); done();
