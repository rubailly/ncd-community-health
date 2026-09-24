# 3. DHIS2 receives monthly aggregates, not patient records

**Status:** accepted

## Context
DHIS2 is the national reporting platform. It could receive individual
records (Tracker) or aggregate counts.

## Decision
The workflow reports a monthly **Community NCD Screening** data set per health
centre, disaggregated by sex × age group (`<40`, `40–59`, `60+`):

| Data element | Source | Rule |
|---|---|---|
| People screened | OpenMRS | NCD screening encounters in the month |
| Elevated blood pressure | OpenMRS | Any configured BP threshold met |
| Elevated blood glucose | OpenMRS | Any configured glucose threshold met |
| Referrals issued | E-Buzima | NCD referral appointments for screenings in the month |
| Referrals completed | E-Buzima | Of those, appointments the patient attended |

DHIS2 computes **screening positivity** and **referral completion rate**.

- Values are **recomputed from the source systems** on each report and sent
  with explicit zeros; DHIS2 overwrites them. Reruns are always safe.
- The current month is always reported; the previous month too during the
  first 10 days, so late entries are counted.
- A screening is attributed to the month of the screening, and to the health
  centre its community site routes to.

## Consequences
- No patient-identifying data leaves the clinical systems.
- Individual-level tracking (DHIS2 Tracker) is out of scope; it needs a
  programme decision on consent and data protection.
