# NextWave Finance Pilot — lifecycle integration plan (048)

**PLAN ONLY.** Nothing here is implemented or deployed. Each stage needs its own PM order and CEO approval.

## Status

REGISTERED, NOT YET OPERATIONAL (PR #75 released 2026-11-01, merge 92281cf, production dpl_6iPTEc65…).

What exists:
- the business key `nextwave_finance_pilot`;
- three isolated folders;
- the engineering artifact prefix;
- the Task Generator component name;
- the reserved namespaces in `projects/nextwave-finance-pilot/pilot.config.json`, which are not wired to anything.

## Principles (carried through every stage)

- **Isolation:**
  - never touches NextWave V1 (live engine), NextWave V2 (`lib/nextwaveV2*`, task 2e17bd23) or any other business;
  - no shared-lifecycle rebuild; the pilot plugs into existing extension points only.
- **No cost until approved:** paid generation stays `enabled:false` until a CEO order names the vendor, the budget cap and the stage.
- **No publishing until approved:** each video needs CEO authorization through the existing gated publishing path (`_publishGate`). Never the runner.
- **Proof per stage:**
  - isolation tests (the pilot cannot reach other businesses, and they cannot reach the pilot);
  - full suite comparison with main;
  - preservation harness;
  - a production verifier after release.

## Stages

| Stage | Scope | Touches | Cost | Approval needed |
|---|---|---|---|---|
| L1 State namespace | Read/write pilot state under its own key (`nextwave_finance_pilot`) using the existing 3-way-merge state path; empty initial state | server state helpers (new key only), pilot folder | none | PM order + CEO release |
| L2 CEO workspace card | A read-only "NextWave Finance Pilot" card in the CEO workspace showing registration and empty state | `public/index.html` (one new card, flag default OFF) | none | PM order + CEO release |
| L3 Content planning (no generation) | Topic and storyboard drafts stored as pilot artifacts; deterministic templates only | pilot folder, artifact prefix | none | PM order + CEO release |
| L4 Paid generation (sandboxed) | Script, voice or visual generation for the pilot only, behind a CEO session, with a per-day cap and a separate low-limit vendor key | new pilot handler behind `SESSION_GATED_ACTIONS` | yes (vendor usage) | **CEO cost decision** (vendor, cap) |
| L5 Review and approval | Pilot packages enter the existing review/approval flow (approve/reject, now session-gated) | existing approvals, pilot filter | none | PM order + CEO release |
| L6 Publishing (per video) | The CEO-approved upload of one reviewed video through the existing gated publishing path, to a channel the CEO names | channel mapping (new entry), no gate change | none | **per-video CEO authorization** |
| L7 Analytics | Pilot analytics namespace (`nextwave_finance_pilot`) | analytics readers (namespace filter) | none | PM order + CEO release |

Recommended first order: L1 + L2 together (no cost, flag OFF, no generation).

## Open questions for the CEO (before L4/L6)

1. Which channel (new or existing) the pilot publishes to.
2. Which generation vendors the pilot may use, and the monthly cap.
3. Whether VA operators may work on pilot tasks, or the CEO only.
