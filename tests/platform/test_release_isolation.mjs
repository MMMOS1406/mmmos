// MMMOS platform — release isolation tests (validation A, B, C).
// Runs the EXACT buildCommand from vercel.json (the release guard) under each deploy scenario, and uses a
// synthetic git repo to show why direct feature-branch production deploys roll back accepted work.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const guard = vercel.buildCommand;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x = '') => { c ? pass++ : fail++; out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const build = env => spawnSync('sh', ['-c', guard], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

ok('guard present in vercel.json buildCommand', typeof guard === 'string' && guard.includes('VERCEL_GIT_COMMIT_REF'));
ok('guard fits Vercel project Build Command setting (<=256 chars)', guard.length <= 256, `len=${guard.length}`);
ok('git deployments enabled (main -> production, branches -> preview)', vercel.git && vercel.git.deploymentEnabled === true);

const A = build({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'srv-farsi/va-artist-format-select' });
ok('A: SRV feature branch production build blocked', A.status === 1 && /RELEASE GUARD/.test(A.stdout), A.stdout.trim());
const B = build({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'nextwave-v2-live-integration' });
ok('B: NextWave feature branch production build blocked', B.status === 1 && /RELEASE GUARD/.test(B.stdout), B.stdout.trim());
const U = build({ VERCEL_ENV: 'production' });
ok('fail-closed: production build with unknown branch (e.g. CLI upload) blocked', U.status === 1, U.stdout.trim());
ok('main production build allowed', build({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }).status === 0);
ok('feature branch PREVIEW allowed (develop/preview/validate)', build({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'srv-farsi/x' }).status === 0
  && build({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'nextwave-v2-live-integration' }).status === 0);
ok('local/dev build unaffected', build({}).status === 0);

// C. Synthetic repo: production from main preserves accepted changes from multiple businesses
const dir = mkdtempSync(join(tmpdir(), 'mmm-release-'));
const git = c => execSync(`git -c user.name=t -c user.email=t@t -c commit.gpgsign=false ${c}`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fileAt = (ref, f) => { try { return git(`show ${ref}:${f}`); } catch { return null; } };
try {
  git('init -q -b main');
  writeFileSync(join(dir, 'app.txt'), 'shell\n'); git('add -A'); git('commit -q -m base');
  git('checkout -q -b nextwave-feature'); writeFileSync(join(dir, 'nextwave.txt'), 'nw v2\n'); git('add -A'); git('commit -q -m nw');
  git('checkout -q main'); git('checkout -q -b srv-feature'); writeFileSync(join(dir, 'srv.txt'), 'srv selector\n'); git('add -A'); git('commit -q -m srv');
  git('checkout -q main'); git('merge -q --no-ff srv-feature -m "accept SRV"');
  ok('C: accepted SRV change is on main', fileAt('main', 'srv.txt') === 'srv selector');
  ok('C: defect reproduced — deploying the NextWave branch directly would drop the accepted SRV change',
    fileAt('nextwave-feature', 'srv.txt') === null);
  git('merge -q --no-ff nextwave-feature -m "accept NextWave"');
  ok('C: production from main carries BOTH businesses\' accepted changes',
    fileAt('main', 'srv.txt') === 'srv selector' && fileAt('main', 'nextwave.txt') === 'nw v2');
  ok('C: the only production-eligible ref (main) contains every accepted business commit',
    ['srv-feature', 'nextwave-feature'].every(b => spawnSync('git', ['merge-base', '--is-ancestor', b, 'main'], { cwd: dir }).status === 0));
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(out.join('\n')); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
