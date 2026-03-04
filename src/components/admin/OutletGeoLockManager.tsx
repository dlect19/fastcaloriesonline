import { useState, useEffect } from 'react';
import { MapPin, Lock, Unlock, Sliders, CheckCircle, XCircle, Loader2, FileText, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  outletId: string;
  outletName: string;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function OutletGeoLockManager({ outletId, outletName, open, onClose, onUpdate }: Props) {
  const { toast } = useToast();
  const [outlet, setOutlet] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toleranceInput, setToleranceInput] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchAll();
  }, [open, outletId]);

  const fetchAll = async () => {
    setLoading(true);
    const outletRes = await supabase.from('vendor_outlets').select('*').eq('id', outletId).single();
    const vendorId = outletRes.data?.vendor_id;

    const [logsRes, reqRes, docsRes] = await Promise.all([
      supabase.from('vendor_location_logs').select('*').eq('vendor_id', outletId).order('created_at', { ascending: false }).limit(50),
      supabase.from('vendor_reverification_requests').select('*').eq('vendor_id', vendorId || outletId).order('created_at', { ascending: false }),
      vendorId
        ? supabase.from('vendor_verification_documents').select('*').eq('vendor_id', vendorId).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    setOutlet(outletRes.data);
    setLogs(logsRes.data || []);
    setRequests(reqRes.data || []);
    setDocs((docsRes as any).data || []);
    setToleranceInput(String(outletRes.data?.tolerance_radius_m || 100));
    setLoading(false);
  };

  const updateTolerance = async () => {
    const val = parseInt(toleranceInput);
    if (isNaN(val) || val < 10) {
      toast({ title: 'Minimum tolerance is 10m', variant: 'destructive' });
      return;
    }
    await supabase.from('vendor_outlets').update({ tolerance_radius_m: val }).eq('id', outletId);
    toast({ title: `Tolerance updated to ${val}m` });
    fetchAll();
    onUpdate();
  };

  const manualLock = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('vendor_outlets').update({
      geo_verification_status: 'locked_pending_reverify',
      geo_locked_at: new Date().toISOString(),
      geo_lock_reason: 'Manually locked by admin',
      is_open: false,
    }).eq('id', outletId);

    await supabase.from('vendor_location_logs').insert({
      vendor_id: outletId,
      action: 'manual_lock',
      result: 'manual',
      performed_by: userId,
      notes: 'Admin manually locked outlet',
    });

    toast({ title: 'Outlet locked' });
    fetchAll();
    onUpdate();
  };

  const manualUnlock = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('vendor_outlets').update({
      geo_verification_status: 'verified',
      geo_locked_at: null,
      geo_lock_reason: null,
    }).eq('id', outletId);

    await supabase.from('vendor_location_logs').insert({
      vendor_id: outletId,
      action: 'manual_unlock',
      result: 'manual',
      performed_by: userId,
      notes: 'Admin manually unlocked outlet',
    });

    toast({ title: 'Outlet unlocked' });
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
      await supabase.from('vendor_outlets').update({
        verified_latitude: request.new_latitude,
        verified_longitude: request.new_longitude,
        geo_verification_status: 'verified',
        geo_locked_at: null,
        geo_lock_reason: null,
      }).eq('id', outletId);
    }

    setAdminNotes('');
    toast({ title: `Request ${action}` });
    setProcessing(null);
    fetchAll();
    onUpdate();
  };

  const handleDocReview = async (docId: string, action: 'approved' | 'rejected') => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('vendor_verification_documents').update({
      status: action,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: action === 'rejected' ? 'Document rejected by admin' : null,
    }).eq('id', docId);
    toast({ title: `Document ${action}` });
    fetchAll();
  };

  const getDocUrl = async (filePath: string) => {
    const { data } = await supabase.storage
      .from('vendor-verification-docs')
      .createSignedUrl(filePath, 3600);
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
    } else {
      toast({ title: 'Failed to generate document URL', variant: 'destructive' });
    }
  };

  const geoStatusColor = (status: string) => {
    switch (status) {
      case 'verified': return 'bg-green-500/10 text-green-600 border-green-500/30';
      case 'locked_pending_reverify': return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'pending_verification': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Geo-Lock: {outletName}
          </DialogTitle>
          <DialogDescription>
            Manage outlet location verification, tolerance, and reverification requests.
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
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg space-y-2">
                  <Label className="text-xs text-muted-foreground">Geo Status</Label>
                  <Badge variant="outline" className={geoStatusColor(outlet?.geo_verification_status || 'unverified')}>
                    {(outlet?.geo_verification_status || 'unverified').replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div className="p-4 border rounded-lg space-y-2">
                  <Label className="text-xs text-muted-foreground">Verified Location</Label>
                  <p className="text-sm font-mono">
                    {outlet?.verified_latitude && outlet?.verified_longitude
                      ? `${outlet.verified_latitude.toFixed(5)}, ${outlet.verified_longitude.toFixed(5)}`
                      : 'Not set'}
                  </p>
                </div>
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-2">
                  <Label>Tolerance Radius (meters)</Label>
                  <Input type="number" value={toleranceInput} onChange={(e) => setToleranceInput(e.target.value)} min={10} />
                </div>
                <Button onClick={updateTolerance} variant="outline" className="gap-1">
                  <Sliders className="w-4 h-4" /> Update
                </Button>
              </div>

              <div className="flex gap-3">
                {outlet?.geo_verification_status === 'locked_pending_reverify' ? (
                  <Button onClick={manualUnlock} variant="outline" className="gap-2">
                    <Unlock className="w-4 h-4" /> Manually Unlock
                  </Button>
                ) : (
                  <Button onClick={manualLock} variant="destructive" className="gap-2">
                    <Lock className="w-4 h-4" /> Manually Lock
                  </Button>
                )}
              </div>

              {outlet?.latitude && outlet?.longitude && !outlet?.verified_latitude && (
                <Button variant="outline" className="gap-2" onClick={async () => {
                  await supabase.from('vendor_outlets').update({
                    verified_latitude: outlet.latitude,
                    verified_longitude: outlet.longitude,
                    geo_verification_status: 'verified',
                  }).eq('id', outletId);
                  toast({ title: 'Verified location set from current GPS' });
                  fetchAll();
                  onUpdate();
                }}>
                  <MapPin className="w-4 h-4" /> Set Verified Location from GPS
                </Button>
              )}
            </TabsContent>

            <TabsContent value="requests" className="space-y-4">
              {requests.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No reverification requests</p>
              ) : requests.map(req => (
                <Card key={req.id} className="border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className={req.status === 'pending' ? 'bg-yellow-500/10 text-yellow-600' : req.status === 'approved' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'}>
                        {req.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{new Date(req.created_at).toLocaleString('en-NG')}</span>
                    </div>
                    <p className="text-sm"><strong>Reason:</strong> {req.reason}</p>
                    <p className="text-sm font-mono">New: {req.new_latitude?.toFixed(5)}, {req.new_longitude?.toFixed(5)}</p>
                    {req.status === 'pending' && (
                      <div className="space-y-2 pt-2 border-t">
                        <Textarea placeholder="Admin notes (optional)" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={2} />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleReverifyRequest(req.id, 'approved')} disabled={processing === req.id} className="gap-1">
                            <CheckCircle className="w-4 h-4" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleReverifyRequest(req.id, 'rejected')} disabled={processing === req.id} className="gap-1">
                            <XCircle className="w-4 h-4" /> Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="documents" className="space-y-3">
              {docs.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No documents uploaded</p>
              ) : (
                docs.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{(doc.document_type || '').replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">{doc.file_name}</p>
                      <Badge variant="outline" className={
                        doc.status === 'approved' ? 'bg-green-500/10 text-green-600 mt-1' :
                        doc.status === 'rejected' ? 'bg-destructive/10 text-destructive mt-1' : 'mt-1'
                      }>
                        {doc.status}
                      </Badge>
                      {doc.rejection_reason && (
                        <p className="text-xs text-destructive">{doc.rejection_reason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => getDocUrl(doc.file_url)} className="gap-1">
                        <ExternalLink className="w-3 h-3" /> View
                      </Button>
                      {doc.status === 'pending' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => handleDocReview(doc.id, 'approved')}>
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDocReview(doc.id, 'rejected')}>
                            <XCircle className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
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
                            <Badge variant="outline" className={log.result === 'passed' ? 'text-green-600' : log.result === 'failed' ? 'text-destructive' : ''}>
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
