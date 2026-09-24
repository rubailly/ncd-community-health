// Adds a set of demo screenings to OpenMRS: mostly normal readings, some
// high enough to be referred, across several community sites. Each run adds
// new patients; the workflow picks them up on its next run (or `make trigger`).

import { section, step, main, green } from './lib/steps.js';
import { createPatient, createScreening } from './systems/openmrs.js';

const SBP = '5085AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DBP = '5086AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FBG = '160912AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const RBG = '887AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const SITES = {
  Kamonyi: '8933971e-14fe-4f0d-96a7-6bc566c5dd4f',
  Musambira: '0e251307-fee3-4c16-99c3-32f6457a1724',
  Kamembe: 'c45bcd67-ef07-4fb2-9633-92c3515ff4e8',
  Shangi: '90f57546-4654-4586-a804-b14bea5978f9',
  Gitesi: '79227d8e-12d2-4f4b-a5a5-42d3f5e90495',
};

// given, family, sex, birthdate, phone, site, readings
const PEOPLE = [
  ['Jean', 'Habimana', 'M', '1968-02-11', '+250781000101', 'Kamonyi', { [SBP]: 162, [DBP]: 98 }],
  ['Marie', 'Uwimana', 'F', '1975-07-23', '+250781000102', 'Kamonyi', { [SBP]: 118, [DBP]: 76, [FBG]: 92 }],
  ['Pierre', 'Nkurunziza', 'M', '1959-11-02', '+250781000103', 'Musambira', { [SBP]: 132, [DBP]: 84, [FBG]: 148 }],
  ['Alice', 'Mukamana', 'F', '1981-04-30', '+250781000104', 'Musambira', { [SBP]: 155, [DBP]: 95, [RBG]: 214 }],
  ['Robert', 'Bizimana', 'M', '1990-09-15', null, 'Kamembe', { [RBG]: 236 }],
  ['Diane', 'Ingabire', 'F', '1993-01-19', '+250781000106', 'Kamembe', { [SBP]: 121, [DBP]: 79 }],
  ['Claude', 'Nzeyimana', 'M', '1952-06-08', '+250781000107', 'Shangi', { [SBP]: 176, [DBP]: 104 }],
  ['Grace', 'Mutoni', 'F', '1987-12-01', '+250781000108', 'Shangi', { [SBP]: 114, [DBP]: 72, [FBG]: 88 }],
  ['Eric', 'Ndayisaba', 'M', '1971-03-27', '+250781000109', 'Gitesi', { [SBP]: 128, [DBP]: 82, [RBG]: 162 }],
  ['Josiane', 'Uwase', 'F', '1964-08-14', '+250781000110', 'Gitesi', { [SBP]: 141, [DBP]: 88 }],
];

main(async () => {
  section('Demo screenings in OpenMRS');
  for (const [givenName, familyName, gender, birthdate, phone, site, readings] of PEOPLE) {
    await step(`${givenName} ${familyName} at ${site} Community Site`, async () => {
      const patient = await createPatient({ givenName, familyName, gender, birthdate, phone });
      await createScreening({ patient: patient.uuid, site: SITES[site], readings });
      return patient.openmrsId;
    });
  }
  console.log(`\n${green('Seeded.')} Run \`make trigger\` to process them now, or wait for the 15-minute schedule.`);
});
