// OpenMRS: the programme's metadata is declared as Initializer config
// (sandbox/openmrs/initializer), so bootstrap only verifies it loaded and
// adds what Initializer can't: a provider for the admin user, which the
// screening form requires.

import { env, urls, readJson } from '../lib/config.js';
import { request, basicAuth, waitFor } from '../lib/http.js';

const auth = { Authorization: basicAuth(env.OPENMRS_ADMIN_USER, env.OPENMRS_ADMIN_PASSWORD) };
const rest = (method, path, options = {}) =>
  request(method, `${urls.openmrs}/ws/rest/v1/${path}`, { ...options, headers: { ...auth, ...options.headers } });

const fhir = (path, query) =>
  request('GET', `${urls.openmrs}/ws/fhir2/R4/${path}`, { query, headers: { ...auth, Accept: 'application/fhir+json' } });

export const openmrs = { rest, fhir };

export async function ready() {
  await waitFor('OpenMRS REST API', async () => (await rest('GET', 'session')).data.authenticated, { timeout: 1_800_000 });
}

async function exists(path) {
  const { status } = await rest('GET', path, { ok: s => s === 200 || s === 404 });
  return status === 200;
}

export async function verifyConcepts() {
  const { conditions } = readJson('reference-data/conditions.json');
  const concepts = conditions.flatMap(c => c.readings.map(r => r.concept));
  const missing = [];
  for (const uuid of concepts) if (!(await exists(`concept/${uuid}`))) missing.push(uuid);
  if (missing.length) throw new Error(`concepts not loaded: ${missing.join(', ')}`);
  return `${concepts.length} concepts`;
}

export async function verifyEncounterType() {
  const { openmrs: ids } = readJson('reference-data/settings.json');
  if (!(await exists(`encountertype/${ids.encounterType}`))) throw new Error(`encounter type ${ids.encounterType} not loaded`);
  return 'NCD Community Screening';
}

export async function verifySites() {
  const sites = Object.keys(readJson('reference-data/sites/local.json')).filter(k => !k.startsWith('$'));
  const missing = [];
  for (const uuid of sites) if (!(await exists(`location/${uuid}`))) missing.push(uuid);
  if (missing.length) throw new Error(`screening sites not loaded: ${missing.join(', ')}`);
  return `${sites.length} routed sites`;
}

export async function verifyForm() {
  const { data } = await rest('GET', 'form', { query: { q: 'NCD Community Screening', v: 'custom:(uuid,published,resources:(name))' } });
  const form = data.results[0];
  if (!form) throw new Error('NCD Community Screening form not loaded');
  if (!form.resources.some(r => r.name === 'JSON schema')) throw new Error('form has no JSON schema resource');
  return form.uuid;
}

// The O3 form engine records the logged-in user's provider on each encounter
export async function ensureAdminProvider() {
  const identifier = `NCD-${env.OPENMRS_ADMIN_USER}`;
  const { data } = await rest('GET', 'provider', { query: { q: identifier, v: 'custom:(uuid,identifier)' } });
  if (data.results.some(p => p.identifier === identifier)) return 'exists';
  const { data: user } = await rest('GET', 'user', { query: { username: env.OPENMRS_ADMIN_USER, v: 'custom:(person:(uuid))' } });
  const person = user.results[0]?.person?.uuid;
  if (!person) throw new Error(`user ${env.OPENMRS_ADMIN_USER} not found`);
  await rest('POST', 'provider', { body: { person, identifier } });
  return 'created';
}

// ── Test data (used by `make seed` and the end-to-end test) ─────────────────

const PHONE_ATTRIBUTE = '14d4f066-15f5-102d-96e4-000c29c2a5d7';
const OPENMRS_ID_SOURCE = '8549f706-7e85-4c1d-9424-217d50a2988b';

export async function createPatient({ givenName, familyName, gender, birthdate, phone }) {
  const settings = readJson('reference-data/settings.json');
  const { data: id } = await rest('POST', `idgen/identifiersource/${OPENMRS_ID_SOURCE}/identifier`, { body: {} });
  const { data: patient } = await rest('POST', 'patient', {
    body: {
      person: {
        names: [{ givenName, familyName }],
        gender,
        birthdate,
        attributes: phone ? [{ attributeType: PHONE_ATTRIBUTE, value: phone }] : [],
      },
      identifiers: [{ identifier: id.identifier, identifierType: settings.openmrs.openmrsIdType, preferred: true }],
    },
  });
  return { uuid: patient.uuid, openmrsId: id.identifier };
}

// readings: { [conceptUuid]: number }
export async function createScreening({ patient, site, date = new Date(), readings }) {
  const { openmrs: ids } = readJson('reference-data/settings.json');
  const { data } = await rest('POST', 'encounter', {
    body: {
      patient,
      encounterType: ids.encounterType,
      location: site,
      encounterDatetime: date.toISOString().replace('Z', '+0000'),
      obs: Object.entries(readings).map(([concept, value]) => ({ concept, value })),
    },
  });
  return data.uuid;
}
