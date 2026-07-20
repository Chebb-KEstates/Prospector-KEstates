export const kOrgId = 'org-1';

export enum PropertyState {
  pool = 'pool',
  assigned = 'assigned',
  portfolio = 'portfolio',
  cooling = 'cooling',
  dnc = 'dnc',
}

export const PropertyStateLabel: Record<PropertyState, string> = {
  [PropertyState.pool]: 'In pool',
  [PropertyState.assigned]: 'Assigned',
  [PropertyState.portfolio]: 'Portfolio',
  [PropertyState.cooling]: 'Cooling down',
  [PropertyState.dnc]: 'Do not call',
};

export enum CallOutcome {
  noAnswer = 'noAnswer',
  unreachable = 'unreachable',
  callbackLater = 'callbackLater',
  interestedSell = 'interestedSell',
  interestedRent = 'interestedRent',
  notInterested = 'notInterested',
  alreadyListed = 'alreadyListed',
  dnc = 'dnc',
}

export const CallOutcomeLabel: Record<CallOutcome, string> = {
  [CallOutcome.noAnswer]: 'No answer',
  [CallOutcome.unreachable]: 'Unreachable / wrong number',
  [CallOutcome.callbackLater]: 'Call back later',
  [CallOutcome.interestedSell]: 'Interested — Sell',
  [CallOutcome.interestedRent]: 'Interested — Rent',
  [CallOutcome.notInterested]: 'Not interested',
  [CallOutcome.alreadyListed]: 'Listed with another agency',
  [CallOutcome.dnc]: 'Do not call',
};

export const CallOutcomeBuyerLabel: Record<CallOutcome, string> = {
  [CallOutcome.noAnswer]: 'No answer',
  [CallOutcome.unreachable]: 'Unreachable / wrong number',
  [CallOutcome.callbackLater]: 'Call back later',
  [CallOutcome.interestedSell]: 'Interested — hot lead',
  [CallOutcome.interestedRent]: 'Interested — warm / later',
  [CallOutcome.notInterested]: 'Not interested',
  [CallOutcome.alreadyListed]: 'Bought elsewhere',
  [CallOutcome.dnc]: 'Do not call',
};

export function isInterested(outcome: CallOutcome): boolean {
  return outcome === CallOutcome.interestedSell || outcome === CallOutcome.interestedRent;
}

export enum DataModule {
  owners = 'owners',
  leads = 'leads',
}

export const DataModuleLabel: Record<DataModule, string> = {
  [DataModule.owners]: 'Property owners',
  [DataModule.leads]: 'Buyer leads',
};

export interface ProspectFields {
  state: PropertyState;
  updatedAt: string;
  assignedTo?: string;
  assignedAt?: string;
  assignmentNote?: string;
  cooldownUntil?: string;
  portfolioSince?: string;
  lastOutcome?: CallOutcome;
  lastCalledAt?: string;
  callAttempts: number;
  nextFollowUpAt?: string;
  dncAt?: string;
}

/** One labelled contact number, e.g. { label: 'Mobile 2', number: '971501234567' }. */
export interface PhoneEntry { label: string; number: string; }

export class OwnerInfo {
  /**
   * Every number on record, labelled from the upload's column headers
   * (Mobile 1 / Mobile 2 / …). `phone` stays the PRIMARY number so masking,
   * owner-grouping, the generated `callable` column and every existing caller
   * keep working untouched.
   *
   * On list responses these numbers arrive MASKED, exactly like `phone` — the
   * real ones only come back from the audited single-record reveal.
   */
  phones: PhoneEntry[] = [];

  constructor(
    public name: string,
    public phone?: string,
    public nationality?: string,
  ) {}

  /** The full labelled list — falls back to the single primary number. */
  get allPhones(): PhoneEntry[] {
    if (this.phones.length > 0) return this.phones;
    return this.phone ? [{ label: 'Mobile', number: this.phone }] : [];
  }

  get hasMultiplePhones(): boolean { return this.allPhones.length > 1; }

  toJson(): Record<string, unknown> {
    return {
      name: this.name, phone: this.phone, nationality: this.nationality,
      phones: this.phones,
    };
  }

  static fromJson(j: Record<string, unknown>): OwnerInfo {
    const o = new OwnerInfo(
      (j.name as string) ?? '',
      j.phone as string | undefined,
      j.nationality as string | undefined,
    );
    o.phones = ((j.phones as PhoneEntry[]) ?? [])
      .filter(p => p && p.number)
      .map(p => ({ label: String(p.label ?? 'Mobile'), number: String(p.number) }));
    return o;
  }
}

