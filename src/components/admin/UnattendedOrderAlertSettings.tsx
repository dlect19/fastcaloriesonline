import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, Save, Loader2 } from 'lucide-react';

interface Props {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function UnattendedOrderAlertSettings({ settings, onSettingChange, onSave, saving }: Props) {
  const enabled = settings['admin_unattended_alert_enabled'] === 'true';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-primary" />
          Unattended Order WhatsApp Alerts
        </CardTitle>
        <CardDescription>
          Get a WhatsApp message when a paid order sits unattended by the vendor past the threshold — so you can call the vendor on the go.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
          <div className="space-y-1">
            <Label className="text-sm">Enable Alerts</Label>
            <p className="text-xs text-muted-foreground">
              Send WhatsApp to the admin number below when a vendor hasn't accepted a paid order in time.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={c => onSettingChange('admin_unattended_alert_enabled', c ? 'true' : 'false')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Admin WhatsApp Number</Label>
            <Input
              type="tel"
              placeholder="+2348012345678"
              value={settings['admin_unattended_alert_phone'] ?? ''}
              onChange={e => onSettingChange('admin_unattended_alert_phone', e.target.value)}
              disabled={!enabled}
            />
            <p className="text-xs text-muted-foreground">
              E.164 format. Nigerian local (e.g. 08012345678) is also accepted.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Alert After</Label>
            <div className="relative">
              <Input
                type="number"
                min="1"
                max="60"
                step="1"
                value={settings['admin_unattended_alert_minutes'] ?? '5'}
                onChange={e => onSettingChange('admin_unattended_alert_minutes', e.target.value)}
                className="pr-16"
                disabled={!enabled}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                minutes
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              How long to wait after payment before alerting you.
            </p>
          </div>
        </div>

        <div className="p-4 bg-secondary rounded-lg text-sm text-muted-foreground">
          {enabled ? (
            <>
              You'll be alerted at <span className="text-primary font-medium">{settings['admin_unattended_alert_phone'] || '— set number —'}</span>{' '}
              if a vendor hasn't accepted a paid order within{' '}
              <span className="text-primary font-medium">{settings['admin_unattended_alert_minutes'] || '5'} min</span>.
              Each order is alerted only once.
            </>
          ) : (
            <span className="text-destructive font-medium">Alerts are disabled.</span>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving}>
            {saving ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
            ) : (
              <><Save className="w-4 h-4 mr-2" />Save Settings</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
