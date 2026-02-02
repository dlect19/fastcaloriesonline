import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Truck, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

export default function DeliveryRiderJoin() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId) {
      fetchCompany();
    }
  }, [companyId]);

  useEffect(() => {
    if (!authLoading && !user) {
      // Redirect to rider auth with return URL
      navigate(`/rider/auth?redirect=/delivery/rider/join/${companyId}`);
    }
  }, [user, authLoading, companyId, navigate]);

  const fetchCompany = async () => {
    try {
      const { data, error } = await supabase
        .from('delivery_companies')
        .select('*')
        .eq('id', companyId)
        .single();

      if (error) throw error;

      if (!data) {
        setError('Delivery company not found');
        return;
      }

      setCompany(data);

      // Check if user is already a member
      if (user) {
        const { data: riderProfile } = await supabase
          .from('rider_profiles')
          .select('delivery_company_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (riderProfile?.delivery_company_id === companyId) {
          setJoined(true);
        }
      }
    } catch (error: any) {
      console.error('Error fetching company:', error);
      setError('Failed to load company details');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!user || !companyId) return;

    setJoining(true);
    try {
      // Check if user has rider role
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (!roles?.some(r => r.role === 'rider')) {
        toast({
          title: 'Not a rider',
          description: 'You need to register as a rider first.',
          variant: 'destructive',
        });
        navigate(`/rider/auth?redirect=/delivery/rider/join/${companyId}`);
        return;
      }

      // Check if already in another delivery company
      const { data: riderProfile } = await supabase
        .from('rider_profiles')
        .select('delivery_company_id, affiliated_vendor_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (riderProfile?.delivery_company_id && riderProfile.delivery_company_id !== companyId) {
        toast({
          title: 'Already in a company',
          description: 'You are already affiliated with another delivery company.',
          variant: 'destructive',
        });
        return;
      }

      // Update rider profile to join this company
      const { error } = await supabase
        .from('rider_profiles')
        .update({ delivery_company_id: companyId })
        .eq('user_id', user.id);

      if (error) throw error;

      setJoined(true);
      toast({ title: 'Successfully joined!', description: `You are now part of ${company?.name}` });
    } catch (error: any) {
      toast({ title: 'Failed to join', description: error.message, variant: 'destructive' });
    } finally {
      setJoining(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="w-16 h-16 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Error</h2>
            <p className="text-muted-foreground text-center">{error}</p>
            <Button className="mt-4" onClick={() => navigate('/rider/dashboard')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <img src={fastCaloriesLogo} alt="Fast Calories" className="w-16 h-16 object-contain" />
              <div className="absolute -bottom-1 -right-1 bg-primary rounded-full p-1">
                <Truck className="w-4 h-4 text-primary-foreground" />
              </div>
            </div>
          </div>
          <CardTitle className="text-2xl">Join Delivery Company</CardTitle>
          <CardDescription>
            {company?.name} has invited you to join their delivery team
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Company Info */}
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <h3 className="font-semibold text-lg">{company?.name}</h3>
            {company?.city && company?.state && (
              <p className="text-sm text-muted-foreground">
                📍 {company.city}, {company.state}
              </p>
            )}
            {company?.is_verified && (
              <div className="flex items-center gap-1 text-sm text-success">
                <CheckCircle2 className="w-4 h-4" />
                Verified Company
              </div>
            )}
          </div>

          {/* Action */}
          {joined ? (
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-success">
                <CheckCircle2 className="w-6 h-6" />
                <span className="font-medium">You've joined {company?.name}!</span>
              </div>
              <Button onClick={() => navigate('/rider/dashboard')} className="w-full">
                Go to Dashboard
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                By joining, your delivery earnings will be managed by this company.
                You will receive assignments through the platform.
              </p>
              <Button 
                onClick={handleJoin} 
                className="w-full" 
                size="lg"
                disabled={joining}
              >
                {joining ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Join {company?.name}
              </Button>
              <Button 
                variant="outline" 
                className="w-full" 
                onClick={() => navigate('/rider/dashboard')}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
