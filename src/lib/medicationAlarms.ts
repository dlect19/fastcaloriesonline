// Native medication alarm engine.
// Single source of scheduling: @capacitor/local-notifications (Android + iOS).
// No JS timers, no server dependency — once scheduled the OS fires them while the
// app is closed, backgrounded, screen-locked or offline.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

/** Android channels are immutable once created (sound/importance can't change),
 *  so the original 'drug_reminders' channel — which pointed at a sound file that
 *  was never bundled — is replaced by versioned channels. */
export const LEGACY_MED_CHANNEL_ID = 'drug_reminders';
export const MED_CHANNEL_ID = 'medication_alarms_v2';
export const MED_SILENT_CHANNEL_ID = 'medication_alarms_silent_v2';
/** Bundled at android/app/src/main/res/raw/medication_alarm.wav (Android only).
 *  iOS uses the system default notification sound. */
export const MED_ANDROID_SOUND = 'medication_alarm.wav';

export function channelFor(prefs: AlarmPrefs): string {
  return prefs.soundEnabled ? MED_CHANNEL_ID : MED_SILENT_CHANNEL_ID;
}

/** Per-notification sound: Android sound comes from the channel; iOS default. */
function soundFor(prefs: AlarmPrefs): string | undefined {
  if (!prefs.soundEnabled) return undefined;
  return Capacitor.getPlatform() === 'android' ? MED_ANDROID_SOUND : undefined;
}
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
export const HORIZON_DAYS = 14;
/** iOS hard limit is 64 pending per app; keep headroom for snoozes/tests. */
export const IOS_MAX_PENDING = 60;
export const ANDROID_MAX_PENDING = 400;
export function maxPendingFor(platform: string = Capacitor.getPlatform()): number {
  return platform === 'ios' ? IOS_MAX_PENDING : ANDROID_MAX_PENDING;
}

export interface PlannedSlot {
  schedule: MedicationSchedule;
  at: Date;
  slotIso: string;
  id: number;
}

export interface AlarmPlan {
  slots: PlannedSlot[];
  /** Every future occurrence inside the horizon, before the cap was applied. */
  totalCandidates: number;
  capped: boolean;
  /** Active schedules with at least one future occurrence in the horizon. */
  schedulesWithUpcoming: number;
  /** Schedules whose next dose could not fit under the cap. */
  uncoveredScheduleIds: string[];
  /** Latest time covered by the plan — alarms after this need an app open to refill. */
  coveredUntil: Date | null;
}

/**
 * Fair, chronological allocation of a limited number of OS alarm slots.
 *  1. Merge every future occurrence of every active schedule.
 *  2. Guarantee each schedule's NEXT dose first (earliest-first if even that
 *     exceeds the cap).
 *  3. Fill the remaining slots strictly by global fire time.
 * Times are the exact local times the customer chose; nothing is shifted.
 */
export function planAlarmSlots(
  schedules: MedicationSchedule[],
  now: Date = new Date(),
  cap: number = maxPendingFor(),
  horizonDays: number = HORIZON_DAYS,
): AlarmPlan {
  const all: PlannedSlot[] = [];
  const seen = new Set<number>();
  const firstBySchedule = new Map<string, PlannedSlot>();
  for (const s of schedules) {
    if (s.status !== 'active') continue;
    for (const at of expandOccurrences(s, now, horizonDays)) {
      const slotIso = at.toISOString();
      const id = occurrenceId(s.id, slotIso);
      if (seen.has(id)) continue; // duplicate times in one schedule
      seen.add(id);
      const slot = { schedule: s, at, slotIso, id };
      all.push(slot);
      const f = firstBySchedule.get(s.id);
      if (!f || at < f.at) firstBySchedule.set(s.id, slot);
    }
  }
  const byTime = (a: PlannedSlot, b: PlannedSlot) =>
    a.at.getTime() - b.at.getTime() || a.schedule.id.localeCompare(b.schedule.id);
  all.sort(byTime);
  const limit = Math.max(0, cap);

  const chosen = new Map<number, PlannedSlot>();
  for (const f of Array.from(firstBySchedule.values()).sort(byTime)) {
    if (chosen.size >= limit) break;
    chosen.set(f.id, f);
  }
  for (const slot of all) {
    if (chosen.size >= limit) break;
    chosen.set(slot.id, slot);
  }
  const slots = Array.from(chosen.values()).sort(byTime);
  const uncovered = Array.from(firstBySchedule.values())
    .filter((f) => !chosen.has(f.id))
    .map((f) => f.schedule.id);
  return {
    slots,
    totalCandidates: all.length,
    capped: all.length > slots.length,
    schedulesWithUpcoming: firstBySchedule.size,
    uncoveredScheduleIds: uncovered,
    coveredUntil: slots.length ? slots[slots.length - 1].at : null,
  };
}

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

