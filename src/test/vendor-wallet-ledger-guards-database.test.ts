// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, it, expect, describe } from 'vitest';

const dir = 'drizzle/migrations';
const file = readdirSync(dir).find((f) => f.includes('vendor_wallet_ledger_guards'));
const migrationPath = file ? `${dir}/${file}` : '/tmp/m0038.sql';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

const db = new PGlite();
const W1 = '11111111-1111-1111-1111-111111111111';
const W2 = '22222222-2222-2222-2222-222222222222';
const USER = '99999999-9999-9999-9999-999999999999';

beforeAll(async () => {
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
CREATE TABLE platform_settings(key text, value text);
INSERT INTO platform_settings VALUES ('platform_environment','production');
CREATE FUNCTION get_platform_environment() RETURNS text LANGUAGE sql AS $$SELECT value FROM platform_settings WHERE key='platform_environment'$$;
CREATE FUNCTION has_role(uuid, text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION consume_admin_step_up(text,text,text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF $1 <> 'ok' THEN RAISE EXCEPTION 'bad step-up'; END IF; END$$;
CREATE TABLE wallets(
  id uuid PRIMARY KEY, user_id uuid, outlet_id uuid, wallet_type text,
  balance numeric DEFAULT 0, test_balance numeric DEFAULT 0,
  eligible_balance numeric DEFAULT 0, test_eligible_balance numeric DEFAULT 0,
  pending_balance numeric DEFAULT 0, test_pending_balance numeric DEFAULT 0,
  menu_earnings_balance numeric DEFAULT 0, test_menu_earnings_balance numeric DEFAULT 0,
  menu_earnings_pending numeric DEFAULT 0, test_menu_earnings_pending numeric DEFAULT 0,
  rider_revenue_balance numeric DEFAULT 0, test_rider_revenue_balance numeric DEFAULT 0,
  total_earned numeric DEFAULT 0, total_withdrawn numeric DEFAULT 0, pending_payouts numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now());
CREATE TABLE wallet_transactions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, wallet_type text, transaction_type text,
  category text, amount numeric, reference text, order_id uuid, status text, environment text,
  notes text, metadata jsonb, release_at timestamptz, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX wtx_ref ON wallet_transactions(wallet_id, reference) WHERE reference IS NOT NULL;
CREATE TABLE payout_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid,
  user_type text, amount numeric, status text DEFAULT 'pending', withdrawal_source text, environment text);
CREATE TABLE platform_wallet(id uuid, balance numeric, test_balance numeric, created_at timestamptz DEFAULT now());
CREATE TABLE wallet_drift_audit(id uuid DEFAULT gen_random_uuid(), wallet_id uuid, wallet_type text, environment text,
  wallet_balance numeric, ledger_balance numeric, drift numeric, detected_at timestamptz DEFAULT now());
CREATE TABLE admin_sensitive_audit(correlation_id uuid, actor_id uuid, actor_name text, action text, category text,
  target_type text, target_id text, target_label text, old_value jsonb, new_value jsonb, amount numeric,
  currency text, environment text, reference text, reason text, outcome text, auth_method text);
CREATE TABLE write_log(n int);
-- Signed-in page protection: money fields revert for authenticated sessions (mirrors production trigger).
CREATE FUNCTION prevent_direct_balance_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO write_log VALUES (1);
  IF COALESCE(current_setting('app.bypass_balance_trigger', true),'off') IN ('on','true') THEN RETURN NEW; END IF;
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF current_user = 'authenticated' THEN
    NEW.balance := OLD.balance; NEW.eligible_balance := OLD.eligible_balance;
    NEW.menu_earnings_balance := OLD.menu_earnings_balance;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prevent_balance_manipulation BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION prevent_direct_balance_update();
-- Simplified atomic, idempotent post_wallet_entry (same contract as production).
CREATE FUNCTION post_wallet_entry(p_wallet_id uuid, p_wallet_type text, p_transaction_type text, p_category text,
  p_amount numeric, p_reference text, p_environment text DEFAULT 'production', p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL, p_metadata jsonb DEFAULT '{}', p_target text DEFAULT 'balance', p_status text DEFAULT 'completed')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; d numeric := CASE WHEN p_transaction_type='credit' THEN p_amount ELSE -p_amount END;
BEGIN
  SELECT id INTO v FROM wallet_transactions WHERE wallet_id=p_wallet_id AND reference=p_reference;
  IF v IS NOT NULL THEN RETURN v; END IF;
  PERFORM set_config('app.bypass_balance_trigger','on',true);
  IF p_environment='development' THEN UPDATE wallets SET test_balance=test_balance+d WHERE id=p_wallet_id;
  ELSE UPDATE wallets SET balance=balance+d WHERE id=p_wallet_id; END IF;
  INSERT INTO wallet_transactions(wallet_id,wallet_type,transaction_type,category,amount,reference,status,environment,notes)
  VALUES (p_wallet_id,p_wallet_type,p_transaction_type,p_category,p_amount,p_reference,p_status,p_environment,p_notes) RETURNING id INTO v;
  RETURN v;
END $$;
`);
  await db.exec(migration);
  await db.exec(`CREATE TRIGGER deduct BEFORE INSERT ON payout_requests FOR EACH ROW EXECUTE FUNCTION deduct_wallet_on_payout_request();`);
}, 30000);
afterAll(() => db.close());

async function reset() {
  await db.exec(`TRUNCATE wallets, wallet_transactions, payout_requests, wallet_drift_audit, admin_sensitive_audit, write_log;
    UPDATE platform_settings SET value='production';`);
}
async function wallet(id: string, f: Record<string, number> = {}) {
  await db.query(
    `INSERT INTO wallets(id,user_id,wallet_type,balance,eligible_balance,menu_earnings_balance,pending_balance,menu_earnings_pending,test_balance)
     VALUES($1,$2,'vendor',$3,$4,$5,$6,$7,$8)`,
    [id, USER, f.balance ?? 0, f.eligible ?? 0, f.menu ?? 0, f.pending ?? 0, f.menuPending ?? 0, f.test ?? 0],
  );
}
async function tx(w: string, type: 'credit' | 'debit', cat: string, amount: number, extra: { status?: string; env?: string; notes?: string; release?: string; ref?: string } = {}) {
  await db.query(
    `INSERT INTO wallet_transactions(wallet_id,wallet_type,transaction_type,category,amount,status,environment,notes,release_at,reference)
     VALUES($1,'vendor',$2,$3,$4,$5,$6,$7,$8::timestamptz,$9)`,
    [w, type, cat, amount, extra.status ?? 'completed', extra.env ?? 'production', extra.notes ?? null, extra.release ?? null, extra.ref ?? null],
  );
}
const get = async (id: string) => (await db.query<any>('SELECT * FROM wallets WHERE id=$1', [id])).rows[0];
async function payout(w: string, amount: number) {
  return db.query<any>(`INSERT INTO payout_requests(wallet_id,user_id,user_type,amount,withdrawal_source) VALUES($1,$2,'vendor',$3,'menu_earnings') RETURNING id`, [w, USER, amount]);
}

beforeEach(reset);

describe('vendor wallet ledger guards', () => {
  it('dispute/adjustment/vendor_share debits reduce withdrawable; payout capped at ledger', async () => {
    await wallet(W1, { balance: 500 });
    await tx(W1, 'credit', 'vendor_share', 1000);
    await tx(W1, 'debit', 'dispute_deduction', 200);
    await tx(W1, 'debit', 'adjustment', 100);
    await tx(W1, 'debit', 'vendor_share', 200);
    await expect(payout(W1, 501)).rejects.toThrow(/Insufficient balance/);
    await payout(W1, 500);
    const w = await get(W1);
    expect(Number(w.balance)).toBe(0);
    expect(Number(w.menu_earnings_balance)).toBe(0);
    expect(Number(w.eligible_balance)).toBe(0);
  });

  it('drift blocks payout with a clear error and reconcile freezes the wallet without repairing', async () => {
    await wallet(W1, { balance: 6920, eligible: 6920, menu: 6920 });
    await tx(W1, 'credit', 'vendor_share', 1000);
    await tx(W1, 'debit', 'dispute_deduction', 1000);
    await expect(payout(W1, 100)).rejects.toThrow(/PAYOUT_FROZEN_LEDGER_DRIFT/);
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}')`);
    const w = await get(W1);
    expect(Number(w.balance)).toBe(6920); // never silently repaired
    expect(w.payout_frozen).toBe(true);
    expect(w.payout_frozen_reason).toMatch(/Ledger drift/);
    await expect(payout(W1, 1)).rejects.toThrow(/PAYOUT_FROZEN/);
  });

  it('daily detection records drift and freezes only drifted wallets', async () => {
    await wallet(W1, { balance: 100 });
    await wallet(W2, { balance: 50 });
    await tx(W2, 'credit', 'vendor_share', 50);
    const r = (await db.query<any>('SELECT * FROM detect_wallet_drift()')).rows[0];
    expect(r.drifted).toBe(1);
    expect((await get(W1)).payout_frozen).toBe(true);
    expect((await get(W2)).payout_frozen).toBe(false);
    expect(Number((await get(W1)).balance)).toBe(100);
  });

  it('unreleased holds stay pending and are not withdrawable; released holds counted once', async () => {
    await wallet(W1, { balance: 300 });
    await tx(W1, 'credit', 'vendor_share', 100);
    await tx(W1, 'credit', 'vendor_share', 200, { release: '2999-01-01' });
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}')`);
    let w = await get(W1);
    expect(Number(w.eligible_balance)).toBe(100);
    expect(Number(w.pending_balance)).toBe(200);
    await db.exec(`UPDATE wallet_transactions SET release_at = now() - interval '1 minute' WHERE release_at > now()`);
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}'); SELECT reconcile_vendor_wallet('${W1}')`);
    w = await get(W1);
    expect(Number(w.eligible_balance)).toBe(300);
    expect(Number(w.pending_balance)).toBe(0);
    expect(Number(w.menu_earnings_pending)).toBe(0);
  });

  it('duplicate payout retry with the same reference debits once', async () => {
    await wallet(W1, { balance: 1000 });
    await tx(W1, 'credit', 'vendor_share', 1000);
    const { rows } = await payout(W1, 400);
    await db.exec(`SELECT post_wallet_entry('${W1}','vendor','debit','withdrawal',400,'PAYOUT-REQ-${rows[0].id}')`);
    const n = (await db.query<any>(`SELECT count(*)::int n FROM wallet_transactions WHERE category='withdrawal'`)).rows[0].n;
    expect(n).toBe(1);
    expect(Number((await get(W1)).balance)).toBe(600);
  });

  it('failed/reversed payout restores withdrawable via ledger reversal', async () => {
    await wallet(W1, { balance: 1000 });
    await tx(W1, 'credit', 'vendor_share', 1000);
    const { rows } = await payout(W1, 400);
    await db.exec(`SELECT post_wallet_entry('${W1}','vendor','credit','withdrawal_reversal',400,'REV-${rows[0].id}',p_notes=>'Reversal - Menu Earnings')`);
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}')`);
    const w = await get(W1);
    expect(Number(w.balance)).toBe(1000);
    expect(Number(w.menu_earnings_balance)).toBe(1000);
  });

  it('refund clawback after payout leaves a negative accounting balance (not floored) and zero withdrawable', async () => {
    await wallet(W1, { balance: 1000 });
    await tx(W1, 'credit', 'vendor_share', 1000);
    await payout(W1, 1000);
    await db.exec(`SELECT post_wallet_entry('${W1}','vendor','debit','vendor_share',300,'REFUND-x')`);
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}')`);
    const w = await get(W1);
    expect(Number(w.balance)).toBe(-300);
    expect(Number(w.eligible_balance)).toBe(0);
    await expect(payout(W1, 1)).rejects.toThrow(/Insufficient/);
  });

  it('multiple outlets sharing one user are reconciled independently by wallet id', async () => {
    await wallet(W1, { balance: 100 });
    await wallet(W2, { balance: 900 });
    await tx(W1, 'credit', 'vendor_share', 100);
    await tx(W2, 'credit', 'vendor_share', 900);
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}'); SELECT reconcile_vendor_wallet('${W2}')`);
    expect(Number((await get(W1)).menu_earnings_balance)).toBe(100);
    expect(Number((await get(W2)).menu_earnings_balance)).toBe(900);
    await expect(payout(W1, 101)).rejects.toThrow(/Insufficient/);
  });

  it('development ledger rows never affect production buckets', async () => {
    await wallet(W1, { balance: 100, test: 5000 });
    await tx(W1, 'credit', 'vendor_share', 100);
    await tx(W1, 'credit', 'vendor_share', 5000, { env: 'development' });
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}')`);
    expect(Number((await get(W1)).menu_earnings_balance)).toBe(100);
    await expect(payout(W1, 101)).rejects.toThrow(/Insufficient/);
  });

  it('signed-in sessions cannot run reconcile (page refresh performs zero wallet writes)', async () => {
    await wallet(W1, { balance: 100 });
    await db.exec(`GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT ON wallets TO authenticated;`);
    await db.exec('TRUNCATE write_log');
    await expect(db.exec(`SET ROLE authenticated; SELECT reconcile_vendor_wallet('${W1}');`)).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
    expect((await db.query<any>('SELECT count(*)::int n FROM write_log')).rows[0].n).toBe(0);
  });

  it('audited correction clears drift, unfreezes, audits, and refuses stale expected drift', async () => {
    await wallet(W1, { balance: 12380, eligible: 12380, menu: -20455 });
    await tx(W1, 'credit', 'vendor_share', 3630);
    await db.exec(`SELECT reconcile_vendor_wallet('${W1}')`);
    await expect(db.exec(`SELECT apply_vendor_wallet_correction_internal('${W1}', 1, 'Confirmed drift correction', NULL, 'system', 'migration')`)).rejects.toThrow(/Drift changed/);
    await expect(db.exec(`SELECT admin_correct_vendor_wallet_drift('ok', '${W1}', 8750, 'Confirmed drift correction')`)).rejects.toThrow(/Admin access required/);
    await db.exec(`SELECT apply_vendor_wallet_correction_internal('${W1}', 8750, 'Confirmed drift correction', NULL, 'system', 'migration')`);
    const w = await get(W1);
    expect(Number(w.balance)).toBe(3630);
    expect(Number(w.eligible_balance)).toBe(3630);
    expect(Number(w.menu_earnings_balance)).toBe(3630);
    expect(w.payout_frozen).toBe(false);
    const a = (await db.query<any>('SELECT * FROM admin_sensitive_audit')).rows[0];
    expect(Number(a.amount)).toBe(8750);
    expect(Number(a.old_value.balance)).toBe(12380);
    const d = (await db.query<any>('SELECT * FROM detect_wallet_drift()')).rows[0];
    expect(d.drifted).toBe(0);
    expect((await db.query<any>('SELECT count(*)::int n FROM wallet_transactions')).rows[0].n).toBe(1); // no invented entries
  });

  it('payout without a matching ledger debit is rejected at commit', async () => {
    await wallet(W1, { balance: 100 });
    await db.exec('ALTER TABLE payout_requests DISABLE TRIGGER deduct');
    await expect(db.exec(`INSERT INTO payout_requests(wallet_id,user_id,user_type,amount,environment) VALUES('${W1}','${USER}','vendor',50,'production')`)).rejects.toThrow(/PAYOUT_LEDGER_MISMATCH/);
    await db.exec('ALTER TABLE payout_requests ENABLE TRIGGER deduct');
  });
});

it('vendor withdraw and admin payouts pages never call reconcile on load', () => {
  for (const f of ['src/pages/vendor/VendorWithdraw.tsx', 'src/pages/admin/AdminPayouts.tsx']) {
    expect(readFileSync(f, 'utf8')).not.toMatch(/reconcile_vendor_wallet/);
  }
});
