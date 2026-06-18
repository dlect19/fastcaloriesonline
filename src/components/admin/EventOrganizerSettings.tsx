import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CalendarClock, Save, Loader2 } from 'lucide-react';

interface Props {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
  onSave: (key: string) => void;
  saving: boolean;
}

const FIELDS = [
  {
    key: 'event_organizer_payout_period_hours',
    label: 'Settlement Hold (hours)',
    description: 'Hours to hold ticket-sale credits before they become withdrawable by the event organizer.',
    unit: 'hrs',
    placeholder: '48',
  },
  {
    key: 'event_organizer_platform_fee_pct',
    label: 'Platform Fee on Tickets',
    description: 'Percentage deducted from each ticket sale before crediting the organizer wallet.',
    unit: '%',
    placeholder: '5',
  },
  {
    key: 'event_organizer_minimum_payout',
    label: 'Minimum Withdrawal',
    description: 'Smallest amount an organizer can request to withdraw.',
    unit: '₦',
    placeholder: '1000',
  },
];

export function EventOrganizerSettings({ settings, onSettingChange, onSave, saving }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          Event Organizer Settlement
        </CardTitle>
        <CardDescription>
          Controls the wallet, fees, and withdrawal rules for event organizers selling tickets on the platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={f.key} className="text-sm font-medium">
              {f.label} <span className="text-xs text-muted-foreground">({f.unit})</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id={f.key}
                type="number"
                inputMode="decimal"
                placeholder={f.placeholder}
                value={settings[f.key] ?? ''}
                onChange={(e) => onSettingChange(f.key, e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={() => onSave(f.key)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{f.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
