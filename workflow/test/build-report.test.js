import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStep, config, CONCEPTS, SITES } from './harness.js';

const screening = (overrides = {}) => ({
  period: '202609',
  encounter: 'enc',
  date: '2026-09-10T08:00:00+00:00',
  site: SITES.kamonyi,
  sex: 'female',
  birthDate: '1970-05-01', // 56 in September 2026
  readings: {},
  ...overrides,
});

const referral = (overrides = {}) => ({
  period: '202609',
  name: 'HLC-APP-1',
  status: 'Open',
  custom_facility_code: 'HC-4152',
  custom_sex: 'female',
  custom_age_group: 'AGE_40_59',
  ...overrides,
});

async function build({ screenings = [], referrals = [], periods = ['202609'] } = {}) {
  const state = await runStep('09-build-report.js', {
    config: config(),
    reportPeriods: periods,
    periodScreenings: screenings,
    periodReferrals: referrals,
  });
  const value = (dataElement, orgUnit = 'HC-4152', sex = 'SEX_FEMALE', age = 'AGE_40_59', period = '202609') =>
    state.report.values.find(v => v.dataElement === dataElement && v.orgUnit === orgUnit && v.sex === sex && v.age === age && v.period === period).value;
  return { report: state.report, value };
}

test('every facility × data element × sex × age group is reported, zeros included', async () => {
  const { report } = await build();
  // 12 facilities × 5 data elements × 2 sexes × 3 age groups
  assert.equal(report.values.length, 12 * 5 * 2 * 3);
  assert.ok(report.values.every(v => v.value === 0));
  assert.equal(report.dataSet, 'NCD_COMMUNITY_SCREENING');
});

test('screenings are counted, and elevated readings counted per condition', async () => {
  const { value } = await build({
    screenings: [
      screening({ encounter: 'normal', readings: { [CONCEPTS.systolic]: 120 } }),
      screening({ encounter: 'bp', readings: { [CONCEPTS.systolic]: 150 } }),
      screening({ encounter: 'both', readings: { [CONCEPTS.diastolic]: 95, [CONCEPTS.random]: 220 } }),
      screening({ encounter: 'glucose-below', readings: { [CONCEPTS.random]: 199 } }),
    ],
  });
  assert.equal(value('NCD_SCREENED'), 4);
  assert.equal(value('NCD_ELEVATED_BP'), 2);
  assert.equal(value('NCD_ELEVATED_GLUCOSE'), 1);
});

test('screenings are attributed to the health centre their site routes to', async () => {
  const { value } = await build({ screenings: [screening({ site: SITES.gitesi, readings: { [CONCEPTS.systolic]: 150 } })] });
  assert.equal(value('NCD_SCREENED', 'HC-2425'), 1);
  assert.equal(value('NCD_SCREENED', 'HC-4152'), 0);
});

test('sex and age group disaggregate the counts', async () => {
  const { value } = await build({
    screenings: [
      screening({ sex: 'male', birthDate: '1995-01-01' }), // 31
      screening({ sex: 'female', birthDate: '1950-01-01' }), // 76
    ],
  });
  assert.equal(value('NCD_SCREENED', 'HC-4152', 'SEX_MALE', 'AGE_LT40'), 1);
  assert.equal(value('NCD_SCREENED', 'HC-4152', 'SEX_FEMALE', 'AGE_60P'), 1);
  assert.equal(value('NCD_SCREENED', 'HC-4152', 'SEX_FEMALE', 'AGE_40_59'), 0);
});

test('screenings that cannot be disaggregated are excluded and counted', async () => {
  const { report, value } = await build({
    screenings: [
      screening({ site: SITES.unrouted }),
      screening({ sex: 'unknown' }),
      screening({ birthDate: null }),
      screening(),
    ],
  });
  assert.equal(value('NCD_SCREENED'), 1);
  assert.equal(report.excluded, 3);
});

test('referrals issued and completed come from E-Buzima statuses', async () => {
  const { value } = await build({
    referrals: [
      referral({ status: 'Open' }),
      referral({ status: 'Scheduled' }),
      referral({ status: 'Checked In' }),
      referral({ status: 'Closed' }),
      referral({ status: 'No Show' }),
    ],
  });
  assert.equal(value('NCD_REFERRALS_ISSUED'), 5);
  assert.equal(value('NCD_REFERRALS_COMPLETED'), 2);
});

test('several months are reported separately', async () => {
  const { report, value } = await build({
    periods: ['202608', '202609'],
    screenings: [screening({ period: '202608' }), screening({ period: '202609' }), screening({ period: '202609' })],
  });
  assert.equal(report.values.length, 2 * 12 * 5 * 2 * 3);
  assert.equal(value('NCD_SCREENED', 'HC-4152', 'SEX_FEMALE', 'AGE_40_59', '202608'), 1);
  assert.equal(value('NCD_SCREENED', 'HC-4152', 'SEX_FEMALE', 'AGE_40_59', '202609'), 2);
});
