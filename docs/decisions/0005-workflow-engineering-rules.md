# 5. Workflow engineering rules

**Status:** accepted

## Decision
- **One adaptor for integrations.** Steps that call a system use
  `@openfn/language-http`; pure-logic steps use `@openfn/language-common`.
  Versions are pinned in `project.yaml`. Credentials use the adaptor's own
  field names, so no step remaps configuration at runtime.
- **Idempotent writes.** Every referral stores the OpenMRS encounter UUID;
  step 4 looks it up before creating anything. Every notification stores a
  `notified at` marker; step 5 only sends to referrals without one. Retries and
  manual triggers never duplicate.
- **Cursor, not memory.** The "processed until" cursor lives in a Collection
  and only advances past screenings that were fully processed. Anything that
  failed is picked up on the next run.
- **Loud failures.** A run fails if any referral or notification fails, and
  the log says which one and why. Errors are never swallowed.
- **No PII in logs.** Logs identify patients by OpenMRS ID, never by name,
  phone or birthdate.
- **Testable logic.** Steps 3 (evaluate & route) and the aggregation in step 9
  are pure functions of state and have unit tests with fixture states.

## Defaults for programme rules
These are configurable in `reference-data/settings.json`:

| Rule | Default |
|---|---|
| Referral appointment date | screening date + 1 day |
| Referral counts as completed | appointment status `Checked In`, `Checked Out` or `Closed` |
| Report cadence | hourly, or on demand via the webhook |
| Late-data window | previous month reported during the first 10 days |