export class Property implements ProspectFields {
  state: PropertyState = PropertyState.pool;
  updatedAt: string;
  assignedTo?: string;
  assignedAt?: string;
  assignmentNote?: string;
  cooldownUntil?: string;
  portfolioSince?: string;
  lastOutcome?: CallOutcome;
  lastCalledAt?: string;
  callAttempts = 0;
  nextFollowUpAt?: string;
  dncAt?: string;
  /** Free-text notes on the record, edited from the per-unit detail popup. */
  notes?: string;
  /** Any unmapped columns from the upload, kept verbatim so the table can show them. */
  extra: Record<string, string> = {};

  constructor(
    public id: string,
    public orgId: string,
    public datasetId: string,
    state: PropertyState,
    public unitKey: string,
    public community: string,
    public cluster?: string,
    public building?: string,
    public unitNumber?: string,
    public plotNumber?: string,
    public propertyType?: string,
    public beds?: number,
    public sizeSqft?: number,
    public plotSqft?: number,
    public lastTransactionDate?: string,
    public lastTransactionValue?: number,
    public txCount = 0,
    public rentStart?: string,
    public rentEnd?: string,
    public rentAmount?: number,
    public owner: OwnerInfo = new OwnerInfo(''),
    public createdAt: string = new Date().toISOString(),
    updatedAt?: string,
  ) {
    this.state = state;
    this.updatedAt = updatedAt ?? createdAt;
  }

  get callable(): boolean {
    return !!this.owner.phone && this.owner.phone.length > 0;
  }

  get unitLabel(): string {
    const b = this.building?.trim() ?? '';
    const u = this.unitNumber?.trim() ?? '';
    if (b && u) return `${b} · ${u}`;
    if (u) return `Unit ${u}`;
    if (b) return b;
    const p = this.plotNumber?.trim() ?? '';
    if (p) return `Plot ${p}`;
    return '(unidentified)';
  }

  copyWith(fields: Partial<Omit<Property, 'id' | 'orgId' | 'unitKey' | 'createdAt' | 'state' | 'assignedTo' | 'assignedAt' | 'assignmentNote' | 'cooldownUntil' | 'portfolioSince' | 'lastOutcome' | 'lastCalledAt' | 'callAttempts' | 'nextFollowUpAt' | 'dncAt' | 'notes'>> & { updatedAt?: string }): Property {
    const p = Property.fromJson(this.toJson());
    Object.assign(p, fields);
    return p;
  }

  toJson(): Record<string, unknown> {
    return {
      id: this.id, orgId: this.orgId, datasetId: this.datasetId,
      state: this.state, unitKey: this.unitKey, community: this.community,
      cluster: this.cluster, building: this.building, unitNumber: this.unitNumber,
      plotNumber: this.plotNumber, propertyType: this.propertyType,
      beds: this.beds, sizeSqft: this.sizeSqft, plotSqft: this.plotSqft,
      lastTransactionDate: this.lastTransactionDate,
      lastTransactionValue: this.lastTransactionValue, txCount: this.txCount,
      rentStart: this.rentStart, rentEnd: this.rentEnd, rentAmount: this.rentAmount,
      owner: this.owner.toJson(), createdAt: this.createdAt, updatedAt: this.updatedAt,
      assignedTo: this.assignedTo, assignedAt: this.assignedAt,
      assignmentNote: this.assignmentNote, cooldownUntil: this.cooldownUntil,
      portfolioSince: this.portfolioSince, lastOutcome: this.lastOutcome,
      lastCalledAt: this.lastCalledAt, callAttempts: this.callAttempts,
      nextFollowUpAt: this.nextFollowUpAt, dncAt: this.dncAt,
      notes: this.notes, extra: this.extra,
    };
  }

