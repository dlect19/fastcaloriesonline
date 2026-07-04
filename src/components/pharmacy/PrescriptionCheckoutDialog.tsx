import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Pill, Stethoscope, Clock, Baby, User, AlertTriangle, Phone, MessageCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PrescriptionImageUpload } from './PrescriptionImageUpload';
import { MedicineClassificationBadge } from './MedicineClassificationBadge';
import { supabase } from '@/integrations/supabase/client';

interface PharmacyItem {
  productId: string;
  productName: string;
  quantity: number;
  requiresPrescription: boolean;
  pharmacistInstructions: string | null;
  defaultFrequency: string | null;
  defaultDuration: number | null;
  defaultQtyPerDose: number | null;
  dosageForm: string | null;
  targetAgeGroup: string | null;
  medicineClassification?: 'otc' | 'prescription' | 'controlled' | null;
}

export interface PrescriptionData {
  productId: string;
  prescriptionType: 'doctor' | 'pharmacist';
  doseUnit: string;
  morningDose: number;
  afternoonDose: number;
  nightDose: number;
  doctorName: string;
  hospitalName: string;
  doctorInstructions: string;
  pharmacistInstructions: string;
  dosageFrequency: string;
  dosageDurationDays: number;
  quantityPerDose: number;
  totalQuantity: number;
  requiresApproval: boolean;
  prescriptionImageUrl: string;
  isEmergency: boolean;
  emergencyReason: string;
  symptoms: string;
}

interface PrescriptionCheckoutDialogProps {
  open: boolean;
  onClose: () => void;
  pharmacyItems: PharmacyItem[];
  onComplete: (prescriptions: PrescriptionData[]) => void;
  vendorId: string;
  userId: string;
}

