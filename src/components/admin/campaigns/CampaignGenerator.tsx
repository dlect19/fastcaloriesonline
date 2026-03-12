import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Loader2, Download, Image as ImageIcon, Shuffle, Save } from 'lucide-react';

interface Vendor {
  id: string;
  name: string;
  logo_url: string | null;
}

export function CampaignGenerator() {
  const { toast } = useToast();
  const [campaignType, setCampaignType] = useState('vendor_promo');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [menuItems, setMenuItems] = useState<string[]>([]);
  const [generatedImageUrl, setGeneratedImageUrl] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(false);

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    setLoadingVendors(true);
    const { data } = await supabase
      .from('vendors')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .order('name');
    setVendors(data || []);
    setLoadingVendors(false);
  };

  const pickRandomVendor = async () => {
    if (vendors.length === 0) return;
    const random = vendors[Math.floor(Math.random() * vendors.length)];
    setSelectedVendorId(random.id);
    // Fetch random menu items for this vendor
    const { data: products } = await supabase
      .from('products')
      .select('name')
      .eq('vendor_id', random.id)
      .eq('is_available', true)
      .limit(5);
    if (products && products.length > 0) {
      const shuffled = products.sort(() => 0.5 - Math.random()).slice(0, 3);
      setMenuItems(shuffled.map(p => p.name));
    }
    toast({ title: 'Random vendor selected', description: random.name });
  };

  const handleVendorChange = async (vendorId: string) => {
    setSelectedVendorId(vendorId);
    // Fetch menu items
    const { data: products } = await supabase
      .from('products')
      .select('name')
      .eq('vendor_id', vendorId)
      .eq('is_available', true)
      .limit(10);
    if (products && products.length > 0) {
      const shuffled = products.sort(() => 0.5 - Math.random()).slice(0, 3);
      setMenuItems(shuffled.map(p => p.name));
    } else {
      setMenuItems([]);
    }
  };

  const handleGenerate = async () => {
    if (!title.trim()) {
      toast({ title: 'Title required', variant: 'destructive' });
      return;
    }
    if (campaignType === 'vendor_promo' && !selectedVendorId) {
      toast({ title: 'Select a vendor first', variant: 'destructive' });
      return;
    }

    setGenerating(true);
    setGeneratedImageUrl('');
    try {
      const vendor = vendors.find(v => v.id === selectedVendorId);

      const { data, error } = await supabase.functions.invoke('generate-campaign-image', {
        body: {
          prompt: prompt || title,
          campaign_type: campaignType,
        vendor_name: vendor?.name || null,
          vendor_logo_url: vendor?.logo_url || null,
          menu_items: menuItems,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setGeneratedImageUrl(data.image_url);
      setStoragePath(data.storage_path);
      toast({ title: 'Image generated!', description: 'Your campaign image is ready' });
    } catch (err: any) {
      console.error('Generation error:', err);
      toast({ title: 'Generation failed', description: err.message || 'Try again', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedImageUrl) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const vendor = vendors.find(v => v.id === selectedVendorId);

      const { error } = await supabase.from('campaigns').insert({
        title,
        campaign_type: campaignType,
        description: prompt,
        prompt_used: prompt || title,
        image_url: generatedImageUrl,
        storage_path: storagePath,
        vendor_id: selectedVendorId || null,
        vendor_name: vendor?.business_name || null,
        status: 'published',
        created_by: user!.id,
      });

      if (error) throw error;
      toast({ title: 'Saved!', description: 'Campaign saved to gallery' });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    if (!generatedImageUrl) return;
    const link = document.createElement('a');
    link.href = generatedImageUrl;
    link.download = `campaign-${title.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePushToCarousel = async () => {
    if (!generatedImageUrl) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const vendor = vendors.find(v => v.id === selectedVendorId);

      // Create ad in carousel
      const { data: ad, error: adError } = await supabase.from('advertisements').insert({
        title,
        description: prompt || `${vendor?.business_name || 'Fast Calories'} campaign`,
        image_url: generatedImageUrl,
        is_active: true,
        display_order: 0,
        target_audience: 'all',
      }).select().single();

      if (adError) throw adError;

      // Save campaign linked to ad
      const { error } = await supabase.from('campaigns').insert({
        title,
        campaign_type: campaignType,
        description: prompt,
        prompt_used: prompt || title,
        image_url: generatedImageUrl,
        storage_path: storagePath,
        vendor_id: selectedVendorId || null,
        vendor_name: vendor?.business_name || null,
        status: 'published',
        is_pushed_to_carousel: true,
        advertisement_id: ad.id,
        created_by: user!.id,
      });

      if (error) throw error;
      toast({ title: 'Pushed to carousel!', description: 'Campaign is now live on the home page' });
    } catch (err: any) {
      toast({ title: 'Failed', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const selectedVendor = vendors.find(v => v.id === selectedVendorId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-primary" />
            Generate Campaign Image
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Campaign Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekend Special Offer"
            />
          </div>

          <div>
            <Label>Campaign Type</Label>
            <Select value={campaignType} onValueChange={setCampaignType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vendor_promo">Vendor Promotion</SelectItem>
                <SelectItem value="platform_branding">Fast Calories Branding</SelectItem>
                <SelectItem value="seasonal">Seasonal / Event</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {campaignType === 'vendor_promo' && (
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label>Select Vendor</Label>
                  <Select value={selectedVendorId} onValueChange={handleVendorChange}>
                    <SelectTrigger>
                      <SelectValue placeholder={loadingVendors ? 'Loading...' : 'Pick a vendor'} />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.business_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="icon" onClick={pickRandomVendor} title="Random vendor">
                  <Shuffle className="w-4 h-4" />
                </Button>
              </div>

              {menuItems.length > 0 && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Featured menu items:</p>
                  <div className="flex flex-wrap gap-1">
                    {menuItems.map((item, i) => (
                      <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Custom Prompt (optional)</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Add specific instructions for the AI image generation..."
              rows={3}
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating || !title.trim()}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating with AI...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Generate Campaign Image
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Right: Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {generating ? (
            <div className="flex flex-col items-center justify-center h-64 bg-muted/30 rounded-lg">
              <Loader2 className="w-10 h-10 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">AI is creating your campaign image...</p>
              <p className="text-xs text-muted-foreground mt-1">This may take 15-30 seconds</p>
            </div>
          ) : generatedImageUrl ? (
            <div className="space-y-4">
              <div className="rounded-lg overflow-hidden border border-border">
                <img
                  src={generatedImageUrl}
                  alt={title}
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleDownload} className="flex-1">
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                <Button variant="outline" onClick={handleSave} disabled={saving} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Save to Gallery
                </Button>
                <Button onClick={handlePushToCarousel} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ImageIcon className="w-4 h-4 mr-2" />}
                  Push to Carousel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 bg-muted/30 rounded-lg">
              <ImageIcon className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Your generated image will appear here</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
