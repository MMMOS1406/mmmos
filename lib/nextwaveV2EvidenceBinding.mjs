// Phase 5.2 — DETERMINISTIC EVIDENCE BINDING. A real candidate showed a
// slot labeled "YEAR 1" displaying $25,000 (the YEAR 5 unit's real value)
// while a separate "YEAR 5" slot displayed $10,000 (the true YEAR 1
// value) -- the storyboard model had assigned the WRONG unit_index to
// each slot. The pre-existing Phase 4.5D hallucination guard can't catch
// this: $25,000 really is real, verbatim text belonging to unit_index 5,
// so that guard passes even though "YEAR 1" now names the wrong unit
// entirely. For a finance-publishing system this is a publication
// blocker, not a display nuance.
//
// Pulled out into its own zero-dependency module (not inline in
// api/ops.js) specifically so it can be exercised directly by the
// evidence-integrity test matrix without importing api/ops.js itself --
// that file pulls in @ffmpeg-installer/ffmpeg at module load, which
// throws when no platform binary is installed locally, and there is no
// reason a pure text/JSON correction function should depend on that.
//
// `plan` is the full script's unit list (each with real .text and
// .__candidateValues, computed straight from the script, never from a
// model). `validIdxs` is the Set/iterable of unit indices that belong to
// THIS scene (a slot may never be rebound outside its own scene). Mutates
// each slot in place; also returns `slots` for convenience.
export function nextwaveV2BindEvidenceDeterministically(slots, plan, validIdxs) {
  const validIdxArr = [...validIdxs];
  slots.forEach((sl) => {
    // Step 1 — unit_index self-correction. If the slot's own label names a
    // recognizable anchor -- a number (a year/month/day/age, or a
    // duration like "30-YEAR"), OR (when there's no number) one of the
    // label's own significant words (e.g. "RENT", "FEE") -- and the unit
    // CURRENTLY assigned to this slot doesn't actually contain that
    // anchor anywhere in its own real text, the model almost certainly
    // cross-wired unit_index. Search this scene's OTHER units (real
    // script order, never invented) for the one whose own text does
    // contain it; rebind only when exactly one match exists — an
    // ambiguous or absent match is left untouched rather than guessed at,
    // matching this file's established never-invent-never-guess
    // discipline. Digit anchors are tried first (more precise than a
    // word), then word anchors as a fallback.
    const digitAnchor = (sl.label.match(/\d+/) || [])[0];
    const wordAnchors = sl.label.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w));
    const anchorTests = [];
    if (digitAnchor) { const re = new RegExp(`\\b${digitAnchor}\\b`); anchorTests.push((text) => re.test(text)); }
    wordAnchors.forEach((w) => anchorTests.push((text) => text.toLowerCase().includes(w)));
    for (const testAnchor of anchorTests) {
      const currentUnit = plan[sl.unit_index];
      const currentMatches = currentUnit && testAnchor(currentUnit.text);
      if (currentMatches) break; // already consistent with this anchor -- nothing to correct
      const anchorCandidates = validIdxArr.filter((idx) => plan[idx] && testAnchor(plan[idx].text));
      if (anchorCandidates.length === 1 && anchorCandidates[0] !== sl.unit_index) {
        sl.unit_index = anchorCandidates[0];
        // The old primary/secondary_value belonged to the WRONG unit and
        // must not silently carry over onto the corrected one —
        // re-validate against the newly-bound unit's own real candidates,
        // same verbatim-only rule as the hallucination guard.
        const rebound = (plan[sl.unit_index].__candidateValues) || [];
        sl.primary_value = rebound.includes(sl.primary_value) ? sl.primary_value : null;
        sl.secondary_value = (rebound.includes(sl.secondary_value) && sl.secondary_value !== sl.primary_value) ? sl.secondary_value : null;
        break; // resolved -- don't let a weaker fallback anchor re-decide
      }
      // ambiguous (0 or 2+ matches) with this anchor -- try the next one
    }
    // Step 2 — once unit_index is confirmed/corrected, a unit carrying
    // exactly ONE real value has no ambiguity left to introduce: that
    // value IS this slot's primary_value, full stop, regardless of what
    // the model wrote. This is the common case (one sentence, one number,
    // one slot) and is exactly the case the reported bug occurred in —
    // removing the model's discretion here removes the failure mode
    // entirely rather than merely reducing it.
    const boundUnit = plan[sl.unit_index];
    const boundCandidates = (boundUnit && boundUnit.__candidateValues) || [];
    if (boundCandidates.length === 1) {
      sl.primary_value = boundCandidates[0];
      sl.secondary_value = null;
    }
  });
  // Step 3 — same-unit multi-value CLAUSE binding. Step 2 only resolves a
  // unit with exactly one real value; a unit like "sixty percent goes to
  // interest and forty percent goes to principal" has TWO real values
  // and, when split into an INTEREST slot and a PRINCIPAL slot, is
  // exactly the ambiguous case the model can swap (verified: same failure
  // class, no numeric anchor in the label to catch it via Step 1).
  //
  // Resolved here by CLAUSE membership rather than raw character
  // distance: this unit's own real text is split into clause-like
  // segments (on commas/"and"/"versus"/etc — the natural places a
  // multi-value sentence separates its parts), and a slot is bound to
  // whichever of the unit's real candidate values falls in the SAME
  // clause as the slot's own label anchor (its digit, e.g. "30-YEAR", or
  // else its first significant word, e.g. "INTEREST"/"STARTING"). Clause
  // membership survives the value coming either before or after its
  // descriptor ("over 30 years you pay $291,000" vs "60% ... to
  // interest") which a plain nearest-character-distance measure does not
  // (verified against a real tie case during this section's own test
  // matrix). Only binds when the label anchor and value both resolve to a
  // real, unambiguous clause and exactly one candidate shares it;
  // otherwise left untouched rather than guessed at.
  const NUMBER_TOKEN_RE = /\$?\d[\d,]*(?:\.\d+)?%?|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b(?:[\s-]+(?:hundred|thousand|million|billion|and|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))*/gi;
  // (?!\d) — a comma immediately followed by a digit is a thousands
  // separator inside a number ("$10,000"), never a real clause break;
  // verified against a real test failure where "$10,000" was itself split
  // into two fake clauses at its own internal comma.
  const CLAUSE_SPLIT_RE = /,(?!\d)|;|\band\b|\bversus\b|\bvs\.?\b/gi;
  function clauseSpans(text) {
    const spans = [];
    let last = 0, m;
    CLAUSE_SPLIT_RE.lastIndex = 0;
    while ((m = CLAUSE_SPLIT_RE.exec(text))) {
      spans.push([last, m.index]);
      last = m.index + m[0].length;
    }
    spans.push([last, text.length]);
    return spans;
  }
  function clauseIndexForPos(spans, pos) {
    if (pos === -1) return -1;
    for (let i = 0; i < spans.length; i++) if (pos >= spans[i][0] && pos < spans[i][1]) return i;
    return -1;
  }
  const byUnit = new Map();
  slots.forEach((sl) => {
    if (!byUnit.has(sl.unit_index)) byUnit.set(sl.unit_index, []);
    byUnit.get(sl.unit_index).push(sl);
  });
  byUnit.forEach((group, unitIdx) => {
    if (group.length < 2) return;
    const unit = plan[unitIdx];
    const candidates = (unit && unit.__candidateValues) || [];
    if (candidates.length < 2) return; // Step 2 already resolved the 0/1-candidate cases
    const text = unit.text || '';
    const lowerText = text.toLowerCase();
    // __candidateValues is documented elsewhere in this pipeline to
    // already be in the order each value appears in the real sentence —
    // matching the Nth real number-token found in the raw text (digit OR
    // spelled-out word form, e.g. "sixty percent") to the Nth candidate is
    // therefore valid even though the candidate strings themselves are
    // already reformatted ("60%") and no longer literally present in
    // word-form narration text. Abort (leave untouched) if the count
    // doesn't line up — a mismatch means this heuristic can't be trusted
    // here, not a case to guess through.
    const numberTokenPositions = [...text.matchAll(NUMBER_TOKEN_RE)].map((m) => m.index);
    if (numberTokenPositions.length !== candidates.length) return;
    const spans = clauseSpans(text);
    const valueClause = numberTokenPositions.map((p) => clauseIndexForPos(spans, p));
    const labelClause = group.map((sl) => {
      const digitMatch = sl.label.match(/\d+/);
      let pos = digitMatch ? text.indexOf(digitMatch[0]) : -1;
      if (pos === -1) {
        const words = sl.label.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w));
        for (const w of words) { const idx = lowerText.indexOf(w); if (idx !== -1) { pos = idx; break; } }
      }
      return clauseIndexForPos(spans, pos);
    });
    if (labelClause.some((c) => c === -1) || valueClause.some((c) => c === -1)) return;
    group.forEach((sl, si) => {
      const matches = [];
      valueClause.forEach((c, vi) => { if (c === labelClause[si]) matches.push(vi); });
      if (matches.length === 1) sl.primary_value = candidates[matches[0]];
      // 0 or 2+ candidates share this label's clause -- genuinely
      // ambiguous from text structure alone; leave the (already
      // hallucination-guarded, real) value untouched rather than guess.
    });
  });
  return slots;
}

