/**
 * Vendor-facing editor for the shared Product Ordering Rules Engine.
 *
 * Everything configured here is what the backend (public.get_product_ordering_rules
 * + supabase/functions/_shared/orderingRules.ts) enforces for every channel:
 * WhatsApp AI, app/web, assisted ordering and POS. The AI never invents these
 * values — it only reads them.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, Package, ShieldCheck } from 'lucide-react';

export type OrderMode = 'instant' | 'preorder' | 'both';

/** All values are kept as strings so the form stays controlled and empty-safe. */
export interface OrderingRulesDraft {
  order_mode: OrderMode;
  preorder_lead_minutes: string;
  preorder_cutoff_time: string;
  preorder_weekdays: number[];
  preorder_min_qty: string;
  prep_time_minutes: string;
  sale_unit: string;
  sale_unit_label: string;
  units_per_pack: string;
  allows_break_pack: boolean;
  min_order_qty: string;
  max_order_qty: string;
  qty_step: string;
  min_purchase_age: string;
  whatsapp_orderable: boolean;
}

export const SALE_UNITS = [
  'each', 'tablet', 'capsule', 'sachet', 'strip', 'blister', 'bottle', 'pack', 'box',
  'tray', 'portion', 'plate', 'bowl', 'serving', 'custom',
] as const;

const WEEKDAYS = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export const emptyOrderingRulesDraft = (): OrderingRulesDraft => ({
  order_mode: 'instant',
  preorder_lead_minutes: '',
  preorder_cutoff_time: '',
  preorder_weekdays: [],
  preorder_min_qty: '',
  prep_time_minutes: '',
  sale_unit: '',
  sale_unit_label: '',
  units_per_pack: '',
  allows_break_pack: false,
  min_order_qty: '1',
  max_order_qty: '',
  qty_step: '1',
  min_purchase_age: '',
  whatsapp_orderable: true,
});

/** Read the rules back off an existing product row (back-compatible defaults). */
export const orderingRulesFromProduct = (p: any): OrderingRulesDraft => ({
  order_mode: (p?.fulfillment_type as OrderMode) || 'instant',
  preorder_lead_minutes: p?.preorder_lead_minutes?.toString() || '',
  preorder_cutoff_time: (p?.preorder_cutoff_time as string | null)?.slice(0, 5) || '',
  preorder_weekdays: Array.isArray(p?.preorder_weekdays) ? p.preorder_weekdays : [],
  preorder_min_qty: p?.preorder_min_qty?.toString() || '',
  prep_time_minutes: p?.prep_time_minutes?.toString() || '',
  sale_unit: p?.sale_unit || '',
  sale_unit_label: p?.sale_unit_label || '',
  units_per_pack: p?.units_per_pack?.toString() || '',
  allows_break_pack: p?.allows_break_pack ?? false,
  min_order_qty: p?.min_order_qty?.toString() || '1',
  max_order_qty: p?.max_order_qty?.toString() || '',
  qty_step: p?.qty_step?.toString() || '1',
  min_purchase_age: p?.min_purchase_age?.toString() || '',
  whatsapp_orderable: p?.whatsapp_orderable ?? true,
});

const int = (v: string) => (v.trim() === '' ? null : Number.parseInt(v, 10) || null);

/** Map the draft onto the additive product columns the engine reads. */
export const orderingRulesToProductData = (d: OrderingRulesDraft, isPharmacy: boolean) => {
  const data: Record<string, unknown> = {
    fulfillment_type: d.order_mode,
    prep_time_minutes: int(d.prep_time_minutes),
    preorder_lead_minutes: d.order_mode === 'instant' ? null : int(d.preorder_lead_minutes),
    preorder_cutoff_time: d.order_mode === 'instant' || !d.preorder_cutoff_time ? null : d.preorder_cutoff_time,
    preorder_weekdays: d.order_mode === 'instant' || !d.preorder_weekdays.length ? null : d.preorder_weekdays,
    preorder_min_qty: d.order_mode === 'instant' ? null : int(d.preorder_min_qty),
    min_order_qty: int(d.min_order_qty) ?? 1,
    max_order_qty: int(d.max_order_qty),
    qty_step: int(d.qty_step) ?? 1,
    whatsapp_orderable: d.whatsapp_orderable,
  };
  if (isPharmacy) {
    data.sale_unit = d.sale_unit || null;
    data.sale_unit_label = d.sale_unit_label || null;
    data.units_per_pack = int(d.units_per_pack);
    data.allows_break_pack = d.allows_break_pack;
    data.min_purchase_age = int(d.min_purchase_age);
  }
  return data;
};

