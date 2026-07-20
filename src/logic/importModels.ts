import { Property, DataSetType } from '../types/models';

export enum ImportField {
  community = 'community',
  cluster = 'cluster',
  building = 'building',
  unitNumber = 'unitNumber',
  unitCode = 'unitCode',
  plotNumber = 'plotNumber',
  propertyType = 'propertyType',
  layout = 'layout',
  floor = 'floor',
  beds = 'beds',
  sizeSqft = 'sizeSqft',
  plotSqft = 'plotSqft',
  transactionDate = 'transactionDate',
  transactionValue = 'transactionValue',
  saleType = 'saleType',
  partyType = 'partyType',
  ownerName = 'ownerName',
  phone = 'phone',
  nationality = 'nationality',
  rentStart = 'rentStart',
  rentEnd = 'rentEnd',
  rentAmount = 'rentAmount',
  rentalStatus = 'rentalStatus',
  ignore = 'ignore',
}

export const ImportFieldLabel: Record<ImportField, string> = {
  [ImportField.community]: 'Community (master)',
  [ImportField.cluster]: 'Sub-community / project',
  [ImportField.building]: 'Building name',
  [ImportField.unitNumber]: 'Unit number',
  [ImportField.unitCode]: 'Unit code / reference',
  [ImportField.plotNumber]: 'Plot / pre-reg number',
  [ImportField.propertyType]: 'Property type',
  [ImportField.layout]: 'Layout / floor plan',
  [ImportField.floor]: 'Floor',
  [ImportField.beds]: 'Bedrooms',
  [ImportField.sizeSqft]: 'Built-up area (sq ft)',
  [ImportField.plotSqft]: 'Plot area (sq ft)',
  [ImportField.transactionDate]: 'Transaction date',
  [ImportField.transactionValue]: 'Transaction value (AED)',
  [ImportField.saleType]: 'Sale type (Initial / Resale)',
  [ImportField.partyType]: 'Party type (Buyer/Seller)',
  [ImportField.ownerName]: 'Owner name',
  [ImportField.phone]: 'Owner mobile',
  [ImportField.nationality]: 'Owner nationality',
  [ImportField.rentStart]: 'Rent start',
  [ImportField.rentEnd]: 'Rent end',
  [ImportField.rentAmount]: 'Annual rent (AED)',
  [ImportField.rentalStatus]: 'Rental status',
  [ImportField.ignore]: '— ignore —',
};

/**
 * Descriptive columns we keep as first-class, mappable fields but store in the
 * flexible `extra` JSON rather than dedicated model/DB columns. They appear in
 * the mapping dropdown, auto-map, and show up in the data table's column list —
 * without a schema change. The string is the canonical key written to `extra`,
 * so the same concept from differently-named vendor sheets unifies under one
 * column (e.g. "Layout" and "Floor Plan" both land in `extra['Layout']`).
 */
export const EXTRA_BACKED_FIELDS: [ImportField, string][] = [
  [ImportField.unitCode, 'Unit code'],
  [ImportField.layout, 'Layout'],
  [ImportField.floor, 'Floor'],
  [ImportField.saleType, 'Sale type'],
  [ImportField.rentalStatus, 'Rental status'],
];

export class ParsedSheet {
  constructor(
    public name: string,
    public rows: unknown[][],
  ) {}

  get isEmpty(): boolean { return this.rows.length === 0; }
}

export class ParsedFile {
  constructor(
    public fileName: string,
    public sheets: ParsedSheet[],
  ) {}

  get nonEmptySheets(): ParsedSheet[] {
    return this.sheets.filter(s => s.rows.length > 1);
  }
}

export class ColumnSpec {
  constructor(
    public index: number,
    public header: string,
    public field: ImportField,
    public filled: number,
    public sampled: number,
    public samples: string[],
  ) {}
}

export class DryRunResult {
  constructor(
    public type: DataSetType,
    public sourceRows: number,
    public invalidRows: number,
    public inFileDuplicates: number,
    public newProperties: Property[],
    public updatedProperties: Property[],
  ) {}

  get uniqueUnits(): number { return this.newProperties.length + this.updatedProperties.length; }
  get callable(): number {
    return this.newProperties.filter(p => p.callable).length +
      this.updatedProperties.filter(p => p.callable).length;
  }
}
