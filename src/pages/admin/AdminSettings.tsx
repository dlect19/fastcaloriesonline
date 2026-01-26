import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MapPin, Bike, DollarSign, Settings2, Save, Loader2 } from 'lucide-react';
import { EnvironmentSwitch } from '@/components/admin/EnvironmentSwitch';

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
    { key: 'default_rider_share_percentage', label: 'Rider Share', unit: '%', icon: Bike, description: 'Rider share of delivery fee' },
    { key: 'min_withdrawal_amount', label: 'Min Withdrawal', unit: '₦', icon: DollarSign, description: 'Minimum amount for withdrawals' },
    { key: 'vendor_earnings_hold_hours', label: 'Vendor Hold Period', unit: 'hrs', icon: Settings2, description: 'Hours to hold vendor earnings before eligible' },
    { key: 'rider_earnings_hold_hours', label: 'Rider Hold Period', unit: 'hrs', icon: Settings2, description: 'Hours to hold rider earnings before eligible' },
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
      // Update each setting
      const allConfigs = [...deliverySettingsConfig, ...financialSettingsConfig];
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

      toast({
        title: 'Settings Saved',
        description: 'Delivery settings have been updated successfully.',
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
                  <p className="text-sm text-muted-foreground mt-2">
                    Example: A 7km delivery = ₦{settings['base_delivery_fee'] || '500'} + (4 × ₦{settings['per_km_fee'] || '100'}) = 
                    <span className="text-primary font-semibold"> ₦{(parseInt(settings['base_delivery_fee'] || '500') + (4 * parseInt(settings['per_km_fee'] || '100'))).toLocaleString()}</span>
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
                    Riders receive <span className="text-primary font-medium">{settings['default_rider_share_percentage'] || '80'}%</span> of delivery fees
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Vendor earnings become available after <span className="text-primary font-medium">{settings['vendor_earnings_hold_hours'] || '24'} hours</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
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
          </div>
        )}
      </main>
    </div>
  );
}
