import { useState, useEffect } from 'react';
import { watLocalToISO, formatWATDate } from '@/lib/wat-timezone';
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
import { Loader2, Eye, MousePointer, DollarSign, CheckCircle, XCircle, Clock, BarChart3, Gift, Search, Plus, Upload, Megaphone, Pencil, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AdCtaLinkPicker } from '@/components/admin/AdCtaLinkPicker';

type AdPlacement = {
  id: string;
  vendor_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  link_url: string | null;
  placement_type: string;
  target_latitude: number | null;
  target_longitude: number | null;
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

const FORMAT_DIMENSIONS: Record<string, { w: number; h: number; label: string }> = {
  carousel: { w: 1200, h: 400, label: 'App Carousel (1200×400)' },
  announcement: { w: 1080, h: 1080, label: 'Announcement (1080×1080)' },
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

  // Admin create/edit ad form
  const [createDialog, setCreateDialog] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editingAd, setEditingAd] = useState<AdPlacement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AdPlacement | null>(null);
  const [adminAdForm, setAdminAdForm] = useState({
    title: '',
    description: '',
    image_url: '',
    link_url: '',
    cta_label: 'Learn More',
    placement_type: 'carousel',
    target_latitude: '',
    target_longitude: '',
    target_radius_km: 0,
    starts_at: '',
    ends_at: '',
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
      const { data: ad, error: adError } = await supabase.from('advertisements').insert({
        title: placement.title,
        description: placement.description,
        image_url: placement.image_url || 'from-primary to-emerald-600',
        link_url: placement.link_url || null,
        is_active: true,
        display_order: 99,
        target_audience: 'all',
        starts_at: placement.starts_at,
        ends_at: placement.ends_at,
        target_latitude: placement.target_latitude,
        target_longitude: placement.target_longitude,
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

  // Admin creates an ad placement directly — no payment, auto-approved
  const handleAdminImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const dims = FORMAT_DIMENSIONS[adminAdForm.placement_type];

    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);

      if (dims) {
        const tolerance = 0.15;
        const minW = dims.w * (1 - tolerance);
        const maxW = dims.w * (1 + tolerance);
        const minH = dims.h * (1 - tolerance);
        const maxH = dims.h * (1 + tolerance);
        if (img.width < minW || img.width > maxW || img.height < minH || img.height > maxH) {
          toast({
            title: 'Image size mismatch',
            description: `Required: ${dims.w}×${dims.h}px (±15%). Your image: ${img.width}×${img.height}px`,
            variant: 'destructive',
          });
          return;
        }
      }

      setUploadingImage(true);
      try {
        const ext = file.name.split('.').pop() || 'png';
        const path = `admin-ads/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('campaign-images').upload(path, file, { contentType: file.type });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('campaign-images').getPublicUrl(path);
        setAdminAdForm(prev => ({ ...prev, image_url: urlData.publicUrl }));
        toast({ title: 'Image uploaded!' });
      } catch (err: any) {
        toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
      } finally {
        setUploadingImage(false);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); toast({ title: 'Invalid image', variant: 'destructive' }); };
    img.src = objectUrl;
  };

  const handleCreateAdminAd = async () => {
    if (!adminAdForm.title || !adminAdForm.starts_at || !adminAdForm.ends_at) {
      toast({ title: 'Fill required fields', description: 'Title, start date, and end date are required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create ad placement directly as active (no vendor, no payment)
      const { data: placement, error: placementErr } = await supabase.from('ad_placements').insert({
        vendor_id: null, // admin-created, no vendor
        user_id: user.id,
        title: adminAdForm.title,
        description: adminAdForm.description || null,
        image_url: adminAdForm.image_url || null,
        link_url: adminAdForm.link_url || null,
        placement_type: adminAdForm.placement_type,
        target_latitude: adminAdForm.target_latitude ? parseFloat(adminAdForm.target_latitude) : null,
        target_longitude: adminAdForm.target_longitude ? parseFloat(adminAdForm.target_longitude) : null,
        target_radius_km: adminAdForm.target_radius_km || 0,
        starts_at: watLocalToISO(adminAdForm.starts_at),
        ends_at: watLocalToISO(adminAdForm.ends_at),
        budget: 0,
        cpm_rate: 0,
        status: 'active',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      }).select('id').single();

      if (placementErr) throw placementErr;

      // Also create the advertisement entry so it shows in the carousel/announcement system
      await supabase.from('advertisements').insert({
        title: adminAdForm.title,
        description: adminAdForm.description || null,
        image_url: adminAdForm.image_url || 'from-primary to-emerald-600',
        link_url: adminAdForm.link_url || null,
        is_active: true,
        display_order: 99,
        target_audience: 'all',
        starts_at: watLocalToISO(adminAdForm.starts_at),
        ends_at: watLocalToISO(adminAdForm.ends_at),
        target_latitude: adminAdForm.target_latitude ? parseFloat(adminAdForm.target_latitude) : null,
        target_longitude: adminAdForm.target_longitude ? parseFloat(adminAdForm.target_longitude) : null,
        target_radius_km: adminAdForm.target_radius_km || 0,
        ad_placement_id: placement?.id || null,
      });

      toast({ title: 'Ad Created!', description: 'Your ad is now live — no payment required.' });
      setCreateDialog(false);
      setAdminAdForm({ title: '', description: '', image_url: '', link_url: '', cta_label: 'Learn More', placement_type: 'carousel', target_latitude: '', target_longitude: '', target_radius_km: 0, starts_at: '', ends_at: '' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (p: AdPlacement) => {
    setEditingAd(p);
    setAdminAdForm({
      title: p.title,
      description: p.description || '',
      image_url: p.image_url || '',
      link_url: p.link_url || '',
      cta_label: (p as any).cta_label || 'Learn More',
      placement_type: p.placement_type,
      target_latitude: p.target_latitude?.toString() || '',
      target_longitude: p.target_longitude?.toString() || '',
      target_radius_km: p.target_radius_km || 0,
      starts_at: p.starts_at ? new Date(p.starts_at).toISOString().slice(0, 16) : '',
      ends_at: p.ends_at ? new Date(p.ends_at).toISOString().slice(0, 16) : '',
    });
    setCreateDialog(true);
  };

  const handleUpdateAd = async () => {
    if (!editingAd || !adminAdForm.title || !adminAdForm.starts_at || !adminAdForm.ends_at) {
      toast({ title: 'Fill required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await supabase.from('ad_placements').update({
        title: adminAdForm.title,
        description: adminAdForm.description || null,
        image_url: adminAdForm.image_url || null,
        link_url: adminAdForm.link_url || null,
        placement_type: adminAdForm.placement_type,
        target_latitude: adminAdForm.target_latitude ? parseFloat(adminAdForm.target_latitude) : null,
        target_longitude: adminAdForm.target_longitude ? parseFloat(adminAdForm.target_longitude) : null,
        target_radius_km: adminAdForm.target_radius_km || 0,
        starts_at: watLocalToISO(adminAdForm.starts_at),
        ends_at: watLocalToISO(adminAdForm.ends_at),
      }).eq('id', editingAd.id);

      // Also update linked advertisement if exists
      const { data: linkedAd } = await supabase.from('advertisements').select('id').eq('ad_placement_id', editingAd.id).maybeSingle();
      if (linkedAd) {
        await supabase.from('advertisements').update({
          title: adminAdForm.title,
          description: adminAdForm.description || null,
          image_url: adminAdForm.image_url || 'from-primary to-emerald-600',
          link_url: adminAdForm.link_url || null,
          starts_at: watLocalToISO(adminAdForm.starts_at),
          ends_at: watLocalToISO(adminAdForm.ends_at),
          target_latitude: adminAdForm.target_latitude ? parseFloat(adminAdForm.target_latitude) : null,
          target_longitude: adminAdForm.target_longitude ? parseFloat(adminAdForm.target_longitude) : null,
          target_radius_km: adminAdForm.target_radius_km || 0,
        }).eq('id', linkedAd.id);
      }

      toast({ title: 'Updated!', description: 'Ad placement updated successfully.' });
      setCreateDialog(false);
      setEditingAd(null);
      setAdminAdForm({ title: '', description: '', image_url: '', link_url: '', cta_label: 'Learn More', placement_type: 'carousel', target_latitude: '', target_longitude: '', target_radius_km: 0, starts_at: '', ends_at: '' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAd = async (p: AdPlacement) => {
    setSaving(true);
    try {
      // Delete linked advertisement first
      await supabase.from('advertisements').delete().eq('ad_placement_id', p.id);
      // Delete impressions
      await supabase.from('ad_impressions').delete().eq('ad_placement_id', p.id);
      // Delete the placement
      await supabase.from('ad_placements').delete().eq('id', p.id);
      toast({ title: 'Deleted', description: 'Ad placement removed.' });
      setDeleteConfirm(null);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = placements.filter(p => p.status === 'pending_review').length;
  const currentAdminDims = FORMAT_DIMENSIONS[adminAdForm.placement_type];

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Ad Placements & Pricing</h1>
          <p className="text-muted-foreground">Manage vendor ad submissions, create admin ads, and CPM pricing</p>
        </div>
        <Button onClick={() => setCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />Create Admin Ad
        </Button>
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
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <Megaphone className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <p>No ad placements yet.</p>
              <p className="text-sm mt-1">Click "Create Admin Ad" to create one, or vendors can submit from their dashboard.</p>
            </CardContent></Card>
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
                          {!p.vendor_id && (
                            <Badge variant="outline" className="text-[10px]">Admin</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{p.description}</p>
                        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.total_impressions} views</span>
                          <span className="flex items-center gap-1"><MousePointer className="w-3 h-3" />{p.total_clicks} clicks</span>
                          {p.budget > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />₦{p.spent.toLocaleString()} / ₦{p.budget.toLocaleString()}</span>}
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatWATDate(p.starts_at)} - {formatWATDate(p.ends_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.status === 'pending_review' && (
                          <Button size="sm" onClick={() => setReviewDialog(p)}>Review</Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => openEditDialog(p)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(p)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
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

      {/* Admin Create/Edit Ad Dialog */}
      <Dialog open={createDialog} onOpenChange={(open) => { setCreateDialog(open); if (!open) { setEditingAd(null); setAdminAdForm({ title: '', description: '', image_url: '', link_url: '', cta_label: 'Learn More', placement_type: 'carousel', target_latitude: '', target_longitude: '', target_radius_km: 0, starts_at: '', ends_at: '' }); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-primary" />
              {editingAd ? 'Edit Ad' : 'Create Admin Ad'}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">{editingAd ? 'Update this ad placement.' : 'Create an ad placement directly — no payment required. Goes live immediately.'}</p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input value={adminAdForm.title} onChange={e => setAdminAdForm({ ...adminAdForm, title: e.target.value })} placeholder="Summer Promo — Order Now!" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={adminAdForm.description} onChange={e => setAdminAdForm({ ...adminAdForm, description: e.target.value })} placeholder="Describe your ad" rows={2} />
            </div>
            <div>
              <Label>Link URL (optional)</Label>
              <Input value={adminAdForm.link_url} onChange={e => setAdminAdForm({ ...adminAdForm, link_url: e.target.value })} placeholder="/explore or https://..." />
              <p className="text-xs text-muted-foreground mt-1">Use internal paths (e.g. /explore) or full URLs</p>
            </div>

            <div>
              <Label>Placement Type</Label>
              <Select value={adminAdForm.placement_type} onValueChange={v => setAdminAdForm({ ...adminAdForm, placement_type: v, image_url: editingAd ? adminAdForm.image_url : '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="carousel">Carousel (1200×400)</SelectItem>
                  <SelectItem value="announcement">Announcement Popup (1080×1080)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Image Upload */}
            <div className="space-y-3">
              <Label>Ad Image</Label>
              {currentAdminDims && (
                <p className="text-xs text-muted-foreground">Recommended: {currentAdminDims.w}×{currentAdminDims.h}px — {currentAdminDims.label}</p>
              )}
              <Input
                type="file"
                accept="image/*"
                onChange={handleAdminImageUpload}
                disabled={uploadingImage}
                className="cursor-pointer"
              />
              {uploadingImage && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Uploading...</p>}
              
              {adminAdForm.image_url && (
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <img src={adminAdForm.image_url} alt="Preview" className="w-full h-auto object-contain max-h-48" />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => setAdminAdForm(prev => ({ ...prev, image_url: '' }))}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>

            {/* Location Targeting */}
            <div className="border rounded-lg p-3 space-y-3">
              <Label className="text-sm font-medium">Location Targeting (optional)</Label>
              <p className="text-xs text-muted-foreground">Leave empty to show everywhere. Set coordinates + radius to target a specific area.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Latitude</Label>
                  <Input type="number" step="any" value={adminAdForm.target_latitude} onChange={e => setAdminAdForm({ ...adminAdForm, target_latitude: e.target.value })} placeholder="6.5244" />
                </div>
                <div>
                  <Label className="text-xs">Longitude</Label>
                  <Input type="number" step="any" value={adminAdForm.target_longitude} onChange={e => setAdminAdForm({ ...adminAdForm, target_longitude: e.target.value })} placeholder="3.3792" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Radius (km) — 0 = show everywhere</Label>
                <Input type="number" value={adminAdForm.target_radius_km} onChange={e => setAdminAdForm({ ...adminAdForm, target_radius_km: parseInt(e.target.value) || 0 })} min={0} />
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date (WAT) *</Label>
                <Input type="datetime-local" value={adminAdForm.starts_at} onChange={e => setAdminAdForm({ ...adminAdForm, starts_at: e.target.value })} />
              </div>
              <div>
                <Label>End Date (WAT) *</Label>
                <Input type="datetime-local" value={adminAdForm.ends_at} onChange={e => setAdminAdForm({ ...adminAdForm, ends_at: e.target.value })} />
              </div>
            </div>

            {!editingAd && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-sm text-foreground">
                <p className="font-medium text-emerald-700 dark:text-emerald-400">✅ No payment required</p>
                <p className="text-xs text-muted-foreground mt-1">This ad will go live immediately after creation. It will appear in the {adminAdForm.placement_type === 'carousel' ? 'home carousel' : 'announcement popup'}.</p>
              </div>
            )}

            <Button className="w-full" disabled={saving || !adminAdForm.title || !adminAdForm.starts_at || !adminAdForm.ends_at} onClick={editingAd ? handleUpdateAd : handleCreateAdminAd}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : editingAd ? <Pencil className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {editingAd ? 'Save Changes' : 'Create & Publish Ad'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ad Placement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.title}"? This will also remove the linked advertisement. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm && handleDeleteAd(deleteConfirm)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
