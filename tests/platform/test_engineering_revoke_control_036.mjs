// MMMOS-R2-EXECUTION-036 (H7) — Engineering Review "Unused agent authorizations" control.
// Loads the real helpers from public/index.html. Run: node tests/platform/test_engineering_revoke_control_036.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const grab = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0; for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); } };
const { _engExpiredAuthorizations, _engExpiredAuthSection } = new Function(['escHTML', '_engAttr', '_engExpiredAuthorizations', '_engExpiredAuthSection'].map(grab).join('\n') + '; return { _engExpiredAuthorizations, _engExpiredAuthSection };')();
const day = 86400e3, iso = (ms) => new Date(Date.now() + ms).toISOString();
const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const tasks = [
  { id: id(1), status: 'done', agent_authorized_at: '2026-08-18T16:54:47Z', lease_expires_at: '2026-08-18T17:00:00Z', agent_claimed_by: 'cowork-engineering-agent', problem: 'done task', affected_engine: 'MMMOS' },
  { id: id(2), status: 'open', agent_authorized_at: '2026-08-20T04:23:34Z', problem: 'never claimed', affected_engine: 'Production Pipeline' },
  { id: id(3), status: 'open', agent_authorized_at: iso(-30 * day), lease_expires_at: iso(+3600e3), problem: 'live lease' },
  { id: id(4), status: 'open', agent_authorized_at: iso(-2 * day), problem: 'recent' },
  { id: id(5), status: 'open', agent_authorized_at: '2026-08-25T20:00:00Z', agent_authorization_revoked_at: '2026-09-01T00:00:00Z', problem: 'already revoked' },
  { id: id(6), status: 'open', problem: 'never authorized' },
  { id: id(2), status: 'open', agent_authorized_at: '2026-08-20T04:23:34Z', problem: 'duplicate from another list' },
  { id: id(7), status: 'open', agent_authorized_at: '2026-08-24T00:00:00Z', problem: '<img src=x onerror=alert(1)>', affected_engine: '"><b>' },
];
const out = _engExpiredAuthorizations(tasks).map(t => t.id);
ok('lists old, unrevoked authorizations with no live lease (done or open)', JSON.stringify(out) === JSON.stringify([id(1), id(2), id(7)]), JSON.stringify(out));
ok('excludes a live lease, a recent grant, an already-revoked grant and unauthorized tasks', ![3, 4, 5, 6].some(n => out.includes(id(n))));
ok('no duplicates when a task appears in two lists', out.filter(x => x === id(2)).length === 1);
const sec = _engExpiredAuthSection(_engExpiredAuthorizations(tasks));
ok('section shows a REVOKE ALL button with the exact ids', sec.includes('REVOKE ALL 3') && sec.includes(`data-ids="${id(1)},${id(2)},${id(7)}"`));
ok('task text is escaped', !sec.includes('<img') && !sec.includes('"><b>') && sec.includes('&lt;img'));
ok('empty list renders nothing', _engExpiredAuthSection([]) === '');
const rv = grab('_engRevokeAuthorizations');
ok('revoke uses the existing CEO-gated action with the CEO session, one id at a time', /_ceoAuthedFetch\('\/api\/ops\?action=engineering_task_ceo_revoke_agent_authorization',\{id\}\)/.test(rv));
ok('revoke asks for confirmation listing the tasks', /confirm\(`Revoke agent authorization on/.test(rv));
ok('revoke ignores anything that is not a task id', /\^\[0-9a-f-\]\{36\}\$/.test(rv));
ok('Engineering Review loads the list and renders the section', html.includes('const expiredAuth=_engExpiredAuthorizations(') && html.includes('${_engExpiredAuthSection((_ebV2Cache[ck]?.expiredAuth)||[])}'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
