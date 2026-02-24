import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MapPin, Bike, DollarSign, Settings2, Save, Loader2, CreditCard, Navigation, Clock, Store, Bell } from 'lucide-react';
import { EnvironmentSwitch } from '@/components/admin/EnvironmentSwitch';
import { AdminTestModeToggle } from '@/components/admin/AdminTestModeToggle';
import { PaystackBalanceCard } from '@/components/admin/PaystackBalanceCard';
import { RiderPayoutSettings } from '@/components/admin/RiderPayoutSettings';
import { ServiceFeeSettings } from '@/components/admin/ServiceFeeSettings';
import { VehicleTypeSettings } from '@/components/admin/VehicleTypeSettings';
import { CommissionOverrideManager } from '@/components/admin/CommissionOverrideManager';

interface DeliverySetting {
  key: string;
  value: string;
  description: string;
}

export default function AdminSettings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});

  const deliverySettingsConfig = [
    { key: 'vendor_delivery_radius_km', label: 'Vendor Delivery Radius', unit: 'km', icon: MapPin, description: 'Maximum distance for vendors to appear in customer search' },
    { key: 'rider_search_radius_km', label: 'Rider Search Radius', unit: 'km', icon: Bike, description: 'Maximum distance to search for available riders' },
    { key: 'base_delivery_fee', label: 'Base Delivery Fee', unit: '₦', icon: DollarSign, description: 'Base fee charged for delivery' },
    { key: 'base_delivery_distance_km', label: 'Base Delivery Distance', unit: 'km', icon: MapPin, description: 'Distance covered by base delivery fee' },
    { key: 'per_km_fee', label: 'Per Kilometer Fee', unit: '₦', icon: DollarSign, description: 'Additional fee per km beyond base distance' },
    { key: 'max_delivery_distance_km', label: 'Max Delivery Distance', unit: 'km', icon: MapPin, description: 'Maximum allowed delivery distance' },
  ];

  const financialSettingsConfig = [
    { key: 'default_vendor_commission_rate', label: 'Vendor Commission Rate', unit: '%', icon: DollarSign, description: 'Platform commission on vendor orders' },
    // Removed: delivery company commission now uses unified rider_platform_fee_pct
    { key: 'default_rider_share_percentage', label: 'Rider Share', unit: '%', icon: Bike, description: 'Rider share of delivery fee' },
    { key: 'min_withdrawal_amount', label: 'Min Withdrawal', unit: '₦', icon: DollarSign, description: 'Minimum amount for withdrawals' },
    { key: 'rider_earnings_hold_hours', label: 'Rider Hold Period', unit: 'hrs', icon: Settings2, description: 'Hours to hold rider earnings before eligible' },
  ];

  const settlementSettingsConfig = [
    { key: 'settlement_hours_restaurant', label: '🍽️ Restaurant', unit: 'hrs', icon: Clock, description: 'Settlement hold for restaurant vendors', defaultVal: '0' },
    { key: 'settlement_hours_pharmacy', label: '💊 Pharmacy', unit: 'hrs', icon: Clock, description: 'Settlement hold for pharmacy vendors', defaultVal: '12' },
    { key: 'settlement_hours_market', label: '🛒 Market', unit: 'hrs', icon: Clock, description: 'Settlement hold for market vendors', defaultVal: '24' },
  ];

  const navigationApps = [
    { value: 'google_maps', label: 'Google Maps' },
    { value: 'waze', label: 'Waze' },
    { value: 'apple_maps', label: 'Apple Maps' },
    { value: 'here_wego', label: 'HERE WeGo' },
    { value: 'openstreetmap', label: 'OpenStreetMap' },
  ];

  useEffect(() => {
    checkAuth();
    fetchSettings();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/admin/auth');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) {
      navigate('/admin/auth');
    }
  };

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value, description');

      if (error) throw error;

      const settingsMap: Record<string, string> = {};
      data?.forEach(setting => {
        settingsMap[setting.key] = setting.value;
      });
      setSettings(settingsMap);
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSettingChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update each setting - include all keys that have been set
      const allConfigs = [...deliverySettingsConfig, ...financialSettingsConfig, ...settlementSettingsConfig];
      for (const config of allConfigs) {
        const value = settings[config.key];
        if (value !== undefined) {
          const { error } = await supabase
            .from('platform_settings')
            .upsert({ 
              key: config.key, 
              value, 
              description: config.description,
              updated_at: new Date().toISOString() 
            }, { onConflict: 'key' });

          if (error) throw error;
        }
      }

      // Save payout approval mode
      if (settings['payout_approval_mode']) {
        await supabase.from('platform_settings').upsert({
          key: 'payout_approval_mode',
          value: settings['payout_approval_mode'],
          description: 'Payout approval mode: auto or manual',
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      }

      // Save rider test notification toggle
      if (settings['show_rider_test_notification'] !== undefined) {
        await supabase.from('platform_settings').upsert({
          key: 'show_rider_test_notification',
          value: settings['show_rider_test_notification'],
          description: 'Show test push notification button on rider dashboard',
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      }

      // Save default navigation app
      if (settings['default_navigation_app']) {
        await supabase.from('platform_settings').upsert({
          key: 'default_navigation_app',
          value: settings['default_navigation_app'],
          description: 'Default navigation app for riders',
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      }

      // Save all rider payout settings
      const riderPayoutKeys = [
        'rider_platform_fee_pct', 'rider_platform_fee_min', 'rider_platform_fee_max',
        'rider_minimum_payout', 'rider_distance_bonus_threshold_km', 'rider_distance_bonus_rate',
        'rider_surge_enabled', 'rider_time_surge_enabled', 'rider_weather_surge_enabled',
        'rider_max_surge_cap', 'rider_time_surge_morning', 'rider_time_surge_afternoon',
        'rider_time_surge_night', 'rider_weather_surge_clear', 'rider_weather_surge_rain',
        'rider_weather_surge_storm', 'rider_weather_override',
        'rider_morning_start_hour', 'rider_morning_end_hour',
        'rider_afternoon_start_hour', 'rider_afternoon_end_hour',
        'rider_night_start_hour', 'rider_night_end_hour',
      ];
      for (const key of riderPayoutKeys) {
        if (settings[key] !== undefined) {
          await supabase.from('platform_settings').upsert({
            key,
            value: settings[key],
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
        }
      }

      // Save service fee settings
      const serviceFeeKeys = [
        'service_fee_type', 'service_fee_fixed', 'service_fee_percentage',
        'service_fee_min', 'service_fee_max',
      ];
      for (const key of serviceFeeKeys) {
        if (settings[key] !== undefined) {
          await supabase.from('platform_settings').upsert({
            key,
            value: settings[key],
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
        }
      }

      toast({
        title: 'Settings Saved',
        description: 'All platform settings have been updated successfully.',
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />
      
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Settings2 className="w-8 h-8" />
            Platform Settings
          </h1>
          <p className="text-muted-foreground">Configure delivery and location settings</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            {/* Environment Switch Section */}
            <EnvironmentSwitch />
            
            {/* Paystack Balance Card */}
            <PaystackBalanceCard />
            
            {/* Admin Test Mode (only shows when platform is in production) */}
            <AdminTestModeToggle />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  Location & Delivery Settings
                </CardTitle>
                <CardDescription>
                  Configure radius limits and delivery fee calculations for the platform
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6">
                  {/* Radius Settings */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-4">Distance Limits</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {deliverySettingsConfig.filter(c => c.unit === 'km').map((config) => {
                        const Icon = config.icon;
                        return (
                          <div key={config.key} className="space-y-2">
                            <Label htmlFor={config.key} className="flex items-center gap-2">
                              <Icon className="w-4 h-4 text-muted-foreground" />
                              {config.label}
                            </Label>
                            <div className="relative">
                              <Input
                                id={config.key}
                                type="number"
                                min="0"
                                step="0.5"
                                value={settings[config.key] || ''}
                                onChange={(e) => handleSettingChange(config.key, e.target.value)}
                                className="pr-12"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                {config.unit}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{config.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <Separator />

                  {/* Fee Settings */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-4">Delivery Fee Configuration</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {deliverySettingsConfig.filter(c => c.unit === '₦').map((config) => {
                        const Icon = config.icon;
                        return (
                          <div key={config.key} className="space-y-2">
                            <Label htmlFor={config.key} className="flex items-center gap-2">
                              <Icon className="w-4 h-4 text-muted-foreground" />
                              {config.label}
                            </Label>
                            <div className="relative">
                              <Input
                                id={config.key}
                                type="number"
                                min="0"
                                step="50"
                                value={settings[config.key] || ''}
                                onChange={(e) => handleSettingChange(config.key, e.target.value)}
                                className="pl-8"
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                ₦
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{config.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Formula Preview */}
                <div className="p-4 bg-secondary rounded-lg">
                  <h4 className="text-sm font-medium text-foreground mb-2">Delivery Fee Formula</h4>
                  <p className="text-sm text-muted-foreground">
                    For distances up to <strong>{settings['base_delivery_distance_km'] || '3'} km</strong>: 
                    <span className="text-primary font-medium"> ₦{parseInt(settings['base_delivery_fee'] || '500').toLocaleString()}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    For each additional km: 
                    <span className="text-primary font-medium"> +₦{parseInt(settings['per_km_fee'] || '100').toLocaleString()}</span>
                  </p>
                  {(() => {
                    const baseDist = parseInt(settings['base_delivery_distance_km'] || '3');
                    const exampleDist = 7;
                    const extraKm = Math.max(exampleDist - baseDist, 0);
                    const baseFee = parseInt(settings['base_delivery_fee'] || '500');
                    const perKm = parseInt(settings['per_km_fee'] || '100');
                    const total = baseFee + (extraKm * perKm);
                    return (
                      <p className="text-sm text-muted-foreground mt-2">
                        Example: A {exampleDist}km delivery = ₦{baseFee.toLocaleString()} + ({extraKm} × ₦{perKm.toLocaleString()}) = 
                        <span className="text-primary font-semibold"> ₦{total.toLocaleString()}</span>
                      </p>
                    );
                  })()}
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Financial Settings Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-primary" />
                  Commission & Financial Settings
                </CardTitle>
                <CardDescription>
                  Configure platform commissions and payout settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  {financialSettingsConfig.map((config) => {
                    const Icon = config.icon;
                    return (
                      <div key={config.key} className="space-y-2">
                        <Label htmlFor={config.key} className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                          {config.label}
                        </Label>
                        <div className="relative">
                          <Input
                            id={config.key}
                            type="number"
                            min="0"
                            step={config.unit === '%' ? '0.5' : config.unit === 'hrs' ? '1' : '100'}
                            value={settings[config.key] || ''}
                            onChange={(e) => handleSettingChange(config.key, e.target.value)}
                            className={config.unit === '₦' ? 'pl-8' : 'pr-12'}
                          />
                          <span className={`absolute ${config.unit === '₦' ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-sm text-muted-foreground`}>
                            {config.unit}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{config.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Financial Formula Preview */}
                <div className="p-4 bg-secondary rounded-lg">
                  <h4 className="text-sm font-medium text-foreground mb-2">Commission Structure</h4>
                  <p className="text-sm text-muted-foreground">
                    Platform takes <span className="text-primary font-medium">{settings['default_vendor_commission_rate'] || '15'}%</span> from vendor orders
                  </p>
                   <p className="text-sm text-muted-foreground">
                     Platform takes <span className="text-primary font-medium">{settings['rider_platform_fee_pct'] || '20'}%</span> from all delivery fees (riders &amp; logistics)
                   </p>
                  <p className="text-sm text-muted-foreground">
                    Riders receive <span className="text-primary font-medium">{settings['default_rider_share_percentage'] || '80'}%</span> of delivery fees
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Rider earnings become available <span className="text-primary font-medium">immediately</span> (hold: {settings['rider_earnings_hold_hours'] || '0'} hours)
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Service Fee Settings */}
            <ServiceFeeSettings
              settings={settings}
              onSettingChange={handleSettingChange}
              onSave={handleSave}
              saving={saving}
            />

            {/* Vehicle Type Settings */}
            <VehicleTypeSettings />

            {/* Commission Overrides */}
            <CommissionOverrideManager />

            {/* Category-Based Settlement Periods */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="w-5 h-5 text-primary" />
                  Vendor Settlement Periods
                </CardTitle>
                <CardDescription>
                  Set how long to hold vendor earnings before release, based on vendor category. Use 0 for immediate settlement.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  {settlementSettingsConfig.map((config) => (
                    <div key={config.key} className="space-y-2">
                      <Label htmlFor={config.key} className="flex items-center gap-2 text-base">
                        {config.label}
                      </Label>
                      <div className="relative">
                        <Input
                          id={config.key}
                          type="number"
                          min="0"
                          step="1"
                          value={settings[config.key] ?? config.defaultVal}
                          onChange={(e) => handleSettingChange(config.key, e.target.value)}
                          className="pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          hrs
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{config.description}</p>
                    </div>
                  ))}
                </div>

                {/* Settlement Preview */}
                <div className="p-4 bg-secondary rounded-lg">
                  <h4 className="text-sm font-medium text-foreground mb-2">Settlement Schedule</h4>
                  <p className="text-sm text-muted-foreground">
                    🍽️ Restaurant vendors: <span className="text-primary font-medium">{settings['settlement_hours_restaurant'] === '0' ? 'Immediate' : `${settings['settlement_hours_restaurant'] || '0'} hours`}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    💊 Pharmacy vendors: <span className="text-primary font-medium">{settings['settlement_hours_pharmacy'] === '0' ? 'Immediate' : `${settings['settlement_hours_pharmacy'] || '12'} hours`}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    🛒 Market vendors: <span className="text-primary font-medium">{settings['settlement_hours_market'] === '0' ? 'Immediate' : `${settings['settlement_hours_market'] || '24'} hours`}</span>
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Rider Test Notification Toggle */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary" />
                  Debug Tools
                </CardTitle>
                <CardDescription>
                  Enable or disable debug/test features for riders
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
                  <div className="space-y-1">
                    <Label className="text-base">Rider Test Notification Button</Label>
                    <p className="text-sm text-muted-foreground">
                      {settings['show_rider_test_notification'] === 'true'
                        ? 'Test push notification button is visible on rider dashboard'
                        : 'Test push notification button is hidden on rider dashboard'}
                    </p>
                  </div>
                  <Switch
                    checked={settings['show_rider_test_notification'] === 'true'}
                    onCheckedChange={(checked) => handleSettingChange('show_rider_test_notification', checked ? 'true' : 'false')}
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Payout Settings Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  Payout Settings
                </CardTitle>
                <CardDescription>
                  Configure how payouts are processed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
                  <div className="space-y-1">
                    <Label className="text-base">Automatic Payout Approval</Label>
                    <p className="text-sm text-muted-foreground">
                      {settings['payout_approval_mode'] === 'auto' 
                        ? 'Payouts are processed automatically without admin review'
                        : 'Payouts require manual admin approval before processing'}
                    </p>
                  </div>
                  <Switch
                    checked={settings['payout_approval_mode'] === 'auto'}
                    onCheckedChange={(checked) => handleSettingChange('payout_approval_mode', checked ? 'auto' : 'manual')}
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Navigation App Settings Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Navigation className="w-5 h-5 text-primary" />
                  Navigation Settings
                </CardTitle>
                <CardDescription>
                  Configure default navigation app for riders
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Default Navigation App</Label>
                  <Select
                    value={settings['default_navigation_app'] || 'google_maps'}
                    onValueChange={(value) => handleSettingChange('default_navigation_app', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select navigation app" />
                    </SelectTrigger>
                    <SelectContent>
                      {navigationApps.map((app) => (
                        <SelectItem key={app.value} value={app.value}>
                          {app.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    This app will be used as the default for riders when navigating to delivery locations
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Rider Payout Model */}
            <RiderPayoutSettings
              settings={settings}
              onSettingChange={handleSettingChange}
              onSave={handleSave}
              saving={saving}
              onImmediateSave={async (key, value) => {
                try {
                  await supabase.from('platform_settings').upsert({
                    key,
                    value,
                    updated_at: new Date().toISOString()
                  }, { onConflict: 'key' });
                  toast({ title: 'Saved', description: `${key.replace(/_/g, ' ')} updated.` });
                } catch (err) {
                  console.error('Immediate save error:', err);
                }
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