export type PermissionOutcome = 'granted' | 'denied' | 'plugin_missing';

/** True when the native LocalNotifications plugin is compiled into this build. */
export function isLocalNotificationsAvailable(): boolean {
  try {
    return Capacitor.isPluginAvailable('LocalNotifications');
  } catch {
    return false;
  }
}

function isPluginMissingError(e: any): boolean {
  const msg = String(e?.message || e || '');
  return e?.code === 'UNIMPLEMENTED' || /not implemented|unimplemented|plugin is not/i.test(msg);
}

export const PLUGIN_MISSING_MESSAGE =
  'This app build is missing the reminder component. Please update to the latest FastCalories app. (Developers: run npx cap sync and rebuild.)';

export async function checkNotificationPermission(): Promise<PermissionOutcome> {
  if (!isNativeAlarmPlatform()) return 'denied';
  if (!isLocalNotificationsAvailable()) return 'plugin_missing';
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return 'granted';
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted' ? 'granted' : 'denied';
  } catch (e) {
    if (isPluginMissingError(e)) return 'plugin_missing';
    console.warn('[medicationAlarms] permission check failed', e);
    return 'denied';
  }
}

export async function ensurePermissions(): Promise<boolean> {
  return (await checkNotificationPermission()) === 'granted';
}

