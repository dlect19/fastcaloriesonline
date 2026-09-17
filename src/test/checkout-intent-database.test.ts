// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, it, expect } from 'vitest';
const db = new PGlite();
const uid='00000000-0000-0000-0000-000000000001';
const vendor='00000000-0000-0000-0000-000000000002';
const quote='00000000-0000-0000-0000-000000000003';
beforeAll(async()=>{
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT ''${uid}''::uuid';
CREATE TABLE orders(id uuid DEFAULT gen_random_uuid(), user_id uuid, vendor_id uuid,outlet_id uuid, checkout_attempt_key text UNIQUE, checkout_fingerprint text,channel text DEFAULT 'online',created_at timestamptz DEFAULT now(),delivery_type text,order_number text,total numeric,delivery_fee numeric,service_fee numeric,discount numeric,payment_status text,delivery_quote_id uuid);
CREATE TABLE delivery_quotes(id uuid,user_id uuid,vendor_id uuid,outlet_id uuid,consumed_order_id uuid,expires_at timestamptz,checkout_fingerprint text,dest_lat numeric,dest_lng numeric,customer_address_id uuid);
CREATE TABLE checkout_integrity_events(event_type text,user_id uuid,vendor_id uuid,outlet_id uuid,order_id uuid,existing_order_id uuid,checkout_attempt_key text,delivery_quote_id uuid,submitted_fee numeric,expected_fee numeric,detail text);
`);
const legacy=readFileSync('drizzle/migrations/0017_checkout_integrity_and_delivery_quotes.sql','utf8');
const start=legacy.indexOf('CREATE OR REPLACE FUNCTION public.log_checkout_integrity_event');
await db.exec(legacy.slice(start,legacy.indexOf('-- 4.',start)));
// Pricing/line creation is a fixture boundary; execute real wrapper transaction logic.
await db.exec(`CREATE FUNCTION create_customer_order_worker(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE i uuid; BEGIN
INSERT INTO orders(user_id,vendor_id,checkout_attempt_key,checkout_fingerprint,delivery_type) VALUES(auth.uid(),(p->>'vendor_id')::uuid,p->>'checkout_attempt_key',p->>'checkout_fingerprint',p->>'delivery_type') RETURNING id INTO i;
IF p->>'fixture_failure'='pricing' THEN RAISE EXCEPTION 'PRICING_CHANGED: fixture'; END IF;
RETURN jsonb_build_object('order_id',i); END $$;`);
const sql=readFileSync('scripts/sql/checkout-intent-phase.sql','utf8');
await db.exec(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.create_customer_order(p_payload')));
},30000);
afterAll(()=>db.close());
async function call(key:string,extra={}){const r=await db.query<{r:any}>('SELECT create_customer_order($1::jsonb) r',[JSON.stringify({vendor_id:vendor,checkout_attempt_key:key,checkout_fingerprint:'cart',delivery_type:'self_pickup',...extra})]);return r.rows[0].r;}
it('simultaneous submissions and retries resolve to one canonical order',async()=>{
const [a,b]=await Promise.all([call('same'),call('same')]);expect(a.order_id).toBe(b.order_id);expect((await call('same')).order_id).toBe(a.order_id);
expect((await db.query("SELECT * FROM orders WHERE checkout_attempt_key='same'")).rows).toHaveLength(1);
});
it('new key identical reorder allowed and warning persists',async()=>{const a=await call('new1');const b=await call('new2');expect(a.order_id).not.toBe(b.order_id);expect((await db.query("SELECT * FROM checkout_integrity_events WHERE event_type='suspicious_near_duplicate'")).rows.length).toBeGreaterThan(0);});
it('pricing failure rolls back created order but commits diagnostic',async()=>{expect((await call('bad-price',{fixture_failure:'pricing'})).error).toBe('PRICING_CHANGED');expect((await db.query("SELECT * FROM orders WHERE checkout_attempt_key='bad-price'")).rows).toHaveLength(0);expect((await db.query("SELECT * FROM checkout_integrity_events WHERE event_type='pricing_changed'")).rows).toHaveLength(1);});
it.each(['STALE','MISMATCH','CONSUMED'])('quote %s persists after rejection without order',async(kind)=>{
await db.exec('DELETE FROM delivery_quotes');
await db.query('INSERT INTO delivery_quotes(id,user_id,vendor_id,expires_at,consumed_order_id,dest_lat,dest_lng) VALUES($1,$2,$3,$4,$5,1,2)',[quote,uid,vendor,kind==='STALE'?'2000-01-01':'2099-01-01',kind==='CONSUMED'?uid:null]);
const key='quote-'+kind;const r=await call(key,{delivery_type:'delivery',delivery_quote_id:quote,delivery_latitude:kind==='MISMATCH'?9:1,delivery_longitude:2});expect(r.error).toBe('DELIVERY_QUOTE_'+kind);
expect((await db.query('SELECT * FROM orders WHERE checkout_attempt_key=$1',[key])).rows).toHaveLength(0);
expect((await db.query('SELECT * FROM checkout_integrity_events WHERE checkout_attempt_key=$1',[key])).rows.length).toBeGreaterThan(0);
});
