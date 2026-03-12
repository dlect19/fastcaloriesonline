import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { Gift, Settings, BarChart3, Percent, Users, DollarSign, Loader2, Save } from 'lucide-react';
import { format, subDays } from 'date-fns';

interface PromoStats {
  stat_date: string;
  total_promo_cost: number;
  total_revenue: number;
  high_discount_winners: number;
}

interface SpinSegment {
  id: string;
  segment_label: string;
  discount_percentage: number;
  probability_weight: number;
  color: string;
  is_try_again: boolean;
  sort_order?: number;
}

interface SpinSegment {
  id: string;
  segment_label: string;
  discount_percentage: number;
  probability_weight: number;
  color: string;
  is_try_again: boolean;
}

interface WheelConfig {
  id: string;
  wheel_type: string;
  cost: number;
  is_active: boolean;
  segments: SpinSegment[];
}

export default function AdminRewards() {
  const { toast } = useToast();
  const { hasPermission, loading: permLoading } = useAdminPermissions();
  const { settings, updateSetting, loading: settingsLoading } = usePlatformSettings();
  const [saving, setSaving] = useState(false);
  const [wheelsConfig, setWheelsConfig] = useState<WheelConfig[]>([]);
  const [promoStats, setPromoStats] = useState<PromoStats[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  // Local settings state
  const [localSettings, setLocalSettings] = useState({
    firstOrderEnabled: true,
    firstOrderPercent: '5',
    loyaltyEnabled: true,
    loyaltyPercent: '10',
    spinFreeEnabled: true,
    spinPaidEnabled: true,
    expiryHours: '24',
    revenueCap: '10',
    winnerLimit: '200',
    // New unified segment settings
    segmentDiscounts: '0,2,5,8,10',
    segmentWeights: '25,25,20,15,10,5',
    segmentColors: '#6B7280,#10B981,#3B82F6,#8B5CF6,#F59E0B,#EF4444',
    // Spins per tier
    tier1Spins: '1',
    tier2Spins: '3',
    tier3Spins: '6',
  });

  // Fetch wheel configurations
  const fetchWheelsConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('spin_wheel_config')
        .select(`*, spin_wheel_segments(*)`)
        .order('cost', { ascending: true });

      if (error) throw error;

      setWheelsConfig(data?.map(w => ({
        id: w.id,
        wheel_type: w.wheel_type,
        cost: Number(w.cost),
        is_active: w.is_active,
        segments: (w.spin_wheel_segments || []).sort((a: SpinSegment, b: SpinSegment) => 
          (a.sort_order || 0) - (b.sort_order || 0)
        ),
      })) || []);
    } catch (error) {
      console.error('Error fetching wheels:', error);
    }
  };

  // Fetch promo analytics
  const fetchPromoStats = async () => {
    setLoadingStats(true);
    try {
      const { data: envSetting } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'platform_environment')
        .single();

      const environment = envSetting?.value || 'development';

      // Get last 30 days of promo stats
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from('daily_promo_stats')
        .select('*')
        .eq('environment', environment)
        .gte('stat_date', thirtyDaysAgo)
        .order('stat_date', { ascending: false });

      if (error) throw error;
      setPromoStats(data || []);
    } catch (error) {
      console.error('Error fetching promo stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  // Load settings into local state
  useEffect(() => {
    if (settings) {
      setLocalSettings({
        firstOrderEnabled: settings.promo_first_order_enabled === 'true',
        firstOrderPercent: settings.promo_first_order_percent || '5',
        loyaltyEnabled: settings.promo_loyalty_enabled === 'true',
        loyaltyPercent: settings.promo_loyalty_percent || '10',
        spinFreeEnabled: settings.spin_free_enabled === 'true',
        spinPaidEnabled: settings.spin_paid_enabled === 'true',
        expiryHours: settings.spin_discount_expiry_hours || '24',
        revenueCap: settings.spin_max_discount_percent || '10',
        winnerLimit: settings.promo_daily_winner_limit || '200',
        // Unified segment settings
        segmentDiscounts: settings.spin_segment_discounts || '0,2,5,8,10',
        segmentWeights: settings.spin_segment_weights || '25,25,20,15,10,5',
        segmentColors: settings.spin_segment_colors || '#6B7280,#10B981,#3B82F6,#8B5CF6,#F59E0B,#EF4444',
        // Spins per tier
        tier1Spins: settings.spin_tier1_spins || '1',
        tier2Spins: settings.spin_tier2_spins || '3',
        tier3Spins: settings.spin_tier3_spins || '6',
      });
    }
  }, [settings]);

  useEffect(() => {
    fetchWheelsConfig();
    fetchPromoStats();
  }, []);

  // Save all settings
  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateSetting('promo_first_order_enabled', String(localSettings.firstOrderEnabled)),
        updateSetting('promo_first_order_percent', localSettings.firstOrderPercent),
        updateSetting('promo_loyalty_enabled', String(localSettings.loyaltyEnabled)),
        updateSetting('promo_loyalty_percent', localSettings.loyaltyPercent),
        updateSetting('spin_free_enabled', String(localSettings.spinFreeEnabled)),
        updateSetting('spin_paid_enabled', String(localSettings.spinPaidEnabled)),
        updateSetting('spin_discount_expiry_hours', localSettings.expiryHours),
        updateSetting('spin_max_discount_percent', localSettings.revenueCap),
        updateSetting('promo_daily_winner_limit', localSettings.winnerLimit),
        // Unified segment settings
        updateSetting('spin_segment_discounts', localSettings.segmentDiscounts),
        updateSetting('spin_segment_weights', localSettings.segmentWeights),
        updateSetting('spin_segment_colors', localSettings.segmentColors),
        // Spins per tier
        updateSetting('spin_tier1_spins', localSettings.tier1Spins),
        updateSetting('spin_tier2_spins', localSettings.tier2Spins),
        updateSetting('spin_tier3_spins', localSettings.tier3Spins),
      ]);

      toast({ title: 'Settings saved successfully' });
    } catch (error) {
      toast({ title: 'Error saving settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Toggle wheel active status
  const toggleWheelActive = async (wheelId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('spin_wheel_config')
        .update({ is_active: isActive })
        .eq('id', wheelId);

      if (error) throw error;
      
      await fetchWheelsConfig();
      toast({ title: `Wheel ${isActive ? 'enabled' : 'disabled'}` });
    } catch (error) {
      toast({ title: 'Error updating wheel', variant: 'destructive' });
    }
  };

  // Calculate totals
  const totalPromoCost = promoStats.reduce((sum, s) => sum + Number(s.total_promo_cost), 0);
  const totalRevenue = promoStats.reduce((sum, s) => sum + Number(s.total_revenue), 0);
  const avgPromoCostPercent = totalRevenue > 0 ? (totalPromoCost / totalRevenue) * 100 : 0;

  if (permLoading || settingsLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  if (!hasPermission('manage_promos')) {
    return (
      <AdminLayout>
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">You don't have permission to manage rewards.</p>
            </CardContent>
          </Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Gift className="w-6 h-6 text-primary" />
                Rewards & Promotions
              </h1>
              <p className="text-muted-foreground">
                Manage spin wheels, discounts, and promotional campaigns
              </p>
            </div>
            <Button onClick={handleSaveSettings} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save All Settings
            </Button>
          </div>

          {/* Analytics Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <DollarSign className="w-8 h-8 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total Promo Cost (30d)</p>
                    <p className="text-2xl font-bold">₦{totalPromoCost.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Percent className="w-8 h-8 text-accent" />
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Promo % of Revenue</p>
                    <p className="text-2xl font-bold">{avgPromoCostPercent.toFixed(2)}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Users className="w-8 h-8 text-info" />
                  <div>
                    <p className="text-sm text-muted-foreground">High Discount Winners (30d)</p>
                    <p className="text-2xl font-bold">
                      {promoStats.reduce((sum, s) => sum + s.high_discount_winners, 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-8 h-8 text-warning" />
                  <div>
                    <p className="text-sm text-muted-foreground">Active Wheels</p>
                    <p className="text-2xl font-bold">
                      {wheelsConfig.filter(w => w.is_active).length}/{wheelsConfig.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="settings">
            <TabsList>
              <TabsTrigger value="settings">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </TabsTrigger>
              <TabsTrigger value="wheels">
                <Gift className="w-4 h-4 mr-2" />
                Spin Wheels
              </TabsTrigger>
              <TabsTrigger value="analytics">
                <BarChart3 className="w-4 h-4 mr-2" />
                Analytics
              </TabsTrigger>
            </TabsList>

            {/* Settings Tab */}
            <TabsContent value="settings" className="space-y-6 mt-6">
              {/* Order-Based Promos */}
              <Card>
                <CardHeader>
                  <CardTitle>Order-Based Promotions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* First Order Discount */}
                    <div className="space-y-4 p-4 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <Label className="font-semibold">First Order Discount</Label>
                        <Switch
                          checked={localSettings.firstOrderEnabled}
                          onCheckedChange={(v) => setLocalSettings(s => ({ ...s, firstOrderEnabled: v }))}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Apply discount on customer's first successful order
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.firstOrderPercent}
                          onChange={(e) => setLocalSettings(s => ({ ...s, firstOrderPercent: e.target.value }))}
                          className="w-24"
                          disabled={!localSettings.firstOrderEnabled}
                        />
                        <span className="text-muted-foreground">% discount</span>
                      </div>
                    </div>

                    {/* Loyalty Discount */}
                    <div className="space-y-4 p-4 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <Label className="font-semibold">Loyalty Discount (Every 10th Order)</Label>
                        <Switch
                          checked={localSettings.loyaltyEnabled}
                          onCheckedChange={(v) => setLocalSettings(s => ({ ...s, loyaltyEnabled: v }))}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Reward customers on every 10th completed order
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.loyaltyPercent}
                          onChange={(e) => setLocalSettings(s => ({ ...s, loyaltyPercent: e.target.value }))}
                          className="w-24"
                          disabled={!localSettings.loyaltyEnabled}
                        />
                        <span className="text-muted-foreground">% discount</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Spin Wheel Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Spin Wheel Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <Label className="font-semibold">Free Daily Spin</Label>
                        <p className="text-sm text-muted-foreground">Allow one free spin per day</p>
                      </div>
                      <Switch
                        checked={localSettings.spinFreeEnabled}
                        onCheckedChange={(v) => setLocalSettings(s => ({ ...s, spinFreeEnabled: v }))}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <Label className="font-semibold">Paid Spin Wheels</Label>
                        <p className="text-sm text-muted-foreground">Allow wallet-funded spins</p>
                      </div>
                      <Switch
                        checked={localSettings.spinPaidEnabled}
                        onCheckedChange={(v) => setLocalSettings(s => ({ ...s, spinPaidEnabled: v }))}
                      />
                    </div>
                    <div className="space-y-2 p-4 border rounded-lg">
                      <Label className="font-semibold">Discount Expiry</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.expiryHours}
                          onChange={(e) => setLocalSettings(s => ({ ...s, expiryHours: e.target.value }))}
                          className="w-20"
                        />
                        <span className="text-muted-foreground">hours</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Algorithm Controls */}
              <Card>
                <CardHeader>
                  <CardTitle>Win Algorithm Controls</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    Control how often high-value discounts are awarded to protect platform revenue.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2 p-4 border rounded-lg">
                      <Label className="font-semibold">Max Discount Cap</Label>
                      <p className="text-sm text-muted-foreground">
                        Maximum discount percentage from spin wheel
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.revenueCap}
                          onChange={(e) => setLocalSettings(s => ({ ...s, revenueCap: e.target.value }))}
                          className="w-24"
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    </div>
                    <div className="space-y-2 p-4 border rounded-lg">
                      <Label className="font-semibold">Daily High-Discount Winner Limit</Label>
                      <p className="text-sm text-muted-foreground">
                        Maximum users who can win 30%+ discounts per day
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.winnerLimit}
                          onChange={(e) => setLocalSettings(s => ({ ...s, winnerLimit: e.target.value }))}
                          className="w-24"
                        />
                        <span className="text-muted-foreground">users</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Unified Segment Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle>Spin Wheel Segments (Unified)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    Configure the discount segments that appear on ALL spin wheels. The last weight is for "Try Again".
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label className="font-semibold">Discount Percentages</Label>
                      <p className="text-xs text-muted-foreground">
                        Comma-separated (e.g., 0,2,5,8,10)
                      </p>
                      <Input
                        value={localSettings.segmentDiscounts}
                        onChange={(e) => setLocalSettings(s => ({ ...s, segmentDiscounts: e.target.value }))}
                        placeholder="0,2,5,8,10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-semibold">Probability Weights</Label>
                      <p className="text-xs text-muted-foreground">
                        Comma-separated, +1 for Try Again
                      </p>
                      <Input
                        value={localSettings.segmentWeights}
                        onChange={(e) => setLocalSettings(s => ({ ...s, segmentWeights: e.target.value }))}
                        placeholder="25,25,20,15,10,5"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-semibold">Segment Colors</Label>
                      <p className="text-xs text-muted-foreground">
                        Comma-separated hex colors
                      </p>
                      <Input
                        value={localSettings.segmentColors}
                        onChange={(e) => setLocalSettings(s => ({ ...s, segmentColors: e.target.value }))}
                        placeholder="#6B7280,#10B981,..."
                      />
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="border rounded-lg p-4 bg-muted/50">
                    <Label className="font-semibold mb-3 block">Segment Preview</Label>
                    <div className="flex flex-wrap gap-2">
                      {localSettings.segmentDiscounts.split(',').map((d, i) => {
                        const colors = localSettings.segmentColors.split(',');
                        const weights = localSettings.segmentWeights.split(',');
                        return (
                          <div 
                            key={i}
                            className="px-3 py-1 rounded-full text-white text-sm font-medium"
                            style={{ backgroundColor: colors[i]?.trim() || '#6B7280' }}
                          >
                            {d.trim()}% (w:{weights[i]?.trim() || '?'})
                          </div>
                        );
                      })}
                      <div 
                        className="px-3 py-1 rounded-full text-white text-sm font-medium"
                        style={{ backgroundColor: localSettings.segmentColors.split(',').slice(-1)[0]?.trim() || '#EF4444' }}
                      >
                        Try Again (w:{localSettings.segmentWeights.split(',').slice(-1)[0]?.trim() || '?'})
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Spins Per Tier */}
              <Card>
                <CardHeader>
                  <CardTitle>Spins Per Tier</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    Configure how many spins each paid tier provides.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2 p-4 border rounded-lg">
                      <Label className="font-semibold">Bronze Wheel (₦100)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.tier1Spins}
                          onChange={(e) => setLocalSettings(s => ({ ...s, tier1Spins: e.target.value }))}
                          className="w-20"
                          min="1"
                        />
                        <span className="text-muted-foreground">spins</span>
                      </div>
                    </div>
                    <div className="space-y-2 p-4 border rounded-lg">
                      <Label className="font-semibold">Silver Wheel (₦200)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.tier2Spins}
                          onChange={(e) => setLocalSettings(s => ({ ...s, tier2Spins: e.target.value }))}
                          className="w-20"
                          min="1"
                        />
                        <span className="text-muted-foreground">spins</span>
                      </div>
                    </div>
                    <div className="space-y-2 p-4 border rounded-lg">
                      <Label className="font-semibold">Gold Wheel (₦500)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={localSettings.tier3Spins}
                          onChange={(e) => setLocalSettings(s => ({ ...s, tier3Spins: e.target.value }))}
                          className="w-20"
                          min="1"
                        />
                        <span className="text-muted-foreground">spins</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Spin Wheels Tab */}
            <TabsContent value="wheels" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Spin Wheel Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {wheelsConfig.map(wheel => (
                      <div key={wheel.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <Gift className="w-5 h-5 text-primary" />
                            <div>
                              <h3 className="font-semibold capitalize">
                                {wheel.wheel_type === 'free' ? 'Free Daily Wheel' : 
                                 wheel.wheel_type === 'tier1' ? 'Bronze Wheel (₦100)' :
                                 wheel.wheel_type === 'tier2' ? 'Silver Wheel (₦200)' :
                                 'Gold Wheel (₦500)'}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                Cost: ₦{wheel.cost} | {wheel.segments.length} segments
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={wheel.is_active ? 'default' : 'secondary'}>
                              {wheel.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                            <Switch
                              checked={wheel.is_active}
                              onCheckedChange={(v) => toggleWheelActive(wheel.id, v)}
                            />
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Segment</TableHead>
                              <TableHead>Discount</TableHead>
                              <TableHead>Probability Weight</TableHead>
                              <TableHead>Color</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {wheel.segments.map(seg => (
                              <TableRow key={seg.id}>
                                <TableCell className="font-medium">{seg.segment_label}</TableCell>
                                <TableCell>
                                  {seg.is_try_again ? (
                                    <Badge variant="outline">Try Again</Badge>
                                  ) : (
                                    `${seg.discount_percentage}%`
                                  )}
                                </TableCell>
                                <TableCell>{seg.probability_weight}</TableCell>
                                <TableCell>
                                  <div 
                                    className="w-6 h-6 rounded border"
                                    style={{ backgroundColor: seg.color }}
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Analytics Tab */}
            <TabsContent value="analytics" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Promo Analytics (Last 30 Days)</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingStats ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : promoStats.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">
                      No promo data available yet
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Promo Cost</TableHead>
                          <TableHead>Revenue</TableHead>
                          <TableHead>Promo %</TableHead>
                          <TableHead>High Discount Winners</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {promoStats.map(stat => (
                          <TableRow key={stat.stat_date}>
                            <TableCell>{format(new Date(stat.stat_date), 'MMM d, yyyy')}</TableCell>
                            <TableCell>₦{Number(stat.total_promo_cost).toLocaleString()}</TableCell>
                            <TableCell>₦{Number(stat.total_revenue).toLocaleString()}</TableCell>
                            <TableCell>
                              {stat.total_revenue > 0 
                                ? ((stat.total_promo_cost / stat.total_revenue) * 100).toFixed(2)
                                : 0}%
                            </TableCell>
                            <TableCell>{stat.high_discount_winners}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
