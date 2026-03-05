import { useState } from 'react';
import { Download, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useForceAppUpdate } from '@/hooks/useForceAppUpdate';
import { downloadApk } from '@/lib/apkInstall';

export function ForceUpdateOverlay() {
  const { required, currentVersion, latestVersion, downloadUrl, changelog } = useForceAppUpdate();
  const [downloading, setDownloading] = useState(false);

  if (!required) return null;

  const handleUpdate = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadApk(downloadUrl);
    } finally {
      setTimeout(() => setDownloading(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <AlertTriangle className="w-8 h-8 text-destructive" />
      </div>

      <h1 className="text-2xl font-bold text-foreground mb-2">Update Required</h1>
      <p className="text-muted-foreground mb-4 max-w-sm">
        Your app version ({currentVersion}) is outdated. Please update to version {latestVersion} to continue using Fast Calories.
      </p>

      {changelog && (
        <p className="text-sm text-muted-foreground mb-6 max-w-sm bg-muted/50 rounded-lg p-3">
          {changelog}
        </p>
      )}

      <Button
        size="lg"
        className="w-full max-w-xs h-14 text-base gap-2"
        disabled={downloading}
        onClick={handleUpdate}
      >
        {downloading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Download className="w-5 h-5" />
        )}
        {downloading ? 'Opening Download...' : 'Update Now'}
      </Button>

      <p className="text-xs text-muted-foreground mt-4 max-w-xs">
        After downloading, tap the file to install. You may need to allow "Install from unknown sources" in your phone settings.
      </p>
    </div>
  );
}
