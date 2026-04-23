import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TransactionHistory } from '@/components/shared/TransactionHistory';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';

interface AdminEntityWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** auth user id of the entity (vendor.user_id, rider.user_id, delivery_company.user_id) */
  userId: string | null;
  /** Entity wallet_type as stored in wallets.wallet_type */
  walletType: 'vendor' | 'rider' | 'delivery_company';
  /** Display name for the dialog header */
  entityName: string;
  /** Optional sub-label, e.g. role */
  subLabel?: string;
}

interface WalletRow {
  id: string;
  balance: number;
  test_balance: number;
  eligible_balance: number | null;
  test_eligible_balance: number | null;
  pending_balance: number | null;
  test_pending_balance: number | null;
  total_earned: number | null;
  total_withdrawn: number | null;
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
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    const fetchWallet = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const { data, error } = await supabase
          .from('wallets')
          .select('id, balance, test_balance, eligible_balance, test_eligible_balance, pending_balance, test_pending_balance, total_earned, total_withdrawn')
          .eq('user_id', userId)
          .eq('wallet_type', walletType)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setNotFound(true);
          setWallet(null);
        } else {
          setWallet(data as WalletRow);
        }
      } catch (e) {
        console.error('Failed to load wallet', e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchWallet();
  }, [open, userId, walletType]);

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
            {/* Wallet Summary */}
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
