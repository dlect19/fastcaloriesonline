import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Award, Save } from 'lucide-react';

export function AmbassadorTiers() {
  const { toast } = useToast();
  const [tiers, setTiers] = useState<any[]>([]);
  const [editing, setEditing] = useState<Record<string, any>>({});

  useEffect(() => {
    supabase.from('ambassador_tiers').select('*').order('level').then(({ data }) => {
      setTiers(data || []);
      const map: Record<string, any> = {};
      (data || []).forEach(t => { map[t.id] = { ...t }; });
      setEditing(map);
    });
  }, []);

  const handleSave = async (id: string) => {
    const t = editing[id];
    const { error } = await supabase.from('ambassador_tiers').update({
      name: t.name,
      min_registrations: Number(t.min_registrations),
      min_orders: Number(t.min_orders),
      min_revenue: Number(t.min_revenue),
      reward_description: t.reward_description,
    }).eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Tier updated!' });
    }
  };

  const tierColors = ['text-orange-700', 'text-gray-500', 'text-yellow-500', 'text-cyan-400', 'text-blue-400'];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Award className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-bold">Equity Tiers & Rewards</h2>
      </div>

      {tiers.map((tier, i) => (
        <Card key={tier.id} className="border-0 shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className={`text-base flex items-center gap-2 ${tierColors[i] || ''}`}>
              Level {tier.level}: {editing[tier.id]?.name || tier.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={editing[tier.id]?.name || ''} onChange={e => setEditing(ed => ({ ...ed, [tier.id]: { ...ed[tier.id], name: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Min Registrations</Label>
                <Input type="number" value={editing[tier.id]?.min_registrations ?? 0} onChange={e => setEditing(ed => ({ ...ed, [tier.id]: { ...ed[tier.id], min_registrations: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Min Orders</Label>
                <Input type="number" value={editing[tier.id]?.min_orders ?? 0} onChange={e => setEditing(ed => ({ ...ed, [tier.id]: { ...ed[tier.id], min_orders: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Min Revenue (₦)</Label>
                <Input type="number" value={editing[tier.id]?.min_revenue ?? 0} onChange={e => setEditing(ed => ({ ...ed, [tier.id]: { ...ed[tier.id], min_revenue: e.target.value } }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Reward Description</Label>
              <Input value={editing[tier.id]?.reward_description || ''} onChange={e => setEditing(ed => ({ ...ed, [tier.id]: { ...ed[tier.id], reward_description: e.target.value } }))} />
            </div>
            <Button size="sm" onClick={() => handleSave(tier.id)}>
              <Save className="w-4 h-4 mr-1" /> Save
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
