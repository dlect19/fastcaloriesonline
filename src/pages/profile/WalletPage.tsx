import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BottomNav } from '@/components/home/BottomNav';
import { TransactionHistory } from '@/components/shared/TransactionHistory';
import { FundWalletDialog } from '@/components/profile/FundWalletDialog';
import { VirtualAccountCard } from '@/components/profile/VirtualAccountCard';
import { CreateDVADialog } from '@/components/profile/CreateDVADialog';
import { ArrowLeft, Wallet, Plus, Leaf, AlertCircle, CheckCircle2, Loader2, Building2, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WalletPage() {
  const { user, loading: authLoading } = useAuth();
  const { wallet, balance, loading: walletLoading, isDisabled, hasDVA, dvaDetails, profileComplete, isTestMode, refetch } = useCustomerWallet();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [fundDialogOpen, setFundDialogOpen] = useState(false);
  const [dvaDialogOpen, setDvaDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const [verifying, setVerifying] = useState(false);
  const verificationAttempted = useRef(false);

  // Handle Paystack callback - verify payment reference
  useEffect(() => {
    const verifyPayment = async () => {
      // Check for Paystack reference in URL (trxref or reference)
      const reference = searchParams.get('trxref') || searchParams.get('reference');
      
      if (!reference || verificationAttempted.current) return;
      
      verificationAttempted.current = true;
      setVerifying(true);
      
      try {
        const { data, error } = await supabase.functions.invoke('verify-wallet-funding', {
          body: { reference },
        });

        if (error) throw error;

        if (data?.success) {
          toast({
            title: 'Wallet Funded!',
            description: data.message || 'Your wallet has been credited successfully.',
          });
          refetch();
        } else if (data?.error) {
          toast({
            title: 'Verification Issue',
            description: data.error,
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Error verifying payment:', error);
        toast({
          title: 'Verification Failed',
          description: error instanceof Error ? error.message : 'Could not verify payment',
          variant: 'destructive',
        });
      } finally {
        setVerifying(false);
        // Clear URL parameters
        setSearchParams({});
      }
    };

    if (user && !authLoading) {
      verifyPayment();
    }
  }, [searchParams, setSearchParams, toast, refetch, user, authLoading]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  if (authLoading || walletLoading || verifying) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse-soft">
            {verifying ? (
              <Loader2 className="w-9 h-9 text-primary-foreground animate-spin" />
            ) : (
              <Leaf className="w-9 h-9 text-primary-foreground" />
            )}
          </div>
          <p className="text-muted-foreground">
            {verifying ? 'Verifying payment...' : 'Loading wallet...'}
          </p>
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


        {/* Virtual Account Section */}
        {hasDVA && dvaDetails ? (
          <VirtualAccountCard
            bankName={dvaDetails.bankName}
            accountNumber={dvaDetails.accountNumber}
            accountName={dvaDetails.accountName}
            onRefresh={refetch}
          />
        ) : (
          <Card className="border-0 shadow-soft">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Virtual Account</p>
                    <p className="text-sm text-muted-foreground">
                      {isTestMode 
                        ? 'Only available in production mode'
                        : profileComplete 
                          ? 'Get a bank account to fund wallet' 
                          : 'Complete profile to enable'}
                    </p>
                  </div>
                </div>
                {isTestMode ? (
                  <Button variant="outline" size="sm" disabled>
                    Test Mode
                  </Button>
                ) : (
                  <Button
                    variant={profileComplete ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      if (profileComplete) {
                        setDvaDialogOpen(true);
                      } else {
                        navigate('/profile');
                      }
                    }}
                    disabled={isDisabled}
                  >
                    {profileComplete ? 'Get Account' : (
                      <>
                        <User className="w-4 h-4 mr-1" />
                        Update Profile
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Info */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-0 shadow-soft">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-primary" />
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

      {/* Create DVA Dialog */}
      <CreateDVADialog
        open={dvaDialogOpen}
        onOpenChange={setDvaDialogOpen}
        profileComplete={profileComplete}
        onSuccess={refetch}
      />

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
