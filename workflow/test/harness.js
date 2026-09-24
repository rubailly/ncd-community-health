// Runs a workflow step's code the way OpenFn does, against a fixture state:
// each top-level operation (fn(...)) is applied to the state in order.
// Adaptor functions that reach the network must be passed in as stubs.

import { readFileSync } from 'node:fs';

// `globals` stands in for adaptor functions a step calls, e.g. { put, collections }
export async function runStep(file, state, globals = {}) {
  const code = readFileSync(new URL(`../jobs/${file}`, import.meta.url), 'utf8');
  const operations = [];
  const fn = operation => operations.push(operation);
  new Function('fn', ...Object.keys(globals), code)(fn, ...Object.values(globals));

  let current = structuredClone(state);
  for (const operation of operations) current = await operation(current);
  return current;
}

// Reference data as the workflow sees it (the Collections are loaded from these files)
const read = path => JSON.parse(readFileSync(new URL(`../../reference-data/${path}`, import.meta.url), 'utf8'));

export function config() {
  const facilities = read('facilities.json').facilities;
  const { $comment, ...sites } = read('sites/local.json');
  return {
    conditions: read('conditions.json').conditions,
    facilities: Object.fromEntries(facilities.map(f => [f.code, f])),
    sites,
    settings: read('settings.json'),
  };
}

export const CONCEPTS = {
  systolic: '5085AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  diastolic: '5086AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  fasting: '160912AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  random: '887AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

export const SITES = {
  kamonyi: '8933971e-14fe-4f0d-96a7-6bc566c5dd4f', // -> HC-4152
  gitesi: '79227d8e-12d2-4f4b-a5a5-42d3f5e90495', // -> HC-2425
  unrouted: '76ad4192-5094-48a5-8ce2-94083e58bd6e',
};
