import { ImportPipeline } from './importPipeline';
import { ImportField, ColumnSpec, ParsedSheet } from './importModels';
import { DataSetType, Property } from '../types/models';
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
