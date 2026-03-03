import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Check, X, MapPin, Loader2, Store, ChevronDown, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { OutletGeoLockManager } from './OutletGeoLockManager';
import { OutletCoordinateEditor } from './OutletCoordinateEditor';

interface AdminOutletListProps {
  vendors: any[];
  onRefresh: () => void;
}

export function AdminOutletList({ vendors, onRefresh }: AdminOutletListProps) {
  const { toast } = useToast();
  const [outlets, setOutlets] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [geoLockOutlet, setGeoLockOutlet] = useState<any | null>(null);

  const toggleExpand = async (vendorId: string) => {
    if (expanded[vendorId]) {
      setExpanded(prev => ({ ...prev, [vendorId]: false }));
      return;
    }

    setLoading(prev => ({ ...prev, [vendorId]: true }));
    const { data } = await supabase
      .from('vendor_outlets')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    setOutlets(prev => ({ ...prev, [vendorId]: data || [] }));
    setExpanded(prev => ({ ...prev, [vendorId]: true }));
    setLoading(prev => ({ ...prev, [vendorId]: false }));
  };

  const approveOutlet = async (outletId: string) => {
    await supabase.from('vendor_outlets').update({ is_approved: true, is_active: true }).eq('id', outletId);
    toast({ title: 'Outlet approved' });
    // Refresh the expanded vendor
    const outlet = Object.values(outlets).flat().find(o => o.id === outletId);
    if (outlet) toggleExpand(outlet.vendor_id);
    onRefresh();
  };

  const toggleOutletActive = async (outletId: string, vendorId: string, isActive: boolean) => {
    await supabase.from('vendor_outlets').update({ is_active: !isActive }).eq('id', outletId);
    toast({ title: `Outlet ${isActive ? 'deactivated' : 'activated'}` });
    toggleExpand(vendorId);
  };

  // Count pending outlets across all vendors
  const pendingCount = vendors.reduce((acc, v) => {
    const vendorOutlets = outlets[v.id] || [];
    return acc + vendorOutlets.filter(o => !o.is_approved).length;
  }, 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="w-5 h-5" />
            Vendor Outlets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {vendors.map((vendor) => (
              <div key={vendor.id} className="border rounded-lg">
                {/* Vendor row */}
                <button
                  onClick={() => toggleExpand(vendor.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {expanded[vendor.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <div>
                      <h3 className="font-medium">{vendor.name}</h3>
                      <p className="text-xs text-muted-foreground">{vendor.category} • {vendor.city}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {loading[vendor.id] && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Badge variant="secondary" className="text-xs">
                      {outlets[vendor.id]?.length || '…'} outlets
                    </Badge>
                  </div>
                </button>

                {/* Outlets */}
                {expanded[vendor.id] && (
                  <div className="border-t divide-y">
                    {(outlets[vendor.id] || []).map((outlet) => (
                      <div key={outlet.id} className="flex items-center justify-between p-4 pl-12 bg-muted/20">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{outlet.outlet_name}</span>
                            {outlet.is_default && (
                              <Badge variant="outline" className="text-xs">Default</Badge>
                            )}
                            {!outlet.is_approved && (
                              <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs">
                                Pending Approval
                              </Badge>
                            )}
                            {outlet.geo_verification_status === 'locked_pending_reverify' && (
                              <Badge variant="destructive" className="gap-1 text-xs">
                                <MapPin className="w-3 h-3" /> Geo-Locked
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {outlet.address || 'No address'}, {outlet.city || ''}
                            {outlet.outlet_code ? ` • ${outlet.outlet_code}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <OutletCoordinateEditor
                            outlet={outlet}
                            onUpdate={() => toggleExpand(vendor.id)}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setGeoLockOutlet(outlet)}
                            className="gap-1"
                          >
                            <MapPin className="w-3 h-3" /> Geo
                          </Button>

                          {!outlet.is_approved ? (
                            <Button size="sm" onClick={() => approveOutlet(outlet.id)} className="gap-1">
                              <Check className="w-3 h-3" /> Approve
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Active</span>
                              <Switch
                                checked={outlet.is_active}
                                onCheckedChange={() => toggleOutletActive(outlet.id, vendor.id, outlet.is_active)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {(outlets[vendor.id] || []).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No outlets found</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {geoLockOutlet && (
        <OutletGeoLockManager
          outletId={geoLockOutlet.id}
          outletName={geoLockOutlet.outlet_name}
          open={!!geoLockOutlet}
          onClose={() => setGeoLockOutlet(null)}
          onUpdate={() => {
            const vendorId = geoLockOutlet.vendor_id;
            setGeoLockOutlet(null);
            toggleExpand(vendorId);
            onRefresh();
          }}
        />
      )}
    </>
  );
}
