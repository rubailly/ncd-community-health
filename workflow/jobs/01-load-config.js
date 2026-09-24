// Step 1: Load config & cursor
//
// Reads the programme's reference data (thresholds, facilities, site
// routing, settings) and the workflow's own state from Collections, and
// decides whether a DHIS2 report is due. Every later step works from
// `state.config`, so nothing else touches Collections except step 6 and
// step 10, which save the cursor and the last report time.
//
// A run started by the webhook can pass options in its body:
//   { "since": "2026-09-01T00:00:00Z" }   reprocess screenings changed since then
//   { "report": true }                     report to DHIS2 now
//   { "periods": ["202608", "202609"] }    report these months (implies report)

const parse = value => (typeof value === 'string' ? JSON.parse(value) : value);

// A key that doesn't exist yet (e.g. the cursor on the first run) reads as {}
async function read(state, collection, key) {
  const { data } = await collections.get(collection, key)(state);
  if (data == null || (typeof data === 'object' && !Object.keys(data).length)) return null;
  return parse(data);
}

// YYYYMM of a date in Kigali (UTC+2), where the programme's months begin
function kigaliMonth(date) {
  const local = new Date(date.getTime() + 2 * 3600000);
  return `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

fn(async state => {
  // A cron run starts from the previous run's final state; only the webhook
  // body (state.data) is used as input, everything else is rebuilt here.
  const request = state.data && typeof state.data === 'object' ? state.data : {};

  const [conditions, facilities, sites, settings] = await Promise.all(
    ['conditions', 'facilities', 'sites', 'settings'].map(key => read(state, 'ncd-config', key))
  );
  if (!conditions || !facilities || !sites || !settings) {
    throw new Error('Reference data missing from the ncd-config Collection. Run `make deploy`.');
  }

  const now = new Date();
  // The cursor is a timestamp plus the screenings already handled at exactly
  // that timestamp, so the boundary screening isn't processed again each run
  const stored = await read(state, 'ncd-state', 'cursor');
  const storedCursor =
    typeof stored === 'string'
      ? { at: stored, seen: [] } // a cursor saved as a bare timestamp
      : stored
        ? { at: stored.at, seen: stored.seen || [] }
        : { at: new Date(now.getTime() - settings.initialLookbackDays * 86400000).toISOString(), seen: [] };
  // `since` reprocesses from an earlier point without moving the stored cursor on
  const cursor = request.since || storedCursor.at;
  const alreadySeen = request.since ? [] : storedCursor.seen;

  const lastReportAt = await read(state, 'ncd-state', 'last-report-at');
  const minutesSinceReport = lastReportAt ? (now - new Date(lastReportAt)) / 60000 : Infinity;

  let reportPeriods = [];
  if (Array.isArray(request.periods) && request.periods.length) {
    reportPeriods = request.periods.map(String);
  } else if (request.report || minutesSinceReport >= settings.reporting.intervalMinutes) {
    reportPeriods = [kigaliMonth(now)];
    // Keep counting last month's late entries during the first days of a new month
    const lateWindowStart = new Date(now.getTime() - settings.reporting.lateDataDays * 86400000);
    if (kigaliMonth(lateWindowStart) !== reportPeriods[0]) reportPeriods.unshift(kigaliMonth(lateWindowStart));
  }

  console.log(`Screenings changed since ${cursor} will be processed`);
  console.log(reportPeriods.length ? `DHIS2 report due for ${reportPeriods.join(', ')}` : 'No DHIS2 report due');

  return {
    config: {
      conditions,
      facilities: Object.fromEntries(facilities.map(f => [f.code, f])),
      sites,
      settings,
    },
    cursor,
    alreadySeen,
    storedCursor,
    reprocessing: Boolean(request.since),
    runStartedAt: now.toISOString(),
    reportPeriods,
    failures: [],
  };
});
