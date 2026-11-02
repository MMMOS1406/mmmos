# NextWave Finance Pilot — Creative Quality review and acceptance criteria (Order 051)

**Planning only.** No paid video, audio or image was generated. The example uses stand-in data. No benchmark script, visual or branding was copied.

## 1. Representative planning example

`tests/projects/nextwave-finance-pilot/fixtures/example_plan_emergency_fund.json`

- **Topic:** "Emergency fund: how many months of expenses do you actually need?" (category `emergency_fund`, beginner).
- **Long:** 10 minutes in 7 sections.
  - Sections: hook, why it matters, core idea, worked example, common mistakes, 3 action steps, recap.
  - The script structure ends with a disclaimer part.
- **Short:** 45 seconds. "The essential expenses test", which links back to the Long.
- **Visual direction:** a jar that fills month by month, a pay-day calendar timeline, and an essentials-vs-extras checklist. One data visual (1, 3 and 6 months of the example's essentials). Brand palette.
- **Sources:**
  - Consumer Financial Protection Bureau (emergency savings guidance);
  - FDIC (deposit insurance basics).
- **Claims:** marked checked by a person.

## 2. Evaluation (deterministic checklist, `evaluateQuality`, all 10 PASS)

| Criterion | Result | Why |
|---|---|---|
| Topic relevance | PASS | A core personal-finance education topic for the stated audience |
| Responsible framing | PASS | No guarantees, "risk-free", tickers, buy/sell instructions or hype words. "Three to six months" is presented as a common guideline, not a rule |
| Financial accuracy | PASS | Disclaimer on, two primary public sources, human claims check recorded. The worked example uses round illustrative numbers labelled "not a recommendation" |
| Audience usefulness | PASS | Clear audience and objective; 3 concrete steps (add up essentials, set a starter target, automate into a separate insured account) |
| Originality | PASS | Original jar-and-calendar concept confirmed by the author; no external scripts, visuals or branding |
| Long/Short relationship | PASS | The Short teaches one step of the Long (the essential-expenses test) and points to it |
| Visual storytelling | PASS | Three motifs and one data visual that carry the idea without stock clichés |
| Brand consistency | PASS | Brand palette, calm plain-language voice, disclaimer part present |
| Distinct from AI/tech content | PASS | No AI or technology framing; pure finance education |
| Structure | PASS | Valid schema; no generation, publishing or foreign fields |

The automated checklist is a gate, not a substitute for editorial judgment. Human review (section 3) is still required.

## 3. Acceptance criteria for later production (L4 and beyond)

A plan may move to `accepted_for_planning` only when all of these hold. The first five are enforced in code; the rest by human review.

1. **Checklist:** all 10 items pass. Enforced: a plan cannot be sent for review otherwise.
2. **No prohibited claims:** no guarantees, "risk-free", get-rich-quick, "can't lose", "double your money", personal buy/sell instructions, tickers, secret-trick or hype wording. Enforced.
3. **Disclaimer and sources:** an educational disclaimer and at least one primary public source (regulator, government agency or official program page). Enforced.
4. **Originality:** the author confirms an original concept. Enforced; reviewers check it.
5. **Finance-only scope:** no generic AI/tech framing; topic from the finance-education categories. Enforced.
6. **Human fact check:** every number, rule of thumb and product rule checked against a current primary source. Rules that change yearly (contribution limits, tax brackets, insurance limits) are dated in the script.
7. **Neutral examples:** illustrative numbers are round and labelled. No named funds, stocks, coins, lenders or brokers. No personal recommendations.
8. **Long/Short pairing:** each Long has at least one Short that teaches one complete step and stands on its own.
9. **Visual standard:** original motion graphics in the brand palette; on-screen numbers match the script; captions on; the disclaimer is readable on screen for at least 3 seconds.
10. **Voice:** calm, plain-language, second person, no urgency or fear tactics, and no "this one trick".
11. **Accessibility:** captions, readable contrast, no information carried by colour alone.
12. **Brand:** the "NextWave Finance Pilot" identity only. Never presented as NextWave V2, SRV, AI Creation Studio or any other MMMOS business.

## 4. Brand profile status

`BRAND` in `projects/nextwave-finance-pilot/lib/contentPlan.mjs` (palette deep navy, teal and warm white; calm educational voice; jar, calendar and step-diagram motifs) is a **proposal** pending Creative Quality sign-off. Changing it is a code change in the pilot's own folder only.

## 5. Not in L3

- Any AI, voice, avatar, video or image generation (L4, CEO cost decision).
- Publishing (L6, per-video CEO authorization).
- Analytics (L7).
