import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useZegoCall } from '@/hooks/useZegoCall';
import { CallOverlay } from '@/components/call/CallOverlay';
import { playRingTone } from '@/lib/callTones';

interface IncomingCall {
  callId: string;
  roomId: string;
  peerName: string;
  callerRole: string;
  orderId: string;
}

interface Ctx {
  startCall: ReturnType<typeof useZegoCall>['startCall'];
}

const CallCtx = createContext<Ctx | null>(null);

export function useCall() {
  const c = useContext(CallCtx);
  if (!c) throw new Error('useCall must be used inside CallProvider');
  return c;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const call = useZegoCall();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  // Subscribe for incoming calls where I'm the receiver
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`incoming-calls-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'voice_calls',
        filter: `receiver_id=eq.${user.id}`,
      }, async (payload) => {
        const row = payload.new as any;
        if (row.call_type !== 'InApp' || row.status !== 'Ringing') return;
        // Skip if already on a call
        if (call.active) {
          await supabase.from('voice_calls').update({ status: 'Busy', ended_at: new Date().toISOString() }).eq('id', row.id);
          return;
        }
        setIncoming({
          callId: row.id,
          roomId: row.zego_call_id,
          peerName: row.caller_role,
          callerRole: row.caller_role,
          orderId: row.order_id,
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, call.active]);

  // Ringtone loop while incoming
  useEffect(() => {
    if (!incoming) {
      ringtoneRef.current?.pause();
      return;
    }
    const a = new Audio('/notification.mp3');
    a.loop = true;
    a.volume = 0.9;
    a.play().catch(() => {});
    ringtoneRef.current = a;
    return () => { a.pause(); };
  }, [incoming]);

  const accept = async () => {
    if (!incoming) return;
    await call.acceptIncoming({ callId: incoming.callId, roomId: incoming.roomId, peerName: incoming.peerName });
    setIncoming(null);
  };
  const reject = async () => {
    if (!incoming) return;
    await call.rejectIncoming(incoming.callId);
    setIncoming(null);
  };

  // Auto-clear incoming if caller cancels
  useEffect(() => {
    if (!incoming) return;
    const ch = supabase
      .channel(`inc-watch-${incoming.callId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'voice_calls',
        filter: `id=eq.${incoming.callId}`,
      }, (payload) => {
        const s = (payload.new as any).status;
        if (s === 'Cancelled' || s === 'Ended') setIncoming(null);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [incoming]);

  return (
    <CallCtx.Provider value={{ startCall: call.startCall }}>
      {children}
      <CallOverlay
        active={call.active}
        remoteStream={call.remoteStream}
        muted={call.muted}
        incoming={incoming}
        onAccept={accept}
        onReject={reject}
        onEnd={call.endCall}
        onToggleMute={call.toggleMute}
      />
    </CallCtx.Provider>
  );
}
