# NCD Community Health

Community screening for hypertension and diabetes, referral to health
centres, and national reporting, all running on your machine:

| System | Role | URL |
|---|---|---|
| OpenMRS 3 | Community screening | http://localhost:8080/openmrs/spa |
| E-Buzima (ERPNext + Healthcare) | Health centre referrals | http://localhost:8000 |
| DHIS2 | National reporting | http://localhost:8081 |
| OpenFn Lightning | The integration workflow | http://localhost:4000 |
| WhatsApp mock | Notifications | http://localhost:9000 |

> Work in progress: the sandbox runs; bootstrap, the workflow and tests are
> being added phase by phase. See `docs/decisions/` for the design.

## Quick start

Requirements: Docker with Compose v2.20+, Node.js 20+, GNU make, ~12 GB free RAM.

```bash
make up      # first run builds the E-Buzima image and initialises databases
make ps      # status of every service
make down    # stop (data is kept)
make reset   # stop and delete all data
```
