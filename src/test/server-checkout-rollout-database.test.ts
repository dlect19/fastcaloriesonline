// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

const db = new PGlite();
const allowlisted = '00000000-0000-0000-0000-0000000000a1';
const other = '00000000-0000-0000-0000-0000000000b2';

async function asUser(uid: string, admin = false) {
  await db.exec(`SET test.uid = '${uid}'; SET test.admin = '${admin}';`);
}

async function rollout(opts: { version?: string | null; method?: string; channel?: string } = {}) {
  const r = await db.query<{ r: any }>('SELECT get_server_checkout_rollout($1,$2,$3) r', [
    opts.version ?? '1.2.0',
    opts.method ?? 'wallet',
    opts.channel ?? 'online',
  ]);
  return r.rows[0].r;
}

async function setSettings(patch: Record<string, string>) {
  for (const [k, v] of Object.entries(patch)) {
    await db.query(
      `INSERT INTO platform_settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [k, v],
    );
  }
}

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true),'')::uuid $$;
CREATE FUNCTION public.has_role(p_user uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('test.admin', true),'false') = 'true' $$;
CREATE TABLE public.platform_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text UNIQUE NOT NULL, value text NOT NULL, description text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.platform_settings_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), setting_key text NOT NULL, old_value text, new_value text NOT NULL, changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now(), action text NOT NULL);
`);
  await db.exec(readFileSync('drizzle/migrations/0027_server_checkout_canary_rollout.sql', 'utf8'));
}, 30000);

afterAll(() => db.close());

beforeEach(async () => {
  await setSettings({
    enforce_server_checkout: 'false',
    server_checkout_canary_enabled: 'false',
    server_checkout_canary_percent: '0',
    server_checkout_canary_user_ids: JSON.stringify([allowlisted]),
    server_checkout_min_client_version: '',
    server_checkout_wallet_enabled: 'true',
    server_checkout_external_payment_enabled: 'false',
  });
  await asUser(allowlisted);
});

it('nobody is eligible while the canary is disabled, allowlist included', async () => {
  const d = await rollout();
  expect(d).toMatchObject({ eligible: false, route: 'compatibility', reason: 'CANARY_DISABLED' });
});

it('allowlisted wallet user is eligible when canary is enabled at 0 percent', async () => {
  await setSettings({ server_checkout_canary_enabled: 'true' });
  expect(await rollout()).toMatchObject({ eligible: true, route: 'server', reason: 'ALLOWLISTED' });
});

it('non-allowlisted user stays on the compatibility route at 0 percent', async () => {
  await setSettings({ server_checkout_canary_enabled: 'true' });
  await asUser(other);
  expect(await rollout()).toMatchObject({ eligible: false, route: 'compatibility', reason: 'COHORT_EXCLUDED' });
});

it('cohort is a stable deterministic hash, not random per request', async () => {
  await asUser(other);
  const a = await rollout();
  const b = await rollout();
  const c = await rollout({ method: 'wallet' });
  expect(a.cohort).toBe(b.cohort);
  expect(a.cohort).toBe(c.cohort);
  expect(a.cohort).toBeGreaterThanOrEqual(0);
  expect(a.cohort).toBeLessThan(100);
});

it.each([5, 20, 50, 100])('percent %i includes exactly the cohorts below it', async (pct) => {
  await setSettings({ server_checkout_canary_enabled: 'true', server_checkout_canary_percent: String(pct) });
  await asUser(other);
  const d = await rollout();
  expect(d.eligible).toBe(d.cohort < pct);
  if (pct === 100) expect(d.eligible).toBe(true);
});

it('minimum client version compares numerically, not lexically', async () => {
  await setSettings({ server_checkout_canary_enabled: 'true', server_checkout_min_client_version: '1.9.0' });
  expect(await rollout({ version: '1.10.0' })).toMatchObject({ eligible: true });
  expect(await rollout({ version: '1.2.0' })).toMatchObject({ eligible: false, reason: 'CLIENT_VERSION_TOO_OLD' });
  expect(await rollout({ version: null })).toMatchObject({ eligible: false, reason: 'CLIENT_VERSION_TOO_OLD' });
  const cmp = await db.query<{ a: boolean; b: boolean; c: boolean }>(
    `SELECT server_checkout_version_at_least('2.0.0','1.9.9') a, server_checkout_version_at_least('1.9','1.9.0') b, server_checkout_version_at_least('1.0.0','') c`,
  );
  expect(cmp.rows[0]).toEqual({ a: true, b: true, c: true });
});

