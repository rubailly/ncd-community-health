// Settings for the tools, read from .env, plus paths to reference data.
// Every system is addressed from the host through its published port.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
export const path = relative => new URL(relative, root);

function loadEnv() {
  const file = path('.env');
  if (!existsSync(file)) throw new Error('.env not found. Run `make env` (or `make up`) first.');
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

export const env = loadEnv();

// Records a value issued by a system (e.g. an API token) in .env
export function saveEnv(key, value) {
  const file = path('.env');
  const text = readFileSync(file, 'utf8');
  const line = `${key}=${value}`;
  const updated = new RegExp(`^${key}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${text}\n${line}\n`;
  writeFileSync(file, updated, { mode: 0o600 });
  env[key] = value;
}

export const readJson = relative => JSON.parse(readFileSync(path(relative), 'utf8'));

export const urls = {
  openmrs: `http://localhost:${env.OPENMRS_PORT}/openmrs`,
  erpnext: `http://localhost:${env.ERPNEXT_PORT}`,
  dhis2: `http://localhost:${env.DHIS2_PORT}`,
  openfn: `http://localhost:${env.OPENFN_PORT}`,
  whatsapp: `http://localhost:${env.WHATSAPP_PORT}`,
};

// How the OpenFn worker reaches each system, inside the compose network
export const internalUrls = {
  openmrs: 'http://openmrs-backend:8080/openmrs',
  erpnext: 'http://erpnext:8080',
  dhis2: 'http://dhis2:8080',
  whatsapp: 'http://whatsapp:9000',
};
