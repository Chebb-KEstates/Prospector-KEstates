import { ImportPipeline } from './importPipeline';
import { ImportField, ColumnSpec, ParsedSheet } from './importModels';
import { DataSetType, Property, PropertyState } from '../types/models';
import { ownerKeyOf, groupByOwner } from './ownerGrouping';

describe('phone normalisation', () => {
  it('converts a local 05x number to international', () => {
    expect(ImportPipeline.normalizePhone('0501234567')).toBe('971501234567');
  });
  it('accepts a 9-digit 5x number', () => {
    expect(ImportPipeline.normalizePhone('501234567')).toBe('971501234567');
  });
  it('strips 00 prefixes and punctuation', () => {
    expect(ImportPipeline.normalizePhone('00971 50 123 4567')).toBe('971501234567');
  });
  it('rejects junk placeholders so they never count as callable', () => {
    for (const junk of ['nan', 'N/A', '-', '0', 'none', '']) {
      expect(ImportPipeline.normalizePhone(junk)).toBeUndefined();
    }
  });
});

describe('unit key (vault-wide dedupe)', () => {
  it('builds a unit key from community + building + unit', () => {
    const a = ImportPipeline.unitKeyFor({ community: 'Dubai Hills', building: 'T1', unitNumber: '101' });
    const b = ImportPipeline.unitKeyFor({ community: 'dubai hills', building: ' t1 ', unitNumber: '101' });
    expect(a).toBe(b); // normalisation makes them the same unit
  });
  it('falls back to a plot key when there is no unit number', () => {
    expect(ImportPipeline.unitKeyFor({ community: 'Ranches', plotNumber: '55' })).toBe('p|ranches|55');
  });
  it('returns null when the row identifies no unit at all', () => {
    expect(ImportPipeline.unitKeyFor({ community: 'Ranches' })).toBeNull();
  });
});

describe('header auto-mapping', () => {
  it('recognises common vendor headers', () => {
    expect(ImportPipeline.autoMapHeader('Mobile No')).toBe(ImportField.phone);
    expect(ImportPipeline.autoMapHeader('Owner Name')).toBe(ImportField.ownerName);
    expect(ImportPipeline.autoMapHeader('Nationality')).toBe(ImportField.nationality);
    expect(ImportPipeline.autoMapHeader('Bedrooms')).toBe(ImportField.beds);
  });
  it('ignores headers it does not know', () => {
    expect(ImportPipeline.autoMapHeader('Some Vendor Field')).toBe(ImportField.ignore);
  });
});

