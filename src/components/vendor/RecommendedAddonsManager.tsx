/**
 * "Goes well with" suggestions a vendor configures per product.
 * Recommendations are never a checkout blocker — the rules engine returns them
 * as optional extras only.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Sparkles, Trash2 } from 'lucide-react';

interface Row {
  id: string;
  recommended_product_id: string | null;
  label: string | null;
  reason: string | null;
  product?: { name: string } | null;
}

interface Props {
  productId: string;
  vendorId: string;
}

export function RecommendedAddonsManager({ productId, vendorId }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [pick, setPick] = useState('');
  const [label, setLabel] = useState('Goes well with');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: recs }, { data: prods }] = await Promise.all([
      supabase
        .from('product_recommended_addons')
        .select('id, recommended_product_id, label, reason, product:products!product_recommended_addons_recommended_product_id_fkey(name)')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('sort_order'),
      supabase.from('products').select('id, name').eq('vendor_id', vendorId).neq('id', productId).order('name').limit(200),
    ]);
    setRows((recs as any) || []);
    setOptions((prods as any) || []);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [productId]);

  const add = async () => {
    if (!pick) return;
    setSaving(true);
    const { error } = await supabase.from('product_recommended_addons').insert({
      product_id: productId,
      recommended_product_id: pick,
      label: label.trim() || 'Goes well with',
      sort_order: rows.length,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Could not add suggestion', description: error.message, variant: 'destructive' });
      return;
    }
    setPick('');
    await load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('product_recommended_addons').delete().eq('id', id);
    if (error) {
      toast({ title: 'Could not remove', description: error.message, variant: 'destructive' });
      return;
    }
    await load();
  };

  return (
    <div className="space-y-3 rounded-xl border p-3">
      <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        <Sparkles className="h-4 w-4" /> Recommended add-ons (optional)
      </Label>
      <p className="text-[11px] text-muted-foreground">
        Suggested alongside this item. Customers can always decline — this never blocks checkout.
      </p>

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-lg border px-2 py-1.5 text-sm">
              <span>
                <span className="text-muted-foreground">{r.label || 'Goes well with'}: </span>
                {r.product?.name || 'Item'}
              </span>
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(r.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Choose an item" /></SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-9" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Goes well with" />
        <Button type="button" size="sm" className="h-9 gap-1" disabled={!pick || saving} onClick={add}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  );
}
