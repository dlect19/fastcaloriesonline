/**
 * West African Time (WAT) = UTC+1
 * 
 * datetime-local inputs produce timezone-naive strings like "2026-03-17T04:20".
 * We treat those as WAT and convert to a proper ISO string with +01:00 offset
 * so the database stores the correct UTC equivalent.
 */

/** Convert a datetime-local value (treated as WAT) to an ISO string with +01:00 offset */
export function watLocalToISO(datetimeLocal: string): string {
  if (!datetimeLocal) return '';
  // datetime-local gives "YYYY-MM-DDTHH:mm" — append WAT offset
  return `${datetimeLocal}:00+01:00`;
}

/** Convert a UTC ISO timestamp from the database to a datetime-local value in WAT */
export function utcToWATLocal(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  // Add 1 hour for WAT
  const wat = new Date(date.getTime() + 60 * 60 * 1000);
  const y = wat.getUTCFullYear();
  const m = String(wat.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wat.getUTCDate()).padStart(2, '0');
  const h = String(wat.getUTCHours()).padStart(2, '0');
  const min = String(wat.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

/** Format a UTC ISO timestamp for display in WAT */
export function formatWATDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' });
}

/** Format a UTC ISO timestamp for display in WAT with time */
export function formatWATDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'short', timeStyle: 'short' });
}
