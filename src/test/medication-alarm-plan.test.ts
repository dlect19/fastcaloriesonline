import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false } }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));

import { planAlarmSlots, IOS_MAX_PENDING, ANDROID_MAX_PENDING, MedicationSchedule, occurrenceId } from '@/lib/medicationAlarms';

const now = new Date(2026, 8, 26, 9, 0, 0); // local time
function sched(i: number, times: string[], extra: Partial<MedicationSchedule> = {}): MedicationSchedule {
  return { id: `s${String(i).padStart(3, '0')}`, drug_name: `Drug ${i}`, dosage: '1 tab', reminder_times: times, start_date: null, end_date: null, status: 'active', ...extra };
}
// 40 schedules, 3 doses a day each, all times after "now" spread across the day
const many = Array.from({ length: 40 }, (_, i) => sched(i, [`${String(10 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, '14:00', '21:30']));

describe('planAlarmSlots — fair chronological allocation', () => {
  it('iOS cap: includes the next dose of every one of 40 schedules', () => {
    const plan = planAlarmSlots(many, now, IOS_MAX_PENDING);
    expect(plan.slots.length).toBe(IOS_MAX_PENDING);
    expect(plan.capped).toBe(true);
    expect(plan.uncoveredScheduleIds).toEqual([]);
    const covered = new Set(plan.slots.map((s) => s.schedule.id));
    many.forEach((s) => expect(covered.has(s.id)).toBe(true));
    // each schedule's earliest future dose is the one included
    for (const s of many) {
      const first = plan.slots.filter((p) => p.schedule.id === s.id)[0];
      const [h, m] = s.reminder_times[0].split(':').map(Number);
      const expected = new Date(now); expected.setHours(h, m, 0, 0);
      const earliest = Math.min(expected.getTime(), new Date(now).setHours(14, 0, 0, 0));
      expect(first.at.getTime()).toBe(earliest);
    }
  });

  it('old per-schedule loop would starve schedules; new plan does not', () => {
    // simulate legacy behaviour: fill cap schedule by schedule
    const legacy = new Set<string>();
    let n = 0;
    for (const s of many) for (let k = 0; k < 42 && n < IOS_MAX_PENDING; k++, n++) legacy.add(s.id);
    expect(legacy.size).toBeLessThan(5);
    expect(new Set(planAlarmSlots(many, now, IOS_MAX_PENDING).slots.map((s) => s.schedule.id)).size).toBe(40);
  });

  it('remaining slots are filled strictly by global fire time and ids are unique', () => {
    const plan = planAlarmSlots(many, now, IOS_MAX_PENDING);
    const times = plan.slots.map((s) => s.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(plan.slots.map((s) => s.id)).size).toBe(plan.slots.length);
    expect(plan.coveredUntil?.getTime()).toBe(times[times.length - 1]);
  });

  it('preserves exact chosen local time', () => {
    const plan = planAlarmSlots([sched(1, ['07:45'])], now, 10);
    plan.slots.forEach((s) => { expect(s.at.getHours()).toBe(7); expect(s.at.getMinutes()).toBe(45); expect(s.at.getSeconds()).toBe(0); });
    expect(plan.slots[0].at.getDate()).toBe(27); // 07:45 today already passed
  });

  it('when schedules exceed the cap, the soonest next doses win and the rest are reported', () => {
    const plan = planAlarmSlots(many, now, 10);
    expect(plan.slots.length).toBe(10);
    expect(plan.uncoveredScheduleIds.length).toBe(30);
  });

  it('Android cap fits everything for 14 days without truncation', () => {
    const plan = planAlarmSlots(many.slice(0, 5), now, ANDROID_MAX_PENDING);
    expect(plan.capped).toBe(false);
    expect(plan.totalCandidates).toBe(plan.slots.length);
  });

  it('ignores paused / ended schedules and dedupes duplicate times', () => {
    const plan = planAlarmSlots([
      sched(1, ['10:00', '10:00']),
      sched(2, ['11:00'], { status: 'paused' }),
      sched(3, ['12:00'], { end_date: '2026-09-01' }),
    ], now, 60, 1);
    expect(plan.slots.map((s) => s.schedule.id)).toEqual(['s001', 's001']); // today + tomorrow
    expect(plan.slots[0].id).toBe(occurrenceId('s001', plan.slots[0].slotIso));
  });
});

describe('Android medication alarm sound + icon', () => {
  it('bundles the channel sound referenced by JS and native code', () => {
    expect(existsSync('android/app/src/main/res/raw/medication_alarm.wav')).toBe(true);
    const js = readFileSync('src/lib/medicationAlarms.ts', 'utf8');
    expect(js).toContain("MED_CHANNEL_ID = 'medication_alarms_v2'");
    expect(js).not.toContain("'alarm.wav'");
    expect(readFileSync('android/app/src/main/java/com/customers/fastcalories/app/ReminderScheduler.java', 'utf8')).toContain('/raw/medication_alarm');
  });
  it('small icon is the traced FastCalories mark, not the generic Material flame', () => {
    const xml = readFileSync('android/app/src/main/res/drawable/ic_stat_fastcalories.xml', 'utf8');
    expect(xml).not.toContain('M13.5,0.67s0.74,2.65');
    expect(xml).toContain('fast-calories-logo.png');
  });
});
