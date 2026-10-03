// NextWave V2 — Number Narration Clarity (2026-10-03).
//
// CEO Test #1 finding: authoritative financial numbers were spoken too quickly/unclearly (digit-form
// numerals get compressed by the TTS model relative to natural per-syllable pacing — measured directly:
// "$2,346" spoke in 1.417s vs "two thousand three hundred forty-six dollars" for the SAME value in
// 1.951s, a ~38% increase, via a real probe through the existing ElevenLabs integration). <break> tags
// were tested and are NOT safely interpreted by this model/endpoint (the literal tag text leaked into
// the alignment, exactly like the disclaimer-bracket defect) — so this does not rely on them.
//
// Three representations, one source of truth:
//   A. canonical/evidence value — the Brain's own verified storyboard.values[] entry (untouched).
//   B. display/caption value   — storyboard.values[].display (untouched) — what the viewer SEES.
//   C. spoken/TTS value        — DETERMINISTICALLY derived from the same verified value, here —
//                                 what ElevenLabs is actually asked to say.
// The LLM never rewrites numbers; this is pure, deterministic, testable text transformation over
// ALREADY-VERIFIED entities (narrate() runs only after the Brain gate has already passed), so it can
// never introduce a new, unverified number and never touches the Brain/QC/provenance layers at all.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion'];

function threeDigitsToWords(n) {
  const parts = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { const t = TENS[Math.floor(n / 10)]; const r = n % 10; parts.push(r ? `${t}-${ONES[r]}` : t); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}
// Whole non-negative integer -> English words. Financial principals/outcomes here are always
// non-negative (fact-packet dollar amounts), so negative numbers are not a real input case.
export function integerToWords(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return 'zero';
  const chunks = []; let x = n;
  while (x > 0) { chunks.push(x % 1000); x = Math.floor(x / 1000); }
  const parts = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i] === 0) continue;
    parts.push(threeDigitsToWords(chunks[i]) + (SCALES[i] ? ' ' + SCALES[i] : ''));
  }
  return parts.join(' ');
}
// "2346" -> "two thousand three hundred forty-six"; "0.06" -> "zero point zero six" (every decimal
// digit spoken individually and in order — the exact safety invariant already proven for the reverse
// (words -> number) parser earlier in this engagement: 0.06 must never become "zero point six" or
// "six". Reusing that same digit-by-digit convention here guarantees the two stay consistent.
export function numberToSpokenWords(numStr) {
  const [intRaw, decRaw] = String(numStr).split('.');
  const intWords = integerToWords(parseInt(intRaw, 10) || 0);
  if (decRaw == null || decRaw === '') return intWords;
  const decWords = [...decRaw].map((d) => ONES[+d] || 'zero').join(' ');
  return `${intWords} point ${decWords}`;
}
const DURATION_UNIT_RE = /^(?:days?|weeks?|months?|years?)$/i;
// A verified entity's VERBATIM script span -> { text: spoken phrase, numericDisplay: the ORIGINAL
// leading numeral exactly as written (never the Brain's reformatted `display` field — see
// expandNumbersForSpeech for why), collapseWordCount: how many of the SPOKEN words belong to that
// numeral and must collapse back into one caption entry }.
//
// The caption renderer (captions.mjs drawCaptions) reconstructs each line by joining words[].w with
// spaces and re-splitting on spaces per token — so every words[].w MUST be a single space-free token.
// A naive "collapse the whole phrase to the Brain's display text" breaks this the moment display
// contains a space (e.g. duration's "8 YEARS", or a percent mention spelled as two script tokens, "7
// percent"): "eight years" would collapse to ONE entry reading "8 YEARS" (two words baked into one
// token), desyncing the renderer's per-token index and crashing it (confirmed empirically — this is
// exactly what happened before this fix). The correct behavior is the one the ORIGINAL unexpanded
// pipeline already had: a unit WORD that was its own separate script token ("years", "percent" when
// spelled out) stays its own separate caption word — only the NUMERAL itself (1-to-many once spoken)
// needs collapsing. So only tokens[0] (the numeral, optionally with a glued $ or %) ever collapses;
// any trailing unit word that was already a separate original token flows through unchanged.
//
// Bounded to exactly the shapes the regression matrix requires: a bare numeral (optionally $-prefixed
// or %-suffixed) alone, or a numeral followed by exactly one plain unit word. Anything else — a range
// ("2 to 3 days"), compact scale shorthand ("$2.3 million") — returns null (safe-failure: speak it
// exactly as written, same as before this gate existed, rather than risk silently changing what it
// means). This is bounded, not broad: every value in the PM order's required matrix is this simple
// [numeral] or [numeral, unit] shape; the harder cases are explicitly left unexpanded, not guessed at.
export function spanTextToSpoken(spanText, kind) {
  const tokens = String(spanText || '').trim().split(/\s+/);
  if (!tokens.length || tokens.length > 2) return null;
  const numMatch = tokens[0].match(/^\$?([\d,]+(?:\.\d+)?)%?$/);
  if (!numMatch) return null;
  const numberWords = numberToSpokenWords(numMatch[1].replace(/,/g, ''));
  const collapseWordCount = numberWords.split(' ').length;
  if (tokens.length === 1) {
    const glued = /%$/.test(tokens[0]);
    if (kind === 'money') return { text: `${numberWords} dollars`, numericDisplay: tokens[0], collapseWordCount: collapseWordCount + 1 };
    if (kind === 'percent' && glued) return { text: `${numberWords} percent`, numericDisplay: tokens[0], collapseWordCount: collapseWordCount + 1 };
    if (kind === 'percent' || kind === 'duration') return null; // percent/duration with no unit at all is not a shape this gate recognizes
    return { text: numberWords, numericDisplay: tokens[0], collapseWordCount };
  }
  const unit = tokens[1].toLowerCase();
  if (kind === 'duration' && DURATION_UNIT_RE.test(unit)) return { text: `${numberWords} ${unit}`, numericDisplay: tokens[0], collapseWordCount };
  if (kind === 'percent' && unit === 'percent') return { text: `${numberWords} percent`, numericDisplay: tokens[0], collapseWordCount };
  if (kind === 'money' && (unit === 'dollar' || unit === 'dollars')) return { text: `${numberWords} dollars`, numericDisplay: tokens[0], collapseWordCount };
  return null;
}

