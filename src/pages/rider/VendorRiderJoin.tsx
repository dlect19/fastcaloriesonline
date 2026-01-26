import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Store, Bike } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export default function VendorRiderJoin() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [inviteValid, setInviteValid] = useState(false);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [vendor, setVendor] = useState<{ id: string; name: string; logo_url: string | null } | null>(null);
  const [invite, setInvite] = useState<{ id: string; vendor_id: string } | null>(null);

  useEffect(() => {
    if (!code) {
      navigate('/rider/auth');
      return;
    }
    validateInvite();
  }, [code]);

  const validateInvite = async () => {
    try {
      // Check if invite code exists and is valid
      const { data: inviteData, error: inviteError } = await supabase
        .from('vendor_rider_invites')
        .select('id, vendor_id, is_used, expires_at')
        .eq('invite_code', code)
        .maybeSingle();

      if (inviteError || !inviteData) {
        setInviteValid(false);
        setLoading(false);
        return;
      }

      // Check if expired
      if (inviteData.expires_at && new Date(inviteData.expires_at) < new Date()) {
        setInviteValid(false);
        setLoading(false);
        return;
      }

      // Check if already used
      if (inviteData.is_used) {
        setInviteValid(false);
        setLoading(false);
        return;
      }

      setInvite(inviteData);

      // Get vendor info
      const { data: vendorData } = await supabase
        .from('vendors')
        .select('id, name, logo_url')
        .eq('id', inviteData.vendor_id)
        .single();

      if (vendorData) {
        setVendor(vendorData);
        setInviteValid(true);
      }

      // Check if user is already a rider for this vendor
      if (user) {
        const { data: riderProfile } = await supabase
          .from('rider_profiles')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (riderProfile) {
          const { data: existingLink } = await supabase
            .from('vendor_riders')
            .select('id')
            .eq('vendor_id', inviteData.vendor_id)
            .eq('rider_profile_id', riderProfile.id)
            .maybeSingle();

          if (existingLink) {
            setAlreadyJoined(true);
          }
        }
      }
    } catch (error) {
      console.error('Error validating invite:', error);
      setInviteValid(false);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!user || !invite || !vendor) {
      // Redirect to rider auth with return URL
      navigate(`/rider/auth?redirect=/rider/join/${code}`);
      return;
    }

    setJoining(true);
    try {
      // Get or create rider profile
      let riderProfile;
      const { data: existingProfile } = await supabase
        .from('rider_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingProfile) {
        riderProfile = existingProfile;
      } else {
        // Create rider profile
        const { data: newProfile, error: profileError } = await supabase
          .from('rider_profiles')
          .insert({
            user_id: user.id,
            affiliated_vendor_id: vendor.id,
          })
          .select('id')
          .single();

        if (profileError) throw profileError;
        riderProfile = newProfile;

        // Add rider role
        await supabase.from('user_roles').insert({
          user_id: user.id,
          role: 'rider',
        });
      }

      // Update rider profile with vendor affiliation
      await supabase
        .from('rider_profiles')
        .update({ affiliated_vendor_id: vendor.id })
        .eq('id', riderProfile.id);

      // Create vendor_riders link
      const { error: linkError } = await supabase.from('vendor_riders').insert({
        vendor_id: vendor.id,
        rider_profile_id: riderProfile.id,
        invite_code: code,
        is_active: true,
      });

      if (linkError) throw linkError;

      // Mark invite as used
      await supabase
        .from('vendor_rider_invites')
        .update({
          is_used: true,
          used_by: riderProfile.id,
        })
        .eq('id', invite.id);

      toast({
        title: 'Successfully joined!',
        description: `You are now a delivery rider for ${vendor.name}`,
      });

      navigate('/rider/dashboard');
    } catch (error: any) {
      console.error('Error joining vendor:', error);
      toast({
        title: 'Error joining team',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setJoining(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Validating invite...</p>
        </div>
      </div>
    );
  }

  if (!inviteValid) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-0 shadow-soft">
          <CardContent className="py-12 text-center">
            <XCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Invalid or Expired Invite</h2>
            <p className="text-muted-foreground mb-6">
              This invite link is no longer valid. Please contact the vendor for a new invite.
            </p>
            <Button onClick={() => navigate('/rider/auth')}>
              Go to Rider Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (alreadyJoined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-0 shadow-soft">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-16 h-16 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Already a Team Member</h2>
            <p className="text-muted-foreground mb-6">
              You're already a delivery rider for {vendor?.name}.
            </p>
            <Button onClick={() => navigate('/rider/dashboard')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-0 shadow-soft">
        <CardHeader className="text-center pb-2">
          {vendor?.logo_url ? (
            <img
              src={vendor.logo_url}
              alt={vendor.name}
              className="w-24 h-24 rounded-2xl object-cover mx-auto mb-4"
            />
          ) : (
            <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Store className="w-12 h-12 text-primary" />
            </div>
          )}
          <CardTitle className="text-xl">{vendor?.name}</CardTitle>
          <p className="text-muted-foreground">invites you to join their delivery team</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Bike className="w-5 h-5 text-primary" />
              <span className="text-sm">Deliver orders for {vendor?.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <span className="text-sm">Get priority on their orders</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <span className="text-sm">Track your earnings separately</span>
            </div>
          </div>

          {user ? (
            <Button
              onClick={handleJoin}
              disabled={joining}
              className="w-full gap-2"
              size="lg"
            >
              {joining ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  <Bike className="w-4 h-4" />
                  Join as Rider
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                You need to sign in to join this team
              </p>
              <Button
                onClick={handleJoin}
                className="w-full"
                size="lg"
              >
                Sign In to Continue
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
