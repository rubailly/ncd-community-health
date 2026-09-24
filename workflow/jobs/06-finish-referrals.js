// Step 6: Record notifications & advance cursor (E-Buzima)
//
// Stamps delivered messages on their appointments, then moves the cursor
// forward, but never past a screening that failed in a way worth retrying:
// those are fetched again next run (steps 3–4 are idempotent). A reprocessing
// run (webhook `since`) never moves the cursor forward, only back to a
// failure. Finally, the run fails if anything went wrong, so problems are
// visible in Lightning.

fn(async state => {
  const { apiKey, apiSecret } = state.configuration;
  const headers = { Authorization: `token ${apiKey}:${apiSecret}` };
  const failures = [...state.failures];

  for (const { appointment, hc, patient } of state.delivered) {
    const stamp = {};
    if (hc) stamp.custom_hc_notified_at = state.runStartedAt.replace('T', ' ').slice(0, 19);
    if (patient) stamp.custom_patient_notified_at = state.runStartedAt.replace('T', ' ').slice(0, 19);
    try {
      await put(`api/resource/Patient%20Appointment/${encodeURIComponent(appointment)}`, stamp, { headers })(state);
    } catch (error) {
      failures.push({ step: 'record', ref: `referral ${appointment}`, retry: true, error: error.message });
    }
  }

  // Retryable failures hold the cursor at the earliest affected screening;
  // otherwise it moves to the latest screening seen, remembering which
  // screenings at exactly that time are done so the next run skips them.
  const failedEncounters = new Set(failures.filter(f => f.retry && f.ref.startsWith('screening')).map(f => f.ref.split(' ')[1]));
  const time = t => new Date(t).getTime();
  const held = state.screenings.filter(s => failedEncounters.has(s.encounter)).map(s => s.lastUpdated).sort((a, b) => time(a) - time(b))[0];
  const latest = state.screenings.map(s => s.lastUpdated).sort((a, b) => time(a) - time(b)).pop();
  const doneAt = at => state.screenings.filter(s => time(s.lastUpdated) === time(at) && !failedEncounters.has(s.encounter)).map(s => s.encounter);

  let cursor;
  if (held && (!state.reprocessing || time(held) < time(state.storedCursor.at))) {
    cursor = { at: held, seen: [] };
  } else if (!state.reprocessing && latest) {
    const seen = time(latest) === time(state.storedCursor.at) ? [...new Set([...state.storedCursor.seen, ...doneAt(latest)])] : doneAt(latest);
    cursor = { at: latest, seen };
  } else {
    cursor = state.storedCursor; // nothing new, or a reprocessing run that went fine
  }
  if (JSON.stringify(cursor) !== JSON.stringify(state.storedCursor)) {
    await collections.set('ncd-state', 'cursor', JSON.stringify(cursor))(state);
  }
  console.log(`Cursor ${held ? 'held' : 'at'} ${cursor.at}${cursor.seen.length ? ` (${cursor.seen.length} done at that time)` : ''}`);

  if (failures.length) {
    const lines = failures.map(f => `  [${f.step}] ${f.ref}: ${f.error}`).join('\n');
    throw new Error(`${failures.length} problem(s) this run:\n${lines}`);
  }
  return { ...state, data: undefined, response: undefined };
});
