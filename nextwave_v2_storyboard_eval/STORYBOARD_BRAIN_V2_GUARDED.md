# STORYBOARD BRAIN V2 — GUARDED ARCHITECTURE FROZEN

Classification: **GUARDED PRODUCTION BRAIN** (not an unrestricted autonomous general-language Brain).
Status: frozen by PMO decision after the fourth blind validation and the closeout correction round.
No further hold-out campaigns. Changes from here are driven by real production evidence only.

## Architecture (unchanged since the third validation)
1. SCRIPT -> meaning units -> deterministic quantity extraction
2. Two independent model passes PROPOSE roles, scenarios, grouping, intents, calculation mappings
   (the model never emits numbers; digits in free text rejected unless verbatim from the script)
3. Deterministic verification: financial calculators reproduce stated figures, two-pass corroboration,
   verbatim evidence, kind/type sanity, coverage audit, contradiction detection
4. Planning: intent -> treatment with capability checks; message-aware pairing; milestone / delay / parts-vs-total logic
5. Visual-semantic validator on the FINAL renderer parameters (every factual treatment)
6. Provenance audit of every rendered number; authoritative-value audit (money / percent tokens)

## Operational behaviour
| Result | Meaning | Action |
|---|---|---|
| `clean` (PASS) | every bound value verified or two-pass corroborated, every rendered number provenanced, visual-semantics validated | eligible for automated rendering |
| `needs_review` | genuine ambiguity, unsupported structure, a contradiction the script makes with itself, a proposal the deterministic layer could not confirm | **STOP.** Internal production exception for VA Production / Product QC to resolve or regenerate. Never rendered as factual output. Never published automatically. **The CEO does not review these.** |
| `blocked` | a factual/safety failure: unprovenanced number, or a visual that contradicts the verified storyboard | **STOP** as a factual/safety failure. Engineering triage. |

`needs_review` is a feature: a false review is preferable to a false visualization.

## Production KPI (record from day one)
- **Exception rate** = needs_review + blocked scripts / all scripts, by reason code (`integrity.issues[].kind`).
- Secondary: mean time to resolve an exception; % of exceptions caused by model omission vs unsupported structure vs script self-contradiction.
- Reference (not a target): fourth blind validation, 30 normal scripts: 83.3% clean, 0 confident misbindings, 0 silent drops, 0 calculation errors, 0 unprovenanced numbers; all 6 safety scripts stopped.

## Known limitations (documented, accepted)
- Structures outside the calculator set fail safe (e.g. delayed debt payoff, allocation-weighted returns, age-based schedules).
- Two passes of one model are correlated; one pass may omit a quantity or mis-map a calculation -> needs_review.
- Movement verbs used to gate money-flow arrows are a deliberately small list; unsupported flows become evidence cards.
- The two-decimal precision rule applies to stated cents; derived deltas use the greater precision of their inputs.

## Evidence
`nextwave_v2_storyboard_eval/` — frozen hold-out sets with SHA-256 freezes, untouched first-run reports and recordings;
`test_nextwave_v2_semantic_validators.mjs`, `test_nextwave_v2_closeout_regressions.mjs` (stub-model unit regressions).
