import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Bike, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface VehicleConfig {
  id: string;
  vehicle_type: string;
  display_name: string;
  max_delivery_distance_km: number;
  base_delivery_rate: number;
  per_km_rate: number | null;
  dispatch_radius_km: number | null;
  is_active: boolean;
  sort_order: number;
}

export function VehicleTypeSettings() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<VehicleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    const { data, error } = await supabase
      .from('vehicle_type_configs')
      .select('*')
      .order('sort_order', { ascending: true });

    if (!error && data) setConfigs(data);
    setLoading(false);
  };

  const updateConfig = (id: string, field: string, value: any) => {
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const config of configs) {
        const { error } = await supabase
          .from('vehicle_type_configs')
           .update({
             max_delivery_distance_km: config.max_delivery_distance_km,
             base_delivery_rate: config.base_delivery_rate,
             per_km_rate: config.per_km_rate,
             dispatch_radius_km: config.dispatch_radius_km,
             is_active: config.is_active,
             updated_at: new Date().toISOString(),
           } as any)
          .eq('id', config.id);

        if (error) throw error;
      }
      toast({ title: 'Vehicle configs saved' });
    } catch (err: any) {
      toast({ title: 'Error saving', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bike className="w-5 h-5 text-primary" />
          Vehicle Type Distance Rules
        </CardTitle>
        <CardDescription>
          Configure max delivery distance, dispatch radius, and base rates per vehicle type
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {configs.map((config) => (
          <div key={config.id} className="p-4 bg-secondary rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-foreground">{config.display_name}</h4>
              <Switch
                checked={config.is_active}
                onCheckedChange={(v) => updateConfig(config.id, 'is_active', v)}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Max Distance (km)</Label>
                <Input
                  type="number"
                  min="1"
                  value={config.max_delivery_distance_km}
                  onChange={(e) => updateConfig(config.id, 'max_delivery_distance_km', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dispatch Radius (km)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="Global default"
                  value={config.dispatch_radius_km ?? ''}
                  onChange={(e) => updateConfig(config.id, 'dispatch_radius_km', e.target.value ? parseFloat(e.target.value) : null)}
                />
                <p className="text-[10px] text-muted-foreground">Override global rider search radius</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Base Rate (₦)</Label>
                <Input
                  type="number"
                  min="0"
                  value={config.base_delivery_rate}
                  onChange={(e) => updateConfig(config.id, 'base_delivery_rate', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Per Km (₦)</Label>
                <Input
                  type="number"
                  min="0"
                  value={config.per_km_rate ?? ''}
                  onChange={(e) => updateConfig(config.id, 'per_km_rate', e.target.value ? parseFloat(e.target.value) : null)}
                />
              </div>
            </div>
          </div>
        ))}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Vehicle Configs
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
