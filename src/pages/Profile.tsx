import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BottomNav } from '@/components/home/BottomNav';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { CalorieGoalCard } from '@/components/profile/CalorieGoalCard';
import { OrderHistoryCard } from '@/components/profile/OrderHistoryCard';
import { AddressesCard } from '@/components/profile/AddressesCard';
import { FundWalletDialog } from '@/components/profile/FundWalletDialog';
import { ReferralCard } from '@/components/profile/ReferralCard';
import { VirtualAccountCard } from '@/components/profile/VirtualAccountCard';
import { CreateDVADialog } from '@/components/profile/CreateDVADialog';
import { DeleteAccountDialog } from '@/components/shared/DeleteAccountDialog';
import { Leaf, ArrowLeft, Receipt, ChevronRight, Wallet, Plus, Building2, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type Address = Tables<'addresses'>;

export default function Profile() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { balance, hasDVA, dvaDetails, dvaSystemEnabled, profileComplete, isTestMode, refetch: refetchWallet, isDisabled } = useCustomerWallet();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [profile, setProfile] = useState<Profile | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [fundDialogOpen, setFundDialogOpen] = useState(false);
  const [dvaDialogOpen, setDvaDialogOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchProfileData();
    }
  }, [user]);

  const fetchProfileData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Fetch profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      setProfile(profileData);

      // Fetch addresses
      const { data: addressData, error: addressError } = await supabase
        .from('addresses')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false });

      if (addressError) throw addressError;
      setAddresses(addressData || []);
    } catch (error) {
      console.error('Error fetching profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to load profile data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse-soft">
            <Leaf className="w-9 h-9 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">Loading profile...</p>
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
            onClick={() => navigate('/')}
            className="shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold text-foreground">My Profile</h1>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <ProfileHeader
          user={user}
          profile={profile}
          onSignOut={handleSignOut}
        />

        {/* Personal Information */}
        <ProfileForm user={user} profile={profile} onUpdate={fetchProfileData} />

        {/* Wallet Summary Card */}
        <Card className="border-0 shadow-soft bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Wallet Balance</p>
                  <p className="text-2xl font-bold text-foreground">₦{balance.toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setFundDialogOpen(true)}
                  disabled={isDisabled}
                  className="gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Money
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/profile/wallet')}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Virtual Account Info */}
            {!dvaSystemEnabled ? (
              <div className="border-t border-border/50 pt-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-yellow-500" />
                  <span className="text-xs font-medium text-yellow-600">Virtual Account Temporarily Unavailable</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Use the "Add Money" button to fund your wallet via card payment instead.
                </p>
              </div>
            ) : hasDVA && dvaDetails ? (
              <div className="border-t border-border/50 pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Virtual Account</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{dvaDetails.bankName}</span>
                  <span className="font-mono font-bold">{dvaDetails.accountNumber}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{dvaDetails.accountName}</p>
              </div>
            ) : !isTestMode && (
              <div className="border-t border-border/50 pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {profileComplete ? 'Get a virtual account' : 'Complete profile to enable'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      if (profileComplete) {
                        setDvaDialogOpen(true);
                      } else {
                        navigate('/profile-setup', { state: { returnTo: '/profile' } });
                      }
                    }}
                    disabled={isDisabled}
                  >
                    {profileComplete ? 'Get Account' : (
                      <><User className="w-3 h-3 mr-1" /> Update Profile</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transaction History Link */}
        <Card 
          className="border-0 shadow-soft cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => navigate('/profile/transactions')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Receipt className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Transaction History</p>
                  <p className="text-sm text-muted-foreground">View all your transactions</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        {/* Referral Card */}
        <ReferralCard />

        {/* Personal Information */}
        <ProfileForm user={user} profile={profile} onUpdate={fetchProfileData} />


        {/* Health Goals */}
        <CalorieGoalCard profile={profile} onUpdate={fetchProfileData} />

        <AddressesCard
          addresses={addresses}
          userId={user.id}
          onUpdate={fetchProfileData}
        />

        {/* Delete Account */}
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-destructive mb-2">Danger Zone</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Once you delete your account, there is no going back.
            </p>
            <DeleteAccountDialog
              userId={user.id}
              userEmail={user.email || ''}
              onDeleted={handleSignOut}
            />
          </CardContent>
        </Card>
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
        onSuccess={refetchWallet}
      />

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
