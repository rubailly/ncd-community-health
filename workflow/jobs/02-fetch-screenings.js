// Step 2: Fetch screenings (OpenMRS)
//
// One FHIR search returns every NCD screening encounter changed since the
// cursor, with its patient (_include) and readings (_revinclude), a page at a
// time. Using _lastUpdated rather than the encounter date means screenings
// entered or corrected late are still picked up.

const PAGE_SIZE = 100;

// FHIR "next" links are absolute; the adaptor wants paths under its baseUrl
function relative(url) {
  const { pathname, search } = new URL(url);
  return `${pathname.replace(/^.*?\/ws\//, 'ws/')}${search}`;
}

function toScreenings(resources) {
  const byType = type => resources.filter(r => r.resourceType === type);
  const patients = Object.fromEntries(byType('Patient').map(p => [p.id, p]));
  const readings = {};
  for (const obs of byType('Observation')) {
    const encounter = obs.encounter?.reference?.split('/')[1];
    const concept = obs.code?.coding?.find(c => !c.system)?.code; // the OpenMRS concept UUID
    if (encounter && concept && obs.valueQuantity) {
      { readings[encounter] = readings[encounter] || {}; readings[encounter][concept] = obs.valueQuantity.value; }
    }
  }

  return byType('Encounter').map(encounter => {
    const patient = patients[encounter.subject.reference.split('/')[1]];
    const openmrsId = patient?.identifier?.find(i => i.use === 'official') || patient?.identifier?.[0];
    const name = patient?.name?.[0] || {};
    return {
      encounter: encounter.id,
      lastUpdated: encounter.meta?.lastUpdated,
      date: encounter.period?.start,
      site: encounter.location?.[0]?.location?.reference?.split('/')[1],
      siteName: encounter.location?.[0]?.location?.display,
      readings: readings[encounter.id] || {},
      patient: patient && {
        uuid: patient.id,
        openmrsId: openmrsId?.value,
        givenName: (name.given || []).join(' '),
        familyName: name.family || '',
        sex: patient.gender, // male | female | other | unknown
        birthDate: patient.birthDate,
        phone: patient.telecom?.find(t => t.system === 'phone' || !t.system)?.value,
      },
    };
  });
}

fn(async state => {
  const { encounterType } = state.config.settings.openmrs;
  const resources = [];
  let path = 'ws/fhir2/R4/Encounter';
  let query = {
    type: encounterType,
    _lastUpdated: `ge${state.cursor}`,
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

  // Skip boundary screenings the previous run already handled, unless changed since
  const atCursor = s => new Date(s.lastUpdated).getTime() === new Date(state.cursor).getTime();
  const screenings = toScreenings(resources).filter(s => !(atCursor(s) && state.alreadySeen.includes(s.encounter)));
  console.log(`${screenings.length} screening(s) changed since ${state.cursor}`);
  return { ...state, screenings, data: undefined, response: undefined };
});
