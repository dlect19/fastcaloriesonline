import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminTestModeToggle } from '@/components/admin/AdminTestModeToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Gift, TrendingUp, AlertTriangle, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAdminTestMode } from '@/hooks/useAdminTestMode';
import { format } from 'date-fns';

interface ReferralRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  status: string;
  referrer_bonus: number;
  referred_bonus: number;
  created_at: string;
  completed_at: string | null;
  ip_address: string | null;
}

interface TopReferrer {
  referrer_id: string;
  full_name: string;
  count: number;
  total_earned: number;
}

export default function AdminReferrals() {
  const { toast } = useToast();
  const { isAdminTestMode } = useAdminTestMode();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [topReferrers, setTopReferrers] = useState<TopReferrer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState({
    referral_enabled: true,
    referral_referrer_bonus: 300,
    referral_new_user_bonus: 200,
    referral_min_order_amount: 2000,
    referral_bonus_expiry_days: 30,
    referral_daily_limit: 10,
  });

  const [stats, setStats] = useState({ total: 0, completed: 0, pending: 0, flagged: 0, totalPayout: 0 });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch settings
      const { data: settingsData } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', Object.keys(settings));

      if (settingsData) {
        const s = { ...settings };
        settingsData.forEach((item) => {
          const key = item.key as keyof typeof settings;
          if (key === 'referral_enabled') {
            s[key] = item.value === 'true';
          } else {
            (s as any)[key] = Number(item.value) || 0;
          }
        });
        setSettings(s);
      }

      // Fetch referrals
      const { data: refs } = await supabase
        .from('referrals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      setReferrals(refs || []);

      const completed = refs?.filter(r => r.status === 'completed') || [];
      const pending = refs?.filter(r => r.status === 'pending') || [];
      const flagged = refs?.filter(r => r.status === 'flagged') || [];
      const totalPayout = completed.reduce((s, r) => s + Number(r.referrer_bonus) + Number(r.referred_bonus), 0);

      setStats({
        total: refs?.length || 0,
        completed: completed.length,
        pending: pending.length,
        flagged: flagged.length,
        totalPayout,
      });

      // Top referrers
      const referrerMap = new Map<string, { count: number; total_earned: number }>();
      completed.forEach(r => {
        const existing = referrerMap.get(r.referrer_id) || { count: 0, total_earned: 0 };
        referrerMap.set(r.referrer_id, {
          count: existing.count + 1,
          total_earned: existing.total_earned + Number(r.referrer_bonus),
        });
      });

      const referrerIds = Array.from(referrerMap.keys());
      if (referrerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', referrerIds);

        const top: TopReferrer[] = referrerIds
          .map(id => ({
            referrer_id: id,
            full_name: profiles?.find(p => p.id === id)?.full_name || 'Unknown',
            ...referrerMap.get(id)!,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        setTopReferrers(top);
      }
    } catch (err) {
      console.error('Error fetching referral data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const updates = Object.entries(settings).map(([key, value]) => ({
        key,
        value: String(value),
        updated_at: new Date().toISOString(),
      }));

      for (const u of updates) {
        await supabase.from('platform_settings').upsert(u, { onConflict: 'key' });
      }

      toast({ title: 'Settings saved', description: 'Referral settings updated successfully' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'default';
      case 'pending': return 'secondary';
      case 'flagged': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Referral Program</h1>
            <p className="text-muted-foreground">Manage referral bonuses and track performance</p>
          </div>
          <AdminTestModeToggle />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card><CardContent className="p-4 text-center">
            <Users className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Referrals</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <Gift className="w-5 h-5 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold">{stats.completed}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <TrendingUp className="w-5 h-5 mx-auto text-orange-500 mb-1" />
            <p className="text-2xl font-bold">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <AlertTriangle className="w-5 h-5 mx-auto text-destructive mb-1" />
            <p className="text-2xl font-bold">{stats.flagged}</p>
            <p className="text-xs text-muted-foreground">Flagged</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <Gift className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">₦{stats.totalPayout.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Total Payout</p>
          </CardContent></Card>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-6">
          {/* Settings */}
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Referral Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Enable Referrals</Label>
                <Switch checked={settings.referral_enabled} onCheckedChange={(v) => setSettings(s => ({ ...s, referral_enabled: v }))} />
              </div>
              <div className="space-y-1">
                <Label>Referrer Bonus (₦)</Label>
                <Input type="number" value={settings.referral_referrer_bonus} onChange={(e) => setSettings(s => ({ ...s, referral_referrer_bonus: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>New User Bonus (₦)</Label>
                <Input type="number" value={settings.referral_new_user_bonus} onChange={(e) => setSettings(s => ({ ...s, referral_new_user_bonus: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Min Order Amount (₦)</Label>
                <Input type="number" value={settings.referral_min_order_amount} onChange={(e) => setSettings(s => ({ ...s, referral_min_order_amount: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Bonus Expiry (days)</Label>
                <Input type="number" value={settings.referral_bonus_expiry_days} onChange={(e) => setSettings(s => ({ ...s, referral_bonus_expiry_days: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Daily Limit per Referrer</Label>
                <Input type="number" value={settings.referral_daily_limit} onChange={(e) => setSettings(s => ({ ...s, referral_daily_limit: Number(e.target.value) }))} />
              </div>
              <Button className="w-full" onClick={handleSaveSettings} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Settings
              </Button>
            </CardContent>
          </Card>

          {/* Top Referrers */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Top Referrers</CardTitle>
            </CardHeader>
            <CardContent>
              {topReferrers.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">No completed referrals yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Referrals</TableHead>
                      <TableHead>Earned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topReferrers.map((r, i) => (
                      <TableRow key={r.referrer_id}>
                        <TableCell className="font-medium">{i + 1}</TableCell>
                        <TableCell>{r.full_name}</TableCell>
                        <TableCell>{r.count}</TableCell>
                        <TableCell>₦{r.total_earned.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Referrals */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Referrals</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : referrals.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No referrals yet</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Referrer Bonus</TableHead>
                      <TableHead>New User Bonus</TableHead>
                      <TableHead>Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrals.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{format(new Date(r.created_at), 'MMM d, yyyy')}</TableCell>
                        <TableCell>
                          <Badge variant={statusColor(r.status) as any}>{r.status}</Badge>
                        </TableCell>
                        <TableCell>₦{Number(r.referrer_bonus).toLocaleString()}</TableCell>
                        <TableCell>₦{Number(r.referred_bonus).toLocaleString()}</TableCell>
                        <TableCell className="text-sm">{r.completed_at ? format(new Date(r.completed_at), 'MMM d, yyyy') : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
