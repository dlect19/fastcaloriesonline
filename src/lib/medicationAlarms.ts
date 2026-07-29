// Native medication alarm engine.
// Single source of scheduling: @capacitor/local-notifications (Android + iOS).
// No JS timers, no server dependency — once scheduled the OS fires them while the
// app is closed, backgrounded, screen-locked or offline.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export const MED_CHANNEL_ID = 'drug_reminders';
export const MED_ACTION_TYPE = 'MEDICATION_REMINDER';
export const MED_EXTRA_KIND = 'medication_reminder';

export interface MedicationSchedule {
  id: string;
  drug_name: string;
  strength?: string | null;
  dosage: string | null;
  instructions?: string | null;
  /** "HH:MM" or "HH:MM:SS" — exactly the times the customer confirmed */
  reminder_times: string[];
  /** 0 = Sunday … 6 = Saturday. null/empty = every day */
  days_of_week?: number[] | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
}

export interface AlarmPrefs {
  privacyMode: boolean;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
}

export const DEFAULT_ALARM_PREFS: AlarmPrefs = {
  privacyMode: false,
  soundEnabled: true,
  notificationsEnabled: true,
};

export const isNativeAlarmPlatform = () => Capacitor.isNativePlatform();

/** Horizon we pre-schedule. OS caps pending notifications (iOS = 64), so we
 *  schedule a rolling window and re-sync on every app open / login. */
const HORIZON_DAYS = 14;
const MAX_PENDING = Capacitor.getPlatform() === 'ios' ? 60 : 400;

/** Deterministic 31-bit id so the same occurrence always maps to the same
 *  notification id — prevents duplicates and makes cancellation reliable. */
