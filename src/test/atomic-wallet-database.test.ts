// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, it, expect } from 'vitest';
const db=new PGlite();
beforeAll(async()=>{
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT ''00000000-0000-0000-0000-000000000001''::uuid';
CREATE TABLE orders(id uuid DEFAULT gen_random_uuid(),user_id uuid,channel text DEFAULT 'online',duplicate_of_order_id uuid,status text DEFAULT 'pending',payment_status text DEFAULT 'pending',total numeric DEFAULT 100,environment text,k text UNIQUE);
CREATE TABLE items(order_id uuid); CREATE TABLE quotes(k text PRIMARY KEY,consumed boolean);
CREATE TABLE wallet(balance numeric); INSERT INTO wallet VALUES(1000);
CREATE TABLE postings(order_id uuid,category text); CREATE TABLE diagnostics(detail text);
CREATE TABLE platform_settings(key text,value text); INSERT INTO platform_settings VALUES('platform_environment','production');
CREATE FUNCTION log_checkout_integrity_event(text,uuid,p_attempt_key text DEFAULT NULL,p_detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS 'INSERT INTO diagnostics VALUES(p_detail)';
CREATE FUNCTION create_customer_order(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE i uuid; BEGIN
 SELECT id INTO i FROM orders WHERE k=p->>'checkout_attempt_key';
 IF i IS NULL THEN
 INSERT INTO orders(user_id,k) VALUES(auth.uid(),p->>'checkout_attempt_key') RETURNING id INTO i;
 INSERT INTO items VALUES(i); INSERT INTO quotes VALUES(p->>'checkout_attempt_key',true);
 END IF; RETURN jsonb_build_object('ok',true,'order_id',i); END $$;
CREATE FUNCTION pay_orders_with_wallet(ids uuid[],ref text,env text) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE b numeric; BEGIN
 SELECT balance INTO b FROM wallet FOR UPDATE;
 IF b<100 THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
 UPDATE wallet SET balance=balance-100;
 INSERT INTO postings VALUES(ids[1],'wallet_payment'),(ids[1],'vendor_share'),(ids[1],'platform_commission');
 IF current_setting('test.fail',true)='yes' THEN RAISE EXCEPTION 'injected posting failure'; END IF;
 UPDATE orders SET payment_status='paid' WHERE id=ids[1]; RETURN '{"success":true}'::jsonb; END $$;
`);
await db.exec(readFileSync('scripts/sql/atomic-wallet-checkout.sql','utf8'));
},30000);
afterAll(()=>db.close());
async function call(k:string){return (await db.query<{r:any}>('SELECT checkout_customer_wallet($1::jsonb) r',[JSON.stringify({checkout_attempt_key:k})])).rows[0].r;}
it('success and queued simultaneous replay debit/post once; new key allowed',async()=>{
const [a,b]=await Promise.all([call('one'),call('one')]);expect(a.order_id).toBe(b.order_id);expect(a.payment_status).toBe('paid');
expect((await db.query('SELECT * FROM postings')).rows).toHaveLength(3);
expect((await call('two')).order_id).not.toBe(a.order_id);
});
it.each(['balance','posting'])('%s failure rolls back order/items/quote/debit/postings',async mode=>{
const before=await db.query('SELECT count(*)::int n FROM postings');
if(mode==='balance')await db.exec('UPDATE wallet SET balance=0');else await db.exec("UPDATE wallet SET balance=1000; SET test.fail='yes'");
const r=await call(mode);expect(r.ok).toBe(false);
expect((await db.query('SELECT * FROM orders WHERE k=$1',[mode])).rows).toHaveLength(0);
expect((await db.query('SELECT * FROM quotes WHERE k=$1',[mode])).rows).toHaveLength(0);
expect((await db.query('SELECT count(*)::int n FROM postings')).rows).toEqual(before.rows);
expect((await db.query('SELECT balance::int b FROM wallet')).rows[0]).toEqual({b:mode==='balance'?0:1000});
await db.exec("SET test.fail='no'");
});
