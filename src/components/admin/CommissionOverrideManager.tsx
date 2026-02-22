import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Users, Search, Save, Loader2, Trash2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Override {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name?: string;
  commission_type: string;
  percentage_value: number | null;
  fixed_value: number | null;
  min_value: number | null;
  max_value: number | null;
  notes: string | null;
}

export function CommissionOverrideManager() {
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New override form
  const [entityType, setEntityType] = useState<string>('vendor');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<any>(null);
  const [newCommissionType, setNewCommissionType] = useState('percentage');
  const [newPercentage, setNewPercentage] = useState('');
  const [newFixed, setNewFixed] = useState('');
  const [newMin, setNewMin] = useState('');
  const [newMax, setNewMax] = useState('');

  useEffect(() => {
    fetchOverrides();
  }, []);

  const fetchOverrides = async () => {
    const { data, error } = await supabase
      .from('commission_overrides')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Enrich with entity names
      const enriched = await Promise.all(data.map(async (o) => {
        let entity_name = 'Unknown';
        if (o.entity_type === 'vendor') {
          const { data: v } = await supabase.from('vendors').select('name').eq('id', o.entity_id).maybeSingle();
          entity_name = v?.name || 'Unknown Vendor';
        } else if (o.entity_type === 'rider') {
          const { data: r } = await supabase.from('rider_profiles').select('user_id').eq('id', o.entity_id).maybeSingle();
          if (r) {
            const { data: p } = await supabase.from('profiles').select('full_name').eq('user_id', r.user_id).maybeSingle();
            entity_name = p?.full_name || 'Unknown Rider';
          }
        } else if (o.entity_type === 'logistics') {
          const { data: dc } = await supabase.from('delivery_companies').select('name').eq('id', o.entity_id).maybeSingle();
          entity_name = dc?.name || 'Unknown Company';
        }
        return { ...o, entity_name };
      }));
      setOverrides(enriched);
    }
    setLoading(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    let results: any[] = [];

    if (entityType === 'vendor') {
      const { data } = await supabase.from('vendors').select('id, name').ilike('name', `%${searchQuery}%`).limit(10);
      results = (data || []).map(v => ({ id: v.id, name: v.name }));
    } else if (entityType === 'rider') {
      const { data } = await supabase.from('profiles').select('user_id, full_name').ilike('full_name', `%${searchQuery}%`).limit(10);
      if (data) {
        for (const p of data) {
          const { data: rp } = await supabase.from('rider_profiles').select('id').eq('user_id', p.user_id).maybeSingle();
          if (rp) results.push({ id: rp.id, name: p.full_name });
        }
      }
    } else if (entityType === 'logistics') {
      const { data } = await supabase.from('delivery_companies').select('id, name').ilike('name', `%${searchQuery}%`).limit(10);
      results = (data || []).map(dc => ({ id: dc.id, name: dc.name }));
    }

    setSearchResults(results);
  };

  const handleAdd = async () => {
    if (!selectedEntity) {
      toast({ title: 'Select an entity first', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('commission_overrides').upsert({
        entity_type: entityType,
        entity_id: selectedEntity.id,
        commission_type: newCommissionType,
        percentage_value: newPercentage ? parseFloat(newPercentage) : null,
        fixed_value: newFixed ? parseFloat(newFixed) : null,
        min_value: newMin ? parseFloat(newMin) : null,
        max_value: newMax ? parseFloat(newMax) : null,
        created_by: user?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'entity_type,entity_id' });

      if (error) throw error;
      toast({ title: 'Override saved' });
      setSelectedEntity(null);
      setSearchQuery('');
      setSearchResults([]);
      setNewPercentage('');
      setNewFixed('');
      setNewMin('');
      setNewMax('');
      fetchOverrides();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('commission_overrides').delete().eq('id', id);
    if (!error) {
      setOverrides(prev => prev.filter(o => o.id !== id));
      toast({ title: 'Override removed' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Commission Overrides
        </CardTitle>
        <CardDescription>
          Set custom commission rates for specific vendors, riders, or logistics companies.
          Entities without overrides use the global default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add Override Form */}
        <div className="p-4 border border-dashed border-border rounded-lg space-y-4">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add/Update Override
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Entity Type</Label>
              <Select value={entityType} onValueChange={(v) => { setEntityType(v); setSearchResults([]); setSelectedEntity(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="rider">Rider</SelectItem>
                  <SelectItem value="logistics">Logistics Company</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Commission Type</Label>
              <Select value={newCommissionType} onValueChange={setNewCommissionType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              placeholder={`Search ${entityType}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button variant="outline" size="icon" onClick={handleSearch}>
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {searchResults.map(r => (
                <Button
                  key={r.id}
                  variant={selectedEntity?.id === r.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedEntity(r)}
                >
                  {r.name}
                </Button>
              ))}
            </div>
          )}

          {selectedEntity && (
            <div className="text-sm text-muted-foreground">
              Selected: <span className="text-foreground font-medium">{selectedEntity.name}</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(newCommissionType === 'percentage' || newCommissionType === 'hybrid') && (
              <div className="space-y-1">
                <Label className="text-xs">Percentage (%)</Label>
                <Input type="number" min="0" max="100" step="0.5" value={newPercentage} onChange={(e) => setNewPercentage(e.target.value)} />
              </div>
            )}
            {(newCommissionType === 'fixed' || newCommissionType === 'hybrid') && (
              <div className="space-y-1">
                <Label className="text-xs">Fixed (₦)</Label>
                <Input type="number" min="0" value={newFixed} onChange={(e) => setNewFixed(e.target.value)} />
              </div>
            )}
            {newCommissionType === 'hybrid' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Min (₦)</Label>
                  <Input type="number" min="0" value={newMin} onChange={(e) => setNewMin(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max (₦)</Label>
                  <Input type="number" min="0" value={newMax} onChange={(e) => setNewMax(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <Button onClick={handleAdd} disabled={saving || !selectedEntity} className="w-full sm:w-auto">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Override
          </Button>
        </div>

        <Separator />

        {/* Existing Overrides */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Active Overrides ({overrides.length})</h4>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : overrides.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No commission overrides set. All entities use global defaults.
            </p>
          ) : (
            overrides.map(o => (
              <div key={o.id} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{o.entity_name}</span>
                    <Badge variant="outline" className="text-xs capitalize">{o.entity_type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {o.commission_type === 'percentage' && `${o.percentage_value}%`}
                    {o.commission_type === 'fixed' && `₦${o.fixed_value?.toLocaleString()}`}
                    {o.commission_type === 'hybrid' && `${o.percentage_value}% (₦${o.min_value?.toLocaleString()} - ₦${o.max_value?.toLocaleString()})`}
                    {' · '}
                    <span className="capitalize">{o.commission_type}</span>
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(o.id)} className="text-destructive hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
