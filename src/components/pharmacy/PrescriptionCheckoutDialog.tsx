import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ImagePlus, X, Pill, FileText, Stethoscope, Clock } from 'lucide-react';

interface PharmacyItem {
  productId: string;
  productName: string;
  quantity: number;
  requiresPrescription: boolean;
  pharmacistInstructions: string | null;
  defaultFrequency: string | null;
  defaultDuration: number | null;
  defaultQtyPerDose: number | null;
}

interface PrescriptionData {
  productId: string;
  isPrescription: boolean;
  prescriptionImageUrl: string | null;
  doctorInstructions: string;
  pharmacistInstructions: string;
  dosageFrequency: string;
  dosageDurationDays: number;
  quantityPerDose: number;
  totalQuantity: number;
  requiresApproval: boolean;
}

interface PrescriptionCheckoutDialogProps {
  open: boolean;
  onClose: () => void;
  pharmacyItems: PharmacyItem[];
  onComplete: (prescriptions: PrescriptionData[]) => void;
  vendorId: string;
}

const FREQUENCY_OPTIONS = [
  { value: 'once_daily', label: 'Once Daily', timesPerDay: 1 },
  { value: 'twice_daily', label: 'Twice Daily', timesPerDay: 2 },
  { value: 'three_times_daily', label: '3 Times Daily', timesPerDay: 3 },
  { value: 'four_times_daily', label: '4 Times Daily', timesPerDay: 4 },
  { value: 'every_6_hours', label: 'Every 6 Hours', timesPerDay: 4 },
  { value: 'every_8_hours', label: 'Every 8 Hours', timesPerDay: 3 },
  { value: 'as_needed', label: 'As Needed', timesPerDay: 0 },
];

export function PrescriptionCheckoutDialog({ open, onClose, pharmacyItems, onComplete, vendorId }: PrescriptionCheckoutDialogProps) {
  const { toast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prescriptions, setPrescriptions] = useState<PrescriptionData[]>(
    pharmacyItems.map(item => ({
      productId: item.productId,
      isPrescription: item.requiresPrescription,
      prescriptionImageUrl: null,
      doctorInstructions: '',
      pharmacistInstructions: item.pharmacistInstructions || '',
      dosageFrequency: item.defaultFrequency || 'twice_daily',
      dosageDurationDays: item.defaultDuration || 7,
      quantityPerDose: item.defaultQtyPerDose || 1,
      totalQuantity: item.quantity,
      requiresApproval: item.requiresPrescription,
    }))
  );
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = prescriptions[currentIndex];
  const item = pharmacyItems[currentIndex];

  const updateCurrent = (updates: Partial<PrescriptionData>) => {
    setPrescriptions(prev => prev.map((p, i) => i === currentIndex ? { ...p, ...updates } : p));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `prescriptions/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('vendor-assets').upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('vendor-assets').getPublicUrl(path);
      updateCurrent({ prescriptionImageUrl: publicUrl });
      setImagePreview(URL.createObjectURL(file));
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < pharmacyItems.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setImagePreview(null);
    } else {
      onComplete(prescriptions);
    }
  };

  const totalDoses = (() => {
    const freq = FREQUENCY_OPTIONS.find(f => f.value === current.dosageFrequency);
    return (freq?.timesPerDay || 1) * current.dosageDurationDays * current.quantityPerDose;
  })();

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="w-5 h-5 text-primary" />
            Drug Details ({currentIndex + 1}/{pharmacyItems.length})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drug info */}
          <div className="p-3 bg-secondary/50 rounded-lg">
            <p className="font-semibold text-foreground">{item.productName}</p>
            <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
            {item.requiresPrescription && <Badge variant="destructive" className="mt-1 text-xs">Requires Prescription</Badge>}
          </div>

          {/* Prescription toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-primary" />
              <Label>Do you have a doctor's prescription?</Label>
            </div>
            <Switch checked={current.isPrescription} onCheckedChange={v => updateCurrent({ isPrescription: v, requiresApproval: v })} />
          </div>

          {/* Prescription image upload */}
          {current.isPrescription && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><FileText className="w-4 h-4" /> Upload Prescription</Label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              {imagePreview || current.prescriptionImageUrl ? (
                <div className="relative w-full h-40 rounded-lg overflow-hidden bg-secondary">
                  <img src={imagePreview || current.prescriptionImageUrl!} alt="Prescription" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => { updateCurrent({ prescriptionImageUrl: null }); setImagePreview(null); }} className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="w-full h-32 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors" disabled={uploading}>
                  <ImagePlus className="w-8 h-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Upload prescription image'}</span>
                </button>
              )}
              <div className="space-y-1">
                <Label>Doctor's Instructions</Label>
                <Textarea value={current.doctorInstructions} onChange={e => updateCurrent({ doctorInstructions: e.target.value })} placeholder="Enter the dosage instructions from your doctor..." rows={2} />
              </div>
            </div>
          )}

          {/* Dosage settings (using pharmacist defaults or doctor overrides) */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              {current.isPrescription ? "Doctor's Dosage Schedule" : "Pharmacist Recommended Dosage"}
            </p>
            
            {!current.isPrescription && current.pharmacistInstructions && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <p className="text-sm text-foreground">{current.pharmacistInstructions}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Frequency</Label>
                <Select value={current.dosageFrequency} onValueChange={v => updateCurrent({ dosageFrequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duration (days)</Label>
                <Input type="number" value={current.dosageDurationDays} onChange={e => updateCurrent({ dosageDurationDays: parseInt(e.target.value) || 1 })} min="1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Qty per dose</Label>
                <Input type="number" value={current.quantityPerDose} onChange={e => updateCurrent({ quantityPerDose: parseInt(e.target.value) || 1 })} min="1" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total doses</Label>
                <div className="h-10 flex items-center px-3 bg-secondary rounded-md text-sm font-medium">{totalDoses}</div>
              </div>
            </div>
          </div>

          {/* Vendor approval toggle for Rx drugs */}
          {item.requiresPrescription && (
            <div className="flex items-center justify-between p-3 bg-warning/5 rounded-lg border border-warning/20">
              <Label className="text-sm">Pharmacist must approve before processing</Label>
              <Switch checked={current.requiresApproval} onCheckedChange={v => updateCurrent({ requiresApproval: v })} />
            </div>
          )}

          <Button className="w-full" onClick={handleNext}>
            {currentIndex < pharmacyItems.length - 1 ? 'Next Drug →' : 'Confirm & Proceed'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
