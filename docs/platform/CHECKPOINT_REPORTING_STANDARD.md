# MMMOS engineering checkpoint reporting standard

Version: MMMOS-CEO-REPORTING-V1. Adopted 2026-11-01 under SRV-STUDIO-V2-039 (CEO-approved workflow improvement).
Supersedes the Order 037 template (2026-10-31); Order 037's delivery rules are kept below.

Applies to every engineering project and every completed engineering task:
- SRV Studio
- SRV Farsi
- AI Creation Studio
- NextWave
- SMM
- MMMOS CEO Dashboard
- every future MMMOS project

## Authority model (unchanged)

- **CEO**: material business decisions only. These are cost, vendor, account authorization, protected shared systems and production release.
- **ChatGPT / CEO Adviser (PM)**: routine review and departmental acceptance.
- **Claude Code**: engineering, research, testing, documentation and execution.

## Delivery rules

1. Every completed engineering task ends with a **complete, copy-ready checkpoint printed in Claude's chat response**. It is **one fenced plain-text code block**, so the CEO needs only **one copy operation** to paste it into ChatGPT.
2. These never replace the checkpoint: a screenshot, a file path, an artifact link, a brief summary, or "see full report".
3. The block is readable and concise, but contains all material facts and decisions. It names exact identifiers where relevant: commits (7+ characters), PRs, full deployment IDs and config keys.
4. Failed tests, blockers and unknowns are never omitted. Nothing is reported as verified or completed without evidence. Assumptions are labelled as assumptions.
5. A checkpoint is delivered even when the work is partial, blocked or failed.
6. Supporting file paths are listed **after** the block. Detailed evidence is saved separately in MMMOS, in the repository or the project evidence folder, and is never claimed as stored unless verified.
7. The block never contains secrets, credentials, tokens, PINs, private keys or private data.
8. Every checkpoint ends with **NEXT ACTION** and **ACTION OWNER**. A recommended next step is a specific action, never just "wait".
9. CEO DECISIONS REQUIRED lists only material decisions, and says NONE when there are none. Routine choices go to PM DECISIONS.
10. The CEO is never asked to do backend testing.

## Format (exact headings, in this order)

```
START — CEO CHECKPOINT REPORT

PROJECT:
CHECKPOINT ID:
DATE:
EXECUTION OWNER:
REQUESTING DEPARTMENT:
PM:
AUTHORIZATION REFERENCE:

EXECUTIVE SUMMARY:
(what happened, in simple CEO language)

STATUS:
COMPLETE / PARTIAL / BLOCKED / FAILED

WORK COMPLETED:
(actual changes and findings)

VERIFICATION:
(tests performed, results, evidence)

PRODUCTION STATUS:
(state clearly whether anything was deployed, connected, published or changed)

COST IMPACT:
(existing costs, new costs, or none)

RISKS AND BLOCKERS:
(material issues and remaining unknowns)

BUSINESS ISOLATION:
(which engines were affected and which remained unchanged)

PM DECISIONS:
(routine decisions delegated to PM)

CEO DECISIONS REQUIRED:
(material business, cost, protected-system, account authorization or production release decisions; NONE if not applicable)

RECOMMENDED NEXT STEP:
(a specific action, not "wait")

NEXT ACTION:
ACTION OWNER:

END — CEO CHECKPOINT REPORT
```

## Formatting inside the block

- Plain text only: no Markdown tables, no HTML, no emoji. Bullets use "-".
- STATUS is exactly one of: COMPLETE, PARTIAL, BLOCKED, FAILED.
- Test results may use PASS / FAIL / NOT RUN. Verification findings may use VERIFIED / NOT VERIFIED / NOT SUPPORTED.

## Scope of this standard

It is a reporting convention only. It creates no reporting platform, does not rebuild MMMOS and does not change production infrastructure. Changes to protected shared-system behavior still need separate authorization.
