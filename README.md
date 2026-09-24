# NCD Community Health

Community health workers screen people for hypertension and diabetes. When a
reading is high, the person is referred to their health centre, the health
centre and the patient are told on WhatsApp, and the programme's figures
reach the national reporting platform every hour.

This repository runs that whole programme **on your machine**: every system,
connected, configured and tested by one command.

```
                    ┌─────────────────────────── OpenFn workflow (every 15 min) ───────────────────────────┐
 Health worker      │                                                                                        │
 ─► OpenMRS 3 ──────┼─► screenings ─► thresholds & routing ─► referral ──────────► E-Buzima (ERPNext + Healthcare)
    (screening)     │                                            │                  (health centre)
                    │                                            └─► WhatsApp ────► health centre & patient
                    │                                                                                        │
                    └─► monthly counts (screened, elevated, referred, attended) ──► DHIS2 (national reporting)
```

| System | Role | URL | Sign in |
|---|---|---|---|
| OpenMRS 3 | Community screening | http://localhost:8080/openmrs/spa | `admin` / see `.env` |
| E-Buzima | Health centre referrals | http://localhost:8000 | `Administrator` / see `.env` |
| DHIS2 | National reporting | http://localhost:8081 | `admin` / see `.env` |
| OpenFn Lightning | The integration workflow | http://localhost:4000 | `OPENFN_ADMIN_EMAIL` / see `.env` |
| WhatsApp mock | Messages that would be sent | http://localhost:9000 | none |

## Quick start

You need Docker (with Compose 2.20 or later), Node.js 20+, GNU make, and
about 12 GB of free memory.

```bash
git clone https://github.com/rubailly/ncd-community-health.git
cd ncd-community-health
make up        # start, wait until healthy, configure every system
make e2e       # prove the whole programme works end to end
```

The first `make up` downloads the images (several GB) and builds E-Buzima,
which can take a while on a slow connection. After that, a start from empty
databases takes about 4 minutes. `make up` creates `.env` with generated
secrets on first run; every password you need is in it. Run `make up` as
often as you like: it only changes what isn't already in place.

## See it work

```bash
make seed      # add 10 demo screenings across five community sites
make trigger   # run the workflow now, instead of waiting for the schedule
```

Then look at each system:

1. **OpenMRS**: the new patients and their *NCD Community Screening* encounters.
   The *NCD Community Screening* form is installed too, for entering screenings by hand.
2. **E-Buzima** → Healthcare → Patient Appointment: a referral for every high
   reading, at the right health centre, with the readings in the notes.
3. **WhatsApp mock** (http://localhost:9000): the health centre and patient messages.
4. **OpenFn** → the *NCD Community Referral & Reporting* workflow: the run and its log.
5. **DHIS2** → Data Entry (or the API): the *Community NCD Screening* data set,
   by health centre, sex and age group. Run `make trigger` with a report to
   update it now: `node tools/trigger.js '{"report": true}'`.

## How it's built

**One workflow, two branches.** The programme is a single OpenFn workflow
([docs/decisions/0002](docs/decisions/0002-one-workflow.md)):

```
cron (15 min) ─┐
webhook ───────┴─► 1 Load config & cursor ─┬─► 2 Fetch screenings ─► 3 Evaluate & route ─► 4 Create referrals ─► 5 Notify ─► 6 Record & advance cursor
                                           └─► [report due] 7 Fetch month's screenings ─► 8 Fetch month's referrals ─► 9 Build report ─► 10 Push to DHIS2
```

**Safe to run again, always.** Referrals are keyed by the OpenMRS encounter
(unique in E-Buzima); each WhatsApp message is recorded once sent; DHIS2
figures are recomputed from the source systems and overwritten. A run that
fails is simply retried by the next one, and never duplicates anything.

**Loud when something is wrong.** A run fails if any screening couldn't be
referred or any message couldn't be sent, and says which one and why. Logs
identify patients by OpenMRS ID only.

**One source of truth.** Thresholds, health centres, site routing and
programme rules live in [`reference-data/`](reference-data/). Each system is
configured through its own supported mechanism, with identifiers fixed in
advance, so nothing depends on the order things were set up in
([0004](docs/decisions/0004-identifiers-and-reference-data.md)).

**Reporting.** DHIS2 receives monthly aggregates, not patient records
([0003](docs/decisions/0003-dhis2-aggregate-reporting.md)).

```
workflow/            the OpenFn project: project.yaml, one file per step, unit tests
reference-data/      thresholds, facilities, site routing, settings, DHIS2 metadata
sandbox/             how each system runs locally
  openmrs/             no-demo distribution + Initializer config (concepts, sites, form…)
  erpnext/             ERPNext image with the Healthcare app baked in
  dhis2/  openfn/      DHIS2 and Lightning, pinned
  whatsapp-mock/       a stand-in for the WhatsApp Cloud API
tools/               bootstrap, seed, trigger and the end-to-end test (Node, one dependency)
docs/                decision records and the runbook
```

## Everyday commands

| Command | What it does |
|---|---|
| `make up` | Start everything, wait until healthy, configure it |
| `make deploy` | After editing `workflow/` or `reference-data/`: redeploy |
| `make test` | Unit tests of the workflow's logic (no sandbox needed) |
| `make e2e` | End-to-end test against the running sandbox |
| `make seed` | Add demo screenings |
| `make trigger` | Run the workflow now and print its log |
| `make ps` / `make logs s=openfn` | Status / follow a service's logs |
| `make down` | Stop (data is kept) |
| `make reset` | Stop and delete all data (`make up` starts fresh) |

## Changing things

- **A threshold, health centre or site**: edit `reference-data/`, then `make deploy`.
  A new health centre also needs `make bootstrap`, which creates it in E-Buzima and DHIS2.
- **A workflow step**: edit `workflow/jobs/`, run `make test`, then `make deploy`
  and `make e2e`.
- **A new community site**: add it to `sandbox/openmrs/initializer/locations/`
  and `reference-data/sites/local.json`, then `make up`.

For failed runs, reprocessing and other operations, see the
[runbook](docs/runbook.md).
