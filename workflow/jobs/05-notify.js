// Step 5: Notify (WhatsApp)
//
// Sends the approved templates: one to the health centre, one to the patient
// if they have a phone number. Each message is tracked separately (step 6
// records it on the appointment), so a retry never repeats a message that
// was already delivered.

const digits = phone => String(phone || '').replace(/\D/g, '');

function template(name, language, parameters) {
  return {
    name,
    language: { code: language },
    components: [{ type: 'body', parameters: parameters.map(text => ({ type: 'text', text: String(text || '-') })) }],
  };
}

fn(async state => {
  const { notifications: settings } = state.config.settings;
  const send = async (to, body) =>
    post('messages', { messaging_product: 'whatsapp', to: digits(to), type: 'template', template: body })(state);

  const failures = [...state.failures];
  const delivered = [];

  for (const { appointment, patient } of state.notifications) {
    const facility = state.config.facilities[appointment.custom_facility_code];
    const ref = `referral ${appointment.name} (patient ${patient.custom_openmrs_id})`;
    const result = { appointment: appointment.name };

    if (!appointment.custom_hc_notified_at) {
      try {
        await send(facility.whatsapp, template(settings.healthCentreTemplate, settings.language, [
          facility.name,
          patient.patient_name,
          patient.dob,
          appointment.custom_screening_site,
          appointment.custom_screening_date,
          appointment.custom_conditions,
          patient.custom_openmrs_id,
        ]));
        result.hc = true;
      } catch (error) {
        failures.push({ step: 'notify', ref, retry: true, error: `health centre message: ${error.message}` });
      }
    }

    if (!appointment.custom_patient_notified_at) {
      if (!digits(patient.mobile)) {
        result.patient = 'no-phone'; // nothing to send; recorded so it isn't retried
      } else {
        try {
          await send(patient.mobile, template(settings.patientTemplate, settings.language, [
            patient.first_name,
            appointment.custom_screening_date,
            facility.name,
          ]));
          result.patient = true;
        } catch (error) {
          failures.push({ step: 'notify', ref, retry: true, error: `patient message: ${error.message}` });
        }
      }
    }

    if (result.hc || result.patient) delivered.push(result);
  }

  const messages = delivered.reduce((n, d) => n + (d.hc ? 1 : 0) + (d.patient === true ? 1 : 0), 0);
  console.log(`WhatsApp: ${messages} message(s) sent for ${delivered.length} referral(s)`);
  for (const f of failures.filter(f => f.step === 'notify')) console.error(`  ${f.ref}: ${f.error}`);
  return { ...state, delivered, failures, data: undefined, response: undefined };
});
