/**
 * Normalizzazione dei nomi, identica a public.norm_name() nel database:
 * minuscolo, senza accenti/punteggiatura, parole in ordine alfabetico.
 * "Rossi  Giulia" → "giulia rossi", "D'Angelo Màrio" → "angelo d mario".
 */
const FROM = 'ÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ';
const TO = 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn';

export function normName(s: string | null | undefined): string {
  if (!s) return '';
  let t = '';
  for (const ch of s) {
    const i = FROM.indexOf(ch);
    t += i >= 0 ? TO[i] : ch;
  }
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
