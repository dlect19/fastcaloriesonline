import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { customerOrderTracking, deliveryMessage, trackingLink } from '../../supabase/functions/_shared/orderTracking';
const order = { id: 'one', user_id: 'alice', tracking_token: 'secret-one', order_number: 'FC1', delivery_type: 'delivery' };
function database(snapshot: any = {}) {
  let calls = 0;
  return { get calls() { return calls; }, from() {
    const filters: Record<string,string> = {};
    const q: any = { select: () => q, eq: (k: string,v: string) => { filters[k]=v; return q; }, order: () => q, limit: () => q,
      then: (resolve: any) => { calls++; resolve({ data: Object.entries(filters).every(([k,v]) => (order as any)[k]===v) ? [order] : [] }); } }; return q;
  }, rpc: async (_: string,args: any) => ({ data: args.p_token === order.tracking_token ? { status: 'preparing', ...snapshot } : null }) };
}
describe('secure order tracking', () => {
  it('returns a customer-owned tracking link', async () => { expect(await customerOrderTracking(database(), 'alice', {order_id:'one'})).toMatchObject({ok:true,tracking_url:trackingLink('secret-one')}); });
  it('rejects another customer', async () => { expect(await customerOrderTracking(database(), 'bob', {order_id:'one'})).toEqual({ok:false,reason:'order_not_found'}); });
  it('rejects anonymous access', async () => { expect((await customerOrderTracking(database(), null, {})).ok).toBe(false); });
  it('cannot switch orders with a token', async () => { expect((await customerOrderTracking(database(), 'alice', {order_id:'secret-two'})).ok).toBe(false); });
  it('fetches live state on every query', async () => { const db=database(); await customerOrderTracking(db,'alice',{}); await customerOrderTracking(db,'alice',{}); expect(db.calls).toBe(2); });
  it('never manufactures an ETA or GPS', async () => { const data=await customerOrderTracking(database(),'alice',{}); expect(data).not.toHaveProperty('location'); expect(data).not.toHaveProperty('estimated_delivery_at'); });
  it('does not send rider messages for pickup', () => { expect(deliveryMessage({event_key:'assigned:x'}, {...order,delivery_type:'carryout'}, {rider:{first_name:'Jane'}})).toBeNull(); });
  it('uses only supplied safe rider fields', () => { const msg=deliveryMessage({event_key:'assigned:x'},order,{rider:{first_name:'Jane',phone:'+234123',vehicle_type:'bike'}}); expect(msg).toContain('Jane (bike)'); expect(msg).not.toContain('+234123'); });
  it('omits missing rider fields', () => { expect(deliveryMessage({event_key:'assigned:x'},order,{})).not.toContain('Rider:'); });
  for (const status of ['cancelled','delivered']) it(`reflects ${status}`, async () => { expect(await customerOrderTracking(database({status}),'alice',{})).toMatchObject({status}); });
  it('claims only pending events before sending, so repeated dispatch cannot resend', () => {
    const src=readFileSync('supabase/functions/whatsapp-delivery-update/index.ts','utf8');
    expect(src).toContain(".eq('state', 'pending')"); expect(src.indexOf("state: 'sending'")).toBeLessThan(src.indexOf('await sendTwilioMessage'));
    expect(src).toContain('if (!ev) return');
  });
  it('confirmation includes tracking for wallet and hosted payment', () => {
    const src=readFileSync('supabase/functions/whatsapp-webhook/tools.ts','utf8'); expect(src.match(/\.\.\.tracking,/g)).toHaveLength(2);
  });
});
