// @vitest-environment node
// Policy tests for migration 0033: order evidence, rider invites, payout settings,
// wallet repair audit. Each table is checked as owner/participant, as an unrelated
// signed-in user, and as anon.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, it, expect } from 'vitest';

const db = new PGlite();

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const CUSTOMER = '00000000-0000-0000-0000-0000000000c1';
const VENDOR_OWNER = '00000000-0000-0000-0000-0000000000b1';
const RIDER = '00000000-0000-0000-0000-0000000000d1';
const OTHER = '00000000-0000-0000-0000-0000000000f1';
const RIDER_PROFILE = '00000000-0000-0000-0000-0000000000d9';
const ORDER = '00000000-0000-0000-0000-000000001001';
const VENDOR = '00000000-0000-0000-0000-000000002002';
const INVITE = '00000000-0000-0000-0000-000000003003';

beforeAll(async () => {
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TYPE app_role AS ENUM ('customer','vendor','rider','admin','delivery_company','event_organizer');
CREATE TYPE vendor_staff_role AS ENUM ('owner','manager','cashier','viewer');

CREATE TABLE user_roles(user_id uuid, role app_role);
INSERT INTO user_roles VALUES ('${ADMIN}','admin'), ('${RIDER}','rider'), ('${CUSTOMER}','customer');
CREATE TABLE vendor_owners(user_id uuid, vendor_id uuid);
INSERT INTO vendor_owners VALUES ('${VENDOR_OWNER}','${VENDOR}');
CREATE TABLE rider_profiles(id uuid, user_id uuid);
INSERT INTO rider_profiles VALUES ('${RIDER_PROFILE}','${RIDER}');

CREATE FUNCTION has_role(_user_id uuid, _role app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE FUNCTION owns_vendor(_user_id uuid, _vendor_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM vendor_owners WHERE user_id=_user_id AND vendor_id=_vendor_id) $$;
CREATE FUNCTION owns_outlet(_user_id uuid, _outlet_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
CREATE FUNCTION get_vendor_staff_role(_user_id uuid, _vendor_id uuid) RETURNS vendor_staff_role
  LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT NULL::vendor_staff_role $$;
CREATE FUNCTION get_rider_profile_id(_user_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT id FROM rider_profiles WHERE user_id=_user_id LIMIT 1 $$;

CREATE TABLE orders(id uuid PRIMARY KEY, user_id uuid, vendor_id uuid, outlet_id uuid, rider_id uuid);
INSERT INTO orders VALUES ('${ORDER}','${CUSTOMER}','${VENDOR}', NULL, '${RIDER}');

CREATE TABLE dispute_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, image_url text, uploaded_by uuid);
INSERT INTO dispute_images(order_id, image_url, uploaded_by) VALUES ('${ORDER}','d.jpg','${CUSTOMER}');
ALTER TABLE dispute_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view dispute images" ON dispute_images FOR SELECT TO authenticated USING (true);

CREATE TABLE order_proof_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, vendor_id uuid, photo_url text, uploaded_by uuid);
INSERT INTO order_proof_photos(order_id, vendor_id, photo_url, uploaded_by) VALUES ('${ORDER}','${VENDOR}','p.jpg','${VENDOR_OWNER}');
ALTER TABLE order_proof_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view proof photos" ON order_proof_photos FOR SELECT TO authenticated USING (true);

CREATE TABLE rider_payout_settings(key text PRIMARY KEY, value text);
INSERT INTO rider_payout_settings VALUES ('charge_instant','100');
ALTER TABLE rider_payout_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read rider payout settings" ON rider_payout_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage rider payout settings" ON rider_payout_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE vendor_rider_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid, invite_code text,
  is_used boolean DEFAULT false, used_by uuid, expires_at timestamptz, outlet_id uuid);
INSERT INTO vendor_rider_invites(id, vendor_id, invite_code, expires_at) VALUES ('${INVITE}','${VENDOR}','GOODCODE', now() + interval '2 days');
INSERT INTO vendor_rider_invites(vendor_id, invite_code, expires_at) VALUES ('${VENDOR}','OLDCODE', now() - interval '1 day');
ALTER TABLE vendor_rider_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view invites by code" ON vendor_rider_invites FOR SELECT USING (true);
CREATE POLICY "Vendors can manage own invites" ON vendor_rider_invites FOR ALL USING (owns_vendor(auth.uid(), vendor_id));

CREATE TABLE wallet_repair_audit_2026_08(wallet_id uuid, drift numeric, captured_at timestamptz DEFAULT now());
INSERT INTO wallet_repair_audit_2026_08(wallet_id, drift) VALUES (gen_random_uuid(), 5);

GRANT SELECT, INSERT, UPDATE, DELETE ON dispute_images, order_proof_photos, rider_payout_settings,
  vendor_rider_invites, wallet_repair_audit_2026_08 TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
`);
  const sql = readFileSync('drizzle/migrations/0033_tighten_evidence_invite_payout_rls.sql', 'utf8');
  await db.exec(sql.replace(/public\./g, '').replace(/::app_role/g, ''));
}, 60000);

afterAll(() => db.close());

async function asUser(uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec('RESET ROLE');
  await db.exec(`SET test.uid = '${uid ?? ''}'`);
  await db.exec(`SET ROLE ${uid === null ? 'anon' : 'authenticated'}`);
  try {
    const r = await db.query(sql, params);
    return { rows: r.rows as Record<string, unknown>[], error: null as string | null };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  } finally {
    await db.exec('RESET ROLE');
  }
}

it('dispute images: uploader, order customer, vendor owner, rider and admin see them', async () => {
  for (const uid of [CUSTOMER, VENDOR_OWNER, RIDER, ADMIN]) {
    const r = await asUser(uid, 'SELECT id FROM dispute_images');
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(1);
  }
});

it('dispute images: unrelated signed-in user sees nothing and anon is denied', async () => {
  expect((await asUser(OTHER, 'SELECT id FROM dispute_images')).rows).toHaveLength(0);
  expect((await asUser(null, 'SELECT id FROM dispute_images')).error).toMatch(/permission denied/i);
});

it('proof photos: participants and admin see them; unrelated user and anon do not', async () => {
  for (const uid of [CUSTOMER, VENDOR_OWNER, RIDER, ADMIN]) {
    expect((await asUser(uid, 'SELECT id FROM order_proof_photos')).rows).toHaveLength(1);
  }
  expect((await asUser(OTHER, 'SELECT id FROM order_proof_photos')).rows).toHaveLength(0);
  expect((await asUser(null, 'SELECT id FROM order_proof_photos')).error).toMatch(/permission denied/i);
});

it('proof photos for an order with no relationship stay hidden', async () => {
  await db.exec(`INSERT INTO orders VALUES (gen_random_uuid(), '${OTHER}', gen_random_uuid(), NULL, NULL)`);
  const r = await asUser(CUSTOMER, "SELECT id FROM order_proof_photos WHERE vendor_id <> $1", [VENDOR]);
  expect(r.rows).toHaveLength(0);
});

it('rider payout settings: admin only, not other signed-in users or anon', async () => {
  expect((await asUser(ADMIN, 'SELECT key FROM rider_payout_settings')).rows).toHaveLength(1);
  expect((await asUser(RIDER, 'SELECT key FROM rider_payout_settings')).rows).toHaveLength(0);
  expect((await asUser(OTHER, 'SELECT key FROM rider_payout_settings')).rows).toHaveLength(0);
  expect((await asUser(null, 'SELECT key FROM rider_payout_settings')).error).toMatch(/permission denied/i);
});

it('wallet repair audit: row level security on, admin read only', async () => {
  const rls = await db.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE relname='wallet_repair_audit_2026_08'",
  );
  expect(rls.rows[0].relrowsecurity).toBe(true);
  expect((await asUser(ADMIN, 'SELECT wallet_id FROM wallet_repair_audit_2026_08')).rows).toHaveLength(1);
  expect((await asUser(OTHER, 'SELECT wallet_id FROM wallet_repair_audit_2026_08')).rows).toHaveLength(0);
  expect((await asUser(null, 'SELECT wallet_id FROM wallet_repair_audit_2026_08')).error).toMatch(/permission denied/i);
  expect((await asUser(ADMIN, "UPDATE wallet_repair_audit_2026_08 SET drift = 9")).error).toMatch(/permission denied/i);
});

it('rider invites: no longer listable by unrelated users or anon; vendor owner keeps access', async () => {
  expect((await asUser(VENDOR_OWNER, 'SELECT id FROM vendor_rider_invites')).rows).toHaveLength(2);
  expect((await asUser(OTHER, 'SELECT id FROM vendor_rider_invites')).rows).toHaveLength(0);
  expect((await asUser(RIDER, 'SELECT id FROM vendor_rider_invites')).rows).toHaveLength(0);
  expect((await asUser(null, 'SELECT id FROM vendor_rider_invites')).error).toMatch(/permission denied/i);
});

it('invite lookup by exact code works for a signed-in rider only', async () => {
  const ok = await asUser(RIDER, "SELECT id, vendor_id FROM lookup_vendor_rider_invite('GOODCODE')");
  expect(ok.error).toBeNull();
  expect(ok.rows[0]).toMatchObject({ id: INVITE, vendor_id: VENDOR });

  expect((await asUser(RIDER, "SELECT id FROM lookup_vendor_rider_invite('NOPE')")).rows).toHaveLength(0);
  expect((await asUser(RIDER, "SELECT id FROM lookup_vendor_rider_invite('')")).rows).toHaveLength(0);
  // signed out: no execute privilege at all
  expect((await asUser(null, "SELECT id FROM lookup_vendor_rider_invite('GOODCODE')")).error)
    .toMatch(/permission denied/i);
});

it('rider can claim only a valid invite, only as themselves', async () => {
  // wrong owner: cannot point the invite at another rider profile
  const spoof = await asUser(RIDER, `UPDATE vendor_rider_invites SET is_used=true, used_by='${ORDER}' WHERE id='${INVITE}'`);
  expect(spoof.error).toMatch(/row-level security|violates/i);

  // expired invite cannot be claimed
  const expired = await asUser(
    RIDER,
    `UPDATE vendor_rider_invites SET is_used=true, used_by='${RIDER_PROFILE}' WHERE invite_code='OLDCODE' RETURNING id`,
  );
  expect(expired.rows).toHaveLength(0);

  // a non-rider signed-in user cannot claim it
  const outsider = await asUser(
    OTHER,
    `UPDATE vendor_rider_invites SET is_used=true, used_by='${RIDER_PROFILE}' WHERE id='${INVITE}' RETURNING id`,
  );
  expect(outsider.rows).toHaveLength(0);

  // the invited rider succeeds
  const claim = await asUser(
    RIDER,
    `UPDATE vendor_rider_invites SET is_used=true, used_by='${RIDER_PROFILE}' WHERE id='${INVITE}' RETURNING id`,
  );
  expect(claim.error).toBeNull();
  expect(claim.rows).toHaveLength(1);

  // and can then see the invite they redeemed
  expect((await asUser(RIDER, 'SELECT id FROM vendor_rider_invites')).rows).toHaveLength(1);
});
