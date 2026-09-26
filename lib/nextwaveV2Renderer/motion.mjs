// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: motion + camera + pacing.
// Motion must EXPLAIN (a value grows, an object is introduced, attention moves), never decorate.
import { ease, clamp01, lerp } from './core.mjs';

// ── CAMERA ─────────────────────────────────────────────────────────────────────
// keys: [{t, x, y, z, ease?}] — focus point (world coords) and zoom; eased between consecutive keys.
// A "focus-region transition" is just two keys; holds are two keys with the same value.
export function makeCamera(keys, { w, h }) {
  const ks = keys.slice().sort((a, b) => a.t - b.t);
  return (t) => {
    if (t <= ks[0].t) return ks[0];
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1];
      if (t >= a.t && t <= b.t) { const p = (ease[b.ease || 'inOutCubic'])(clamp01((t - a.t) / Math.max(1e-6, b.t - a.t))); return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: lerp(a.z, b.z, p) }; }
    }
    return ks[ks.length - 1];
  };
}
// Apply a camera state to a world layer: focus point ends up at the frame centre (or an offset anchor).
export function applyCamera(g, cam, { w, h, anchorX = 0.5, anchorY = 0.5 }) {
  g.translate(w * anchorX, h * anchorY); g.scale(cam.z, cam.z); g.translate(-cam.x, -cam.y);
}
// slow "breathing" drift so a held shot is never dead-still (sub-perceptual, never a distraction)
export const drift = (t, amp = 6, period = 9) => ({ dx: Math.sin((t / period) * Math.PI * 2) * amp, dy: Math.cos((t / (period * 1.3)) * Math.PI * 2) * amp * 0.6 });

// ── PACING ─────────────────────────────────────────────────────────────────────
// Visual events are anchored to SPOKEN words (from narration alignment), then guarded by dwell rules so
// the viewer always has time to read what appeared. No "cut every N seconds".
export function anchorTimes(words, anchors) {
  const out = {};
  for (const [name, spec] of Object.entries(anchors)) {
    const pat = typeof spec === 'string' ? { text: spec } : spec;
    const from = pat.after != null ? (out[pat.after] ?? 0) : 0;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9$%.]/g, '');
    const want = String(pat.text).split(/\s+/).map(norm).filter(Boolean);
    let found = null;
    for (let i = 0; i < words.length && !found; i++) {
      if (words[i].start < from - 1e-6) continue;
      let ok = true; for (let k = 0; k < want.length; k++) { if (!words[i + k] || !norm(words[i + k].w).includes(want[k])) { ok = false; break; } }
      if (ok) found = { start: words[i].start, end: words[i + want.length - 1].end };
    }
    if (!found) throw new Error(`anchor "${name}" ("${pat.text}") not found in narration after ${from.toFixed(2)}s`);
    out[name] = pat.at === 'end' ? found.end : found.start; out[name + '_end'] = found.end;
  }
  return out;
}
// minimum time a piece of on-screen content should be held: ~0.30s per word + 0.6s base, numbers count double
export const readingTime = (str) => 0.6 + String(str).split(/\s+/).filter(Boolean).reduce((s, w) => s + (/\d/.test(w) ? 0.5 : 0.28), 0);
// check a storyboard's dwell: returns violations [{scene, need, have}]
export function checkDwell(beats) {
  const v = []; for (let i = 0; i < beats.length; i++) { const b = beats[i]; const next = beats[i + 1]; const end = next ? next.t : b.until; const have = end - b.t; const need = Math.min(readingTime(b.reads || ''), 6); if (b.reads && have + 1e-6 < need) v.push({ beat: b.id, need: +need.toFixed(2), have: +have.toFixed(2) }); }
  return v;
}
