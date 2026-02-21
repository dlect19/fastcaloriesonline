import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Bike, DollarSign, Save, Loader2, CloudRain, Clock, Shield, TrendingUp } from 'lucide-react';

interface RiderPayoutSettingsProps {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
  onImmediateSave?: (key: string, value: string) => Promise<void>;
}

export function RiderPayoutSettings({ settings, onSettingChange, onSave, saving, onImmediateSave }: RiderPayoutSettingsProps) {
  const feePct = parseFloat(settings['rider_platform_fee_pct'] || '20');
  const feeMin = parseFloat(settings['rider_platform_fee_min'] || '300');
  const feeMax = parseFloat(settings['rider_platform_fee_max'] || '700');
  const minPayout = parseFloat(settings['rider_minimum_payout'] || '900');
  const distThreshold = parseFloat(settings['rider_distance_bonus_threshold_km'] || '4');
  const distRate = parseFloat(settings['rider_distance_bonus_rate'] || '100');
  const surgeCap = parseFloat(settings['rider_max_surge_cap'] || '500');
  const surgeEnabled = settings['rider_surge_enabled'] !== 'false';
  const timeSurgeEnabled = settings['rider_time_surge_enabled'] !== 'false';
  const weatherSurgeEnabled = settings['rider_weather_surge_enabled'] !== 'false';

  // Example calculation
  const exampleFee = 1800;
  const examplePlatformFee = Math.min(Math.max(exampleFee * feePct / 100, feeMin), feeMax);
  const examplePay = exampleFee - examplePlatformFee;

  const exampleFee2 = 700;
  const examplePlatformFee2 = Math.min(Math.max(exampleFee2 * feePct / 100, feeMin), feeMax);
  const exampleRawPay2 = exampleFee2 - examplePlatformFee2;
  const exampleSubsidy2 = Math.max(0, minPayout - exampleRawPay2);

  return (
    <div className="space-y-6">
      {/* Core Payout Formula */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bike className="w-5 h-5 text-primary" />
            Rider Payout Formula
          </CardTitle>
          <CardDescription>
            Configure the hybrid rider payout model. Surge fees are charged to customers and included in the delivery fee. All rider types (platform, vendor-affiliated, logistics) receive surge equally.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-4">Platform Fee</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Fee Percentage</Label>
                <div className="relative">
                  <Input
                    type="number" min="0" max="50" step="1"
                    value={settings['rider_platform_fee_pct'] || '20'}
                    onChange={(e) => onSettingChange('rider_platform_fee_pct', e.target.value)}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">Percentage of delivery fee</p>
              </div>
              <div className="space-y-2">
                <Label>Minimum Fee (₦)</Label>
                <Input
                  type="number" min="0" step="50"
                  value={settings['rider_platform_fee_min'] || '300'}
                  onChange={(e) => onSettingChange('rider_platform_fee_min', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Floor for platform fee</p>
              </div>
              <div className="space-y-2">
                <Label>Maximum Fee (₦)</Label>
                <Input
                  type="number" min="0" step="50"
                  value={settings['rider_platform_fee_max'] || '700'}
                  onChange={(e) => onSettingChange('rider_platform_fee_max', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Cap for platform fee</p>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-500" />
              Guaranteed Minimum
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Minimum Rider Payout (₦)</Label>
                <Input
                  type="number" min="0" step="50"
                  value={settings['rider_minimum_payout'] || '900'}
                  onChange={(e) => onSettingChange('rider_minimum_payout', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Platform tops up if payout falls below this</p>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold mb-4">Distance Bonus</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Threshold Distance (km)</Label>
                <Input
                  type="number" min="0" step="1"
                  value={settings['rider_distance_bonus_threshold_km'] || '4'}
                  onChange={(e) => onSettingChange('rider_distance_bonus_threshold_km', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">No bonus within this distance</p>
              </div>
              <div className="space-y-2">
                <Label>Rate per Extra km (₦)</Label>
                <Input
                  type="number" min="0" step="25"
                  value={settings['rider_distance_bonus_rate'] || '100'}
                  onChange={(e) => onSettingChange('rider_distance_bonus_rate', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">₦ per km beyond threshold</p>
              </div>
            </div>
          </div>

          {/* Example preview */}
          <div className="p-4 bg-secondary rounded-lg space-y-2">
            <h4 className="text-sm font-medium">Example Calculations</h4>
            <p className="text-sm text-muted-foreground">
              ₦{exampleFee.toLocaleString()} delivery → Platform fee: ₦{examplePlatformFee.toLocaleString()} → <span className="text-primary font-semibold">Rider gets ₦{examplePay.toLocaleString()}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              ₦{exampleFee2.toLocaleString()} delivery → Platform fee: ₦{examplePlatformFee2.toLocaleString()} → Raw: ₦{exampleRawPay2.toLocaleString()} → 
              {exampleSubsidy2 > 0 ? (
                <span className="text-purple-600 font-semibold"> Top-up ₦{exampleSubsidy2.toLocaleString()} → Rider gets ₦{minPayout.toLocaleString()}</span>
              ) : (
                <span className="text-primary font-semibold"> Rider gets ₦{Math.max(exampleRawPay2, minPayout).toLocaleString()}</span>
              )}
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={onSave} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Payout Settings</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Surge Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Surge Bonuses
          </CardTitle>
          <CardDescription>
            Configure time-based and weather-based surge bonuses. These are added to the delivery fee charged to customers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Master surge toggle */}
          <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
            <div>
              <Label className="text-base">Enable Surge System</Label>
              <p className="text-sm text-muted-foreground">Toggle all surge bonuses on/off</p>
            </div>
            <Switch
              checked={surgeEnabled}
              onCheckedChange={(checked) => {
                const val = checked ? 'true' : 'false';
                onSettingChange('rider_surge_enabled', val);
                onImmediateSave?.('rider_surge_enabled', val);
              }}
            />
          </div>

          {surgeEnabled && (
            <>
              <div className="space-y-2">
                <Label>Maximum Surge Cap (₦)</Label>
                <Input
                  type="number" min="0" step="50"
                  value={settings['rider_max_surge_cap'] || '500'}
                  onChange={(e) => onSettingChange('rider_max_surge_cap', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Total surge bonus cannot exceed this amount per order</p>
              </div>

              <Separator />

              {/* Time-based surge */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    Time-Based Surge
                  </h3>
                  <Switch
                    checked={timeSurgeEnabled}
                    onCheckedChange={(checked) => onSettingChange('rider_time_surge_enabled', checked ? 'true' : 'false')}
                  />
                </div>

                {timeSurgeEnabled && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>🌅 Morning Bonus (₦)</Label>
                      <Input
                        type="number" min="0" step="50"
                        value={settings['rider_time_surge_morning'] || '0'}
                        onChange={(e) => onSettingChange('rider_time_surge_morning', e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {settings['rider_morning_start_hour'] || '6'}:00 – {settings['rider_morning_end_hour'] || '12'}:00
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>☀️ Afternoon Bonus (₦)</Label>
                      <Input
                        type="number" min="0" step="50"
                        value={settings['rider_time_surge_afternoon'] || '100'}
                        onChange={(e) => onSettingChange('rider_time_surge_afternoon', e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {settings['rider_afternoon_start_hour'] || '12'}:00 – {settings['rider_afternoon_end_hour'] || '18'}:00
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>🌙 Night Bonus (₦)</Label>
                      <Input
                        type="number" min="0" step="50"
                        value={settings['rider_time_surge_night'] || '200'}
                        onChange={(e) => onSettingChange('rider_time_surge_night', e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {settings['rider_night_start_hour'] || '18'}:00 – {settings['rider_night_end_hour'] || '24'}:00
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* Weather-based surge */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <CloudRain className="w-4 h-4 text-blue-500" />
                    Weather-Based Surge
                  </h3>
                  <Switch
                    checked={weatherSurgeEnabled}
                    onCheckedChange={(checked) => onSettingChange('rider_weather_surge_enabled', checked ? 'true' : 'false')}
                  />
                </div>

                {weatherSurgeEnabled && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-3 mb-4">
                      <div className="space-y-2">
                        <Label>☀️ Clear Bonus (₦)</Label>
                        <Input
                          type="number" min="0" step="50"
                          value={settings['rider_weather_surge_clear'] || '0'}
                          onChange={(e) => onSettingChange('rider_weather_surge_clear', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>🌧️ Rain Bonus (₦)</Label>
                        <Input
                          type="number" min="0" step="50"
                          value={settings['rider_weather_surge_rain'] || '100'}
                          onChange={(e) => onSettingChange('rider_weather_surge_rain', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>⛈️ Storm Bonus (₦)</Label>
                        <Input
                          type="number" min="0" step="50"
                          value={settings['rider_weather_surge_storm'] || '300'}
                          onChange={(e) => onSettingChange('rider_weather_surge_storm', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-secondary/50 rounded-lg">
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <CloudRain className="w-4 h-4" />
                        Weather is detected automatically based on the customer's location. No manual override needed.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button onClick={onSave} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Surge Settings</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
