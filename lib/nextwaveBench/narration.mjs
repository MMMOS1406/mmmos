// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: narration. ElevenLabs with-timestamps (same voice/model as the
// production pipeline), plus a DEV-ONLY approximate alignment so layout/captions can be built before spend.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadEnvFile(path) {
  const out = {}; if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return out;
}
// Same normalisation the production pipeline applies before speech ($1.2M -> words is NOT needed here: digits are read correctly).
export async function synthesizeElevenLabs({ text, voiceId, apiKey, audioOut, alignOut }) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
    method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`elevenlabs_error_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  if (!data.audio_base64 || !data.alignment) throw new Error('elevenlabs_missing_fields');
  mkdirSync(dirname(audioOut), { recursive: true });
  writeFileSync(audioOut, Buffer.from(data.audio_base64, 'base64')); writeFileSync(alignOut, JSON.stringify({ text, alignment: data.alignment }));
  return { audioOut, alignOut, chars: text.length };
}
export function audioDuration(ffmpeg, path) {
  const r = spawnSync(ffmpeg, ['-i', path, '-f', 'null', '-'], { encoding: 'utf8' }); const m = [...String(r.stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  if (!m) throw new Error('cannot read audio duration'); return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
}

// DEV ONLY: macOS `say` audio + character times proportional to the audio length (weights: letters 1, digits 1.6, punctuation pause).
export function devNarration({ text, ffmpeg, ffprobe, audioOut, alignOut, voice = 'Daniel', rate = 178 }) {
  mkdirSync(dirname(audioOut), { recursive: true });
  const aiff = audioOut.replace(/\.\w+$/, '.aiff');
  execFileSync('say', ['-v', voice, '-r', String(rate), '-o', aiff, text]);
  execFileSync(ffmpeg, ['-y', '-i', aiff, '-b:a', '192k', audioOut], { stdio: 'ignore' });
  const dur = audioDuration(ffmpeg, audioOut);
  const w = [...text].map((ch) => (/[.!?]/.test(ch) ? 6 : /[,;:—]/.test(ch) ? 3 : ch === ' ' ? 0.6 : /\d|\$|%/.test(ch) ? 1.7 : 1));
  const total = w.reduce((a, b) => a + b, 0); let acc = 0; const s = [], e = [];
  w.forEach((x) => { s.push((acc / total) * (dur - 0.3) + 0.1); acc += x; e.push((acc / total) * (dur - 0.3) + 0.1); });
  writeFileSync(alignOut, JSON.stringify({ text, alignment: { characters: [...text], character_start_times_seconds: s, character_end_times_seconds: e }, dev: true }));
  return { audioOut, alignOut, dur };
}