// Phase 5.2A — UPSTREAM ONE-SLOT COMPARISON RECOVERY. A real candidate
// showed a scene the storyboard model marked screen_type "comparison"
// survive validation with only ONE usable slot (the model either only
// proposed one, or proposed a second whose unit_index didn't validate) --
// which fell through the >= 2 comparison guard entirely and landed on the
// generic bordered-card structural safety net (nextwaveV2BuildSceneSegment's
// `timedUnits.length` branch), the exact rejected card-first look this
// architecture exists to eliminate. The model may still choose scene
// structure and which units/values are load-bearing, but a scene it
// itself called "comparison" should not silently degrade into a plain
// card when a genuine second side is reconstructable from evidence this
// file already extracted from the real script -- never invented.
//
// Two deterministic recovery attempts, in order, using only real,
// already-validated values (never invented):
//   A. a DIFFERENT unit already grouped into this same scene, carrying
//      its own real value the model simply didn't turn into a second
//      slot;
//   B. the SAME unit already carries a SECOND distinct real value (e.g.
//      "...four years, saving five thousand dollars...") that the model
//      collapsed into one slot instead of two.
// If neither recovers a genuine second value, this scene has exactly one
// real fact -- the caller should treat it as 'single' (which renders via
// the tested illustrated-object/chart path) rather than force a
// comparison layout or fall through to a bare card.
//
// `scene` is this storyboard scene's real unit list (each with a real
// __idx); `plan` is the full script's unit list (real .text and
// .__candidateValues). Mutates and returns `slots`.
export function nextwaveV2RecoverComparisonSecondSide(slots, screenType, scene, plan) {
  if ((screenType !== 'comparison' && screenType !== 'before_after') || slots.length !== 1) return slots;
  const existing = slots[0];
  const valType = (v) => (/^\$/.test(v) ? 'dollar' : /%$/.test(v) ? 'percent' : /^\d+X$/.test(v) ? 'multiplier' : /(DAYS?|WEEKS?|MONTHS?|YEARS?)$/.test(v) ? 'duration' : 'other');
  const typeLabel = { dollar: 'AMOUNT', percent: 'RATE', duration: 'TIME', multiplier: 'MULTIPLE', other: 'VALUE' };
  // A value already shown as this slot's OWN secondary_value is already
  // on screen (drawPanelContent renders primary + secondary together) --
  // promoting it into a second slot too would show the same real number
  // twice. Excluded from every "already represented" check below,
  // alongside the primary value itself.
  const alreadyShown = new Set([existing.primary_value, existing.secondary_value].filter(Boolean));

  // Recovery A — a different real unit already in this scene.
  const otherUnits = (scene.units || []).filter((u) => u.__idx !== existing.unit_index);
  for (const u of otherUnits) {
    const candidates = (plan[u.__idx] && plan[u.__idx].__candidateValues) || [];
    const pick = candidates.find((c) => !alreadyShown.has(c));
    if (pick) {
      // __recovered — no real narration label exists for this slot (it
      // was never proposed by the model), so its label is derived purely
      // from the value's own type. The renderer uses this flag to also
      // fall back to a value-type-driven illustrated object (see
      // nextwaveV2BuildSceneSegment's comparisonObjectPaths resolution)
      // since there are no real concept-tag words to resolve one from.
      slots.push({ unit_index: u.__idx, label: typeLabel[valType(pick)] || 'VALUE', primary_value: pick, secondary_value: null, __recovered: true });
      return slots;
    }
  }
  // Recovery B — a second real value already on the SAME unit.
  const sameUnitCandidates = (plan[existing.unit_index] && plan[existing.unit_index].__candidateValues) || [];
  const secondReal = sameUnitCandidates.find((c) => !alreadyShown.has(c));
  if (secondReal) {
    slots.push({ unit_index: existing.unit_index, label: typeLabel[valType(secondReal)] || 'VALUE', primary_value: secondReal, secondary_value: null, __recovered: true });
    // The promoted value now has its own dedicated slot -- clearing it
    // from the original slot's secondary_value avoids showing the exact
    // same real number twice on screen (once as the new slot's primary,
    // once as the old slot's secondary).
    if (existing.secondary_value === secondReal) existing.secondary_value = null;
  }
  return slots;
}
