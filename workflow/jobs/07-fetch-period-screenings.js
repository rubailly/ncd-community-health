// Step 7: Fetch the reporting months' screenings (OpenMRS)
//
// Runs only when a DHIS2 report is due (see the edge condition). Fetches
// every NCD screening dated within the reporting months, with the patient's
// sex and birth date, so step 9 can count them. Months are Kigali months.

const PAGE_SIZE = 100;

function relative(url) {
  const { pathname, search } = new URL(url);
  return `${pathname.replace(/^.*?\/ws\//, 'ws/')}${search}`;
}

// First instant of a YYYYMM month in Kigali (UTC+2), as an ISO timestamp
function monthStart(period) {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(4, 6));
  return new Date(Date.UTC(y, m - 1, 1) - 2 * 3600000).toISOString();
}
const nextPeriod = period => {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(4, 6));
  return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`;
};

fn(async state => {
  const { encounterType } = state.config.settings.openmrs;
  const periodScreenings = [];

  for (const period of state.reportPeriods) {
    const resources = [];
    let path = 'ws/fhir2/R4/Encounter';
    let query = {
      type: encounterType,
      date: [`ge${monthStart(period)}`, `lt${monthStart(nextPeriod(period))}`],
      _include: 'Encounter:patient',
      _revinclude: 'Observation:encounter',
      _count: PAGE_SIZE,
    };
    while (path) {
      const { data: bundle } = await get(path, { query, headers: { Accept: 'application/fhir+json' } })(state);
      resources.push(...(bundle.entry || []).map(e => e.resource));
      const next = bundle.link?.find(l => l.relation === 'next')?.url;
      path = next ? relative(next) : null;
      query = undefined;
    }

    const patients = Object.fromEntries(resources.filter(r => r.resourceType === 'Patient').map(p => [p.id, p]));
    const readings = {};
    for (const obs of resources.filter(r => r.resourceType === 'Observation')) {
      const encounter = obs.encounter?.reference?.split('/')[1];
      const concept = obs.code?.coding?.find(c => !c.system)?.code;
      if (encounter && concept && obs.valueQuantity) { readings[encounter] = readings[encounter] || {}; readings[encounter][concept] = obs.valueQuantity.value; }
    }
    for (const encounter of resources.filter(r => r.resourceType === 'Encounter')) {
      const patient = patients[encounter.subject.reference.split('/')[1]];
      periodScreenings.push({
        period,
        encounter: encounter.id,
        date: encounter.period?.start,
        site: encounter.location?.[0]?.location?.reference?.split('/')[1],
        sex: patient?.gender,
        birthDate: patient?.birthDate,
        readings: readings[encounter.id] || {},
      });
    }
  }

  console.log(`${periodScreenings.length} screening(s) in ${state.reportPeriods.join(', ')}`);
  return { ...state, periodScreenings, data: undefined, response: undefined };
});
