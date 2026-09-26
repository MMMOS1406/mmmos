// NextWave V2 production — automated factual / visual QC on the ACTUAL frame function (what the viewer will see).
// Every check reads real drawn output: text actually painted, pixels actually produced, motion actually present.
import { makeCanvas } from '../core.mjs';
import { captionAudit } from '../qc.mjs';

const NUM_RE = /\$\s?[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?%?/g;
const normNum = (s) => String(s).replace(/[$,\s%]/g, '');

// paint the given times and record every string drawn through fillText/strokeText (captions excluded by the caller via tag)
export function collectDrawnText({ format, drawFrame, times }) {
  const { g } = makeCanvas(format.w, format.h); const rec = []; let cur = null;
  const wrapFn = (name) => { const orig = g[name].bind(g); g[name] = (s, ...a) => { if (cur) cur.push(String(s)); return orig(s, ...a); }; };
  wrapFn('fillText'); wrapFn('strokeText');
  times.forEach((t) => { cur = []; g.clearRect(0, 0, format.w, format.h); g.save(); drawFrame(g, t); g.restore(); rec.push({ t, strings: cur }); });
  return rec;
}
// allowed numeric tokens = numbers present in the verified storyboard (values, params) + registered derivations + the spoken script
export function allowedNumbers({ storyboard, script, derived = [] }) {
  const set = new Set(); const add = (s) => { for (const m of String(s).matchAll(NUM_RE)) set.add(normNum(m[0])); };
  (storyboard.values || []).forEach((v) => { add(v.display); if (typeof v.value === 'number') set.add(String(Math.round(v.value))); });
  (storyboard.scenes || []).forEach((s) => add(JSON.stringify(s.renderer_params || {}))); derived.forEach((d) => add(d.display)); add(script);
  return set;
}
export function numberProvenance({ drawn, allowed }) {
  const unprov = []; let seen = 0;
  drawn.forEach(({ t, strings }) => strings.forEach((s) => { for (const m of s.matchAll(NUM_RE)) { const n = normNum(m[0]); if (n === '' || n === '.') continue; seen++; if (!allowed.has(n)) unprov.push({ t: +t.toFixed(2), token: m[0], in: s.slice(0, 60) }); } }));
  return { numeric_tokens_drawn: seen, unprovenanced: unprov, ok: unprov.length === 0 };
}
// frame-occupancy / hierarchy: edge density of the stage band (excludes the caption + platform zones) at scene midpoints
export function occupancy({ format, drawFrame, scenes }) {
  const { c, g } = makeCanvas(format.w, format.h); const short = format.h > format.w; const out = [];
  const y0 = short ? 210 : 70, y1 = short ? format.h - 420 : format.h - 220; const dw = short ? 108 : 192, dh = short ? 192 : 108;
  scenes.forEach((s) => { const t = (s.start + s.end) / 2 + 0.6 * Math.min(1, (s.end - s.start) / 3); g.clearRect(0, 0, format.w, format.h); g.save(); drawFrame(g, Math.min(t, s.end - 0.1), s); g.restore();
    const { c: c2, g: g2 } = makeCanvas(dw, dh); g2.drawImage(c, 0, y0, format.w, y1 - y0, 0, 0, dw, dh); const d = g2.getImageData(0, 0, dw, dh).data; let e = 0, n = 0;
    const L = (i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    for (let y = 1; y < dh; y++) for (let x = 1; x < dw; x++) { const i = (y * dw + x) * 4; e += Math.abs(L(i) - L(i - 4)) + Math.abs(L(i) - L(i - dw * 4)); n++; }
    out.push({ scene: s.id, treatment: s.treatment, edge_density: +(e / n).toFixed(2) }); });
  return out;
}
// idle detection on the frame function at 2 fps: any 5 s window whose mean frame-to-frame change is ~0 is idle
export function idleWindows({ format, drawFrame, duration, minSeconds = 5 }) {
  const { c, g } = makeCanvas(format.w, format.h); const w = 96, h = Math.round(96 * format.h / format.w); const { c: c2, g: g2 } = makeCanvas(w, h); const frames = [];
  for (let t = 0; t < duration; t += 0.5) { g.clearRect(0, 0, format.w, format.h); g.save(); drawFrame(g, t); g.restore(); g2.drawImage(c, 0, 0, w, h); const d = g2.getImageData(0, 0, w, h).data; const a = new Float32Array(w * h); for (let i = 0; i < a.length; i++) a[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; frames.push(a); }
  const diffs = frames.slice(1).map((f, i) => { let s = 0; for (let k = 0; k < f.length; k++) s += Math.abs(f[k] - frames[i][k]); return s / f.length; });
  const win = Math.round(minSeconds / 0.5); const idle = []; for (let i = 0; i + win <= diffs.length; i++) { const m = diffs.slice(i, i + win).reduce((a, b) => a + b, 0) / win; if (m < 0.35) idle.push({ from: +(i * 0.5).toFixed(1), to: +((i + win) * 0.5).toFixed(1), mean_change: +m.toFixed(2) }); }
  return idle;
}
// low-information intervals: edge density of the EVIDENCE side of the frame (host side excluded) sampled every 0.5 s; a run below the
// threshold is a stretch where nothing but background is on screen
export function lowInfoIntervals({ format, drawFrame, duration, threshold = 10, step = 0.5 }) {
  const short = format.h > format.w; const { c, g } = makeCanvas(format.w, format.h); const sx0 = 0, sw = Math.round(format.w * (short ? 0.7 : 0.66)); const y0 = short ? 210 : 70, y1 = short ? format.h - 420 : format.h - 220; const dw = 96, dh = Math.round(96 * (y1 - y0) / sw);
  const { c: c2, g: g2 } = makeCanvas(dw, dh); const runs = []; let cur = null;
  for (let t = 0.3; t < duration; t += step) { g.clearRect(0, 0, format.w, format.h); g.save(); drawFrame(g, t); g.restore(); g2.drawImage(c, sx0, y0, sw, y1 - y0, 0, 0, dw, dh); const d = g2.getImageData(0, 0, dw, dh).data; let e = 0, n = 0; const L = (i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    for (let y = 1; y < dh; y++) for (let x = 1; x < dw; x++) { const i = (y * dw + x) * 4; e += Math.abs(L(i) - L(i - 4)) + Math.abs(L(i) - L(i - dw * 4)); n++; }
    const dens = e / n; if (dens < threshold) { if (!cur) cur = { from: +t.toFixed(1), to: +t.toFixed(1), min: dens }; cur.to = +(t + step).toFixed(1); cur.min = Math.min(cur.min, dens); } else if (cur) { runs.push(cur); cur = null; } }
  if (cur) runs.push(cur); const longest = runs.reduce((m, r) => Math.max(m, r.to - r.from), 0); return { runs: runs.map((r) => ({ ...r, min: +r.min.toFixed(2) })), longest_sec: +longest.toFixed(1), threshold };
}
export function safeZoneCaptions(words, formatName) { return captionAudit(words, formatName); }

export function runQc({ format, formatName, drawFrame, duration, scenes, storyboard, script, derived, words, minEdge = 3.2 }) {
  const times = []; for (let t = 0.5; t < duration; t += 1.0) times.push(t);
  const drawn = collectDrawnText({ format, drawFrame, times });
  const nums = numberProvenance({ drawn, allowed: allowedNumbers({ storyboard, script, derived }) });
  const occ = occupancy({ format, drawFrame, scenes }); const thin = occ.filter((o) => o.edge_density < minEdge);
  const idle = idleWindows({ format, drawFrame, duration }); const lowInfo = lowInfoIntervals({ format, drawFrame, duration }); const caps = safeZoneCaptions(words, formatName);
  const issues = [];
  if (!nums.ok) issues.push({ kind: 'unprovenanced_number_on_screen', detail: nums.unprovenanced.slice(0, 5) });
  if (thin.length) issues.push({ kind: 'frame_occupancy_low', detail: thin });
  if (idle.length) issues.push({ kind: 'idle_window', detail: idle.slice(0, 3) });
  if (lowInfo.longest_sec > 4) issues.push({ kind: 'low_information_interval', detail: lowInfo.runs.slice(0, 3) });
  if (caps.issues.length) issues.push({ kind: 'caption_safe_zone', detail: caps.issues });
  return { ok: issues.length === 0, issues, numbers: { drawn_tokens: nums.numeric_tokens_drawn, unprovenanced: nums.unprovenanced.length }, occupancy: occ, idle_windows: idle.length, low_info: { longest_sec: lowInfo.longest_sec, runs: lowInfo.runs.length }, captions: { chunks: caps.chunks, max_bottom: caps.maxBottom, safe_bottom: caps.safeBottom } };
}
