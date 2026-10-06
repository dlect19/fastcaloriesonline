import { MapPin, MapPinOff, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RiderTrackingStatus as S } from '@/hooks/useRiderLiveTracking';

const COPY: Partial<Record<S, { title: string; body: string; tone: 'ok' | 'warn' }>> = {
  starting: { title: 'Starting live location…', body: 'Sharing your location with this delivery\'s customer only.', tone: 'ok' },
  tracking: { title: 'Live location active', body: 'Your customer can see you on the map until delivery.', tone: 'ok' },
  permission_denied: { title: 'Location permission needed', body: 'Allow location for FastCalories so your customer can follow the delivery.', tone: 'warn' },
  gps_unavailable: { title: 'GPS unavailable', body: 'Turn on location/GPS and keep the app open, then retry.', tone: 'warn' },
  update_required: { title: 'App update required', body: 'Update FastCalories to share live location.', tone: 'warn' },
};

/** Shown only while the rider has an active delivery. Foreground-only tracking. */
export function RiderTrackingStatus({ status, activeOrderCount, onRetry }: { status: S; activeOrderCount: number; onRetry: () => void }) {
  if (activeOrderCount === 0) return null;
  const c = COPY[status];
  if (!c) return null;
  const warn = c.tone === 'warn';
  return (
    <div role="status" data-testid="rider-tracking-status"
      className={`mb-3 rounded-lg border px-3 py-2 text-sm flex items-center gap-3 ${warn ? 'border-warning bg-warning/10' : 'border-border bg-card'}`}>
      {warn ? <MapPinOff className="w-4 h-4 text-warning shrink-0" /> : <MapPin className="w-4 h-4 text-primary shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{c.title}</p>
        <p className="text-xs text-muted-foreground">{c.body}</p>
      </div>
      {warn && status !== 'update_required' && (
        <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="w-3 h-3 mr-1" />Retry</Button>
      )}
      {status === 'update_required' && (
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}><Download className="w-3 h-3 mr-1" />Update</Button>
      )}
    </div>
  );
}
