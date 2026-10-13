import { DataSet, DataSetType, DataModule, BatchRequest, RequestStatus, UnitDecision, Property, PropertyStage, PropertyStageLabel, PROPERTY_STAGES, toPropertyStage } from './models';

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

describe('BatchRequest per-unit decisions', () => {
  const make = () => new BatchRequest(
    'r-1', 'org', 'b-1', 'Maple', undefined, 4, ['u1', 'u2', 'u3', 'u4'],
    undefined, '2026-10-01T10:00:00.000Z',
  );

  it('reads undecided units as pending', () => {
    const r = make();
    r.unitDecisions = { u1: UnitDecision.granted, u3: UnitDecision.denied };
    expect(r.pendingUnitIds).toEqual(['u2', 'u4']);
    expect(r.decidedUnitCount).toBe(2);
    expect(r.unitCountWith(UnitDecision.granted)).toBe(1);
    expect(r.unitCountWith(UnitDecision.unavailable)).toBe(0);
  });

  it('round-trips decisions through toJson/fromJson and drops unknown values', () => {
    const r = make();
    r.unitDecisions = { u1: UnitDecision.granted, u2: UnitDecision.unavailable };
    const j = r.toJson();
    (j.unitDecisions as Record<string, unknown>).u3 = 'maybe';
    const back = BatchRequest.fromJson(j);
    expect(back.unitDecisions).toEqual({ u1: UnitDecision.granted, u2: UnitDecision.unavailable });
    expect(back.pendingUnitIds).toEqual(['u3', 'u4']);
  });

  it('tolerates a payload without decisions (an older server)', () => {
    const j = make().toJson();
    delete j.unitDecisions;
    expect(BatchRequest.fromJson(j).pendingUnitIds).toHaveLength(4);
  });

  it('decided() keeps the areas and copies (not shares) the decisions', () => {
    const r = make();
    r.areas = [{ community: 'Maple', cluster: 'Maple 3', count: 4 }];
    r.unitDecisions = { u1: UnitDecision.denied };
    const d = r.decided(RequestStatus.approved, 2);
    expect(d.status).toBe(RequestStatus.approved);
    expect(d.grantedCount).toBe(2);
    expect(d.areas).toEqual(r.areas);
    d.unitDecisions.u2 = UnitDecision.granted;
    expect(r.unitDecisions.u2).toBeUndefined();
  });
});

describe('Property stage', () => {
  it('lists the five stages in journey order with their labels', () => {
    expect(PROPERTY_STAGES).toEqual([
      PropertyStage.none, PropertyStage.prospecting, PropertyStage.marketAppraisal,
      PropertyStage.listedOffline, PropertyStage.listedOnline,
    ]);
    expect(PROPERTY_STAGES.map(s => PropertyStageLabel[s]))
      .toEqual(['None', 'Prospecting', 'Market appraisal', 'Listed offline', 'Listed online']);
  });

  it('reads unknown or missing values as None rather than throwing', () => {
    expect(toPropertyStage('listedOnline')).toBe(PropertyStage.listedOnline);
    expect(toPropertyStage('sold')).toBe(PropertyStage.none);
    expect(toPropertyStage(undefined)).toBe(PropertyStage.none);
    expect(toPropertyStage(3)).toBe(PropertyStage.none);
  });

  it('round-trips through toJson/fromJson, and an older payload reads as None', () => {
    const p = Property.fromJson({ id: 'p1', unitKey: 'u|a|b|1', community: 'A', owner: { name: 'O' }, stage: 'marketAppraisal' });
    expect(p.stage).toBe(PropertyStage.marketAppraisal);
    expect(Property.fromJson(p.toJson()).stage).toBe(PropertyStage.marketAppraisal);
    const old = p.toJson();
    delete old.stage;
    expect(Property.fromJson(old).stage).toBe(PropertyStage.none);
  });
});
