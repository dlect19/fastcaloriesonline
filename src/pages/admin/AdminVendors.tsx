import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Check, X, Loader2, FlaskConical, ShieldCheck, Mail, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VendorCoordinateEditor } from '@/components/admin/VendorCoordinateEditor';
import { AdminVendorNameEditor } from '@/components/admin/AdminVendorNameEditor';
import { AdminOutletList } from '@/components/admin/AdminOutletList';
import { AdminChangeEmailDialog } from '@/components/admin/AdminChangeEmailDialog';
import { AdminEntityWalletDialog } from '@/components/admin/AdminEntityWalletDialog';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { AdminDeleteUserButton } from '@/components/admin/AdminDeleteUserButton';

export default function AdminVendors() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<any[]>([]);
  const [pendingVendors, setPendingVendors] = useState<any[]>([]);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedVendorUserId, setSelectedVendorUserId] = useState<string | null>(null);
  const [selectedVendorName, setSelectedVendorName] = useState('');
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [walletUserId, setWalletUserId] = useState<string | null>(null);
  const [walletEntityName, setWalletEntityName] = useState('');


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

    await fetchVendors();
  };

  const fetchVendors = async () => {
    try {
      const { data: all } = await supabase
        .from('vendors')
        .select('*')
        .order('created_at', { ascending: false });

      // Fetch profile phone numbers for vendors
      const userIds = [...new Set((all || []).map(v => v.user_id).filter(Boolean))];
      const { data: profiles } = userIds.length > 0
        ? await supabase.from('profiles').select('user_id, phone').in('user_id', userIds)
        : { data: [] };
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      const enriched = (all || []).map(v => ({
        ...v,
        profile_phone: profileMap.get(v.user_id)?.phone || v.phone || '',
      }));

      const verified = enriched.filter(v => v.is_verified);
      const pending = enriched.filter(v => !v.is_verified);

      setVendors(verified);
      setPendingVendors(pending);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    } finally {
      setLoading(false);
    }
  };

  const approveVendor = async (vendorId: string) => {
    try {
      await supabase
        .from('vendors')
        .update({ is_verified: true, is_active: true })
        .eq('id', vendorId);

      toast({ title: 'Vendor approved successfully' });
      fetchVendors();
    } catch (error) {
      toast({ title: 'Failed to approve vendor', variant: 'destructive' });
    }
  };

  const rejectVendor = async (vendorId: string) => {
    try {
      await supabase.from('vendors').delete().eq('id', vendorId);
      toast({ title: 'Vendor rejected' });
      fetchVendors();
    } catch (error) {
      toast({ title: 'Failed to reject vendor', variant: 'destructive' });
    }
  };

  const toggleActive = async (vendorId: string, isActive: boolean) => {
    try {
      await supabase.from('vendors').update({ is_active: !isActive }).eq('id', vendorId);
      toast({ title: `Vendor ${isActive ? 'deactivated' : 'activated'}` });
      fetchVendors();
    } catch (error) {
      toast({ title: 'Failed to update vendor', variant: 'destructive' });
    }
  };

  const toggleTestStore = async (vendorId: string, isTestStore: boolean) => {
    try {
      await supabase.from('vendors').update({ is_test_store: !isTestStore }).eq('id', vendorId);
      toast({ title: `Vendor marked as ${!isTestStore ? 'test store' : 'live store'}` });
      fetchVendors();
    } catch (error) {
      toast({ title: 'Failed to update vendor', variant: 'destructive' });
    }
  };

  const approveForLive = async (vendorId: string) => {
    try {
      await supabase.from('vendors').update({ 
        approved_for_live: true, 
        is_test_store: false 
      }).eq('id', vendorId);
      toast({ title: 'Vendor approved for live' });
      fetchVendors();
    } catch (error) {
      toast({ title: 'Failed to approve vendor', variant: 'destructive' });
    }
  };

  const revokeApproval = async (vendorId: string) => {
    try {
      await supabase.from('vendors').update({ 
        approved_for_live: false 
      }).eq('id', vendorId);
      toast({ title: 'Live approval revoked' });
      fetchVendors();
    } catch (error) {
      toast({ title: 'Failed to revoke approval', variant: 'destructive' });
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
    <AdminLayout>
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-foreground">Vendors</h1>
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
            Manage platform vendors
            {isTestMode && " • Showing test stores"}
          </p>
        </div>

        <Tabs defaultValue="approved">
          <TabsList>
            <TabsTrigger value="approved">Approved ({vendors.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({pendingVendors.length})</TabsTrigger>
            <TabsTrigger value="outlets">Outlets</TabsTrigger>
          </TabsList>

          <TabsContent value="approved">
            <Card>
              <CardHeader>
                <CardTitle>Approved Vendors</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {vendors.map((vendor) => (
                    <div key={vendor.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{vendor.name}</h3>
                          <AdminVendorNameEditor vendorId={vendor.id} currentName={vendor.name} onUpdated={fetchVendors} />
                          {vendor.is_test_store && (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                              <FlaskConical className="w-3 h-3 mr-1" />
                              Test
                            </Badge>
                          )}
                          {vendor.approved_for_live && (
                             <Badge variant="outline" className="border-green-500 text-green-600">
                              <ShieldCheck className="w-3 h-3 mr-1" />
                              Live Approved
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{vendor.category} • {vendor.city}</p>
                        <p className="text-sm text-muted-foreground">
                          {vendor.profile_phone || vendor.phone || '—'} • {vendor.email || '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setWalletUserId(vendor.user_id);
                            setWalletEntityName(vendor.name);
                            setWalletDialogOpen(true);
                          }}
                        >
                          <Wallet className="w-4 h-4 text-primary mr-1" />
                          Transactions
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedVendorUserId(vendor.user_id);
                            setSelectedVendorName(vendor.name);
                            setEmailDialogOpen(true);
                          }}
                        >
                          <Mail className="w-4 h-4 text-primary mr-1" />
                          Change Email
                        </Button>
                        <VendorCoordinateEditor vendor={vendor} onUpdate={fetchVendors} />
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Test Store</span>
                          <Switch
                            checked={vendor.is_test_store || false}
                            onCheckedChange={() => toggleTestStore(vendor.id, vendor.is_test_store || false)}
                          />
                        </div>
                        {!vendor.approved_for_live && !vendor.is_test_store && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => approveForLive(vendor.id)}
                          >
                            <ShieldCheck className="w-4 h-4 mr-1" />
                            Approve for Live
                          </Button>
                        )}
                        {vendor.approved_for_live && !vendor.is_test_store && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => revokeApproval(vendor.id)}
                            className="text-destructive border-destructive hover:bg-destructive/10"
                          >
                            <X className="w-4 h-4 mr-1" />
                            Revoke Approval
                          </Button>
                        )}
                        <Badge variant={vendor.is_active ? 'default' : 'secondary'}>
                          {vendor.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleActive(vendor.id, vendor.is_active)}
                        >
                          {vendor.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <AdminDeleteUserButton
                          userId={vendor.user_id}
                          scope="vendor"
                          entityName={vendor.name}
                          buttonLabel="Remove Vendor"
                          onDeleted={fetchVendors}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle>Pending Approval</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingVendors.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No pending vendors</p>
                ) : (
                  <div className="space-y-4">
                    {pendingVendors.map((vendor) => (
                      <div key={vendor.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium">{vendor.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {vendor.category} • {vendor.address}, {vendor.city}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {vendor.email} • {vendor.phone}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => approveVendor(vendor.id)}>
                            <Check className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => rejectVendor(vendor.id)}>
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
          <TabsContent value="outlets">
            <AdminOutletList vendors={vendors} onRefresh={fetchVendors} />
          </TabsContent>
        </Tabs>
      

      <AdminChangeEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        userId={selectedVendorUserId}
        userName={selectedVendorName}
      />
      <AdminEntityWalletDialog
        open={walletDialogOpen}
        onOpenChange={setWalletDialogOpen}
        userId={walletUserId}
        walletType="vendor"
        entityName={walletEntityName}
      />
    </AdminLayout>
  );
}
