// End-to-end test: creates screenings in OpenMRS, runs the workflow, and
// checks the outcome in E-Buzima, the WhatsApp mock and DHIS2.
//
// Test patients get a unique tag, so the test can run against a sandbox that
// already holds data, and the scheduled runs can't interfere with it.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { section, step, main, green } from './lib/steps.js';
import { env, urls, readJson } from './lib/config.js';
import { request } from './lib/http.js';
import { runWorkflow } from './lib/runs.js';
import { createPatient, createScreening } from './systems/openmrs.js';

const C = {
  systolic: '5085AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  diastolic: '5086AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  fasting: '160912AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  random: '887AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};
const SITE = {
  kamonyi: '8933971e-14fe-4f0d-96a7-6bc566c5dd4f', // HC-4152 Kamonyi Health Center
  gitesi: '79227d8e-12d2-4f4b-a5a5-42d3f5e90495', // HC-2425 Gitesi Health Center
  unrouted: '76ad4192-5094-48a5-8ce2-94083e58bd6e',
};

const tag = randomBytes(3).toString('hex').toUpperCase();
const phone = n => `+25078${String(parseInt(tag, 16) % 10000).padStart(4, '0')}${n}${n}${n}`;

const CASES = [
  { key: 'bp', given: 'Hypertension', site: SITE.kamonyi, facility: 'HC-4152', phone: phone(1), readings: { [C.systolic]: 168, [C.diastolic]: 104 }, expect: 'Hypertension' },
  { key: 'glucose', given: 'Glucose', site: SITE.gitesi, facility: 'HC-2425', phone: phone(2), readings: { [C.random]: 212 }, expect: 'Diabetes' },
  { key: 'both', given: 'Both', site: SITE.kamonyi, facility: 'HC-4152', phone: phone(3), readings: { [C.systolic]: 150, [C.fasting]: 140 }, expect: 'Hypertension, Diabetes' },
  { key: 'nophone', given: 'Nophone', site: SITE.gitesi, facility: 'HC-2425', phone: null, readings: { [C.diastolic]: 96 }, expect: 'Hypertension' },
  { key: 'normal', given: 'Normal', site: SITE.kamonyi, phone: phone(4), readings: { [C.systolic]: 118, [C.diastolic]: 76, [C.fasting]: 92 }, expect: null },
  { key: 'unrouted', given: 'Unrouted', site: SITE.unrouted, phone: phone(5), readings: { [C.systolic]: 175 }, expect: 'routing-error' },
];

const erpnext = (path, query) =>
  request('GET', `${urls.erpnext}/api/resource/${encodeURIComponent(path)}`, {
    query,
    headers: { Authorization: `token ${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}` },
  }).then(r => r.data.data);

async function appointmentFor(encounter) {
  const [appointment] = await erpnext('Patient Appointment', {
    filters: JSON.stringify([['custom_openmrs_encounter_uuid', '=', encounter]]),
    fields: JSON.stringify(['name', 'company', 'custom_facility_code', 'custom_conditions', 'custom_hc_notified_at', 'custom_patient_notified_at']),
  });
  return appointment;
}

const messagesTo = async number =>
  number ? (await request('GET', `${urls.whatsapp}/messages`, { query: { to: number } })).data : [];

main(async () => {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const facilities = Object.fromEntries(readJson('reference-data/facilities.json').facilities.map(f => [f.code, f]));
  console.log(`Test run ${tag}`);

  section('Arrange: screenings in OpenMRS');
  for (const c of CASES) {
    await step(`${c.key}: ${c.given} Test-${tag}`, async () => {
      const patient = await createPatient({ givenName: c.given, familyName: `Test-${tag}`, gender: 'F', birthdate: '1968-03-15', phone: c.phone });
      c.encounter = await createScreening({ patient: patient.uuid, site: c.site, readings: c.readings });
      c.openmrsId = patient.openmrsId;
      return patient.openmrsId;
    });
  }

  section('Act: run the workflow');
  let first;
  await step('first run', async () => {
    first = await runWorkflow({ since: startedAt });
    return first.state;
  });

  section('Assert: referrals in E-Buzima');
  await step('the run fails, reporting only the unrouted screening', async () => {
    assert.equal(first.state, 'failed', 'a run with a routing problem must fail');
    const unrouted = CASES.find(c => c.key === 'unrouted');
    const problems = first.logs.map(l => String(l.message)).find(m => m.includes('problem(s) this run')) || '';
    assert.match(problems, new RegExp(unrouted.encounter), 'the unrouted screening is named');
    assert.match(problems, /1 problem\(s\)/, 'and it is the only problem');
  });
  for (const c of CASES) {
    await step(`${c.key}: ${c.expect && c.expect !== 'routing-error' ? `referred to ${c.facility} for ${c.expect}` : 'no referral'}`, async () => {
      const appointment = await appointmentFor(c.encounter);
      if (!c.expect || c.expect === 'routing-error') return assert.equal(appointment, undefined);
      assert.ok(appointment, 'appointment exists');
      assert.equal(appointment.custom_facility_code, c.facility);
      assert.equal(appointment.company, facilities[c.facility].name);
      assert.equal(appointment.custom_conditions, c.expect);
      assert.ok(appointment.custom_hc_notified_at, 'health centre notification recorded');
      assert.ok(appointment.custom_patient_notified_at, 'patient notification recorded (or marked not needed)');
    });
  }

  section('Assert: WhatsApp notifications');
  for (const c of CASES.filter(c => c.expect && c.expect !== 'routing-error')) {
    await step(`${c.key}: ${c.phone ? 'patient notified once' : 'no patient message (no phone)'}`, async () => {
      const sent = await messagesTo(c.phone);
      assert.equal(sent.length, c.phone ? 1 : 0);
      if (c.phone) {
        assert.equal(sent[0].payload.template.name, 'ncd_referral_patient_notify');
        assert.deepEqual(sent[0].payload.template.components[0].parameters.map(p => p.text), [c.given, new Date().toISOString().slice(0, 10), facilities[c.facility].name]);
      }
    });
  }
  await step('each health centre notified once per referral', async () => {
    for (const code of ['HC-4152', 'HC-2425']) {
      const sent = (await messagesTo(facilities[code].whatsapp)).filter(m => m.payload.template.components[0].parameters[1].text.includes(tag));
      const expected = CASES.filter(c => c.facility === code && c.expect && c.expect !== 'routing-error').length;
      assert.equal(sent.length, expected, `${code}: ${sent.length} messages, expected ${expected}`);
    }
  });
  await step('normal and unrouted screenings trigger no messages', async () => {
    for (const c of CASES.filter(c => !c.expect || c.expect === 'routing-error')) assert.equal((await messagesTo(c.phone)).length, 0);
  });

  section('Assert: reruns are idempotent');
  await step('second run over the same screenings', async () => {
    const second = await runWorkflow({ since: startedAt });
    const log = second.logs.map(l => String(l.message)).join('\n');
    assert.match(log, /Referrals: 0 created, 4 already existed, 0 failed/);
    assert.match(log, /WhatsApp: 0 message\(s\) sent/);
    for (const c of CASES) assert.ok((await messagesTo(c.phone)).length <= 1, `${c.key}: no duplicate messages`);
    return second.state;
  });

  console.log(`\n${green('End-to-end test passed')} (${tag})`);
});
