// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: caption engine (Short + Long).
// Word-synchronised, safe-zone-aware, numbers emphasised, plate keeps them legible over any scene.
import { P, font, rr, measure, wrap, tw, ease, clamp01 } from './core.mjs';

// words from ElevenLabs character alignment for the exact text sent
export function wordsFromAlignment(text, alignment) {
  const s = alignment.character_start_times_seconds, e = alignment.character_end_times_seconds; const out = [];
  const re = /\S+/g; let m;
  while ((m = re.exec(text))) { const a = m.index, b = m.index + m[0].length - 1; if (b >= s.length) break; out.push({ w: m[0], start: s[a], end: e[b], i: a }); }
  return out;
}
const isNum = (w) => /[\d$%]/.test(w);
const strip = (w) => w.replace(/^[“"'(]+/, '');

// Group words into caption chunks: break at sentence/clause punctuation, max ~7 words, fits 2 lines.
export function chunkWords(words, { maxWords = 7, gapBreak = 0.42 } = {}) {
  const chunks = []; let cur = [];
  const flush = () => { if (cur.length) { chunks.push(cur); cur = []; } };
  words.forEach((w, i) => {
    if (cur.length && w.start - cur[cur.length - 1].end > gapBreak) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.w) || (cur.length >= maxWords) || (/[,;:—–]$/.test(w.w) && cur.length >= 4)) flush();
  });
  flush(); return chunks;
}

export function drawCaptions(g, chunks, t, fmt) {
  const { w: W } = fmt; const cap = fmt.caption;
  const ch = chunks.find((c) => t >= c[0].start - 0.06 && t <= c[c.length - 1].end + 0.22); if (!ch) return;
  const t0 = ch[0].start - 0.06, tEnd = ch[ch.length - 1].end + 0.22;
  const fade = Math.min(tw(t, t0, 0.14, ease.outCubic), 1 - tw(t, tEnd - 0.14, 0.14, ease.linear));
  // fit: try the nominal size, shrink until the chunk needs at most 2 lines
  let size = cap.size; let lines;
  for (;;) { lines = wrap(g, ch.map((x) => x.w).join(' '), cap.w, { weight: 800, size }); if (lines.length <= 2 || size < 34) break; size -= 4; }
  const lh = size * 1.22; const blockH = lines.length * lh + 36; const maxLineW = Math.max(...lines.map((l) => measure(g, l, { weight: 800, size })));
  const plateW = maxLineW + 72, plateX = W / 2 - plateW / 2; const plateY = cap.y - size;
  g.save(); g.globalAlpha = fade; g.translate(0, (1 - fade) * 14);
  g.save(); g.shadowColor = 'rgba(26,39,68,0.25)'; g.shadowBlur = 28; g.shadowOffsetY = 10; rr(g, plateX, plateY - 14, plateW, blockH, 26); g.fillStyle = 'rgba(255,255,255,0.94)'; g.fill(); g.restore();
  // words placed line by line so the ACTIVE word can be highlighted
  let wi = 0;
  lines.forEach((line, li) => {
    const toks = line.split(' '); let x = W / 2 - measure(g, line, { weight: 800, size }) / 2; const y = plateY + size * 0.9 + li * lh;
    toks.forEach((tok, k) => {
      const word = ch[wi]; const active = t >= word.start - 0.02 && t < word.end + 0.06; const done = t >= word.end + 0.06; const num = isNum(word.w);
      const wpx = measure(g, tok + (k < toks.length - 1 ? ' ' : ''), { weight: 800, size });
      g.font = font('ui', num ? 900 : 800, size); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      const col = num ? P.goldDark : P.ink; g.fillStyle = active ? (num ? '#8A5F14' : P.ink) : col; g.globalAlpha = fade * (active || done ? 1 : 0.62);
      if (active) { const tw_ = measure(g, tok, { weight: 800, size }); g.save(); g.globalAlpha = fade * 0.9; g.fillStyle = P.goldLight; rr(g, x - 6, y + 8, tw_ + 12, 9, 4); g.fill(); g.restore(); g.fillStyle = num ? '#8A5F14' : P.ink; g.globalAlpha = fade; }
      g.fillText(tok, x, y); x += wpx; wi++;
    });
  });
  g.restore();
}