  static fromJson(j: Record<string, unknown>): Property {
    const s = j.state as string;
    const p = new Property(
      j.id as string, (j.orgId as string) ?? kOrgId,
      j.datasetId as string,
      (Object.values(PropertyState) as string[]).includes(s) ? s as PropertyState : PropertyState.pool,
      j.unitKey as string, (j.community as string) ?? '',
      j.cluster as string | undefined, j.building as string | undefined,
      j.unitNumber as string | undefined, j.plotNumber as string | undefined,
      j.propertyType as string | undefined,
      j.beds != null ? (j.beds as number) : undefined,
      j.sizeSqft != null ? (j.sizeSqft as number) : undefined,
      j.plotSqft != null ? (j.plotSqft as number) : undefined,
      j.lastTransactionDate as string | undefined,
      j.lastTransactionValue != null ? (j.lastTransactionValue as number) : undefined,
      (j.txCount as number) ?? 0,
      j.rentStart as string | undefined, j.rentEnd as string | undefined,
      j.rentAmount != null ? (j.rentAmount as number) : undefined,
      OwnerInfo.fromJson((j.owner as Record<string, unknown>) ?? {}),
      _date(j.createdAt)?.toISOString() ?? new Date().toISOString(),
      _date(j.updatedAt)?.toISOString(),
    );
    p.state = (s && (Object.values(PropertyState) as string[]).includes(s)) ? s as PropertyState : PropertyState.pool;
    p.assignedTo = j.assignedTo as string | undefined;
    p.assignedAt = j.assignedAt as string | undefined;
    p.assignmentNote = j.assignmentNote as string | undefined;
    p.cooldownUntil = j.cooldownUntil as string | undefined;
    p.portfolioSince = j.portfolioSince as string | undefined;
    p.lastOutcome = j.lastOutcome as CallOutcome | undefined;
    p.lastCalledAt = j.lastCalledAt as string | undefined;
    p.callAttempts = (j.callAttempts as number) ?? 0;
    p.nextFollowUpAt = j.nextFollowUpAt as string | undefined;
    p.dncAt = j.dncAt as string | undefined;
    p.notes = j.notes as string | undefined;
    p.extra = Object.fromEntries(
      Object.entries((j.extra as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)]));
    return p;
  }
}

export class Lead implements ProspectFields {
  state: PropertyState = PropertyState.pool;
  updatedAt: string;
  assignedTo?: string;
  assignedAt?: string;
  assignmentNote?: string;
  cooldownUntil?: string;
  portfolioSince?: string;
  lastOutcome?: CallOutcome;
  lastCalledAt?: string;
  callAttempts = 0;
  nextFollowUpAt?: string;
  dncAt?: string;
  extra: Record<string, string> = {};

  constructor(
    public id: string,
    public orgId: string,
    public datasetId: string,
    public enquiryDate?: string,
    public name = '',
    public phone?: string,
    public email?: string,
    public project?: string,
    public source?: string,
    extra?: Record<string, string>,
    public createdAt: string = new Date().toISOString(),
    state?: PropertyState,
    updatedAt?: string,
  ) {
    this.state = state ?? PropertyState.pool;
    this.updatedAt = updatedAt ?? createdAt;
    if (extra) this.extra = extra;
  }

  get callable(): boolean {
    return !!this.phone && this.phone.length > 0;
  }

  get leadKey(): string {
    if (this.phone && this.phone.length > 0) return `p:${this.phone}`;
    if (this.email && this.email.trim().length > 0) return `e:${this.email.trim().toLowerCase()}`;
    return `n:${this.name.trim().toLowerCase()}`;
  }

  refreshFrom(incoming: Lead, now: string): void {
    this.datasetId = incoming.datasetId;
    this.enquiryDate = incoming.enquiryDate ?? this.enquiryDate;
    if (incoming.name.trim().length > 0) this.name = incoming.name;
    this.phone = incoming.phone ?? this.phone;
    this.email = incoming.email ?? this.email;
    this.project = incoming.project ?? this.project;
    this.source = incoming.source ?? this.source;
    this.extra = { ...this.extra, ...incoming.extra };
    this.updatedAt = now;
  }

  toJson(): Record<string, unknown> {
    return {
      id: this.id, orgId: this.orgId, datasetId: this.datasetId,
      enquiryDate: this.enquiryDate, name: this.name,
      phone: this.phone, email: this.email, project: this.project,
      source: this.source, extra: this.extra, createdAt: this.createdAt,
      state: this.state, updatedAt: this.updatedAt,
      assignedTo: this.assignedTo, assignedAt: this.assignedAt,
      assignmentNote: this.assignmentNote, cooldownUntil: this.cooldownUntil,
      portfolioSince: this.portfolioSince, lastOutcome: this.lastOutcome,
      lastCalledAt: this.lastCalledAt, callAttempts: this.callAttempts,
      nextFollowUpAt: this.nextFollowUpAt, dncAt: this.dncAt,
    };
  }

