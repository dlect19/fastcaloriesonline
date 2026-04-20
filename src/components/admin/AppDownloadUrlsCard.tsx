import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Globe, Loader2, Save, Smartphone, Apple } from 'lucide-react';

const KEYS = {
  android: 'customer_apk_download_url',
  ios: 'customer_ios_app_url',
  version: 'customer_apk_version',
} as const;

export function AppDownloadUrlsCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [androidUrl, setAndroidUrl] = useState('');
  const [iosUrl, setIosUrl] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', Object.values(KEYS));
      const map: Record<string, string> = {};
      data?.forEach(r => { map[r.key] = (r.value as string) ?? ''; });
      setAndroidUrl(map[KEYS.android] || '');
      setIosUrl(map[KEYS.ios] || '');
      setVersion(map[KEYS.version] || '');
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rows = [
        { key: KEYS.android, value: androidUrl.trim(), updated_at: new Date().toISOString() },
        { key: KEYS.ios, value: iosUrl.trim(), updated_at: new Date().toISOString() },
        { key: KEYS.version, value: version.trim(), updated_at: new Date().toISOString() },
      ];
      for (const row of rows) {
        const { error } = await supabase
          .from('platform_settings')
          .upsert(row, { onConflict: 'key' });
        if (error) throw error;
      }
      toast({ title: 'Saved', description: 'Customer app download links updated.' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          Customer App Download Links
        </CardTitle>
        <CardDescription>
          Set the Android (.apk or Play Store) and iPhone (App Store) URLs shown on the public <code className="bg-secondary px-1 rounded">/get-app</code> page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="android-url" className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-600" />
                Android URL (Play Store or APK)
              </Label>
              <Input
                id="android-url"
                placeholder="https://play.google.com/store/apps/details?id=... or APK URL"
                value={androidUrl}
                onChange={(e) => setAndroidUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Tip: Uploading via "Upload APK File" above also fills this automatically.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ios-url" className="flex items-center gap-2">
                <Apple className="w-4 h-4" />
                iPhone App Store URL
              </Label>
              <Input
                id="ios-url"
                placeholder="https://apps.apple.com/app/id..."
                value={iosUrl}
                onChange={(e) => setIosUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to show only "Add to Home Screen" instructions on iPhone.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="app-version">Current Version (optional)</Label>
              <Input
                id="app-version"
                placeholder="e.g. 1.1.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                <><Save className="w-4 h-4 mr-2" /> Save Download Links</>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
