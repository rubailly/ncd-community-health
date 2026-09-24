# 4. Fixed identifiers and one source of reference data

**Status:** accepted

## Context
Earlier iterations let systems generate random IDs at setup time and then
wrote them back into other systems, which made setup order-dependent and
caused silent failures.

## Decision
- **Facility code** (`code` in `reference-data/facilities.json`) is the key
  that links a health centre across systems: it is the DHIS2 organisation unit
  code, a field on the E-Buzima company, and the routing target for
  OpenMRS community sites.
- Every other ID is **declared in advance**: OpenMRS encounter type, locations
  and form UUIDs (via the Initializer module), DHIS2 UIDs (in the metadata
  file), concept UUIDs (standard CIEL).
- `reference-data/` is the single source of truth for thresholds, facilities
  and site routing. Bootstrap loads it into OpenFn Collections; the workflow
  reads it from there, so thresholds and routing can change without a
  redeploy.

## Consequences
- Setup has no ordering dependencies between systems.
- Adding a health centre is a change to reference data only.
