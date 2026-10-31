// Runner pre-push guard test: real git, local bare remote, temporary folders only.
// Run: node tests/platform/test_runner_push_hook.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'engineering-runner', 'hooks');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const base = mkdtempSync(join(tmpdir(), 'runner-hook-'));
const runnerRoot = join(base, 'runner');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, MMMOS_RUNNER_ROOT: runnerRoot } }).trim();
const push = (cwd, ...a) => spawnSync('git', ['push', ...a], { cwd, encoding: 'utf8', env: { ...process.env, MMMOS_RUNNER_ROOT: runnerRoot } });
try {
  const remote = join(base, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const setup = (dir) => {
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    git(dir, 'config', 'core.hooksPath', HOOKS); git(dir, 'remote', 'add', 'origin', remote);
    writeFileSync(join(dir, 'a.txt'), 'a'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'a');
  };
  // A normal checkout outside the runner root: the hook must not interfere.
  const normal = join(base, 'normal'); setup(normal);
  let r = push(normal, 'origin', 'main');
  ok('outside runner worktrees the hook does nothing (push to main allowed)', r.status === 0, r.stderr);
  // A runner worktree.
  const wt = join(runnerRoot, 'task1');
  mkdirSync(runnerRoot, { recursive: true });
  execFileSync('git', ['clone', '-q', remote, wt]);
  git(wt, 'config', 'user.email', 't@t'); git(wt, 'config', 'user.name', 't'); git(wt, 'config', 'core.hooksPath', HOOKS);
  git(wt, 'checkout', '-q', '-b', 'runner/task1');
  writeFileSync(join(wt, 'b.txt'), 'b'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'b');
  r = push(wt, 'origin', 'runner/task1');
  ok('runner branch push is allowed', r.status === 0, r.stderr);
  r = push(wt, 'origin', 'runner/task1:main');
  ok('pushing to main from a runner worktree is refused', r.status !== 0 && /refusing to push to refs\/heads\/main/.test(r.stderr));
  r = push(wt, 'origin', 'runner/task1:feature/x');
  ok('pushing to a non-runner branch is refused', r.status !== 0 && /runner may push only runner/.test(r.stderr));
  r = push(wt, 'origin', ':runner/task1');
  ok('deleting a branch is refused', r.status !== 0 && /refusing to delete/.test(r.stderr));
  git(wt, 'reset', '-q', '--hard', 'HEAD~1'); writeFileSync(join(wt, 'c.txt'), 'c'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'c');
  r = push(wt, '--force', 'origin', 'runner/task1');
  ok('a force (non-fast-forward) push is refused', r.status !== 0 && /force/.test(r.stderr));
  // 030: an environment variable can add enforcement but never remove it.
  git(wt, 'config', 'mmmos.runner', 'true');
  r = spawnSync('git', ['push', 'origin', 'runner/task1:main'], { cwd: wt, encoding: 'utf8', env: { ...process.env, MMMOS_RUNNER_ROOT: join(base, 'nowhere') } });
  ok('pointing MMMOS_RUNNER_ROOT elsewhere does not switch the guard off (marked clone)', r.status !== 0 && /refusing to push/.test(r.stderr), r.stderr);
  // 030: a clone marked mmmos.runner=true is enforced wherever it lives.
  const marked = join(base, 'elsewhere', 'clone');
  mkdirSync(dirname(marked), { recursive: true });
  execFileSync('git', ['clone', '-q', remote, marked]);
  git(marked, 'config', 'user.email', 't@t'); git(marked, 'config', 'user.name', 't'); git(marked, 'config', 'core.hooksPath', HOOKS);
  git(marked, 'config', 'mmmos.runner', 'true');
  writeFileSync(join(marked, 'd.txt'), 'd'); git(marked, 'add', '.'); git(marked, 'commit', '-qm', 'd');
  r = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: marked, encoding: 'utf8', env: { ...process.env, MMMOS_RUNNER_ROOT: '' } });
  ok('a clone marked mmmos.runner=true is guarded outside the runner folder', r.status !== 0 && /refusing to push to refs\/heads\/main/.test(r.stderr), r.stderr);
  r = spawnSync('git', ['push', 'origin', 'HEAD:refs/tags/t1'], { cwd: marked, encoding: 'utf8' });
  ok('pushing a tag from a runner clone is refused', r.status !== 0 && /refs\/tags\/t1/.test(r.stderr), r.stderr);
  // KNOWN LIMIT (documented in RUNNER_ISOLATION.md): client-side hooks can be skipped. These pushes go
  // to a scratch branch of the local test remote; the backstop for main is the GitHub ruleset.
  const skip = (args, ref) => spawnSync('git', [...args, 'origin', `HEAD:refs/heads/${ref}`], { cwd: marked, encoding: 'utf8' }).status === 0;
  ok('known limit: --no-verify skips the client hook (server ruleset is the backstop)', skip(['push', '--no-verify'], 'skip1'));
  ok('known limit: -c core.hooksPath skips the client hook (blocked for the runner by deny rule git -c)', spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', 'HEAD:refs/heads/skip2'], { cwd: marked, encoding: 'utf8' }).status === 0);
  const remoteMain = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  ok('remote main was never changed by the runner worktree', remoteMain === git(normal, 'rev-parse', 'main'));
} finally { rmSync(base, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
