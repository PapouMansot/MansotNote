/**
 * Helpers de dates — locale fr-FR, zéro dépendance (Intl uniquement).
 *
 * Deux familles de dates :
 *  - `Timestamp` (ms epoch) pour createdAt/updatedAt ;
 *  - chaînes ISO 'YYYY-MM-DD' (date locale, sans heure) pour les
 *    échéances de cartes — comparables lexicographiquement.
 */
import type { Timestamp } from '@/types';

const LOCALE = 'fr-FR';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
});

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const relativeFmt = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** « 12 mai 2025 » */
export function formatDate(ts: Timestamp): string {
  return dateFmt.format(new Date(ts));
}

/** « 14:32 » */
export function formatTime(ts: Timestamp): string {
  return timeFmt.format(new Date(ts));
}

/** « 12 mai 2025 14:32 » */
export function formatDateTime(ts: Timestamp): string {
  return dateTimeFmt.format(new Date(ts));
}

/**
 * Temps relatif : « à l'instant », « il y a 5 minutes », « dans 2 jours ».
 * Au-delà de ~30 jours, repli sur la date absolue.
 */
export function formatRelative(ts: Timestamp, now: Timestamp = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "à l'instant";
  if (abs < HOUR) return relativeFmt.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return relativeFmt.format(Math.round(diff / HOUR), 'hour');
  if (abs < 30 * DAY) return relativeFmt.format(Math.round(diff / DAY), 'day');
  return formatDate(ts);
}

/** True si l'horodatage tombe sur le jour local courant. */
export function isToday(ts: Timestamp, now: Timestamp = Date.now()): boolean {
  const a = new Date(ts);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Date locale → 'YYYY-MM-DD' (pas de dérive UTC). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → Date locale (minuit). Valeurs manquantes tolérées. */
export function parseISODate(iso: string): Date {
  const parts = iso.split('-').map(Number);
  const y = Number.isFinite(parts[0]) ? parts[0] : 1970;
  const m = Number.isFinite(parts[1]) ? parts[1] : 1;
  const d = Number.isFinite(parts[2]) ? parts[2] : 1;
  return new Date(y, m - 1, d);
}

/** Décale une date ISO de `days` jours (négatif autorisé). */
export function shiftISODate(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Date locale du jour, au format 'YYYY-MM-DD'. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

/** « 12 mai » — l'année n'est ajoutée que si elle diffère de celle courante. */
export function formatDueDate(iso: string, reference: Date = new Date()): string {
  const d = parseISODate(iso);
  const sameYear = d.getFullYear() === reference.getFullYear();
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/** État d'une échéance — utile pour la pastille colorée sur les cartes. */
export type DueDateStatus = 'overdue' | 'today' | 'upcoming';

/** En retard / aujourd'hui / à venir (comparaison lexicographique ISO). */
export function getDueDateStatus(iso: string, today: string = todayISO()): DueDateStatus {
  if (iso < today) return 'overdue';
  if (iso === today) return 'today';
  return 'upcoming';
}
