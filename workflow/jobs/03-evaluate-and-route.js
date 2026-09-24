// Step 3: Evaluate & route
//
// Pure logic, no network: checks each screening's readings against the
// configured thresholds, and routes flagged screenings to the health centre
// their community site belongs to. Unit tested in workflow/test.

function ageAt(birthDate, date) {
  const born = new Date(birthDate);
  const on = new Date(date);
  let age = on.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < born.getUTCMonth() ||
    (on.getUTCMonth() === born.getUTCMonth() && on.getUTCDate() < born.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

function ageGroup(age, groups) {
  return groups.find(g => g.maxAge === null || age <= g.maxAge)?.code;
}

// Conditions whose thresholds any reading meets, with the readings that did
function evaluate(readings, conditions) {
  return conditions
    .map(condition => ({
      name: condition.name,
      readings: condition.readings
        .filter(r => typeof readings[r.concept] === 'number' && readings[r.concept] >= r.threshold)
        .map(r => ({ label: r.label, value: readings[r.concept], unit: r.unit, threshold: r.threshold })),
    }))
    .filter(c => c.readings.length);
}

fn(state => {
  const { conditions, facilities, sites, settings } = state.config;
  const referrals = [];
  const failures = [...state.failures];

  for (const screening of state.screenings) {
    const flagged = evaluate(screening.readings, conditions);
    if (!flagged.length) continue;

    const ref = `screening ${screening.encounter} (patient ${screening.patient?.openmrsId ?? 'unknown'})`;
    const facility = facilities[sites[screening.site]];
    if (!facility) {
      // Not retried automatically: fix reference-data/sites, then rerun with { "since": ... }
      failures.push({ step: 'route', ref, retry: false, error: `site ${screening.siteName} (${screening.site}) has no health centre routing` });
      continue;
    }
    if (!screening.patient) {
      failures.push({ step: 'route', ref, retry: true, error: 'patient record missing from the FHIR response' });
      continue;
    }

    const age = screening.patient.birthDate ? ageAt(screening.patient.birthDate, screening.date) : null;
    referrals.push({
      ...screening,
      facility: facility.code,
      conditions: flagged,
      summary: flagged.map(c => c.name).join(', '),
      sex: screening.patient.sex,
      ageGroup: age === null ? null : ageGroup(age, settings.reporting.ageGroups),
    });
  }

  console.log(`${referrals.length} of ${state.screenings.length} screening(s) need a referral`);
  for (const f of failures.filter(f => f.step === 'route')) console.log(`  cannot route ${f.ref}: ${f.error}`);
  return { ...state, referrals, failures };
});
