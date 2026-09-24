# 2. One OpenFn workflow with two branches

**Status:** accepted

## Context
Several small workflows make the programme hard to follow: you have to open
each one and reconstruct how they relate. The referral path and the national
reporting path share configuration and run on the same schedule.

## Decision
A single workflow, **NCD Community Referral & Reporting**, holds the whole
programme:

```
cron (15 min) ─┐
webhook ───────┴─► 1 Load config & cursor ─┬─► 2 Fetch screenings ─► 3 Evaluate & route ─► 4 Create referrals ─► 5 Notify ─► 6 Record & advance cursor
                                           └─► [report due] 7 Fetch month's screenings ─► 8 Fetch month's referrals ─► 9 Build report ─► 10 Push to DHIS2
```

- Each step uses one credential (an OpenFn constraint), which is why reading
  from two systems takes two steps. Pure logic (3 and 9) has its own steps so
  it can be unit tested without mocking HTTP.
- Runs are limited to one at a time, so a scheduled and a manual run never
  race on the cursor.
- Lightning's REST workflows API accepts only one enabled trigger edge per
  workflow, but the workflow model, provisioning and the runtime accept both
  triggers, and both fire. Confirm this is supported with OpenFn's product
  team (Brandon's team) before relying on it outside this sandbox.
- The reporting branch is gated by an edge condition computed in step 1
  (hourly by default, or when the webhook asks for a report), so it doesn't run
  every 15 minutes.
- A second workflow is only added for something this one cannot host.

## Consequences
- The whole programme is visible on one canvas.
- A failure in one branch does not stop the other.
