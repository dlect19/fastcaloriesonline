import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Capacitor } from '@capacitor/core';
import {
  MedicationSchedule,
  AlarmPrefs,
  DEFAULT_ALARM_PREFS,
  syncMedicationAlarms,
  cancelScheduleAlarms,
  cancelAllMedicationAlarms,
  scheduleSnooze,
  doseClientKey,
  isNativeAlarmPlatform,
} from '@/lib/medicationAlarms';
import { recordDoseAction, flushDoseQueue, DoseStatus } from '@/lib/medicationDoses';

export interface MedicationSettings {
  notifications_enabled: boolean;
  privacy_mode: boolean;
  calendar_sync_enabled: boolean;
  snooze_minutes: number;
  sound_enabled: boolean;
  vibration_enabled: boolean;
}

export const DEFAULT_SETTINGS: MedicationSettings = {
  notifications_enabled: true,
  privacy_mode: false,
  calendar_sync_enabled: false,
  snooze_minutes: 10,
  sound_enabled: true,
  vibration_enabled: true,
};

export interface DoseRow {
  id: string;
  reminder_id: string;
  scheduled_for: string;
  status: string;
  taken_at: string | null;
  snoozed_until: string | null;
}

export interface Occurrence {
  schedule: MedicationSchedule;
  slotIso: string;
  at: Date;
  status: 'taken' | 'skipped' | 'snoozed' | 'upcoming' | 'due';
}

function normaliseTimes(times: any): string[] {
  if (!Array.isArray(times)) return [];
  return times.map((t: any) => String(t).slice(0, 5));
}

function toSchedule(row: any): MedicationSchedule & Record<string, any> {
  return { ...row, reminder_times: normaliseTimes(row.reminder_times) };
}

/** All slots for a schedule that fall on the given calendar day (local time). */
function daySlots(s: MedicationSchedule, day: Date): Date[] {
  const start = s.start_date ? new Date(`${s.start_date}T00:00:00`) : null;
  const end = s.end_date ? new Date(`${s.end_date}T23:59:59`) : null;
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  if (start && dayStart < new Date(start.toDateString())) return [];
  if (end && dayStart > end) return [];
  const dow = (s as any).days_of_week as number[] | null | undefined;
  if (dow && dow.length > 0 && !dow.includes(dayStart.getDay())) return [];
  return s.reminder_times
    .map((t) => {
      const [hh, mm] = t.split(':').map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
      const at = new Date(dayStart);
      at.setHours(hh, mm, 0, 0);
      return at;
    })
    .filter(Boolean) as Date[];
}

