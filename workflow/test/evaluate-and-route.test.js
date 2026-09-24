import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStep, config, CONCEPTS, SITES } from './harness.js';

const screening = (overrides = {}) => ({
  encounter: 'enc-1',
  lastUpdated: '2026-09-24T08:00:00.000+00:00',
  date: '2026-09-24T08:00:00+00:00',
  site: SITES.kamonyi,
  siteName: 'Kamonyi Community Site',
  readings: {},
  patient: { uuid: 'pat-1', openmrsId: '100000Y', givenName: 'Alice', familyName: 'Uwase', sex: 'female', birthDate: '1970-05-01', phone: '+250781234567' },
  ...overrides,
});

const run = screenings => runStep('03-evaluate-and-route.js', { config: config(), screenings, failures: [] });

test('normal readings produce no referral', async () => {
  const state = await run([screening({ readings: { [CONCEPTS.systolic]: 120, [CONCEPTS.diastolic]: 80, [CONCEPTS.fasting]: 95 } })]);
  assert.equal(state.referrals.length, 0);
  assert.equal(state.failures.length, 0);
});

test('a reading exactly at the threshold is flagged', async () => {
  const state = await run([screening({ readings: { [CONCEPTS.systolic]: 140 } })]);
  assert.equal(state.referrals.length, 1);
  assert.equal(state.referrals[0].summary, 'Hypertension');
});

test('diastolic alone flags hypertension', async () => {
  const state = await run([screening({ readings: { [CONCEPTS.systolic]: 130, [CONCEPTS.diastolic]: 95 } })]);
  assert.deepEqual(state.referrals[0].conditions.map(c => c.name), ['Hypertension']);
  assert.equal(state.referrals[0].conditions[0].readings[0].label, 'Diastolic blood pressure');
});

test('glucose only flags diabetes (fasting and random thresholds differ)', async () => {
  const fasting = await run([screening({ readings: { [CONCEPTS.fasting]: 126 } })]);
  assert.equal(fasting.referrals[0].summary, 'Diabetes');
  const randomBelow = await run([screening({ readings: { [CONCEPTS.random]: 180 } })]);
  assert.equal(randomBelow.referrals.length, 0, '180 is below the random-glucose threshold of 200');
  const randomAbove = await run([screening({ readings: { [CONCEPTS.random]: 210 } })]);
  assert.equal(randomAbove.referrals[0].summary, 'Diabetes');
});

test('both conditions are summarised together', async () => {
  const state = await run([screening({ readings: { [CONCEPTS.systolic]: 160, [CONCEPTS.fasting]: 150 } })]);
  assert.equal(state.referrals[0].summary, 'Hypertension, Diabetes');
});

test('referrals are routed to the site\'s health centre, with reporting disaggregation', async () => {
  const state = await run([screening({ site: SITES.gitesi, readings: { [CONCEPTS.systolic]: 150 } })]);
  const [referral] = state.referrals;
  assert.equal(referral.facility, 'HC-2425');
  assert.equal(referral.sex, 'female');
  assert.equal(referral.ageGroup, 'AGE_40_59'); // born 1970-05-01, screened 2026-09-24: 56
});

test('age groups use the age on the screening date', async () => {
  const [before] = (await run([screening({ date: '2026-04-30T09:00:00+00:00', readings: { [CONCEPTS.systolic]: 150 }, patient: { ...screening().patient, birthDate: '1966-05-01' } })])).referrals;
  const [on] = (await run([screening({ date: '2026-05-01T09:00:00+00:00', readings: { [CONCEPTS.systolic]: 150 }, patient: { ...screening().patient, birthDate: '1966-05-01' } })])).referrals;
  assert.equal(before.ageGroup, 'AGE_40_59'); // 59 the day before the birthday
  assert.equal(on.ageGroup, 'AGE_60P'); // 60 on it
});

test('a flagged screening at an unrouted site is a failure, not retried', async () => {
  const state = await run([screening({ site: SITES.unrouted, siteName: 'Unrouted Community Site', readings: { [CONCEPTS.systolic]: 170 } })]);
  assert.equal(state.referrals.length, 0);
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].retry, false);
  assert.match(state.failures[0].error, /no health centre routing/);
});

test('a normal screening at an unrouted site is not a failure', async () => {
  const state = await run([screening({ site: SITES.unrouted, readings: { [CONCEPTS.systolic]: 110 } })]);
  assert.equal(state.failures.length, 0);
});

test('logs never contain patient names or phone numbers', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await run([screening({ site: SITES.unrouted, readings: { [CONCEPTS.systolic]: 170 } })]);
  } finally {
    console.log = original;
  }
  const output = lines.join('\n');
  assert.doesNotMatch(output, /Alice|Uwase|781234567/);
});
