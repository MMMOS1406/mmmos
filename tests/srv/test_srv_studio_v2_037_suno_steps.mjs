// SRV-STUDIO-V2-037 — VA Suno steps (SRV Studio only): MP3 check rules, approved-text copy wiring, and isolation
// (the generic SRV English build markup only gains two invisible markers; SRV Farsi and the shared copy helper untouched).
//   node tests/srv/test_srv_studio_v2_037_suno_steps.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = []; let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const H = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8');
let MAIN = null; try { MAIN = execFileSync('git', ['-C', repo, 'show', 'origin/main:public/index.html'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (_) {}

// ── MP3 check rules (the exact block from index.html) ──
const blk = H.slice(H.indexOf('// <srv2-mp3-check>'), H.indexOf('// </srv2-mp3-check>'));
const ctx = {}; vm.createContext(ctx); vm.runInContext(blk + '\nthis.srv2Mp3Check=srv2Mp3Check;this.L=SRV2_MP3_LIMITS;this.clock=srv2Clock;', ctx);
const C = (o) => ctx.srv2Mp3Check(Object.assign({ name: 'song.mp3', type: 'audio/mpeg', size: 5e6, durationSec: 205, isLong: true }, o));
ok('a normal Long MP3 (3:25, 5 MB) is accepted with no warning', C({}).ok && !C({}).warnings.length && C({}).durationSec === 205);
ok('a Long of 4:40 is accepted with a "listen before you build" warning', C({ durationSec: 280 }).ok && /longer or shorter than usual/.test(C({ durationSec: 280 }).warnings[0]));
ok('a 1:50 clip is refused for a Long (wrong song / a Short)', !C({ durationSec: 110 }).ok && /must be 2:00–7:00/.test(C({ durationSec: 110 }).errors[0]));
ok('a 30-minute file (e.g. a mix) is refused for a Long', !C({ durationSec: 1800 }).ok);
ok('a non-MP3 file is refused', !C({ name: 'song.wav', type: 'audio/wav' }).ok && /not an MP3/.test(C({ name: 'song.wav', type: 'audio/wav' }).errors[0]));
ok('an MP3 named without extension but typed audio/mpeg is accepted', C({ name: 'download', type: 'audio/mpeg' }).ok);
ok('a tiny file and an oversized file are refused', !C({ size: 50 * 1024 }).ok && !C({ size: 60 * 1048576 }).ok);
ok('unreadable audio (no duration) is refused', !C({ durationSec: null }).ok && /could not be read/.test(C({ durationSec: null }).errors[0]));
ok('a Short song uses the Short range (30 s ok, 1:50 refused)', C({ isLong: false, durationSec: 30 }).ok && !C({ isLong: false, durationSec: 110 }).ok);
ok('clock formatting', ctx.clock(205) === '3:25' && ctx.clock(59.6) === '1:00');

// ── wiring ──
ok('V2 build stage swaps in the Suno steps only when V2 is on, and never for a promotional Short', /if\(_v2On&&stage==='build'&&pkg&&!_srvEnglishV2TaskIsLong\(task\)&&_srvEnglishV2IsPromoPkg\(pkg\)\)stageContent=[^\n]*\n  else if\(_v2On&&stage==='build'&&pkg\)stageContent=_srvEnglishV2SwapSunoSteps\(stageContent,task,pkg,taskId\);/.test(H));
ok('exactly one pair of markers in the generic SRV English build markup, emitted only when V2 is on (V2-OFF HTML byte-identical)', H.split("${_srvStudioV2On()?'<!--srv-suno-steps-->':''}<div").length === 2 && H.split("</div>${_srvStudioV2On()?'<!--/srv-suno-steps-->':''}").length === 2);
const fnBody = (src, name) => { let i = src.indexOf('\nfunction ' + name + '('); if (i < 0) i = src.indexOf('\nasync function ' + name + '('); if (i < 0) return null; const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };
const approvedText = fnBody(H, '_srvEnglishV2ApprovedText');
ok('copy uses this format\'s exact field (via _srvEnglishV2BuildKeys) — no fallback to the other format', /_srvEnglishV2BuildKeys\(task,pkg\)/.test(approvedText) && !/\|\|pkg\.(short)?(lyrics|sunoPrompt|Lyrics|SunoPrompt)/.test(approvedText));
const copyFn = fnBody(H, '_srvEnglishV2CopyApproved');
ok('copy is refused when the text changed after approval', /if\(!a\.approved\)\{say\('⚠ The text changed after approval/.test(copyFn));
const accept = H.slice(H.indexOf('async function _srvEnglishV2AcceptMp3('), H.indexOf('function _srvEnglishV2Mp3Drop('));
ok('a refused MP3 is removed from the build input; an accepted one is stored in the same place Build reads (_srvAudioData)', /if\(!chk\.ok\)\{delete _srvAudioData\[pkgId\]/.test(accept) && /_srvAudioData\[pkgId\]=\{file,name:file\.name,sizeMB:/.test(accept));
const v2fns = H.slice(H.indexOf('// ── SRV-STUDIO-V2-037: Suno steps'), H.indexOf('function _srvEnglishV2PromoBuildHtml('));
ok('the new code never calls Suno or any network (manual workflow only)', !/fetch\(|XMLHttpRequest|api\.suno|_publishAuthedFetch|supabase/i.test(v2fns));

// ── isolation vs main ──
if (MAIN) {
  const diffLines = (a, b) => { const A = a.split('\n'), B = new Set(b.split('\n')); return A.filter((l) => !B.has(l)); };
  const added = diffLines(H, MAIN), removed = diffLines(MAIN, H);
  ok('nothing removed from index.html (the 2 marker lines are edits of existing lines)', removed.length >= 1 && removed.length <= 2 && removed.every((l) => /Generate the song in Suno|^      <\/div>$/.test(l)), removed.slice(0, 3));
  const outside = added.filter((l) => !v2fns.includes(l));
  ok('outside the new SRV Studio block, only 2 existing lines gained a V2-only marker and 1 V2 swap line was added; nothing else', outside.length === 3 && outside.some((l) => l.includes("${_srvStudioV2On()?'<!--srv-suno-steps-->':''}<div")) && outside.some((l) => l.includes("</div>${_srvStudioV2On()?'<!--/srv-suno-steps-->':''}")) && outside.some((l) => /_srvEnglishV2SwapSunoSteps\(stageContent/.test(l)), outside);
  for (const name of ['_srvCopyBuildField', 'srvLoadMp3', 'renderSRVFarsiLifecycleCard', '_srvEnglishV2Build', '_srvUploadToStorage']) ok('unchanged from main: ' + name, fnBody(H, name) !== null && fnBody(H, name) === fnBody(MAIN, name));
  const changedFiles = execFileSync('git', ['-C', repo, 'diff', '--name-only', 'origin/main'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  ok('only SRV Studio files changed (index.html + SRV Studio tests/docs)', changedFiles.every((f) => f === 'public/index.html' || /^tests\/srv\/(test_srv_studio_v2_0(33|37)|studio-v2-preview\/headless-037)/.test(f) || /^docs\/srv-studio-v2\//.test(f)), changedFiles);
} else ok('origin/main available for the isolation checks', false);
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