interface Props {
  value: OrderingRulesDraft;
  onChange: (next: OrderingRulesDraft) => void;
  /** Pharmacy packaging/regulated fields are only shown for pharmacy items. */
  isPharmacy: boolean;
}

export function ProductOrderingRulesEditor({ value, onChange, isPharmacy }: Props) {
  const set = (patch: Partial<OrderingRulesDraft>) => onChange({ ...value, ...patch });
  const showPreorder = value.order_mode !== 'instant';

  const toggleDay = (day: number) => {
    const next = value.preorder_weekdays.includes(day)
      ? value.preorder_weekdays.filter((d) => d !== day)
      : [...value.preorder_weekdays, day].sort((a, b) => a - b);
    set({ preorder_weekdays: next });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border p-3">
        <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
          <Clock className="h-4 w-4" /> Ordering & pre-order rules
        </Label>

        <div className="space-y-1">
          <Label className="text-xs">When can customers order this?</Label>
          <Select value={value.order_mode} onValueChange={(v) => set({ order_mode: v as OrderMode })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="instant">Immediate only — ready today</SelectItem>
              <SelectItem value="preorder">Pre-order only — needs advance notice</SelectItem>
              <SelectItem value="both">Both — immediate or pre-order</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Prep time (minutes)</Label>
            <Input
              className="h-9" type="number" min="0" placeholder="30"
              value={value.prep_time_minutes}
              onChange={(e) => set({ prep_time_minutes: e.target.value })}
            />
          </div>
          {showPreorder && (
            <div className="space-y-1">
              <Label className="text-xs">Pre-order lead time (minutes)</Label>
              <Input
                className="h-9" type="number" min="0" placeholder="1440 = 24 hours"
                value={value.preorder_lead_minutes}
                onChange={(e) => set({ preorder_lead_minutes: e.target.value })}
              />
            </div>
          )}
        </div>

        {showPreorder && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Daily order cutoff (optional)</Label>
                <Input
                  className="h-9" type="time"
                  value={value.preorder_cutoff_time}
                  onChange={(e) => set({ preorder_cutoff_time: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Minimum pre-order quantity</Label>
                <Input
                  className="h-9" type="number" min="1" placeholder="1"
                  value={value.preorder_min_qty}
                  onChange={(e) => set({ preorder_min_qty: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Days this item can be collected/delivered (optional)</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      value.preorder_weekdays.includes(d.value)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Leave all unselected to allow any day.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 rounded-xl border p-3">
        <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
          <Package className="h-4 w-4" /> Quantity rules
        </Label>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Minimum</Label>
            <Input className="h-9" type="number" min="1" value={value.min_order_qty}
              onChange={(e) => set({ min_order_qty: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Maximum</Label>
            <Input className="h-9" type="number" min="1" placeholder="no limit" value={value.max_order_qty}
              onChange={(e) => set({ max_order_qty: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Step</Label>
            <Input className="h-9" type="number" min="1" value={value.qty_step}
              onChange={(e) => set({ qty_step: e.target.value })} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Customers can only order in these amounts — checkout is blocked otherwise.
        </p>
      </div>

      {isPharmacy && (
        <div className="space-y-3 rounded-xl border p-3">
          <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            <ShieldCheck className="h-4 w-4" /> How this medicine is sold
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Sale unit</Label>
              <Select value={value.sale_unit || 'unset'} onValueChange={(v) => set({ sale_unit: v === 'unset' ? '' : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not set</SelectItem>
                  {SALE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Label shown to customers</Label>
              <Input className="h-9" placeholder="strip of 10" value={value.sale_unit_label}
                onChange={(e) => set({ sale_unit_label: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Units per pack</Label>
              <Input className="h-9" type="number" min="1" placeholder="10" value={value.units_per_pack}
                onChange={(e) => set({ units_per_pack: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Minimum buyer age (optional)</Label>
              <Input className="h-9" type="number" min="0" placeholder="18" value={value.min_purchase_age}
                onChange={(e) => set({ min_purchase_age: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-2">
            <div>
              <Label className="text-sm">Allow breaking the pack</Label>
              <p className="text-[11px] text-muted-foreground">
                Off means customers must buy the full pack/strip.
              </p>
            </div>
            <Switch checked={value.allows_break_pack} onCheckedChange={(v) => set({ allows_break_pack: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-2">
            <div>
              <Label className="text-sm">Orderable on WhatsApp</Label>
              <p className="text-[11px] text-muted-foreground">
                Off blocks this item from WhatsApp ordering entirely.
              </p>
            </div>
            <Switch checked={value.whatsapp_orderable} onCheckedChange={(v) => set({ whatsapp_orderable: v })} />
          </div>
        </div>
      )}
    </div>
  );
}
