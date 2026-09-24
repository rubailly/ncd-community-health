// DHIS2: imports the Community NCD Screening metadata. Organisation units
// are generated from reference-data/facilities.json, with UIDs derived from
// their codes, so the facility list is only declared once.

import { createHash } from 'node:crypto';
import { env, urls, readJson } from '../lib/config.js';
import { request, basicAuth, waitFor } from '../lib/http.js';

const auth = { Authorization: basicAuth(env.DHIS2_ADMIN_USER, env.DHIS2_ADMIN_PASSWORD) };
const api = (method, path, options = {}) =>
  request(method, `${urls.dhis2}/api/${path}`, { ...options, headers: { ...auth, ...options.headers } });

export const dhis2 = { api };

// A valid DHIS2 UID (a letter followed by 10 alphanumerics) derived from a code
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function uidFor(code) {
  const bytes = createHash('sha256').update(`ncd-orgunit:${code}`).digest();
  let uid = ALPHABET[bytes[0] % 52];
  for (let i = 1; i <= 10; i++) uid += ALPHABET[bytes[i] % 62];
  return uid;
}

export function buildMetadata() {
  const metadata = readJson('reference-data/dhis2/metadata.json');
  delete metadata.$comment;
  const { country, districts, facilities } = readJson('reference-data/facilities.json');
  const openingDate = '2020-01-01';

  const root = { id: uidFor(country.code), code: country.code, name: country.name, shortName: country.name, openingDate };
  metadata.organisationUnits = [
    root,
    ...districts.map(d => ({ id: uidFor(d.code), code: d.code, name: d.name, shortName: d.name, openingDate, parent: { id: root.id } })),
    ...facilities.map(f => ({
      id: uidFor(f.code),
      code: f.code,
      name: f.name,
      shortName: f.name.replace('Health Center', 'HC'),
      openingDate,
      parent: { id: uidFor(f.district) },
    })),
  ];
  metadata.organisationUnitLevels = [
    { id: 'udexqZGeEfo', name: 'Country', level: 1 },
    { id: 'Cshoxle3Vcr', name: 'District', level: 2 },
    { id: 'C3lcOSjBdZB', name: 'Health centre', level: 3 },
  ];
  metadata.dataSets[0].organisationUnits = facilities.map(f => ({ id: uidFor(f.code) }));
  return metadata;
}

export async function ready() {
  await waitFor('DHIS2 API', async () => (await api('GET', 'system/info')).data.version, { timeout: 1_200_000 });
}

async function importPass(payload) {
  const { data } = await api('POST', 'metadata', {
    query: { importStrategy: 'CREATE_AND_UPDATE', atomicMode: 'ALL' },
    body: payload,
    timeout: 300_000,
  });
  const report = data.response || data;
  if (report.status !== 'OK') {
    const errors = (report.typeReports || []).flatMap(t => t.objectReports || []).flatMap(o => o.errorReports || []);
    throw new Error(`metadata import ${report.status}: ${errors.map(e => e.message).join('; ').slice(0, 800)}`);
  }
  return report.stats;
}

// Data sets are imported in a second pass: in one payload with new org units,
// DHIS2 2.42 fails to persist the data set's period type (it validates fine).
export async function importMetadata() {
  const { dataSets, ...rest } = buildMetadata();
  const totals = { created: 0, updated: 0 };
  for (const payload of [rest, { dataSets }]) {
    const stats = await importPass(payload);
    totals.created += stats.created;
    totals.updated += stats.updated;
  }
  return `${totals.created} created, ${totals.updated} updated`;
}

// The admin user needs the country as its data capture and view scope to
// import data values and see reports
export async function ensureAdminScope() {
  const rootId = uidFor(readJson('reference-data/facilities.json').country.code);
  const { data: me } = await api('GET', 'me', { query: { fields: 'id,organisationUnits[id],dataViewOrganisationUnits[id]' } });
  const has = list => (list || []).some(ou => ou.id === rootId);
  if (has(me.organisationUnits) && has(me.dataViewOrganisationUnits)) return 'already assigned';
  const patch = [];
  if (!has(me.organisationUnits)) patch.push({ op: 'add', path: '/organisationUnits/-', value: { id: rootId } });
  if (!has(me.dataViewOrganisationUnits)) patch.push({ op: 'add', path: '/dataViewOrganisationUnits/-', value: { id: rootId } });
  await api('PATCH', `users/${me.id}`, { body: patch, headers: { 'Content-Type': 'application/json-patch+json' } });
  return 'assigned';
}

// DHIS2 generates the sex × age combinations asynchronously on request
export async function ensureCategoryOptionCombos() {
  const count = async () =>
    (await api('GET', 'categoryCombos/DZHKAGp2hVb', { query: { fields: 'categoryOptionCombos[id]' } })).data
      .categoryOptionCombos.length;
  if ((await count()) === 6) return '6 disaggregations';
  await api('POST', 'maintenance/categoryOptionComboUpdate');
  await waitFor('category option combos', async () => (await count()) === 6, { timeout: 120_000, interval: 2_000 });
  return '6 disaggregations generated';
}
