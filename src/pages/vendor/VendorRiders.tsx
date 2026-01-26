import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Copy, QrCode, RefreshCw, Trash2, Circle, Bike } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import QRCode from 'qrcode';

interface VendorRider {
  id: string;
  rider_profile_id: string;
  is_active: boolean;
  created_at: string;
  rider_profile: {
    id: string;
    is_online: boolean;
    is_verified: boolean;
    rating: number | null;
    total_deliveries: number | null;
    vehicle_type: string | null;
    user_id: string;
  };
  user_name?: string;
}

interface RiderInvite {
  id: string;
  invite_code: string;
  is_used: boolean;
  expires_at: string | null;
  created_at: string;
}

export default function VendorRiders() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const [riders, setRiders] = useState<VendorRider[]>([]);
  const [invites, setInvites] = useState<RiderInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [currentInviteLink, setCurrentInviteLink] = useState('');

  const previewUrl = 'https://id-preview--35bd9daf-0ce9-4743-a361-ec2d45be6932.lovable.app';

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      const { data: vendorResults } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const vendorData = vendorResults?.[0] || null;
      setVendor(vendorData);

      if (vendorData) {
        // Fetch vendor's riders
        const { data: ridersData } = await supabase
          .from('vendor_riders')
          .select(`
            id,
            rider_profile_id,
            is_active,
            created_at,
            rider_profile:rider_profiles(
              id,
              is_online,
              is_verified,
              rating,
              total_deliveries,
              vehicle_type,
              user_id
            )
          `)
          .eq('vendor_id', vendorData.id)
          .order('created_at', { ascending: false });

        // Get profile names for each rider
        const ridersWithNames = await Promise.all(
          (ridersData || []).map(async (rider: any) => {
            if (rider.rider_profile?.user_id) {
              const { data: profile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('user_id', rider.rider_profile.user_id)
                .maybeSingle();
              return { ...rider, user_name: profile?.full_name || 'Unknown Rider' };
            }
            return { ...rider, user_name: 'Unknown Rider' };
          })
        );

        setRiders(ridersWithNames);

        // Fetch pending invites
        const { data: invitesData } = await supabase
          .from('vendor_rider_invites')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .eq('is_used', false)
          .order('created_at', { ascending: false });

        setInvites(invitesData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateInviteCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleGenerateInvite = async () => {
    if (!vendor) return;

    setGenerating(true);
    try {
      const code = generateInviteCode();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

      const { error } = await supabase.from('vendor_rider_invites').insert({
        vendor_id: vendor.id,
        invite_code: code,
        expires_at: expiresAt.toISOString(),
      });

      if (error) throw error;

      toast({ title: 'Invite code generated!' });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error generating invite',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const copyInviteLink = async (code: string) => {
    const link = `${previewUrl}/rider/join/${code}`;
    await navigator.clipboard.writeText(link);
    toast({ title: 'Invite link copied!' });
  };

  const showQRCode = async (code: string) => {
    const link = `${previewUrl}/rider/join/${code}`;
    setCurrentInviteLink(link);
    try {
      const qr = await QRCode.toDataURL(link, { width: 300, margin: 2 });
      setQrCodeUrl(qr);
      setQrDialogOpen(true);
    } catch (error) {
      console.error('Error generating QR code:', error);
    }
  };

  const deleteInvite = async (inviteId: string) => {
    try {
      const { error } = await supabase
        .from('vendor_rider_invites')
        .delete()
        .eq('id', inviteId);

      if (error) throw error;

      toast({ title: 'Invite deleted' });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error deleting invite',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const toggleRiderStatus = async (riderId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('vendor_riders')
        .update({ is_active: !currentStatus })
        .eq('id', riderId);

      if (error) throw error;

      toast({ title: `Rider ${!currentStatus ? 'activated' : 'deactivated'}` });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error updating rider',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const onlineRidersCount = riders.filter(r => r.rider_profile?.is_online && r.is_active).length;

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar />
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
      <VendorSidebar vendorName={vendor?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">My Riders</h1>
              <p className="text-muted-foreground">Manage your delivery team</p>
            </div>
            <Button onClick={handleGenerateInvite} disabled={generating} className="gap-2 w-fit">
              <Plus className="w-4 h-4" />
              {generating ? 'Generating...' : 'Generate Invite'}
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-0 shadow-soft">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{riders.length}</p>
                    <p className="text-xs text-muted-foreground">Total Riders</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-soft">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                    <Circle className="w-5 h-5 text-green-500 fill-green-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{onlineRidersCount}</p>
                    <p className="text-xs text-muted-foreground">Online Now</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-soft">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <RefreshCw className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{invites.length}</p>
                    <p className="text-xs text-muted-foreground">Pending Invites</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-soft">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                    <Bike className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {riders.reduce((sum, r) => sum + (r.rider_profile?.total_deliveries || 0), 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Deliveries</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pending Invites */}
          {invites.length > 0 && (
            <Card className="border-0 shadow-soft">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <RefreshCw className="w-5 h-5" />
                  Pending Invites
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-xl"
                  >
                    <div>
                      <span className="font-mono font-bold">{invite.invite_code}</span>
                      {invite.expires_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Expires: {new Date(invite.expires_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyInviteLink(invite.invite_code)}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => showQRCode(invite.invite_code)}
                      >
                        <QrCode className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteInvite(invite.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Riders List */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" />
                Your Riders
              </CardTitle>
            </CardHeader>
            <CardContent>
              {riders.length === 0 ? (
                <div className="py-8 text-center">
                  <Bike className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">No riders yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Generate an invite code to add your first delivery rider
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {riders.map((rider) => (
                    <div
                      key={rider.id}
                      className="flex items-center justify-between p-4 bg-muted/30 rounded-xl"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bike className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{rider.user_name}</span>
                            {rider.rider_profile?.is_online && rider.is_active && (
                              <span className="flex items-center gap-1 text-xs text-green-500">
                                <Circle className="w-2 h-2 fill-current" />
                                Online
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{rider.rider_profile?.vehicle_type || 'Vehicle not set'}</span>
                            <span>•</span>
                            <span>{rider.rider_profile?.total_deliveries || 0} deliveries</span>
                            {rider.rider_profile?.rating && (
                              <>
                                <span>•</span>
                                <span>★ {rider.rider_profile.rating.toFixed(1)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={rider.is_active ? 'default' : 'secondary'}>
                          {rider.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleRiderStatus(rider.id, rider.is_active)}
                        >
                          {rider.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rider Invite QR Code</DialogTitle>
            <DialogDescription>
              Share this QR code with your rider to join your team
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrCodeUrl && (
              <img src={qrCodeUrl} alt="Invite QR Code" className="w-64 h-64" />
            )}
            <p className="text-xs text-muted-foreground text-center break-all">
              {currentInviteLink}
            </p>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => navigator.clipboard.writeText(currentInviteLink)}
            >
              <Copy className="w-4 h-4" />
              Copy Link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
