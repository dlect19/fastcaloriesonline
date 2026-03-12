import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminRiderDistanceBreakdown } from '@/components/admin/AdminRiderDistanceBreakdown';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, X, Loader2, ShieldCheck, Mail, AlertCircle, FlaskConical, FileImage, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { AdminChangeEmailDialog } from '@/components/admin/AdminChangeEmailDialog';

export default function AdminRiders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const [loading, setLoading] = useState(true);
  const [riders, setRiders] = useState<any[]>([]);
  const [pendingRiders, setPendingRiders] = useState<any[]>([]);
  const [viewingDocument, setViewingDocument] = useState<{ url: string; name: string } | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedRiderUserId, setSelectedRiderUserId] = useState<string | null>(null);
  const [selectedRiderName, setSelectedRiderName] = useState('');

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
      // Fetch rider profiles first
      const { data: riderData } = await supabase
        .from('rider_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      // Get all user_ids from riders
      const userIds = riderData?.map(r => r.user_id) || [];

      // Fetch profile info for each rider
      const { data: profilesData } = userIds.length > 0 
        ? await supabase
            .from('profiles')
            .select('user_id, full_name, phone')
            .in('user_id', userIds)
        : { data: [] };

      // Fetch rider email from rider_profiles (already in riderData)

      // Merge profile info into riders
      const ridersWithProfiles = riderData?.map(rider => ({
        ...rider,
        profile: profilesData?.find(p => p.user_id === rider.user_id) || null
      })) || [];

      const verified = ridersWithProfiles.filter(r => r.is_verified);
      const pending = ridersWithProfiles.filter(r => !r.is_verified);

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
      await supabase.from('rider_profiles').update({ 
        is_verified: true,
        nin_verified: true 
      }).eq('id', riderId);
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

  const toggleTestRider = async (riderId: string, isTestRider: boolean) => {
    try {
      await supabase.from('rider_profiles').update({ is_test_rider: !isTestRider }).eq('id', riderId);
      toast({ title: `Rider marked as ${!isTestRider ? 'test rider' : 'live rider'}` });
      fetchRiders();
    } catch (error) {
      toast({ title: 'Failed to update rider', variant: 'destructive' });
    }
  };

  const maskNIN = (nin: string | null) => {
    if (!nin) return 'Not provided';
    return nin; // Show full NIN to admins
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AdminLayout>
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-foreground">Riders</h1>
            <Badge 
              variant="outline" 
              className={isTestMode 
                ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" 
                : "bg-green-500/10 text-green-600 border-green-500/30"
              }
            >
              {isTestMode ? 'Test Mode' : 'Live Mode'}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Manage delivery riders and verify NIN
            {isTestMode && " • Showing test riders"}
          </p>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending ({pendingRiders.length})</TabsTrigger>
            <TabsTrigger value="approved">Verified ({riders.length})</TabsTrigger>
            <TabsTrigger value="distance">Distance Tracking</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle>Pending Verification</CardTitle>
                <CardDescription>
                  Review rider applications and verify NIN before approval
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pendingRiders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No pending riders</p>
                ) : (
                  <div className="space-y-4">
                    {pendingRiders.map((rider) => (
                      <div key={rider.id} className="border rounded-lg p-4 space-y-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-medium text-lg">{rider.profile?.full_name || 'Unknown'}</h3>
                            <p className="text-sm text-muted-foreground">{rider.profile?.phone || '—'} • {rider.email || '—'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedRiderUserId(rider.user_id);
                                setSelectedRiderName(rider.profile?.full_name || 'Rider');
                                setEmailDialogOpen(true);
                              }}
                            >
                              <Mail className="w-4 h-4 text-primary mr-1" />
                              Change Email
                            </Button>
                            <Button size="sm" onClick={() => approveRider(rider.id)}>
                              <Check className="w-4 h-4 mr-1" />
                              Approve
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

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          {/* Vehicle Info */}
                          <div className="space-y-1">
                            <p className="text-muted-foreground">Vehicle</p>
                            <p className="font-medium">{rider.vehicle_type || 'N/A'} • {rider.vehicle_plate || 'N/A'}</p>
                          </div>

                          {/* NIN Info */}
                          <div className="space-y-1">
                            <p className="text-muted-foreground flex items-center gap-1">
                              <ShieldCheck className="w-4 h-4" />
                              NIN Number
                            </p>
                            <div className="flex items-center gap-2">
                              <p className="font-medium font-mono">{maskNIN(rider.nin_number)}</p>
                              {rider.nin_number ? (
                                <Badge variant="outline" className="text-xs">
                                  {rider.nin_verified ? 'Verified' : 'Pending'}
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">
                                  Missing
                                </Badge>
                              )}
                            </div>
                            {rider.nin_submitted_at && (
                              <p className="text-xs text-muted-foreground">
                                Submitted: {new Date(rider.nin_submitted_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>

                          {/* Email Verification */}
                          <div className="space-y-1">
                            <p className="text-muted-foreground flex items-center gap-1">
                              <Mail className="w-4 h-4" />
                              Email Verified
                            </p>
                            <Badge variant={rider.is_email_verified ? 'default' : 'secondary'}>
                              {rider.is_email_verified ? 'Yes' : 'No'}
                            </Badge>
                          </div>
                        </div>

                        {/* NIN Document */}
                        {rider.id_document_url && (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setViewingDocument({ url: rider.id_document_url, name: rider.profile?.full_name || 'Rider' })}
                            >
                              <FileImage className="w-4 h-4 mr-1" />
                              View NIN Document
                            </Button>
                          </div>
                        )}

                        {/* Warning if NIN not provided */}
                        {!rider.nin_number && (
                          <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4 text-destructive" />
                            <span className="text-destructive">NIN not provided - cannot receive deliveries until verified</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="approved">
            <Card>
              <CardHeader>
                <CardTitle>Verified Riders</CardTitle>
                <CardDescription>Active riders who have been verified and can receive orders</CardDescription>
              </CardHeader>
              <CardContent>
                {riders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No verified riders</p>
                ) : (
                  <div className="space-y-4">
                    {riders.map((rider) => (
                      <div key={rider.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                           <div className="flex items-center gap-2">
                             <h3 className="font-medium">{rider.profile?.full_name || 'Unknown'}</h3>
                             {rider.is_test_rider && (
                               <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                                 <FlaskConical className="w-3 h-3 mr-1" />
                                 Test
                               </Badge>
                             )}
                           </div>
                           <p className="text-sm text-muted-foreground">
                             {rider.profile?.phone || '—'} • {rider.email || '—'}
                           </p>
                           <p className="text-sm text-muted-foreground">
                             {rider.vehicle_type} • {rider.vehicle_plate}
                           </p>
                          <div className="flex items-center gap-4 text-sm">
                            <span>{rider.total_deliveries || 0} deliveries</span>
                            <span>⭐ {rider.rating?.toFixed(1) || '0.0'}</span>
                            <span className="text-muted-foreground font-mono">NIN: {maskNIN(rider.nin_number)}</span>
                            {rider.id_document_url && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs"
                                onClick={() => setViewingDocument({ url: rider.id_document_url, name: rider.profile?.full_name || 'Rider' })}
                              >
                                <Eye className="w-3 h-3 mr-1" />
                                NIN Doc
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedRiderUserId(rider.user_id);
                              setSelectedRiderName(rider.profile?.full_name || 'Rider');
                              setEmailDialogOpen(true);
                            }}
                          >
                            <Mail className="w-4 h-4 text-primary mr-1" />
                            Change Email
                          </Button>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Test Rider</span>
                            <Switch
                              checked={rider.is_test_rider || false}
                              onCheckedChange={() => toggleTestRider(rider.id, rider.is_test_rider || false)}
                            />
                          </div>
                          <Badge variant={rider.is_online ? 'default' : 'secondary'}>
                            {rider.is_online ? 'Online' : 'Offline'}
                          </Badge>
                          {rider.nin_verified && (
                            <Badge variant="outline" className="text-green-600 border-green-500">
                              <ShieldCheck className="w-3 h-3 mr-1" />
                              NIN Verified
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="distance">
            <AdminRiderDistanceBreakdown />
          </TabsContent>
        </Tabs>

        {/* NIN Document Viewer Dialog */}
        <Dialog open={!!viewingDocument} onOpenChange={() => setViewingDocument(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>NIN Document - {viewingDocument?.name}</DialogTitle>
            </DialogHeader>
            {viewingDocument && (
              <div className="space-y-3">
                <img 
                  src={viewingDocument.url} 
                  alt="NIN Document" 
                  className="w-full rounded-lg border border-border"
                />
                <a 
                  href={viewingDocument.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Open in new tab
                </a>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AdminChangeEmailDialog
          open={emailDialogOpen}
          onOpenChange={setEmailDialogOpen}
          userId={selectedRiderUserId}
          userName={selectedRiderName}
        />
      </main>
    </div>
  );
}