export async function ensureChannel(prefs: AlarmPrefs = DEFAULT_ALARM_PREFS): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await LocalNotifications.createChannel({
      id: MED_CHANNEL_ID,
      name: 'Medication alarms',
      description: 'Time-critical medication reminders with sound',
      importance: 5,
      visibility: prefs.privacyMode ? 0 : 1,
      sound: MED_ANDROID_SOUND,
      vibration: true,
      lights: true,
    });
    await LocalNotifications.createChannel({
      id: MED_SILENT_CHANNEL_ID,
      name: 'Medication reminders (silent)',
      description: 'Medication reminders without sound',
      importance: 4,
      visibility: prefs.privacyMode ? 0 : 1,
      vibration: true,
    });
  } catch {
    /* channel already exists */
  }
  try {
    await LocalNotifications.deleteChannel({ id: LEGACY_MED_CHANNEL_ID });
  } catch {
    /* already gone */
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

export type ExactAlarmStatus = 'granted' | 'denied' | 'unknown' | 'not_applicable';

/** Android 12+: without "Alarms & reminders" access the OS may delay alarms. */
export async function checkExactAlarmSetting(): Promise<ExactAlarmStatus> {
  if (Capacitor.getPlatform() !== 'android') return 'not_applicable';
  try {
    const r: any = await LocalNotifications.checkExactNotificationSetting();
    return r?.exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

export async function openExactAlarmSettings(): Promise<ExactAlarmStatus> {
  if (Capacitor.getPlatform() !== 'android') return 'not_applicable';
  try {
    const r: any = await LocalNotifications.changeExactNotificationSetting();
    return r?.exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

export type ChannelStatus = 'ok' | 'muted' | 'missing' | 'unknown' | 'not_applicable';

/** Detects a user-silenced/blocked medication channel on Android. */
export async function checkMedicationChannel(prefs: AlarmPrefs = DEFAULT_ALARM_PREFS): Promise<ChannelStatus> {
  if (Capacitor.getPlatform() !== 'android') return 'not_applicable';
  try {
    const { channels } = await LocalNotifications.listChannels();
    const ch = channels.find((c) => c.id === channelFor(prefs));
    if (!ch) return 'missing';
    const imp = Number((ch as any).importance ?? 3);
    if (imp <= 2) return 'muted';
    return 'ok';
  } catch {
    return 'unknown';
  }
}

export interface SyncResult {
  scheduled: number;
  cancelled: number;
  kept: number;
  reason?: string;
  /** Medication alarms pending on the device after this sync. */
  pending?: number;
  capped?: boolean;
  totalCandidates?: number;
  uncoveredSchedules?: number;
  coveredUntil?: string | null;
  exactAlarm?: ExactAlarmStatus;
  channel?: ChannelStatus;
}

/**
 * Idempotent re-sync. Computes the notifications that SHOULD exist for the given
 * active schedules (fair chronological plan under the OS cap), cancels anything
 * stale, and only schedules what is genuinely missing — repeat calls never duplicate.
 */
export async function syncMedicationAlarms(
  schedules: MedicationSchedule[],
  prefs: AlarmPrefs = DEFAULT_ALARM_PREFS,
): Promise<SyncResult> {
  if (!isNativeAlarmPlatform()) return { scheduled: 0, cancelled: 0, kept: 0, reason: 'not_native' };

  if (!prefs.notificationsEnabled) {
    await cancelAllMedicationAlarms();
    return { scheduled: 0, cancelled: 0, kept: 0, reason: 'notifications_disabled' };
  }

  const perm = await checkNotificationPermission();
  if (perm === 'plugin_missing') return { scheduled: 0, cancelled: 0, kept: 0, reason: 'plugin_missing' };
  if (perm !== 'granted') return { scheduled: 0, cancelled: 0, kept: 0, reason: 'permission_denied' };

  await ensureChannel(prefs);
  await registerActionTypes();
  const [exactAlarm, channel] = await Promise.all([checkExactAlarmSetting(), checkMedicationChannel(prefs)]);

  let existing: Awaited<ReturnType<typeof pendingMedicationNotifications>> = [];
  let pendingKnown = true;
  try {
    existing = await pendingMedicationNotifications();
  } catch {
    pendingKnown = false;
  }
  // Snoozes/tests are one-offs that must survive; they consume OS slots too.
  const oneOffs = existing.filter((n) => (n.extra as any)?.snooze || (n.extra as any)?.test);
  const cap = Math.max(0, maxPendingFor() - oneOffs.length);
  const plan = planAlarmSlots(schedules, new Date(), cap);

  const desired = new Map<number, any>();
  for (const slot of plan.slots) {
    const { title, body } = buildBody(slot.schedule, prefs);
    const s = slot.schedule;
    desired.set(slot.id, {
      id: slot.id,
      title,
      body,
      schedule: { at: slot.at, allowWhileIdle: true },
      channelId: channelFor(prefs),
      actionTypeId: MED_ACTION_TYPE,
      sound: soundFor(prefs),
      smallIcon: 'ic_stat_fastcalories',
      extra: {
        kind: MED_EXTRA_KIND,
        reminder_id: s.id,
        scheduled_for: slot.slotIso,
        client_key: doseClientKey(s.id, slot.slotIso),
        channel: channelFor(prefs),
        url: `/drug-tracker?reminder=${s.id}&slot=${encodeURIComponent(slot.slotIso)}`,
      },
    });
  }

  let cancelled = 0;
  let kept = 0;
  if (pendingKnown) {
    // Stale = not in plan, or scheduled on an old channel (pre-v2 / sound toggled).
    const stale = existing.filter((n) => {
      const x = n.extra as any;
      if (x?.snooze || x?.test) return false;
      return !desired.has(n.id) || x?.channel !== channelFor(prefs);
    });
    const staleIds = new Set(stale.map((n) => n.id));
    for (const n of existing) {
      if (desired.has(n.id) && !staleIds.has(n.id)) {
        kept++;
        desired.delete(n.id); // already scheduled correctly — do not re-add
      }
    }
    if (stale.length > 0) {
      try {
        await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
        cancelled = stale.length;
      } catch {
        /* noop */
      }
    }
  }

  const meta = {
    capped: plan.capped,
    totalCandidates: plan.totalCandidates,
    uncoveredSchedules: plan.uncoveredScheduleIds.length,
    coveredUntil: plan.coveredUntil ? plan.coveredUntil.toISOString() : null,
    exactAlarm,
    channel,
  };
  const toSchedule = Array.from(desired.values());
  let scheduled = 0;
  let reason: string | undefined;
  if (toSchedule.length > 0) {
    try {
      await LocalNotifications.schedule({ notifications: toSchedule });
      scheduled = toSchedule.length;
    } catch (e: any) {
      reason = e?.message || 'schedule_failed';
    }
  }
  let pending: number | undefined;
  try {
    pending = (await pendingMedicationNotifications()).filter((n) => !(n.extra as any)?.test).length;
  } catch {
    pending = undefined;
  }
  if (!reason && plan.schedulesWithUpcoming > 0 && pending === 0) reason = 'none_pending';
  return { scheduled, cancelled, kept, reason, pending, ...meta };
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
          channelId: channelFor(prefs),
          actionTypeId: MED_ACTION_TYPE,
          sound: soundFor(prefs),
          smallIcon: 'ic_stat_fastcalories',
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
  const perm = await checkNotificationPermission();
  if (perm === 'plugin_missing') return PLUGIN_MISSING_MESSAGE;
  if (perm !== 'granted') return 'Notification permission is not granted for FastCalories.';
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
          channelId: channelFor(prefs),
          sound: soundFor(prefs),
          smallIcon: 'ic_stat_fastcalories',
          extra: { kind: MED_EXTRA_KIND, test: true, url: '/drug-tracker' },
        },
      ],
    });
    return null;
  } catch (e: any) {
    return e?.message || 'Could not schedule the test reminder.';
  }
}
