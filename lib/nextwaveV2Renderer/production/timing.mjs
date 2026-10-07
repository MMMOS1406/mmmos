// NextWave V2 production — scene timing from the narration alignment. Pure functions; no I/O.
// Scenes are placed by locating each scene's narration text in the spoken word stream; reveals are anchored to the
// spoken word of the value they show (meaning_event_pattern, else the value's spoken phrase). Nothing is timed by "every N seconds".
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
export function spokenIndex(words) {
  let text = ''; const starts = [];
  words.forEach((w, i) => { starts.push(text.length); text += (i ? ' ' : '') + w.w; });
  return { text: text.toLowerCase(), starts, words };
}
const wordAt = (ix, charPos) => { let lo = 0, hi = ix.starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ix.starts[mid] <= charPos) lo = mid; else hi = mid - 1; } return lo; };
// returns [{start,end,firstWord,lastWord,located}] contiguous over the narration
export function placeScenes(scenes, words, tail = 1.2) {
  const ix = spokenIndex(words); let cursor = 0; const out = [];
  scenes.forEach((sc, i) => {
    const t = norm(sc.narration.text); let p = ix.text.indexOf(t, cursor), located = p >= 0;
    if (!located) { // whitespace/punctuation drift: match on the first 6 words
      const head = t.split(' ').slice(0, 6).join(' '); p = ix.text.indexOf(head, cursor); located = p >= 0;
    }
    if (!located) p = cursor;
    const first = wordAt(ix, p); const last = located ? wordAt(ix, Math.min(ix.text.length - 1, p + t.length - 1)) : first;
    // Long-format regression (2026-10-06, task 125): cursor must only advance on an ACTUAL match. It
    // previously advanced by the failed scene's own text length even when nothing was found, landing
    // on an arbitrary position with no relation to real narration progress. Every later scene then
    // searched forward from that bogus position and could miss text that genuinely appears earlier in
    // the stream, cascading one false negative into every subsequent scene (observed: S4 AND S5 both
    // "not located" from a single failed match, identically on retry since the search is deterministic).
    // Short-format scripts rarely exercise this path (one topic, little restated phrasing); Long format's
    // 3-angle narration restates similar phrasing often enough to make a single miss likely, and the old
    // behavior turned that one miss into a multi-scene cascade. Leaving cursor unchanged on a miss lets
    // the next scene still search from the last confirmed-good position — a genuinely absent scene is
    // still correctly flagged unlocated; only the false cascade is removed.
    if (located) cursor = Math.max(cursor, p + Math.max(1, Math.min(t.length, ix.text.length - p)));
    out.push({ first, last, located });
  });
  return out.map((o, i) => {
    const start = i === 0 ? 0 : words[o.first].start - 0.15; const nextFirst = out[i + 1] ? out[i + 1].first : null;
    const end = nextFirst != null ? words[nextFirst].start - 0.15 : words[words.length - 1].end + tail;
    return { ...o, start: Math.max(0, start), end };
  });
}
// time of a spoken value inside a scene span; pattern is the Brain's meaning_event_pattern (regex source)
export function eventTime(words, span, pattern, fallbackFrac = 0.35) {
  const ix = spokenIndex(words); const a = ix.starts[span.first] ?? 0;
  if (pattern) { try { const re = new RegExp(pattern, 'i'); const m = re.exec(ix.text.slice(a)); if (m) { const w = wordAt(ix, a + m.index); return { t: words[w].start, found: true }; } } catch (_) { /* fall through */ } }
  return { t: span.start + (span.end - span.start) * fallbackFrac, found: false };
}
export const wordEnd = (words, span) => words[span.last].end;
