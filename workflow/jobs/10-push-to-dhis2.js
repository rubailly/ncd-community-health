// Step 10: Push to DHIS2
//
// Everything is addressed by code (data elements, org units, data set);
// only the sex × age combinations are looked up, because DHIS2 generates
// them. The import overwrites existing values, so reruns are safe.

fn(async state => {
  const { data: combos } = await get('api/categoryOptionCombos', {
    query: {
      filter: 'categoryCombo.code:eq:NCD_SEX_AGE',
      fields: 'id,categoryOptions[code]',
      paging: false,
    },
  })(state);
  const comboFor = {};
  for (const combo of combos.categoryOptionCombos) {
    const codes = combo.categoryOptions.map(o => o.code);
    comboFor[[codes.find(c => c.startsWith('SEX_')), codes.find(c => c.startsWith('AGE_'))].join('|')] = combo.id;
  }

  const dataValues = state.report.values.map(v => {
    const categoryOptionCombo = comboFor[`${v.sex}|${v.age}`];
    if (!categoryOptionCombo) throw new Error(`DHIS2 has no category option combo for ${v.sex} / ${v.age}`);
    return { dataElement: v.dataElement, period: v.period, orgUnit: v.orgUnit, categoryOptionCombo, value: String(v.value) };
  });

  const { data: result } = await post('api/dataValueSets', { dataSet: state.report.dataSet, dataValues }, {
    query: {
      dataSetIdScheme: 'CODE',
      dataElementIdScheme: 'CODE',
      orgUnitIdScheme: 'CODE',
      importStrategy: 'CREATE_AND_UPDATE',
    },
  })(state);

  // DHIS2 counts values it already holds as "ignored"; only conflicts are errors
  const summary = result.response || result;
  const { imported, updated, ignored } = summary.importCount;
  const conflicts = summary.conflicts || [];
  console.log(`DHIS2: ${imported} imported, ${updated} updated, ${ignored} unchanged`);
  if (summary.status === 'ERROR' || conflicts.length) {
    const detail = conflicts.map(c => `${c.errorCode}: ${c.value}`).join('; ');
    throw new Error(`DHIS2 import ${summary.status}: ${detail}`.slice(0, 1500));
  }

  await collections.set('ncd-state', 'last-report-at', JSON.stringify(state.runStartedAt))(state);
  return { ...state, data: undefined, response: undefined };
});