// The table must adapt to whatever is uploaded: unmapped columns are kept.
describe('flexible import — unmapped columns are retained', () => {
  const rows: unknown[][] = [
    ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile', 'Developer', 'View'],
    ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0501234567', 'Emaar', 'Golf'],
    ['Dubai Hills', 'T1', '102', 'Layla Sharma', '0507654321', 'Emaar', 'Community'],
  ];
  const columns = ImportPipeline.buildColumns(rows, 0);

  it('auto-maps the known columns and leaves the rest ignored', () => {
    const byHeader = new Map(columns.map(c => [c.header, c.field]));
    expect(byHeader.get('Owner Name')).toBe(ImportField.ownerName);
    expect(byHeader.get('Developer')).toBe(ImportField.ignore);
    expect(byHeader.get('View')).toBe(ImportField.ignore);
  });

  it('keeps the unmapped columns on the record so the table can show them', () => {
    const res = ImportPipeline.dryRun({
      sheet: new ParsedSheet('demo.xlsx', rows),
      headerRow: 0, columns, type: DataSetType.register,
      communityFallback: 'Dubai Hills', datasetId: 'ds1',
      existingByUnitKey: new Map<string, Property>(),
    });
    expect(res.newProperties).toHaveLength(2);
    const first = res.newProperties[0];
    expect(first.extra).toEqual({ Developer: 'Emaar', View: 'Golf' });
    expect(first.owner.phone).toBe('971501234567');
    expect(first.callable).toBe(true);
  });

  it('dedupes the same unit appearing twice in one file', () => {
    const dupRows: unknown[][] = [...rows, ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0501234567', 'Emaar', 'Golf']];
    const res = ImportPipeline.dryRun({
      sheet: new ParsedSheet('demo.xlsx', dupRows),
      headerRow: 0, columns: ImportPipeline.buildColumns(dupRows, 0), type: DataSetType.register,
      communityFallback: 'Dubai Hills', datasetId: 'ds1',
      existingByUnitKey: new Map<string, Property>(),
    });
    expect(res.newProperties).toHaveLength(2); // 3 rows -> 2 unique units
    expect(res.inFileDuplicates).toBe(1);
  });
});

describe('re-import keeps transaction history', () => {
  // Regression: copyWith ends in Object.assign, which copies an explicit
  // `undefined` instead of skipping it. The update branch used
  // `newerTx ? candidate.x : undefined` to mean "keep what's there", so every
  // re-import of a vendor register silently blanked lastTransactionDate /
  // lastTransactionValue and reset txCount to 0 — wiping the vault's
  // "Last transaction" column for any unit whose new row had no newer sale.
  const rowsWith = (tx?: string, value?: number): unknown[][] => [
    ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile', 'Transaction Date', 'Transaction Value'],
    ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0501234567', tx ?? '', value ?? ''],
  ];

  const run = (rows: unknown[][], existing: Map<string, Property>) =>
    ImportPipeline.dryRun({
      sheet: new ParsedSheet('f.xlsx', rows), headerRow: 0,
      columns: ImportPipeline.buildColumns(rows, 0), type: DataSetType.register,
      communityFallback: 'Dubai Hills', datasetId: 'ds2', existingByUnitKey: existing,
    });

  const seeded = () => {
    const first = run(rowsWith('2024-05-01', 1_500_000), new Map<string, Property>());
    const p = first.newProperties[0];
    return { property: p, byKey: new Map([[p.unitKey, p]]) };
  };

  it('preserves an existing sale when the new file has no transaction', () => {
    const { property, byKey } = seeded();
    expect(property.lastTransactionValue).toBe(1_500_000);

    // The next monthly file refreshes owners but carries no transaction column data.
    const updated = run(rowsWith(), byKey).updatedProperties[0];

    expect(updated.lastTransactionValue).toBe(1_500_000);
    expect(updated.lastTransactionDate).toBe(property.lastTransactionDate);
    expect(updated.txCount).toBe(1);
  });

  it('takes the newer sale when the new file has one', () => {
    const { byKey } = seeded();
    const updated = run(rowsWith('2025-09-01', 2_100_000), byKey).updatedProperties[0];

    expect(updated.lastTransactionValue).toBe(2_100_000);
    expect(new Date(updated.lastTransactionDate!).getFullYear()).toBe(2025);
  });

  it('keeps the older sale when the new file has an older one', () => {
    const { byKey } = seeded();
    const updated = run(rowsWith('2020-01-01', 900_000), byKey).updatedProperties[0];

    expect(updated.lastTransactionValue).toBe(1_500_000);
    expect(new Date(updated.lastTransactionDate!).getFullYear()).toBe(2024);
  });

  it('never lowers txCount', () => {
    const { property, byKey } = seeded();
    property.txCount = 4;
    const updated = run(rowsWith('2024-05-01', 1_500_000), byKey).updatedProperties[0];
    expect(updated.txCount).toBe(4);
  });
});

// The "Update an existing data set" feature: a revised sheet must change only
// what's different, add new columns, and NEVER erase on a blank — while the
// team's work (notes / calls / state / allocations) rides through untouched.
describe('update import — blank keeps, changes merge, work is preserved', () => {
  const importOne = (rows: unknown[][], datasetId = 'ds-seed') => ImportPipeline.dryRun({
    sheet: new ParsedSheet('f.xlsx', rows), headerRow: 0,
    columns: ImportPipeline.buildColumns(rows, 0), type: DataSetType.register,
    communityFallback: 'Dubai Hills', datasetId, existingByUnitKey: new Map<string, Property>(),
  }).newProperties[0];

  // A unit already in the vault, worked by a broker.
  const seeded = () => {
    const p = importOne([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile', 'Bedrooms', 'Type', 'View'],
      ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0501234567', '3', 'Apartment', 'Golf'],
    ], 'ds-original');
    p.notes = 'call back Tuesday';
    p.assignedTo = 'u-sara';
    p.state = PropertyState.assigned;
    return { p, byKey: new Map([[p.unitKey, p]]) };
  };

  const update = (rows: unknown[][], byKey: Map<string, Property>, keepExistingDataset: boolean) =>
    ImportPipeline.dryRun({
      sheet: new ParsedSheet('f.xlsx', rows), headerRow: 0,
      columns: ImportPipeline.buildColumns(rows, 0), type: DataSetType.register,
      communityFallback: 'Dubai Hills', datasetId: 'ds-target',
      existingByUnitKey: byKey, keepExistingDataset,
    });

  it('changes what differs, keeps blanks, adds a new column, keeps old columns', () => {
    const { byKey } = seeded();
    // New phone + new owner name + a new "Location" column; Bedrooms and Type
    // columns are absent entirely, and "View" is not re-sent.
    const u = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile', 'Location'],
      ['Dubai Hills', 'T1', '101', 'Amir H. Haddad', '0559999999', 'Near park'],
    ], byKey, true).updatedProperties[0];

    expect(u.owner.phone).toBe('971559999999');       // changed
    expect(u.owner.name).toBe('Amir H. Haddad');       // changed
    expect(u.beds).toBe(3);                            // absent column → kept
    expect(u.propertyType).toBe('Apartment');          // absent column → kept
    expect(u.extra.Location).toBe('Near park');        // new column added
    expect(u.extra.View).toBe('Golf');                 // old column survived
  });

  it('a blank cell never erases an existing value', () => {
    const { byKey } = seeded();
    // Owner name and mobile columns present but EMPTY for this row.
    const u = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', '', ''],
    ], byKey, true).updatedProperties[0];

    expect(u.owner.name).toBe('Amir Haddad');          // blank → kept
    expect(u.owner.phone).toBe('971501234567');        // blank → kept
  });

  it('keeps notes, allocation and state through an update', () => {
    const { byKey } = seeded();
    const u = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0559999999'],
    ], byKey, true).updatedProperties[0];

    expect(u.notes).toBe('call back Tuesday');
    expect(u.assignedTo).toBe('u-sara');
    expect(u.state).toBe(PropertyState.assigned);
  });

  it('keepExistingDataset leaves a matched unit in its own set; a new unit joins the target', () => {
    const { byKey } = seeded();
    const res = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0559999999'], // matched
      ['Dubai Hills', 'T1', '999', 'New Owner', '0561112233'],   // brand new
    ], byKey, true);

    expect(res.updatedProperties[0].datasetId).toBe('ds-original'); // stayed put
    expect(res.newProperties[0].datasetId).toBe('ds-target');       // joined target
  });

  it('without the flag (a fresh re-import) a matched unit is re-tagged', () => {
    const { byKey } = seeded();
    const u = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0559999999'],
    ], byKey, false).updatedProperties[0];

    expect(u.datasetId).toBe('ds-target');
  });
});