  static fromJson(j: Record<string, unknown>): Lead {
    const s = j.state as string;
    const l = new Lead(
      j.id as string, (j.orgId as string) ?? kOrgId,
      (j.datasetId as string) ?? '',
      j.enquiryDate as string | undefined,
      (j.name as string) ?? '', j.phone as string | undefined,
      j.email as string | undefined, j.project as string | undefined,
      j.source as string | undefined,
      Object.fromEntries(
        Object.entries((j.extra as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)])
      ),
      _date(j.createdAt)?.toISOString() ?? new Date().toISOString(),
    );
    l.state = (s && (Object.values(PropertyState) as string[]).includes(s)) ? s as PropertyState : PropertyState.pool;
    l.updatedAt = _date(j.updatedAt)?.toISOString() ?? new Date().toISOString();
    l.assignedTo = j.assignedTo as string | undefined;
    l.assignedAt = j.assignedAt as string | undefined;
    l.assignmentNote = j.assignmentNote as string | undefined;
    l.cooldownUntil = j.cooldownUntil as string | undefined;
    l.portfolioSince = j.portfolioSince as string | undefined;
    l.lastOutcome = j.lastOutcome as CallOutcome | undefined;
    l.lastCalledAt = j.lastCalledAt as string | undefined;
    l.callAttempts = (j.callAttempts as number) ?? 0;
    l.nextFollowUpAt = j.nextFollowUpAt as string | undefined;
    l.dncAt = j.dncAt as string | undefined;
    return l;
  }
}

export class CallLog {
  constructor(
    public id: string,
    public orgId: string,
    public propertyIds: string[] = [],
    public leadIds: string[] = [],
    public brokerId: string,
    public at: string,
    public outcome: CallOutcome,
    public note?: string,
    public followUpAt?: string,
  ) {}

  toJson(): Record<string, unknown> {
    return {
      id: this.id, orgId: this.orgId, propertyIds: this.propertyIds,
      leadIds: this.leadIds, brokerId: this.brokerId, at: this.at,
      outcome: this.outcome, note: this.note, followUpAt: this.followUpAt,
    };
  }

  static fromJson(j: Record<string, unknown>): CallLog {
    return new CallLog(
      j.id as string, (j.orgId as string) ?? kOrgId,
      (j.propertyIds as string[]) ?? [],
      (j.leadIds as string[]) ?? [],
      j.brokerId as string,
      (j.at as string) ?? new Date().toISOString(),
      (j.outcome as CallOutcome) ?? CallOutcome.noAnswer,
      j.note as string | undefined,
      j.followUpAt as string | undefined,
    );
  }
}

export enum RequestStatus {
  pending = 'pending',
  approved = 'approved',
  denied = 'denied',
}

export class BatchRequest {
  constructor(
    public id: string,
    public orgId: string,
    public brokerId: string,
    public community: string,
    public cluster?: string,
    public count = 0,
    public unitIds: string[] = [],
    public note?: string,
    public at: string = new Date().toISOString(),
    public status: RequestStatus = RequestStatus.pending,
    public decidedAt?: string,
    public grantedCount = 0,
  ) {}

  get isHandPicked(): boolean { return this.unitIds.length > 0; }

  get summary(): string {
    return this.isHandPicked
      ? `${this.count} hand-picked units — ${this.cluster ?? this.community}`
      : `${this.count} units — ${this.cluster ?? this.community}`;
  }

  decided(s: RequestStatus, granted = 0): BatchRequest {
    return new BatchRequest(
      this.id, this.orgId, this.brokerId, this.community,
      this.cluster, this.count, this.unitIds, this.note,
      this.at, s, new Date().toISOString(), granted,
    );
  }

  toJson(): Record<string, unknown> {
    return {
      id: this.id, orgId: this.orgId, brokerId: this.brokerId,
      community: this.community, cluster: this.cluster, count: this.count,
      unitIds: this.unitIds, note: this.note, at: this.at,
      status: this.status, decidedAt: this.decidedAt, grantedCount: this.grantedCount,
    };
  }

  static fromJson(j: Record<string, unknown>): BatchRequest {
    return new BatchRequest(
      j.id as string, (j.orgId as string) ?? kOrgId,
      j.brokerId as string, (j.community as string) ?? '',
      j.cluster as string | undefined,
      (j.count as number) ?? 0, (j.unitIds as string[]) ?? [],
      j.note as string | undefined,
      (j.at as string) ?? new Date().toISOString(),
      (Object.values(RequestStatus) as string[]).includes(j.status as string)
        ? j.status as RequestStatus : RequestStatus.pending,
      j.decidedAt as string | undefined,
      (j.grantedCount as number) ?? 0,
    );
  }
}

