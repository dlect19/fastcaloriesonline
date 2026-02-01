import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BottomNav } from '@/components/home/BottomNav';
import { TransactionHistory } from '@/components/shared/TransactionHistory';
import { FundWalletDialog } from '@/components/profile/FundWalletDialog';
import { ArrowLeft, Wallet, Plus, Leaf, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WalletPage() {
  const { user, loading: authLoading } = useAuth();
  const { wallet, balance, loading: walletLoading, isDisabled, refetch } = useCustomerWallet();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [fundDialogOpen, setFundDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  // Handle funding success callback
  useEffect(() => {
    const fundingStatus = searchParams.get('funding');
    if (fundingStatus === 'success') {
      toast({
        title: 'Wallet Funded!',
        description: 'Your wallet has been credited successfully.',
      });
      // Clear the URL parameter
      setSearchParams({});
      // Refresh wallet balance
      refetch();
    }
  }, [searchParams, setSearchParams, toast, refetch]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  if (authLoading || walletLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse-soft">
            <Leaf className="w-9 h-9 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">Loading wallet...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container flex items-center gap-4 py-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/profile')}
            className="shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold text-foreground">My Wallet</h1>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* Disabled Wallet Alert */}
        {isDisabled && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your wallet has been disabled. Please contact support for assistance.
            </AlertDescription>
          </Alert>
        )}

        {/* Balance Card */}
        <Card className="border-0 shadow-soft bg-gradient-to-br from-primary/10 to-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-medium text-muted-foreground">
              <Wallet className="w-5 h-5" />
              Wallet Balance
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-4xl font-bold text-foreground">
                  ₦{balance.toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Available for orders
                </p>
              </div>
              <Button
                onClick={() => setFundDialogOpen(true)}
                disabled={isDisabled}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Money
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick Info */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-0 shadow-soft">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-medium text-sm">
                  {isDisabled ? 'Disabled' : 'Active'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-soft">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="font-medium text-sm">Customer</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transaction History */}
        {wallet && (
          <TransactionHistory walletId={wallet.id} title="Transaction History" />
        )}
      </main>

      {/* Fund Wallet Dialog */}
      <FundWalletDialog
        open={fundDialogOpen}
        onOpenChange={setFundDialogOpen}
      />

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
