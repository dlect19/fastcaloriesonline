import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Pill, Stethoscope, Clock, Baby, User, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PrescriptionImageUpload } from './PrescriptionImageUpload';
import { MedicineClassificationBadge } from './MedicineClassificationBadge';

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
        requiresApproval: item.requiresPrescription,
        prescriptionImageUrl: '',
        isEmergency: false,
        emergencyReason: '',
      };
    })
  );

  const current = prescriptions[currentIndex];
  const item = pharmacyItems[currentIndex];

  const updateCurrent = (updates: Partial<PrescriptionData>) => {
    setPrescriptions(prev => prev.map((p, i) => i === currentIndex ? { ...p, ...updates } : p));
  };

  const handleNext = () => {
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
            {item.requiresPrescription && <Badge variant="destructive" className="text-xs mt-1 ml-1">Requires Rx</Badge>}
          </div>

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

          <Button className="w-full" onClick={handleNext}>
            {currentIndex < pharmacyItems.length - 1 ? 'Next Drug →' : 'Confirm & Proceed to Payment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
