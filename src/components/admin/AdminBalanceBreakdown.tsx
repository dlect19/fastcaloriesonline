import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
      const env = isTestMode ? 'development' : 'production';

      // Fetch all wallets
      const { data: wallets } = await supabase
        .from('wallets')
        .select('id, user_id, wallet_type, outlet_id');

      if (!wallets) {
        setLoading(false);
        return;
      }

      // Fetch all transactions for the environment (ledger source of truth).
      // IMPORTANT: paginate to bypass Supabase's default 1000-row cap — otherwise
      // the most recent transactions get silently dropped and balances go stale.
      const PAGE_SIZE = 1000;
      type TxRow = { wallet_id: string | null; category: string | null; transaction_type: string | null; amount: number | string | null; status: string | null; notes: string | null };
      const allTx: TxRow[] = [];
      let from = 0;
      while (true) {
        const { data: page, error: pageErr } = await supabase
          .from('wallet_transactions')
          .select('wallet_id, category, transaction_type, amount, status, notes')
          .eq('environment', env)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (pageErr) { console.error('Tx page error', pageErr); break; }
        if (!page || page.length === 0) break;
        allTx.push(...(page as TxRow[]));
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const txByWallet: Record<string, TxRow[]> = {};
      for (const tx of allTx) {
        if (!tx.wallet_id) continue;
        if (!txByWallet[tx.wallet_id]) txByWallet[tx.wallet_id] = [];
        txByWallet[tx.wallet_id].push(tx);
      }

      // Compute ledger-based balances for vendors
      const computeVendorBalances = (walletId: string) => {
        const txs = txByWallet[walletId] || [];
        let menuCredits = 0, menuDebits = 0, menuPending = 0;
        let riderCredits = 0, riderDebits = 0;
        let menuWithdrawals = 0, riderWithdrawals = 0, reversals = 0;
        let adminDebits = 0, adminCredits = 0, disputeDebits = 0;

        for (const tx of txs) {
          const amt = Number(tx.amount) || 0;
          if (tx.category === 'vendor_share') {
            if (tx.status === 'completed' && tx.transaction_type === 'credit') menuCredits += amt;
            else if (tx.status === 'completed' && tx.transaction_type === 'debit') menuDebits += amt;
            else if (tx.status === 'pending' && tx.transaction_type === 'credit') menuPending += amt;
          } else if (tx.category === 'vendor_rider_share') {
            if (tx.status === 'completed' && tx.transaction_type === 'credit') riderCredits += amt;
            else if (tx.status === 'completed' && tx.transaction_type === 'debit') riderDebits += amt;
          } else if (tx.category === 'withdrawal' && tx.transaction_type === 'debit') {
            if (tx.notes?.includes('Rider Revenue')) riderWithdrawals += amt;
            else menuWithdrawals += amt;
          } else if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit') {
            reversals += amt;
          } else if (tx.category === 'admin_debit' && tx.transaction_type === 'debit') {
            adminDebits += amt;
          } else if (tx.category === 'admin_credit' && tx.transaction_type === 'credit') {
            adminCredits += amt;
          } else if (tx.category === 'dispute_deduction' && tx.transaction_type === 'debit') {
            disputeDebits += amt;
          }
        }

        const menuBalance = menuCredits - menuDebits - menuWithdrawals + reversals - adminDebits + adminCredits - disputeDebits;
        const riderBalance = riderCredits - riderDebits - riderWithdrawals;
        const eligibleBalance = menuBalance + riderBalance;
        const totalEarned = menuCredits - menuDebits + riderCredits - riderDebits;
        return { eligibleBalance, pendingBalance: menuPending, totalEarned };
      };

      // Compute ledger-based balances for riders/logistics
      const computeGenericBalances = (walletId: string) => {
        const txs = txByWallet[walletId] || [];
        let credits = 0, debits = 0;
        for (const tx of txs) {
          const amt = Number(tx.amount) || 0;
          if (tx.transaction_type === 'credit' && tx.status === 'completed') credits += amt;
          else if (tx.transaction_type === 'debit') debits += amt;
        }
        return { eligibleBalance: credits - debits, pendingBalance: 0, totalEarned: credits };
      };

      const vendorWallets = wallets.filter(w => w.wallet_type === 'vendor');
      const riderWallets = wallets.filter(w => w.wallet_type === 'rider');
      const companyWallets = wallets.filter(w => w.wallet_type === 'delivery_company');

      const allUserIds = [...new Set(wallets.map(w => w.user_id))];
      
      const [profilesRes, vendorsRes, companiesRes, outletsRes] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').in('user_id', allUserIds),
        supabase.from('vendors').select('id, user_id, name'),
        supabase.from('delivery_companies').select('id, user_id, name'),
        supabase.from('vendor_outlets').select('id, outlet_name'),
      ]);

      const vBalances: BalanceEntry[] = vendorWallets.map(w => {
        const vendor = vendorsRes.data?.find(v => v.user_id === w.user_id);
        const outlet = w.outlet_id ? outletsRes.data?.find(o => o.id === w.outlet_id) : null;
        const computed = computeVendorBalances(w.id);
        return {
          id: w.id,
          name: vendor?.name || 'Unknown Vendor',
          outletName: outlet?.outlet_name || undefined,
          eligibleBalance: Math.round(computed.eligibleBalance * 100) / 100,
          pendingBalance: Math.round(computed.pendingBalance * 100) / 100,
          totalEarned: Math.round(computed.totalEarned * 100) / 100,
        };
      }).sort((a, b) => b.eligibleBalance - a.eligibleBalance);

      const rBalances: BalanceEntry[] = riderWallets.map(w => {
        const profile = profilesRes.data?.find(p => p.user_id === w.user_id);
        const computed = computeGenericBalances(w.id);
        return {
          id: w.id,
          name: profile?.full_name || 'Unknown Rider',
          eligibleBalance: Math.round(computed.eligibleBalance * 100) / 100,
          pendingBalance: 0,
          totalEarned: Math.round(computed.totalEarned * 100) / 100,
        };
      }).sort((a, b) => b.eligibleBalance - a.eligibleBalance);

      const lBalances: BalanceEntry[] = companyWallets.map(w => {
        const company = companiesRes.data?.find(c => c.user_id === w.user_id);
        const computed = computeGenericBalances(w.id);
        return {
          id: w.id,
          name: company?.name || 'Unknown Company',
          eligibleBalance: Math.round(computed.eligibleBalance * 100) / 100,
          pendingBalance: 0,
          totalEarned: Math.round(computed.totalEarned * 100) / 100,
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
