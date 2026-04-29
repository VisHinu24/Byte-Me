import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function fmtDate(d) {
  if (!d) return '—';
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, 'd MMM yyyy');
}

export function fmtRelative(d) {
  if (!d) return '—';
  const date = typeof d === 'string' ? parseISO(d) : d;
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function ageFromBirth(birthDate) {
  if (!birthDate) return null;
  const b = typeof birthDate === 'string' ? parseISO(birthDate) : birthDate;
  const diff = Date.now() - b.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

export function displayName(patient) {
  if (!patient) return 'Unknown';
  if (patient.displayName) return patient.displayName;
  const n = patient.name?.[0];
  if (!n) return 'Unknown';
  if (n.text) return n.text;
  return [...(n.given ?? []), n.family].filter(Boolean).join(' ');
}

export function textOf(cc) {
  if (!cc) return '';
  return cc.text ?? cc.coding?.[0]?.display ?? cc.coding?.[0]?.code ?? '';
}
