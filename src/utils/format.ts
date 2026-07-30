export function fmtDate(d?: string): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function fmtDateTime(d?: string): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fmtAed(v?: number): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency: 'AED',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

export function fmtArea(v?: number): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-AE').format(v) + ' sqft';
}

export function maskedPhone(phone?: string): string {
  if (!phone || phone.length < 4) return phone ?? '—';
  const visible = phone.slice(-4);
  const masked = phone.slice(0, -4).replace(/\d/g, '•');
  return masked + visible;
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function fmtInt(v: number): string {
  return new Intl.NumberFormat('en-AE').format(v);
}

/**
 * Some vendor sheets record co-owners in a single Owner Name cell —
 * "AHMED KHAN & FATIMA KHAN". Split them for display so both names show.
 *
 * Deliberately conservative separators — "&", "/", "+", and the standalone word
 * "and" between spaces — and NEVER a bare comma, because vendor data also writes
 * a single person as "LASTNAME, FIRSTNAME". Returns the whole string as one name
 * when nothing splits, so an ordinary owner is unaffected.
 */
export function splitOwnerNames(name?: string): string[] {
  const raw = (name ?? '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s*&\s*|\s*\/\s*|\s+and\s+|\s*\+\s*/i)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [raw];
}

/** True when an owner cell names more than one person. */
export function hasMultipleOwners(name?: string): boolean {
  return splitOwnerNames(name).length > 1;
}

/** First meaningful token of a name for greetings — skips titles/articles. */
export function greetingName(name: string): string {
  const skip = new Set(['the', 'mr', 'mrs', 'ms', 'dr', 'a', 'an']);
  const parts = name.trim().split(/\s+/).filter(Boolean);
  for (const p of parts) {
    if (!skip.has(p.toLowerCase().replace(/\./g, ''))) return p;
  }
  return parts[0] ?? name;
}

/** Relative "time ago" for feeds. */
export function timeAgo(at: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(at).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Milliseconds until a deadline (negative once past); null when there's none. */
export function remainingMs(deadline?: string, now: number = Date.now()): number | null {
  if (!deadline) return null;
  const t = new Date(deadline).getTime();
  return isNaN(t) ? null : t - now;
}

/**
 * Compact countdown label for the assignment timer: "2d 4h", "5h 12m", "18m",
 * or "Overdue" once the deadline has passed. Coarse on purpose — minutes only
 * matter in the last hour.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Overdue';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${Math.max(1, mins)}m`;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Big, grouped, human-readable phone for the sanctioned reveal panel. */
export function prettyPhone(phone?: string): string {
  if (!phone) return '—';
  const digits = phone.replace(/[^\d+]/g, '');
  const d = digits.startsWith('+') ? digits.slice(1) : digits;
  if (d.startsWith('971')) {
    const rest = d.slice(3);
    // +971 5X XXX XXXX
    if (rest.length >= 9) return `+971 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5, 9)}`;
    return `+971 ${rest}`;
  }
  // Generic grouping in 3s/4s
  return (digits.startsWith('+') ? '+' : '') + d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

/** Nationality → flag emoji (data, not an icon). Covers the UAE market; falls back to a globe. */
const FLAGS: Record<string, string> = {
  uae: '🇦🇪', emirati: '🇦🇪', 'united arab emirates': '🇦🇪',
  india: '🇮🇳', indian: '🇮🇳',
  pakistan: '🇵🇰', pakistani: '🇵🇰',
  uk: '🇬🇧', 'united kingdom': '🇬🇧', british: '🇬🇧', england: '🇬🇧',
  egypt: '🇪🇬', egyptian: '🇪🇬',
  'saudi arabia': '🇸🇦', saudi: '🇸🇦', ksa: '🇸🇦',
  lebanon: '🇱🇧', lebanese: '🇱🇧',
  jordan: '🇯🇴', jordanian: '🇯🇴',
  usa: '🇺🇸', 'united states': '🇺🇸', american: '🇺🇸',
  russia: '🇷🇺', russian: '🇷🇺',
  china: '🇨🇳', chinese: '🇨🇳',
  france: '🇫🇷', french: '🇫🇷',
  germany: '🇩🇪', german: '🇩🇪',
  canada: '🇨🇦', canadian: '🇨🇦',
  philippines: '🇵🇭', filipino: '🇵🇭',
  nigeria: '🇳🇬', nigerian: '🇳🇬',
  iran: '🇮🇷', iranian: '🇮🇷',
  syria: '🇸🇾', syrian: '🇸🇾',
  turkey: '🇹🇷', turkish: '🇹🇷',
  italy: '🇮🇹', italian: '🇮🇹',
  'south africa': '🇿🇦',
};
export function flagFor(nationality?: string): string {
  if (!nationality) return '🌐';
  return FLAGS[nationality.trim().toLowerCase()] ?? '🌐';
}
