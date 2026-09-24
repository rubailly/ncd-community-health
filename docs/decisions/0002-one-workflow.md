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
cron (15 min) / webhook ─► 1 Load config & cursor ─┬─► 2 Fetch screenings ─► 3 Evaluate & route ─► 4 Create referrals ─► 5 Notify ─► 6 Mark notified & advance cursor
                                                   └─► [report due] 7 Count screenings ─► 8 Count referrals ─► 9 Push to DHIS2
```

- Each step uses one credential (an OpenFn constraint), which is why reading
  from two systems takes two steps.
- The reporting branch is gated by an edge condition computed in step 1
  (hourly by default, or when the webhook asks for a report), so it doesn't run
  every 15 minutes.
- A second workflow is only added for something this one cannot host.

## Consequences
- The whole programme is visible on one canvas.
- A failure in one branch does not stop the other.
