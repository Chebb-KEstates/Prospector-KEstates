import { Property, OwnerInfo, CallOutcome } from '../types/models';

export class OwnerGroup {
  constructor(
    public key: string,
    public owner: OwnerInfo,
    public properties: Property[],
  ) {}

  get propertyIds(): string[] {
    return this.properties.map(p => p.id);
  }

  get dueFollowUp(): string | undefined {
    let due: string | undefined;
    for (const p of this.properties) {
      const f = p.nextFollowUpAt;
      if (f != null && (due == null || new Date(f) < new Date(due))) due = f;
    }
    return due;
  }

  get neverCalled(): boolean {
    return this.properties.every(p => p.lastCalledAt == null);
  }

  get lastOutcome(): CallOutcome | undefined {
    let latest: Property | undefined;
    for (const p of this.properties) {
      if (p.lastCalledAt == null) continue;
      if (latest == null || new Date(p.lastCalledAt) > new Date(latest.lastCalledAt!)) {
        latest = p;
      }
    }
    return latest?.lastOutcome;
  }

  get lastCalledAt(): string | undefined {
    let at: string | undefined;
    for (const p of this.properties) {
      const c = p.lastCalledAt;
      if (c != null && (at == null || new Date(c) > new Date(at))) at = c;
    }
    return at;
  }

  get areaSummary(): string {
    const parts = new Set<string>();
    for (const p of this.properties) {
      parts.add([p.community, p.cluster].filter(Boolean).join(' · '));
    }
    const list = Array.from(parts).sort();
    return list.length === 1
      ? list[0]
      : `${list[0]} +${list.length - 1}`;
  }
}

export function ownerKeyOf(p: Property): string {
  if (p.owner.phone && p.owner.phone.length > 0) {
    return `t:${p.owner.phone}`;
  }
  if (p.owner.name.trim().length > 0) {
    return `n:${p.owner.name.trim().toLowerCase()}`;
  }
  return `p:${p.id}`;
}

export function ownerRefOf(p: Property): string {
  const k = ownerKeyOf(p);
  let h = 0;
  for (let i = 0; i < k.length; i++) {
    h = ((h * 31) + k.charCodeAt(i)) & 0xFFFFFF;
  }
  return 'O-' + h.toString(16).toUpperCase().padStart(6, '0');
}

export function propertyRefOf(p: Property): string {
  return 'P-' + (p.id.length > 6 ? p.id.substring(p.id.length - 6) : p.id);
}

export function groupByOwner(properties: Property[]): OwnerGroup[] {
  const map = new Map<string, OwnerGroup>();
  for (const p of properties) {
    const key = ownerKeyOf(p);
    if (!map.has(key)) {
      map.set(key, new OwnerGroup(key, p.owner, []));
    }
    map.get(key)!.properties.push(p);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.owner.name.localeCompare(b.owner.name)
  );
}