export function useMedicationReminders() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<(MedicationSchedule & Record<string, any>)[]>([]);
  const [doses, setDoses] = useState<DoseRow[]>([]);
  const [settings, setSettings] = useState<MedicationSettings>(DEFAULT_SETTINGS);
  const [syncInfo, setSyncInfo] = useState<{ scheduled: number; reason?: string } | null>(null);

  const alarmPrefs: AlarmPrefs = useMemo(
    () => ({
      privacyMode: settings.privacy_mode,
      soundEnabled: settings.sound_enabled,
      notificationsEnabled: settings.notifications_enabled,
    }),
    [settings],
  );

  const logDiagnostic = useCallback(
    async (event_type: string, detail?: string) => {
      if (!user) return;
      try {
        await supabase.from('medication_reminder_diagnostics').insert({
          user_id: user.id,
          event_type,
          platform: Capacitor.getPlatform(),
          detail: detail?.slice(0, 300) ?? null,
        } as any);
      } catch {
        /* diagnostics must never block the user */
      }
    },
    [user],
  );

  const fetchAll = useCallback(async () => {
    if (!user) return;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [{ data: rem }, { data: doseRows }, { data: settingsRow }] = await Promise.all([
      supabase
        .from('drug_reminders')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['draft', 'active', 'paused', 'completed'])
        .order('created_at', { ascending: false }),
      supabase
        .from('medication_doses')
        .select('id, reminder_id, scheduled_for, status, taken_at, snoozed_until')
        .eq('user_id', user.id)
        .gte('scheduled_for', since)
        .order('scheduled_for', { ascending: false }),
      supabase.from('medication_settings').select('*').eq('user_id', user.id).maybeSingle(),
    ]);

    setSchedules(((rem as any[]) || []).map(toSchedule));
    setDoses(((doseRows as any[]) || []) as DoseRow[]);
    if (settingsRow) setSettings({ ...DEFAULT_SETTINGS, ...(settingsRow as any) });
    setLoading(false);
  }, [user]);

  /** Repairs device notifications so they match the database. Idempotent. */
  const resync = useCallback(
    async (list?: (MedicationSchedule & Record<string, any>)[]) => {
      const source = list ?? schedules;
      const result = await syncMedicationAlarms(source, {
        privacyMode: settings.privacy_mode,
        soundEnabled: settings.sound_enabled,
        notificationsEnabled: settings.notifications_enabled,
      });
      setSyncInfo({ scheduled: result.scheduled, reason: result.reason });
      if (result.reason === 'permission_denied') logDiagnostic('permission_denied');
      else if (result.reason && result.reason !== 'not_native' && result.reason !== 'notifications_disabled') {
        logDiagnostic('schedule_failed', result.reason);
      }
      return result;
    },
    [schedules, settings, logDiagnostic],
  );

  useEffect(() => {
    if (user) {
      fetchAll();
      flushDoseQueue().catch(() => undefined);
    }
  }, [user, fetchAll]);

  // Re-sync whenever schedules or preferences change, and when we come back online.
  useEffect(() => {
    if (loading || !isNativeAlarmPlatform()) return;
    resync().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, schedules, settings.notifications_enabled, settings.privacy_mode, settings.sound_enabled]);

  useEffect(() => {
    const onOnline = () => {
      flushDoseQueue().then((n) => n > 0 && fetchAll());
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [fetchAll]);

  const drafts = useMemo(() => schedules.filter((s) => s.status === 'draft'), [schedules]);
  const active = useMemo(() => schedules.filter((s) => s.status === 'active'), [schedules]);
  const paused = useMemo(() => schedules.filter((s) => s.status === 'paused'), [schedules]);
  const completed = useMemo(() => schedules.filter((s) => s.status === 'completed'), [schedules]);

  const doseByKey = useMemo(() => {
    const map = new Map<string, DoseRow>();
    doses.forEach((d) => map.set(doseClientKey(d.reminder_id, new Date(d.scheduled_for).toISOString()), d));
    return map;
  }, [doses]);

  const today: Occurrence[] = useMemo(() => {
    const now = new Date();
    const out: Occurrence[] = [];
    for (const s of active) {
      for (const at of daySlots(s, now)) {
        const slotIso = at.toISOString();
        const logged = doseByKey.get(doseClientKey(s.id, slotIso));
        const status: Occurrence['status'] = logged
          ? (logged.status as any)
          : at.getTime() <= now.getTime()
            ? 'due'
            : 'upcoming';
        out.push({ schedule: s, slotIso, at, status });
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [active, doseByKey]);

  const nextUp = useMemo(() => today.find((o) => o.status === 'upcoming') ?? null, [today]);

  /** Customer confirms a draft (optionally after editing the times) → alarms start. */
  const activateSchedule = useCallback(
    async (id: string, times: string[], patch: Record<string, any> = {}) => {
      const { error } = await supabase
        .from('drug_reminders')
        .update({
          ...patch,
          reminder_times: times,
          status: 'active',
          is_active: true,
          activated_at: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos',
        } as any)
        .eq('id', id);
      if (error) return { error: error.message };
      await logDiagnostic('schedule_activated');
      await fetchAll();
      return {};
    },
    [fetchAll, logDiagnostic],
  );

  const updateSchedule = useCallback(
    async (id: string, patch: Record<string, any>) => {
      const { error } = await supabase.from('drug_reminders').update(patch as any).eq('id', id);
      if (error) return { error: error.message };
      await cancelScheduleAlarms(id); // never leave stale notifications behind
      await fetchAll();
      return {};
    },
    [fetchAll],
  );

  const setScheduleStatus = useCallback(
    async (id: string, status: 'active' | 'paused' | 'completed' | 'cancelled') => {
      const res = await updateSchedule(id, { status, is_active: status === 'active' });
      return res;
    },
    [updateSchedule],
  );

  const createManualSchedule = useCallback(
    async (payload: Record<string, any>) => {
      if (!user) return { error: 'Not signed in' };
      const { error } = await supabase.from('drug_reminders').insert({
        ...payload,
        user_id: user.id,
        source: 'manual',
        instruction_source: 'customer_entered',
        verification_status: 'unverified',
        status: 'active',
        is_active: true,
        activated_at: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos',
      } as any);
      if (error) return { error: error.message };
      await fetchAll();
      return {};
    },
    [user, fetchAll],
  );

  /** Taken / Skip / Snooze — never modifies the underlying medical instructions. */
  const actOnDose = useCallback(
    async (occ: Occurrence, status: DoseStatus, snoozeMinutes?: number) => {
      if (!user) return { error: 'Not signed in' };
      const now = new Date();
      const snoozedUntil =
        status === 'snoozed' ? new Date(now.getTime() + (snoozeMinutes ?? settings.snooze_minutes) * 60000) : null;

      const { synced } = await recordDoseAction({
        reminder_id: occ.schedule.id,
        user_id: user.id,
        scheduled_for: occ.slotIso,
        status,
        taken_at: status === 'taken' ? now.toISOString() : null,
        snoozed_until: snoozedUntil ? snoozedUntil.toISOString() : null,
        client_key: doseClientKey(occ.schedule.id, occ.slotIso),
      });

      if (status === 'snoozed') {
        await scheduleSnooze(occ.schedule, snoozeMinutes ?? settings.snooze_minutes, alarmPrefs);
      }

      // Keep the legacy progress counter in step when the schedule came from a pharmacy order.
      if (status === 'taken' && (occ.schedule as any).drug_usage_tracking_id) {
        try {
          const trackingId = (occ.schedule as any).drug_usage_tracking_id;
          const { data: t } = await supabase
            .from('drug_usage_tracking')
            .select('doses_taken, total_doses')
            .eq('id', trackingId)
            .maybeSingle();
          if (t) {
            const taken = (t as any).doses_taken + 1;
            const done = taken >= (t as any).total_doses;
            await supabase
              .from('drug_usage_tracking')
              .update({ doses_taken: taken, last_taken_at: now.toISOString(), is_completed: done })
              .eq('id', trackingId);
            if (done) await setScheduleStatus(occ.schedule.id, 'completed');
          }
        } catch {
          /* progress sync is best-effort */
        }
      }

      await fetchAll();
      return { offline: !synced };
    },
    [user, settings.snooze_minutes, alarmPrefs, fetchAll, setScheduleStatus],
  );

  const saveSettings = useCallback(
    async (patch: Partial<MedicationSettings>) => {
      if (!user) return { error: 'Not signed in' };
      const next = { ...settings, ...patch };
      setSettings(next);
      const { error } = await supabase
        .from('medication_settings')
        .upsert({ user_id: user.id, ...next } as any, { onConflict: 'user_id' });
      if (error) return { error: error.message };
      if (!next.notifications_enabled) await cancelAllMedicationAlarms();
      return {};
    },
    [user, settings],
  );

  return {
    loading,
    schedules,
    drafts,
    active,
    paused,
    completed,
    doses,
    today,
    nextUp,
    settings,
    syncInfo,
    alarmPrefs,
    refresh: fetchAll,
    resync,
    activateSchedule,
    updateSchedule,
    setScheduleStatus,
    createManualSchedule,
    actOnDose,
    saveSettings,
    logDiagnostic,
  };
}
