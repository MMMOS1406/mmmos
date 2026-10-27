#!/usr/bin/env node
// MMMOS Engineering Runner — pre-commit / pre-push guard (R2).
// The runner MUST run this before every commit and before every push:
//   node tools/engineering-runner/runner-guard.mjs --prefixes "docs/platform/,tests/platform/" [--shared "api/ops.js"]
// It refuses (exit 1) unless ALL of these hold:
//   1. the current directory is a git worktree under ~/mmm-static-wt/runner/  (never ~/mmm-static,
//      whose public/ folder is watched by the local auto-deploy job)
//   2. the current branch starts with runner/ and is not main
//   3. every file changed against origin/main (committed, staged, unstaged or untracked) is inside
//      the task's allowed prefixes / shared files, and none is on the always-denied list
// The server re-checks the same rule when the PR is submitted; this guard stops mistakes earlier.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

const DENIED = ['.auto-deploy.sh', '.auto-deploy.plist', '.last-deploy-md5', '.pause-deploy', 'vercel.json',
  'package.json', 'package-lock.json', '.gitignore', 'migrations/', '.github/', 'node_modules/', '.vercel/', '.env'];
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? String(args[i + 1] || '') : ''; };
const list = (s) => s.split(',').map(x => x.trim()).filter(Boolean);
const prefixes = list(opt('--prefixes'));
const shared = list(opt('--shared'));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const problems = [];

const runnerRoot = join(homedir(), 'mmm-static-wt', 'runner') + sep;
const prodCheckout = realpathSync(join(homedir(), 'mmm-static')) + sep;
const here = realpathSync(process.cwd()) + sep;
if (!here.startsWith(runnerRoot)) problems.push(`not inside a runner worktree (${runnerRoot})`);
if (here.startsWith(prodCheckout)) problems.push('inside ~/mmm-static — the production working directory is never used by the runner');
let top = '';
try { top = realpathSync(git('rev-parse', '--show-toplevel')) + sep; } catch { problems.push('not a git checkout'); }
if (top && top.startsWith(prodCheckout)) problems.push('git top-level is ~/mmm-static');
let branch = '';
try { branch = git('rev-parse', '--abbrev-ref', 'HEAD'); } catch {}
if (!/^runner\/[A-Za-z0-9._-]+$/.test(branch)) problems.push(`branch "${branch}" is not a runner/ branch`);
if (!prefixes.length && !shared.length) problems.push('no allowed prefixes given (pass --prefixes from read_runner_scope)');

let files = [];
if (!problems.length) {
  const out = [
    git('diff', '--name-only', 'origin/main...HEAD'),
    git('diff', '--name-only', '--cached'),
    git('diff', '--name-only'),
    git('ls-files', '--others', '--exclude-standard'),
  ].join('\n');
  files = [...new Set(out.split('\n').map(s => s.trim()).filter(Boolean))];
  for (const f of files) {
    if (f.startsWith('/') || f.includes('..')) { problems.push(`unsafe path: ${f}`); continue; }
    if (DENIED.some(d => f === d || f.startsWith(d.endsWith('/') ? d : d + '/') || (!d.endsWith('/') && f.startsWith(d)))) { problems.push(`denied file: ${f}`); continue; }
    if (!(shared.includes(f) || prefixes.some(p => f.startsWith(p)))) problems.push(`outside allowed folders: ${f}`);
  }
}
if (problems.length) {
  console.error('RUNNER GUARD: BLOCKED');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`RUNNER GUARD: OK — branch ${branch}, ${files.length} changed file(s), all inside the allowed folders`);
