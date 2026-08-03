import { DataSet, DataSetType, DataModule } from './models';

describe('DataSet round-trip', () => {
  it('carries lastUpdatedAt + updateCount through toJson/fromJson', () => {
    const d = new DataSet(
      'ds-1', 'Maple 3', 'vendor', DataSetType.register, DataModule.owners,
      'maple3.xlsx', 'Dubai Hills Estate', '2026-07-01T00:00:00.000Z',
      500, 561, 480, 12, '2026-08-01T09:30:00.000Z', 3,
    );
    const back = DataSet.fromJson(d.toJson());
    expect(back.importedAt).toBe('2026-07-01T00:00:00.000Z'); // original import date
    expect(back.lastUpdatedAt).toBe('2026-08-01T09:30:00.000Z');
    expect(back.updateCount).toBe(3);
  });

  it('defaults a never-updated set to no lastUpdatedAt and zero updates', () => {
    const d = new DataSet(
      'ds-2', 'Fresh', '', DataSetType.register, DataModule.owners,
      'f.xlsx', 'Community', '2026-08-01T00:00:00.000Z',
    );
    const back = DataSet.fromJson(d.toJson());
    expect(back.lastUpdatedAt).toBeUndefined();
    expect(back.updateCount).toBe(0);
  });
});
