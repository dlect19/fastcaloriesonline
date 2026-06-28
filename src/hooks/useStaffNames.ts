import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Resolves a set of admin/staff user_ids → display names.
 * Uses profiles.full_name, falling back to admin_staff.invite_email,
 * then to "Staff (role)".
 *
 * Usage:
 *   const names = useStaffNames(userIds);
 *   names.get(userId) // -> "Jane Doe" | "jane@x.com" | "Staff (support)" | undefined
 */
export function useStaffNames(userIds: (string | null | undefined)[]) {
  const [map, setMap] = useState<Map<string, string>>(new Map());
  const key = [...new Set(userIds.filter(Boolean) as string[])].sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setMap(new Map()); return; }
    let cancelled = false;
    (async () => {
      const [{ data: profs }, { data: staff }] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').in('user_id', ids),
        supabase.from('admin_staff').select('user_id, role, invite_email').in('user_id', ids),
      ]);
      if (cancelled) return;
      const profMap = new Map((profs || []).map((p: any) => [p.user_id, p.full_name]));
      const staffMap = new Map((staff || []).map((s: any) => [s.user_id, s]));
      const out = new Map<string, string>();
      for (const id of ids) {
        const name = profMap.get(id);
        const s = staffMap.get(id) as any;
        out.set(id, name || s?.invite_email || (s ? `Staff (${String(s.role).replace('_',' ')})` : 'Unknown'));
      }
      setMap(out);
    })();
    return () => { cancelled = true; };
  }, [key]);

  return map;
}
