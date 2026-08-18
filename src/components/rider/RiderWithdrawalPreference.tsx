import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CalendarClock, Building2, Info, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  OPTION_DESCRIPTIONS,
  OPTION_LABELS,
  type PayoutOption,
  type RiderPayoutConfig,
} from '@/hooks/useRiderPayoutOptions';

const OPTIONS: PayoutOption[] = ['instant', 'daily', 'weekly', 'monthly'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface Props {
  config: RiderPayoutConfig | null;
  charges: Record<PayoutOption, { charge: number; bearer: 'rider' | 'fastcalories' }> | null;
  currentOption: PayoutOption;
  nextRunAt: string | null;
  bank: { bank_name: string | null; masked_account: string | null; account_name: string | null } | null;
  onChangeOption: (option: PayoutOption) => Promise<unknown>;
  onEditBank: () => void;
}

const naira = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

export function RiderWithdrawalPreference({
  config,
  charges,
  currentOption,
  nextRunAt,
  bank,
  onChangeOption,
  onEditBank,
}: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState<PayoutOption | null>(null);

  const handleSelect = async (option: PayoutOption) => {
    if (option === currentOption) return;
    setSaving(option);
    try {
      await onChangeOption(option);
      toast({
        title: 'Payout preference updated',
        description:
          option === 'instant'
            ? 'You can now withdraw any time you like.'
            : 'This takes effect from your next settlement cycle — no payout is triggered now.',
      });
    } catch (e) {
      toast({
        title: 'Could not change preference',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  const scheduleText = (option: PayoutOption) => {
    if (!config) return '';
    switch (option) {
      case 'instant':
        return config.instant_eta_text;
      case 'daily':
        return `Every day at ${config.daily_run_time} (WAT)`;
      case 'weekly':
        return `Every ${DAYS[Math.min(6, Math.max(0, (config.weekly_settlement_day || 5) - 1))]} at ${config.daily_run_time} (WAT)`;
      case 'monthly':
        return `${config.monthly_settlement_date === 'last' ? 'Last day' : `Day ${config.monthly_settlement_date}`} of every month at ${config.daily_run_time} (WAT)`;
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">Withdrawal Preference</CardTitle>
        <CardDescription>
          Choose how you want to be paid. Changes apply from your next settlement cycle only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {OPTIONS.map((option) => {
            const info = charges?.[option];
            const active = option === currentOption;
            return (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
                disabled={saving !== null}
                className={`text-left rounded-lg border p-4 transition-colors ${
                  active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-medium text-sm">{OPTION_LABELS[option]}</span>
                  {active ? (
                    <Badge className="gap-1 text-[10px]">
                      <CheckCircle2 className="w-3 h-3" /> Active
                    </Badge>
                  ) : saving === option ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground mb-2 break-words">{OPTION_DESCRIPTIONS[option]}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    Charge {naira(info?.charge ?? 0)}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {info?.bearer === 'fastcalories' ? 'Paid by FastCalories' : 'Paid by you'}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{scheduleText(option)}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Minimum withdrawal</p>
            <p className="font-semibold">{naira(config?.min_withdrawal ?? 0)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Your transfer charge</p>
            <p className="font-semibold">
              {naira(charges?.[currentOption]?.charge ?? 0)}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {charges?.[currentOption]?.bearer === 'fastcalories' ? '(covered)' : ''}
              </span>
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarClock className="w-3 h-3" /> Next scheduled payout
            </p>
            <p className="font-semibold text-sm">
              {currentOption === 'instant'
                ? 'On request'
                : nextRunAt
                ? new Date(nextRunAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
                : '—'}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Preferred bank account
            </p>
            <p className="font-medium text-sm break-words">
              {bank?.bank_name ? `${bank.bank_name} • ${bank.masked_account}` : 'No bank account added'}
            </p>
            {bank?.account_name && <p className="text-xs text-muted-foreground">{bank.account_name}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={onEditBank}>
            {bank?.bank_name ? 'Change' : 'Add account'}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Instant and daily payouts move money more often, so the transfer charge is deducted from your payout.
          Weekly and monthly payouts reduce transfer volume, so FastCalories covers the charge for you.
        </p>
      </CardContent>
    </Card>
  );
}
