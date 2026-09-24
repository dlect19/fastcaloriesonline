import { useCallback, useEffect, useRef, useState } from 'react';
import { diffNewActionable, type SoundRole } from '@/lib/orderSoundGate';

/**
 * Tracks which actionable ids are genuinely NEW since listeners became ready.
 * - `ids === null` means "not loaded yet" and is ignored.
 * - The first loaded snapshot for a scope is a silent baseline.
 * - Later snapshots add only never-seen ids (claimed through the shared gate,
 *   so duplicate mounts/tabs/push paths cannot claim the same id twice).
 * - Ids that stop being actionable drop out automatically.
 */
export function useFreshActionable(scope: string | null, role: SoundRole, ids: string[] | null) {
  const [fresh, setFresh] = useState<string[]>([]);
  const freshRef = useRef<Set<string>>(new Set());
  const idsKey = ids ? [...ids].sort().join(',') : null;

  useEffect(() => {
    freshRef.current = new Set();
    setFresh([]);
  }, [scope]);

  useEffect(() => {
    if (!scope || ids === null) return;
    const current = new Set(ids);
    const next = new Set([...freshRef.current].filter((id) => current.has(id)));
    for (const id of diffNewActionable(scope, role, 'actionable', ids)) next.add(id);
    freshRef.current = next;
    setFresh([...next]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, role, idsKey]);

  const acknowledge = useCallback(() => {
    freshRef.current = new Set();
    setFresh([]);
  }, []);

  return { freshIds: fresh, freshCount: fresh.length, acknowledge };
}