// The ownership register lists co-owners on separate rows for the same unit;
// the import must keep every owner (with their own number), not overwrite.
describe('co-owners — separate rows, same unit', () => {
  const run = (r: unknown[][]) => ImportPipeline.dryRun({
    sheet: new ParsedSheet('reg.xlsx', r), headerRow: 0,
    columns: ImportPipeline.buildColumns(r, 0), type: DataSetType.register,
    communityFallback: 'Dubai Hills', datasetId: 'ds', existingByUnitKey: new Map<string, Property>(),
  });

  it('collapses two owner rows into ONE unit carrying both owners', () => {
    const res = run([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Ahmed Khan', '0501110001'],
      ['Dubai Hills', 'T1', '101', 'Fatima Khan', '0502220002'],
    ]);
    expect(res.newProperties).toHaveLength(1);
    const p = res.newProperties[0];
    expect(p.hasMultipleOwners).toBe(true);
    expect(p.allOwners.map(o => o.name)).toEqual(['Ahmed Khan', 'Fatima Khan']);
    // Each owner keeps their OWN number.
    expect(p.allOwners[0].phone).toBe('971501110001');
    expect(p.allOwners[1].phone).toBe('971502220002');
    // Primary mirrors the first owner.
    expect(p.owner.name).toBe('Ahmed Khan');
    expect(res.inFileDuplicates).toBe(0); // a co-owner is not a duplicate
  });

  it('counts a genuinely repeated owner (same unit + same person) as a duplicate', () => {
    const res = run([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Ahmed Khan', '0501110001'],
      ['Dubai Hills', 'T1', '101', 'Ahmed Khan', '0501110001'],
    ]);
    expect(res.newProperties).toHaveLength(1);
    expect(res.newProperties[0].allOwners).toHaveLength(1);
    expect(res.inFileDuplicates).toBe(1);
  });

  it('a single-owner unit has no co-owners', () => {
    const p = run([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Solo Owner', '0501110001'],
    ]).newProperties[0];
    expect(p.hasMultipleOwners).toBe(false);
    expect(p.allOwners).toHaveLength(1);
  });
});

