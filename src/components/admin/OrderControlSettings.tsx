import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Clock, Save, Loader2, XCircle } from 'lucide-react';

interface OrderControlSettingsProps {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function OrderControlSettings({ settings, onSettingChange, onSave, saving }: OrderControlSettingsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <XCircle className="w-5 h-5 text-primary" />
          Order Cancellation & Prep Time
        </CardTitle>
        <CardDescription>
          Control customer cancellation countdown and vendor prep time suggestions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Customer Cancel Countdown */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Customer Cancel Countdown
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Countdown Duration</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  max="30"
                  step="1"
                  value={settings['customer_cancel_countdown_minutes'] ?? '3'}
                  onChange={e => onSettingChange('customer_cancel_countdown_minutes', e.target.value)}
                  className="pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  minutes
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Time customers must wait before they can cancel. Set to 0 for instant cancellation.
              </p>
            </div>
            <div className="flex items-center justify-between p-4 bg-secondary rounded-lg h-fit">
              <div className="space-y-1">
                <Label className="text-sm">Enable Cancel Button</Label>
                <p className="text-xs text-muted-foreground">
                  Allow customers to cancel their own orders
                </p>
              </div>
              <Switch
                checked={settings['customer_cancel_enabled'] !== 'false'}
                onCheckedChange={checked => onSettingChange('customer_cancel_enabled', checked ? 'true' : 'false')}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Vendor Prep Time */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Vendor Prep Time Selection
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
              <div className="space-y-1">
                <Label className="text-sm">Enable Prep Time Prompt</Label>
                <p className="text-xs text-muted-foreground">
                  Ask vendors to set estimated prep time when they start preparing
                </p>
              </div>
              <Switch
                checked={settings['prep_time_enabled'] !== 'false'}
                onCheckedChange={checked => onSettingChange('prep_time_enabled', checked ? 'true' : 'false')}
              />
            </div>

            {settings['prep_time_enabled'] !== 'false' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Restaurant Options (comma-separated)</Label>
                  <Input
                    value={settings['prep_time_restaurant_options'] ?? '5,10,15,30'}
                    onChange={e => onSettingChange('prep_time_restaurant_options', e.target.value)}
                    placeholder="5,10,15,30"
                  />
                  <p className="text-xs text-muted-foreground">Suggested times in minutes for restaurants</p>
                </div>
                <div className="space-y-2">
                  <Label>Pharmacy/Market Options (comma-separated)</Label>
                  <Input
                    value={settings['prep_time_other_options'] ?? '10,15,20,25,30,35,40'}
                    onChange={e => onSettingChange('prep_time_other_options', e.target.value)}
                    placeholder="10,15,20,25,30,35,40"
                  />
                  <p className="text-xs text-muted-foreground">Suggested times in minutes for other vendors</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="p-4 bg-secondary rounded-lg">
          <h4 className="text-sm font-medium text-foreground mb-2">Current Configuration</h4>
          <p className="text-sm text-muted-foreground">
            Customer cancel: {settings['customer_cancel_enabled'] === 'false' ? (
              <span className="text-destructive font-medium">Disabled</span>
            ) : (
              <>Enabled with <span className="text-primary font-medium">{settings['customer_cancel_countdown_minutes'] ?? '3'} min</span> countdown</>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            Prep time prompt: <span className="text-primary font-medium">{settings['prep_time_enabled'] === 'false' ? 'Disabled' : 'Enabled'}</span>
          </p>
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
