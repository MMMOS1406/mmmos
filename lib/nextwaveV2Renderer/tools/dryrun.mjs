// Controlled NON-PUBLISHING dry-run of the integrated V2 route. No deploy, no upload, no publish.
//   node lib/nextwaveV2Renderer/tools/dryrun.mjs <short|long> <script.txt> <outDir> [--tts=dev|stub]
// Brain: the real guarded semantic Brain, replaying RECORDED model responses (no live model call unless the recording lacks one
//        and --live is passed). Narration: local dev TTS (`say`) with proportional alignment (vendor-independent; $0).
import fs from 'node:fs';
import { deps as baseDeps } from '../../../test_nextwave_v2_storyboard_brain.mjs';
import { nextwaveV2BuildStoryboardSemantic } from '../../nextwaveV2SemanticStoryboard.mjs';
import { makeRecordingCaller } from '../../nextwaveV2SemanticProposer.mjs';
import { devNarration, audioDuration } from '../narration.mjs';
import { loadHostPoses } from '../assets.mjs';
import { loadBench } from '../props3.mjs';
import { startRoute, renderChunk, finalizeVideo, probe, makeThumbnail } from '../production/route.mjs';
import { STYLE } from '../core.mjs';

const [formatName, scriptPath, outDir, ...flags] = process.argv.slice(2);
const FF = process.env.FFMPEG_PATH || (await import('@ffmpeg-installer/ffmpeg')).default.path;
const script = fs.readFileSync(scriptPath, 'utf8').trim(); fs.mkdirSync(outDir, { recursive: true });
const store = new Map(); for (const f of ['proofs.json', 'production_dryrun.json']) { const p = new URL('../../../nextwave_v2_storyboard_eval/recordings/' + f, import.meta.url).pathname; if (fs.existsSync(p)) Object.entries(JSON.parse(fs.readFileSync(p, 'utf8'))).forEach(([k, v]) => store.set(k, v)); }
const tally = { live_calls: 0, replayed: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
const calls = { narrate: 0, chunk: 0 };
const route = await startRoute({
  script, formatName, title: flags.find((f) => f.startsWith('--title='))?.slice(8) || '',
  deps: {
    buildStoryboard: (s) => nextwaveV2BuildStoryboardSemantic(s, { ...baseDeps, callModel: makeRecordingCaller({ live: null, store, tally }) }),
    loadPoses: loadHostPoses, loadBench,
    narrate: async (text) => { calls.narrate++; devNarration({ text, ffmpeg: FF, audioOut: outDir + '/narration.mp3', alignOut: outDir + '/alignment.json' }); const a = JSON.parse(fs.readFileSync(outDir + '/alignment.json', 'utf8')); return { ok: true, alignment: a.alignment, audioPath: outDir + '/narration.mp3' }; },
  },
});
const summary = { status: route.status, gate: route.gate, stages: route.stages, vendor: route.vendor, model_tally: tally, narrate_calls: calls.narrate };
if (route.status !== 'planned') { fs.writeFileSync(outDir + '/route.json', JSON.stringify(summary, null, 1)); console.log(JSON.stringify(summary)); process.exit(0); }
const { C, format, bench } = route._compiled; const chunkPaths = [];
for (const ch of route.chunks) { chunkPaths.push(await renderChunk({ C, format, chunk: ch, outPath: `${outDir}/chunk_${String(ch.index).padStart(3, '0')}.mp4`, ffmpegPath: FF })); calls.chunk++; process.stdout.write(`\rchunk ${ch.index + 1}/${route.chunks.length}`); }
await finalizeVideo({ chunkPaths, audioPath: outDir + '/narration.mp3', outPath: outDir + '/final.mp4', ffmpegPath: FF, workDir: outDir, duration: route.duration_sec });
fs.writeFileSync(outDir + '/thumbnail.png', makeThumbnail({ storyboard: route.storyboard, formatName, title: route.title || 'Your money, verified', bench }));
const pr = await probe(FF, outDir + '/final.mp4'); const audioDur = audioDuration(FF, outDir + '/narration.mp3');
Object.assign(summary, { duration_planned: route.duration_sec, chunks: route.chunks.length, scenes: route.timeline, qc_pre_render: { ok: route.qc_pre_render.ok, numbers: route.qc_pre_render.numbers, idle_windows: route.qc_pre_render.idle_windows, captions: route.qc_pre_render.captions, occupancy: route.qc_pre_render.occupancy }, encode: pr, audio_duration: +audioDur.toFixed(2), asset_plan: { bank_reused: route.asset_plan.bank_reused, generated: route.asset_plan.generate.length, est_ideogram_usd: route.asset_plan.est_ideogram_usd } });
fs.writeFileSync(outDir + '/route.json', JSON.stringify(summary, null, 1)); console.log('\n' + JSON.stringify({ status: summary.status, encode: pr, scenes: route.timeline.map((s) => `${s.id}:${s.treatment}`).join(' ') }));
