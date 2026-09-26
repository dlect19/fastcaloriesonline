import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import {
  sanitizeDrugReminderPayload, DRUG_REMINDER_COLUMNS, dosesPerDayFromFrequency, strengthFromNotes,
} from '@/lib/drugReminderPayload';

const LIVE = ['id','user_id','drug_name','dosage','frequency','reminder_times','start_date','end_date','is_active','created_at','updated_at','drug_usage_tracking_id','prescription_order_id','status','activated_at','timezone','days_of_week','notes','instructions','source','instruction_source','verification_status'];

describe('drug_reminders payload alignment', () => {
  it('only allows live columns', () => {
    for (const c of DRUG_REMINDER_COLUMNS) expect(LIVE).toContain(c);
  });
  it('strips legacy columns that caused the schema-cache error', () => {
    const out = sanitizeDrugReminderPayload({ drug_name: 'X', times_needed: false, strength: '5mg', doses_per_day: 2, reminder_times: ['08:00'] });
    expect(out).toEqual({ drug_name: 'X', reminder_times: ['08:00'] });
  });
  it('derives expected doses and strength without extra columns', () => {
    expect(dosesPerDayFromFrequency('twice_daily')).toBe(2);
    expect(dosesPerDayFromFrequency('as_instructed')).toBeNull();
    expect(strengthFromNotes('Strength: 500mg')).toBe('500mg');
  });
  it('no create/activation source writes removed columns', () => {
    for (const f of ['src/components/pharmacy/MedicationScheduleDialog.tsx', 'supabase/functions/setup-drug-reminders/index.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/times_needed\s*:/);
      expect(src).not.toMatch(/doses_per_day\s*:/);
      expect(src).not.toMatch(/\bstrength\s*:\s*(product|strength)/);
    }
  });
});

describe('Android notification small icon', () => {
  const icon = 'android/app/src/main/res/drawable/ic_stat_fastcalories.xml';
  it('exists as a white monochrome vector', () => {
    expect(existsSync(icon)).toBe(true);
    const xml = readFileSync(icon, 'utf8');
    const fills = [...xml.matchAll(/fillColor="([^"]+)"/g)].map((m) => m[1]);
    expect(fills.length).toBeGreaterThan(0);
    fills.forEach((c) => expect(c).toBe('#FFFFFFFF'));
  });
  it('is referenced by manifest, native services, JS and config', () => {
    expect(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')).toMatch(/default_notification_icon"\s+android:resource="@drawable\/ic_stat_fastcalories"/);
    expect(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')).toContain('android:icon="@mipmap/ic_launcher"');
    for (const f of ['ReminderReceiver', 'FastCaloriesMessagingService']) {
      const j = readFileSync(`android/app/src/main/java/com/customers/fastcalories/app/${f}.java`, 'utf8');
      expect(j).toContain('setSmallIcon(R.drawable.ic_stat_fastcalories)');
    }
    for (const f of ['src/lib/medicationAlarms.ts', 'src/lib/drugAlarms.ts', 'capacitor.config.ts']) {
      const s = readFileSync(f, 'utf8');
      expect(s).not.toContain('ic_stat_icon_config_sample');
      expect(s).toContain('ic_stat_fastcalories');
    }
  });
});
