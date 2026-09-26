// Keeps every drug_reminders write aligned with the live table columns.
// Unknown keys (e.g. legacy `times_needed`, `strength`, `doses_per_day`) are
// dropped so PostgREST never rejects a save with "column not in schema cache".

export const DRUG_REMINDER_COLUMNS = [
  'user_id', 'drug_name', 'dosage', 'frequency', 'reminder_times', 'start_date', 'end_date',
  'is_active', 'drug_usage_tracking_id', 'prescription_order_id', 'status', 'activated_at',
  'timezone', 'days_of_week', 'notes', 'instructions', 'source', 'instruction_source',
  'verification_status',
] as const;

const ALLOWED = new Set<string>(DRUG_REMINDER_COLUMNS);

export function sanitizeDrugReminderPayload(payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (ALLOWED.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

/** Doses per day implied by a documented frequency code. Never used to invent times. */
const DOSES_PER_DAY: Record<string, number> = {
  once_daily: 1, twice_daily: 2, three_times_daily: 3, four_times_daily: 4,
  every_6_hours: 4, every_8_hours: 3, five_times_daily: 5,
};

export function dosesPerDayFromFrequency(freq?: string | null): number | null {
  if (!freq) return null;
  return DOSES_PER_DAY[freq] ?? null;
}

/** Strength is stored in `notes` (no dedicated column). */
export function strengthFromNotes(notes?: string | null): string | null {
  const m = notes?.match(/^Strength:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}