// Build the TTS-bound text: walk the ALREADY-BRAIN-VERIFIED canonical script once, replacing each
// verified money/percent/duration entity's own script span with its spoken form, leaving every other
// character (connective prose, the disclaimer tag, incidental non-financial numbers) untouched.
//
// provenance.start/end are NOT global offsets into the full script — both Brain implementations
// (nextwaveV2StoryboardBrain.mjs, nextwaveV2SemanticStoryboard.mjs) scan each meaning-UNIT's own local
// text independently (deps.segmentMeaningUnits splits the script first), so `start`/`end` are local to
// that unit's substring, not the document. Real example found empirically (script A, "$3,000" appears
// twice): first mention's reported start/end were 13/19, second's were 29/35 — but the script's real
// (global) positions are 87 and 223. Using those local numbers as global offsets produced completely
// scrambled TTS text. There is no reliable global offset available at all (units are rejoined with
// normalized whitespace, so searching for a reconstructed unit string isn't safe either). The fix:
// never trust the numbers, only the (reliable) matched substring (span_text) and its document-order
// position — unit_id is the unit's own sequence number (units are produced in document order) and, for
// two mentions in the SAME unit, their local `start` is still valid as a same-unit tiebreaker (it's a
// real local offset, just not a global one). Sorting candidates that way and then searching the
// UNTOUCHED full script left-to-right with a strictly forward-moving cursor recovers the true global
// span for each one, resolves duplicate span_text values (like the repeated "$3,000") to their correct
// distinct occurrences, and can never produce an overlap (indexOf never returns a position before the
// cursor). A span_text that genuinely can't be found from the current cursor is skipped, never guessed.
//
// numericDisplay (NOT v.display) is used for the one collapsed caption token — see spanTextToSpoken's
// comment for why: it's the exact original written numeral, guaranteed space-free and guaranteed
// "unchanged" in the most literal sense (it's the very substring that was already on screen).
export function expandNumbersForSpeech(script, values) {
  const unitNum = (v) => { const m = String((v.provenance && v.provenance.unit_id) || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; };
  const candidates = (values || [])
    .filter((v) => v && v.provenance && v.provenance.kind === 'script' && ['money', 'percent', 'duration'].includes(v.kind) && v.provenance.span_text)
    .sort((a, b) => unitNum(a) - unitNum(b) || (a.provenance.start || 0) - (b.provenance.start || 0));
  const spans = []; let cursor = 0;
  for (const v of candidates) {
    const spanText = v.provenance.span_text;
    const start = script.indexOf(spanText, cursor);
    if (start < 0) continue; // safe-failure: never guess a position this entity's span can't actually be found at
    const end = start + spanText.length;
    const spoken = spanTextToSpoken(spanText, v.kind);
    cursor = end;
    if (!spoken) continue;
    spans.push({ start, end, ...spoken });
  }
  if (!spans.length) return { ttsText: script, spans: [] };
  let ttsText = ''; let copyFrom = 0; const ttsSpans = [];
  for (const s of spans) {
    ttsText += script.slice(copyFrom, s.start);
    const ttsStart = ttsText.length;
    ttsText += s.text;
    ttsSpans.push({ ttsStart, ttsEnd: ttsText.length, display: s.numericDisplay, collapseWordCount: s.collapseWordCount });
    copyFrom = s.end;
  }
  ttsText += script.slice(copyFrom);
  return { ttsText, spans: ttsSpans };
}

// Replaces wordsFromAlignment for narration that went through expandNumbersForSpeech: identical for
// any text outside an expanded span (one entry per whitespace-separated token, exactly as before). For
// an expanded span, only the first `collapseWordCount` spoken sub-words (the numeral itself) collapse
// into ONE caption entry carrying the original compact numeral text (e.g. "$2,346", or "8" for an "8
// years" mention); any further spoken word within that same span (a unit word that was already its own
// separate original token, e.g. "years") is its OWN normal single-token caption word, exactly matching
// what the unexpanded pipeline already showed — "voice speaks naturally; screen/caption stays exactly
// as compact as it always was." The joined .w text this produces reads identically to the canonical
// script (just like the original wordsFromAlignment did), so every downstream consumer (placeScenes,
// eventTime, valueTime — all of which search a space-joined reconstruction of words[].w) keeps working
// unmodified, and the caption renderer's one-token-per-word.w invariant is never violated.
export function wordsFromAlignmentWithSpeechSpans(ttsText, alignment, ttsSpans) {
  const s = alignment.character_start_times_seconds, e = alignment.character_end_times_seconds;
  const out = []; const re = /\S+/g; let m; let spanIdx = 0; let curSpan = null; let tokenInSpan = 0;
  while ((m = re.exec(ttsText))) {
    const a = m.index, b = m.index + m[0].length - 1;
    if (b >= s.length) break;
    while (spanIdx < ttsSpans.length && a >= ttsSpans[spanIdx].ttsEnd) spanIdx++;
    const sp = ttsSpans[spanIdx];
    const inSpan = sp && a >= sp.ttsStart && a < sp.ttsEnd;
    if (inSpan) {
      if (sp !== curSpan) { curSpan = sp; tokenInSpan = 0; }
      if (tokenInSpan < sp.collapseWordCount) {
        if (tokenInSpan === 0) out.push({ w: sp.display, start: s[a], end: e[Math.min(b, s.length - 1)], i: sp.ttsStart });
        else out[out.length - 1].end = e[Math.min(b, s.length - 1)];
        tokenInSpan++;
        continue;
      }
      tokenInSpan++;
    } else curSpan = null;
    out.push({ w: m[0], start: s[a], end: e[b], i: a });
  }
  return out;
}
