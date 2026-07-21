import { useEffect, useRef, useState, useCallback } from 'react';
import { ZegoExpressEngine } from 'zego-express-engine-webrtc';
import { getZegoToken, makeCallRoomId } from '@/lib/zegoToken';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

type CallRole = 'customer' | 'vendor' | 'rider';

export interface StartCallInput {
  orderId: string;
  receiverId: string;
  callerRole: CallRole;
  receiverRole: CallRole;
  receiverName?: string;
}

interface ActiveCall {
  callId: string;
  roomId: string;
  peerName: string;
  status: 'ringing' | 'connected' | 'ended';
  isIncoming: boolean;
  startedAt: number;
}

let engineSingleton: ZegoExpressEngine | null = null;

function getCallErrorMessage(error: unknown): string {
  const err = error as any;
  const raw = err?.message || err?.msg || err?.reason || err?.error || (typeof error === 'string' ? error : '');
  const code = err?.code || err?.errorCode;
  const message = String(raw || '').trim();

  if (code === 1103064 || /permission|notallowed|denied/i.test(message)) {
    return 'Microphone permission is blocked. Please allow microphone access for this app, then try again.';
  }
  if (code === 1103065 || /in use|busy|device.*not.*available/i.test(message)) {
    return 'Your microphone is being used by another app. Close the other app and try again.';
  }
  if (/mediaDevices|getUserMedia|secure|https/i.test(message)) {
    return 'Microphone access is only available on HTTPS or inside the installed app.';
  }
  if (code) return `Call setup failed with Zego error ${code}. Please try again.`;
  return message || 'Could not access the microphone. Please check app microphone permission and try again.';
}

async function assertMicrophoneReady(engine: ZegoExpressEngine): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not available on this device/browser.');
  }

  try {
    const result = await engine.checkSystemRequirements('microphone');
    const supported = (result as any)?.microphone ?? (result as any)?.result ?? true;
    if (supported === false) {
      const info = (result as any)?.errInfo?.microphone;
      throw new Error(info?.message || info?.name || 'Microphone is not available or permission was denied.');
    }
  } catch (error) {
    throw new Error(getCallErrorMessage(error));
  }
}

async function getEngine(appId: number): Promise<ZegoExpressEngine> {
  if (engineSingleton) return engineSingleton;
  // Zego expects appSign for WebRTC init in some versions; token-based init uses server='wss://webliveroom-api.zego.im/ws'
  engineSingleton = new ZegoExpressEngine(appId, 'wss://webliveroom-api.zego.im/ws');
  return engineSingleton;
}

