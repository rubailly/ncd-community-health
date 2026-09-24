// OpenFn Lightning: the admin user and API token, the project, its
// credentials and Collections, and the workflow in workflow/project.yaml.
// Every object gets a UUID derived from its name, so deploying is an
// idempotent upsert through the provisioning API: no state file.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { env, saveEnv, urls, internalUrls, path, readJson } from '../lib/config.js';
import { request, waitFor } from '../lib/http.js';

const api = (method, route, options = {}) =>
  request(method, `${urls.openfn}${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${env.OPENFN_API_TOKEN}`, ...options.headers },
  });

export const openfn = { api };

// RFC 4122 version 5 UUID in a fixed namespace
const NAMESPACE = Buffer.from('8f0c3c2e5b6a4d1e9a7f1c2b3d4e5f60', 'hex');
export function uuidFor(name) {
  const hash = createHash('sha1').update(NAMESPACE).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const loadProject = () => YAML.parse(readFileSync(path('workflow/project.yaml'), 'utf8'));
export const projectId = () => uuidFor(`project:${loadProject().name}`);

// Credentials the workflow uses. Bodies use each adaptor's own field names.
const credentials = () => ({
  OpenMRS: {
    baseUrl: internalUrls.openmrs,
    username: env.OPENMRS_ADMIN_USER,
    password: env.OPENMRS_ADMIN_PASSWORD,
  },
  'E-Buzima': {
    baseUrl: internalUrls.erpnext,
    apiKey: env.ERPNEXT_API_KEY,
    apiSecret: env.ERPNEXT_API_SECRET,
  },
  WhatsApp: {
    baseUrl: `${internalUrls.whatsapp}/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}`,
    access_token: env.WHATSAPP_ACCESS_TOKEN,
  },
  DHIS2: {
    baseUrl: internalUrls.dhis2,
    username: env.DHIS2_ADMIN_USER,
    password: env.DHIS2_ADMIN_PASSWORD,
  },
});

export async function ready() {
  await waitFor('OpenFn Lightning', async () => (await request('GET', `${urls.openfn}/health_check`)).status === 200);
}

// Lightning has no API for creating the first user, so this uses its
// bootstrap function, Lightning.Setup.setup_user. It then has Lightning issue
// a personal access token (a signed JWT, which the Collections API requires)
// and records it in .env for the tools to use.
async function tokenValid() {
  if (!env.OPENFN_API_TOKEN) return false;
  // A valid token gets 404 for a collection that doesn't exist, an invalid one 401
  const { status } = await api('GET', '/collections/__token-check__', { ok: s => s === 404 || s === 401 });
  return status === 404;
}

export async function ensureUser() {
  if (await tokenValid()) return 'exists, token valid';

  const quote = value => JSON.stringify(String(value)); // JSON strings are valid Elixir strings
  const code = `
    alias Lightning.{Repo, Accounts}
    email = ${quote(env.OPENFN_ADMIN_EMAIL)}
    user =
      case Repo.get_by(Accounts.User, email: email) do
        nil ->
          Lightning.Setup.setup_user(%{first_name: "NCD", last_name: "Admin", email: email,
            password: ${quote(env.OPENFN_ADMIN_PASSWORD)}, role: :superuser})
          Repo.get_by!(Accounts.User, email: email)
        user -> user
      end
    IO.puts("token:" <> Accounts.generate_api_token(user))`;
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'openfn', '/app/bin/lightning', 'rpc', code], {
    cwd: path('.').pathname,
    encoding: 'utf8',
  });
  const token = result.stdout.match(/^token:(\S+)$/m)?.[1];
  if (!token) throw new Error(`could not create the user or token: ${(result.stdout + result.stderr).trim().slice(-500)}`);
  saveEnv('OPENFN_API_TOKEN', token);
  if (!(await tokenValid())) throw new Error('the issued token is not accepted');
  return 'token issued and saved to .env';
}

async function provisioned() {
  const { status, data } = await api('GET', `/api/provision/${projectId()}`, { ok: s => s === 200 || s === 404 });
  return status === 200 ? data.data : null;
}

const collectionsOf = project =>
  project.collections.map(name => ({ id: uuidFor(`collection:${name}`), name }));

