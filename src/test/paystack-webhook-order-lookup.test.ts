// @vitest-environment node
// Regression tests for the paystack-webhook order lookup fix:
// the orders table has no currency column, so selecting it made Postgres
// return 42703 which was misreported as "Order not found" and genuine
// signed payments (e.g. FC-260918-4895) never confirmed.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, it, expect } from 'vitest';

const src = readFileSync('supabase/functions/paystack-webhook/index.ts', 'utf8');

it('the order lookup never selects the nonexistent orders.currency column', () => {
  const select = src.match(/from\("orders"\)\s*\.select\("([^"]+)"\)/);
  expect(select).toBeTruthy();
  expect(select![1]).not.toContain('currency');
  expect(select![1]).toContain('payment_status');
  expect(select![1]).toContain('environment');
});

it('treats NGN as the trusted server currency and still rejects non-NGN charges', () => {
  expect(src).toContain('paidCurrency');
  expect(src).toMatch(/paidCurrency !== "NGN"/);
  expect(src).toContain('payment_currency_mismatch');
});

it('keeps amount, customer, environment and idempotency protections', () => {
  expect(src).toContain('payment_amount_mismatch');
  expect(src).toContain('payment_customer_mismatch');
  expect(src).toContain('Environment mismatch');
  expect(src).toContain('already paid');
  expect(src).toMatch(/\.neq\("payment_status", "paid"\)/);
});

it('keeps signature verification mandatory before any order handling', () => {
  const sigIdx = src.indexOf('await verifySignature(payload, signature, paystackSecretKey)');
  const lookupIdx = src.indexOf('Order lookup error');
  expect(sigIdx).toBeGreaterThan(-1);
  expect(sigIdx).toBeLessThan(lookupIdx);
  expect(src).toContain('Invalid webhook signature');
});

it('classifies a database lookup error separately from a missing order', () => {
  expect(src).toContain('Order lookup error');
  expect(src).toContain('payment_order_lookup_error');
  expect(src).toContain('maybeSingle()');
  const errIdx = src.indexOf('Order lookup error');
  const missingIdx = src.indexOf('Order not found:', errIdx);
  expect(missingIdx).toBeGreaterThan(errIdx);
  // SQL details must never leak into a customer-facing response
  expect(src).not.toMatch(/orderError\.message/);
});

// --- behaviour against a real database with NO currency column ---
const db = new PGlite();
const uid = '00000000-0000-0000-0000-0000000000aa';

beforeAll(async () => {
  await db.exec(`
CREATE TABLE orders(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, order_number text,
  user_id uuid, total numeric, subtotal numeric, delivery_fee numeric,
  rider_id uuid, vendor_id uuid, outlet_id uuid, environment text,
  status text DEFAULT 'pending', payment_status text DEFAULT 'pending',
  payment_reference text, duplicate_of_order_id uuid);
`);
}, 30000);

afterAll(() => db.close());

// The exact column list the webhook now selects, run against an orders table
// that has no currency column — a matching order must load with no error.
const LOOKUP_COLUMNS =
  'id, order_number, user_id, total, subtotal, delivery_fee, rider_id, vendor_id, outlet_id, environment, status, payment_status, payment_reference, duplicate_of_order_id';

it('loads an existing order when the table has no currency column', async () => {
  await db.query(
    `INSERT INTO orders(order_number,user_id,total,environment) VALUES('FC-TEST-4895',$1,1100,'production')`,
    [uid],
  );
  const r = await db.query(`SELECT ${LOOKUP_COLUMNS} FROM orders WHERE order_number='FC-TEST-4895'`);
  expect(r.rows).toHaveLength(1);
  expect((r.rows[0] as any).total).toBe('1100');
});

it('a query selecting the removed column fails with 42703 and must never be called a missing order', async () => {
  try {
    await db.query(`SELECT ${LOOKUP_COLUMNS}, currency FROM orders LIMIT 1`);
    expect.unreachable();
  } catch (e: any) {
    expect(e.message).toMatch(/currency/);
    // In the webhook this path logs "Order lookup error", not "Order not found"
    expect(src.indexOf('Order lookup error')).toBeLessThan(src.indexOf('Order not found:', src.indexOf('Order lookup error')));
  }
});

it('a genuinely absent order returns zero rows (missing-order path)', async () => {
  const r = await db.query(`SELECT ${LOOKUP_COLUMNS} FROM orders WHERE order_number='FC-DOES-NOT-EXIST'`);
  expect(r.rows).toHaveLength(0);
});
