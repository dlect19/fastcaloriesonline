import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Store, Bike, Truck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface BalanceEntry {
  id: string;
  name: string;
  eligibleBalance: number;
  pendingBalance: number;
  totalEarned: number;
  outletName?: string;
}

interface AdminBalanceBreakdownProps {
  isTestMode: boolean;
}

export function AdminBalanceBreakdown({ isTestMode }: AdminBalanceBreakdownProps) {
  const [vendorBalances, setVendorBalances] = useState<BalanceEntry[]>([]);
  const [riderBalances, setRiderBalances] = useState<BalanceEntry[]>([]);
  const [logisticsBalances, setLogisticsBalances] = useState<BalanceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBalances();
  }, [isTestMode]);

  const fetchBalances = async () => {
    setLoading(true);
    try {
      const balanceField = isTestMode ? 'test_eligible_balance' : 'eligible_balance';
      const totalField = isTestMode ? 'test_balance' : 'total_earned';
      const pendingField = isTestMode ? 'test_pending_balance' : 'pending_balance';

      // Fetch all wallets with balance info
      const { data: wallets } = await supabase
        .from('wallets')
        .select('id, user_id, wallet_type, eligible_balance, test_eligible_balance, total_earned, test_balance, outlet_id');

      if (!wallets) {
        setLoading(false);
        return;
      }

      const vendorWallets = wallets.filter(w => w.wallet_type === 'vendor');
      const riderWallets = wallets.filter(w => w.wallet_type === 'rider');
      const companyWallets = wallets.filter(w => w.wallet_type === 'delivery_company');

      // Collect all user_ids for name resolution
      const allUserIds = [...new Set(wallets.map(w => w.user_id))];
      
      // Fetch profiles, vendors, delivery companies, and outlets in parallel
      const [profilesRes, vendorsRes, companiesRes, outletsRes] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').in('user_id', allUserIds),
        supabase.from('vendors').select('id, user_id, name'),
        supabase.from('delivery_companies').select('id, user_id, name'),
        supabase.from('vendor_outlets').select('id, outlet_name'),
      ]);

      // Build vendor balances
      const vBalances: BalanceEntry[] = vendorWallets.map(w => {
        const vendor = vendorsRes.data?.find(v => v.user_id === w.user_id);
        const outlet = w.outlet_id ? outletsRes.data?.find(o => o.id === w.outlet_id) : null;
        return {
          id: w.id,
          name: vendor?.name || 'Unknown Vendor',
          outletName: outlet?.outlet_name || undefined,
          eligibleBalance: Number(w[balanceField]) || 0,
          pendingBalance: Number(w[pendingField]) || 0,
          totalEarned: Number(w[totalField]) || 0,
        };
      }).sort((a, b) => b.eligibleBalance - a.eligibleBalance);

      // Build rider balances
      const rBalances: BalanceEntry[] = riderWallets.map(w => {
        const profile = profilesRes.data?.find(p => p.user_id === w.user_id);
        return {
          id: w.id,
          name: profile?.full_name || 'Unknown Rider',
          eligibleBalance: Number(w[balanceField]) || 0,
          pendingBalance: Number(w[pendingField]) || 0,
          totalEarned: Number(w[totalField]) || 0,
        };
      }).sort((a, b) => b.eligibleBalance - a.eligibleBalance);

      // Build logistics company balances
      const lBalances: BalanceEntry[] = companyWallets.map(w => {
        const company = companiesRes.data?.find(c => c.user_id === w.user_id);
        return {
          id: w.id,
          name: company?.name || 'Unknown Company',
          eligibleBalance: Number(w[balanceField]) || 0,
          pendingBalance: Number(w[pendingField]) || 0,
          totalEarned: Number(w[totalField]) || 0,
        };
      }).sort((a, b) => b.eligibleBalance - a.eligibleBalance);

      setVendorBalances(vBalances);
      setRiderBalances(rBalances);
      setLogisticsBalances(lBalances);
    } catch (error) {
      console.error('Error fetching balance breakdown:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  if (loading) {
    return <Skeleton className="h-48 rounded-2xl" />;
  }

  const renderTable = (entries: BalanceEntry[], icon: React.ReactNode, emptyLabel: string, showOutlet?: boolean) => {
    if (entries.length === 0) {
      return (
        <Card>
          <CardContent className="p-8 text-center">
            {icon}
            <p className="text-muted-foreground mt-3">No {emptyLabel} with balances</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {showOutlet && <TableHead>Outlet</TableHead>}
                <TableHead className="text-right">Pending Balance</TableHead>
                <TableHead className="text-right">Withdrawable Balance</TableHead>
                <TableHead className="text-right">Total Earned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.name}</TableCell>
                  {showOutlet && <TableCell className="text-muted-foreground">{entry.outletName || 'Main'}</TableCell>}
                  <TableCell className="text-right font-semibold text-warning">
                    {formatCurrency(entry.pendingBalance)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-success">
                    {formatCurrency(entry.eligibleBalance)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(entry.totalEarned)}
                  </TableCell>
                </TableRow>
              ))}
              {entries.length > 1 && (
                <TableRow className="font-bold border-t-2">
                  <TableCell>Total</TableCell>
                  {showOutlet && <TableCell />}
                  <TableCell className="text-right text-warning">
                    {formatCurrency(entries.reduce((s, e) => s + e.pendingBalance, 0))}
                  </TableCell>
                  <TableCell className="text-right text-success">
                    {formatCurrency(entries.reduce((s, e) => s + e.eligibleBalance, 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(entries.reduce((s, e) => s + e.totalEarned, 0))}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  return (
    <Tabs defaultValue="vendors" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="vendors" className="gap-2">
          <Store className="w-4 h-4" />
          Vendors ({vendorBalances.length})
        </TabsTrigger>
        <TabsTrigger value="riders" className="gap-2">
          <Bike className="w-4 h-4" />
          Riders ({riderBalances.length})
        </TabsTrigger>
        <TabsTrigger value="logistics" className="gap-2">
          <Truck className="w-4 h-4" />
          Logistics ({logisticsBalances.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="vendors">
        {renderTable(vendorBalances, <Store className="w-12 h-12 mx-auto text-muted-foreground" />, 'vendors', true)}
      </TabsContent>

      <TabsContent value="riders">
        {renderTable(riderBalances, <Bike className="w-12 h-12 mx-auto text-muted-foreground" />, 'riders')}
      </TabsContent>

      <TabsContent value="logistics">
        {renderTable(logisticsBalances, <Truck className="w-12 h-12 mx-auto text-muted-foreground" />, 'logistics companies')}
      </TabsContent>
    </Tabs>
  );
}
