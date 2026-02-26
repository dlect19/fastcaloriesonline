import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, Loader2, FileDown, CheckCircle } from 'lucide-react';

export function ApkUploadCard() {
  const { toast } = useToast();
  const [appType, setAppType] = useState<'customer' | 'rider'>('customer');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) {
      toast({ title: 'Please select an APK file', variant: 'destructive' });
      return;
    }

    setUploading(true);
    setUploadedUrl(null);

    try {
      const fileName = appType === 'rider'
        ? 'fastcalories-rider.apk'
        : 'fastcalories-customer.apk';

      // Upload to storage bucket (overwrite existing)
      const { error: uploadError } = await supabase.storage
        .from('apk-files')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('apk-files')
        .getPublicUrl(fileName);

      // Update platform_settings with the download URL
      const urlKey = `${appType}_apk_download_url`;
      await supabase.from('platform_settings').upsert(
        { key: urlKey, value: publicUrl, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

      setUploadedUrl(publicUrl);
      setFile(null);

      toast({ title: `${appType === 'rider' ? 'Rider' : 'Customer'} APK uploaded successfully!` });
    } catch (error: any) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary" />
          Upload APK File
        </CardTitle>
        <CardDescription>Upload new APK files for customer or rider apps</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>App Type</Label>
          <Select value={appType} onValueChange={(v) => setAppType(v as 'customer' | 'rider')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customer">Customer App</SelectItem>
              <SelectItem value="rider">Rider App</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="apk-file">APK File</Label>
          <Input
            id="apk-file"
            type="file"
            accept=".apk"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <p className="text-xs text-muted-foreground">
            The file will be saved as <code className="bg-secondary px-1 rounded">
              fastcalories-{appType}.apk
            </code>
          </p>
        </div>

        <Button
          onClick={handleUpload}
          disabled={uploading || !file}
          className="w-full"
        >
          {uploading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>
          ) : (
            <><Upload className="w-4 h-4 mr-2" /> Upload APK</>
          )}
        </Button>

        {uploadedUrl && (
          <div className="p-3 rounded-lg bg-secondary text-sm flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Upload successful!</p>
              <a
                href={uploadedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline break-all text-xs flex items-center gap-1 mt-1"
              >
                <FileDown className="w-3 h-3" /> Download link
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