export enum DataSetType {
  register = 'register',
  transactions = 'transactions',
}

export const DataSetTypeLabel: Record<DataSetType, string> = {
  [DataSetType.register]: 'Ownership register',
  [DataSetType.transactions]: 'Transaction records (DLD)',
};

export class DataSet {
  constructor(
    public id: string,
    public name: string,
    public source: string,
    public type: DataSetType,
    public module: DataModule = DataModule.owners,
    public fileName: string,
    public communityLabel: string,
    public importedAt: string,
    public cost?: number,
    public totalUnits = 0,
    public callableUnits = 0,
    public updatedUnits = 0,
  ) {}

  toJson(): Record<string, unknown> {
    return {
      id: this.id, name: this.name, source: this.source,
      type: this.type, module: this.module, fileName: this.fileName,
      communityLabel: this.communityLabel, importedAt: this.importedAt,
      cost: this.cost, totalUnits: this.totalUnits,
      callableUnits: this.callableUnits, updatedUnits: this.updatedUnits,
    };
  }

  static fromJson(j: Record<string, unknown>): DataSet {
    return new DataSet(
      j.id as string, (j.name as string) ?? '', (j.source as string) ?? '',
      (j.type as DataSetType) ?? DataSetType.register,
      (j.module as DataModule) ?? DataModule.owners,
      (j.fileName as string) ?? '', (j.communityLabel as string) ?? '',
      (j.importedAt as string) ?? new Date().toISOString(),
      j.cost != null ? (j.cost as number) : undefined,
      (j.totalUnits as number) ?? 0, (j.callableUnits as number) ?? 0,
      (j.updatedUnits as number) ?? 0,
    );
  }
}

export class VaultSettings {
  constructor(
    public notInterestedCooldownDays = 30,
    public listedCooldownDays = 30,
    public maxNoAnswerAttempts = 3,
    public assignmentExpiryDays = 14,
    public portfolioStaleDays = 21,
    public dailyViewCap = 100,
    public wifiLockEnabled = false,
    public officeIp = '',
  ) {}

  toJson(): Record<string, unknown> {
    return {
      notInterestedCooldownDays: this.notInterestedCooldownDays,
      listedCooldownDays: this.listedCooldownDays,
      maxNoAnswerAttempts: this.maxNoAnswerAttempts,
      assignmentExpiryDays: this.assignmentExpiryDays,
      portfolioStaleDays: this.portfolioStaleDays,
      dailyViewCap: this.dailyViewCap,
      wifiLockEnabled: this.wifiLockEnabled,
      officeIp: this.officeIp,
    };
  }

  static fromJson(j: Record<string, unknown>): VaultSettings {
    const d = new VaultSettings();
    return new VaultSettings(
      _int(j.notInterestedCooldownDays, d.notInterestedCooldownDays),
      _int(j.listedCooldownDays, d.listedCooldownDays),
      _int(j.maxNoAnswerAttempts, d.maxNoAnswerAttempts),
      _int(j.assignmentExpiryDays, d.assignmentExpiryDays),
      _int(j.portfolioStaleDays, d.portfolioStaleDays),
      _int(j.dailyViewCap, d.dailyViewCap),
      (j.wifiLockEnabled as boolean) ?? d.wifiLockEnabled,
      (j.officeIp as string) ?? d.officeIp,
    );
  }
}

export class AuditEntry {
  constructor(
    public id: string,
    public orgId: string,
    public at: string,
    public actorId: string,
    public action: string,
    public detail: string,
    public propertyIds: string[] = [],
  ) {}

  toJson(): Record<string, unknown> {
    return {
      id: this.id, orgId: this.orgId, at: this.at,
      actorId: this.actorId, action: this.action, detail: this.detail,
      propertyIds: this.propertyIds,
    };
  }

  static fromJson(j: Record<string, unknown>): AuditEntry {
    return new AuditEntry(
      j.id as string, (j.orgId as string) ?? kOrgId,
      (j.at as string) ?? new Date().toISOString(),
      (j.actorId as string) ?? '', (j.action as string) ?? '',
      (j.detail as string) ?? '', (j.propertyIds as string[]) ?? [],
    );
  }
}

function _int(v: unknown, fb: number): number {
  return v != null ? (v as number) : fb;
}

function _date(v: unknown): Date | undefined {
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
