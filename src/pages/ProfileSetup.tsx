import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { User, Phone, Leaf } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function ProfileSetup() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const returnTo = (location.state as any)?.returnTo || '/';

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }

    if (user) {
      // Pre-fill existing data
      const fetchProfile = async () => {
        const { data } = await supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('user_id', user.id)
          .maybeSingle();

        if (data) {
          if (data.full_name) setFullName(data.full_name);
          if (data.phone) setPhone(data.phone);

          // If already complete (full name with first & last, and phone), redirect
          const isComplete = data.full_name?.trim()?.includes(' ') && data.phone?.trim();
          if (isComplete) {
            navigate(returnTo, { replace: true });
          }
        }
      };
      fetchProfile();
    }
  }, [user, authLoading, navigate, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim() || !phone.trim()) {
      toast({
        title: 'Required fields',
        description: 'Please fill in both your full name and phone number.',
        variant: 'destructive',
      });
      return;
    }

    if (!/^[0-9+\-\s()]{7,15}$/.test(phone.trim())) {
      toast({
        title: 'Invalid phone number',
        description: 'Please enter a valid phone number.',
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in again to complete your profile.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const trimmedFullName = fullName.trim();
      const trimmedPhone = phone.trim();

      const { data: savedProfile, error } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: user.id,
            full_name: trimmedFullName,
            phone: trimmedPhone,
          },
          { onConflict: 'user_id' }
        )
        .select('id')
        .single();

      if (error) throw error;
      if (!savedProfile?.id) throw new Error('Failed to save profile record');

      // Link referral if stored
      const storedReferralCode = localStorage.getItem('fc_referral_code');
      const storedReferralType = localStorage.getItem('fc_referral_type');
      const storedAmbassadorId = localStorage.getItem('fc_ambassador_id');
      
      if (storedReferralCode) {
        try {
          if (storedReferralType === 'ambassador' && storedAmbassadorId) {
            // Ambassador/influencer referral — link to ambassador
            // Update profile with ambassador reference
            await supabase
              .from('profiles')
              .update({ referred_by: savedProfile.id }) // self-ref placeholder; ambassador tracked separately
              .eq('id', savedProfile.id);

            // Ensure ambassador registration exists
            const { data: existingReg } = await supabase
              .from('ambassador_registrations')
              .select('id')
              .eq('ambassador_id', storedAmbassadorId)
              .eq('user_id', user.id)
              .maybeSingle();

            if (!existingReg) {
              await supabase.from('ambassador_registrations').insert({
                ambassador_id: storedAmbassadorId,
                user_id: user.id,
                promo_code_used: storedReferralCode,
              });
            }

            // Update ambassador performance count
            const { data: existingPerf } = await supabase
              .from('ambassador_performance')
              .select('id, total_registrations')
              .eq('ambassador_id', storedAmbassadorId)
              .maybeSingle();

            if (existingPerf) {
              await supabase
                .from('ambassador_performance')
                .update({ total_registrations: (existingPerf.total_registrations || 0) + 1, updated_at: new Date().toISOString() })
                .eq('id', existingPerf.id);
            } else {
              await supabase.from('ambassador_performance').insert({
                ambassador_id: storedAmbassadorId,
                total_registrations: 1,
                total_orders: 0,
                total_revenue: 0,
              });
            }
          } else {
            // Customer referral code
            const { data: referrerProfile } = await supabase
              .from('profiles')
              .select('id')
              .ilike('referral_code', storedReferralCode)
              .single();

            if (referrerProfile && referrerProfile.id !== savedProfile.id) {
              await supabase
                .from('profiles')
                .update({ referred_by: referrerProfile.id })
                .eq('id', savedProfile.id);

              await supabase.from('referrals').insert({
                referrer_id: referrerProfile.id,
                referred_id: savedProfile.id,
                status: 'pending',
              });
            }
          }
          
          localStorage.removeItem('fc_referral_code');
          localStorage.removeItem('fc_referral_type');
          localStorage.removeItem('fc_ambassador_id');
        } catch (refErr) {
          console.error('Failed to link referral:', refErr);
        }
      }

      toast({
        title: 'Profile updated!',
        description: 'Your profile has been set up successfully.',
      });

      navigate(returnTo, { replace: true });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update profile',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
            <Leaf className="w-9 h-9 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardHeader className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Complete Your Profile</CardTitle>
          <CardDescription>
            Please provide your full name and phone number to continue using the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="fullName"
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="pl-10"
                  required
                  maxLength={100}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="phone"
                  placeholder="08012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="pl-10"
                  required
                  maxLength={15}
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-12" disabled={loading}>
              {loading ? 'Saving...' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
