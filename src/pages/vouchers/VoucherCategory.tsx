import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { PurchaseSuccessDialog } from '@/components/vouchers/PurchaseSuccessDialog';

export default function VoucherCategory() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [category, setCategory] = useState<any>(null);
  const [availableCount, setAvailableCount] = useState(0);
  const [values, setValues] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [purchase, setPurchase] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('voucher_categories')
      .select('*, vendors(id, name, logo_url)')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => setCategory(data));
    supabase.from('voucher_codes').select('value').eq('category_id', id).eq('status', 'available')
      .then(({ data }) => {
        const arr = (data || []).map((x: any) => Number(x.value));
        setAvailableCount(arr.length);
        setValues([...new Set(arr)].sort((a, b) => a - b));
      });
  }, [id]);

  useEffect(() => {
    if (!category?.vendor_id) return;
    supabase.from('vendor_templates').select('*').eq('vendor_id', category.vendor_id).maybeSingle()
      .then(({ data }) => setTemplate(data));
  }, [category?.vendor_id]);

  const buy = async () => {
    if (!user) { navigate('/auth'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-voucher', { body: { categoryId: id } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setPurchase(data);
    } catch (err: any) {
      toast({ title: 'Purchase failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!category) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Link to="/vouchers" className="text-sm text-muted-foreground">← Back</Link>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            {category.vendors?.logo_url && <img src={category.vendors.logo_url} className="w-12 h-12 rounded object-cover" />}
            <div>
              <p className="text-xs text-muted-foreground">{category.vendors?.name}</p>
              <CardTitle>{category.name}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Valid for <strong>{category.validity_days} days</strong> after purchase.</p>
          <Badge variant="secondary">{availableCount} in stock</Badge>
          {values.length > 0 && (
            <div className="text-sm">
              <p className="font-medium mb-1">Available denominations:</p>
              <div className="flex flex-wrap gap-2">
                {values.map(v => <Badge key={v} variant="outline">₦{v.toLocaleString()}</Badge>)}
              </div>
              <p className="text-xs text-muted-foreground mt-2">A random available code will be assigned.</p>
            </div>
          )}
          <Button className="w-full" disabled={busy || availableCount === 0} onClick={buy}>
            {busy ? 'Processing…' : availableCount === 0 ? 'Out of stock' : 'Buy from wallet'}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">Payment is deducted from your FastCalories wallet.</p>
        </CardContent>
      </Card>

      {purchase && (
        <PurchaseSuccessDialog
          open={!!purchase}
          onClose={() => { setPurchase(null); navigate('/vouchers/my'); }}
          data={{
            vendorName: category.vendors?.name || 'Vendor',
            vendorLogoUrl: template?.logo_url || category.vendors?.logo_url || null,
            categoryName: category.name,
            code: purchase.code,
            expiryDate: purchase.expiry_date,
            purchasedAt: purchase.order.purchased_at,
            backgroundColor: template?.background_color,
            backgroundImageUrl: template?.background_image_url,
            amount: Number(purchase.order.amount),
          }}
          orderId={purchase.order.id}
        />
      )}
    </div>
  );
}