export function useZegoCall() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<ZegoExpressEngine | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(async () => {
    try {
      if (engineRef.current && active) {
        if (localStreamRef.current) {
          engineRef.current.destroyStream(localStreamRef.current);
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        engineRef.current.stopPublishingStream(`s_${user?.id}`);
        await engineRef.current.logoutRoom(active.roomId);
      }
    } catch (e) { console.warn('call cleanup', e); }
    localStreamRef.current = null;
    setRemoteStream(null);
    setActive(null);
    setMuted(false);
  }, [active, user?.id]);

  // Join zego room and publish/subscribe audio
  const joinRoom = useCallback(async (roomId: string) => {
    if (!user) throw new Error('No user');
    const { token, appId } = await getZegoToken(roomId);
    const engine = await getEngine(appId);
    engineRef.current = engine;
    await assertMicrophoneReady(engine);

    engine.on('roomStreamUpdate', async (_r, updateType, streamList) => {
      if (updateType === 'ADD' && streamList[0]) {
        const rs = await engine.startPlayingStream(streamList[0].streamID);
        setRemoteStream(rs as unknown as MediaStream);
      }
    });

    await engine.loginRoom(roomId, token, { userID: user.id, userName: user.email || user.id }, { userUpdate: true });
    const stream = await engine.createStream({
      camera: { audio: true, video: false, AEC: true, ANS: true, AGC: true },
    });
    localStreamRef.current = stream as unknown as MediaStream;
    engine.startPublishingStream(`s_${user.id}`, stream);
  }, [user]);

  const startCall = useCallback(async (input: StartCallInput) => {
    if (!user) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }
    const roomId = makeCallRoomId(input.orderId, user.id, input.receiverId);
    // Insert call row (triggers realtime ring on receiver)
    const { data: row, error } = await supabase
      .from('voice_calls')
      .insert({
        order_id: input.orderId,
        caller_id: user.id,
        receiver_id: input.receiverId,
        caller_role: input.callerRole,
        receiver_role: input.receiverRole,
        call_type: 'InApp',
        zego_call_id: roomId,
        status: 'Ringing',
      })
      .select()
      .single();
    if (error) { toast({ title: 'Call failed', description: error.message, variant: 'destructive' }); return; }

    setActive({
      callId: row.id,
      roomId,
      peerName: input.receiverName || input.receiverRole,
      status: 'ringing',
      isIncoming: false,
      startedAt: Date.now(),
    });

    try {
      await joinRoom(roomId);
    } catch (e: any) {
      toast({ title: 'Call setup failed', description: getCallErrorMessage(e), variant: 'destructive' });
      await supabase.from('voice_calls').update({ status: 'Cancelled', ended_at: new Date().toISOString() }).eq('id', row.id);
      cleanup();
    }
  }, [user, toast, joinRoom, cleanup]);

  const acceptIncoming = useCallback(async (call: { callId: string; roomId: string; peerName: string }) => {
    setActive({ ...call, status: 'connected', isIncoming: true, startedAt: Date.now() });
    await supabase.from('voice_calls').update({ status: 'Accepted' }).eq('id', call.callId);
    try { await joinRoom(call.roomId); } catch (e: any) {
      toast({ title: 'Cannot answer', description: getCallErrorMessage(e), variant: 'destructive' });
      await supabase.from('voice_calls').update({ status: 'Ended', ended_at: new Date().toISOString() }).eq('id', call.callId);
      cleanup();
    }
  }, [joinRoom, toast, cleanup]);

  const rejectIncoming = useCallback(async (callId: string) => {
    await supabase.from('voice_calls').update({ status: 'Rejected', ended_at: new Date().toISOString() }).eq('id', callId);
  }, []);

  const endCall = useCallback(async () => {
    if (!active) return;
    const duration = Math.round((Date.now() - active.startedAt) / 1000);
    await supabase.from('voice_calls').update({
      status: 'Ended',
      ended_at: new Date().toISOString(),
      duration_seconds: duration,
    }).eq('id', active.callId);
    await cleanup();
  }, [active, cleanup]);

  const toggleMute = useCallback(() => {
    if (!engineRef.current || !localStreamRef.current) return;
    const next = !muted;
    engineRef.current.mutePublishStreamAudio(localStreamRef.current, next);
    setMuted(next);
  }, [muted]);

  // Watch call status when we're the caller (peer accepted/rejected)
  useEffect(() => {
    if (!active || active.isIncoming) return;
    const ch = supabase
      .channel(`call-${active.callId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'voice_calls',
        filter: `id=eq.${active.callId}`,
      }, (payload) => {
        const s = (payload.new as any).status;
        if (s === 'Accepted') setActive((p) => p ? { ...p, status: 'connected', startedAt: Date.now() } : p);
        else if (s === 'Rejected' || s === 'Busy' || s === 'Cancelled' || s === 'Ended') {
          toast({ title: s === 'Rejected' ? 'Call declined' : 'Call ended' });
          cleanup();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active, cleanup, toast]);

  return {
    active,
    remoteStream,
    muted,
    remoteAudioRef,
    startCall,
    endCall,
    toggleMute,
    acceptIncoming,
    rejectIncoming,
  };
}

/** Log a Phone or WhatsApp click to voice_calls for analytics. */
export async function logExternalCall(input: {
  orderId: string;
  callerId: string;
  receiverId: string | null;
  callerRole: CallRole;
  receiverRole: CallRole;
  callType: 'Phone' | 'WhatsApp';
}) {
  await supabase.from('voice_calls').insert({
    order_id: input.orderId,
    caller_id: input.callerId,
    receiver_id: input.receiverId,
    caller_role: input.callerRole,
    receiver_role: input.receiverRole,
    call_type: input.callType,
    status: 'Ended',
    ended_at: new Date().toISOString(),
  });
}
