// Step 9: Build the DHIS2 report
//
// Pure logic, no network: turns the month's screenings and referrals into
// data values for every facility × sex × age group, zeros included, so a
// resubmission always overwrites stale numbers. Unit tested in workflow/test.

const SEX = { male: 'SEX_MALE', female: 'SEX_FEMALE' };

function ageAt(birthDate, date) {
  const born = new Date(birthDate);
  const on = new Date(date);
  const age = on.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < born.getUTCMonth() ||
    (on.getUTCMonth() === born.getUTCMonth() && on.getUTCDate() < born.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

fn(state => {
  const { conditions, facilities, sites, settings } = state.config;
  const { ageGroups } = settings.reporting;
  const { completedStatuses } = settings.referral;
  const ageGroupOf = age => ageGroups.find(g => g.maxAge === null || age <= g.maxAge)?.code;

  const counts = new Map();
  const key = (dataElement, period, facility, sex, age) => [dataElement, period, facility, sex, age].join('|');
  const add = (...parts) => counts.set(key(...parts), (counts.get(key(...parts)) || 0) + 1);
  let excluded = 0;

  for (const s of state.periodScreenings) {
    const facility = sites[s.site];
    const sex = SEX[s.sex];
    const age = s.birthDate ? ageGroupOf(ageAt(s.birthDate, s.date)) : null;
    if (!facility || !sex || !age) {
      excluded++; // unrouted site, or sex/age that DHIS2 can't disaggregate
      continue;
    }
    add('NCD_SCREENED', s.period, facility, sex, age);
    for (const condition of conditions) {
      const elevated = condition.readings.some(r => typeof s.readings[r.concept] === 'number' && s.readings[r.concept] >= r.threshold);
      if (elevated) add(condition.dhis2, s.period, facility, sex, age);
    }
  }

  for (const r of state.periodReferrals) {
    const sex = SEX[r.custom_sex];
    if (!r.custom_facility_code || !sex || !r.custom_age_group) {
      excluded++;
      continue;
    }
    add('NCD_REFERRALS_ISSUED', r.period, r.custom_facility_code, sex, r.custom_age_group);
    if (completedStatuses.includes(r.status)) {
      add('NCD_REFERRALS_COMPLETED', r.period, r.custom_facility_code, sex, r.custom_age_group);
    }
  }

  const dataElements = ['NCD_SCREENED', ...conditions.map(c => c.dhis2), 'NCD_REFERRALS_ISSUED', 'NCD_REFERRALS_COMPLETED'];
  const values = [];
  for (const period of state.reportPeriods) {
    for (const facility of Object.keys(facilities)) {
      for (const dataElement of dataElements) {
        for (const sex of Object.values(SEX)) {
          for (const { code: age } of ageGroups) {
            values.push({ dataElement, period, orgUnit: facility, sex, age, value: counts.get(key(dataElement, period, facility, sex, age)) || 0 });
          }
        }
      }
    }
  }

  const nonZero = values.filter(v => v.value > 0).length;
  console.log(`Report: ${values.length} values (${nonZero} non-zero) for ${state.reportPeriods.join(', ')}; ${excluded} record(s) could not be disaggregated`);
  return { ...state, report: { dataSet: settings.reporting.dataSet, values, excluded } };
});
