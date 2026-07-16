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
