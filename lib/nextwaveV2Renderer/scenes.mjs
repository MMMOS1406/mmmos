// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: scene sequencing, environment transitions, host layer.
import { tw, ease, lerp, P, shadowed } from './core.mjs';
import { makeCamera, applyCamera, drift } from './motion.mjs';

// A scene = { t0, t1, world:{w,h}, camera:[keys], draw(g,t), overlay?(g,t) }.
// The frame shows one scene; at a boundary the next environment PUSHES in (paper-slide) so the change of place is legible.
export function makeSequence({ format, scenes, transition = 0.6 }) {
  const { w: W, h: H } = format;
  const cams = scenes.map((s) => { const cam = makeCamera(s.camera, { w: W, h: H }); const ww = s.world.w, wh = s.world.h; return (t) => { const c = cam(t); const hw = W / (2 * c.z), hh = H / (2 * c.z); return { x: Math.max(hw, Math.min(ww - hw, c.x)), y: Math.max(hh, Math.min(wh - hh, c.y)), z: c.z }; }; });
  const paint = (g, i, t, dx = 0) => {
    const s = scenes[i]; g.save(); g.translate(dx, 0); g.beginPath(); g.rect(0, 0, W, H); g.clip();
    const d = drift(t, 4, 8); const c = cams[i](t); g.save(); applyCamera(g, { x: c.x + d.dx, y: c.y + d.dy, z: c.z }, { w: W, h: H }); s.draw(g, t, c); g.restore();
    if (s.overlay) s.overlay(g, t); g.restore();
  };
  return function draw(g, t) {
    let i = scenes.findIndex((s) => t >= s.t0 && t < s.t1); if (i < 0) i = t < scenes[0].t0 ? 0 : scenes.length - 1;
    const next = scenes[i + 1]; const tt = next ? t - (next.t0 - transition) : -1;
    if (next && tt >= 0) { // transition window: current scene slides out, next slides in
      const p = ease.inOutCubic(Math.min(1, tt / transition)); paint(g, i, t, -p * W); paint(g, i + 1, t, (1 - p) * W);
      g.save(); const x = (1 - p) * W; g.fillStyle = P.gold; g.fillRect(x - 5, 0, 10, H); g.restore();
      const gr = g.createLinearGradient(x - 60, 0, x, 0); gr.addColorStop(0, 'rgba(26,39,68,0)'); gr.addColorStop(1, 'rgba(26,39,68,0.25)'); g.fillStyle = gr; g.fillRect(x - 60, 0, 60, H);
    } else paint(g, i, t);
  };
}

// Host layer: pose timeline with clean cuts + settle, one consistent scale, bottom-anchored (hidden behind a desk/counter).
export function hostLayer(g, t, { poses, timeline, x, bottom, scale, flip = false, enter = 1, bob = 2 }) {
  let idx = 0; timeline.forEach((k, i) => { if (t >= k.t) idx = i; }); const cur = timeline[idx];
  const swap = idx > 0 ? ease.outBack(Math.min(1, (t - cur.t) / 0.28)) : 1; const sp = poses[cur.pose]; if (!sp) return null;
  const cw = sp.w * scale, ch = sp.h * scale;
  g.save(); g.translate(x + (1 - enter) * (flip ? -420 : 420), bottom + Math.sin(t * 1.9) * bob + (1 - swap) * 16); if (flip) g.scale(-1, 1);
  g.drawImage(sp.canvas, -cw / 2, -ch, cw, ch); g.restore();
  return { pose: cur.pose, sp, cw, ch, x, bottom, scale, flip };
}
