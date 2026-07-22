import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PurchaseSuccessDialog } from '@/components/vouchers/PurchaseSuccessDialog';

export default function MyVouchers() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('voucher_orders')
        .select('*, voucher_categories(name), vendors(name, logo_url), voucher_codes(code)')
        .eq('buyer_user_id', user.id)
        .order('purchased_at', { ascending: false });
      setOrders(data || []);
      setLoading(false);
    };
    load();
  }, []);

  const openVoucher = async (o: any) => {
    const { data: template } = await supabase.from('vendor_templates').select('*').eq('vendor_id', o.vendor_id).maybeSingle();
    setSelected({ order: o, template });
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My vouchers</h1>
        <Link to="/vouchers"><Button variant="outline" size="sm">Browse more</Button></Link>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> :
        orders.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">You haven't purchased any vouchers.</CardContent></Card> :
        <div className="space-y-2">
          {orders.map(o => {
            const expired = new Date(o.expiry_date) < new Date();
            return (
              <Card key={o.id} className="cursor-pointer" onClick={() => openVoucher(o)}>
                <CardContent className="p-4 flex items-center gap-3">
                  {o.vendors?.logo_url && <img src={o.vendors.logo_url} className="w-10 h-10 rounded object-cover" />}
                  <div className="flex-1">
                    <p className="font-semibold">{o.voucher_categories?.name}</p>
                    <p className="text-xs text-muted-foreground">{o.vendors?.name} · ₦{Number(o.amount).toLocaleString()}</p>
                    <p className="text-[11px] text-muted-foreground">Expires {new Date(o.expiry_date).toLocaleDateString()}</p>
                  </div>
                  <Badge variant={expired ? 'secondary' : 'default'}>{expired ? 'Expired' : 'Active'}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      }

      {selected && (
        <PurchaseSuccessDialog
          open={!!selected}
          onClose={() => setSelected(null)}
          data={{
            vendorName: selected.order.vendors?.name || 'Vendor',
            vendorLogoUrl: selected.template?.logo_url || selected.order.vendors?.logo_url,
            categoryName: selected.order.voucher_categories?.name || '',
            code: selected.order.voucher_codes?.code || '',
            expiryDate: selected.order.expiry_date,
            purchasedAt: selected.order.purchased_at,
            backgroundColor: selected.template?.background_color,
            backgroundImageUrl: selected.template?.background_image_url,
            amount: Number(selected.order.amount),
          }}
        />
      )}
    </div>
  );
}
