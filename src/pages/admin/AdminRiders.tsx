import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, X, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AdminRiders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [riders, setRiders] = useState<any[]>([]);
  const [pendingRiders, setPendingRiders] = useState<any[]>([]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/admin/auth');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) {
      navigate('/admin/auth');
      return;
    }

    await fetchRiders();
  };

  const fetchRiders = async () => {
    try {
      const { data: all } = await supabase
        .from('rider_profiles')
        .select('*, profiles!rider_profiles_user_id_fkey(full_name, phone)')
        .order('created_at', { ascending: false });

      const verified = all?.filter(r => r.is_verified) || [];
      const pending = all?.filter(r => !r.is_verified) || [];

      setRiders(verified);
      setPendingRiders(pending);
    } catch (error) {
      console.error('Error fetching riders:', error);
    } finally {
      setLoading(false);
    }
  };

  const approveRider = async (riderId: string) => {
    try {
      await supabase.from('rider_profiles').update({ is_verified: true }).eq('id', riderId);
      toast({ title: 'Rider approved successfully' });
      fetchRiders();
    } catch (error) {
      toast({ title: 'Failed to approve rider', variant: 'destructive' });
    }
  };

  const rejectRider = async (riderId: string, userId: string) => {
    try {
      await supabase.from('rider_profiles').delete().eq('id', riderId);
      await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'rider');
      toast({ title: 'Rider rejected' });
      fetchRiders();
    } catch (error) {
      toast({ title: 'Failed to reject rider', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />
      
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Riders</h1>
          <p className="text-muted-foreground">Manage delivery riders</p>
        </div>

        <Tabs defaultValue="approved">
          <TabsList>
            <TabsTrigger value="approved">Verified ({riders.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({pendingRiders.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="approved">
            <Card>
              <CardHeader>
                <CardTitle>Verified Riders</CardTitle>
              </CardHeader>
              <CardContent>
                {riders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No verified riders</p>
                ) : (
                  <div className="space-y-4">
                    {riders.map((rider) => (
                      <div key={rider.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium">{rider.profiles?.full_name || 'Unknown'}</h3>
                          <p className="text-sm text-muted-foreground">
                            {rider.vehicle_type} • {rider.vehicle_plate}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {rider.total_deliveries} deliveries • ⭐ {rider.rating?.toFixed(1) || '0.0'}
                          </p>
                        </div>
                        <Badge variant={rider.is_online ? 'default' : 'secondary'}>
                          {rider.is_online ? 'Online' : 'Offline'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle>Pending Verification</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingRiders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No pending riders</p>
                ) : (
                  <div className="space-y-4">
                    {pendingRiders.map((rider) => (
                      <div key={rider.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium">{rider.profiles?.full_name || 'Unknown'}</h3>
                          <p className="text-sm text-muted-foreground">
                            {rider.vehicle_type} • {rider.vehicle_plate}
                          </p>
                          <p className="text-sm text-muted-foreground">{rider.profiles?.phone}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => approveRider(rider.id)}>
                            <Check className="w-4 h-4 mr-1" />
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => rejectRider(rider.id, rider.user_id)}
                          >
                            <X className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
