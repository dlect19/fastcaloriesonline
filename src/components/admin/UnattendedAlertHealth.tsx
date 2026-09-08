import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface LastRun {
  at?: string;
  checked?: number;
  sent?: number;
  failed?: number;
  skipped?: string;
  template_status?: string;
  last_error?: string | null;
  error?: string;
}

interface Health {
  lastRun: LastRun | null;
  lastSuccessAt: string | null;
  lastFailure: { at: string; error: string } | null;
  templateStatus: string | null; // null = not provisioned
}

function ago(iso?: string | null) {
  if (!iso) return 'never';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

/**
 * Lightweight health readout for the admin unattended-order alert job.
 * Three cheap reads: last run summary (platform_settings), last success /
 * failure (twilio_api_logs), template approval (whatsapp_templates).
 */
export function UnattendedAlertHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: runRow }, { data: okLog }, { data: failLog }, { data: tpl }] = await Promise.all([
        supabase.from('platform_settings').select('value').eq('key', 'admin_unattended_alert_last_run').maybeSingle(),
        supabase
          .from('twilio_api_logs')
          .select('created_at')
          .eq('function_name', 'check-unattended-orders')
          .is('error', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('twilio_api_logs')
          .select('created_at, error')
          .eq('function_name', 'check-unattended-orders')
          .not('error', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('whatsapp_templates')
          .select('content_sid, approval_status')
          .eq('template_key', 'admin_unattended_order')
          .maybeSingle(),
      ]);

      let lastRun: LastRun | null = null;
      if (runRow?.value) {
        try {
          lastRun = JSON.parse(runRow.value);
        } catch {
          lastRun = null;
        }
      }

      setHealth({
        lastRun,
        lastSuccessAt: okLog?.created_at ?? null,
        lastFailure: failLog ? { at: failLog.created_at, error: failLog.error ?? '' } : null,
        templateStatus: tpl?.content_sid ? (tpl.approval_status || 'unknown') : null,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!health) return null;

  const runAt = health.lastRun?.at;
  const runStale = !runAt || Date.now() - new Date(runAt).getTime() > 5 * 60_000;
  const tplOk = health.templateStatus === 'approved';

  return (
    <div className="rounded-lg border border-border p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium">
          <Activity className="w-4 h-4 text-primary" />
          Alert health
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Refresh health">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Scheduler last ran</p>
          <div className="flex items-center gap-2">
            <Badge variant={runStale ? 'destructive' : 'secondary'}>{runStale ? 'Not running' : 'Running'}</Badge>
            <span className="text-xs">{ago(runAt)}</span>
          </div>
          {health.lastRun && !health.lastRun.skipped && health.lastRun.checked !== undefined && (
            <p className="text-xs text-muted-foreground">
              Last run: {health.lastRun.checked} checked, {health.lastRun.sent} sent, {health.lastRun.failed} failed
            </p>
          )}
          {health.lastRun?.skipped && (
            <p className="text-xs text-muted-foreground">Last run skipped: {health.lastRun.skipped.replace(/_/g, ' ')}</p>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Last successful alert</p>
          <p className="text-xs">{ago(health.lastSuccessAt)}</p>
          {health.lastFailure && (!health.lastSuccessAt || health.lastFailure.at > health.lastSuccessAt) && (
            <p className="text-xs text-destructive break-words">
              Last failure {ago(health.lastFailure.at)}: {health.lastFailure.error}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">WhatsApp template</p>
          <Badge variant={tplOk ? 'secondary' : 'destructive'}>
            {health.templateStatus === null
              ? 'Not provisioned'
              : health.templateStatus === 'approved'
                ? 'Approved'
                : `Meta: ${health.templateStatus}`}
          </Badge>
          {!tplOk && (
            <p className="text-xs text-muted-foreground">
              {health.templateStatus === null
                ? 'Run “Provision Templates” in Admin → WhatsApp. Until then alerts only deliver within 24h of you messaging the business number.'
                : 'Alerts retry every 10 min per order until Meta approves the template.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
