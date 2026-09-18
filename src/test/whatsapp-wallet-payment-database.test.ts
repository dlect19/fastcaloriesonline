// @vitest-environment node
// Proves the WhatsApp wallet payment is atomic, idempotent and balance-safe
// against the real whatsapp_create_order_atomic function, on a throwaway
// in-memory database. No production row is touched.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

const db = new PGlite();
const uid = '00000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  await db.exec(`
CREATE TABLE orders(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid, vendor_id uuid, outlet_id uuid,
  order_number text, total numeric, status text DEFAULT 'pending', payment_status text DEFAULT 'pending',
  channel text DEFAULT 'whatsapp', environment text);
CREATE TABLE order_items(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, order_id uuid, product_id uuid,
  product_name text, quantity integer, unit_price numeric, total_price numeric, calories numeric,
  special_instructions text, portion_label text, portion_size numeric, portion_unit text);
CREATE TABLE order_item_addons(order_item_id uuid, addon_group_name text, addon_item_name text,
  additional_price numeric, calories numeric);
CREATE TABLE wallets(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid, wallet_type text,
  balance numeric DEFAULT 0, test_balance numeric DEFAULT 0, is_disabled boolean DEFAULT false);
CREATE TABLE wallet_transactions(wallet_id uuid, amount numeric, category text, reference text, order_id uuid);
CREATE TABLE whatsapp_checkouts(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, idempotency_key text UNIQUE,
  order_id uuid, status text, updated_at timestamptz DEFAULT now());
CREATE FUNCTION post_wallet_entry(p_wallet_id uuid, p_wallet_type text, p_transaction_type text,
  p_category text, p_amount numeric, p_reference text, p_environment text DEFAULT 'production',
  p_order_id uuid DEFAULT NULL, p_notes text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  UPDATE wallets SET balance = balance - p_amount WHERE id = p_wallet_id;
  INSERT INTO wallet_transactions VALUES(p_wallet_id, p_amount, p_category, p_reference, p_order_id);
END $$;
`);
  const sql = readFileSync('drizzle/migrations/0014_whatsapp_modifiers_and_cancellation.sql', 'utf8');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.whatsapp_create_order_atomic');
  await db.exec(sql.slice(start, sql.indexOf('-- 2)', start)));
}, 30000);

afterAll(() => db.close());

beforeEach(async () => {
  await db.exec(`DELETE FROM orders; DELETE FROM order_items; DELETE FROM wallet_transactions;
    DELETE FROM whatsapp_checkouts; DELETE FROM wallets;`);
});

async function seed(balance: number, key = 'idem-1') {
  await db.query('INSERT INTO wallets(user_id,wallet_type,balance) VALUES($1,$2,$3)', [uid, 'customer', balance]);
  const r = await db.query<{ id: string }>(
    'INSERT INTO whatsapp_checkouts(idempotency_key,status) VALUES($1,$2) RETURNING id', [key, 'pending'],
  );
  return r.rows[0].id;
}

function pay(checkoutId: string, total: number, wallet = true) {
  const order = { user_id: uid, order_number: 'FC-T-' + total, total, channel: 'whatsapp' };
  const items = [{ product_id: uid, product_name: 'Rice', quantity: 1, unit_price: total, total_price: total }];
  return db.query<{ r: any }>(
    'SELECT whatsapp_create_order_atomic($1::uuid,$2::jsonb,$3::jsonb,$4,$5) r',
    [checkoutId, JSON.stringify(order), JSON.stringify(items), wallet, 'production'],
  );
}

async function balance() {
  return Number((await db.query<{ b: string }>('SELECT balance b FROM wallets')).rows[0].b);
}

it('pays from the wallet when the balance covers the total', async () => {
  const c = await seed(5000);
  const r = await pay(c, 5000);
  expect(r.rows[0].r.order_id).toBeTruthy();
  expect(await balance()).toBe(0);
  expect((await db.query('SELECT * FROM wallet_transactions')).rows).toHaveLength(1);
});

it('refuses and creates nothing when the balance is short, even if the chat said otherwise', async () => {
  const c = await seed(1200);
  await expect(pay(c, 5000)).rejects.toThrow(/insufficient wallet balance/i);
  expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM order_items')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM wallet_transactions')).rows).toHaveLength(0);
  expect(await balance()).toBe(1200);
});

it('rechecks the balance inside the transaction when the displayed one is stale', async () => {
  const c = await seed(5000);
  // Balance dropped after the summary was shown to the customer.
  await db.exec('UPDATE wallets SET balance = 100');
  await expect(pay(c, 5000)).rejects.toThrow(/insufficient wallet balance/i);
  expect(await balance()).toBe(100);
});

it('concurrent attempts on one checkout debit once and create one order', async () => {
  const c = await seed(5000);
  const [a, b] = await Promise.all([pay(c, 5000), pay(c, 5000)]);
  const ids = [a.rows[0].r.order_id, b.rows[0].r.order_id];
  expect(ids[0]).toBe(ids[1]);
  expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(1);
  expect((await db.query('SELECT * FROM wallet_transactions')).rows).toHaveLength(1);
  expect(await balance()).toBe(0);
});

it('a replayed message returns the same order without a second debit', async () => {
  const c = await seed(9000);
  const first = await pay(c, 4000);
  const replay = await pay(c, 4000);
  expect(replay.rows[0].r.already_created).toBe(true);
  expect(replay.rows[0].r.order_id).toBe(first.rows[0].r.order_id);
  expect((await db.query('SELECT * FROM wallet_transactions')).rows).toHaveLength(1);
  expect(await balance()).toBe(5000);
});

it('a Paystack order is created unpaid with no wallet debit', async () => {
  const c = await seed(0);
  const r = await pay(c, 5000, false);
  expect(r.rows[0].r.order_id).toBeTruthy();
  expect((await db.query("SELECT payment_status FROM orders")).rows[0]).toEqual({ payment_status: 'pending' });
  expect((await db.query('SELECT * FROM wallet_transactions')).rows).toHaveLength(0);
  expect((await db.query("SELECT status FROM whatsapp_checkouts")).rows[0]).toEqual({ status: 'awaiting_payment' });
});