// Updating a unit whose ownership changed. The per-upload choice decides whether
// the file is the authoritative owner list (replace) or an add-only patch.
describe('update import — owner replace vs patch', () => {
  const build = (rows: unknown[][]) => ImportPipeline.dryRun({
    sheet: new ParsedSheet('f.xlsx', rows), headerRow: 0,
    columns: ImportPipeline.buildColumns(rows, 0), type: DataSetType.register,
    communityFallback: 'Dubai Hills', datasetId: 'ds', existingByUnitKey: new Map<string, Property>(),
  });
  const seededPair = () => {
    const p = build([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Ahmed Khan', '0501110001'],
      ['Dubai Hills', 'T1', '101', 'Fatima Khan', '0502220002'],
    ]).newProperties[0];
    return new Map([[p.unitKey, p]]);
  };
  const seededSolo = () => {
    const p = build([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '102', 'Solo Owner', '0501110001'],
    ]).newProperties[0];
    return new Map([[p.unitKey, p]]);
  };
  const update = (rows: unknown[][], byKey: Map<string, Property>, ownerMode?: 'replace' | 'patch') =>
    ImportPipeline.dryRun({
      sheet: new ParsedSheet('u.xlsx', rows), headerRow: 0,
      columns: ImportPipeline.buildColumns(rows, 0), type: DataSetType.register,
      communityFallback: 'Dubai Hills', datasetId: 'ds', existingByUnitKey: byKey,
      keepExistingDataset: true, ownerMode,
    });
  const oneOwner: unknown[][] = [
    ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
    ['Dubai Hills', 'T1', '101', 'Ahmed Khan', '0501110001'],
  ];

  it('replace: a unit that now lists one owner is reduced to one', () => {
    const byKey = seededPair();
    const res = update(oneOwner, byKey, 'replace');
    const u = res.updatedProperties[0];
    expect(u.allOwners.map(o => o.name)).toEqual(['Ahmed Khan']);
    expect(u.hasMultipleOwners).toBe(false);
    expect(res.changes.ownerCountChanges).toBe(1);
    expect(res.changes.ownerChanges).toBe(1);
  });

  it('patch: the same one-owner file keeps both existing owners', () => {
    const u = update(oneOwner, seededPair(), 'patch').updatedProperties[0];
    expect(u.allOwners.map(o => o.name)).toEqual(['Ahmed Khan', 'Fatima Khan']);
  });

  it('replace: a single-owner unit can gain a co-owner', () => {
    const u = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '102', 'Solo Owner', '0501110001'],
      ['Dubai Hills', 'T1', '102', 'New Partner', '0509990003'],
    ], seededSolo(), 'replace').updatedProperties[0];
    expect(u.allOwners.map(o => o.name)).toEqual(['Solo Owner', 'New Partner']);
    expect(u.hasMultipleOwners).toBe(true);
  });

  it('patch: a new number for an existing owner is added, nobody is removed', () => {
    const u = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', '101', 'Ahmed Khan', '0508880008'],
    ], seededPair(), 'patch').updatedProperties[0];
    expect(u.allOwners.map(o => o.name)).toEqual(['Ahmed Khan', 'Fatima Khan']);
    const ahmedNums = u.allOwners[0].allPhones.map(p => p.number);
    expect(ahmedNums).toContain('971501110001'); // kept
    expect(ahmedNums).toContain('971508880008'); // added
  });

  it('a blank owner row never wipes owners, in either mode', () => {
    const u = update([
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile', 'Location'],
      ['Dubai Hills', 'T1', '101', '', '', 'Near park'],
    ], seededPair(), 'replace').updatedProperties[0];
    expect(u.allOwners.map(o => o.name)).toEqual(['Ahmed Khan', 'Fatima Khan']);
    expect(u.extra.Location).toBe('Near park');
  });

  it('defaults to replace when no owner mode is given', () => {
    const u = update(oneOwner, seededPair()).updatedProperties[0];
    expect(u.allOwners).toHaveLength(1);
  });
});

