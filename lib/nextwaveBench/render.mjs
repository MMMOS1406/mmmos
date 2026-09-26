// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: frame renderer -> ffmpeg (rawvideo pipe).
import { spawn } from 'node:child_process';
import { makeCanvas } from './core.mjs';

// drawFrame(g, t) paints one frame. Audio (mp3/wav) is muxed if given.
export async function renderVideo({ ffmpegPath, format, duration, drawFrame, audioPath, outPath, crf = 18, onProgress, tStart = 0 }) {
  const { w, h, fps } = format; const { c, g } = makeCanvas(w, h);
  const args = ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-'];
  if (audioPath) args.push('-i', audioPath);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (audioPath) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push('-t', duration.toFixed(3), outPath);
  const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => { err += d.toString().slice(-2000); });
  const done = new Promise((res, rej) => { ff.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg failed: ' + err.slice(-600)))));  ff.stdin.on('error', () => {}); });
  const N = Math.round(duration * fps);
  for (let i = 0; i < N; i++) {
    const t = tStart + i / fps; g.clearRect(0, 0, w, h); g.save(); drawFrame(g, t); g.restore();
    const buf = Buffer.from(g.getImageData(0, 0, w, h).data.buffer);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (onProgress && i % 60 === 0) onProgress(i / N);
  }
  ff.stdin.end(); await done; return outPath;
}
// a single still frame at time t (fast QC)
export function stillFrame({ format, drawFrame, t }) { const { c, g } = makeCanvas(format.w, format.h); g.save(); drawFrame(g, t); g.restore(); return c.toBuffer('image/png'); }
