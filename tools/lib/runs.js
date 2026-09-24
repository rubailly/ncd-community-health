// Starts the workflow through its webhook and waits for the run to finish.

import { request, waitFor } from './http.js';
import { openfn, webhookUrl } from '../systems/openfn.js';

const FINAL = ['success', 'failed', 'crashed', 'cancelled', 'killed', 'exception', 'lost'];

export async function runWorkflow(body = {}, { timeout = 600_000 } = {}) {
  const { data } = await request('POST', webhookUrl(), { body });
  const workOrder = data.work_order_id;

  const run = await waitFor(
    'the workflow run to finish',
    async () => {
      const { data: runs } = await openfn.api('GET', '/api/runs', { query: { work_order_id: workOrder } });
      const latest = runs.data[0];
      return latest && FINAL.includes(latest.attributes.state) ? latest : null;
    },
    { timeout, interval: 2_000 }
  );

  const lines = [];
  for (let page = 1; ; page++) {
    const { data: logs } = await openfn.api('GET', '/api/log_lines', { query: { run_id: run.id, page, page_size: 500 } });
    lines.push(...logs.data.map(l => l.attributes ?? l));
    if (logs.data.length < 500) break;
  }
  lines.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

  return { id: run.id, workOrder, state: run.attributes.state, errorType: run.attributes.error_type, logs: lines };
}

// The lines a person wants to read: the steps' own output, step boundaries, errors
export function readableLog(logs) {
  return logs
    .filter(l => l.source === 'JOB' || l.level === 'error' || /^Starting step|completed in|aborted/.test(String(l.message)))
    .map(l => `${l.source === 'JOB' ? '    ' : '  · '}${String(l.message).replace(/^\[?"?|"?\]?$/g, '')}`)
    .join('\n');
}
