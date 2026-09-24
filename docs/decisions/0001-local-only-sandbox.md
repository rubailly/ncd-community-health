# 1. Everything runs locally

**Status:** accepted

## Context
The project is used by developers to build and demonstrate the NCD community
referral programme. Earlier iterations mixed a local sandbox with a
production deploy path that never worked, and depended on remote services at
runtime (e.g. cloning the Healthcare app from GitHub during setup).

## Decision
A developer clones the repository and runs `make up`. Every system (OpenMRS,
E-Buzima/ERPNext, DHIS2, OpenFn and a WhatsApp mock) runs on their machine,
connected to each other. There is no remote environment and no deploy
pipeline.

- Every image is pinned (by version, or by digest for moving upstream tags).
- Anything downloaded from the internet is downloaded at image **build** time,
  never while bootstrapping, so a bootstrap is repeatable offline once images
  exist.
- Configuration is declared in the repo and applied idempotently: running
  `make up` twice changes nothing the second time.

## Consequences
- The first run needs to download and build images; later runs are fast.
- The full stack needs roughly 10–12 GB of free RAM.
