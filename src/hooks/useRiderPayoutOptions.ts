import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type PayoutOption = 'instant' | 'daily' | 'weekly' | 'monthly';

export interface RiderPayoutConfig {
  charge_instant: number;
  charge_daily: number;
  charge_weekly: number;
  charge_monthly: number;
  min_withdrawal: number;
  daily_run_time: string;
  weekly_settlement_day: number;
  monthly_settlement_date: string;
  preference_change_rule: 'anytime' | 'once_per_cycle';
  instant_eta_text: string;
}

export interface RiderPayoutPreference {
  payout_option: PayoutOption;
  effective_from: string;
  next_run_at: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
}

export interface RiderPayoutQuote {
  cleared_balance: number;
  requested: number;
  transfer_charge: number;
  charge_bearer: 'rider' | 'fastcalories';
  net_amount: number;
  min_withdrawal: number;
  eta_text: string;
  bank: { bank_name: string | null; masked_account: string | null; account_name: string | null };
  errors: string[];
}

interface ConfigPayload {
  config: RiderPayoutConfig;
  cleared_balance: number;
  pending_payouts: number;
  preference: RiderPayoutPreference | null;
  next_run_at: string | null;
  charges: Record<PayoutOption, { charge: number; bearer: 'rider' | 'fastcalories' }>;
  bank: { bank_name: string | null; masked_account: string | null; account_name: string | null };
}

export const OPTION_LABELS: Record<PayoutOption, string> = {
  instant: 'Instant / Anytime',
  daily: 'Daily Automatic',
  weekly: 'Weekly Automatic',
  monthly: 'Monthly Automatic',
};

export const OPTION_DESCRIPTIONS: Record<PayoutOption, string> = {
  instant: 'Withdraw any time you like. You pay the transfer charge on each withdrawal.',
  daily: 'Paid out automatically once a day. You pay the transfer charge.',
  weekly: 'Paid out automatically once a week. FastCalories covers the transfer charge.',
  monthly: 'Paid out automatically once a month. FastCalories covers the transfer charge.',
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('rider-withdrawal', { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx) {
        const parsed = await ctx.json();
        message = parsed?.message || parsed?.error || message;
      }
    } catch {
      /* keep original message */
    }
    throw new Error(message);
  }
  if ((data as { error?: string })?.error) {
    throw new Error((data as { message?: string; error?: string }).message || (data as { error?: string }).error);
  }
  return (data as { data: T }).data;
}

export function useRiderPayoutOptions() {
  const [payload, setPayload] = useState<ConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await invoke<ConfigPayload>({ action: 'config' });
      setPayload(data);
    } catch (e) {
      console.error('Failed to load payout options:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getQuote = useCallback(
    (amount: number) => invoke<RiderPayoutQuote>({ action: 'quote', amount }),
    [],
  );

  const requestWithdrawal = useCallback(
    (amount: number, idempotencyKey?: string) =>
      invoke<{
        payout_request_id: string;
        withdrawal_reference: string;
        gross_amount: number;
        transfer_charge: number;
        net_amount: number;
        processing: boolean;
        duplicate?: boolean;
      }>({ action: 'request', amount, idempotency_key: idempotencyKey }),
    [],
  );

  const setPreference = useCallback(
    async (option: PayoutOption) => {
      const result = await invoke<{ effective_from: string; next_run_at: string | null }>({
        action: 'set_preference',
        payout_option: option,
      });
      await refresh();
      return result;
    },
    [refresh],
  );

  return {
    loading,
    config: payload?.config ?? null,
    clearedBalance: payload?.cleared_balance ?? 0,
    pendingPayouts: payload?.pending_payouts ?? 0,
    preference: payload?.preference ?? null,
    nextRunAt: payload?.next_run_at ?? null,
    charges: payload?.charges ?? null,
    bank: payload?.bank ?? null,
    refresh,
    getQuote,
    requestWithdrawal,
    setPreference,
  };
}