it('an outdated client is blocked rather than trusted once master enforcement is on', async () => {
  await setSettings({ enforce_server_checkout: 'true', server_checkout_min_client_version: '2.0.0' });
  expect(await rollout({ version: '1.0.0' })).toMatchObject({ route: 'blocked', eligible: false });
});

it.each(['card', 'bank', 'transfer', 'paystack'])('external payment %s stays ineligible', async (method) => {
  await setSettings({ server_checkout_canary_enabled: 'true', server_checkout_canary_percent: '100' });
  expect(await rollout({ method })).toMatchObject({ eligible: false, reason: 'EXTERNAL_PAYMENT_DISABLED' });
});

it('wallet switch off makes wallet checkout ineligible', async () => {
  await setSettings({ server_checkout_canary_enabled: 'true', server_checkout_wallet_enabled: 'false' });
  expect(await rollout()).toMatchObject({ eligible: false, reason: 'WALLET_CHECKOUT_DISABLED' });
});

it.each(['pos', 'assisted', 'whatsapp'])('channel %s keeps its existing route', async (channel) => {
  await setSettings({ server_checkout_canary_enabled: 'true', server_checkout_canary_percent: '100' });
  expect(await rollout({ channel })).toMatchObject({ eligible: false, route: 'existing', reason: 'CHANNEL_UNSUPPORTED' });
});

it('unauthenticated callers get no server route and no logged decision', async () => {
  await db.exec(`SET test.uid = ''`);
  expect(await rollout()).toMatchObject({ eligible: false, reason: 'NOT_AUTHENTICATED' });
  await db.query('SELECT log_server_checkout_decision($1,$2,$3)', ['server', 'X', true]);
  const rows = await db.query('SELECT * FROM server_checkout_rollout_decisions');
  expect(rows.rows).toHaveLength(0);
});

it('rejects setting changes from non-admins and records audited admin changes', async () => {
  await asUser(other, false);
  await expect(
    db.query('SELECT admin_update_server_checkout_rollout($1::jsonb)', [JSON.stringify({ server_checkout_canary_percent: '50' })]),
  ).rejects.toThrow(/NOT_AUTHORIZED/);
  await asUser(other, true);
  await db.query('SELECT admin_update_server_checkout_rollout($1::jsonb)', [
    JSON.stringify({ server_checkout_canary_enabled: 'true', server_checkout_canary_percent: '50' }),
  ]);
  const audit = await db.query<{ setting_key: string; new_value: string; changed_by: string }>(
    "SELECT setting_key,new_value,changed_by FROM platform_settings_audit WHERE setting_key='server_checkout_canary_percent' ORDER BY changed_at DESC LIMIT 1",
  );
  expect(audit.rows[0]).toMatchObject({ new_value: '50', changed_by: other });
});

it('refuses invalid rollout values and the emergency master flag', async () => {
  await asUser(other, true);
  for (const bad of [
    { server_checkout_canary_percent: '120' },
    { server_checkout_canary_enabled: 'yes' },
    { server_checkout_canary_user_ids: '{"a":1}' },
    { server_checkout_min_client_version: 'v-one' },
    { enforce_server_checkout: 'true' },
  ]) {
    await expect(
      db.query('SELECT admin_update_server_checkout_rollout($1::jsonb)', [JSON.stringify(bad)]),
    ).rejects.toThrow();
  }
});

it('emergency disable sets enabled false and percent zero atomically', async () => {
  await asUser(other, true);
  await setSettings({ server_checkout_canary_enabled: 'true', server_checkout_canary_percent: '75' });
  await db.query('SELECT admin_disable_server_checkout_canary()');
  const rows = await db.query<{ key: string; value: string }>(
    "SELECT key,value FROM platform_settings WHERE key IN ('server_checkout_canary_enabled','server_checkout_canary_percent') ORDER BY key",
  );
  expect(rows.rows).toEqual([
    { key: 'server_checkout_canary_enabled', value: 'false' },
    { key: 'server_checkout_canary_percent', value: '0' },
  ]);
});

it('records the route actually used, including a failure code', async () => {
  await db.exec('DELETE FROM server_checkout_rollout_decisions');
  await asUser(allowlisted);
  await db.query('SELECT log_server_checkout_decision($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    'server', 'ALLOWLISTED', true, 7, 'wallet', 'online', '1.2.0', 'attempt-1', 'WALLET_CHECKOUT_REJECTED',
  ]);
  const rows = await db.query<{ route: string; failure_code: string; user_id: string }>(
    'SELECT route,failure_code,user_id FROM server_checkout_rollout_decisions',
  );
  expect(rows.rows[0]).toMatchObject({ route: 'server', failure_code: 'WALLET_CHECKOUT_REJECTED', user_id: allowlisted });
});
