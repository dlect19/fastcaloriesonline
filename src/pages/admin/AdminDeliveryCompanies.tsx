import { useState, useEffect } from 'react';
import { Truck, CheckCircle2, XCircle, Search, Percent, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';

interface DeliveryCompany {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  commission_rate: number;
  is_verified: boolean;
  is_active: boolean;
  is_email_verified: boolean;
  created_at: string;
  rider_count?: number;
}

export default function AdminDeliveryCompanies() {
  const { toast } = useToast();
  const { isTestMode } = useEnvironmentConfig();
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<DeliveryCompany | null>(null);
  const [commissionDialogOpen, setCommissionDialogOpen] = useState(false);
  const [newCommission, setNewCommission] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('delivery_companies')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get rider counts for each company
      const companiesWithCounts = await Promise.all(
        (data || []).map(async (company) => {
          try {
            const { count } = await supabase
              .from('rider_profiles')
              .select('*', { count: 'exact', head: true })
              .eq('delivery_company_id', company.id);
            return { ...company, rider_count: count || 0 };
          } catch {
            return { ...company, rider_count: 0 };
          }
        })
      );

      setCompanies(companiesWithCounts);
    } catch (error) {
      console.error('Error fetching companies:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleVerification = async (company: DeliveryCompany) => {
    try {
      const { error } = await supabase
        .from('delivery_companies')
        .update({ is_verified: !company.is_verified })
        .eq('id', company.id);

      if (error) throw error;

      toast({ title: company.is_verified ? 'Verification revoked' : 'Company verified!' });
      fetchCompanies();
    } catch (error: any) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    }
  };

  const toggleActive = async (company: DeliveryCompany) => {
    try {
      const { error } = await supabase
        .from('delivery_companies')
        .update({ is_active: !company.is_active })
        .eq('id', company.id);

      if (error) throw error;

      toast({ title: company.is_active ? 'Company suspended' : 'Company activated!' });
      fetchCompanies();
    } catch (error: any) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    }
  };

  const updateCommission = async () => {
    if (!selectedCompany || !newCommission) return;

    const rate = Number(newCommission);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast({ title: 'Invalid commission rate', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('delivery_companies')
        .update({ commission_rate: rate })
        .eq('id', selectedCompany.id);

      if (error) throw error;

      toast({ title: 'Commission rate updated!' });
      setCommissionDialogOpen(false);
      fetchCompanies();
    } catch (error: any) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const filteredCompanies = companies.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <AdminLayout>
          <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
            </div>
          </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">Delivery Companies</h1>
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
              Manage logistics partners
              {isTestMode && " • Showing test environment data"}
            </p>
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search companies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="grid gap-4">
            {filteredCompanies.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center py-12">
                  <Truck className="w-16 h-16 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No delivery companies found</p>
                </CardContent>
              </Card>
            ) : (
              filteredCompanies.map((company) => (
                <Card key={company.id}>
                  <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-lg">{company.name}</h3>
                          {company.is_verified ? (
                            <Badge className="bg-success/20 text-success">Verified</Badge>
                          ) : (
                            <Badge variant="secondary">Pending Admin Verification</Badge>
                          )}
                          {company.is_email_verified ? (
                            <Badge className="bg-primary/20 text-primary">Email Verified</Badge>
                          ) : (
                            <Badge variant="outline" className="text-warning border-warning">Email Not Verified</Badge>
                          )}
                          {!company.is_active && (
                            <Badge variant="destructive">Suspended</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{company.email}</p>
                        {company.phone && (
                          <p className="text-sm text-muted-foreground">📞 {company.phone}</p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          📍 {[company.address, company.city, company.state].filter(Boolean).join(', ')} • {company.rider_count} riders
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedCompany(company);
                            setNewCommission(String(company.commission_rate));
                            setCommissionDialogOpen(true);
                          }}
                        >
                          <Percent className="w-4 h-4 mr-1" />
                          {company.commission_rate}%
                        </Button>
                        <Button
                          variant={company.is_verified ? 'outline' : 'default'}
                          size="sm"
                          onClick={() => toggleVerification(company)}
                        >
                          {company.is_verified ? <XCircle className="w-4 h-4 mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                          {company.is_verified ? 'Revoke' : 'Verify'}
                        </Button>
                        <Button
                          variant={company.is_active ? 'destructive' : 'default'}
                          size="sm"
                          onClick={() => toggleActive(company)}
                        >
                          {company.is_active ? 'Suspend' : 'Activate'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </main>

      <Dialog open={commissionDialogOpen} onOpenChange={setCommissionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Commission Rate</DialogTitle>
            <DialogDescription>Set the platform commission for {selectedCompany?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Commission Rate (%)</Label>
              <Input
                type="number"
                value={newCommission}
                onChange={(e) => setNewCommission(e.target.value)}
                min="0"
                max="100"
              />
            </div>
            <Button onClick={updateCommission} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Commission
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
