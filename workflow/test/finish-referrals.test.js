import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStep } from './harness.js';

// Stubs for the adaptor functions step 6 calls
function stubs() {
  const saved = {};
  const stamped = [];
  return {
    saved,
    stamped,
    globals: {
      put: (path, body) => async state => (stamped.push({ path, body }), state),
      collections: { set: (name, key, value) => async state => ((saved[`${name}/${key}`] = JSON.parse(value)), state) },
    },
  };
}

const screening = (encounter, lastUpdated) => ({ encounter, lastUpdated });
const base = {
  configuration: { apiKey: 'k', apiSecret: 's' },
  runStartedAt: '2026-09-24T10:00:00.000Z',
  storedCursor: { at: '2026-09-24T08:00:00.000+00:00', seen: [] },
  reprocessing: false,
  delivered: [],
  failures: [],
};

test('with no failures, the cursor moves to the latest screening', async () => {
  const { saved, globals } = stubs();
  await runStep('06-finish-referrals.js', {
    ...base,
    screenings: [screening('a', '2026-09-24T08:30:00.000+00:00'), screening('b', '2026-09-24T09:15:00.000+00:00')],
  }, globals);
  assert.deepEqual(saved['ncd-state/cursor'], { at: '2026-09-24T09:15:00.000+00:00', seen: ['b'] });
});

test('a retryable failure holds the cursor at the earliest failed screening, and fails the run', async () => {
  const { saved, globals } = stubs();
  const run = runStep('06-finish-referrals.js', {
    ...base,
    screenings: [screening('a', '2026-09-24T08:30:00.000+00:00'), screening('b', '2026-09-24T09:15:00.000+00:00')],
    failures: [{ step: 'refer', ref: 'screening a (patient X)', retry: true, error: 'E-Buzima down' }],
  }, globals);
  await assert.rejects(run, /1 problem\(s\) this run/);
  assert.deepEqual(saved['ncd-state/cursor'], { at: '2026-09-24T08:30:00.000+00:00', seen: [] }, 'held at a, not advanced to b');
});

test('a non-retryable failure (unrouted site) does not hold the cursor', async () => {
  const { saved, globals } = stubs();
  const run = runStep('06-finish-referrals.js', {
    ...base,
    screenings: [screening('a', '2026-09-24T08:30:00.000+00:00'), screening('b', '2026-09-24T09:15:00.000+00:00')],
    failures: [{ step: 'route', ref: 'screening a (patient X)', retry: false, error: 'no routing' }],
  }, globals);
  await assert.rejects(run, /no routing/);
  assert.deepEqual(saved['ncd-state/cursor'], { at: '2026-09-24T09:15:00.000+00:00', seen: ['b'] });
});

test('an unroutable screening at the boundary is remembered, so it fails only once', async () => {
  const { saved, globals } = stubs();
  await assert.rejects(runStep('06-finish-referrals.js', {
    ...base,
    screenings: [screening('a', '2026-09-24T08:30:00.000+00:00'), screening('u', '2026-09-24T09:15:00.000+00:00')],
    failures: [{ step: 'route', ref: 'screening u (patient X)', retry: false, error: 'no routing' }],
  }, globals));
  assert.deepEqual(saved['ncd-state/cursor'], { at: '2026-09-24T09:15:00.000+00:00', seen: ['u'] });
});

test('screenings sharing the boundary timestamp accumulate in `seen`', async () => {
  const { saved, globals } = stubs();
  await runStep('06-finish-referrals.js', {
    ...base,
    storedCursor: { at: '2026-09-24T09:15:00.000+00:00', seen: ['x'] },
    screenings: [screening('y', '2026-09-24T09:15:00.000+00:00')],
  }, globals);
  assert.deepEqual(saved['ncd-state/cursor'], { at: '2026-09-24T09:15:00.000+00:00', seen: ['x', 'y'] });
});

test('a reprocessing run never moves the cursor forward', async () => {
  const { saved, globals } = stubs();
  await runStep('06-finish-referrals.js', {
    ...base,
    reprocessing: true,
    screenings: [screening('a', '2026-09-24T09:15:00.000+00:00')],
  }, globals);
  assert.equal(saved['ncd-state/cursor'], undefined, 'stored cursor left unchanged');
});

test('a reprocessing run moves the cursor back to an earlier failure', async () => {
  const { saved, globals } = stubs();
  await assert.rejects(runStep('06-finish-referrals.js', {
    ...base,
    reprocessing: true,
    screenings: [screening('a', '2026-09-24T07:10:00.000+00:00')],
    failures: [{ step: 'refer', ref: 'screening a (patient X)', retry: true, error: 'timeout' }],
  }, globals));
  assert.deepEqual(saved['ncd-state/cursor'], { at: '2026-09-24T07:10:00.000+00:00', seen: [] });
});

test('delivered messages are stamped separately for health centre and patient', async () => {
  const { stamped, globals } = stubs();
  await runStep('06-finish-referrals.js', {
    ...base,
    screenings: [],
    delivered: [{ appointment: 'HLC-APP-1', hc: true, patient: true }, { appointment: 'HLC-APP-2', hc: true }],
  }, globals);
  assert.deepEqual(stamped.map(s => Object.keys(s.body)), [['custom_hc_notified_at', 'custom_patient_notified_at'], ['custom_hc_notified_at']]);
  assert.equal(stamped[0].body.custom_hc_notified_at, '2026-09-24 10:00:00');
});
