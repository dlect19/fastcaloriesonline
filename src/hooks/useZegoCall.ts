import { useEffect, useRef, useState, useCallback } from 'react';
import { ZegoExpressEngine } from 'zego-express-engine-webrtc';
import { getZegoToken, makeCallRoomId, makeZegoUserId } from '@/lib/zegoToken';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

type CallRole = 'customer' | 'vendor' | 'rider' | 'admin';

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
  // IMPORTANT: Zego Web SDK requires an app-specific edge server URL.
  // Using the generic `webliveroom-api.zego.im` endpoint causes the RTC socket
  // to authenticate but then drop with `network timeout` a few seconds later,
  // which produces "call connects but no audio on either end".
  const server = `wss://webliveroom${appId}-api.coolzcloud.com/ws`;
  engineSingleton = new ZegoExpressEngine(appId, server);
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
  const zegoUserIdRef = useRef<string | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const cleanup = useCallback(async () => {
    const currentCall = activeRef.current;
    try {
      if (engineRef.current && currentCall) {
        if (localStreamRef.current) {
          engineRef.current.destroyStream(localStreamRef.current);
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        const zegoUserId = zegoUserIdRef.current || (user?.id ? makeZegoUserId(user.id, 'customer') : '');
        if (zegoUserId) engineRef.current.stopPublishingStream(`s_${zegoUserId}`);
        await engineRef.current.logoutRoom(currentCall.roomId);
      }
    } catch (e) { console.warn('call cleanup', e); }
    localStreamRef.current = null;
    zegoUserIdRef.current = null;
    activeRef.current = null;
    setRemoteStream(null);
    setActive(null);
    setMuted(false);
    setSpeaker(true);
  }, [user?.id]);

  // Join zego room and publish/subscribe audio
  const joinRoom = useCallback(async (roomId: string, role: CallRole) => {
    if (!user) throw new Error('No user');
    const zegoUserId = makeZegoUserId(user.id, role);
    zegoUserIdRef.current = zegoUserId;
    const host = typeof window !== 'undefined' ? window.location.hostname : 'ssr';
    const isPreview = /lovableproject\.com$|id-preview--/.test(host);
    const isPublished = /lovable\.app$/.test(host) && !isPreview;
    console.log('[zego] env', {
      host,
      origin: typeof window !== 'undefined' ? window.location.origin : 'ssr',
      environment: isPreview ? 'preview' : isPublished ? 'published' : 'other',
      protocol: typeof window !== 'undefined' ? window.location.protocol : 'ssr',
    });
    const tokenResp = await getZegoToken(roomId, zegoUserId);
    const { token, appId, userId: tokenUserId, expiresAt } = tokenResp;
    console.log('[zego] token received', {
      appId,
      tokenUserId,
      clientUserId: zegoUserId,
      authUserId: user.id,
      role,
      userIdMatches: tokenUserId === zegoUserId,
      roomId,
      tokenReceived: !!token,
      tokenLen: token?.length ?? 0,
      tokenPrefix: token?.slice(0, 2),
      expiresAt,
      secondsUntilExpiry: expiresAt ? expiresAt - Math.floor(Date.now() / 1000) : null,
    });
    if (!token) throw new Error('No Zego token returned from server');
    if (tokenUserId && tokenUserId !== zegoUserId) {
      throw new Error(`Zego token userId mismatch: token=${tokenUserId} client=${zegoUserId}`);
    }

    const engine = await getEngine(appId);
    engineRef.current = engine;
    await assertMicrophoneReady(engine);

    // Remove any prior listener before re-registering — the engine is a singleton,
    // so back-to-back calls would otherwise accumulate handlers and can drop the
    // remote stream on the second call.
    engine.off('roomStreamUpdate');
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
        { userID: zegoUserId, userName: user.email || role },
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
    engine.startPublishingStream(`s_${zegoUserId}`, stream);
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
    const callerLabel =
      input.callerRole === 'admin' ? 'FastCalories'
      : input.callerRole === 'customer' ? 'A customer'
      : input.callerRole === 'vendor' ? 'A vendor'
      : 'A rider';
    supabase.functions.invoke('send-push-notification', {
      body: {
        user_id: input.receiverId,
        title: input.callerRole === 'admin' ? 'FastCalories is calling' : 'Incoming call',
        body: `${callerLabel} is calling you`,
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
      await joinRoom(roomId, input.callerRole);
    } catch (e: any) {
      toast({ title: 'Call setup failed', description: getCallErrorMessage(e), variant: 'destructive' });
      await supabase.from('voice_calls').update({ status: 'Cancelled', ended_at: new Date().toISOString() }).eq('id', row.id);
      cleanup();
    }
  }, [user, toast, joinRoom, cleanup]);

  const acceptIncoming = useCallback(async (call: { callId: string; roomId: string; peerName: string; receiverRole: CallRole }) => {
    setActive({ ...call, status: 'connected', isIncoming: true, startedAt: Date.now() });
    await supabase.from('voice_calls').update({ status: 'Accepted' }).eq('id', call.callId);
    try { await joinRoom(call.roomId, call.receiverRole); } catch (e: any) {
      toast({ title: 'Cannot answer', description: getCallErrorMessage(e), variant: 'destructive' });
      await supabase.from('voice_calls').update({ status: 'Ended', ended_at: new Date().toISOString() }).eq('id', call.callId);
      cleanup();
    }
  }, [joinRoom, toast, cleanup]);

  const rejectIncoming = useCallback(async (callId: string) => {
    await supabase.from('voice_calls').update({ status: 'Rejected', ended_at: new Date().toISOString() }).eq('id', callId);
  }, []);

  const endCall = useCallback(async () => {
    const currentCall = activeRef.current;
    if (!currentCall) return;
    const duration = Math.round((Date.now() - currentCall.startedAt) / 1000);
    await supabase.from('voice_calls').update({
      status: 'Ended',
      ended_at: new Date().toISOString(),
      duration_seconds: duration,
    }).eq('id', currentCall.callId);
    await cleanup();
  }, [cleanup]);

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

  const handleRemoteCallStatus = useCallback((status: string) => {
    const currentCall = activeRef.current;
    if (!currentCall) return;

    if (status === 'Accepted' && !currentCall.isIncoming) {
      setActive((p) => p ? { ...p, status: 'connected', startedAt: Date.now() } : p);
      return;
    }

    if (status === 'Rejected' || status === 'Busy' || status === 'Cancelled' || status === 'Ended') {
      toast({ title: status === 'Rejected' ? 'Call declined' : 'Call ended' });
      cleanup();
    }
  }, [cleanup, toast]);

  // Watch call status for both sides — caller sees accept/reject, both sides see remote End.
  useEffect(() => {
    if (!active) return;
    const callId = active.callId;
    const ch = supabase
      .channel(`call-status-${callId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'voice_calls',
        filter: `id=eq.${callId}`,
      }, (payload) => {
        handleRemoteCallStatus((payload.new as any).status);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active?.callId, handleRemoteCallStatus]);

  // Fallback for mobile/background cases where Realtime UPDATE events are throttled or missed.
  useEffect(() => {
    if (!active) return;
    const callId = active.callId;
    const interval = window.setInterval(async () => {
      if (!activeRef.current || activeRef.current.callId !== callId) return;
      const { data } = await supabase
        .from('voice_calls')
        .select('status')
        .eq('id', callId)
        .maybeSingle();
      if (data?.status) handleRemoteCallStatus(data.status);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [active?.callId, handleRemoteCallStatus]);

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
