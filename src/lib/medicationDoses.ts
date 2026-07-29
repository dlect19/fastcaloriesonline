// Dose actions (Taken / Snoozed / Skipped) with offline-safe persistence.
// Every action carries a deterministic client_key so replaying the queue can
// never create duplicate history rows.

import { supabase } from '@/integrations/supabase/client';

const QUEUE_KEY = 'fc_medication_dose_queue_v1';

export type DoseStatus = 'taken' | 'skipped' | 'snoozed';

export interface DoseAction {
  reminder_id: string;
  user_id: string;
  drug_usage_tracking_id?: string | null;
  scheduled_for: string;
  status: DoseStatus;
  taken_at?: string | null;
  snoozed_until?: string | null;
  client_key: string;
}

function readQueue(): DoseAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(items: DoseAction[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-200)));
  } catch {
    /* storage full / unavailable */
  }
}

function enqueue(action: DoseAction) {
  const q = readQueue().filter((a) => a.client_key !== action.client_key);
  q.push(action);
  writeQueue(q);
}

async function push(action: DoseAction): Promise<boolean> {
  const { error } = await supabase
    .from('medication_doses')
    .upsert(action as any, { onConflict: 'user_id,client_key' });
  return !error;
}

/** Records a dose action. Falls back to the local queue when offline. */
export async function recordDoseAction(action: DoseAction): Promise<{ synced: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueue(action);
    return { synced: false };
  }
  try {
    const ok = await push(action);
    if (!ok) enqueue(action);
    return { synced: ok };
  } catch {
    enqueue(action);
    return { synced: false };
  }
}

/** Replays anything captured offline. Safe to call repeatedly. */
export async function flushDoseQueue(): Promise<number> {
  const queued = readQueue();
  if (queued.length === 0) return 0;
  const remaining: DoseAction[] = [];
  let flushed = 0;
  for (const action of queued) {
    try {
      if (await push(action)) flushed++;
      else remaining.push(action);
    } catch {
      remaining.push(action);
    }
  }
  writeQueue(remaining);
  return flushed;
}

export function pendingDoseCount(): number {
  return readQueue().length;
}
