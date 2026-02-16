import { useState, useEffect } from 'react';
import { MapPin, Lock, Unlock, Eye, Sliders, CheckCircle, XCircle, FileText, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  vendorId: string;
  vendorName: string;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function VendorGeoLockManager({ vendorId, vendorName, open, onClose, onUpdate }: Props) {
  const { toast } = useToast();
  const [vendor, setVendor] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toleranceInput, setToleranceInput] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchAll();
  }, [open, vendorId]);

  const fetchAll = async () => {
    setLoading(true);
    const [vendorRes, logsRes, reqRes, docsRes] = await Promise.all([
      supabase.from('vendors').select('*').eq('id', vendorId).single(),
      supabase.from('vendor_location_logs').select('*').eq('vendor_id', vendorId).order('created_at', { ascending: false }).limit(50),
      supabase.from('vendor_reverification_requests').select('*').eq('vendor_id', vendorId).order('created_at', { ascending: false }),
      supabase.from('vendor_verification_documents').select('*').eq('vendor_id', vendorId).order('created_at', { ascending: false }),
    ]);
    setVendor(vendorRes.data);
    setLogs(logsRes.data || []);
    setRequests(reqRes.data || []);
    setDocs(docsRes.data || []);
    setToleranceInput(String(vendorRes.data?.tolerance_radius_m || 100));
    setLoading(false);
  };

  const updateTolerance = async () => {
    const val = parseInt(toleranceInput);
    if (isNaN(val) || val < 10) {
      toast({ title: 'Minimum tolerance is 10m', variant: 'destructive' });
      return;
    }
    await supabase.from('vendors').update({ tolerance_radius_m: val }).eq('id', vendorId);
    toast({ title: `Tolerance updated to ${val}m` });
    fetchAll();
    onUpdate();
  };

  const manualLock = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('vendors').update({
      geo_verification_status: 'locked_pending_reverify',
      geo_locked_at: new Date().toISOString(),
      geo_lock_reason: 'Manually locked by admin',
      is_open: false,
    }).eq('id', vendorId);

    await supabase.from('vendor_location_logs').insert({
      vendor_id: vendorId,
      action: 'manual_lock',
      result: 'manual',
      performed_by: userId,
      notes: 'Admin manually locked vendor',
    });

    toast({ title: 'Vendor locked' });
    fetchAll();
    onUpdate();
  };

  const manualUnlock = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('vendors').update({
      geo_verification_status: 'verified',
      geo_locked_at: null,
      geo_lock_reason: null,
    }).eq('id', vendorId);

    await supabase.from('vendor_location_logs').insert({
      vendor_id: vendorId,
      action: 'manual_unlock',
      result: 'manual',
      performed_by: userId,
      notes: 'Admin manually unlocked vendor',
    });

    toast({ title: 'Vendor unlocked' });
    fetchAll();
    onUpdate();
  };

  const handleReverifyRequest = async (requestId: string, action: 'approved' | 'rejected') => {
    setProcessing(requestId);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const request = requests.find(r => r.id === requestId);

    await supabase.from('vendor_reverification_requests').update({
      status: action,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      admin_notes: adminNotes || null,
    }).eq('id', requestId);

    if (action === 'approved' && request) {
      // Update vendor with new verified location and unlock
      await supabase.from('vendors').update({
        verified_latitude: request.new_latitude,
        verified_longitude: request.new_longitude,
        geo_verification_status: 'verified',
        geo_locked_at: null,
        geo_lock_reason: null,
      }).eq('id', vendorId);

      await supabase.from('vendor_location_logs').insert({
        vendor_id: vendorId,
        action: 'reverify_approved',
        device_latitude: request.new_latitude,
        device_longitude: request.new_longitude,
        result: 'manual',
        performed_by: userId,
        notes: adminNotes || 'Reverification approved',
      });
    } else {
      await supabase.from('vendor_location_logs').insert({
        vendor_id: vendorId,
        action: 'reverify_rejected',
        result: 'manual',
        performed_by: userId,
        notes: adminNotes || 'Reverification rejected',
      });
    }

    setAdminNotes('');
    toast({ title: `Request ${action}` });
    setProcessing(null);
    fetchAll();
    onUpdate();
  };

  const handleDocReview = async (docId: string, action: 'approved' | 'rejected', rejectionReason?: string) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('vendor_verification_documents').update({
      status: action,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: action === 'rejected' ? (rejectionReason || 'Document rejected') : null,
    }).eq('id', docId);
    toast({ title: `Document ${action}` });
    fetchAll();
  };

  const geoStatusColor = (status: string) => {
    switch (status) {
      case 'verified': return 'bg-success/10 text-success border-success/30';
      case 'locked_pending_reverify': return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'pending_verification': return 'bg-warning/10 text-warning border-warning/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Geo-Lock Management: {vendorName}
          </DialogTitle>
          <DialogDescription>
            Manage vendor location verification, tolerance, and review reverification requests.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="requests">Requests ({requests.filter(r => r.status === 'pending').length})</TabsTrigger>
              <TabsTrigger value="documents">Documents ({docs.length})</TabsTrigger>
              <TabsTrigger value="logs">Logs ({logs.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Status & Controls */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg space-y-2">
                  <Label className="text-xs text-muted-foreground">Geo Status</Label>
                  <Badge variant="outline" className={geoStatusColor(vendor?.geo_verification_status || 'unverified')}>
                    {(vendor?.geo_verification_status || 'unverified').replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div className="p-4 border rounded-lg space-y-2">
                  <Label className="text-xs text-muted-foreground">Verified Location</Label>
                  <p className="text-sm font-mono">
                    {vendor?.verified_latitude && vendor?.verified_longitude
                      ? `${vendor.verified_latitude.toFixed(5)}, ${vendor.verified_longitude.toFixed(5)}`
                      : 'Not set'}
                  </p>
                </div>
              </div>

              {/* Tolerance */}
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-2">
                  <Label>Tolerance Radius (meters)</Label>
                  <Input
                    type="number"
                    value={toleranceInput}
                    onChange={(e) => setToleranceInput(e.target.value)}
                    min={10}
                  />
                </div>
                <Button onClick={updateTolerance} variant="outline" className="gap-1">
                  <Sliders className="w-4 h-4" />
                  Update
                </Button>
              </div>

              {/* Manual Lock/Unlock */}
              <div className="flex gap-3">
                {vendor?.geo_verification_status === 'locked_pending_reverify' ? (
                  <Button onClick={manualUnlock} variant="outline" className="gap-2">
                    <Unlock className="w-4 h-4" />
                    Manually Unlock
                  </Button>
                ) : (
                  <Button onClick={manualLock} variant="destructive" className="gap-2">
                    <Lock className="w-4 h-4" />
                    Manually Lock
                  </Button>
                )}
              </div>

              {/* Set verified location from current vendor coords */}
              {vendor?.latitude && vendor?.longitude && !vendor?.verified_latitude && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={async () => {
                    await supabase.from('vendors').update({
                      verified_latitude: vendor.latitude,
                      verified_longitude: vendor.longitude,
                      geo_verification_status: 'verified',
                    }).eq('id', vendorId);
                    toast({ title: 'Verified location set from current GPS coordinates' });
                    fetchAll();
                    onUpdate();
                  }}
                >
                  <MapPin className="w-4 h-4" />
                  Set Verified Location from Current GPS
                </Button>
              )}
            </TabsContent>

            <TabsContent value="requests" className="space-y-4">
              {requests.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No reverification requests</p>
              ) : (
                requests.map(req => (
                  <Card key={req.id} className="border">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={req.status === 'pending' ? 'bg-warning/10 text-warning' : req.status === 'approved' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
                          {req.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{new Date(req.created_at).toLocaleString('en-NG')}</span>
                      </div>
                      <p className="text-sm"><strong>Reason:</strong> {req.reason}</p>
                      <p className="text-sm font-mono">New: {req.new_latitude?.toFixed(5)}, {req.new_longitude?.toFixed(5)}</p>
                      
                      {req.status === 'pending' && (
                        <div className="space-y-2 pt-2 border-t">
                          <Textarea
                            placeholder="Admin notes (optional)"
                            value={adminNotes}
                            onChange={(e) => setAdminNotes(e.target.value)}
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleReverifyRequest(req.id, 'approved')}
                              disabled={processing === req.id}
                              className="gap-1"
                            >
                              <CheckCircle className="w-4 h-4" />
                              Approve & Update Location
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReverifyRequest(req.id, 'rejected')}
                              disabled={processing === req.id}
                              className="gap-1"
                            >
                              <XCircle className="w-4 h-4" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      )}
                      {req.admin_notes && (
                        <p className="text-xs text-muted-foreground italic">Admin: {req.admin_notes}</p>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="documents" className="space-y-3">
              {docs.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No documents uploaded</p>
              ) : (
                docs.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{doc.document_type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">{doc.file_name}</p>
                      <Badge variant="outline" className={doc.status === 'approved' ? 'bg-success/10 text-success mt-1' : doc.status === 'rejected' ? 'bg-destructive/10 text-destructive mt-1' : 'mt-1'}>
                        {doc.status}
                      </Badge>
                    </div>
                    {doc.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleDocReview(doc.id, 'approved')}>
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDocReview(doc.id, 'rejected')}>
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="logs">
              {logs.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No location logs</p>
              ) : (
                <div className="max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Distance</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map(log => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs">{new Date(log.created_at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                          <TableCell className="text-xs">{log.action.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-xs">{log.distance_m ? `${log.distance_m}m` : '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={log.result === 'passed' ? 'text-success' : log.result === 'failed' ? 'text-destructive' : ''}>
                              {log.result || '—'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
