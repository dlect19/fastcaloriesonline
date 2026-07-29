import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  syncMedicationAlarms,
  scheduleSnooze,
  doseClientKey,
  isNativeAlarmPlatform,
  DEFAULT_ALARM_PREFS,
  MedicationSchedule,
} from '@/lib/medicationAlarms';
import { recordDoseAction, flushDoseQueue } from '@/lib/medicationDoses';

/**
 * Keeps device notifications in step with the database without the user having
 * to open the medication screen. Runs on login, app start and every resume, and
 * handles notification taps / action buttons.
 */
export function MedicationAlarmBootstrap() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const syncing = useRef(false);

  useEffect(() => {
    if (!user) return;

    const sync = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        await flushDoseQueue();
        if (!isNativeAlarmPlatform()) return;

        const [{ data: rows }, { data: settings }] = await Promise.all([
          supabase.from('drug_reminders').select('*').eq('user_id', user.id).eq('status', 'active'),
          supabase.from('medication_settings').select('*').eq('user_id', user.id).maybeSingle(),
        ]);

        const schedules: MedicationSchedule[] = ((rows as any[]) || []).map((r) => ({
          ...r,
          reminder_times: (r.reminder_times || []).map((t: any) => String(t).slice(0, 5)),
        }));

        const prefs = settings
          ? {
              privacyMode: (settings as any).privacy_mode,
              soundEnabled: (settings as any).sound_enabled,
              notificationsEnabled: (settings as any).notifications_enabled,
            }
          : DEFAULT_ALARM_PREFS;

        const res = await syncMedicationAlarms(schedules, prefs);
        if (res.reason && res.reason !== 'not_native' && res.reason !== 'notifications_disabled') {
          supabase
            .from('medication_reminder_diagnostics')
            .insert({
              user_id: user.id,
              event_type: res.reason === 'permission_denied' ? 'permission_denied' : 'schedule_failed',
              platform: Capacitor.getPlatform(),
              detail: res.reason,
            } as any)
            .then(() => undefined, () => undefined);
        }
      } catch {
        /* never block app start */
      } finally {
        syncing.current = false;
      }
    };

    sync();

    let removeResume: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) sync();
      }).then((h) => {
        removeResume = () => h.remove();
      });
    }

    const onOnline = () => sync();
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('online', onOnline);
      removeResume?.();
    };
  }, [user]);

  // Notification taps and action buttons
  useEffect(() => {
    if (!isNativeAlarmPlatform() || !user) return;
    let remove: (() => void) | undefined;

    LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
      const extra = (event.notification?.extra || {}) as any;
      if (extra.kind !== 'medication_reminder') return;

      const reminderId: string | undefined = extra.reminder_id;
      const slotIso: string | undefined = extra.scheduled_for;
      const actionId = event.actionId;

      if (reminderId && slotIso && (actionId === 'TAKEN' || actionId === 'SKIP')) {
        await recordDoseAction({
          reminder_id: reminderId,
          user_id: user.id,
          scheduled_for: slotIso,
          status: actionId === 'TAKEN' ? 'taken' : 'skipped',
          taken_at: actionId === 'TAKEN' ? new Date().toISOString() : null,
          client_key: doseClientKey(reminderId, slotIso),
        });
        return;
      }

      if (reminderId && actionId === 'SNOOZE') {
        const { data: settings } = await supabase
          .from('medication_settings')
          .select('snooze_minutes, privacy_mode, sound_enabled, notifications_enabled')
          .eq('user_id', user.id)
          .maybeSingle();
        const minutes = (settings as any)?.snooze_minutes ?? 10;
        const { data: row } = await supabase.from('drug_reminders').select('*').eq('id', reminderId).maybeSingle();
        if (row) {
          await scheduleSnooze(
            { ...(row as any), reminder_times: [] } as MedicationSchedule,
            minutes,
            settings
              ? {
                  privacyMode: (settings as any).privacy_mode,
                  soundEnabled: (settings as any).sound_enabled,
                  notificationsEnabled: (settings as any).notifications_enabled,
                }
              : DEFAULT_ALARM_PREFS,
          );
          if (slotIso) {
            await recordDoseAction({
              reminder_id: reminderId,
              user_id: user.id,
              scheduled_for: slotIso,
              status: 'snoozed',
              snoozed_until: new Date(Date.now() + minutes * 60000).toISOString(),
              client_key: doseClientKey(reminderId, slotIso),
            });
          }
        }
        return;
      }

      // Plain tap → deep-link to the medication screen
      navigate(extra.url || '/drug-tracker');
    }).then((h) => {
      remove = () => h.remove();
    });

    return () => remove?.();
  }, [user, navigate]);

  return null;
}
