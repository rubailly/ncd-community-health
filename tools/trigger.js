// Runs the workflow now (instead of waiting for the 15-minute schedule) and
// prints its log. Optional JSON body, e.g.:
//   node tools/trigger.js '{"report": true}'

import { main, green, red } from './lib/steps.js';
import { urls } from './lib/config.js';
import { runWorkflow, readableLog } from './lib/runs.js';

main(async () => {
  const body = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  console.log(`Running the workflow${Object.keys(body).length ? ` with ${JSON.stringify(body)}` : ''}…`);
  const run = await runWorkflow(body);
  console.log(readableLog(run.logs));
  const ok = run.state === 'success';
  console.log(`\n${ok ? green('Run succeeded') : red(`Run ${run.state}${run.errorType ? ` (${run.errorType})` : ''}`)}: ${urls.openfn}/runs/${run.id}`);
  if (!ok) process.exit(1);
});
