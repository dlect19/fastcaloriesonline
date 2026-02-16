import { useState } from 'react';
import { AlertTriangle, MapPin, Send, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VendorReverificationForm } from './VendorReverificationForm';

interface GeoLockBannerProps {
  vendorId: string;
  geoStatus: string;
  lockReason?: string | null;
  lockedAt?: string | null;
  onStatusChange?: () => void;
}

export function GeoLockBanner({ vendorId, geoStatus, lockReason, lockedAt, onStatusChange }: GeoLockBannerProps) {
  const [showReverify, setShowReverify] = useState(false);

  if (geoStatus !== 'locked_pending_reverify') return null;

  return (
    <>
      <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-destructive/20 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-destructive">Store Geo-Locked</h3>
              <Badge variant="destructive" className="text-xs">Action Required</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Your store has been locked because your device location doesn't match your verified business location. 
              While locked, your store is invisible to customers, orders are disabled, and withdrawals are blocked.
            </p>
            {lockReason && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Reason: {lockReason}
              </p>
            )}
            {lockedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Locked: {new Date(lockedAt).toLocaleString('en-NG')}
              </p>
            )}
          </div>
        </div>
        <Button
          onClick={() => setShowReverify(true)}
          variant="destructive"
          size="sm"
          className="gap-2"
        >
          <Send className="w-4 h-4" />
          Submit Reverification Request
        </Button>
      </div>

      <VendorReverificationForm
        open={showReverify}
        vendorId={vendorId}
        onClose={() => setShowReverify(false)}
        onSubmitted={() => {
          setShowReverify(false);
          onStatusChange?.();
        }}
      />
    </>
  );
}
