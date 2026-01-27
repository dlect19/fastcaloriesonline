import { Volume2, VolumeX, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface SoundEnableBannerProps {
  soundEnabled: boolean;
  isBlocked: boolean;
  onToggleSound: (enabled: boolean) => void;
  onUnlock: () => void;
  onTestSound: () => void;
  className?: string;
}

export function SoundEnableBanner({
  soundEnabled,
  isBlocked,
  onToggleSound,
  onUnlock,
  onTestSound,
  className
}: SoundEnableBannerProps) {
  if (!isBlocked && soundEnabled) {
    // Sound is working - show minimal controls
    return (
      <div className={cn("flex items-center justify-between p-3 bg-muted/50 rounded-lg", className)}>
        <div className="flex items-center gap-2 text-sm">
          <Volume2 className="w-4 h-4 text-calorie-low" />
          <span className="text-muted-foreground">Sound notifications enabled</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onTestSound} className="h-7 text-xs">
            Test
          </Button>
          <Switch checked={soundEnabled} onCheckedChange={onToggleSound} />
        </div>
      </div>
    );
  }

  if (isBlocked) {
    // Audio blocked by browser - need user interaction
    return (
      <div className={cn("p-3 bg-warning/10 border border-warning/20 rounded-lg", className)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-warning flex-shrink-0" />
            <span className="text-sm text-warning truncate">Tap to enable sound notifications</span>
          </div>
          <Button 
            size="sm" 
            variant="outline"
            className="border-warning/50 text-warning hover:bg-warning/10 flex-shrink-0"
            onClick={onUnlock}
          >
            Enable Sound
          </Button>
        </div>
      </div>
    );
  }

  // Sound disabled by user preference
  return (
    <div className={cn("flex items-center justify-between p-3 bg-muted/50 rounded-lg", className)}>
      <div className="flex items-center gap-2 text-sm">
        <VolumeX className="w-4 h-4 text-muted-foreground" />
        <span className="text-muted-foreground">Sound notifications disabled</span>
      </div>
      <Switch checked={soundEnabled} onCheckedChange={onToggleSound} />
    </div>
  );
}
