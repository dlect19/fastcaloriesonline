// @vitest-environment node
// Proves the rider-search rounds model against the real constraint set from
// migration 0035, on a throwaway in-memory database. No production row touched.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { isLiveRoundConflict } from '../../supabase/functions/_shared/dispatchConflict.ts';

const db = new PGlite();
const ORDER = '00000000-0000-0000-0000-0000000000a1';
const OTHER_ORDER = '00000000-0000-0000-0000-0000000000a2';
const HISTORICAL_ORDER = '00000000-0000-0000-0000-0000000000a3';

beforeAll(async () => {
  await db.exec(`
CREATE TABLE dispatch_requests(
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  superseded_by_request_id uuid,
  retry_round integer DEFAULT 0
);
ALTER TABLE dispatch_requests ADD CONSTRAINT dispatch_requests_order_id_key UNIQUE (order_id);
`);
  // Apply the real migration text (constraint drop + partial unique index).
  const sql = readFileSync('drizzle/migrations/0035_allow_dispatch_rounds_per_order.sql', 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/public\./g, '')
    .replace(/COMMENT ON INDEX[\s\S]*?;/g, '');
  await db.exec(sql);
}, 30000);

afterAll(() => db.close());

beforeEach(async () => {
  await db.exec('DELETE FROM dispatch_requests');
  // Historical, already-delivered order: its accepted round must never be touched.
  await db.query('INSERT INTO dispatch_requests(order_id, status) VALUES($1, $2)', [
    HISTORICAL_ORDER,
    'accepted',
  ]);
});

/** Mirrors the function's supersede-before-insert flow. */
async function dispatch(orderId: string, round = 0) {
  const existing = await db.query<{ id: string; status: string }>(
    'SELECT id, status FROM dispatch_requests WHERE order_id = $1',
    [orderId],
  );
  const superseded: string[] = [];
  for (const row of existing.rows) {
    if (row.status === 'accepted') continue;
    await db.query("UPDATE dispatch_requests SET status = 'superseded' WHERE id = $1 AND status <> 'accepted'", [row.id]);
    superseded.push(row.id);
  }
  try {
    const created = await db.query<{ id: string }>(
      'INSERT INTO dispatch_requests(order_id, status, retry_round) VALUES($1, $2, $3) RETURNING id',
      [orderId, 'pending', round],
    );
    if (superseded.length) {
      await db.query('UPDATE dispatch_requests SET superseded_by_request_id = $1 WHERE id = ANY($2::uuid[])', [
        created.rows[0].id,
        superseded,
      ]);
    }
    return { ok: true as const, id: created.rows[0].id, superseded };
  } catch (error: any) {
    return { ok: false as const, error, conflict: isLiveRoundConflict(error) };
  }
}

async function rows(orderId: string) {
  return (
    await db.query<{ status: string; superseded_by_request_id: string | null }>(
      'SELECT status, superseded_by_request_id FROM dispatch_requests WHERE order_id = $1 ORDER BY created_at',
      [orderId],
    )
  ).rows;
}

it('a second round after an expired round succeeds and keeps the history', async () => {
  await db.query("INSERT INTO dispatch_requests(order_id, status) VALUES($1,'expired')", [ORDER]);
  const again = await dispatch(ORDER, 1);
  expect(again.ok).toBe(true);
  const all = await rows(ORDER);
  expect(all).toHaveLength(2);
  expect(all.map((r) => r.status).sort()).toEqual(['pending', 'superseded']);
});

it('a second round after no_riders succeeds', async () => {
  await db.query("INSERT INTO dispatch_requests(order_id, status) VALUES($1,'no_riders')", [ORDER]);
  expect((await dispatch(ORDER, 1)).ok).toBe(true);
  expect(await rows(ORDER)).toHaveLength(2);
});

it('the previous round is marked superseded and linked to the new one', async () => {
  const first = await dispatch(ORDER);
  await db.query("UPDATE dispatch_requests SET status='expired' WHERE id=$1", [(first as any).id]);
  const second = await dispatch(ORDER, 1);
  const all = await rows(ORDER);
  const retired = all.find((r) => r.status === 'superseded');
  expect(retired?.superseded_by_request_id).toBe((second as any).id);
});

it('concurrent searches leave exactly one live round and the loser is a safe conflict', async () => {
  const [a, b] = await Promise.all([dispatch(ORDER), dispatch(ORDER)]);
  const results = [a, b];
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  const loser = results.find((r) => !r.ok) as any;
  expect(loser.error.code).toBe('23505');
  expect(loser.conflict).toBe(true);
  const live = await db.query(
    "SELECT id FROM dispatch_requests WHERE order_id=$1 AND status IN ('pending','accepted')",
    [ORDER],
  );
  expect(live.rows).toHaveLength(1);
});

it('an accepted round blocks a second live round', async () => {
  await db.query("INSERT INTO dispatch_requests(order_id, status) VALUES($1,'accepted')", [ORDER]);
  const again = await dispatch(ORDER, 1);
  expect(again.ok).toBe(false);
  expect((again as any).conflict).toBe(true);
  expect((await rows(ORDER))[0].status).toBe('accepted');
});

it('many retired rounds coexist for one order', async () => {
  for (const s of ['superseded', 'expired', 'no_riders', 'superseded']) {
    await db.query('INSERT INTO dispatch_requests(order_id, status) VALUES($1,$2)', [ORDER, s]);
  }
  expect((await dispatch(ORDER, 4)).ok).toBe(true);
  expect(await rows(ORDER)).toHaveLength(5);
});

it('other orders are unaffected and historical accepted rounds are never rewritten', async () => {
  await dispatch(ORDER);
  await dispatch(OTHER_ORDER);
  const historical = await rows(HISTORICAL_ORDER);
  expect(historical).toHaveLength(1);
  expect(historical[0].status).toBe('accepted');
  expect(historical[0].superseded_by_request_id).toBeNull();
});

it('unrelated unique violations are not treated as a live-round conflict', () => {
  expect(
    isLiveRoundConflict({
      code: '23505',
      message: 'duplicate key value violates unique constraint "dispatch_offers_unique"',
    }),
  ).toBe(false);
  expect(isLiveRoundConflict({ code: '23503', message: 'dispatch_requests_one_live_per_order' })).toBe(false);
  expect(isLiveRoundConflict(null)).toBe(false);
  expect(
    isLiveRoundConflict({
      code: '23505',
      message: 'duplicate key value violates unique constraint "dispatch_requests_one_live_per_order"',
    }),
  ).toBe(true);
});
