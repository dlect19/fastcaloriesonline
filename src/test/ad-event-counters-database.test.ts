// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';

const db = new PGlite();
const placement = '00000000-0000-0000-0000-000000000001';
const ad = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE ad_placements(id uuid PRIMARY KEY, advertisement_id uuid, status text,
      starts_at timestamptz, ends_at timestamptz, total_impressions int DEFAULT 0, total_clicks int DEFAULT 0);
    CREATE TABLE advertisements(id uuid PRIMARY KEY, ad_placement_id uuid REFERENCES ad_placements,
      is_active boolean, starts_at timestamptz, ends_at timestamptz, created_at timestamptz DEFAULT now(),
      total_impressions int DEFAULT 0, total_clicks int DEFAULT 0);
    CREATE TABLE ad_impressions(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      ad_placement_id uuid REFERENCES ad_placements, advertisement_id uuid REFERENCES advertisements,
      viewer_user_id uuid, event_type text);
    GRANT SELECT ON ad_placements, advertisements TO authenticated;
    GRANT INSERT ON ad_impressions TO authenticated;
    ALTER TABLE ad_impressions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_events ON ad_impressions FOR INSERT TO authenticated
      WITH CHECK (viewer_user_id = current_setting('test.viewer')::uuid);
  `);
  await db.exec(readFileSync('drizzle/migrations/0046_ad_event_atomic_counters.sql', 'utf8'));
}, 30000);
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec('RESET ROLE; DELETE FROM ad_impressions; DELETE FROM advertisements; DELETE FROM ad_placements;');
  await db.query("INSERT INTO ad_placements(id,status,starts_at,ends_at) VALUES($1,'active',now()-interval '1 day',now()+interval '1 day')", [placement]);
  await db.query('INSERT INTO advertisements(id,ad_placement_id,is_active) VALUES($1,$2,true)', [ad, placement]);
});
async function event(type: string, advertisement: string | null = null, user = viewer) {
  await db.exec(`SET ROLE authenticated; SET test.viewer = '${viewer}';`);
  try {
    await db.query('INSERT INTO ad_impressions(advertisement_id,ad_placement_id,viewer_user_id,event_type) VALUES($1,$2,$3,$4)', [advertisement, placement, user, type]);
  } finally { await db.exec('RESET ROLE'); }
}
async function totals() {
  return (await db.query('SELECT total_impressions,total_clicks FROM ad_placements')).rows[0];
}
it('records an unlinked admin announcement using its placement, resolves the creative, and increments both counters', async () => {
  await event('view'); await event('click');
  expect(await totals()).toEqual({ total_impressions: 1, total_clicks: 1 });
  expect((await db.query('SELECT advertisement_id FROM ad_impressions')).rows).toEqual([{ advertisement_id: ad }, { advertisement_id: ad }]);
  expect((await db.query('SELECT total_impressions,total_clicks FROM advertisements')).rows[0]).toEqual({ total_impressions: 1, total_clicks: 1 });
});
it('supports the old placement-as-ad ID without changing existing artwork or links', async () => {
  await event('view', placement);
  expect(await totals()).toEqual({ total_impressions: 1, total_clicks: 0 });
});
it('rejects another viewer and invalid types without incrementing counters', async () => {
  await expect(event('view', ad, ad)).rejects.toThrow(/row-level security/);
  await expect(event('fake', ad)).rejects.toThrow('INVALID_AD_EVENT');
  expect(await totals()).toEqual({ total_impressions: 0, total_clicks: 0 });
});
it('rejects mismatched identity and inactive ads', async () => {
  await expect(event('click', viewer)).rejects.toThrow('AD_IDENTITY_MISMATCH');
  await db.exec("UPDATE ad_placements SET status='paused'");
  await expect(event('view')).rejects.toThrow('AD_NOT_ACTIVE');
  expect(await totals()).toEqual({ total_impressions: 0, total_clicks: 0 });
});
it('serializes simultaneous writes without lost increments; customers cannot edit counters', async () => {
  await db.exec(`SET ROLE authenticated; SET test.viewer = '${viewer}';`);
  try {
    await Promise.all(Array.from({ length: 12 }, () => db.query("INSERT INTO ad_impressions(ad_placement_id,viewer_user_id,event_type) VALUES($1,$2,'view')", [placement, viewer])));
    await expect(db.exec('UPDATE ad_placements SET total_impressions=999')).rejects.toThrow(/permission denied/);
  } finally { await db.exec('RESET ROLE'); }
  expect(await totals()).toEqual({ total_impressions: 12, total_clicks: 0 });
});