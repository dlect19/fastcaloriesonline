import { supabase } from '@/integrations/supabase/client';

export interface ZegoTokenResp {
  token: string;
  appId: number;
  appSign?: string;
  userId: string;
  expiresAt: number;
}

export async function getZegoToken(roomId: string, zegoUserId?: string): Promise<ZegoTokenResp> {
  const { data, error } = await supabase.functions.invoke('zego-token', {
    body: { roomId, zegoUserId, effectiveTimeSeconds: 3600 },
  });
  if (error) throw error;
  return data as ZegoTokenResp;
}

/**
 * Zego requires each simultaneous client login to use a globally unique userID.
 * A FastCalories account can be both customer/vendor/rider/admin, so scope the
 * RTC identity by role to avoid one side kicking the other out of the room.
 */
export function makeZegoUserId(authUserId: string, role: string): string {
  return `${authUserId}_${role}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}

/** Deterministic call room id for an order + participant pair (order matters here). */
export function makeCallRoomId(orderId: string, a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `ord_${orderId.slice(0, 8)}_${x.slice(0, 6)}_${y.slice(0, 6)}`;
}
