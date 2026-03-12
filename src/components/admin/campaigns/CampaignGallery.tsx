import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Download, Trash2, Image as ImageIcon, Loader2, ExternalLink } from 'lucide-react';

interface Campaign {
  id: string;
  title: string;
  campaign_type: string;
  image_url: string | null;
  vendor_name: string | null;
  is_pushed_to_carousel: boolean | null;
  created_at: string;
}

export function CampaignGallery() {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchCampaigns(); }, []);

  const fetchCampaigns = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, title, campaign_type, image_url, vendor_name, is_pushed_to_carousel, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      toast({ title: 'Error loading campaigns', variant: 'destructive' });
    }
    setCampaigns((data as Campaign[]) || []);
    setLoading(false);
  };

  const handleDelete = async (campaign: Campaign) => {
    if (!confirm(`Delete "${campaign.title}"?`)) return;
    try {
      if (campaign.image_url) {
        // Extract storage path from URL if needed
        const { data: row } = await supabase
          .from('campaigns')
          .select('storage_path')
          .eq('id', campaign.id)
          .single();
        if (row?.storage_path) {
          await supabase.storage.from('campaign-images').remove([row.storage_path]);
        }
      }
      const { error } = await supabase.from('campaigns').delete().eq('id', campaign.id);
      if (error) throw error;
      toast({ title: 'Deleted' });
      fetchCampaigns();
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    }
  };

  const handlePushToCarousel = async (campaign: Campaign) => {
    if (!campaign.image_url) return;
    try {
      const { error: adError } = await supabase.from('advertisements').insert({
        title: campaign.title,
        description: `${campaign.vendor_name || 'Fast Calories'} campaign`,
        image_url: campaign.image_url,
        is_active: true,
        display_order: 0,
        target_audience: 'all',
      });
      if (adError) throw adError;

      await supabase.from('campaigns').update({ is_pushed_to_carousel: true }).eq('id', campaign.id);
      toast({ title: 'Pushed to carousel!' });
      fetchCampaigns();
    } catch (err: any) {
      toast({ title: 'Failed', description: err.message, variant: 'destructive' });
    }
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case 'vendor_promo': return 'Vendor Promo';
      case 'platform_branding': return 'Branding';
      case 'seasonal': return 'Seasonal';
      default: return type;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <ImageIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No campaigns yet</h3>
          <p className="text-muted-foreground">Generate your first campaign image in the Generate tab</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {campaigns.map((campaign) => (
        <Card key={campaign.id} className="overflow-hidden">
          {campaign.image_url ? (
            <div className="aspect-video bg-muted">
              <img
                src={campaign.image_url}
                alt={campaign.title}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="aspect-video bg-muted flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <CardContent className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-medium text-sm truncate">{campaign.title}</h4>
                {campaign.vendor_name && (
                  <p className="text-xs text-muted-foreground truncate">{campaign.vendor_name}</p>
                )}
              </div>
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {typeLabel(campaign.campaign_type)}
              </Badge>
            </div>

            <div className="flex items-center gap-1">
              {campaign.image_url && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = campaign.image_url!;
                    link.download = `${campaign.title}.png`;
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
              )}
              {!campaign.is_pushed_to_carousel && campaign.image_url && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handlePushToCarousel(campaign)}
                  title="Push to carousel"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              )}
              {campaign.is_pushed_to_carousel && (
                <Badge variant="default" className="text-[10px] ml-auto">Live</Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 ml-auto"
                onClick={() => handleDelete(campaign)}
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
