// Synthetic TEST songs for the full-duration Mix render (self-generated, no third-party material): a short melody over a bass line, each in its own key/tempo, with a real fade-in/out and ~0.3 s of
// lead silence like a rendered song. 22.05 kHz mono 16-bit WAV. node make-songs.mjs <outDir> [count] [baseSec]
import fs from 'node:fs'; import path from 'node:path';
export function makeSong(i, sec) {
  const sr = 22050, n = Math.round(sec * sr), out = Buffer.alloc(44 + n * 2); const roots = [196, 220, 233.08, 246.94, 261.63, 293.66, 311.13, 329.63]; const root = roots[i % roots.length]; const bpm = 84 + (i % 5) * 9; const beat = 60 / bpm;
  const scale = [0, 2, 3, 5, 7, 8, 10, 12]; let seed = 1234 + i * 77; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const melody = Array.from({ length: 64 }, () => scale[Math.floor(rnd() * scale.length)]);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVE', 8); out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(sr, 24); out.writeUInt32LE(sr * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let k = 0; k < n; k++) {
    const t = k / sr; let v = 0; if (t > 0.3) {
      const b = Math.floor((t - 0.3) / beat), ph = ((t - 0.3) / beat) % 1; const note = melody[b % melody.length]; const f = root * 2 ** (note / 12); const env = Math.exp(-ph * 2.2) * (ph < 0.02 ? ph / 0.02 : 1);
      v += 0.30 * env * (Math.sin(2 * Math.PI * f * t + 0.4 * Math.sin(2 * Math.PI * 5 * t)) + 0.35 * Math.sin(4 * Math.PI * f * t));
      const bn = scale[(Math.floor(b / 4) * 3) % 5]; v += 0.22 * Math.sin(2 * Math.PI * (root / 2) * 2 ** (bn / 12) * t) * (0.6 + 0.4 * Math.exp(-ph * 1.5));
      v += 0.05 * Math.sin(2 * Math.PI * (root * 1.5) * t);
    }
    const fade = Math.min(1, (t - 0.3) / 0.6, (sec - t) / 3.5); v *= Math.max(0, fade);
    out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 24000))), 44 + k * 2);
  }
  return out;
}
if (process.argv[1] && process.argv[1].endsWith('make-songs.mjs')) { const dir = process.argv[2]; const count = Number(process.argv[3] || 8), base = Number(process.argv[4] || 200); fs.mkdirSync(dir, { recursive: true }); for (let i = 0; i < count; i++) { const f = path.join(dir, `song-${i}.wav`); fs.writeFileSync(f, makeSong(i, base + 3 * i)); console.log('wrote', f, base + 3 * i, 's'); } }
