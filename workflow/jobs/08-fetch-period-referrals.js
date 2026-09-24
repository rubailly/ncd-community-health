// Step 8: Fetch the reporting months' referrals (E-Buzima)
//
// Referrals are attributed to the month of the screening that caused them,
// so "issued" and "completed" line up with "screened" in DHIS2.

const SOURCE = 'Community NCD screening';

function monthBounds(period) {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(4, 6));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return [`${y}-${mm}-01`, `${y}-${mm}-${last}`];
}

fn(async state => {
  const { apiKey, apiSecret } = state.configuration;
  const headers = { Authorization: `token ${apiKey}:${apiSecret}` };
  const periodReferrals = [];

  for (const period of state.reportPeriods) {
    const query = {
      filters: JSON.stringify([
        ['custom_source', '=', SOURCE],
        ['custom_screening_date', 'between', monthBounds(period)],
      ]),
      fields: JSON.stringify(['name', 'status', 'custom_facility_code', 'custom_sex', 'custom_age_group']),
      limit_page_length: 0,
    };
    const { data } = await get('api/resource/Patient%20Appointment', { headers, query })(state);
    periodReferrals.push(...data.data.map(a => ({ period, ...a })));
  }

  console.log(`${periodReferrals.length} referral(s) in ${state.reportPeriods.join(', ')}`);
  return { ...state, periodReferrals, data: undefined, response: undefined };
});
