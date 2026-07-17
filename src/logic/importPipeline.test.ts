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
