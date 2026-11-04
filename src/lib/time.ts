import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { it } from 'date-fns/locale';

export const DEFAULT_TZ = 'Europe/Rome';

/** 'YYYY-MM-DD' di un istante nel fuso indicato */
export function localDate(ms: number | string | Date, tz: string): string {
  return formatInTimeZone(new Date(ms), tz, 'yyyy-MM-dd');
}

/** Istante (ms) della mezzanotte locale del giorno indicato */
export function dayStart(date: string, tz: string): number {
  return fromZonedTime(`${date}T00:00:00`, tz).getTime();
}

/** Istante (ms) di data + ora locale ('HH:mm') */
export function localToUtc(date: string, time: string, tz: string): number {
  return fromZonedTime(`${date}T${time.length === 5 ? time + ':00' : time}`, tz).getTime();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

/** Lunedì della settimana che contiene la data */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = domenica
  return addDays(date, -((dow + 6) % 7));
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function fmt(ms: number | string | Date, tz: string, pattern: string): string {
  return formatInTimeZone(new Date(ms), tz, pattern, { locale: it });
}

export function fmtTime(ms: number | string | Date, tz: string): string {
  return formatInTimeZone(new Date(ms), tz, 'HH:mm');
}

/** "lun 10 nov" da 'YYYY-MM-DD' */
export function fmtDay(date: string, pattern = 'EEE d MMM'): string {
  return formatInTimeZone(new Date(date + 'T12:00:00Z'), 'UTC', pattern, { locale: it });
}

export function todayIn(tz: string): string {
  return localDate(Date.now(), tz);
}

export function isValidDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
