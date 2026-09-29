// Pure decision: should the rider see the "Notifications are off" warning?
// Never prompts by itself — it only decides whether to show the banner.
export type PermissionState = 'granted' | 'denied' | 'default' | 'prompt' | 'prompt-with-rationale' | 'unsupported' | 'unknown';

export interface RiderNotificationInputs {
  permission: PermissionState;
  hasServerSubscription: boolean | null; // null = still checking
}

export type RiderNotificationStatus = 'checking' | 'ok' | 'off' | 'blocked' | 'unsupported';

export function riderNotificationStatus(i: RiderNotificationInputs): RiderNotificationStatus {
  if (i.permission === 'unsupported') return 'unsupported';
  if (i.permission === 'denied') return 'blocked';
  if (i.hasServerSubscription === null) return 'checking';
  if (i.permission === 'granted' && i.hasServerSubscription) return 'ok';
  return 'off';
}
