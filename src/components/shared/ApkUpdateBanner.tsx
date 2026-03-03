import { Download, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApkUpdateCheck } from '@/hooks/useApkUpdateCheck';
import { downloadApk } from '@/lib/apkInstall';

interface ApkUpdateBannerProps {
  appType: 'customer' | 'rider' | 'vendor';
}

export function ApkUpdateBanner({ appType }: ApkUpdateBannerProps) {
  const { updateInfo, dismiss } = useApkUpdateCheck(appType);

  if (!updateInfo) return null;

  const handleUpdate = async (e: React.MouseEvent) => {
    const handled = await downloadApk(updateInfo.downloadUrl);
    if (handled) e.preventDefault();
  };

  return (
    <div className="mx-4 mt-3 p-3 bg-accent/10 border border-accent/20 rounded-xl flex items-center gap-3 animate-in slide-in-from-top">
      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
        <Sparkles className="w-5 h-5 text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          New Update Available (v{updateInfo.version})
        </p>
        <p className="text-xs text-muted-foreground truncate">{updateInfo.changelog}</p>
      </div>
      <Button asChild size="sm" className="shrink-0 h-8 text-xs">
        <a href={updateInfo.downloadUrl} download onClick={handleUpdate}>
          <Download className="w-3.5 h-3.5 mr-1" />
          Update
        </a>
      </Button>
      <button
        onClick={() => dismiss(updateInfo.version)}
        className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