describe('multiple numbers per owner (Mobile 1 / 2 / 3)', () => {
  const rows: unknown[][] = [
    ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile 1', 'Mobile 2', 'Mobile 3', 'Developer'],
    ['Dubai Hills', 'T1', '101', 'Amir Haddad', '0501234567', '0559876543', '0561112233', 'Emaar'],
    ['Dubai Hills', 'T1', '102', 'Layla Sharma', '0507654321', '', '', 'Emaar'],
  ];
  const run = (r: unknown[][]) => ImportPipeline.dryRun({
    sheet: new ParsedSheet('multi.xlsx', r), headerRow: 0,
    columns: ImportPipeline.buildColumns(r, 0), type: DataSetType.register,
    communityFallback: 'Dubai Hills', datasetId: 'ds', existingByUnitKey: new Map<string, Property>(),
  });

  it('recognises every Mobile N header as a phone column', () => {
    expect(ImportPipeline.isPhoneHeader('Mobile 1')).toBe(true);
    expect(ImportPipeline.isPhoneHeader('Mobile 3')).toBe(true);
    expect(ImportPipeline.isPhoneHeader('Contact No')).toBe(true);
    expect(ImportPipeline.isPhoneHeader('Developer')).toBe(false);
  });

  it('keeps all three numbers, labelled by their column header', () => {
    const p = run(rows).newProperties[0];
    expect(p.owner.allPhones).toEqual([
      { label: 'Mobile 1', number: '971501234567' },
      { label: 'Mobile 2', number: '971559876543' },
      { label: 'Mobile 3', number: '971561112233' },
    ]);
    expect(p.owner.hasMultiplePhones).toBe(true);
  });

  it('uses the first number as the primary, so masking/grouping/callable are unchanged', () => {
    const p = run(rows).newProperties[0];
    expect(p.owner.phone).toBe('971501234567');
    expect(p.callable).toBe(true);
  });

  it('does NOT leak the extra numbers into the extra text columns', () => {
    const p = run(rows).newProperties[0];
    expect(p.extra).toEqual({ Developer: 'Emaar' });
    expect(Object.keys(p.extra)).not.toContain('Mobile 2');
  });

  it('handles an owner with only one number', () => {
    const p = run(rows).newProperties[1];
    expect(p.owner.allPhones).toEqual([{ label: 'Mobile 1', number: '971507654321' }]);
    expect(p.owner.hasMultiplePhones).toBe(false);
  });

  it('de-duplicates the same number repeated across columns', () => {
    const dup: unknown[][] = [
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile 1', 'Mobile 2'],
      ['Dubai Hills', 'T1', '103', 'Rohan Nair', '0501112222', '0501112222'],
    ];
    expect(run(dup).newProperties[0].owner.allPhones).toHaveLength(1);
  });

  // Landlines aren't UAE mobiles, so keep them verbatim rather than guess a
  // country code — the broker still gets a dialable number.
  it('keeps a landline as-is rather than mangling it', () => {
    const land: unknown[][] = [
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile 1', 'Mobile 2'],
      ['Dubai Hills', 'T1', '104', 'Sofia Rossi', '0501234567', '043334444'],
    ];
    expect(run(land).newProperties[0].owner.allPhones).toEqual([
      { label: 'Mobile 1', number: '971501234567' },
      { label: 'Mobile 2', number: '043334444' },
    ]);
  });

  it('survives a round-trip through the wire/storage format', () => {
    const p = run(rows).newProperties[0];
    const revived = Property.fromJson(p.toJson());
    expect(revived.owner.allPhones).toHaveLength(3);
    expect(revived.owner.allPhones[1].label).toBe('Mobile 2');
  });

  it('falls back to the primary when no labelled list exists (pre-migration rows)', () => {
    const legacy = Property.fromJson({
      id: 'x', datasetId: 'd', state: 'pool', unitKey: 'u1', community: 'C',
      owner: { name: 'Old Row', phone: '971501234567' },
    });
    expect(legacy.owner.allPhones).toEqual([{ label: 'Mobile', number: '971501234567' }]);
    expect(legacy.owner.hasMultiplePhones).toBe(false);
  });
});