export function occurrenceId(reminderId: string, slotIso: string): number {
  const input = `${reminderId}|${slotIso}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147000000;
}

/** Stable key used for offline-safe dose history de-duplication. */
export function doseClientKey(reminderId: string, slotIso: string): string {
  return `${reminderId}:${slotIso}`;
}

function parseTime(t: string): [number, number] | null {
  const [hh, mm] = String(t).split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return [hh, mm];
}

/** Local-time occurrences for a schedule, from `from` up to the horizon. */
export function expandOccurrences(
  schedule: MedicationSchedule,
  from: Date = new Date(),
  horizonDays: number = HORIZON_DAYS,
): Date[] {
  const out: Date[] = [];
  if (!Array.isArray(schedule.reminder_times) || schedule.reminder_times.length === 0) return out;

  const start = schedule.start_date ? new Date(`${schedule.start_date}T00:00:00`) : from;
  const horizon = new Date(from.getTime() + horizonDays * 86400000);
  const end = schedule.end_date ? new Date(`${schedule.end_date}T23:59:59`) : horizon;
  const last = end < horizon ? end : horizon;
  const days = schedule.days_of_week && schedule.days_of_week.length > 0 ? schedule.days_of_week : null;

  const cursor = new Date(Math.max(start.getTime(), from.getTime()));
  cursor.setHours(0, 0, 0, 0);

  for (let d = new Date(cursor); d <= last; d.setDate(d.getDate() + 1)) {
    if (days && !days.includes(d.getDay())) continue;
    for (const t of schedule.reminder_times) {
      const parsed = parseTime(t);
      if (!parsed) continue;
      const at = new Date(d);
      at.setHours(parsed[0], parsed[1], 0, 0);
      if (at.getTime() <= from.getTime()) continue;
      if (at > last) continue;
      out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export async function ensurePermissions(): Promise<boolean> {
  if (!isNativeAlarmPlatform()) return false;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch {
    return false;
  }
}

export async function ensureChannel(prefs: AlarmPrefs = DEFAULT_ALARM_PREFS): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await LocalNotifications.createChannel({
      id: MED_CHANNEL_ID,
      name: 'Medication Reminders',
      description: 'Time-critical medication reminders',
      importance: 5,
      visibility: prefs.privacyMode ? 0 : 1,
      sound: prefs.soundEnabled ? 'alarm.wav' : undefined,
      vibration: true,
      lights: true,
    });
  } catch {
    /* channel already exists */
  }
}

export async function registerActionTypes(): Promise<void> {
  if (!isNativeAlarmPlatform()) return;
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: MED_ACTION_TYPE,
          actions: [
            { id: 'TAKEN', title: 'Taken' },
            { id: 'SNOOZE', title: 'Remind me later' },
            { id: 'SKIP', title: 'Skip', destructive: true },
          ],
        },
      ],
    });
  } catch {
    /* not supported on this platform */
  }
}

function buildBody(s: MedicationSchedule, prefs: AlarmPrefs): { title: string; body: string } {
  if (prefs.privacyMode) {
    return {
      title: 'FastCalories Reminder',
      body: "It's time for your scheduled medication. Tap to view.",
    };
  }
  const name = s.strength ? `${s.drug_name} ${s.strength}` : s.drug_name;
  const detail = s.dosage || s.instructions || 'Tap to log your dose';
  return { title: `Time to take ${name}`, body: detail };
}

async function pendingMedicationNotifications() {
  const pending = await LocalNotifications.getPending();
  return pending.notifications.filter(
    (n) => typeof n.extra === 'object' && n.extra && (n.extra as any).kind === MED_EXTRA_KIND,
  );
}

/**
 * Idempotent re-sync. Computes the notifications that SHOULD exist for the given
 * active schedules, cancels anything stale (edited/deleted/completed schedules),
 * and only schedules what is genuinely missing — so repeat calls never duplicate.
 */
export async function syncMedicationAlarms(
  schedules: MedicationSchedule[],
  prefs: AlarmPrefs = DEFAULT_ALARM_PREFS,
): Promise<{ scheduled: number; cancelled: number; kept: number; reason?: string }> {
  if (!isNativeAlarmPlatform()) return { scheduled: 0, cancelled: 0, kept: 0, reason: 'not_native' };

  const active = schedules.filter((s) => s.status === 'active');

  if (!prefs.notificationsEnabled) {
    await cancelAllMedicationAlarms();
    return { scheduled: 0, cancelled: 0, kept: 0, reason: 'notifications_disabled' };
  }

  const granted = await ensurePermissions();
  if (!granted) return { scheduled: 0, cancelled: 0, kept: 0, reason: 'permission_denied' };

  await ensureChannel(prefs);
  await registerActionTypes();

  const now = new Date();
  const desired = new Map<number, any>();

  for (const s of active) {
    const { title, body } = buildBody(s, prefs);
    for (const at of expandOccurrences(s, now)) {
      if (desired.size >= MAX_PENDING) break;
      const slotIso = at.toISOString();
      const id = occurrenceId(s.id, slotIso);
      desired.set(id, {
        id,
        title,
        body,
        schedule: { at, allowWhileIdle: true },
        channelId: MED_CHANNEL_ID,
        actionTypeId: MED_ACTION_TYPE,
        sound: prefs.soundEnabled ? 'alarm.wav' : undefined,
        smallIcon: 'ic_stat_icon_config_sample',
        extra: {
          kind: MED_EXTRA_KIND,
          reminder_id: s.id,
          scheduled_for: slotIso,
          client_key: doseClientKey(s.id, slotIso),
          url: `/drug-tracker?reminder=${s.id}&slot=${encodeURIComponent(slotIso)}`,
        },
      });
    }
  }

  let cancelled = 0;
  let kept = 0;
  try {
    const existing = await pendingMedicationNotifications();
    const stale = existing.filter((n) => !desired.has(n.id) && !(n.extra as any)?.snooze);
    kept = existing.filter((n) => desired.has(n.id)).length;
    existing.forEach((n) => desired.delete(n.id)); // already scheduled — do not re-add
    if (stale.length > 0) {
      await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
      cancelled = stale.length;
    }
  } catch {
    /* getPending unsupported — fall through and schedule */
  }

  const toSchedule = Array.from(desired.values());
  if (toSchedule.length === 0) return { scheduled: 0, cancelled, kept };

  try {
    await LocalNotifications.schedule({ notifications: toSchedule });
    return { scheduled: toSchedule.length, cancelled, kept };
  } catch (e: any) {
    return { scheduled: 0, cancelled, kept, reason: e?.message || 'schedule_failed' };
  }
}

/** Cancel every pending notification belonging to one schedule. */
export async function cancelScheduleAlarms(reminderId: string): Promise<void> {
  if (!isNativeAlarmPlatform()) return;
  try {
    const existing = await pendingMedicationNotifications();
    const mine = existing.filter((n) => (n.extra as any)?.reminder_id === reminderId);
    if (mine.length > 0) {
      await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) });
    }
  } catch {
    /* noop */
  }
}

export async function cancelAllMedicationAlarms(): Promise<void> {
  if (!isNativeAlarmPlatform()) return;
  try {
    const existing = await pendingMedicationNotifications();
    if (existing.length > 0) {
      await LocalNotifications.cancel({ notifications: existing.map((n) => ({ id: n.id })) });
    }
  } catch {
    /* noop */
  }
}

/** One-off snooze alarm. Never touches the underlying medical schedule. */
export async function scheduleSnooze(
  schedule: MedicationSchedule,
  minutes: number,
  prefs: AlarmPrefs = DEFAULT_ALARM_PREFS,
): Promise<boolean> {
  if (!isNativeAlarmPlatform()) return false;
  const at = new Date(Date.now() + minutes * 60000);
  const { title, body } = buildBody(schedule, prefs);
  try {
    await ensureChannel(prefs);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: occurrenceId(schedule.id, `snooze-${at.toISOString()}`),
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          channelId: MED_CHANNEL_ID,
          actionTypeId: MED_ACTION_TYPE,
          sound: prefs.soundEnabled ? 'alarm.wav' : undefined,
          smallIcon: 'ic_stat_icon_config_sample',
          extra: {
            kind: MED_EXTRA_KIND,
            snooze: true,
            reminder_id: schedule.id,
            url: `/drug-tracker?reminder=${schedule.id}`,
          },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** Fires a notification a few seconds out so the user can verify their device. */
export async function sendTestReminder(prefs: AlarmPrefs = DEFAULT_ALARM_PREFS): Promise<string | null> {
  if (!isNativeAlarmPlatform()) return 'This test only runs in the installed mobile app.';
  const granted = await ensurePermissions();
  if (!granted) return 'Notification permission is not granted for FastCalories.';
  await ensureChannel(prefs);
  await registerActionTypes();
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 999000001,
          title: prefs.privacyMode ? 'FastCalories Reminder' : 'Test medication reminder',
          body: prefs.privacyMode
            ? "It's time for your scheduled medication. Tap to view."
            : 'If you can see this, your medication reminders will work.',
          schedule: { at: new Date(Date.now() + 8000), allowWhileIdle: true },
          channelId: MED_CHANNEL_ID,
          sound: prefs.soundEnabled ? 'alarm.wav' : undefined,
          smallIcon: 'ic_stat_icon_config_sample',
          extra: { kind: MED_EXTRA_KIND, test: true, url: '/drug-tracker' },
        },
      ],
    });
    return null;
  } catch (e: any) {
    return e?.message || 'Could not schedule the test reminder.';
  }
}
