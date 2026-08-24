import { supabase } from '@/integrations/supabase/client';

/** Sensitive actions that require a fresh authenticator (TOTP) code, verified server-side. */
export type StepUpAction =
  | 'wallet_credit'
  | 'wallet_debit'
  | 'payout_process'
  | 'financial_reset'
  | 'payment_hold_resolve'
  | 'role_grant'
  | 'role_revoke'
  | 'staff_create'
  | 'staff_update'
  | 'staff_delete'
  | 'user_delete'
  | 'user_email_change'
  | 'platform_setting_write'
  | 'environment_switch'
  | 'security_setting_write';

export interface StepUpRequest {
  action: StepUpAction;
  targetType?: string | null;
  targetId?: string | null;
  /** Shown in the challenge dialog so the admin knows exactly what they are approving. */
  label?: string;
}

export const STEP_UP_LABELS: Record<StepUpAction, string> = {
  wallet_credit: 'Credit a wallet',
  wallet_debit: 'Debit a wallet',
  payout_process: 'Process a payout',
  financial_reset: 'Run a destructive financial tool',
  payment_hold_resolve: 'Resolve a payment hold',
  role_grant: 'Grant a portal role',
  role_revoke: 'Remove a portal role',
  staff_create: 'Create an admin staff account',
  staff_update: 'Change an admin staff account',
  staff_delete: 'Remove an admin staff account',
  user_delete: 'Delete a user account',
  user_email_change: 'Change a login email',
  platform_setting_write: 'Change a protected platform setting',
  environment_switch: 'Switch the platform environment',
  security_setting_write: 'Change a security setting',
};

export async function getStepUpStatus(): Promise<{ enrolled: boolean; isSuperAdmin: boolean }> {
  const { data, error } = await supabase.functions.invoke('admin-step-up', { body: { mode: 'status' } });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return { enrolled: !!(data as any)?.enrolled, isSuperAdmin: !!(data as any)?.isSuperAdmin };
}

/**
 * Exchange a 6-digit authenticator code for a short-lived, single-use step-up token.
 * The code is never stored client-side.
 */
export async function requestStepUpToken(req: StepUpRequest, code: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('admin-step-up', {
    body: {
      mode: 'verify',
      action: req.action,
      targetType: req.targetType ?? null,
      targetId: req.targetId ?? null,
      code,
    },
  });
  if (error) {
    // Surface the server's message (e.g. "Invalid authenticator code") instead of a generic 4xx.
    const ctx = (error as any)?.context;
    let message = error.message;
    try {
      const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  const token = (data as any)?.token;
  if (!token) throw new Error('Verification failed');
  return token as string;
}

export interface WalletAdjustArgs {
  p_wallet_id: string;
  p_amount: number;
  p_adjust_type: 'credit' | 'debit';
  p_notes?: string;
  p_environment?: string;
  p_reference?: string | null;
}

/**
 * Manual wallet money movement. The database function refuses to run without a fresh
 * authenticator step-up token, so this always challenges the admin first.
 */
export async function adminAdjustWallet(
  requireStepUp: (req: StepUpRequest) => Promise<string>,
  args: WalletAdjustArgs,
) {
  const action: StepUpAction = args.p_adjust_type === 'credit' ? 'wallet_credit' : 'wallet_debit';
  const token = await requireStepUp({
    action,
    targetType: 'wallet',
    targetId: args.p_wallet_id,
    label: `${args.p_adjust_type === 'credit' ? 'Credit' : 'Debit'} ₦${Number(args.p_amount).toLocaleString()}`,
  });
  return await supabase.rpc('admin_adjust_wallet_balance' as any, { ...args, p_step_up_token: token });
}