describe('owner grouping', () => {
  const mk = (id: string, name: string, phone?: string) => {
    const rows: unknown[][] = [
      ['Community', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
      ['Dubai Hills', 'T1', id, name, phone ?? ''],
    ];
    const res = ImportPipeline.dryRun({
      sheet: new ParsedSheet('f.xlsx', rows), headerRow: 0,
      columns: ImportPipeline.buildColumns(rows, 0), type: DataSetType.register,
      communityFallback: 'Dubai Hills', datasetId: 'ds', existingByUnitKey: new Map<string, Property>(),
    });
    return res.newProperties[0];
  };

  it('groups two units that share a phone number into one owner', () => {
    const a = mk('101', 'Amir Haddad', '0501234567');
    const b = mk('102', 'Amir Haddad', '0501234567');
    expect(ownerKeyOf(a)).toBe(ownerKeyOf(b));
    expect(groupByOwner([a, b])).toHaveLength(1);
    expect(groupByOwner([a, b])[0].properties).toHaveLength(2);
  });

  it('keeps different phone numbers as separate owners', () => {
    const a = mk('101', 'Amir Haddad', '0501234567');
    const b = mk('102', 'Layla Sharma', '0507654321');
    expect(groupByOwner([a, b])).toHaveLength(2);
  });
});

// A real vendor layout (the "Maple" export): Development + Community as the two
// community levels, plus columns the app now names — Unit code, Layout, Floor,
// Sale type, Rental status.
describe('vendor sheet field types (Maple layout)', () => {
  const headers = [
    'Development', 'Community', 'Unit code', 'Unit #', 'Beds', 'Layout', 'BUA', 'PLOT',
    'Floor', 'Type', 'Price Sold', 'Transaction date', 'Sale Type', 'Rental Status',
    'Rent Start date', 'Rent End date', 'Rental Amount', 'Owner', 'Mobile 1', 'Mobile 2',
    'Mobile 3', 'Mobile 4', 'Nationality',
  ];
  const row: unknown[] = [
    'Dubai Hills Estate', 'Maple 1', 'DE Maple-V-3', 3, 4, 'Type 2E', 2461, 3114.53,
    'G+1', 'Townhouse', 2686888, 42309, 'Initial Sale', 'New', '05/09/2025', '04/09/2026',
    290000, 'ANEES AHMED KHAN', 971508522585, '', '', '', 'India',
  ];
  const rows: unknown[][] = [headers, row];
  const columns = ImportPipeline.buildColumns(rows, 0);
  const byHeader = new Map(columns.map(c => [c.header, c.field]));

  it('reads Development as master community and Community as the sub-community', () => {
    expect(byHeader.get('Development')).toBe(ImportField.community);
    expect(byHeader.get('Community')).toBe(ImportField.cluster);
  });

  it('recognises the newly named descriptive columns', () => {
    expect(byHeader.get('Unit code')).toBe(ImportField.unitCode);
    expect(byHeader.get('Layout')).toBe(ImportField.layout);
    expect(byHeader.get('Floor')).toBe(ImportField.floor);
    expect(byHeader.get('Sale Type')).toBe(ImportField.saleType);
    expect(byHeader.get('Rental Status')).toBe(ImportField.rentalStatus);
  });

  it('keeps the core columns right, distinguishing "Type" from "Sale Type"', () => {
    expect(byHeader.get('Unit #')).toBe(ImportField.unitNumber);
    expect(byHeader.get('Type')).toBe(ImportField.propertyType);
    expect(byHeader.get('Owner')).toBe(ImportField.ownerName);
    expect(byHeader.get('Mobile 1')).toBe(ImportField.phone);
    expect(byHeader.get('BUA')).toBe(ImportField.sizeSqft);
    expect(byHeader.get('PLOT')).toBe(ImportField.plotSqft);
    expect(byHeader.get('Price Sold')).toBe(ImportField.transactionValue);
    expect(byHeader.get('Nationality')).toBe(ImportField.nationality);
  });

  it('stores typed fields on the record and descriptive ones in extra', () => {
    const res = ImportPipeline.dryRun({
      sheet: new ParsedSheet('maple.xlsx', rows), headerRow: 0, columns,
      type: DataSetType.register, communityFallback: 'Dubai Hills Estate',
      datasetId: 'ds', existingByUnitKey: new Map<string, Property>(),
    });
    expect(res.newProperties).toHaveLength(1);
    const p = res.newProperties[0];
    expect(p.community).toBe('Dubai Hills Estate');
    expect(p.cluster).toBe('Maple 1');
    expect(p.propertyType).toBe('Townhouse');
    expect(p.owner.name).toBe('ANEES AHMED KHAN');
    expect(p.owner.phone).toBe('971508522585');
    expect(p.extra['Unit code']).toBe('DE Maple-V-3');
    expect(p.extra['Layout']).toBe('Type 2E');
    expect(p.extra['Floor']).toBe('G+1');
    expect(p.extra['Sale type']).toBe('Initial Sale');
    expect(p.extra['Rental status']).toBe('New');
  });

  it('leaves a lone "Community" column as the master community', () => {
    const r: unknown[][] = [
      ['Community', 'Unit No', 'Owner Name', 'Mobile'],
      ['Palm Jumeirah', '5', 'A B', '0501234567'],
    ];
    const bh = new Map(ImportPipeline.buildColumns(r, 0).map(c => [c.header, c.field]));
    expect(bh.get('Community')).toBe(ImportField.community);
  });
});
