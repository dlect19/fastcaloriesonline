// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// In-memory PostgreSQL only: no URL, production client, auth, or network services.
const db = new PGlite();
const product = '00000000-0000-0000-0000-000000000001';
const vendor = '00000000-0000-0000-0000-000000000002';
const outlet = '00000000-0000-0000-0000-000000000003';
const addon = '00000000-0000-0000-0000-000000000004';
const group = '00000000-0000-0000-0000-000000000005';

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE products (id uuid, vendor_id uuid, name text,
      min_order_qty numeric, max_order_qty numeric, allows_fractional_qty boolean,
      qty_step numeric, allows_sachet boolean, sachet_price numeric, price numeric,
      discount_price numeric, sachets_per_pack numeric);
    CREATE TABLE combos (id uuid, vendor_id uuid, is_available boolean, combo_price numeric);
    CREATE TABLE product_portions (id uuid, product_id uuid, price numeric, is_available boolean);
    CREATE TABLE addon_groups (id uuid, name text);
    CREATE TABLE addon_items (id uuid, addon_group_id uuid, name text, is_available boolean, additional_price numeric);
    CREATE TABLE product_addon_groups (product_id uuid, addon_group_id uuid);
    CREATE FUNCTION product_effective_available(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
    INSERT INTO products VALUES ('${product}','${vendor}','Fixture meal',1,10,false,1,false,NULL,1000,NULL,NULL);
    INSERT INTO addon_groups VALUES ('${group}','Extras');
    INSERT INTO addon_items VALUES ('${addon}','${group}','Egg',true,200);
    INSERT INTO product_addon_groups VALUES ('${product}','${group}');
  `);
  // Execute the actual pricing migration, not a TypeScript mirror.
  await db.exec(readFileSync('drizzle/migrations/0021_addon_resolution_for_checkout.sql', 'utf8'));
  await db.exec(readFileSync('drizzle/migrations/0024_validate_checkout_line_numeric_inputs.sql', 'utf8'));
}, 30000);
afterAll(async () => { await db.close(); });

async function price(overrides: Record<string, unknown> = {}) {
  const result = await db.query<{ price: { line_total: number } }>(
    'SELECT public.price_checkout_line($1::uuid,$2::uuid,$3::jsonb) AS price',
    [vendor, outlet, JSON.stringify({ product_id: product, quantity: 1, ...overrides })],
  );
  return result.rows[0].price;
}

describe('actual PostgreSQL checkout pricing input validation', () => {
  it('recomputes price from menu despite client monetary fields', async () => {
    expect((await price({ unit_price: 1, price: 1, total: 1, subtotal: 1 })).line_total).toBe(1000);
  });
  it('prices positive add-on quantities from database, not submitted prices', async () => {
    expect((await price({ quantity: 2, addons: [{ addon_item_id: addon, quantity: 2, additional_price: -9999 }] })).line_total).toBe(2800);
  });
  it('preserves cached name-based add-ons with omitted quantity', async () => {
    expect((await price({ addons: [{ group_name: 'Extras', item_name: 'Egg' }] })).line_total).toBe(1200);
  });
  it.each([-10, 0, 0.5, '2', null, 'NaN'])('rejects unsafe add-on quantity %s', async quantity => {
    await expect(price({ addons: [{ addon_item_id: addon, quantity }] })).rejects.toThrow('INVALID_OPTION_QUANTITY');
  });
  it.each([-1, 0, '1', null])('rejects unsafe product quantity %s', async quantity => {
    await expect(price({ quantity })).rejects.toThrow('INVALID_QUANTITY');
  });
  it.each([null, {}, [{ quantity: 1 }]])('rejects malformed add-ons %s', async addons => {
    await expect(price({ addons })).rejects.toThrow('INVALID_OPTION');
  });
  it('rejects an unavailable add-on', async () => {
    await expect(price({ addons: [{ item_name: 'Missing' }] })).rejects.toThrow('INVALID_OPTION');
  });
});