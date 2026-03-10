import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, Trash2, Loader2, Image } from 'lucide-react';

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E1306C' },
  { key: 'tiktok', label: 'TikTok', color: '#000000' },
  { key: 'x', label: 'X (Twitter)', color: '#000000' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000' },
];

export function SocialLogoSettings() {
  const { toast } = useToast();
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogos();
  }, []);

  const fetchLogos = async () => {
    const keys = PLATFORMS.map(p => `social_logo_${p.key}`);
    const { data } = await supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', keys);

    const map: Record<string, string> = {};
    data?.forEach(item => {
      const platform = item.key.replace('social_logo_', '');
      if (item.value) map[platform] = item.value;
    });
    setLogos(map);
    setLoading(false);
  };

  const handleUpload = async (platform: string, file: File) => {
    setUploading(platform);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${platform}.${ext}`;

      // Remove old file first
      await supabase.storage.from('social-logos').remove([path]);

      const { error: uploadError } = await supabase.storage
        .from('social-logos')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('social-logos').getPublicUrl(path);
      const url = urlData.publicUrl + '?t=' + Date.now();

      await supabase.from('platform_settings').upsert({
        key: `social_logo_${platform}`,
        value: url,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

      setLogos(prev => ({ ...prev, [platform]: url }));
      toast({ title: `${platform} logo updated` });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const handleRemove = async (platform: string) => {
    try {
      const ext = logos[platform]?.split('.').pop()?.split('?')[0] || 'png';
      await supabase.storage.from('social-logos').remove([`${platform}.${ext}`]);
      await supabase.from('platform_settings').delete().eq('key', `social_logo_${platform}`);
      setLogos(prev => {
        const next = { ...prev };
        delete next[platform];
        return next;
      });
      toast({ title: `${platform} logo removed` });
    } catch {
      toast({ title: 'Failed to remove', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Image className="w-5 h-5 text-primary" />
          Social Media Platform Logos
        </CardTitle>
        <CardDescription>
          Upload custom logos for each social media platform. These will be displayed on all vendor social badges and marketing cards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLATFORMS.map(({ key, label, color }) => (
            <div key={key} className="p-4 bg-secondary rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: color }}
                >
                  {label.charAt(0)}
                </div>
                <Label className="font-medium">{label}</Label>
              </div>

              {logos[key] ? (
                <div className="flex items-center gap-3">
                  <img
                    src={logos[key]}
                    alt={label}
                    className="w-12 h-12 rounded-lg object-contain bg-background border"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemove(key)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Remove
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Using default icon</p>
              )}

              <div>
                <Input
                  type="file"
                  accept="image/*"
                  disabled={uploading === key}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(key, file);
                    e.target.value = '';
                  }}
                  className="text-xs"
                />
                {uploading === key && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Uploading...
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
