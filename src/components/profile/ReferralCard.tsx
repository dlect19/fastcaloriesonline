import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Share2, Users, Gift, Clock, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

interface ReferralStats {
  referralCode: string;
  totalReferrals: number;
  pendingReferrals: number;
  completedReferrals: number;
  totalEarned: number;
  referralBonusBalance: number;
}

export function ReferralCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) fetchStats();
  }, [user]);

  const fetchStats = async () => {
    if (!user) return;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, referral_code')
        .eq('user_id', user.id)
        .single();

      if (!profile) return;

      const { data: referrals } = await supabase
        .from('referrals')
        .select('status, referrer_bonus')
        .eq('referrer_id', profile.id);

      const { data: wallet } = await supabase
        .from('wallets')
        .select('referral_bonus_balance, test_referral_bonus_balance')
        .eq('user_id', user.id)
        .eq('wallet_type', 'customer')
        .single();

      const completed = referrals?.filter(r => r.status === 'completed') || [];
      const pending = referrals?.filter(r => r.status === 'pending') || [];

      setStats({
        referralCode: profile.referral_code || '',
        totalReferrals: referrals?.length || 0,
        pendingReferrals: pending.length,
        completedReferrals: completed.length,
        totalEarned: completed.reduce((sum, r) => sum + Number(r.referrer_bonus), 0),
        referralBonusBalance: Number(wallet?.referral_bonus_balance) || Number(wallet?.test_referral_bonus_balance) || 0,
      });
    } catch (err) {
      console.error('Error fetching referral stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!stats?.referralCode) return;
    await navigator.clipboard.writeText(stats.referralCode);
    setCopied(true);
    toast({ title: 'Copied!', description: 'Referral code copied to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!stats?.referralCode) return;
    const shareUrl = `${window.location.origin}/auth?ref=${stats.referralCode}`;
    const text = `Join Fast Calories and get a bonus on your first order! Use my referral code: ${stats.referralCode}`;
    
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Fast Calories Referral', text, url: shareUrl });
      } catch {}
    } else {
      await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
      toast({ title: 'Link copied!', description: 'Share link copied to clipboard' });
    }
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-soft">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!stats?.referralCode) return null;

  return (
    <Card className="border-0 shadow-soft bg-gradient-to-br from-primary/10 to-accent/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gift className="w-5 h-5 text-primary" />
          Refer & Earn
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Referral Code */}
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-background border border-border rounded-lg px-4 py-2.5 font-mono font-bold text-lg tracking-wider text-center">
            {stats.referralCode}
          </div>
          <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </Button>
          <Button size="icon" onClick={handleShare} className="shrink-0">
            <Share2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-background/60">
            <Users className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
            <p className="text-lg font-bold">{stats.totalReferrals}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-background/60">
            <Clock className="w-4 h-4 mx-auto text-orange-500 mb-1" />
            <p className="text-lg font-bold">{stats.pendingReferrals}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-background/60">
            <Gift className="w-4 h-4 mx-auto text-green-500 mb-1" />
            <p className="text-lg font-bold">₦{stats.totalEarned.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Earned</p>
          </div>
        </div>

        {stats.referralBonusBalance > 0 && (
          <div className="flex items-center justify-between bg-green-500/10 rounded-lg px-3 py-2">
            <span className="text-sm text-green-700">Referral Bonus Balance</span>
            <Badge variant="secondary" className="bg-green-500/20 text-green-700">
              ₦{stats.referralBonusBalance.toLocaleString()}
            </Badge>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Share your code with friends. You both earn when they place their first order!
        </p>
      </CardContent>
    </Card>
  );
}
