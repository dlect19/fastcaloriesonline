import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Phase 1 admin staff operations infrastructure.
 *
 * Every admin/staff screen should call `logActivity(...)` whenever a staff
 * member performs a meaningful action (approving a vendor, creating a promo,
 * editing settings, etc.). The backend RPC writes to `activity_logs` AND bumps
 * `admin_staff.last_activity_at` so we can compute Active vs Inactive staff.
 *
 * `useStaffPresenceHeartbeat()` keeps the last-active timestamp fresh while a
 * staff member has an admin tab open, even if they aren't clicking anything.
 */
export type ActivityAction =
  | 'created' | 'updated' | 'deleted' | 'activated' | 'deactivated'
  | 'approved' | 'rejected' | 'role_changed' | 'login'
  | 'order_attended'
  | string;

export async function logActivity(
  action: ActivityAction,
  entityType: string,
  entityId?: string | null,
  details?: Record<string, unknown> | null,
) {
  try {
    const { error } = await supabase.rpc('log_admin_activity', {
      _action: action,
      _entity_type: entityType,
      _entity_id: entityId ?? null,
      _details: (details ?? null) as any,
    });
    if (error) console.warn('[activity-log]', action, entityType, error.message);
  } catch (err) {
    console.warn('[activity-log] failed', err);
  }
}

export function useAdminActivityLogger() {
  return useCallback(logActivity, []);
}

/**
 * Bumps the current user's `last_activity_at` every 60s while mounted.
 * Mount this once at the admin layout level.
 */
export function useStaffPresenceHeartbeat(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const beat = () => {
      if (cancelled) return;
      // Lightweight presence ping — same RPC, harmless 'presence' entity
      logActivity('heartbeat', 'presence', null, null);
    };
    beat();
    const id = setInterval(beat, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);
}
