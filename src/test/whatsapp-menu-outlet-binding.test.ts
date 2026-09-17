import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BINDING_REASONS,
  boundOutletFrom,
  eligibleOutlets,
  renderOutletChoice,
  resolveBoundOutlet,
} from '../../supabase/functions/whatsapp-webhook/outletBinding';
import { isEffectivelyAvailable } from '../../supabase/functions/_shared/availability';

const WEBHOOK = readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const ROUTING = readFileSync('supabase/functions/whatsapp-webhook/routing.ts', 'utf8');

type Row = Record<string, any>;

/**
 * Read-only Supabase stub. It answers the exact queries the binding code makes
 * and records nothing mutating, so no order, payment, wallet row or message can
 * ever be produced by these tests.
 */
function db(opts: { outlets: Row[]; vendors: Row[]; scheduleOpen?: Record<string, boolean> }) {
  const writes: string[] = [];
  const client: any = {
    writes,
    from(table: string) {
      const filters: Row = {};
      const api: any = {
        select: () => api,
        order: () => api,
        in: () => api,
        eq: (col: string, val: any) => { filters[col] = val; return api; },
        insert: () => { writes.push(`insert:${table}`); return api; },
        update: () => { writes.push(`update:${table}`); return api; },
        maybeSingle: async () => {
          const rows = table === 'vendor_outlets' ? opts.outlets : opts.vendors;
          const hit = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          return { data: hit ?? null, error: null };
        },
        then: (res: any) => {
          const rows = (table === 'vendor_outlets' ? opts.outlets : opts.vendors)
            .filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return api;
    },
    rpc: async (name: string, args: Row) => {
      if (name === 'schedule_open_now') {
        const open = opts.scheduleOpen?.[args._outlet_id];
        return { data: open === undefined ? true : open, error: null };
      }
      return { data: null, error: null };
    },
  };
  return client;
}

const VENDOR = { id: 'v1', name: 'Mama Put', category: 'restaurant', is_active: true, is_open: true, admin_force_closed: false };
const OPEN_A = { id: 'o-main', vendor_id: 'v1', outlet_name: 'Main Branch', is_active: true, is_approved: true, is_open: true, admin_force_closed: false };
const OPEN_B = { id: 'o-lekki', vendor_id: 'v1', outlet_name: 'Lekki Branch', is_active: true, is_approved: true, is_open: true, admin_force_closed: false };

describe('numbered menu binds the branch the customer chose', () => {
  it('uses the selected branch, not the vendor main branch', async () => {
    const supabase = db({ outlets: [OPEN_A, OPEN_B], vendors: [VENDOR] });
    const res = await resolveBoundOutlet(supabase, { vendorId: 'v1', vendorName: 'Mama Put', boundOutletId: 'o-lekki' });
    expect(res).toEqual({ ok: true, outletId: 'o-lekki', outletName: 'Lekki Branch' });
  });

  it('never substitutes a default/main/first branch when none is bound', async () => {
    const supabase = db({ outlets: [OPEN_A, OPEN_B], vendors: [VENDOR] });
    const res = await resolveBoundOutlet(supabase, { vendorId: 'v1', vendorName: 'Mama Put', boundOutletId: null });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected refusal');
    expect(res.reason).toBe(BINDING_REASONS.NONE_BOUND);
    expect(res.choices.map((c) => c.outlet_id).sort()).toEqual(['o-lekki', 'o-main']);
    expect(res.prompt).toContain('which branch');
  });

  it('asks the customer to choose when only one branch exists', async () => {
    const supabase = db({ outlets: [OPEN_A], vendors: [VENDOR] });
    const res = await resolveBoundOutlet(supabase, { vendorId: 'v1', boundOutletId: null });
    expect(res.ok).toBe(false);
  });

  it('rejects a branch belonging to another vendor', async () => {
    const other = { ...OPEN_B, id: 'o-other', vendor_id: 'v2' };
    const supabase = db({ outlets: [OPEN_A, other], vendors: [VENDOR] });
    const res = await resolveBoundOutlet(supabase, { vendorId: 'v1', boundOutletId: 'o-other' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected refusal');
    expect(res.reason).toBe(BINDING_REASONS.WRONG_VENDOR);
  });

  it('rejects a stale branch id left in an old session', async () => {
    const supabase = db({ outlets: [OPEN_A], vendors: [VENDOR] });
    const res = await resolveBoundOutlet(supabase, { vendorId: 'v1', boundOutletId: 'deleted-outlet' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected refusal');
    expect(res.reason).toBe(BINDING_REASONS.STALE);
  });

  it('rejects closed, force-closed and off-schedule branches', async () => {
    const closed = { ...OPEN_B, id: 'o-closed', is_open: false };
    const forced = { ...OPEN_B, id: 'o-forced', admin_force_closed: true };
    const offSchedule = { ...OPEN_B, id: 'o-sched' };
    const supabase = db({
      outlets: [OPEN_A, closed, forced, offSchedule],
      vendors: [VENDOR],
      scheduleOpen: { 'o-sched': false },
    });
    for (const id of ['o-closed', 'o-forced', 'o-sched']) {
      const res = await resolveBoundOutlet(supabase, { vendorId: 'v1', boundOutletId: id });
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected refusal');
      expect(res.reason).toBe(BINDING_REASONS.NOT_ORDERABLE);
    }
    // Only branches checkout would accept are ever offered.
    const choices = await eligibleOutlets(supabase, 'v1');
    expect(choices.map((c) => c.outlet_id)).toEqual(['o-main']);
  });

  it('offers nothing (and no default) when every branch is shut', async () => {
    const supabase = db({ outlets: [{ ...OPEN_A, is_open: false }], vendors: [VENDOR] });
    const res = await resolveBoundOutlet(supabase, { vendorId: 'v1', vendorName: 'Mama Put', boundOutletId: null });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected refusal');
    expect(res.choices).toHaveLength(0);
    expect(res.prompt).toContain("can't take orders");
  });

  it('renders a numbered branch list', () => {
    const text = renderOutletChoice('Mama Put', [{ outlet_id: 'a', name: 'Yaba' }, { outlet_id: 'b', name: 'Lekki' }], BINDING_REASONS.NONE_BOUND);
    expect(text).toContain('1️⃣ Yaba');
    expect(text).toContain('2️⃣ Lekki');
  });

  it('reads the bound branch from session context then the durable cart', () => {
    expect(boundOutletFrom({ outlet_id: 'o-1' }, [], 'v1')).toBe('o-1');
    expect(boundOutletFrom({ selected_outlet_id: 'o-2' }, [], 'v1')).toBe('o-2');
    expect(boundOutletFrom({}, [{ vendor_id: 'v1', outlet_id: 'o-3' }], 'v1')).toBe('o-3');
    // A cart line for a different vendor never leaks its branch across.
    expect(boundOutletFrom({}, [{ vendor_id: 'v9', outlet_id: 'o-9' }], 'v1')).toBeNull();
  });
});

describe('menu availability uses the shared effective rule', () => {
  it('keeps a globally unavailable item unavailable even with a branch override of true', () => {
    const product = { id: 'p1', is_available: false, is_hidden: false };
    expect(isEffectivelyAvailable(product, { p1: true })).toBe(false);
  });

  it('honours a branch override that disables an otherwise available item', () => {
    const product = { id: 'p1', is_available: true, is_hidden: false };
    expect(isEffectivelyAvailable(product, { p1: false })).toBe(false);
    expect(isEffectivelyAvailable(product, {})).toBe(true);
  });
});

describe('the numbered menu can no longer resolve a default branch', () => {
  it('requires an explicit branch argument for the menu query', () => {
    expect(WEBHOOK).toContain('async function fetchMenuItems(supabase: any, vendorId: string, outletId: string)');
    expect(WEBHOOK).not.toContain('resolveDefaultOutletId');
  });

  it('binds the same vendor + branch for display and for checkout', () => {
    expect(WEBHOOK).toContain('const bindMenuOutlet');
    expect(WEBHOOK).toContain('vendor_id: vendorId');
    expect(WEBHOOK).toContain('outlet_id: res.outletId');
    expect(WEBHOOK).toContain('nextContext.items_outlet_id = outletId');
  });

  it('cross-vendor discovery shows names and prices without claiming availability', () => {
    expect(WEBHOOK).toContain('async function fetchMenuNames(supabase: any, vendorId: string)');
    expect(WEBHOOK).toContain('await fetchMenuNames(supabase, v.id)');
  });

  it('keeps a numbered branch reply on the deterministic path', () => {
    expect(ROUTING).toContain('"choosing_outlet"');
    expect(WEBHOOK).toContain('session.state === "choosing_outlet"');
  });
});
