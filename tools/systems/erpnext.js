// E-Buzima (ERPNext + Healthcare). Everything is applied through the REST
// API as Administrator, and every step is safe to repeat.

import { env, urls, readJson } from '../lib/config.js';
import { request, waitFor } from '../lib/http.js';

let cookie;

async function login() {
  const response = await request('POST', `${urls.erpnext}/api/method/login`, {
    body: { usr: 'Administrator', pwd: env.ERPNEXT_ADMIN_PASSWORD },
  });
  cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

const api = (method, path, options = {}) =>
  request(method, `${urls.erpnext}/api/${path}`, { ...options, headers: { Cookie: cookie, ...options.headers } });

const resource = (doctype, name = '') =>
  `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ''}`;

async function find(doctype, name) {
  const { status, data } = await api('GET', resource(doctype, name), { ok: s => s === 200 || s === 404 });
  return status === 200 ? data.data : null;
}

async function list(doctype, filters, fields = ['name']) {
  const { data } = await api('GET', resource(doctype), {
    query: { filters: JSON.stringify(filters), fields: JSON.stringify(fields), limit_page_length: 0 },
  });
  return data.data;
}

const create = (doctype, body) => api('POST', resource(doctype), { body }).then(r => r.data.data);

export const erpnext = { api, find, list, create };

export async function ready() {
  await waitFor('E-Buzima API', async () => (await request('GET', `${urls.erpnext}/api/method/ping`)).data.message === 'pong');
  await login();
}

// Runs the setup wizard (fiscal year, currency, genders, parent company)
export async function ensureSetupComplete() {
  const { data } = await api('POST', 'method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete', {
    timeout: 600_000,
    body: {
      args: JSON.stringify({
        language: 'English',
        country: 'Rwanda',
        timezone: 'Africa/Kigali',
        time_zone: 'Africa/Kigali',
        currency: 'RWF',
        full_name: 'Administrator',
        email: 'admin@ebuzima.local',
        company_name: 'E-Buzima',
        company_abbr: 'EBZ',
        chart_of_accounts: 'Standard',
        fy_start_date: '2026-07-01',
        fy_end_date: '2027-06-30',
        setup_demo: 0,
      }),
    },
  });
  if (data.message?.status !== 'ok') throw new Error(`setup wizard returned ${JSON.stringify(data.message)}`);
  // the wizard logs the session in as the wizard's user; sign back in as Administrator
  await login();
  return 'complete';
}

export async function ensureHealthcareDomain() {
  const settings = await find('Domain Settings', 'Domain Settings');
  if (settings.active_domains.some(d => d.domain === 'Healthcare')) return 'active';
  await api('PUT', resource('Domain Settings', 'Domain Settings'), {
    body: { active_domains: [...settings.active_domains, { domain: 'Healthcare' }] },
  });
  return 'activated';
}

// The user OpenFn signs in as. Its API key comes from .env, so the OpenFn
// credential never needs to change; re-applying it is harmless. Nursing User
// is the least-privileged Healthcare role that can read practitioners and
// create patients and appointments.
export async function ensureIntegrationUser() {
  const access = {
    api_key: env.ERPNEXT_API_KEY,
    api_secret: env.ERPNEXT_API_SECRET,
    roles: [{ role: 'Nursing User' }],
  };
  const existing = await find('User', env.ERPNEXT_API_USER);
  if (existing) {
    await api('PUT', resource('User', env.ERPNEXT_API_USER), { body: access });
  } else {
    await create('User', {
      email: env.ERPNEXT_API_USER,
      first_name: 'OpenFn',
      last_name: 'Integration',
      user_type: 'System User',
      send_welcome_email: 0,
      ...access,
    });
  }
  const { data } = await request('GET', `${urls.erpnext}/api/method/frappe.auth.get_logged_user`, {
    headers: { Authorization: `token ${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}` },
  });
  if (data.message !== env.ERPNEXT_API_USER) throw new Error('API key does not authenticate');
  return existing ? 'exists, key verified' : 'created, key verified';
}

const CUSTOM_FIELDS = [
  ['Company', 'custom_facility_code', 'Facility code', 'Data', { unique: 1, insert_after: 'abbr' }],
  ['Healthcare Practitioner', 'custom_facility_code', 'Facility code', 'Data', { insert_after: 'department' }],
  ['Patient', 'custom_openmrs_uuid', 'OpenMRS patient UUID', 'Data', { unique: 1, read_only: 1, insert_after: 'patient_name' }],
  ['Patient', 'custom_openmrs_id', 'OpenMRS ID', 'Data', { read_only: 1, insert_after: 'custom_openmrs_uuid' }],
  ['Patient Appointment', 'custom_openmrs_encounter_uuid', 'OpenMRS encounter UUID', 'Data', { unique: 1, read_only: 1, insert_after: 'notes' }],
  ['Patient Appointment', 'custom_source', 'Referral source', 'Data', { read_only: 1, insert_after: 'custom_openmrs_encounter_uuid' }],
  ['Patient Appointment', 'custom_facility_code', 'Facility code', 'Data', { read_only: 1, insert_after: 'custom_source' }],
  ['Patient Appointment', 'custom_screening_site', 'Screening site', 'Data', { read_only: 1, insert_after: 'custom_facility_code' }],
  ['Patient Appointment', 'custom_screening_date', 'Screening date', 'Date', { read_only: 1, insert_after: 'custom_screening_site' }],
  ['Patient Appointment', 'custom_conditions', 'Conditions', 'Small Text', { read_only: 1, insert_after: 'custom_screening_date' }],
  ['Patient Appointment', 'custom_sex', 'Sex (reporting)', 'Data', { read_only: 1, insert_after: 'custom_conditions' }],
  ['Patient Appointment', 'custom_age_group', 'Age group (reporting)', 'Data', { read_only: 1, insert_after: 'custom_sex' }],
  ['Patient Appointment', 'custom_hc_notified_at', 'Health centre notified at', 'Datetime', { read_only: 1, insert_after: 'custom_age_group' }],
  ['Patient Appointment', 'custom_patient_notified_at', 'Patient notified at', 'Datetime', { read_only: 1, insert_after: 'custom_hc_notified_at' }],
];

export async function ensureCustomFields() {
  let created = 0;
  for (const [dt, fieldname, label, fieldtype, extra] of CUSTOM_FIELDS) {
    if (await find('Custom Field', `${dt}-${fieldname}`)) continue;
    await create('Custom Field', { dt, fieldname, label, fieldtype, ...extra });
    created++;
  }
  return `${CUSTOM_FIELDS.length} fields, ${created} created`;
}

export async function ensureReferralSetup() {
  const { referral } = readJson('reference-data/settings.json');
  const made = [];
  if (!(await find('Medical Department', referral.department))) {
    await create('Medical Department', { department: referral.department });
    made.push('department');
  }
  if (!(await find('Appointment Type', referral.appointmentType))) {
    await create('Appointment Type', { appointment_type: referral.appointmentType, default_duration: 30 });
    made.push('appointment type');
  }
  return made.length ? `created ${made.join(', ')}` : 'exists';
}

// One company and one NCD team practitioner per health centre
export async function ensureFacilities() {
  const { facilities } = readJson('reference-data/facilities.json');
  const { referral } = readJson('reference-data/settings.json');
  let created = 0;
  for (const facility of facilities) {
    if (!(await find('Company', facility.name))) {
      await create('Company', {
        company_name: facility.name,
        abbr: facility.code.replace(/[^A-Z0-9]/gi, ''),
        custom_facility_code: facility.code,
        country: 'Rwanda',
        default_currency: 'RWF',
      });
      created++;
    }
    const practitioners = await list('Healthcare Practitioner', [['custom_facility_code', '=', facility.code]]);
    if (!practitioners.length) {
      await create('Healthcare Practitioner', {
        first_name: 'NCD Team',
        last_name: facility.name,
        department: referral.department,
        custom_facility_code: facility.code,
      });
      created++;
    }
  }
  return `${facilities.length} health centres, ${created} records created`;
}
