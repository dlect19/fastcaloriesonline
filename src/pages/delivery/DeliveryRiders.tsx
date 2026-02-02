import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Circle, Star, Package, AlertCircle, CheckCircle2, Copy, QrCode, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DeliverySidebar } from '@/components/delivery/DeliverySidebar';
import { useAuth } from '@/hooks/useAuth';
import { useDeliveryCompany } from '@/hooks/useDeliveryCompany';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface CompanyRider {
  id: string;
  user_id: string;
  is_online: boolean;
  is_verified: boolean;
  rating: number | null;
  total_deliveries: number | null;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  user_name?: string;
  email?: string;
}

export default function DeliveryRiders() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { company, loading: companyLoading } = useDeliveryCompany();
  const [riders, setRiders] = useState<CompanyRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/delivery/auth');
      return;
    }
    if (company) {
      fetchRiders();
      generateInviteCode();
    }
  }, [user, authLoading, company, navigate]);

  const fetchRiders = async () => {
    if (!company) return;

    try {
      const { data: riderProfiles } = await supabase
        .from('rider_profiles')
        .select('*')
        .eq('delivery_company_id', company.id);

      if (riderProfiles) {
        // Get user names for each rider
        const ridersWithNames = await Promise.all(
          riderProfiles.map(async (rider) => {
            const { data: profile } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('user_id', rider.user_id)
              .maybeSingle();

            const { data: authUser } = await supabase.auth.admin.getUserById(rider.user_id).catch(() => ({ data: null }));

            return {
              ...rider,
              user_name: profile?.full_name || 'Unknown Rider',
              email: authUser?.user?.email || '',
            };
          })
        );

        setRiders(ridersWithNames);
      }
    } catch (error) {
      console.error('Error fetching riders:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateInviteCode = () => {
    if (!company) return;
    // Create a unique invite code based on company ID
    const code = `DC-${company.id.substring(0, 8).toUpperCase()}`;
    setInviteCode(code);
  };

  const copyInviteLink = () => {
    const link = `${window.location.origin}/delivery/rider/join/${company?.id}`;
    navigator.clipboard.writeText(link);
    toast({ title: 'Invite link copied!' });
  };

  const removeRider = async (riderId: string) => {
    try {
      const { error } = await supabase
        .from('rider_profiles')
        .update({ delivery_company_id: null })
        .eq('id', riderId);

      if (error) throw error;

      toast({ title: 'Rider removed from company' });
      fetchRiders();
    } catch (error: any) {
      toast({ title: 'Failed to remove rider', description: error.message, variant: 'destructive' });
    }
  };

  if (authLoading || companyLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <DeliverySidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DeliverySidebar companyName={company?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">My Riders</h1>
              <p className="text-muted-foreground">Manage your delivery team</p>
            </div>
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  Invite Rider
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Rider to Join</DialogTitle>
                  <DialogDescription>
                    Share this link with riders to join your delivery company
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Invite Link</Label>
                    <div className="flex gap-2">
                      <Input
                        value={`${window.location.origin}/delivery/rider/join/${company?.id}`}
                        readOnly
                        className="text-sm"
                      />
                      <Button variant="outline" size="icon" onClick={copyInviteLink}>
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-center p-4 bg-muted rounded-lg">
                    <div className="text-center">
                      <QrCode className="w-24 h-24 mx-auto text-muted-foreground" />
                      <p className="text-xs text-muted-foreground mt-2">QR Code coming soon</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Riders who sign up using this link will automatically be added to your company.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <Users className="w-8 h-8 mx-auto text-primary mb-2" />
                  <p className="text-2xl font-bold">{riders.length}</p>
                  <p className="text-sm text-muted-foreground">Total Riders</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <Circle className="w-8 h-8 mx-auto text-success fill-success mb-2" />
                  <p className="text-2xl font-bold">{riders.filter(r => r.is_online).length}</p>
                  <p className="text-sm text-muted-foreground">Online</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto text-success mb-2" />
                  <p className="text-2xl font-bold">{riders.filter(r => r.is_verified).length}</p>
                  <p className="text-sm text-muted-foreground">Verified</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <Package className="w-8 h-8 mx-auto text-accent mb-2" />
                  <p className="text-2xl font-bold">
                    {riders.reduce((sum, r) => sum + (r.total_deliveries || 0), 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Trips</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Riders List */}
          <Card>
            <CardHeader>
              <CardTitle>Riders ({riders.length})</CardTitle>
              <CardDescription>
                All riders affiliated with your company
              </CardDescription>
            </CardHeader>
            <CardContent>
              {riders.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">No Riders Yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Invite riders to join your delivery company
                  </p>
                  <Button onClick={() => setInviteDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Invite Rider
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {riders.map((rider) => (
                    <div key={rider.id} className="p-4 bg-muted/30 rounded-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center relative">
                            <Users className="w-6 h-6 text-primary" />
                            {rider.is_online && (
                              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-success border-2 border-background" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{rider.user_name}</span>
                              {!rider.is_verified && (
                                <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  Pending Verification
                                </Badge>
                              )}
                              {rider.is_verified && (
                                <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Verified
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>{rider.vehicle_type || 'Vehicle not set'}</span>
                              <span>•</span>
                              <span>{rider.total_deliveries || 0} trips</span>
                              {rider.rating && (
                                <>
                                  <span>•</span>
                                  <span className="flex items-center gap-0.5">
                                    <Star className="w-3 h-3 fill-warning text-warning" />
                                    {rider.rating.toFixed(1)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={rider.is_online ? 'default' : 'secondary'}>
                            {rider.is_online ? 'Online' : 'Offline'}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeRider(rider.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
