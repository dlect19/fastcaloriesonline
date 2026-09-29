// @vitest-environment node
// Rider-search recovery (migration 0036) on a throwaway in-memory database.
// No production row, push, or rider search is touched.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveOfferTtlSeconds, MIN_OFFER_TTL_SECONDS } from '../../supabase/functions/_shared/dispatchTtl.ts';
import { buildDispatchPushRequest, isStaleFcmTokenResponse, RIDER_OFFERS_URL } from '../../supabase/functions/_shared/dispatchPush.ts';
import { riderNotificationStatus } from '@/lib/riderNotificationStatus';

const db = new PGlite();
const ORDER = '00000000-0000-0000-0000-0000000000b1';
const ORDER2 = '00000000-0000-0000-0000-0000000000b2';

beforeAll(async () => {
  await db.exec(`
CREATE TABLE orders(
  id uuid PRIMARY KEY, order_number text, rider_id uuid, status text,
  delivery_type text DEFAULT 'delivery', duplicate_of_order_id uuid,
  payment_status text DEFAULT 'paid', channel text DEFAULT 'online', payment_method text DEFAULT 'wallet');
CREATE TABLE dispatch_requests(
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, order_id uuid NOT NULL,
  status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), expires_at timestamptz,
  retry_count int DEFAULT 0, max_retries int DEFAULT 3, search_radius_km numeric DEFAULT 5,
  retry_round int DEFAULT 0, superseded_by_request_id uuid,
  CONSTRAINT dispatch_requests_status_check CHECK (status = ANY (ARRAY['pending','accepted','expired','cancelled','no_riders'])));
CREATE UNIQUE INDEX dispatch_requests_one_live_per_order ON dispatch_requests(order_id) WHERE status IN ('pending','accepted');
CREATE TABLE dispatch_offers(
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, dispatch_request_id uuid, status text DEFAULT 'pending',
  expires_at timestamptz, responded_at timestamptz,
  CONSTRAINT dispatch_offers_status_check CHECK (status = ANY (ARRAY['pending','accepted','declined','expired','superseded'])));
`);
  const sql = readFileSync('drizzle/migrations/0036_dispatch_sweep_allowed_status_and_prepare_round.sql', 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(REVOKE|GRANT)\b/.test(l))
    .join('\n')
    .replace(/public\./g, '')
    .replace(/SET search_path TO 'public'/g, '');
  await db.exec(sql);
}, 30000);

afterAll(() => db.close());

beforeEach(async () => {
  await db.exec('DELETE FROM dispatch_offers; DELETE FROM dispatch_requests; DELETE FROM orders;');
  await db.query("INSERT INTO orders(id, order_number, status) VALUES ($1,'FC-A','searching_for_rider'),($2,'FC-B','searching_for_rider')", [ORDER, ORDER2]);
});

