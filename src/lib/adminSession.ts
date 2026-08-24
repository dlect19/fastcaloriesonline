import { supabase } from '@/integrations/supabase/client';

/**
 * Admin 2FA session state.
 *
 * The 2FA-passed marker is a server-issued opaque token stored ONLY in
 * sessionStorage (never localStorage), scoped to the authenticated user id.
 * Validity is always confirmed server-side by the `admin-2fa-session` function,
 * so a forged browser value cannot grant access.
 */
const TOKEN_KEY = 'admin_2fa_token';
const USER_KEY = 'admin_2fa_user';

export function storeAdmin2FASession(userId: string, token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, userId);
  } catch { /* storage unavailable */ }
}

export function getAdmin2FAToken(userId: string): string | null {
  try {
    if (sessionStorage.getItem(USER_KEY) !== userId) return null;
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAdmin2FASession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    // Legacy marker from the previous implementation.
    sessionStorage.removeItem('admin_2fa_passed');
  } catch { /* storage unavailable */ }
}

/** Server-validates the stored 2FA session for the given user. */
export async function validateAdmin2FASession(userId: string): Promise<{ valid: boolean; isAdmin: boolean }> {
  const token = getAdmin2FAToken(userId);
  try {
    const { data, error } = await supabase.functions.invoke('admin-2fa-session', {
      body: { token: token ?? undefined, action: 'validate' },
    });
    if (error) return { valid: false, isAdmin: false };
    return { valid: !!data?.valid, isAdmin: !!data?.is_admin };
  } catch {
    return { valid: false, isAdmin: false };
  }
}

/** Revokes the current admin 2FA session server-side and clears the local marker. */
export async function revokeAdmin2FASession() {
  try {
    await supabase.functions.invoke('admin-2fa-session', { body: { action: 'revoke' } });
  } catch { /* best effort */ }
  clearAdmin2FASession();
}
