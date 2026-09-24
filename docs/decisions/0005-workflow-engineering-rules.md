# 5. Workflow engineering rules

**Status:** accepted

## Decision
- **One adaptor for integrations.** Steps that call a system use
  `@openfn/language-http`; pure-logic steps use `@openfn/language-common`.
  Versions are pinned in `project.yaml`. Credentials use the adaptor's own
  field names, so no step remaps configuration at runtime. See
  [Adaptor choice](#adaptor-choice) below.
- **Idempotent writes.** Every referral stores the OpenMRS encounter UUID;
  step 4 looks it up before creating anything, and E-Buzima enforces it as
  unique. The health centre and patient messages each have their own
  `notified at` marker; step 5 only sends a message whose marker is empty.
  Retries and manual triggers never duplicate.
- **Cursor, not memory.** The "processed until" cursor lives in a Collection
  and only advances past screenings that were fully processed. Anything that
  failed is picked up on the next run.
- **Loud failures.** A run fails if any referral or notification fails, and
  the log says which one and why. Errors are never swallowed.
- **No PII in logs.** Logs identify patients by OpenMRS ID, never by name,
  phone or birthdate.
- **Testable logic.** Steps 3 (evaluate & route) and the aggregation in step 9
  are pure functions of state and have unit tests with fixture states.

## Adaptor choice

OpenFn has dedicated adaptors for every system here, and they were
considered: `@openfn/language-openmrs` (5.5.0), `-erpnext` (1.1.3),
`-dhis2` (8.3.1) and `-whatsapp` (1.1.3). The workflow uses
`@openfn/language-http` for all four instead, because:

- **Errors must say what went wrong.** The run fails loudly and names the
  cause (for example E-Buzima's "cannot overlap appointment", or a DHIS2
  import conflict). `language-erpnext` replaces E-Buzima's validation message
  with a generic one ("There was an error while fetching the documents"),
  which made failures in the previous iteration of this project hard to
  diagnose. With `language-http`, steps read the response body directly.
- **Per-facility E-Buzima tenants.** `language-erpnext` signs in once per
  step against the credential's fixed `baseUrl`. In production each health
  centre has its own E-Buzima; `language-http` takes absolute URLs, so a step
  can address any tenant without re-authenticating through the adaptor.
- **One set of conventions.** Every integration step handles requests,
  errors and credentials the same way, which keeps ten steps consistent and
  easy to review.

**What this gives up:** the dedicated adaptors' helpers (for example
`fhir.get` in `language-openmrs`, `create`/`metadata`/`tracker` in
`language-dhis2`), their typed credential forms in Lightning, and fixes
OpenFn ships in them. Steps look less like idiomatic OpenFn code.

**When to revisit:** if a dedicated adaptor starts passing through the
system's own error detail, or a step needs a helper that would be costly to
reproduce (for example DHIS2 Tracker), switch that step. The unit tests,
`make e2e` and a fresh-clone `make up` are the safety net for the change.

## Defaults for programme rules
These are configurable in `reference-data/settings.json`:

| Rule | Default |
|---|---|
| Referral appointment date | screening date + 1 day |
| Referral counts as completed | appointment status `Checked In`, `Checked Out` or `Closed` |
| Report cadence | hourly, or on demand via the webhook |
| Late-data window | previous month reported during the first 10 days |