async function addRequest(order: string, status: string, expiresSql: string, retry = 0) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO dispatch_requests(order_id, status, expires_at, retry_count) VALUES ($1,$2, ${expiresSql}, $3) RETURNING id`,
    [order, status, retry],
  );
  return r.rows[0].id;
}
async function addOffer(req: string, status: string, expiresSql: string) {
  await db.query(`INSERT INTO dispatch_offers(dispatch_request_id, status, expires_at) VALUES ($1,$2, ${expiresSql})`, [req, status]);
}
const statusOf = async (id: string) =>
  (await db.query<{ status: string }>('SELECT status FROM dispatch_requests WHERE id=$1', [id])).rows[0].status;

describe('dispatch_sweep_expiry', () => {
  it('uses only allowed statuses: exhausted -> no_riders, never failed', async () => {
    const stuck = await addRequest(ORDER, 'pending', "now() - interval '5 min'", 3);
    await addOffer(stuck, 'superseded', "now() - interval '5 min'");
    const res = (await db.query<{ r: any }>('SELECT dispatch_sweep_expiry(25) r')).rows[0].r;
    expect(await statusOf(stuck)).toBe('no_riders');
    expect(res.retry_candidates).toEqual([]);
    const again = (await db.query<{ r: any }>('SELECT dispatch_sweep_expiry(25) r')).rows[0].r;
    expect(again.expired_requests).toBe(0); // exhausted rows are final
  });

  it('non-exhausted expiry becomes a retry candidate', async () => {
    const r = await addRequest(ORDER, 'pending', "now() - interval '1 min'", 1);
    await addOffer(r, 'pending', "now() - interval '1 min'");
    const res = (await db.query<{ r: any }>('SELECT dispatch_sweep_expiry(25) r')).rows[0].r;
    expect(await statusOf(r)).toBe('expired');
    expect(res.expired_offers).toBe(1);
    expect(res.retry_candidates[0].order_id).toBe(ORDER);
  });

  it('one bad row does not roll back unrelated rows', async () => {
    const bad = await addRequest(ORDER, 'pending', "now() - interval '1 min'");
    const good = await addRequest(ORDER2, 'pending', "now() - interval '1 min'");
    await db.exec(`CREATE OR REPLACE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = '${bad}' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t_boom BEFORE UPDATE ON dispatch_requests FOR EACH ROW EXECUTE FUNCTION boom();`);
    try {
      const res = (await db.query<{ r: any }>('SELECT dispatch_sweep_expiry(25) r')).rows[0].r;
      expect(await statusOf(good)).toBe('expired');
      expect(await statusOf(bad)).toBe('pending');
      expect(res.errors).toHaveLength(1);
    } finally {
      await db.exec('DROP TRIGGER t_boom ON dispatch_requests');
    }
  });
});

describe('dispatch_prepare_round', () => {
  const prep = async (o: string) => (await db.query<{ r: any }>('SELECT dispatch_prepare_round($1) r', [o])).rows[0].r;

  it('returns a genuinely live round without touching its offers', async () => {
    const r = await addRequest(ORDER, 'pending', "now() + interval '60 sec'");
    await addOffer(r, 'pending', "now() + interval '60 sec'");
    const res = await prep(ORDER);
    expect(res.action).toBe('live');
    expect(res.dispatch_request_id).toBe(r);
    const offers = await db.query<{ status: string }>('SELECT status FROM dispatch_offers');
    expect(offers.rows.every((o) => o.status === 'pending')).toBe(true);
  });

  it('expires a stale live round and its offers, then allows a fresh round', async () => {
    const r = await addRequest(ORDER, 'pending', "now() - interval '10 sec'");
    await addOffer(r, 'pending', "now() - interval '10 sec'");
    const res = await prep(ORDER);
    expect(res.action).toBe('cleared');
    expect(res.retired_request_ids).toEqual([r]);
    expect(await statusOf(r)).toBe('expired');
    expect((await db.query<{ status: string }>('SELECT status FROM dispatch_offers')).rows[0].status).toBe('expired');
    await addRequest(ORDER, 'pending', "now() + interval '90 sec'"); // one-live-round invariant holds
  });

  it('never leaves a pending round whose offers are all superseded (the FC-260929-9614 shape)', async () => {
    const r = await addRequest(ORDER, 'pending', "now() + interval '30 sec'");
    await addOffer(r, 'superseded', "now() + interval '30 sec'");
    await addOffer(r, 'expired', "now() - interval '1 sec'");
    const res = await prep(ORDER);
    expect(res.action).toBe('cleared');
    const live = await db.query('SELECT 1 FROM dispatch_requests WHERE order_id=$1 AND status=$2', [ORDER, 'pending']);
    expect(live.rows).toHaveLength(0);
  });

  it('reports accepted rounds and leaves them alone', async () => {
    const r = await addRequest(ORDER, 'accepted', "now() - interval '1 min'");
    expect((await prep(ORDER)).action).toBe('accepted');
    expect(await statusOf(r)).toBe('accepted');
  });
});

describe('offer TTL', () => {
  it('is at least 90 seconds everywhere', () => {
    expect(MIN_OFFER_TTL_SECONDS).toBe(90);
    expect(resolveOfferTtlSeconds('60')).toBe(90);
    expect(resolveOfferTtlSeconds(undefined)).toBe(90);
    expect(resolveOfferTtlSeconds('120')).toBe(120);
    for (const f of ['dispatch-order', 'decline-dispatch']) {
      const src = readFileSync(`supabase/functions/${f}/index.ts`, 'utf8');
      expect(src).not.toMatch(/dispatch_acceptance_timeout_seconds \|\| '60'/);
      expect(src).toContain('resolveOfferTtlSeconds');
    }
  });

  it('dispatch-order no longer supersedes before checking for a live round', () => {
    const src = readFileSync('supabase/functions/dispatch-order/index.ts', 'utf8');
    expect(src).toContain("rpc('dispatch_prepare_round'");
    expect(src).not.toMatch(/update\(\{ status: 'superseded' \}\)/);
  });
});

describe('push', () => {
  it('treats only proven-dead FCM tokens as stale', () => {
    const unreg = JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
    const badTok = JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } });
    const badPayload = JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' } });
    expect(isStaleFcmTokenResponse(404, unreg)).toBe(true);
    expect(isStaleFcmTokenResponse(400, badTok)).toBe(true);
    expect(isStaleFcmTokenResponse(400, badPayload)).toBe(false);
    expect(isStaleFcmTokenResponse(500, '')).toBe(false);
    expect(isStaleFcmTokenResponse(429, '{}')).toBe(false);
  });

  it('sender deletes only exact subscriptions and reports riders without one', () => {
    const src = readFileSync('supabase/functions/send-push-notification/index.ts', 'utf8');
    expect(src).toContain(".in('id', staleSubscriptionIds)");
    expect(src).not.toContain(".in('endpoint'");
    expect(src).toContain('no_subscription_count');
    expect(src).not.toMatch(/console\.(log|error)\([^)]*fcm_token/);
  });

  it('dispatch payload carries type, round and per-rider offer id with rider navigation', () => {
    const req = buildDispatchPushRequest({
      riderUserIds: ['u1', 'u2'], dispatchRequestId: 'dr1',
      offers: [{ id: 'o1', rider_user_id: 'u1' }, { id: 'o2', rider_user_id: 'u2' }],
      pickupName: 'Top Kitchen', riderPay: 550,
    });
    expect(req.data.type).toBe('DISPATCH_OFFER');
    expect(req.data.dispatch_request_id).toBe('dr1');
    expect(req.per_user_data.u1.offer_id).toBe('o1');
    expect(req.per_user_data.u2.offer_id).toBe('o2');
    expect(req.url).toBe(RIDER_OFFERS_URL);
    expect(req.title).toBeTruthy();
  });

  it('service worker still shows notifications and only keyed dispatch events ask for sound', () => {
    const sw = readFileSync('public/sw-push.js', 'utf8');
    expect(sw).toContain('showNotification');
    expect(sw).toContain("'DISPATCH_OFFER'");
    expect(sw).toMatch(/offer_id/);
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('isStaffPortalPath(window.location.pathname)'); // customer routes stay silent
  });
});

describe('rider notification warning', () => {
  it('shows only when this device cannot get alerts', () => {
    expect(riderNotificationStatus({ permission: 'granted', hasServerSubscription: true })).toBe('ok');
    expect(riderNotificationStatus({ permission: 'granted', hasServerSubscription: false })).toBe('off');
    expect(riderNotificationStatus({ permission: 'default', hasServerSubscription: true })).toBe('off');
    expect(riderNotificationStatus({ permission: 'denied', hasServerSubscription: true })).toBe('blocked');
    expect(riderNotificationStatus({ permission: 'granted', hasServerSubscription: null })).toBe('checking');
  });

  it('never auto-prompts for permission', () => {
    const src = readFileSync('src/components/rider/RiderNotificationWarning.tsx', 'utf8');
    const effectBody = src.split('useEffect(')[1].split('}, [')[0];
    expect(effectBody).not.toMatch(/requestPermission|subscribe\(/);
  });
});
