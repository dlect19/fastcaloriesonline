import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Eye, MousePointer, DollarSign, Plus, Wallet, ArrowUpRight, ArrowDownLeft, Megaphone, BarChart3, Clock } from 'lucide-react';
import { VendorLayout } from '@/components/vendor/VendorLayout';

interface AdWallet {
  id: string;
  balance: number;
  total_funded: number;
  total_spent: number;
}

interface AdPlacement {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  placement_type: string;
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
}

interface AdPricing {
  id: string;
  name: string;
  placement_type: string;
  cpm_rate: number;
  min_budget: number;
  min_duration_days: number;
  max_duration_days: number;
}

interface WalletTx {
  id: string;
  transaction_type: string;
  category: string;
  amount: number;
  balance_after: number;
  notes: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-slate-100 text-slate-800',
  completed: 'bg-purple-100 text-purple-800',
  rejected: 'bg-red-100 text-red-800',
};

export default function VendorAdvertising() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorLat, setVendorLat] = useState<number | null>(null);
  const [vendorLng, setVendorLng] = useState<number | null>(null);
  const [wallet, setWallet] = useState<AdWallet | null>(null);
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [pricingOptions, setPricingOptions] = useState<AdPricing[]>([]);
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([]);
  
  // Create ad form
  const [createDialog, setCreateDialog] = useState(false);
  const [fundDialog, setFundDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fundAmount, setFundAmount] = useState('');
  const [fundMode, setFundMode] = useState<'earnings' | 'direct'>('earnings');
  
  const [adForm, setAdForm] = useState({
    title: '',
    description: '',
    image_url: '',
    placement_type: 'carousel',
    target_radius_km: 10,
    starts_at: '',
    ends_at: '',
    budget: 5000,
    pricing_id: '',
  });

  useEffect(() => {
    if (!authLoading && !user) navigate('/vendor/auth');
  }, [user, authLoading]);

  useEffect(() => {
    if (user) fetchVendorData();
  }, [user]);

  const fetchVendorData = async () => {
    setLoading(true);
    try {
      // Get vendor info with coordinates
      const { data: vendor } = await supabase.from('vendors').select('id, latitude, longitude').eq('user_id', user!.id).single();
      if (!vendor) { navigate('/vendor/auth'); return; }
      setVendorId(vendor.id);
      setVendorLat(vendor.latitude);
      setVendorLng(vendor.longitude);

      // Get or create ad wallet
      let { data: adWallet } = await supabase.from('ad_wallets').select('*').eq('vendor_id', vendor.id).single();
      if (!adWallet) {
        const { data: newWallet } = await supabase.from('ad_wallets').insert({
          vendor_id: vendor.id,
          user_id: user!.id,
        }).select('*').single();
        adWallet = newWallet;
      }
      setWallet(adWallet as AdWallet);

      // Fetch placements, pricing, transactions
      const [placementsRes, pricingRes, txRes] = await Promise.all([
        supabase.from('ad_placements').select('*').eq('vendor_id', vendor.id).order('created_at', { ascending: false }),
        supabase.from('ad_pricing').select('*').eq('is_active', true).order('cpm_rate', { ascending: true }),
        adWallet ? supabase.from('ad_wallet_transactions').select('*').eq('ad_wallet_id', adWallet.id).order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
      ]);

      setPlacements((placementsRes.data as AdPlacement[]) || []);
      setPricingOptions((pricingRes.data as AdPricing[]) || []);
      setWalletTxs((txRes.data as WalletTx[]) || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFundFromEarnings = async () => {
    const amount = parseFloat(fundAmount);
    if (!amount || amount <= 0 || !wallet || !vendorId) return;
    setSaving(true);
    try {
      // Check vendor's withdrawable balance
      const { data: vendorWallet } = await supabase.from('wallets').select('eligible_balance, menu_earnings_balance').eq('user_id', user!.id).eq('wallet_type', 'vendor').single();
      const available = vendorWallet?.menu_earnings_balance || 0;
      if (amount > available) {
        toast({ title: 'Insufficient balance', description: `Available: ₦${available.toLocaleString()}`, variant: 'destructive' });
        setSaving(false);
        return;
      }

      // Debit vendor wallet, credit ad wallet
      // We'll use a simple RPC approach: debit earnings and credit ad wallet
      const newAdBal = wallet.balance + amount;
      await supabase.from('ad_wallets').update({ 
        balance: newAdBal, 
        total_funded: (wallet.total_funded || 0) + amount 
      }).eq('id', wallet.id);

      await supabase.from('ad_wallet_transactions').insert({
        ad_wallet_id: wallet.id,
        vendor_id: vendorId,
        transaction_type: 'credit',
        category: 'funding_from_earnings',
        amount,
        balance_after: newAdBal,
        notes: 'Funded from menu earnings',
      });

      // Debit vendor earnings wallet via RPC
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      // Use direct wallet update (simplified - in production use a proper edge function)
      const { error: debitErr } = await supabase.from('wallets')
        .update({ 
          menu_earnings_balance: (vendorWallet?.menu_earnings_balance || 0) - amount,
          eligible_balance: (vendorWallet?.eligible_balance || 0) - amount,
          balance: ((vendorWallet as any)?.balance || 0) - amount,
        })
        .eq('user_id', user!.id)
        .eq('wallet_type', 'vendor');

      // Record in wallet_transactions
      const { data: vWallet } = await supabase.from('wallets').select('id').eq('user_id', user!.id).eq('wallet_type', 'vendor').single();
      if (vWallet) {
        await supabase.from('wallet_transactions').insert({
          wallet_id: vWallet.id,
          wallet_type: 'vendor',
          transaction_type: 'debit',
          category: 'ad_funding',
          amount,
          environment: 'production',
          status: 'completed',
          notes: 'Transfer to advertising wallet',
        });
      }

      toast({ title: 'Funded!', description: `₦${amount.toLocaleString()} added to ad wallet` });
      setFundDialog(false);
      setFundAmount('');
      fetchVendorData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleFundViaPaystack = async () => {
    const amount = parseFloat(fundAmount);
    if (!amount || amount < 1000) return;
    setSaving(true);
    try {
      const callbackUrl = `${window.location.origin}/vendor/advertising`;
      const { data, error } = await supabase.functions.invoke('paystack-initialize-ad-funding', {
        body: { amount, callbackUrl },
      });
      if (error) throw error;
      if (data?.authorization_url) {
        window.location.href = data.authorization_url;
      } else {
        throw new Error('No payment URL returned');
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setSaving(false);
    }
  };

  const handleCreateAd = async () => {
    if (!wallet || !vendorId) return;
    const selectedPricing = pricingOptions.find(p => p.id === adForm.pricing_id);
    if (!selectedPricing) {
      toast({ title: 'Select a pricing plan', variant: 'destructive' });
      return;
    }
    if (adForm.budget < selectedPricing.min_budget) {
      toast({ title: 'Budget too low', description: `Minimum: ₦${selectedPricing.min_budget.toLocaleString()}`, variant: 'destructive' });
      return;
    }
    if (adForm.budget > wallet.balance) {
      toast({ title: 'Insufficient ad wallet balance', description: `Available: ₦${wallet.balance.toLocaleString()}`, variant: 'destructive' });
      return;
    }
    if (!adForm.starts_at || !adForm.ends_at) {
      toast({ title: 'Set start and end dates', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Debit ad wallet
      const newBal = wallet.balance - adForm.budget;
      await supabase.from('ad_wallets').update({ balance: newBal, total_spent: (wallet.total_spent || 0) + adForm.budget }).eq('id', wallet.id);
      
      await supabase.from('ad_wallet_transactions').insert({
        ad_wallet_id: wallet.id,
        vendor_id: vendorId,
        transaction_type: 'debit',
        category: 'ad_spend',
        amount: adForm.budget,
        balance_after: newBal,
        notes: `Ad placement: ${adForm.title}`,
      });

      // Create placement
      await supabase.from('ad_placements').insert({
        vendor_id: vendorId,
        user_id: user!.id,
        title: adForm.title,
        description: adForm.description || null,
        image_url: adForm.image_url || null,
        placement_type: adForm.placement_type,
        target_latitude: vendorLat,
        target_longitude: vendorLng,
        target_radius_km: adForm.target_radius_km,
        starts_at: adForm.starts_at,
        ends_at: adForm.ends_at,
        ad_pricing_id: adForm.pricing_id,
        budget: adForm.budget,
        cpm_rate: selectedPricing.cpm_rate,
        status: 'pending_review',
      });

      toast({ title: 'Submitted!', description: 'Your ad is pending admin review' });
      setCreateDialog(false);
      setAdForm({ title: '', description: '', image_url: '', placement_type: 'carousel', target_radius_km: 10, starts_at: '', ends_at: '', budget: 5000, pricing_id: '' });
      fetchVendorData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <VendorLayout>
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </VendorLayout>
    );
  }

  return (
    <VendorLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">Advertising</h1>
        <p className="text-sm text-muted-foreground mb-6">Promote your business to nearby customers</p>

        {/* Ad Wallet Card */}
        <Card className="mb-6 bg-gradient-to-r from-primary/10 to-emerald-500/10 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" />
                <span className="font-medium text-foreground">Ad Wallet</span>
              </div>
              <Button size="sm" onClick={() => setFundDialog(true)}>
                <Plus className="w-4 h-4 mr-1" />Fund
              </Button>
            </div>
            <p className="text-3xl font-bold text-foreground">₦{(wallet?.balance || 0).toLocaleString()}</p>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><ArrowDownLeft className="w-3 h-3 text-emerald-500" />Funded: ₦{(wallet?.total_funded || 0).toLocaleString()}</span>
              <span className="flex items-center gap-1"><ArrowUpRight className="w-3 h-3 text-red-500" />Spent: ₦{(wallet?.total_spent || 0).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="campaigns" className="space-y-4">
          <TabsList className="w-full">
            <TabsTrigger value="campaigns" className="flex-1 gap-1"><Megaphone className="w-4 h-4" />Campaigns</TabsTrigger>
            <TabsTrigger value="wallet" className="flex-1 gap-1"><Wallet className="w-4 h-4" />Wallet History</TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns">
            <Button className="w-full mb-4" onClick={() => setCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />Create Ad Campaign
            </Button>

            {placements.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">No campaigns yet. Create your first ad!</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {placements.map(p => (
                  <Card key={p.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-foreground truncate">{p.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[p.status] || 'bg-muted'}`}>{p.status.replace('_', ' ')}</span>
                      </div>
                      {p.rejection_reason && (
                        <p className="text-xs text-destructive mb-2">Rejected: {p.rejection_reason}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.total_impressions} impressions</span>
                        <span className="flex items-center gap-1"><MousePointer className="w-3 h-3" />{p.total_clicks} clicks</span>
                        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />₦{p.spent.toLocaleString()} / ₦{p.budget.toLocaleString()}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(p.starts_at).toLocaleDateString()} - {new Date(p.ends_at).toLocaleDateString()}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="wallet">
            {walletTxs.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">No transactions yet</CardContent></Card>
            ) : (
              <div className="space-y-2">
                {walletTxs.map(tx => (
                  <Card key={tx.id}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground capitalize">{tx.category.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</p>
                        {tx.notes && <p className="text-xs text-muted-foreground">{tx.notes}</p>}
                      </div>
                      <span className={`font-medium ${tx.transaction_type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {tx.transaction_type === 'credit' ? '+' : '-'}₦{tx.amount.toLocaleString()}
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Fund Dialog */}
      <Dialog open={fundDialog} onOpenChange={setFundDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Fund Ad Wallet</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Funding Method</Label>
              <Select value={fundMode} onValueChange={v => setFundMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="earnings">Deduct from Earnings</SelectItem>
                  <SelectItem value="direct">Direct Payment (Paystack)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (₦)</Label>
              <Input type="number" value={fundAmount} onChange={e => setFundAmount(e.target.value)} placeholder="5000" min={1000} />
            </div>
            {fundMode === 'direct' && (
              <p className="text-xs text-muted-foreground">You'll be redirected to Paystack to complete payment via card or bank transfer.</p>
            )}
            <Button
              className="w-full"
              disabled={saving || !fundAmount || parseFloat(fundAmount) < 1000}
              onClick={fundMode === 'earnings' ? handleFundFromEarnings : handleFundViaPaystack}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : fundMode === 'earnings' ? 'Fund from Earnings' : `Pay ₦${parseFloat(fundAmount || '0').toLocaleString()} via Paystack`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Ad Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Ad Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Title *</Label><Input value={adForm.title} onChange={e => setAdForm({ ...adForm, title: e.target.value })} placeholder="Summer Special Deal" /></div>
            <div><Label>Description</Label><Textarea value={adForm.description} onChange={e => setAdForm({ ...adForm, description: e.target.value })} placeholder="Describe your ad" rows={2} /></div>
            <div><Label>Image URL (optional)</Label><Input value={adForm.image_url} onChange={e => setAdForm({ ...adForm, image_url: e.target.value })} placeholder="https://..." /></div>
            <div>
              <Label>Pricing Plan</Label>
              <Select value={adForm.pricing_id} onValueChange={v => {
                const p = pricingOptions.find(o => o.id === v);
                setAdForm({ ...adForm, pricing_id: v, placement_type: p?.placement_type || 'carousel', budget: Math.max(adForm.budget, p?.min_budget || 5000) });
              }}>
                <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent>
                  {pricingOptions.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — ₦{p.cpm_rate}/1K views</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Budget (₦)</Label><Input type="number" value={adForm.budget} onChange={e => setAdForm({ ...adForm, budget: Number(e.target.value) })} min={1000} /></div>
            <div><Label>Target Radius (km from your location)</Label><Input type="number" value={adForm.target_radius_km} onChange={e => setAdForm({ ...adForm, target_radius_km: Number(e.target.value) })} min={1} max={100} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input type="datetime-local" value={adForm.starts_at} onChange={e => setAdForm({ ...adForm, starts_at: e.target.value })} /></div>
              <div><Label>End Date</Label><Input type="datetime-local" value={adForm.ends_at} onChange={e => setAdForm({ ...adForm, ends_at: e.target.value })} /></div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
              <p>Your ad will target customers within <strong>{adForm.target_radius_km} km</strong> of your outlet.</p>
              <p className="mt-1">Estimated impressions: ~{Math.floor((adForm.budget / (pricingOptions.find(p => p.id === adForm.pricing_id)?.cpm_rate || 500)) * 1000).toLocaleString()}</p>
            </div>
            <Button className="w-full" disabled={saving || !adForm.title || !adForm.pricing_id} onClick={handleCreateAd}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : `Submit for Review — ₦${adForm.budget.toLocaleString()}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      </div>
    </VendorLayout>
  );
}
