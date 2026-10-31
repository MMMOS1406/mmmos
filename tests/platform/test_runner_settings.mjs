// Runner isolation settings test (030): checks the runner-only Claude Code settings file.
// Run: node tests/platform/test_runner_settings.mjs
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'engineering-runner', 'claude-settings.runner.json');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x ? '  ' + x : ''}`); };
const src = JSON.parse(readFileSync(SRC, 'utf8'));
const deny = src.permissions?.deny || [];
const must = ['Bash(vercel:*)', 'Bash(gh:*)', 'Bash(git push --no-verify:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)',
  'Bash(git push --delete:*)', 'Bash(git -c:*)', 'Bash(git config:*)', 'Bash(git credential:*)', 'Bash(launchctl:*)',
  'Bash(curl:*)', 'Bash(security:*)', 'Bash(supabase:*)',
  'Read(~/MMM/engineering-agent/.mmmos_worker_credential)', 'Read(~/.config/gh/**)', 'Read(~/.vercel/**)',
  'Edit(~/mmm-static/**)', 'Write(~/mmm-static/**)', 'Edit(~/mmmos-runner/.claude/**)', 'Edit(~/.claude/**)'];
for (const r of must) ok(`deny rule present: ${r}`, deny.includes(r));
const badAbs = deny.filter(r => /^(Read|Edit|Write)\(\/[^/]/.test(r));
ok('no file rule uses a single leading "/" (that would be relative to the settings folder)', badAbs.length === 0, badAbs.join(', '));
ok('bypass-permissions mode is disabled', src.permissions?.disableBypassPermissionsMode === 'disable');
const sb = src.sandbox || {};
ok('sandbox enabled', sb.enabled === true);
ok('sandbox must be available or the session refuses to run', sb.failIfUnavailable === true);
ok('no unsandboxed escape hatch', sb.allowUnsandboxedCommands === false);
ok('network allowlist is exactly github.com (no api.github.com, no vercel, no supabase)',
  JSON.stringify(sb.network?.allowedDomains) === JSON.stringify(['github.com']));
ok('runner cannot write its own settings folder', (sb.filesystem?.denyWrite || []).includes('~/mmmos-runner/.claude'));
ok('runner cannot write the clone git config or hooks', ['~/mmmos-runner/repo/.git/config', '~/mmmos-runner/repo/.git/hooks'].every(p => (sb.filesystem?.denyWrite || []).includes(p)));
ok('worker credential is unreadable from the shell', (sb.filesystem?.denyRead || []).includes('~/MMM/engineering-agent/.mmmos_worker_credential'));
// Installed copy (only on the runner Mac): must equal the repo file minus the _comment.
const installed = join(homedir(), 'mmmos-runner', '.claude', 'settings.json');
if (existsSync(installed)) {
  const want = { ...src }; delete want._comment;
  ok('installed ~/mmmos-runner/.claude/settings.json matches the repo file', JSON.stringify(JSON.parse(readFileSync(installed, 'utf8'))) === JSON.stringify(want));
} else console.log('SKIP installed copy check (no ~/mmmos-runner on this machine)');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
