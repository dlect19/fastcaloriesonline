// @vitest-environment node
import { expect, it } from 'vitest';
import { checkoutAttempt, retireCheckoutAttempt } from '../lib/checkoutAttempt';
function store() { const m=new Map<string,string>(); return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>m.set(k,v),removeItem:(k:string)=>{m.delete(k)},clear:()=>m.clear(),key:(i:number)=>Array.from(m.keys())[i]??null,get length(){return m.size}} as Storage; }
it('persists across retries and new callers; success permits intentional reorder',async()=>{
 const s=store(); const a=await checkoutAttempt(s,'u',{cart:1});
 expect(await checkoutAttempt(s,'u',{cart:1})).toEqual(a);
 retireCheckoutAttempt(s,a.slot,a.key);
 expect((await checkoutAttempt(s,'u',{cart:1})).key).not.toBe(a.key);
});
it.each(['items','outlet','address','fulfilment','promo','packaging','options','paymentMethod'])('invalidates material %s change',async(field)=>{
 const s=store();expect((await checkoutAttempt(s,'u',{[field]:1})).key).not.toBe((await checkoutAttempt(s,'u',{[field]:2})).key);
});
