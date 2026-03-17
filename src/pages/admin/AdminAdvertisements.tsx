import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Pencil, Trash2, GripVertical, Image, Loader2, Eye } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Advertisement = Tables<'advertisements'>;

const GRADIENT_OPTIONS = [
  { value: 'from-primary to-emerald-600', label: 'Green (Primary)' },
  { value: 'from-amber-500 to-orange-600', label: 'Orange' },
  { value: 'from-violet-500 to-purple-600', label: 'Purple' },
  { value: 'from-blue-500 to-cyan-600', label: 'Blue' },
  { value: 'from-rose-500 to-pink-600', label: 'Pink' },
  { value: 'from-slate-600 to-slate-800', label: 'Dark' },
];

const CAMPAIGN_BUCKET_SEGMENT = '/storage/v1/object/public/campaign-images/';

const normalizeCampaignImageUrl = (url: string): string => {
  if (!url.startsWith('http') || !url.includes(CAMPAIGN_BUCKET_SEGMENT)) {
    return url;
  }

  try {
    const incomingUrl = new URL(url);
    const currentBackendUrl = new URL(import.meta.env.VITE_SUPABASE_URL);

    if (incomingUrl.origin === currentBackendUrl.origin) {
      return url;
    }

    const objectPath = url.split(CAMPAIGN_BUCKET_SEGMENT)[1];
    if (!objectPath) {
      return url;
    }

    return `${currentBackendUrl.origin}${CAMPAIGN_BUCKET_SEGMENT}${objectPath}`;
  } catch {
    return url;
  }
};

const isImageUrl = (value: string) => value.startsWith('http') || value.startsWith('data:');

