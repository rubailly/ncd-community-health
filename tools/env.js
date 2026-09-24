// Creates .env from .env.example, replacing <generated> values with fresh
// secrets. On later runs it only appends keys that .env is missing (for
// example after a new setting is added); existing values are never changed.

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const target = new URL('../.env', import.meta.url);
const template = new URL('../.env.example', import.meta.url);

const random = bytes => randomBytes(bytes).toString('base64url');

const generators = {
  ERPNEXT_DB_ROOT_PASSWORD: () => random(18),
  ERPNEXT_API_KEY: () => randomBytes(8).toString('hex'),
  ERPNEXT_API_SECRET: () => randomBytes(12).toString('hex'),
  OPENFN_ADMIN_PASSWORD: () => random(12),
  OPENFN_API_TOKEN: () => random(32),
  OPENFN_SECRET_KEY_BASE: () => randomBytes(64).toString('base64'),
  // Lightning expects a base64-encoded 32-byte key
  OPENFN_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  OPENFN_WORKER_SECRET: () => randomBytes(32).toString('hex'),
  // Lightning signs run tokens with this RSA key, passed as base64-encoded PEM
  OPENFN_WORKER_RUNS_PRIVATE_KEY: () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return Buffer.from(privateKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64');
  },
  WHATSAPP_ACCESS_TOKEN: () => random(24),
};

const resolve = (key, value) => {
  if (value !== '<generated>') return value;
  const generate = generators[key];
  if (!generate) throw new Error(`No generator for ${key} in tools/env.js`);
  return generate();
};

const entries = readFileSync(template, 'utf8')
  .split('\n')
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/))
  .filter(Boolean);

if (!existsSync(target)) {
  const output = readFileSync(template, 'utf8').replace(/^([A-Z0-9_]+)=(.*)$/gm, (_, key, value) => `${key}=${resolve(key, value)}`);
  writeFileSync(target, output, { mode: 0o600 });
  console.log('Created .env with generated secrets');
} else {
  const existing = new Set([...readFileSync(target, 'utf8').matchAll(/^([A-Z0-9_]+)=/gm)].map(m => m[1]));
  const missing = entries.filter(([, key]) => !existing.has(key));
  if (missing.length) {
    appendFileSync(target, `\n# Added by tools/env.js\n${missing.map(([, key, value]) => `${key}=${resolve(key, value)}`).join('\n')}\n`);
    console.log(`Added to .env: ${missing.map(([, key]) => key).join(', ')}`);
  }
}
