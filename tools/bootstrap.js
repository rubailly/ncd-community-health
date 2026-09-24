// Brings every system to the state the programme needs. Safe to run any
// number of times: each step checks before it changes anything.
//
//   node tools/bootstrap.js            everything
//   node tools/bootstrap.js deploy     only redeploy the workflow and reference data

import { section, step, main, green } from './lib/steps.js';
import { urls } from './lib/config.js';
import * as openmrs from './systems/openmrs.js';
import * as erpnext from './systems/erpnext.js';
import * as dhis2 from './systems/dhis2.js';
import * as openfn from './systems/openfn.js';

async function deploy() {
  section('Workflow');
  await step('reference data → Collections', openfn.loadReferenceData);
  await step('deploy workflow/project.yaml', openfn.deployWorkflow);
}

main(async () => {
  if (process.argv[2] === 'deploy') {
    await openfn.ready();
    return deploy();
  }

  section('OpenMRS (community screening)');
  await step('API ready', openmrs.ready);
  await step('screening concepts', openmrs.verifyConcepts);
  await step('encounter type', openmrs.verifyEncounterType);
  await step('screening sites', openmrs.verifySites);
  await step('screening form', openmrs.verifyForm);
  await step('provider for admin', openmrs.ensureAdminProvider);

  section('E-Buzima (health centre referrals)');
  await step('API ready', erpnext.ready);
  await step('setup wizard', erpnext.ensureSetupComplete);
  await step('Healthcare domain', erpnext.ensureHealthcareDomain);
  await step('integration user and API key', erpnext.ensureIntegrationUser);
  await step('custom fields', erpnext.ensureCustomFields);
  await step('NCD department and appointment type', erpnext.ensureReferralSetup);
  await step('health centres and NCD teams', erpnext.ensureFacilities);

  section('DHIS2 (national reporting)');
  await step('API ready', dhis2.ready);
  await step('metadata (org units, data set, indicators)', dhis2.importMetadata);
  await step('disaggregations', dhis2.ensureCategoryOptionCombos);
  await step('admin data scope', dhis2.ensureAdminScope);

  section('OpenFn (integration)');
  await step('API ready', openfn.ready);
  await step('admin user and API token', openfn.ensureUser);
  await step('project and Collections', openfn.ensureProject);
  await step('credentials', openfn.ensureCredentials);

  await deploy();

  console.log(`\n${green('Ready.')}
  OpenMRS    ${urls.openmrs}/spa
  E-Buzima   ${urls.erpnext}
  DHIS2      ${urls.dhis2}
  OpenFn     ${urls.openfn}
  WhatsApp   ${urls.whatsapp}
  (credentials are in .env)`);
});