export default function AdminAdvertisements() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<Advertisement | null>(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    image_url: '',
    link_url: '',
    is_active: true,
    display_order: 0,
    target_audience: 'all',
    starts_at: '',
    ends_at: '',
    target_latitude: '',
    target_longitude: '',
    target_radius_km: 0,
  });

  const activeAds = ads.filter(ad => ad.is_active);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (activeAds.length <= 1) return;
    const timer = setInterval(() => {
      setPreviewIndex((prev) => (prev + 1) % activeAds.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [activeAds.length]);

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

    fetchAds();
  };

  const fetchAds = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('advertisements')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setAds(data || []);
    } catch (error) {
      console.error('Error fetching ads:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch advertisements',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (editingAd) {
        const { error } = await supabase
          .from('advertisements')
          .update({
            title: formData.title,
            description: formData.description,
            image_url: formData.image_url || 'gradient',
            link_url: formData.link_url || null,
            is_active: formData.is_active,
            display_order: formData.display_order,
            target_audience: formData.target_audience,
            starts_at: formData.starts_at ? watLocalToISO(formData.starts_at) : null,
            ends_at: formData.ends_at ? watLocalToISO(formData.ends_at) : null,
            target_latitude: formData.target_latitude ? parseFloat(formData.target_latitude) : null,
            target_longitude: formData.target_longitude ? parseFloat(formData.target_longitude) : null,
            target_radius_km: formData.target_radius_km || 0,
          })
          .eq('id', editingAd.id);

        if (error) throw error;
        toast({ title: 'Success', description: 'Advertisement updated' });
      } else {
        const { error } = await supabase
          .from('advertisements')
          .insert({
            title: formData.title,
            description: formData.description,
            image_url: formData.image_url || 'gradient',
            link_url: formData.link_url || null,
            is_active: formData.is_active,
            display_order: formData.display_order,
            target_audience: formData.target_audience,
            starts_at: formData.starts_at || null,
            ends_at: formData.ends_at || null,
            target_latitude: formData.target_latitude ? parseFloat(formData.target_latitude) : null,
            target_longitude: formData.target_longitude ? parseFloat(formData.target_longitude) : null,
            target_radius_km: formData.target_radius_km || 0,
          });

        if (error) throw error;
        toast({ title: 'Success', description: 'Advertisement created' });
      }

      setDialogOpen(false);
      resetForm();
      fetchAds();
    } catch (error) {
      console.error('Error saving ad:', error);
      toast({
        title: 'Error',
        description: 'Failed to save advertisement',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (ad: Advertisement) => {
    setEditingAd(ad);
    setFormData({
      title: ad.title,
      description: ad.description || '',
      image_url: ad.image_url,
      link_url: ad.link_url || '',
      is_active: ad.is_active ?? true,
      display_order: ad.display_order ?? 0,
      target_audience: ad.target_audience || 'all',
      starts_at: ad.starts_at ? ad.starts_at.slice(0, 16) : '',
      ends_at: ad.ends_at ? ad.ends_at.slice(0, 16) : '',
      target_latitude: (ad as any).target_latitude?.toString() || '',
      target_longitude: (ad as any).target_longitude?.toString() || '',
      target_radius_km: (ad as any).target_radius_km || 0,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this advertisement?')) return;

    try {
      const { error } = await supabase
        .from('advertisements')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast({ title: 'Success', description: 'Advertisement deleted' });
      fetchAds();
    } catch (error) {
      console.error('Error deleting ad:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete advertisement',
        variant: 'destructive',
      });
    }
  };

  const toggleActive = async (ad: Advertisement) => {
    try {
      const { error } = await supabase
        .from('advertisements')
        .update({ is_active: !ad.is_active })
        .eq('id', ad.id);

      if (error) throw error;
      fetchAds();
    } catch (error) {
      console.error('Error toggling ad:', error);
    }
  };

  const resetForm = () => {
    setEditingAd(null);
    setFormData({
      title: '',
      description: '',
      image_url: '',
      link_url: '',
      is_active: true,
      display_order: ads.length,
      target_audience: 'all',
      starts_at: '',
      ends_at: '',
      target_latitude: '',
      target_longitude: '',
      target_radius_km: 0,
    });
  };

  const openNewDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  return (
    <AdminLayout>
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Carousel / Advertisements</h1>
            <p className="text-muted-foreground">Manage home page carousel banners</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNewDialog}>
                <Plus className="w-4 h-4 mr-2" />
                Add Banner
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingAd ? 'Edit Banner' : 'New Banner'}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Title *</Label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="20% Off First Order"
                    required
                  />
                </div>
                
                <div>
                  <Label>Subtitle / Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Use code WELCOME20"
                    rows={2}
                  />
                </div>
                
                <div>
                  <Label>Background Style</Label>
                  <Select
                    value={formData.image_url}
                    onValueChange={(value) => setFormData({ ...formData, image_url: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a gradient" />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADIENT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded bg-gradient-to-r ${opt.value}`} />
                            {opt.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label>Link URL (optional)</Label>
                  <Input
                    value={formData.link_url}
                    onChange={(e) => setFormData({ ...formData, link_url: e.target.value })}
                    placeholder="/explore?category=restaurant"
                  />
                </div>
                
                <div>
                  <Label>Display Order</Label>
                  <Input
                    type="number"
                    value={formData.display_order}
                    onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                    min={0}
                  />
                </div>
                
                <div>
                  <Label>Target Audience</Label>
                  <Select
                    value={formData.target_audience}
                    onValueChange={(value) => setFormData({ ...formData, target_audience: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      <SelectItem value="new">New Users</SelectItem>
                      <SelectItem value="returning">Returning Users</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Start Date/Time</Label>
                    <Input
                      type="datetime-local"
                      value={formData.starts_at}
                      onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>End Date/Time</Label>
                    <Input
                      type="datetime-local"
                      value={formData.ends_at}
                      onChange={(e) => setFormData({ ...formData, ends_at: e.target.value })}
                    />
                  </div>
                </div>

                <div className="border rounded-lg p-3 space-y-3">
                  <Label className="text-sm font-medium">Location Targeting (optional)</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Latitude</Label>
                      <Input
                        type="number"
                        step="any"
                        value={formData.target_latitude}
                        onChange={(e) => setFormData({ ...formData, target_latitude: e.target.value })}
                        placeholder="6.5244"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Longitude</Label>
                      <Input
                        type="number"
                        step="any"
                        value={formData.target_longitude}
                        onChange={(e) => setFormData({ ...formData, target_longitude: e.target.value })}
                        placeholder="3.3792"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Radius (km) — 0 = show everywhere</Label>
                    <Input
                      type="number"
                      value={formData.target_radius_km}
                      onChange={(e) => setFormData({ ...formData, target_radius_km: parseInt(e.target.value) || 0 })}
                      min={0}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label>Active</Label>
                </div>
                
                <div className="flex gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving} className="flex-1">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingAd ? 'Update' : 'Create')}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Live Preview of Active Carousel */}
        {!loading && activeAds.length > 0 && (
          <Card className="mb-8">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="w-5 h-5 text-primary" />
                Live Carousel Preview
              </CardTitle>
              <p className="text-sm text-muted-foreground">This is what customers currently see on the home page</p>
            </CardHeader>
            <CardContent>
              <div className="relative max-w-xl mx-auto">
                <div className="overflow-hidden rounded-2xl">
                  <div
                    className="flex transition-transform duration-500 ease-out"
                    style={{ transform: `translateX(-${previewIndex * 100}%)` }}
                  >
                    {activeAds.map((ad) => {
                      const normalizedImageUrl = normalizeCampaignImageUrl(ad.image_url);
                      const hasImage = isImageUrl(normalizedImageUrl);

                      return (
                        <div
                          key={ad.id}
                          className={`min-w-full h-36 relative overflow-hidden flex flex-col justify-center ${hasImage ? 'bg-gradient-to-r from-primary to-emerald-600' : `bg-gradient-to-r ${normalizedImageUrl}`}`}
                        >
                          {hasImage && (
                            <img
                              src={normalizedImageUrl}
                              alt={ad.title}
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          )}
                          <div className={`relative z-10 p-5 ${hasImage ? 'bg-black/30' : ''}`}>
                            <h3 className="text-xl font-bold text-white mb-1">{ad.title}</h3>
                            <p className="text-white/90 text-sm">{ad.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {activeAds.length > 1 && (
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {activeAds.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setPreviewIndex(index)}
                        className={`w-2 h-2 rounded-full transition-all ${index === previewIndex ? 'bg-white w-6' : 'bg-white/50'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
              <p className="text-center text-xs text-muted-foreground mt-3">{activeAds.length} active banner{activeAds.length !== 1 ? 's' : ''} running</p>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : ads.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Image className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No banners yet</h3>
              <p className="text-muted-foreground mb-4">Create your first carousel banner to display on the home page</p>
              <Button onClick={openNewDialog}>
                <Plus className="w-4 h-4 mr-2" />
                Add Banner
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {ads.map((ad) => (
              <Card key={ad.id} className={!ad.is_active ? 'opacity-60' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="shrink-0">
                      <GripVertical className="w-5 h-5 text-muted-foreground" />
                    </div>
                    
                    {(() => {
                      const normalizedImageUrl = normalizeCampaignImageUrl(ad.image_url);
                      const hasImage = isImageUrl(normalizedImageUrl);

                      return (
                        <div className={`w-24 h-14 rounded-lg relative overflow-hidden flex items-center justify-center shrink-0 ${hasImage ? 'bg-gradient-to-r from-primary to-emerald-600' : `bg-gradient-to-r ${normalizedImageUrl}`}`}>
                          {hasImage && (
                            <img
                              src={normalizedImageUrl}
                              alt={ad.title}
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          )}
                          <span className={`relative z-10 text-white text-xs font-medium ${hasImage ? 'bg-black/30 px-1.5 py-0.5 rounded' : ''}`}>
                            Preview
                          </span>
                        </div>
                      );
                    })()}
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">{ad.title}</h3>
                      <p className="text-sm text-muted-foreground truncate">{ad.description}</p>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{(ad as any).total_impressions || 0} views</span>
                        <span>{(ad as any).total_clicks || 0} clicks</span>
                        {ad.starts_at && <span>From {new Date(ad.starts_at).toLocaleDateString()}</span>}
                        {ad.ends_at && <span>Until {new Date(ad.ends_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={ad.is_active ?? false}
                        onCheckedChange={() => toggleActive(ad)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(ad)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(ad.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
    </AdminLayout>
  );
}
