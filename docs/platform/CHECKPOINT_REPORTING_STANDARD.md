# MMMOS engineering checkpoint reporting standard (Order 037, adopted 2026-10-31)

This standard applies to every engineering checkpoint Claude Code delivers to the ChatGPT CEO Adviser / PM.

## Delivery rules

1. The **full** checkpoint is printed in the final Claude response as **one plain-text code block**. The CEO copies it with the code block's Copy control and pastes it into ChatGPT. There are no screenshots, artifact cards, links-only or summaries in its place.
2. The same text is saved in the repository as `docs/platform/R2_CHECKPOINT_<NNN>.txt` (or `CHECKPOINT_<NNN>.txt` for other projects) and committed and pushed. The response gives the exact path and commit SHA.
3. A checkpoint is delivered even when execution is blocked, incomplete or awaiting approval.
4. Nothing is reported as completed without evidence (command output, test counts, IDs, SHAs).
5. Every checkpoint names the next action and its owner; it never ends with only "waiting for approval".
6. All routine engineering issues and all required decisions are consolidated in one report.
7. The CEO is never asked to do backend testing.
8. Nothing is claimed as stored in the MMMOS database or artifact storage unless that storage was verified.

## Template (exact headings, in this order)

```
START CHECKPOINT [NUMBER]

PROJECT:
DATE:
EXECUTION ORDER:

EXECUTIVE SUMMARY:

WORK COMPLETED:

WORK NOT COMPLETED:

PASS / FAIL / BLOCKED RESULTS:

SECURITY AND BUSINESS ISOLATION:

PRODUCTION CHANGES:
(YES/NO, with exact details)

GITHUB BRANCH:
PULL REQUEST:
COMMIT SHA:

DURABLE REPORT PATH:

ARTIFACTS AND EVIDENCE:

REMAINING RISKS:

PM DECISIONS REQUIRED:

CEO DECISIONS REQUIRED:

NEXT ACTION:

ACTION OWNER:

END CHECKPOINT [NUMBER]
```

## Formatting inside the block

- Plain text only: no Markdown tables, no HTML, no emoji. Bullets use "-". Statuses are COMPLETE, PARTIAL, BLOCKED, NOT RUN, PASS or FAIL.
- SHAs are given as at least 7 characters, deployment IDs in full.
- The block never contains secrets, PINs, tokens, private keys or private data.
