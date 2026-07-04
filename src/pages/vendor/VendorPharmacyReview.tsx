import { useEffect, useState } from 'react';
import { Pill, Stethoscope, AlertTriangle, Check, X, Loader2, ImageOff, RefreshCw, ShieldAlert, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';

type Rx = any;

function PrescriptionImage({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!path) return;
    supabase.storage.from('prescriptions').createSignedUrl(path, 600).then(({ data, error }) => {
      if (error || !data) setErr(true);
      else setUrl(data.signedUrl);
    });
  }, [path]);
  if (!path) return null;
  if (err) return <div className="w-full h-40 bg-muted rounded flex items-center justify-center text-muted-foreground"><ImageOff className="w-5 h-5" /></div>;
  if (!url) return <div className="w-full h-40 bg-muted rounded animate-pulse" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Prescription" className="w-full max-h-64 object-contain rounded border border-border bg-muted" />
    </a>
  );
}

export default function VendorPharmacyReview() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Rx[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');

  // Reject-with-suggestion dialog state
  const [rejectTarget, setRejectTarget] = useState<Rx | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [suggestedDrug, setSuggestedDrug] = useState('');
  const [pharmacistNote, setPharmacistNote] = useState('');

  // Approve-with-instructions dialog state
  const [approveTarget, setApproveTarget] = useState<Rx | null>(null);
  const [approveInstructions, setApproveInstructions] = useState('');

  const [actingId, setActingId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: ownedVendor } = await supabase.from('vendors').select('id').eq('user_id', user.id).maybeSingle();
    let vendorIds: string[] = ownedVendor ? [ownedVendor.id] : [];
    if (!ownedVendor) {
      const { data: staff } = await (supabase as any)
        .from('vendor_staff')
        .select('vendor_id, is_pharmacist')
        .eq('user_id', user.id)
        .eq('is_active', true);
      vendorIds = (staff || []).filter((s: any) => s.is_pharmacist).map((s: any) => s.vendor_id);
    }
    if (vendorIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await (supabase as any)
      .from('prescription_orders')
      .select('*, orders(order_number, user_id, status), products(name, medicine_classification)')
      .in('vendor_id', vendorIds)
      .eq('requires_approval', true)
      .order('is_emergency', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: 'Failed to load', description: error.message, variant: 'destructive' });
    }
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase
      .channel('rx-review')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescription_orders' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const openApprove = (rx: Rx) => {
    setApproveTarget(rx);
    setApproveInstructions(rx.pharmacist_dosage_instructions || rx.pharmacist_instructions || '');
  };

  const submitApprove = async () => {
    if (!approveTarget) return;
    if (!approveInstructions.trim()) {
      toast({ title: 'Please add usage instructions', description: "Tell the customer how to take this medicine (e.g. 1 tablet after meals, 3× daily for 5 days).", variant: 'destructive' });
      return;
    }
    setActingId(approveTarget.id);
    const { error } = await (supabase as any).rpc('approve_prescription_with_instructions', {
      _prescription_id: approveTarget.id,
      _instructions: approveInstructions.trim(),
    });
    setActingId(null);
    if (error) { toast({ title: 'Approve failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Approved — customer will see your instructions' });
    setApproveTarget(null);
    setApproveInstructions('');
    load();
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast({ title: 'Reason required', variant: 'destructive' }); return; }
    setActingId(rejectTarget.id);
    const { error } = await (supabase as any).rpc('reject_prescription_with_suggestion', {
      _prescription_id: rejectTarget.id,
      _reason: rejectReason.trim(),
      _suggested_drug: suggestedDrug.trim() || null,
      _note: pharmacistNote.trim() || null,
    });
    setActingId(null);
    if (error) { toast({ title: 'Reject failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Rejected — customer refunded to wallet' });
    setRejectTarget(null);
    setRejectReason('');
    setSuggestedDrug('');
    setPharmacistNote('');
    load();
  };

  const filter = (s: string) => {
    if (s === 'emergency') return rows.filter(r => r.is_emergency && r.approval_status === 'pending');
    return rows.filter(r => r.approval_status === s);
  };

  const counts = {
    pending: rows.filter(r => r.approval_status === 'pending').length,
    approved: rows.filter(r => r.approval_status === 'approved').length,
    rejected: rows.filter(r => r.approval_status === 'rejected').length,
    emergency: rows.filter(r => r.is_emergency && r.approval_status === 'pending').length,
  };

  const renderCard = (rx: Rx) => {
    const cls = rx.products?.medicine_classification;
    const noDoctorRx = rx.prescription_type !== 'doctor';
    return (
      <div key={rx.id} className={`p-4 rounded-xl border bg-card ${rx.is_emergency && rx.approval_status === 'pending' ? 'border-warning ring-1 ring-warning/30' : 'border-border'}`}>
        <div className="flex items-start justify-between mb-2 gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill className="w-4 h-4 text-primary flex-shrink-0" />
              <p className="font-semibold truncate">{rx.products?.name || 'Drug'}</p>
              {cls === 'controlled' && <Badge variant="destructive" className="text-[10px]"><ShieldAlert className="w-3 h-3 mr-1" />Controlled</Badge>}
              {cls === 'prescription' && <Badge variant="secondary" className="text-[10px]">Rx</Badge>}
              {rx.is_emergency && <Badge className="bg-warning text-warning-foreground text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" />Emergency</Badge>}
              {noDoctorRx && <Badge variant="outline" className="text-[10px]">No doctor's Rx</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Order #{rx.orders?.order_number} · Qty {rx.total_quantity} · {format(new Date(rx.created_at), 'PP p')}
            </p>
          </div>
          <Badge variant={rx.approval_status === 'approved' ? 'default' : rx.approval_status === 'rejected' ? 'destructive' : 'secondary'} className="capitalize">
            {rx.approval_status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Stethoscope className="w-3 h-3" />
              {rx.prescription_type === 'doctor' ? "Doctor's prescription" : "Customer has NO doctor's prescription"}
            </div>

            {/* Customer-supplied symptoms — critical for the no-Rx pharmacist review */}
            {rx.symptoms && (
              <div className="p-2 rounded bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-1 text-[11px] font-medium text-primary mb-0.5">
                  <MessageSquare className="w-3 h-3" /> Customer's symptoms
                </div>
                <p className="text-xs text-foreground">{rx.symptoms}</p>
              </div>
            )}

            {rx.doctor_name && <p className="text-xs"><span className="text-muted-foreground">Doctor:</span> {rx.doctor_name}{rx.hospital_name ? ` · ${rx.hospital_name}` : ''}</p>}
            {rx.doctor_instructions && <p className="text-xs italic">"{rx.doctor_instructions}"</p>}
            <div className="text-xs">
              <span className="text-muted-foreground">Customer's proposed schedule: </span>
              🌅 {rx.morning_dose} · ☀️ {rx.afternoon_dose} · 🌙 {rx.night_dose} {rx.dose_unit}
              {' · '}{rx.dosage_duration_days} day(s)
            </div>
            {rx.is_emergency && rx.emergency_reason && (
              <p className="text-xs p-2 rounded bg-warning/10 border border-warning/30">
                <strong>Emergency:</strong> {rx.emergency_reason}
              </p>
            )}
            {rx.approval_status === 'approved' && rx.pharmacist_dosage_instructions && (
              <p className="text-xs p-2 rounded bg-calorie-low/10 border border-calorie-low/30">
                <span className="font-medium">Your instructions to the customer: </span>
                {rx.pharmacist_dosage_instructions}
              </p>
            )}
          </div>
          <div>
            {rx.prescription_image_url ? (
              <PrescriptionImage path={rx.prescription_image_url} />
            ) : (
              <div className="text-xs text-muted-foreground italic p-3 bg-muted rounded">
                No prescription image {noDoctorRx ? "— review symptoms above and either approve with dosage instructions, or suggest a different drug." : "(customer relying on pharmacist guidance)"}
              </div>
            )}
          </div>
        </div>

        {rx.approval_status === 'pending' && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border">
            <Button size="sm" onClick={() => openApprove(rx)} disabled={actingId === rx.id} className="flex-1">
              {actingId === rx.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" />Approve & Send Instructions</>}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setRejectTarget(rx)} disabled={actingId === rx.id} className="flex-1">
              <X className="w-4 h-4 mr-1" />Cancel & Suggest Alt.
            </Button>
          </div>
        )}
        {rx.approval_status === 'rejected' && (
          <div className="mt-2 pt-2 border-t border-border space-y-1">
            {rx.rejection_reason && <p className="text-xs text-destructive">Reason: {rx.rejection_reason}</p>}
            {rx.pharmacist_suggested_drug && (
              <p className="text-xs p-2 rounded bg-warning/10 border border-warning/30">
                <span className="font-medium">Suggested drug: </span>{rx.pharmacist_suggested_drug}
              </p>
            )}
            {rx.pharmacist_note && <p className="text-xs italic text-muted-foreground">"{rx.pharmacist_note}"</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <VendorLayout>
      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Pill className="w-6 h-6 text-primary" />Pharmacist Review</h1>
            <p className="text-sm text-muted-foreground">Review symptoms or prescriptions, approve with usage instructions, or suggest an alternative drug.</p>
          </div>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="pending">Pending {counts.pending > 0 && <Badge className="ml-1 h-4 px-1 text-[10px]">{counts.pending}</Badge>}</TabsTrigger>
            <TabsTrigger value="emergency">
              Emergency {counts.emergency > 0 && <Badge className="ml-1 h-4 px-1 text-[10px] bg-warning text-warning-foreground">{counts.emergency}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          {(['pending', 'emergency', 'approved', 'rejected'] as const).map(t => (
            <TabsContent key={t} value={t} className="space-y-3 mt-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>
              ) : filter(t).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">No prescriptions in this tab.</div>
              ) : (
                filter(t).map(renderCard)
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Approve with dosage instructions */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o) { setApproveTarget(null); setApproveInstructions(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve — send usage instructions</DialogTitle>
            <DialogDescription>
              {approveTarget?.products?.name} · Order #{approveTarget?.orders?.order_number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {approveTarget?.symptoms && (
              <div className="p-2 rounded bg-primary/5 border border-primary/20 text-xs">
                <span className="font-medium">Customer's symptoms: </span>{approveTarget.symptoms}
              </div>
            )}
            <Label>How should the customer take it? <span className="text-destructive">*</span></Label>
            <Textarea
              value={approveInstructions}
              onChange={(e) => setApproveInstructions(e.target.value)}
              placeholder="e.g. 1 tablet after meals, 3× daily for 5 days. Do not skip doses. Complete full course."
              rows={4}
            />
            <p className="text-[11px] text-muted-foreground">The customer sees this in their order details and drug reminders.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setApproveTarget(null); setApproveInstructions(''); }}>Cancel</Button>
            <Button onClick={submitApprove} disabled={actingId === approveTarget?.id}>
              {actingId === approveTarget?.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve & Notify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject with suggested alternative */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(''); setSuggestedDrug(''); setPharmacistNote(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel item & suggest alternative</DialogTitle>
            <DialogDescription>
              {rejectTarget?.products?.name} — the customer is refunded to their wallet automatically. Other items in the order continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {rejectTarget?.symptoms && (
              <div className="p-2 rounded bg-primary/5 border border-primary/20 text-xs">
                <span className="font-medium">Customer's symptoms: </span>{rejectTarget.symptoms}
              </div>
            )}

            <div className="space-y-1">
              <Label>Why are you cancelling? <span className="text-destructive">*</span></Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Symptoms don't match this drug, contraindicated with described condition, dosage requested is unsafe…"
                rows={2}
              />
            </div>

            <div className="space-y-1">
              <Label>Suggest a different drug <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={suggestedDrug}
                onChange={(e) => setSuggestedDrug(e.target.value)}
                placeholder="e.g. Paracetamol 500mg"
              />
            </div>

            <div className="space-y-1">
              <Label>Note to the customer <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                value={pharmacistNote}
                onChange={(e) => setPharmacistNote(e.target.value)}
                placeholder="e.g. Based on your symptoms, Paracetamol will be more effective and safer. Please reorder with that instead."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason(''); setSuggestedDrug(''); setPharmacistNote(''); }}>Back</Button>
            <Button variant="destructive" onClick={submitReject} disabled={actingId === rejectTarget?.id}>
              {actingId === rejectTarget?.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cancel & Refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VendorLayout>
  );
}
