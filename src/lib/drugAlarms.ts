// Schedules local device notifications (alarms) for active drug reminders.
// Works offline once scheduled — the OS fires them even if the app is closed.
// On native (Capacitor) uses @capacitor/local-notifications. No-op on web.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

interface ReminderPluginBridge {
  scheduleReminder(options: {
    title: string;
    message: string;
    triggerTime: number;
  }): Promise<{ success: boolean }>;
}

const ReminderPlugin = registerPlugin<ReminderPluginBridge>('ReminderPlugin');

interface ReminderRow {
  id: string;
  drug_name: string;
  dosage: string | null;
  reminder_times: string[]; // ["08:00", "20:00"]
  start_date: string | null; // "YYYY-MM-DD"
  end_date: string | null;   // "YYYY-MM-DD"
  is_active: boolean;
}

// Stable numeric id from a string (Capacitor requires int id)
function hashId(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) + input.charCodeAt(i);
  return Math.abs(h) % 2147000000;
}

export async function scheduleDrugAlarm(drugName: string, time: Date, dosage?: string | null): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return false;
  if (!(time instanceof Date) || Number.isNaN(time.getTime()) || time.getTime() <= Date.now()) return false;

  try {
    await ReminderPlugin.scheduleReminder({
      title: 'Medication Reminder',
      message: dosage ? `It's time to take ${dosage} of ${drugName}.` : `It's time to take your ${drugName}.`,
      triggerTime: time.getTime(),
    });
    console.info(`[drugAlarms] native Android alarm set for ${drugName} at ${time.toLocaleString()}`);
    return true;
  } catch (error) {
    console.warn('[drugAlarms] native ReminderPlugin failed, falling back to local notification', error);
    return false;
  }
}

export async function ensureAlarmPermissions(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch (e) {
    console.warn('[drugAlarms] permission error', e);
    return false;
  }
}

export async function ensureDrugChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await LocalNotifications.createChannel({
      id: 'drug_reminders',
      name: 'Medication Alarms',
      description: 'High-priority medication reminders',
      importance: 5, // IMPORTANCE_HIGH -> heads-up + sound
      visibility: 1,
      sound: 'alarm.wav', // optional custom sound in android/app/src/main/res/raw/alarm.wav
      vibration: true,
      lights: true,
      lightColor: '#FF0000',
    });
  } catch (e) {
    console.warn('[drugAlarms] channel error', e);
  }
}

export async function scheduleDrugAlarms(reminders: ReminderRow[]): Promise<{ scheduled: number }> {
  if (!Capacitor.isNativePlatform()) return { scheduled: 0 };

  const ok = await ensureAlarmPermissions();
  if (!ok) return { scheduled: 0 };
  await ensureDrugChannel();

  // Clear any previously scheduled drug reminders so we don't stack duplicates
  try {
    const pending = await LocalNotifications.getPending();
    const toCancel = pending.notifications.filter(n =>
      typeof n.extra === 'object' && n.extra && (n.extra as any).kind === 'drug_reminder'
    );
    if (toCancel.length > 0) {
      await LocalNotifications.cancel({ notifications: toCancel.map(n => ({ id: n.id })) });
    }
  } catch (e) {
    console.warn('[drugAlarms] cancel-pending error', e);
  }

  const now = new Date();
  const toSchedule: any[] = [];
  let nativeScheduled = 0;

  for (const r of reminders) {
    if (!r.is_active || !Array.isArray(r.reminder_times)) continue;
    const start = r.start_date ? new Date(r.start_date + 'T00:00:00') : now;
    const end = r.end_date ? new Date(r.end_date + 'T23:59:59') : new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    for (const t of r.reminder_times) {
      const [hh, mm] = t.split(':').map(Number);
      if (isNaN(hh) || isNaN(mm)) continue;

      // Walk day-by-day from max(now, start) to end and schedule one-shot alarms
      const cursor = new Date(Math.max(start.getTime(), now.getTime()));
      cursor.setSeconds(0, 0);

      for (let d = new Date(cursor); d <= end; d.setDate(d.getDate() + 1)) {
        const at = new Date(d);
        at.setHours(hh, mm, 0, 0);
        if (at.getTime() <= now.getTime()) continue;

        toSchedule.push({
          id: hashId(`${r.id}-${at.toISOString()}`),
          title: `💊 Time to take ${r.drug_name}`,
          body: r.dosage ? `Take ${r.dosage}` : 'Tap to log your dose',
          schedule: { at, allowWhileIdle: true },
          channelId: 'drug_reminders',
          sound: 'alarm.wav',
          smallIcon: 'ic_stat_icon_config_sample',
          extra: { kind: 'drug_reminder', reminder_id: r.id, url: '/drug-tracker' },
        });

        if (Capacitor.getPlatform() === 'android') {
          scheduleDrugAlarm(r.drug_name, at, r.dosage).then((ok) => {
            if (!ok) return;
          }).catch(() => {});
          nativeScheduled += 1;
        }

        // Capacitor cap: schedule at most 60 per reminder to stay well under OS limits
        if (toSchedule.length >= 400) break;
      }
      if (toSchedule.length >= 400) break;
    }
    if (toSchedule.length >= 400) break;
  }

  if (toSchedule.length === 0) return { scheduled: nativeScheduled };

  try {
    await LocalNotifications.schedule({ notifications: toSchedule });
    return { scheduled: Math.max(toSchedule.length, nativeScheduled) };
  } catch (e) {
    console.error('[drugAlarms] schedule error', e);
    return { scheduled: 0 };
  }
}

export async function cancelAllDrugAlarms(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const toCancel = pending.notifications.filter(n =>
      typeof n.extra === 'object' && n.extra && (n.extra as any).kind === 'drug_reminder'
    );
    if (toCancel.length > 0) {
      await LocalNotifications.cancel({ notifications: toCancel.map(n => ({ id: n.id })) });
    }
  } catch (e) {
    console.warn('[drugAlarms] cancel-all error', e);
  }
}
