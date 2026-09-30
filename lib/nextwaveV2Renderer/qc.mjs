// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: automated QC (engineering gate; Creative acceptance is a separate human judgement).
import { makeCanvas, wrap, measure, STYLE } from './core.mjs';
import { chunkWords } from './captions.mjs';
// every money figure in the narration must equal a calculator-verified figure (or a stated input)
export function numberAudit(script, verified, inputs = []) {
  const toks = [...script.matchAll(/\$[\d,]+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/[$,]/g, '')));
  const ok = new Set([...inputs, ...Object.values(verified).filter((x) => typeof x === 'number').map((x) => Math.round(x))]);
  const bad = toks.filter((v) => ![...ok].some((o) => Math.abs(o - v) <= Math.max(1, 0.0005 * v)));
  return { figures: toks.length, unverified: bad };
}
// captions: every chunk fits in <=2 lines inside the format's safe area
export function captionAudit(words, formatName) {
  const f = STYLE.formats[formatName]; const { g } = makeCanvas(f.w, f.h); const chunks = chunkWords(words); const issues = []; let maxBottom = 0;
  for (const c of chunks) { let size = f.caption.size, lines; for (;;) { lines = wrap(g, c.map((x) => x.w).join(' '), f.caption.w, { weight: 800, size }); if (lines.length <= 2 || size < 34) break; size -= 4; }
    const bottom = f.caption.y - size + lines.length * size * 1.22 + 22; maxBottom = Math.max(maxBottom, bottom); if (lines.length > 2) issues.push('3+ lines: ' + c.map((x) => x.w).join(' ')); }
  if (maxBottom > f.h - f.safe.bottom) issues.push(`caption bottom ${maxBottom.toFixed(0)} beyond safe area ${f.h - f.safe.bottom}`);
  return { chunks: chunks.length, maxBottom: Math.round(maxBottom), safeBottom: f.h - f.safe.bottom, issues };
}
// events must be held long enough to read: for each anchor pair (start, next start) require readingTime <= gap
export function tempoAudit(anchors, list) { return list.map(([a, b, need]) => ({ from: a, to: b, gap: +(anchors[b] - anchors[a]).toFixed(2), need, ok: anchors[b] - anchors[a] >= need })); }