export function PrescriptionCheckoutDialog({ open, onClose, pharmacyItems, onComplete, vendorId, userId }: PrescriptionCheckoutDialogProps) {
  const { toast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prescriptions, setPrescriptions] = useState<PrescriptionData[]>(
    pharmacyItems.map(item => {
      const isTablet = !item.dosageForm || ['tablet', 'capsule'].includes(item.dosageForm);
      // Approval rules (payment happens first, pharmacist reviews after):
      //  - Controlled drugs ALWAYS require pharmacist approval.
      //  - No doctor's prescription (pharmacist route) → pharmacist reviews the
      //    customer's symptoms before dispensing, can suggest a different drug.
      //  - Doctor's Rx for non-controlled → no gate, proceeds normally.
      const needsApproval = item.medicineClassification === 'controlled';
      return {
        productId: item.productId,
        prescriptionType: 'pharmacist',
        doseUnit: isTablet ? 'tablet' : 'ml',
        morningDose: 1,
        afternoonDose: 0,
        nightDose: 1,
        doctorName: '',
        hospitalName: '',
        doctorInstructions: '',
        pharmacistInstructions: item.pharmacistInstructions || '',
        dosageFrequency: item.defaultFrequency || 'twice_daily',
        dosageDurationDays: item.defaultDuration || 7,
        quantityPerDose: item.defaultQtyPerDose || 1,
        totalQuantity: item.quantity,
        // pharmacist route always needs review (of symptoms). Controlled always needs review.
        requiresApproval: needsApproval || true,
        prescriptionImageUrl: '',
        isEmergency: false,
        emergencyReason: '',
        symptoms: '',
      };
    })
  );

  const [vendorPhone, setVendorPhone] = useState<string | null>(null);
  useEffect(() => {
    if (!vendorId) return;
    (async () => {
      const { data } = await supabase.from('vendors').select('phone').eq('id', vendorId).maybeSingle();
      setVendorPhone((data as any)?.phone || null);
    })();
  }, [vendorId]);

  const current = prescriptions[currentIndex];
  const item = pharmacyItems[currentIndex];

  const updateCurrent = (updates: Partial<PrescriptionData>) => {
    setPrescriptions(prev => prev.map((p, i) => i === currentIndex ? { ...p, ...updates } : p));
  };

  const isControlled = item.medicineClassification === 'controlled';
  const isRx = item.medicineClassification === 'prescription';
  const isOTC = item.medicineClassification === 'otc' || (!isControlled && !isRx);

  const handleNext = () => {
    // Only CONTROLLED drugs gate on doctor-prescription photo upload.
    // (OTC + Rx can always proceed — pharmacist guidance is enough.)
    if (
      isControlled &&
      current.prescriptionType === 'doctor' &&
      !current.prescriptionImageUrl
    ) {
      toast({
        title: 'Prescription photo required',
        description: "This is a controlled drug. Please upload your doctor's prescription image to continue.",
        variant: 'destructive',
      });
      return;
    }
    // No doctor's prescription → symptoms are required so the pharmacist can review.
    // OTC items skip this — they don't need pharmacist review.
    if (!isOTC && current.prescriptionType === 'pharmacist' && !current.symptoms.trim()) {
      toast({
        title: 'Please describe your symptoms',
        description: "The pharmacist reviews your symptoms before dispatch. If they suggest a different drug, you'll be refunded automatically.",
        variant: 'destructive',
      });
      return;
    }
    if (current.isEmergency && !current.emergencyReason.trim()) {
      toast({
        title: 'Emergency reason required',
        description: 'Please briefly describe the emergency so the pharmacist can prioritise.',
        variant: 'destructive',
      });
      return;
    }
    if (currentIndex < pharmacyItems.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onComplete(prescriptions);
    }
  };

  const isTabletLike = ['tablet', 'capsule'].includes(current.doseUnit);
  const doseLabel = isTabletLike ? 'tablet(s)' : 'ml';
  const totalDailyDose = current.morningDose + current.afternoonDose + current.nightDose;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="w-5 h-5 text-primary" />
            Prescription Details ({currentIndex + 1}/{pharmacyItems.length})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drug info */}
          <div className="p-3 bg-secondary/50 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground">{item.productName}</p>
              {item.targetAgeGroup && item.targetAgeGroup !== 'all' && (
                <Badge variant="outline" className="text-xs gap-1">
                  {item.targetAgeGroup === 'children' ? <Baby className="w-3 h-3" /> : <User className="w-3 h-3" />}
                  {item.targetAgeGroup === 'children' ? 'Children' : 'Adult'}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
            {item.dosageForm && <Badge variant="secondary" className="text-xs mt-1">{item.dosageForm}</Badge>}
            {item.medicineClassification && (
              <span className="inline-block ml-1 mt-1">
                <MedicineClassificationBadge classification={item.medicineClassification} />
              </span>
            )}
          </div>

          {/* CONTROLLED drugs only: prescription image upload (doctor route) */}
          {isControlled && current.prescriptionType === 'doctor' && (
            <div className="p-3 bg-secondary/30 rounded-lg border border-border space-y-2">
              <PrescriptionImageUpload
                userId={userId}
                productId={item.productId}
                value={current.prescriptionImageUrl}
                onChange={(path) => updateCurrent({ prescriptionImageUrl: path })}
                label="Doctor's Prescription Photo (required)"
                required
              />
              <p className="text-xs text-muted-foreground">
                A licensed pharmacist will verify your prescription before this controlled medicine is dispensed.
              </p>
            </div>
          )}

          {/* CONTROLLED drugs only: pharmacist consultation route */}
          {isControlled && current.prescriptionType === 'pharmacist' && (
            <div className="p-3 bg-secondary/30 rounded-lg border border-border space-y-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Pill className="w-4 h-4 text-primary" /> Speak with the pharmacy
              </p>
              <p className="text-xs text-muted-foreground">
                No prescription? A licensed pharmacist will reach out after you place this order to ask about your symptoms and approve the medicine. You can also call them directly.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" className="gap-1" disabled>
                  <MessageCircle className="w-4 h-4" /> Chat after order
                </Button>
                {vendorPhone ? (
                  <a href={`tel:${vendorPhone}`} className="inline-flex items-center justify-center gap-1 h-9 px-3 rounded-md border border-border hover:bg-accent text-sm">
                    <Phone className="w-4 h-4" /> Call pharmacy
                  </a>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="gap-1" disabled>
                    <Phone className="w-4 h-4" /> Phone unavailable
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Rx (non-controlled) hint — no approval wait */}
          {isRx && (
            <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-xs text-foreground">
                💊 Prescription drug. If you have a doctor's prescription, add the details below — otherwise the pharmacist's recommended dosage will be used. You can complete payment immediately.
              </p>
            </div>
          )}

          {/* Emergency flag — controlled drugs only */}
          {isControlled && (
            <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 space-y-2">
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`emergency-${item.productId}`}
                  checked={current.isEmergency}
                  onCheckedChange={(c) => updateCurrent({ isEmergency: !!c })}
                />
                <div className="flex-1">
                  <Label htmlFor={`emergency-${item.productId}`} className="text-sm font-medium flex items-center gap-1 cursor-pointer">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    This is an emergency / urgent need
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The pharmacist will prioritise this prescription.
                  </p>
                </div>
              </div>
              {current.isEmergency && (
                <Textarea
                  value={current.emergencyReason}
                  onChange={(e) => updateCurrent({ emergencyReason: e.target.value })}
                  placeholder="Briefly describe the emergency (e.g. severe asthma attack, post-surgery pain)"
                  rows={2}
                  className="text-sm"
                />
              )}
            </div>
          )}

          {/* Prescription type selection */}
          <div className="space-y-2">
            <Label className="font-medium">Do you have a doctor's prescription?</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updateCurrent({ prescriptionType: 'doctor' })}
                className={`p-3 rounded-lg border-2 text-center transition-colors ${
                  current.prescriptionType === 'doctor'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <Stethoscope className="w-5 h-5 mx-auto mb-1" />
                <p className="text-sm font-medium">Yes, Doctor's</p>
              </button>
              <button
                type="button"
                onClick={() => updateCurrent({ prescriptionType: 'pharmacist' })}
                className={`p-3 rounded-lg border-2 text-center transition-colors ${
                  current.prescriptionType === 'pharmacist'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <Pill className="w-5 h-5 mx-auto mb-1" />
                <p className="text-sm font-medium">No, Pharmacist</p>
              </button>
            </div>
          </div>

          {/* Drug form type */}
          <div className="space-y-1">
            <Label className="text-sm">Dosage Form</Label>
            <Select value={current.doseUnit} onValueChange={v => updateCurrent({ doseUnit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tablet">Tablet</SelectItem>
                <SelectItem value="capsule">Capsule</SelectItem>
                <SelectItem value="ml">Syrup (ml)</SelectItem>
                <SelectItem value="drops">Drops</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Doctor prescription details */}
          {current.prescriptionType === 'doctor' && (
            <div className="space-y-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-sm font-medium flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-primary" /> Doctor's Prescription
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Doctor's Name</Label>
                  <Input
                    value={current.doctorName}
                    onChange={e => updateCurrent({ doctorName: e.target.value })}
                    placeholder="Dr. ..."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hospital/Clinic</Label>
                  <Input
                    value={current.hospitalName}
                    onChange={e => updateCurrent({ hospitalName: e.target.value })}
                    placeholder="Hospital name"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Additional Instructions</Label>
                <Textarea
                  value={current.doctorInstructions}
                  onChange={e => updateCurrent({ doctorInstructions: e.target.value })}
                  placeholder="Any special instructions from your doctor..."
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Pharmacist instructions (if no doctor prescription) */}
          {current.prescriptionType === 'pharmacist' && current.pharmacistInstructions && (
            <div className="p-3 bg-secondary/50 rounded-lg border border-border">
              <p className="text-xs font-medium text-muted-foreground mb-1">Pharmacist Recommendation</p>
              <p className="text-sm text-foreground">{current.pharmacistInstructions}</p>
            </div>
          )}

          {/* Symptoms — required when no doctor's prescription so the pharmacist can review */}
          {current.prescriptionType === 'pharmacist' && (
            <div className="space-y-1 p-3 rounded-lg border border-primary/20 bg-primary/5">
              <Label className="text-sm font-medium">
                What symptoms are you treating? <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={current.symptoms}
                onChange={(e) => updateCurrent({ symptoms: e.target.value })}
                placeholder="e.g. Fever + body aches for 2 days, sore throat, mild headache…"
                rows={3}
              />
              <p className="text-[11px] text-muted-foreground">
                A licensed pharmacist will review your symptoms after you pay. If they suggest a different drug, this item is automatically cancelled and refunded to your wallet — you'll see their note in the order.
              </p>
            </div>
          )}

          {/* Morning / Afternoon / Night dosage */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Dosage Schedule ({doseLabel})
            </p>

            {item.targetAgeGroup === 'children' && (
              <div className="p-2 bg-warning/10 rounded-lg border border-warning/30">
                <p className="text-xs text-foreground">⚠️ This is a children's medication. Please follow recommended dosage carefully.</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1 text-center">
                <Label className="text-xs">🌅 Morning</Label>
                <Input
                  type="number"
                  value={current.morningDose}
                  onChange={e => updateCurrent({ morningDose: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step={isTabletLike ? '1' : '0.5'}
                  className="text-center"
                />
              </div>
              <div className="space-y-1 text-center">
                <Label className="text-xs">☀️ Afternoon</Label>
                <Input
                  type="number"
                  value={current.afternoonDose}
                  onChange={e => updateCurrent({ afternoonDose: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step={isTabletLike ? '1' : '0.5'}
                  className="text-center"
                />
              </div>
              <div className="space-y-1 text-center">
                <Label className="text-xs">🌙 Night</Label>
                <Input
                  type="number"
                  value={current.nightDose}
                  onChange={e => updateCurrent({ nightDose: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step={isTabletLike ? '1' : '0.5'}
                  className="text-center"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground bg-secondary/50 p-2 rounded">
              <span>Total daily: <strong className="text-foreground">{totalDailyDose} {doseLabel}</strong></span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Duration (days)</Label>
                <Input
                  type="number"
                  value={current.dosageDurationDays}
                  onChange={e => updateCurrent({ dosageDurationDays: parseInt(e.target.value) || 1 })}
                  min="1"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total doses</Label>
                <div className="h-10 flex items-center px-3 bg-secondary rounded-md text-sm font-medium">
                  {totalDailyDose * current.dosageDurationDays}
                </div>
              </div>
            </div>
          </div>

          {(() => {
            // Only CONTROLLED drugs gate the proceed button on photo upload.
            const needsDoctorPhoto =
              isControlled &&
              current.prescriptionType === 'doctor' &&
              !current.prescriptionImageUrl;
            return (
              <Button className="w-full" onClick={handleNext} disabled={!!needsDoctorPhoto}>
                {needsDoctorPhoto
                  ? 'Upload prescription photo to continue'
                  : currentIndex < pharmacyItems.length - 1 ? 'Next Drug →' : 'Confirm & Proceed to Payment'}
              </Button>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
