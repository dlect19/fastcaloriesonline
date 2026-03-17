import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Eye, MousePointer, DollarSign, CheckCircle, XCircle, Clock, BarChart3, Gift, Search } from 'lucide-react';

type AdPlacement = {
  id: string;
  vendor_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  placement_type: string;
  target_radius_km: number | null;
  starts_at: string;
  ends_at: string;
  budget: number;
  spent: number;
  cpm_rate: number;
  status: string;
  rejection_reason: string | null;
  total_impressions: number;
  total_clicks: number;
  created_at: string;
};

type AdPricing = {
  id: string;
  name: string;
  placement_type: string;
  cpm_rate: number;
  min_budget: number;
  min_duration_days: number;
  max_duration_days: number;
  is_active: boolean;
};

const statusColors: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-slate-100 text-slate-800',
  completed: 'bg-purple-100 text-purple-800',
  rejected: 'bg-red-100 text-red-800',
};

export default function AdminAdPlacements() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [pricing, setPricing] = useState<AdPricing[]>([]);
  const [activeTab, setActiveTab] = useState('placements');
  const [reviewDialog, setReviewDialog] = useState<AdPlacement | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Admin credit form
  const [creditDialog, setCreditDialog] = useState(false);
  const [creditVendorSearch, setCreditVendorSearch] = useState('');
  const [creditVendors, setCreditVendors] = useState<Array<{id: string; name: string; wallet_balance: number; wallet_id: string}>>([]);
  const [selectedCreditVendor, setSelectedCreditVendor] = useState<{id: string; name: string; wallet_balance: number; wallet_id: string} | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNotes, setCreditNotes] = useState('');

  // Pricing form
  const [pricingDialog, setPricingDialog] = useState(false);
  const [editingPricing, setEditingPricing] = useState<AdPricing | null>(null);
  const [pricingForm, setPricingForm] = useState({
    name: '', placement_type: 'carousel', cpm_rate: 500, min_budget: 5000, min_duration_days: 1, max_duration_days: 30,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles?.some(r => r.role === 'admin')) { navigate('/admin/auth'); return; }
    fetchData();
  };

  const fetchData = async () => {
    setLoading(true);
    const [placementsRes, pricingRes] = await Promise.all([
      supabase.from('ad_placements').select('*').order('created_at', { ascending: false }),
      supabase.from('ad_pricing').select('*').order('created_at', { ascending: true }),
    ]);
    setPlacements((placementsRes.data as AdPlacement[]) || []);
    setPricing((pricingRes.data as AdPricing[]) || []);
    setLoading(false);
  };

  const handleApprove = async (placement: AdPlacement) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Create the advertisement entry from the placement
      const { data: ad, error: adError } = await supabase.from('advertisements').insert({
        title: placement.title,
        description: placement.description,
        image_url: placement.image_url || 'from-primary to-emerald-600',
        link_url: null,
        is_active: true,
        display_order: 99,
        target_audience: 'all',
        starts_at: placement.starts_at,
        ends_at: placement.ends_at,
        target_latitude: (placement as any).target_latitude,
        target_longitude: (placement as any).target_longitude,
        target_radius_km: placement.target_radius_km,
        ad_placement_id: placement.id,
      }).select('id').single();

      if (adError) throw adError;

      await supabase.from('ad_placements').update({
        status: 'active',
        approved_by: user?.id,
        approved_at: new Date().toISOString(),
        advertisement_id: ad.id,
      }).eq('id', placement.id);

      toast({ title: 'Approved', description: 'Ad placement is now active' });
      setReviewDialog(null);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (placement: AdPlacement) => {
    if (!rejectionReason.trim()) {
      toast({ title: 'Required', description: 'Please provide a rejection reason', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await supabase.from('ad_placements').update({
        status: 'rejected',
        rejection_reason: rejectionReason,
      }).eq('id', placement.id);

      // Refund the budget to ad wallet
      const { data: wallet } = await supabase.from('ad_wallets').select('id, balance').eq('vendor_id', placement.vendor_id).single();
      if (wallet) {
        const newBal = (wallet.balance || 0) + placement.budget;
        await supabase.from('ad_wallets').update({ balance: newBal }).eq('id', wallet.id);
        await supabase.from('ad_wallet_transactions').insert({
          ad_wallet_id: wallet.id,
          vendor_id: placement.vendor_id,
          transaction_type: 'credit',
          category: 'refund',
          amount: placement.budget,
          balance_after: newBal,
          notes: `Refund for rejected ad: ${placement.title}`,
        });
      }

      toast({ title: 'Rejected', description: 'Ad placement rejected and budget refunded' });
      setReviewDialog(null);
      setRejectionReason('');
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const savePricing = async () => {
    setSaving(true);
    try {
      if (editingPricing) {
        await supabase.from('ad_pricing').update(pricingForm).eq('id', editingPricing.id);
      } else {
        await supabase.from('ad_pricing').insert(pricingForm);
      }
      toast({ title: 'Saved' });
      setPricingDialog(false);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = placements.filter(p => p.status === 'pending_review').length;

  const searchVendorsForCredit = async (q: string) => {
    setCreditVendorSearch(q);
    if (q.length < 2) { setCreditVendors([]); return; }
    const { data: vendors } = await supabase.from('vendors').select('id, name').ilike('name', `%${q}%`).limit(10);
    if (!vendors) return;
    const results = await Promise.all(vendors.map(async v => {
      const { data: wallet } = await supabase.from('ad_wallets').select('id, balance').eq('vendor_id', v.id).maybeSingle();
      return { id: v.id, name: v.name, wallet_balance: wallet?.balance || 0, wallet_id: wallet?.id || '' };
    }));
    setCreditVendors(results);
  };

  const handleAdminCredit = async () => {
    if (!selectedCreditVendor || !creditAmount) return;
    const amount = parseFloat(creditAmount);
    if (amount <= 0) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let walletId = selectedCreditVendor.wallet_id;
      
      // Create wallet if doesn't exist
      if (!walletId) {
        const { data: vendor } = await supabase.from('vendors').select('user_id').eq('id', selectedCreditVendor.id).single();
        const { data: newWallet } = await supabase.from('ad_wallets').insert({
          vendor_id: selectedCreditVendor.id,
          user_id: vendor?.user_id || '',
        }).select('id').single();
        walletId = newWallet?.id || '';
      }

      const currentBal = selectedCreditVendor.wallet_balance || 0;
      const newBal = currentBal + amount;

      await supabase.from('ad_wallets').update({ balance: newBal, total_funded: newBal }).eq('id', walletId);
      await supabase.from('ad_wallet_transactions').insert({
        ad_wallet_id: walletId,
        vendor_id: selectedCreditVendor.id,
        transaction_type: 'credit',
        category: 'admin_credit',
        amount,
        balance_after: newBal,
        notes: creditNotes || `Admin credit by ${user?.email}`,
      });

      toast({ title: 'Credited!', description: `₦${amount.toLocaleString()} added to ${selectedCreditVendor.name}'s ad wallet` });
      setCreditDialog(false);
      setSelectedCreditVendor(null);
      setCreditAmount('');
      setCreditNotes('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground">Ad Placements & Pricing</h1>
        <p className="text-muted-foreground">Manage vendor ad submissions and CPM pricing</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="placements" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Placements {pendingCount > 0 && <Badge variant="destructive" className="ml-1">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2">
            <DollarSign className="w-4 h-4" />
            CPM Pricing
          </TabsTrigger>
          <TabsTrigger value="credits" className="gap-2">
            <Gift className="w-4 h-4" />
            Admin Credits
          </TabsTrigger>
        </TabsList>

        <TabsContent value="placements">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : placements.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No ad placements yet. Vendors can submit ads from their dashboard.</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {placements.map(p => (
                <Card key={p.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {p.image_url && p.image_url.startsWith('http') ? (
                        <img src={p.image_url} className="w-24 h-14 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className={`w-24 h-14 rounded-lg bg-gradient-to-r ${p.image_url || 'from-primary to-emerald-600'} shrink-0`} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-foreground truncate">{p.title}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[p.status] || 'bg-muted'}`}>{p.status.replace('_', ' ')}</span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{p.description}</p>
                        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.total_impressions} views</span>
                          <span className="flex items-center gap-1"><MousePointer className="w-3 h-3" />{p.total_clicks} clicks</span>
                          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />₦{p.spent.toLocaleString()} / ₦{p.budget.toLocaleString()}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(p.starts_at).toLocaleDateString()} - {new Date(p.ends_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      {p.status === 'pending_review' && (
                        <Button size="sm" onClick={() => setReviewDialog(p)}>Review</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pricing">
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setEditingPricing(null); setPricingForm({ name: '', placement_type: 'carousel', cpm_rate: 500, min_budget: 5000, min_duration_days: 1, max_duration_days: 30 }); setPricingDialog(true); }}>Add Pricing Tier</Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {pricing.map(p => (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center justify-between">
                    {p.name}
                    <Badge variant={p.is_active ? 'default' : 'secondary'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>Type: <span className="text-foreground capitalize">{p.placement_type}</span></p>
                    <p>CPM Rate: <span className="text-foreground font-medium">₦{p.cpm_rate.toLocaleString()}</span> per 1,000 impressions</p>
                    <p>Min Budget: <span className="text-foreground">₦{p.min_budget.toLocaleString()}</span></p>
                    <p>Duration: <span className="text-foreground">{p.min_duration_days} - {p.max_duration_days} days</span></p>
                  </div>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => { setEditingPricing(p); setPricingForm({ name: p.name, placement_type: p.placement_type, cpm_rate: p.cpm_rate, min_budget: p.min_budget, min_duration_days: p.min_duration_days, max_duration_days: p.max_duration_days }); setPricingDialog(true); }}>Edit</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="credits">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Credit Vendor Ad Wallet</CardTitle>
              <p className="text-sm text-muted-foreground">Manually add promotional credits to a vendor's advertising wallet</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Search Vendor</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Type vendor name..."
                    value={creditVendorSearch}
                    onChange={e => searchVendorsForCredit(e.target.value)}
                  />
                </div>
                {creditVendors.length > 0 && !selectedCreditVendor && (
                  <div className="mt-2 border rounded-lg max-h-40 overflow-y-auto">
                    {creditVendors.map(v => (
                      <button
                        key={v.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted flex justify-between items-center text-sm"
                        onClick={() => { setSelectedCreditVendor(v); setCreditVendorSearch(v.name); }}
                      >
                        <span className="font-medium text-foreground">{v.name}</span>
                        <span className="text-muted-foreground">Wallet: ₦{v.wallet_balance.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedCreditVendor && (
                  <div className="mt-2 p-3 bg-muted/50 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-medium text-foreground">{selectedCreditVendor.name}</p>
                      <p className="text-xs text-muted-foreground">Current ad wallet: ₦{selectedCreditVendor.wallet_balance.toLocaleString()}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setSelectedCreditVendor(null); setCreditVendorSearch(''); setCreditVendors([]); }}>Change</Button>
                  </div>
                )}
              </div>
              <div>
                <Label>Credit Amount (₦)</Label>
                <Input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} placeholder="10000" min={100} />
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Textarea value={creditNotes} onChange={e => setCreditNotes(e.target.value)} placeholder="Promotional credit, welcome bonus, etc." rows={2} />
              </div>
              <Button onClick={handleAdminCredit} disabled={saving || !selectedCreditVendor || !creditAmount} className="w-full">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : `Credit ₦${parseFloat(creditAmount || '0').toLocaleString()}`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={() => { setReviewDialog(null); setRejectionReason(''); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Review Ad Placement</DialogTitle></DialogHeader>
          {reviewDialog && (
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Title</Label>
                <p className="font-medium">{reviewDialog.title}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p className="text-sm">{reviewDialog.description || 'N/A'}</p>
              </div>
              {reviewDialog.image_url && reviewDialog.image_url.startsWith('http') && (
                <img src={reviewDialog.image_url} className="w-full h-40 object-cover rounded-lg" />
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><Label className="text-muted-foreground">Budget</Label><p>₦{reviewDialog.budget.toLocaleString()}</p></div>
                <div><Label className="text-muted-foreground">CPM Rate</Label><p>₦{reviewDialog.cpm_rate.toLocaleString()}</p></div>
                <div><Label className="text-muted-foreground">Start</Label><p>{new Date(reviewDialog.starts_at).toLocaleString()}</p></div>
                <div><Label className="text-muted-foreground">End</Label><p>{new Date(reviewDialog.ends_at).toLocaleString()}</p></div>
                <div><Label className="text-muted-foreground">Radius</Label><p>{reviewDialog.target_radius_km || 0} km</p></div>
                <div><Label className="text-muted-foreground">Type</Label><p className="capitalize">{reviewDialog.placement_type}</p></div>
              </div>
              <div>
                <Label>Rejection Reason (if rejecting)</Label>
                <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="Reason for rejection..." rows={2} />
              </div>
              <div className="flex gap-2">
                <Button variant="destructive" className="flex-1" onClick={() => handleReject(reviewDialog)} disabled={saving}>
                  <XCircle className="w-4 h-4 mr-2" />Reject
                </Button>
                <Button className="flex-1" onClick={() => handleApprove(reviewDialog)} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4 mr-2" />Approve & Activate</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pricing Dialog */}
      <Dialog open={pricingDialog} onOpenChange={setPricingDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPricing ? 'Edit' : 'New'} Pricing Tier</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={pricingForm.name} onChange={e => setPricingForm({ ...pricingForm, name: e.target.value })} placeholder="Carousel Banner" /></div>
            <div>
              <Label>Placement Type</Label>
              <Select value={pricingForm.placement_type} onValueChange={v => setPricingForm({ ...pricingForm, placement_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="carousel">Carousel</SelectItem>
                  <SelectItem value="announcement">Announcement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>CPM Rate (₦ per 1,000 views)</Label><Input type="number" value={pricingForm.cpm_rate} onChange={e => setPricingForm({ ...pricingForm, cpm_rate: Number(e.target.value) })} /></div>
            <div><Label>Min Budget (₦)</Label><Input type="number" value={pricingForm.min_budget} onChange={e => setPricingForm({ ...pricingForm, min_budget: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Min Days</Label><Input type="number" value={pricingForm.min_duration_days} onChange={e => setPricingForm({ ...pricingForm, min_duration_days: Number(e.target.value) })} /></div>
              <div><Label>Max Days</Label><Input type="number" value={pricingForm.max_duration_days} onChange={e => setPricingForm({ ...pricingForm, max_duration_days: Number(e.target.value) })} /></div>
            </div>
            <Button className="w-full" onClick={savePricing} disabled={saving || !pricingForm.name}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
