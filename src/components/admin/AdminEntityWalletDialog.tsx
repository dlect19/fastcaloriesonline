import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TransactionHistory } from '@/components/shared/TransactionHistory';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';

interface AdminEntityWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  walletType: 'vendor' | 'rider' | 'delivery_company';
  entityName: string;
  subLabel?: string;
}

interface WalletRow {
  id: string;
  balance: number;
  test_balance: number;
  eligible_balance: number | null;
  test_eligible_balance: number | null;
  outlet_id: string | null;
  outlet_name?: string;
}

export function AdminEntityWalletDialog({
  open,
  onOpenChange,
  userId,
  walletType,
  entityName,
  subLabel,
}: AdminEntityWalletDialogProps) {
  const { isTestMode } = useEnvironmentConfig();
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    const fetchWallets = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        // Use SECURITY DEFINER RPC so multi-outlet vendors return all wallets reliably
        const { data, error } = await supabase.rpc('admin_get_entity_wallets', {
          _user_id: userId,
          _wallet_type: walletType,
        });

        if (error) throw error;
        if (!data || data.length === 0) {
          setNotFound(true);
          setWallets([]);
          setSelectedWalletId(null);
          return;
        }

        const enriched: WalletRow[] = (data as any[]).map(w => ({
          id: w.id,
          balance: Number(w.balance) || 0,
          test_balance: Number(w.test_balance) || 0,
          eligible_balance: Number(w.eligible_balance) || 0,
          test_eligible_balance: Number(w.test_eligible_balance) || 0,
          outlet_id: w.outlet_id,
          outlet_name: w.outlet_name,
        }));

        const sorted = [...enriched].sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
        setWallets(sorted);
        setSelectedWalletId(sorted[0].id);
      } catch (e) {
        console.error('Failed to load wallet', e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchWallets();
  }, [open, userId, walletType]);


  const wallet = wallets.find(w => w.id === selectedWalletId) || null;
  const live = wallet ? Number(wallet.balance || 0) : 0;
  const test = wallet ? Number(wallet.test_balance || 0) : 0;
  const liveEligible = wallet ? Number(wallet.eligible_balance || 0) : 0;
  const testEligible = wallet ? Number(wallet.test_eligible_balance || 0) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Transaction History
          </DialogTitle>
          <DialogDescription>
            {entityName}{subLabel ? ` • ${subLabel}` : ''} — track all inflow and outflow
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : notFound || !wallet ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No wallet found for this {walletType.replace('_', ' ')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {wallets.length > 1 && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Outlet ({wallets.length} branches)
                </label>
                <Select value={selectedWalletId ?? ''} onValueChange={setSelectedWalletId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select outlet" />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map(w => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.outlet_name || (w.outlet_id ? 'Outlet' : 'Main')} — ₦{Number(w.balance || 0).toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {isTestMode ? 'Test Balance' : 'Live Balance'}
                </p>
                <p className="text-xl font-bold text-primary">
                  ₦{(isTestMode ? test : live).toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Withdrawable
                </p>
                <p className="text-xl font-bold text-success">
                  ₦{(isTestMode ? testEligible : liveEligible).toLocaleString()}
                </p>
              </div>
            </div>

            <TransactionHistory
              walletId={wallet.id}
              title="Transactions"
              showFilters={true}
              limit={100}
              environment={isTestMode ? 'development' : 'production'}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
