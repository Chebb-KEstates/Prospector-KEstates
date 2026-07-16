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
