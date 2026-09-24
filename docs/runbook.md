# Runbook

## A run failed

Open the run in OpenFn (the link is printed by `make trigger`, or find it
under the workflow's *History*). Step 6 lists every problem as
`[step] reference: reason`. Nothing needs undoing: every write is
idempotent, and retryable problems hold the cursor, so the next run tries
them again.

| Problem | What to do |
|---|---|
| `[route] … has no health centre routing` | The community site isn't in `reference-data/sites/local.json`. Add it, `make deploy`, then reprocess (below). Not retried automatically. |
| `[refer] …` | E-Buzima rejected the referral; the reason follows. Fix the cause; the next run retries. |
| `[notify] …` | WhatsApp rejected a message (e.g. an invalid number). The next run retries only the messages not yet delivered. |
| `DHIS2 import … E7641/E7644` | DHIS2 refused the period. Check the data set's open periods; after changing metadata, `make bootstrap` (it clears DHIS2's cache). |

## Reprocess screenings

Run the workflow with a start time; screenings changed since then are
processed again. Nothing is duplicated, and the regular cursor isn't moved
forward.

```bash
node tools/trigger.js '{"since": "2026-09-01T00:00:00Z"}'
```

## Report to DHIS2 now

```bash
node tools/trigger.js '{"report": true}'                  # this month (and last, early in a month)
node tools/trigger.js '{"periods": ["202608", "202609"]}'  # specific months
```

## Where the workflow keeps its state

The `ncd-state` Collection in OpenFn holds `cursor` (the last screening
time processed, plus the screenings handled at exactly that time) and
`last-report-at`. Deleting `cursor` makes the next run look back
`initialLookbackDays` (30) days; deleting `last-report-at` triggers a report.

## Start again from nothing

```bash
make reset && make up
```

`.env` is kept, so passwords don't change. Delete it too for new secrets.

## First start is slow, or fails

- **Building E-Buzima** downloads ERPNext and the Healthcare app; it takes a
  few minutes once, then is cached. The Healthcare download is retried if
  GitHub is unreachable.
- **Ports in use**: change them in `.env` (`OPENMRS_PORT` and so on), then `make up`.
- **Not enough memory**: the stack needs about 12 GB. `make ps` shows which
  service isn't healthy; `make logs s=<service>` says why.

## Known limits

- The E-Buzima credential and WhatsApp numbers are local stand-ins; there is
  no production environment.
- Lightning's REST workflows API accepts only one enabled trigger edge per
  workflow. This workflow has two (schedule and webhook), set up through
  provisioning; Lightning runs both. Worth confirming with OpenFn's product
  team (Brandon's team) that this is supported going forward.
- Two things are set through Lightning's internal functions because it has
  no API for them: creating the first user (`Lightning.Setup.setup_user`)
  and the workflow's one-run-at-a-time limit. Both are in
  `tools/systems/openfn.js`.
