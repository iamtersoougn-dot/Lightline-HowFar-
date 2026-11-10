/** Small formatting helpers shared by insights, the brief and chat. */

export const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;

export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return '12am';
  if (hh === 12) return '12pm';
  return hh < 12 ? `${hh}am` : `${hh - 12}pm`;
}

export function timeLabel(d: Date): string {
  const m = d.getMinutes();
  if (m === 0) return hourLabel(d.getHours());
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** "tonight", "this morning"… for a time later today (or overnight). */
export function partOfDay(d: Date, now: Date): { en: string; pcm: string } {
  const h = d.getHours();
  const sameDay = d.toDateString() === now.toDateString();
  if (!sameDay && h < 5) return { en: 'overnight', pcm: 'for night' };
  if (!sameDay) return { en: 'tomorrow', pcm: 'tomorrow' };
  if (h >= 17 || h < 5) return { en: 'tonight', pcm: 'tonight' };
  if (h >= 12) return { en: 'this afternoon', pcm: 'this afternoon' };
  return { en: 'this morning', pcm: 'this morning' };
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "about 2 days", "about 9 hours" */
export function durationLabel(days: number): { en: string; pcm: string } {
  if (days < 1) {
    const h = Math.max(1, Math.round(days * 24));
    return { en: `about ${h} hour${h === 1 ? '' : 's'}`, pcm: `like ${h} hour${h === 1 ? '' : 's'}` };
  }
  const d = Math.round(days);
  return { en: `about ${d} day${d === 1 ? '' : 's'}`, pcm: `like ${d} day${d === 1 ? '' : 's'}` };
}

export const shortBankName = (name: string) =>
  name.replace(/\s*\(.*\)$/, '').replace(/\s+(Bank|Plc|MFB|IBTC)$/i, '');
