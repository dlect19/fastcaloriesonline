import { useState } from 'react';
import { MapPin, MapPinOff, RefreshCw, Download, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RiderTrackingStatus as S } from '@/hooks/useRiderLiveTracking';
import { GEO_DIAGNOSTIC_CODE, GEO_HELP, type GeoProblem } from '@/lib/riderGeoDiagnostics';

/**
 * Shown only while the rider has an active delivery. Foreground-only tracking.
 * Location problems are independent of notification permission.
 */
export function RiderTrackingStatus({ status, problem, activeOrderCount, onRetry }: {
  status: S; problem?: GeoProblem | null; activeOrderCount: number; onRetry: () => void;
}) {
  const [showHelp, setShowHelp] = useState(false);
  if (activeOrderCount === 0) return null;
  let title = ''; let body = ''; let code = ''; let warn = false;
  if (status === 'starting') { title = 'Starting live location…'; body = "Sharing your location with this delivery's customer only."; }
  else if (status === 'tracking') { title = 'Live location active'; body = 'Your customer can see you on the map until delivery.'; }
  else if (status === 'update_required') { title = 'App update required'; body = 'Update FastCalories to share live location.'; code = 'UPDATE_REQUIRED'; warn = true; }
  else if (status === 'problem' && problem) { ({ title, body } = GEO_HELP[problem]); code = GEO_DIAGNOSTIC_CODE[problem]; warn = true; }
  else return null;
  const long = body.length > 90;
  return (
    <div role="status" data-testid="rider-tracking-status" data-code={code || undefined}
      className={`mb-3 rounded-lg border px-3 py-2 text-sm ${warn ? 'border-warning bg-warning/10' : 'border-border bg-card'}`}>
      <div className="flex items-center gap-3">
        {warn ? <MapPinOff className="w-4 h-4 text-warning shrink-0" /> : <MapPin className="w-4 h-4 text-primary shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          {(!long || showHelp) && <p className="text-xs text-muted-foreground">{body}</p>}
          {code && <p className="text-[10px] text-muted-foreground mt-0.5">Support code: {code}</p>}
        </div>
        {warn && status !== 'update_required' && (
          <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="w-3 h-3 mr-1" />Retry</Button>
        )}
        {status === 'update_required' && (
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}><Download className="w-3 h-3 mr-1" />Update</Button>
        )}
      </div>
      {warn && long && !showHelp && (
        <button type="button" className="mt-1 text-xs text-primary inline-flex items-center gap-1" onClick={() => setShowHelp(true)}>
          <HelpCircle className="w-3 h-3" />How to enable
        </button>
      )}
    </div>
  );
}
