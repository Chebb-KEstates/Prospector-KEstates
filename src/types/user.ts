export enum UserRole {
  manager = 'manager',
  broker = 'broker',
}

export const UserRoleLabel: Record<UserRole, string> = {
  [UserRole.manager]: 'Manager',
  [UserRole.broker]: 'Broker',
};

export enum Permission {
  requestData = 'requestData',
  callOwners = 'callOwners',
  useDialer = 'useDialer',
  manageData = 'manageData',
  assignData = 'assignData',
  viewReports = 'viewReports',
  manageUsers = 'manageUsers',
  editSettings = 'editSettings',
}

export const PermissionLabel: Record<Permission, string> = {
  [Permission.requestData]: 'Request data from pool',
  [Permission.callOwners]: 'Call owners & log outcomes',
  [Permission.useDialer]: 'Use the calling dialer (auto tab flip)',
  [Permission.manageData]: 'Import & delete data',
  [Permission.assignData]: 'Assign & reclaim',
  [Permission.viewReports]: 'View team reports & ROI',
  [Permission.manageUsers]: 'Manage users',
  [Permission.editSettings]: 'Edit platform settings',
};

export function isManagerScope(p: Permission): boolean {
  return p === Permission.manageData || p === Permission.assignData ||
    p === Permission.viewReports || p === Permission.manageUsers ||
    p === Permission.editSettings;
}

export function defaultPermissions(role: UserRole): Set<Permission> {
  return role === UserRole.manager
    ? new Set(Object.values(Permission))
    // Brokers get the dialer by default; a manager can uncheck it per broker.
    : new Set([Permission.requestData, Permission.callOwners, Permission.useDialer]);
}

export class AppUser {
  private _permissions?: Set<Permission>;

  constructor(
    public id: string,
    public name: string,
    public email: string,
    public role: UserRole,
    public active = true,
    public team = '',
    permissions?: Set<Permission>,
    public viewCapOverride?: number,
    public createdAt?: string,
  ) {
    this._permissions = permissions;
  }

  get isManager(): boolean { return this.role === UserRole.manager; }

  get permissions(): Set<Permission> {
    return this._permissions ?? defaultPermissions(this.role);
  }

  can(p: Permission): boolean {
    return this.active && this.permissions.has(p);
  }

  copyWith(fields: {
    name?: string; email?: string; role?: UserRole; active?: boolean;
    team?: string; permissions?: Set<Permission> | null; viewCapOverride?: number | null;
  }): AppUser {
    return new AppUser(
      this.id,
      fields.name ?? this.name,
      fields.email ?? this.email,
      fields.role ?? this.role,
      fields.active ?? this.active,
      fields.team ?? this.team,
      fields.permissions !== undefined ? (fields.permissions ?? undefined) : this._permissions,
      fields.viewCapOverride !== undefined ? (fields.viewCapOverride ?? undefined) : this.viewCapOverride,
      this.createdAt,
    );
  }

  toJson(): Record<string, unknown> {
    return {
      id: this.id, name: this.name, email: this.email,
      role: this.role, active: this.active, team: this.team,
      permissions: Array.from(this.permissions).map(p => p),
      viewCapOverride: this.viewCapOverride,
      createdAt: this.createdAt,
    };
  }

  static fromJson(j: Record<string, unknown>): AppUser {
    const role = (Object.values(UserRole) as string[]).includes(j.role as string)
      ? j.role as UserRole : UserRole.broker;
    const byName = new Map(Object.values(Permission).map(p => [p, p]));
    const perms = (j.permissions as string[])
      ?.map(n => byName.get(n as Permission))
      .filter((p): p is Permission => p !== undefined);
    return new AppUser(
      j.id as string, (j.name as string) ?? '', (j.email as string) ?? '',
      role, (j.active as boolean) ?? true, (j.team as string) ?? '',
      perms ? new Set(perms) : undefined,
      j.viewCapOverride != null ? (j.viewCapOverride as number) : undefined,
      j.createdAt as string | undefined,
    );
  }
}

export const demoPassword = 'demo1234';

export const demoUsers: AppUser[] = [
  new AppUser(
    'u-director', 'The Director', 'director@demo.ae',
    UserRole.manager, true, 'Leadership', undefined, undefined, '2026-01-01T00:00:00.000Z',
  ),
  new AppUser(
    'u-sara', 'Sara Malik', 'sara@demo.ae',
    UserRole.broker, true, 'Secondary Market', undefined, undefined, '2026-01-01T00:00:00.000Z',
  ),
  new AppUser(
    'u-omar', 'Omar Farouk', 'omar@demo.ae',
    UserRole.broker, true, 'Secondary Market', undefined, undefined, '2026-01-01T00:00:00.000Z',
  ),
];

export function demoUserById(id?: string): AppUser | undefined {
  return demoUsers.find(u => u.id === id);
}
