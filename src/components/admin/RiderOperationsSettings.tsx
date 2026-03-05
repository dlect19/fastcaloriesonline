import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRiderAvailability } from '@/hooks/useRiderAvailability';
import { Clock, Bike, TrendingUp, Save, Loader2, Users, Activity, AlertTriangle, CheckCircle, Package } from 'lucide-react';

interface RiderOperationsSettingsProps {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

export function RiderOperationsSettings({ settings, onSettingChange, onSave, saving }: RiderOperationsSettingsProps) {
  const { toast } = useToast();
  const availability = useRiderAvailability();

  const handleSaveOperations = async () => {
    const keys = [
      'rider_operating_hours_enabled', 'rider_opening_hour', 'rider_closing_hour',
      'rider_supply_surge_enabled', 'rider_supply_min_threshold', 'rider_supply_surge_pct',
      'rider_supply_critical_threshold', 'rider_supply_emergency_surge_pct',
      'rider_checkout_availability_check', 'rider_max_concurrent_orders',
    ];
    try {
      for (const key of keys) {
        if (settings[key] !== undefined) {
          await supabase.from('platform_settings').upsert({
            key,
            value: settings[key],
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' });
        }
      }
      toast({ title: 'Saved', description: 'Rider operations settings updated.' });
      availability.refetch();
    } catch {
      toast({ title: 'Error', description: 'Failed to save', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Rider Status Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Rider Live Status
          </CardTitle>
          <CardDescription>Real-time overview of rider availability</CardDescription>
        </CardHeader>
        <CardContent>
          {availability.loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-secondary rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{availability.totalRiders}</p>
                  <p className="text-xs text-muted-foreground">Total Registered</p>
                </div>
                <div className="bg-primary/10 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-primary">{availability.onlineRiderCount}</p>
                  <p className="text-xs text-muted-foreground">Online</p>
                </div>
                <div className="bg-warning/10 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-warning">{availability.ridersOnDelivery}</p>
                  <p className="text-xs text-muted-foreground">On Delivery</p>
                </div>
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{availability.ridersOffline}</p>
                  <p className="text-xs text-muted-foreground">Offline</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Surge Status:</span>
                  {availability.supplyBasedSurge.isActive ? (
                    <Badge variant="destructive" className="gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {availability.supplyBasedSurge.level === 'emergency' ? 'Emergency' : 'Active'} (+{availability.supplyBasedSurge.currentSurgePct}%)
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm font-medium">Operating Hours:</span>
                  {availability.isWithinOperatingHours ? (
                    <Badge className="bg-primary/20 text-primary gap-1">
                      <CheckCircle className="w-3 h-3" /> Open
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="w-3 h-3" /> Closed
                    </Badge>
                  )}
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={availability.refetch}>
                Refresh Status
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operating Hours Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Rider Operating Hours
          </CardTitle>
          <CardDescription>
            Control when riders can go online and receive orders. Riders will be automatically forced offline outside these hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
            <div className="space-y-1">
              <Label className="text-base">Enable Operating Hours</Label>
              <p className="text-sm text-muted-foreground">
                {settings['rider_operating_hours_enabled'] !== 'false'
                  ? 'Riders can only go online during configured hours'
                  : 'Riders can go online at any time'}
              </p>
            </div>
            <Switch
              checked={settings['rider_operating_hours_enabled'] !== 'false'}
              onCheckedChange={(checked) => onSettingChange('rider_operating_hours_enabled', checked ? 'true' : 'false')}
            />
          </div>

          {settings['rider_operating_hours_enabled'] !== 'false' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  Opening Hour
                </Label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={settings['rider_opening_hour'] || '8'}
                  onChange={(e) => onSettingChange('rider_opening_hour', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">24h format (e.g., 8 = 8:00 AM)</p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  Closing Hour
                </Label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={settings['rider_closing_hour'] || '22'}
                  onChange={(e) => onSettingChange('rider_closing_hour', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">24h format (e.g., 22 = 10:00 PM)</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
            <div className="space-y-1">
              <Label className="text-base">Checkout Availability Check</Label>
              <p className="text-sm text-muted-foreground">
                Block delivery orders when outside operating hours or no riders online
              </p>
            </div>
            <Switch
              checked={settings['rider_checkout_availability_check'] !== 'false'}
              onCheckedChange={(checked) => onSettingChange('rider_checkout_availability_check', checked ? 'true' : 'false')}
            />
          </div>

          <Separator />

          {/* Multi-Pickup / Concurrent Order Limit */}
          <div>
            <h3 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              Multi-Pickup Order Limit
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Control how many active orders a rider can carry simultaneously. Riders can batch pickups along their route up to this limit.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Max Concurrent Orders per Rider</Label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={settings['rider_max_concurrent_orders'] || '1'}
                  onChange={(e) => onSettingChange('rider_max_concurrent_orders', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Set to 1 for single-order mode. Higher values allow multi-pickup batching.
                </p>
              </div>
            </div>

            <div className="p-4 bg-secondary rounded-lg mt-4">
              <h4 className="text-sm font-medium text-foreground mb-2">How it works</h4>
              <p className="text-sm text-muted-foreground">
                When set to <span className="text-primary font-medium">{settings['rider_max_concurrent_orders'] || '1'}</span>, 
                riders {parseInt(settings['rider_max_concurrent_orders'] || '1') > 1 
                  ? `can carry up to ${settings['rider_max_concurrent_orders']} orders at the same time` 
                  : 'must complete their current delivery before receiving a new one'}. 
                This limit is enforced across dispatch offers, manual assignments, and rider acceptance.
              </p>
            </div>
          </div>

          <Separator />

          {/* Supply-Based Surge */}
          <div>
            <h3 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Rider Supply Surge Pricing
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Automatically increase delivery fees when rider supply is low
            </p>

            <div className="flex items-center justify-between p-4 bg-secondary rounded-lg mb-4">
              <div className="space-y-1">
                <Label className="text-base">Enable Supply Surge</Label>
                <p className="text-sm text-muted-foreground">
                  {settings['rider_supply_surge_enabled'] === 'true'
                    ? 'Surge pricing active when rider count drops below thresholds'
                    : 'Supply-based surge is disabled'}
                </p>
              </div>
              <Switch
                checked={settings['rider_supply_surge_enabled'] === 'true'}
                onCheckedChange={(checked) => onSettingChange('rider_supply_surge_enabled', checked ? 'true' : 'false')}
              />
            </div>

            {settings['rider_supply_surge_enabled'] === 'true' && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Min Rider Threshold</Label>
                    <Input
                      type="number"
                      min="1"
                      value={settings['rider_supply_min_threshold'] || '5'}
                      onChange={(e) => onSettingChange('rider_supply_min_threshold', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Surge kicks in when online riders fall below this</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Surge Percentage (%)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={settings['rider_supply_surge_pct'] || '15'}
                      onChange={(e) => onSettingChange('rider_supply_surge_pct', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Applied to delivery fee</p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Critical Threshold</Label>
                    <Input
                      type="number"
                      min="0"
                      value={settings['rider_supply_critical_threshold'] || '2'}
                      onChange={(e) => onSettingChange('rider_supply_critical_threshold', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Emergency surge when riders below this</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Emergency Surge (%)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={settings['rider_supply_emergency_surge_pct'] || '25'}
                      onChange={(e) => onSettingChange('rider_supply_emergency_surge_pct', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Higher surge for critical shortage</p>
                  </div>
                </div>

                {/* Surge Preview */}
                <div className="p-4 bg-secondary rounded-lg">
                  <h4 className="text-sm font-medium text-foreground mb-2">Surge Logic Preview</h4>
                  <p className="text-sm text-muted-foreground">
                    If online riders ≤ <span className="text-primary font-medium">{settings['rider_supply_min_threshold'] || '5'}</span>: 
                    <span className="text-primary font-medium"> +{settings['rider_supply_surge_pct'] || '15'}%</span> surge
                  </p>
                  <p className="text-sm text-muted-foreground">
                    If online riders ≤ <span className="text-destructive font-medium">{settings['rider_supply_critical_threshold'] || '2'}</span>: 
                    <span className="text-destructive font-medium"> +{settings['rider_supply_emergency_surge_pct'] || '25'}%</span> emergency surge
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveOperations} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Operations Settings
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
