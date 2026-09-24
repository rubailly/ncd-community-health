// Step 4: Create referrals (E-Buzima)
//
// For each flagged screening: find or create the patient (by OpenMRS
// patient UUID), then book a referral appointment at the health centre with
// its NCD team. The appointment stores the OpenMRS encounter UUID, and E-Buzima
// enforces it as unique, so a screening is never referred twice.
//
// Appointments are check-in based (patients are seen in arrival order, no
// time slots), which allows one appointment per patient per day. A second
// high screening for the same patient that day joins the existing referral.
//
// Then collects every NCD referral still waiting for a WhatsApp notification,
// including ones from earlier runs whose notification failed, for step 5.

const SOURCE = 'Community NCD screening';

function addDays(isoDate, days) {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SEX = { male: 'Male', female: 'Female' };

fn(async state => {
  const { apiKey, apiSecret } = state.configuration;
  const headers = { Authorization: `token ${apiKey}:${apiSecret}` };
  const { referral: rules } = state.config.settings;

  const resource = doctype => `api/resource/${encodeURIComponent(doctype)}`;
  const find = async (doctype, filters, fields = ['name']) => {
    const query = { filters: JSON.stringify(filters), fields: JSON.stringify(fields), limit_page_length: 0 };
    return (await get(resource(doctype), { headers, query })(state)).data.data;
  };
  const create = async (doctype, body) => (await post(resource(doctype), body, { headers })(state)).data.data;

  const practitioners = {};
  const practitionerFor = async facility => {
    if (!practitioners[facility]) {
      const [match] = await find('Healthcare Practitioner', [['custom_facility_code', '=', facility]]);
      if (!match) throw new Error(`no NCD team practitioner for facility ${facility}`);
      practitioners[facility] = match.name;
    }
    return practitioners[facility];
  };

  const failures = [...state.failures];
  let created = 0;
  let existing = 0;

  for (const referral of state.referrals) {
    const ref = `screening ${referral.encounter} (patient ${referral.patient.openmrsId})`;
    try {
      const [appointment] = await find('Patient Appointment', [['custom_openmrs_encounter_uuid', '=', referral.encounter]]);
      if (appointment) {
        existing++;
        continue;
      }

      let [patient] = await find('Patient', [['custom_openmrs_uuid', '=', referral.patient.uuid]]);
      if (!patient) {
        patient = await create('Patient', {
          first_name: referral.patient.givenName,
          last_name: referral.patient.familyName,
          sex: SEX[referral.patient.sex] || 'Other',
          dob: referral.patient.birthDate,
          mobile: referral.patient.phone || '',
          custom_openmrs_uuid: referral.patient.uuid,
          custom_openmrs_id: referral.patient.openmrsId,
        });
      }

      const appointmentDate = addDays(referral.date, rules.appointmentOffsetDays);
      const [sameDay] = await find('Patient Appointment', [
        ['patient', '=', patient.name],
        ['appointment_date', '=', appointmentDate],
        ['status', 'not in', ['Cancelled', 'Closed']],
      ]);
      if (sameDay) {
        console.log(`  ${ref} joins existing referral ${sameDay.name} for the same day`);
        existing++;
        continue;
      }

      const facility = state.config.facilities[referral.facility];
      const readings = referral.conditions
        .flatMap(c => c.readings.map(r => `${r.label} ${r.value} ${r.unit} (threshold ${r.threshold})`))
        .join('; ');
      await create('Patient Appointment', {
        patient: patient.name,
        appointment_for: 'Practitioner',
        practitioner: await practitionerFor(referral.facility),
        department: rules.department,
        appointment_type: rules.appointmentType,
        appointment_date: appointmentDate,
        appointment_based_on_check_in: 1,
        company: facility.name,
        notes: `Referred from ${referral.siteName} after community NCD screening. ${readings}.`,
        custom_openmrs_encounter_uuid: referral.encounter,
        custom_source: SOURCE,
        custom_facility_code: referral.facility,
        custom_screening_site: referral.siteName,
        custom_screening_date: referral.date.slice(0, 10),
        custom_conditions: referral.summary,
        custom_sex: referral.sex,
        custom_age_group: referral.ageGroup,
      });
      created++;
    } catch (error) {
      // E-Buzima explains validation errors in _server_messages
      const detail = (() => {
        try {
          return JSON.parse(JSON.parse(error.body?._server_messages || '[]')[0] || '{}').message;
        } catch {
          return undefined;
        }
      })();
      // Another run referred this screening between our check and create
      if (error.body?.exc_type === 'UniqueValidationError') {
        existing++;
        continue;
      }
      const message = detail ? `${error.message}: ${detail.replace(/<[^>]+>/g, '')}` : error.message;
      failures.push({ step: 'refer', ref, retry: true, error: message });
      console.error(`  referral failed for ${ref}: ${message}`);
    }
  }
  console.log(`Referrals: ${created} created, ${existing} already existed, ${state.referrals.length - created - existing} failed`);

  // Everything still owed a notification: new referrals and earlier failures
  const fields = ['name', 'patient', 'custom_facility_code', 'custom_screening_site', 'custom_screening_date',
    'custom_conditions', 'custom_hc_notified_at', 'custom_patient_notified_at'];
  const pending = await find('Patient Appointment', [
    ['custom_source', '=', SOURCE],
    ['custom_patient_notified_at', 'is', 'not set'],
  ], fields);
  const pendingHc = await find('Patient Appointment', [
    ['custom_source', '=', SOURCE],
    ['custom_hc_notified_at', 'is', 'not set'],
  ], fields);
  const byName = Object.fromEntries([...pending, ...pendingHc].map(a => [a.name, a]));

  const notifications = [];
  for (const appointment of Object.values(byName)) {
    const [patient] = await find('Patient', [['name', '=', appointment.patient]],
      ['first_name', 'patient_name', 'dob', 'mobile', 'custom_openmrs_id']);
    notifications.push({ appointment, patient });
  }
  console.log(`${notifications.length} referral(s) awaiting WhatsApp notification`);

  return { ...state, notifications, failures, data: undefined, response: undefined };
});
