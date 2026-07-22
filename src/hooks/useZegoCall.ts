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
  const [speaker, setSpeaker] = useState(true); // default hands-free speaker on
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
    setSpeaker(true);
  }, [active, user?.id]);

  // Join zego room and publish/subscribe audio
  const joinRoom = useCallback(async (roomId: string) => {
    if (!user) throw new Error('No user');
    const host = typeof window !== 'undefined' ? window.location.hostname : 'ssr';
    const isPreview = /lovableproject\.com$|id-preview--/.test(host);
    const isPublished = /lovable\.app$/.test(host) && !isPreview;
    console.log('[zego] env', {
      host,
      origin: typeof window !== 'undefined' ? window.location.origin : 'ssr',
      environment: isPreview ? 'preview' : isPublished ? 'published' : 'other',
      protocol: typeof window !== 'undefined' ? window.location.protocol : 'ssr',
    });
    const tokenResp = await getZegoToken(roomId);
    const { token, appId, userId: tokenUserId, expiresAt } = tokenResp;
    console.log('[zego] token received', {
      appId,
      tokenUserId,
      clientUserId: user.id,
      userIdMatches: tokenUserId === user.id,
      roomId,
      tokenReceived: !!token,
      tokenLen: token?.length ?? 0,
      tokenPrefix: token?.slice(0, 2),
      expiresAt,
      secondsUntilExpiry: expiresAt ? expiresAt - Math.floor(Date.now() / 1000) : null,
    });
    if (!token) throw new Error('No Zego token returned from server');
    if (tokenUserId && tokenUserId !== user.id) {
      throw new Error(`Zego token userId mismatch: token=${tokenUserId} client=${user.id}`);
    }

    const engine = await getEngine(appId);
    engineRef.current = engine;
    await assertMicrophoneReady(engine);

    engine.on('roomStreamUpdate', async (_r, updateType, streamList) => {
      if (updateType === 'ADD' && streamList[0]) {
        const rs = await engine.startPlayingStream(streamList[0].streamID);
        setRemoteStream(rs as unknown as MediaStream);
      }
    });

    try {
      const loginResp = await engine.loginRoom(
        roomId,
        token,
        { userID: user.id, userName: user.email || user.id },
        { userUpdate: true },
      );
      console.log('[zego] loginRoom ok', { roomId, loginResp });
    } catch (loginErr: any) {
      console.error('[zego] loginRoom failed', {
        roomId,
        appId,
        userId: user.id,
        errCode: loginErr?.code ?? loginErr?.errorCode,
        errMsg: loginErr?.message ?? loginErr?.msg ?? String(loginErr),
        full: loginErr,
      });
      throw loginErr;
    }

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

    // Fire push notification so the receiver's device rings even when the app is backgrounded.
    // Non-blocking — call setup should not fail if push fails.
    supabase.functions.invoke('send-push-notification', {
      body: {
        user_id: input.receiverId,
        title: `Incoming call`,
        body: `${input.callerRole === 'customer' ? 'A customer' : input.callerRole === 'vendor' ? 'A vendor' : 'A rider'} is calling you`,
        url: `/?call=${row.id}`,
        data: {
          type: 'CALL',
          callId: row.id,
          roomId,
          orderId: input.orderId,
          callerRole: input.callerRole,
          receiverRole: input.receiverRole,
        },
      },
    }).catch((e) => console.warn('[call] push notify failed', e));

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

  const toggleSpeaker = useCallback(async () => {
    const next = !speaker;
    setSpeaker(next);
    // Best-effort route switch on WebRTC — routes remote audio to speaker vs earpiece
    // where the platform supports HTMLMediaElement.setSinkId (Chromium/desktop, some Android WebViews).
    try {
      const audioEl = remoteAudioRef.current as any;
      if (audioEl && typeof audioEl.setSinkId === 'function') {
        // 'default' = system default (usually earpiece on mobile), '' = speaker fallback.
        // Try to find a "speaker" output device explicitly.
        let sinkId = 'default';
        if (next && navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const speakerDev = devices.find(
            (d) => d.kind === 'audiooutput' && /speaker|speakerphone/i.test(d.label)
          );
          if (speakerDev) sinkId = speakerDev.deviceId;
        }
        await audioEl.setSinkId(sinkId);
      }
    } catch (e) {
      console.warn('[zego] toggleSpeaker setSinkId failed', e);
    }
  }, [speaker]);

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
    speaker,
    remoteAudioRef,
    startCall,
    endCall,
    toggleMute,
    toggleSpeaker,
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