export async function ensureProject() {
  if (await provisioned()) return 'exists';
  const project = loadProject();
  await api('POST', '/api/provision', {
    body: { id: projectId(), name: project.name, description: project.description, collections: collectionsOf(project), workflows: [] },
  });
  return 'created';
}

// Lightning's API can create and delete credentials but not update them.
// Every value comes from .env, so existing credentials are already correct.
export async function ensureCredentials() {
  const { data } = await api('GET', '/api/credentials');
  const existing = new Set(data.credentials.map(c => c.name));
  const created = [];
  for (const [name, body] of Object.entries(credentials())) {
    if (existing.has(name)) continue;
    await api('POST', '/api/credentials', {
      body: {
        name,
        schema: 'raw',
        credential_bodies: [{ name: 'main', body }],
        project_credentials: [{ project_id: projectId() }],
      },
    });
    created.push(name);
  }
  return created.length ? `created ${created.join(', ')}` : `${existing.size} exist`;
}

// Builds the provisioning document from project.yaml. Job bodies are read
// from the files the YAML points to; credentials are referenced by name.
export async function buildProvisioning() {
  const project = loadProject();
  const current = await provisioned();
  const projectCredentials = Object.fromEntries((current?.project_credentials || []).map(pc => [pc.name, pc.id]));

  const workflows = Object.entries(project.workflows || {}).map(([wfKey, wf]) => {
    const id = key => uuidFor(`${wfKey}:${key}`);
    const jobs = Object.entries(wf.jobs).map(([jobKey, job]) => {
      if (job.credential && !projectCredentials[job.credential]) {
        throw new Error(`job ${jobKey} uses credential "${job.credential}", which is not in the project`);
      }
      return {
        id: id(`job:${jobKey}`),
        name: job.name,
        adaptor: job.adaptor,
        body: readFileSync(path(`workflow/${job.body}`), 'utf8'),
        project_credential_id: job.credential ? projectCredentials[job.credential] : null,
      };
    });
    const triggers = Object.entries(wf.triggers).map(([key, t]) => ({
      id: id(`trigger:${key}`),
      type: t.type,
      enabled: t.enabled ?? true,
      ...(t.type === 'cron' ? { cron_expression: t.cron_expression } : {}),
    }));
    const edges = wf.edges.map(edge => {
      const [source, target] = edge.from_to.split('->').map(s => s.trim());
      return {
        id: id(`edge:${source}->${target}`),
        ...(wf.triggers[source] ? { source_trigger_id: id(`trigger:${source}`) } : { source_job_id: id(`job:${source}`) }),
        target_job_id: id(`job:${target}`),
        condition_type: edge.condition ?? 'on_job_success',
        ...(edge.expression ? { condition_expression: edge.expression, condition_label: edge.label } : {}),
        enabled: true,
      };
    });
    return { id: id('workflow'), name: wf.name, jobs, triggers, edges };
  });

  return { id: projectId(), name: project.name, description: project.description, collections: collectionsOf(project), workflows };
}

export async function deployWorkflow() {
  const document = await buildProvisioning();
  await api('POST', '/api/provision', { body: document, timeout: 120_000 });
  const jobs = document.workflows.reduce((n, wf) => n + wf.jobs.length, 0);
  return `${document.workflows.length} workflow(s), ${jobs} steps`;
}

// Reference data the workflow reads at the start of every run
export async function loadReferenceData() {
  const strip = ({ $comment, ...rest }) => rest;
  const items = {
    conditions: strip(readJson('reference-data/conditions.json')).conditions,
    facilities: strip(readJson('reference-data/facilities.json')).facilities,
    sites: strip(readJson('reference-data/sites/local.json')),
    settings: strip(readJson('reference-data/settings.json')),
  };
  for (const [key, value] of Object.entries(items)) {
    await api('PUT', `/collections/ncd-config/${key}`, { body: { value: JSON.stringify(value) } });
  }
  return `${Object.keys(items).length} keys in ncd-config`;
}

export function webhookUrl() {
  const project = loadProject();
  const [wfKey, wf] = Object.entries(project.workflows)[0];
  const [triggerKey] = Object.entries(wf.triggers).find(([, t]) => t.type === 'webhook');
  return `${urls.openfn}/i/${uuidFor(`${wfKey}:trigger:${triggerKey}`)}`;
}
