import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ShieldCheck, Info, Plus, X, Clock } from 'lucide-react';

export interface ScheduleDraft {
  id?: string;
  drug_name: string;
  strength?: string | null;
  dosage?: string | null;
  instructions?: string | null;
  frequency?: string | null;
  reminder_times: string[];
  start_date?: string | null;
  end_date?: string | null;
  doses_per_day?: number | null;
  times_needed?: boolean;
  verification_status?: string;
  source?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'review' | 'manual';
  draft?: ScheduleDraft | null;
  onConfirm: (times: string[], patch: Record<string, any>) => Promise<void>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function MedicationScheduleDialog({ open, onOpenChange, mode, draft, onConfirm }: Props) {
  const [times, setTimes] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [strength, setStrength] = useState('');
  const [dosage, setDosage] = useState('');
  const [instructions, setInstructions] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTimes(draft?.reminder_times?.length ? draft.reminder_times : []);
    setName(draft?.drug_name || '');
    setStrength(draft?.strength || '');
    setDosage(draft?.dosage || '');
    setInstructions(draft?.instructions || '');
    setStartDate(draft?.start_date || todayIso());
    setEndDate(draft?.end_date || '');
    setSaving(false);
  }, [open, draft]);

  const expected = draft?.doses_per_day ?? null;
  const isReview = mode === 'review';
  const canSubmit = times.length > 0 && (isReview || name.trim().length > 1);

  const addTime = () => setTimes((t) => [...t, '08:00']);
  const setTime = (i: number, v: string) => setTimes((t) => t.map((x, idx) => (idx === i ? v : x)));
  const removeTime = (i: number) => setTimes((t) => t.filter((_, idx) => idx !== i));

  const submit = async () => {
    setSaving(true);
    const sorted = [...times].sort();
    await onConfirm(
      sorted,
      isReview
        ? { times_needed: false }
        : {
            drug_name: name.trim(),
            strength: strength.trim() || null,
            dosage: dosage.trim() || null,
            instructions: instructions.trim() || null,
            frequency: `${sorted.length}x_daily`,
            start_date: startDate,
            end_date: endDate || null,
            times_needed: false,
          },
    );
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isReview ? 'Review your reminder' : 'Add a medication reminder'}</DialogTitle>
          <DialogDescription>
            {isReview
              ? 'We prepared this from the medication instructions on your pharmacy order. Reminders only start after you activate them.'
              : 'For medicines you obtained outside FastCalories. Enter exactly what your prescriber or pharmacist instructed.'}
          </DialogDescription>
        </DialogHeader>

        {isReview && draft && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground">
                {draft.drug_name}
                {draft.strength ? ` ${draft.strength}` : ''}
              </p>
              {draft.verification_status === 'verified' ? (
                <Badge className="gap-1 text-xs">
                  <ShieldCheck className="w-3 h-3" /> Pharmacy verified
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  Unverified
                </Badge>
              )}
            </div>
            {draft.dosage && <p className="text-sm text-muted-foreground">Dose: {draft.dosage}</p>}
            {draft.frequency && (
              <p className="text-sm text-muted-foreground">Frequency: {draft.frequency.replace(/_/g, ' ')}</p>
            )}
            {draft.instructions && <p className="text-sm text-muted-foreground">{draft.instructions}</p>}
            <p className="text-[11px] text-muted-foreground pt-1">
              These are your medical instructions and cannot be edited here. You are only choosing when to be reminded.
            </p>
          </div>
        )}

        {!isReview && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="med-name">Medication name</Label>
              <Input id="med-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amoxicillin" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="med-strength">Strength (optional)</Label>
                <Input id="med-strength" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="500mg" />
              </div>
              <div>
                <Label htmlFor="med-dose">Dose per time</Label>
                <Input id="med-dose" value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="1 tablet" />
              </div>
            </div>
            <div>
              <Label htmlFor="med-instr">Instructions (optional)</Label>
              <Textarea
                id="med-instr"
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Take after food"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="med-start">Start date</Label>
                <Input id="med-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="med-end">End date (optional)</Label>
                <Input id="med-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1">
              <Clock className="w-4 h-4" /> Reminder times
            </Label>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={addTime}>
              <Plus className="w-3 h-3" /> Add time
            </Button>
          </div>

          {expected != null && (
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Your instructions say {expected} {expected === 1 ? 'dose' : 'doses'} per day but do not give exact clock
              times. Choose times that suit you — spread them evenly across your day.
            </p>
          )}

          {times.length === 0 && (
            <p className="text-xs text-muted-foreground">Add at least one time to activate this reminder.</p>
          )}

          {times.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="time" value={t} onChange={(e) => setTime(i, e.target.value)} />
              <Button type="button" size="icon" variant="ghost" onClick={() => removeTime(i)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}

          {expected != null && times.length > 0 && times.length !== expected && (
            <p className="text-xs text-destructive">
              You have selected {times.length} {times.length === 1 ? 'time' : 'times'} but your instructions say{' '}
              {expected} per day. FastCalories will not change your prescribed dosage — please match the instructions or
              speak to your pharmacist.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button disabled={!canSubmit || saving} onClick={submit}>
            {saving ? 'Saving…' : isReview ? 'Confirm & activate' : 'Create reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
