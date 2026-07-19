import { supabase } from '@/integrations/supabase/client';

export interface ZegoTokenResp {
  token: string;
  appId: number;
  userId: string;
  expiresAt: number;
}

export async function getZegoToken(roomId: string): Promise<ZegoTokenResp> {
  const { data, error } = await supabase.functions.invoke('zego-token', {
    body: { roomId, effectiveTimeSeconds: 3600 },
  });
  if (error) throw error;
  return data as ZegoTokenResp;
}

/** Deterministic call room id for an order + participant pair (order matters here). */
export function makeCallRoomId(orderId: string, a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `ord_${orderId.slice(0, 8)}_${x.slice(0, 6)}_${y.slice(0, 6)}`;
}
