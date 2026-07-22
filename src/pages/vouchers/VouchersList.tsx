import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Row {
  id: string;
  name: string;
  validity_days: number;
  vendor_id: string;
  vendor_name: string;
  vendor_logo: string | null;
  available_count: number;
  min_value: number;
}

export default function VouchersList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: cats } = await supabase
        .from('voucher_categories')
        .select('id, name, validity_days, vendor_id, vendors(name, logo_url)')
        .eq('is_active', true);
      const items = (cats || []) as any[];
      const withStock = await Promise.all(items.map(async (c) => {
        const { data: codes } = await supabase
          .from('voucher_codes')
          .select('value')
          .eq('category_id', c.id)
          .eq('status', 'available');
        const values = (codes || []).map((x: any) => Number(x.value));
        return {
          id: c.id, name: c.name, validity_days: c.validity_days, vendor_id: c.vendor_id,
          vendor_name: c.vendors?.name || 'Vendor', vendor_logo: c.vendors?.logo_url || null,
          available_count: values.length,
          min_value: values.length ? Math.min(...values) : 0,
        };
      }));
      setRows(withStock.filter(r => r.available_count > 0));
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Ticket className="w-6 h-6" /> Voucher Hub</h1>
          <p className="text-sm text-muted-foreground">Buy data, WiFi and digital vouchers in-app.</p>
        </div>
        <Link to="/vouchers/my"><Button variant="outline" size="sm">My vouchers</Button></Link>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> :
        rows.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No vouchers available right now.</CardContent></Card> :
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(r => (
            <Link key={r.id} to={`/vouchers/${r.id}`}>
              <Card className="hover:shadow-md transition cursor-pointer">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    {r.vendor_logo && <img src={r.vendor_logo} alt="" className="w-8 h-8 rounded object-cover" />}
                    <span className="text-xs text-muted-foreground">{r.vendor_name}</span>
                  </div>
                  <h3 className="font-semibold">{r.name}</h3>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-primary">From ₦{r.min_value.toLocaleString()}</span>
                    <Badge variant="secondary">{r.available_count} in stock</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Valid for {r.validity_days} days after purchase</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      }
    </div>
  );
}
