import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BellRing, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { sendTestReminder } from '@/lib/medicationAlarms';
import type { MedicationSettings } from '@/hooks/useMedicationReminders';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: MedicationSettings;
  onSave: (patch: Partial<MedicationSettings>) => Promise<{ error?: string }>;
  onResync: () => Promise<{ scheduled: number; reason?: string }>;
}

export function MedicationSettingsDialog({ open, onOpenChange, settings, onSave, onResync }: Props) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);

  const row = (id: string, label: string, hint: string, key: keyof MedicationSettings) => (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={settings[key] as boolean} onCheckedChange={(v) => onSave({ [key]: v } as any)} />
    </div>
  );

  const runTest = async () => {
    setTesting(true);
    const err = await sendTestReminder({
      privacyMode: settings.privacy_mode,
      soundEnabled: settings.sound_enabled,
      notificationsEnabled: settings.notifications_enabled,
    });
    setTesting(false);
    toast(
      err
        ? { title: 'Test reminder could not be scheduled', description: err, variant: 'destructive' }
        : { title: 'Test reminder scheduled', description: 'It will appear in about 8 seconds.' },
    );
  };

  const runResync = async () => {
    const res = await onResync();
    toast({
      title: 'Reminders re-synced',
      description: res.reason
        ? `Nothing scheduled (${res.reason.replace(/_/g, ' ')}).`
        : `${res.scheduled} device reminder(s) refreshed.`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Medication reminder settings</DialogTitle>
          <DialogDescription>These control notifications only — never your prescribed instructions.</DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border">
          {row('med-notif', 'Reminder notifications', 'Turn all medication reminders on or off.', 'notifications_enabled')}
          {row(
            'med-privacy',
            'Private lock-screen alerts',
            'Hides the medicine name — shows “FastCalories Reminder” instead.',
            'privacy_mode',
          )}
          {row('med-sound', 'Sound', 'Play the alarm sound with each reminder.', 'sound_enabled')}
          {row('med-vibe', 'Vibration', 'Vibrate when a reminder fires.', 'vibration_enabled')}
          {row(
            'med-cal',
            'Add schedule to phone calendar',
            'Optional convenience only. Reminders always come from FastCalories.',
            'calendar_sync_enabled',
          )}

          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <Label className="text-sm">Snooze length</Label>
              <p className="text-xs text-muted-foreground">Used by “Remind me later”.</p>
            </div>
            <Select
              value={String(settings.snooze_minutes)}
              onValueChange={(v) => onSave({ snooze_minutes: Number(v) })}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={runTest} disabled={testing} className="gap-2">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
            Send test reminder
          </Button>
          <Button variant="outline" onClick={runResync}>
            Repair device reminders
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
