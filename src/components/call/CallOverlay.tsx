import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { playDialTone } from '@/lib/callTones';

interface Active {
  callId: string;
  roomId: string;
  peerName: string;
  status: 'ringing' | 'connected' | 'ended';
  isIncoming: boolean;
  startedAt: number;
}

interface Incoming {
  callId: string;
  roomId: string;
  peerName: string;
  callerRole: string;
  orderId: string;
}

interface Props {
  active: Active | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  speaker: boolean;
  incoming: Incoming | null;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  remoteAudioRef?: React.MutableRefObject<HTMLAudioElement | null>;
}

function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CallOverlay({ active, remoteStream, muted, incoming, onAccept, onReject, onEnd, onToggleMute }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!active || active.status !== 'connected') { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - active.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Outgoing dial/ringback tone while our call is ringing (not for incoming side).
  useEffect(() => {
    if (!active || active.isIncoming || active.status !== 'ringing') return;
    const stop = playDialTone();
    return () => stop();
  }, [active?.status, active?.isIncoming, active?.callId]);

  // Incoming call ringing overlay
  if (incoming && !active) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95"
        >
          <div className="relative mb-8">
            <motion.div
              animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute inset-0 rounded-full bg-green-500/30"
              style={{ width: 160, height: 160, top: -40, left: -40 }}
            />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/50">
              <Phone className="h-10 w-10 text-white" />
            </div>
          </div>
          <p className="text-sm uppercase tracking-widest text-green-400">Incoming Call</p>
          <h2 className="mt-1 text-3xl font-bold text-white capitalize">{incoming.callerRole}</h2>
          <p className="mb-12 text-sm text-gray-400">Order #{incoming.orderId.slice(0, 8)}</p>
          <div className="flex items-center gap-12">
            <button onClick={onReject} className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/40 active:scale-95 transition">
                <PhoneOff className="h-7 w-7 text-white" />
              </div>
              <span className="text-xs text-gray-400">Decline</span>
            </button>
            <button onClick={onAccept} className="flex flex-col items-center gap-2">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/40 active:scale-95 transition"
              >
                <Phone className="h-7 w-7 text-white" />
              </motion.div>
              <span className="text-xs text-gray-400">Answer</span>
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  if (!active) return null;

  // Active / outgoing call
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black"
      >
        <audio ref={audioRef} autoPlay playsInline />
        <div className="relative mb-8">
          {active.status === 'ringing' && (
            <motion.div
              animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="absolute inset-0 rounded-full bg-primary/30"
              style={{ width: 160, height: 160, top: -40, left: -40 }}
            />
          )}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/50">
            <Phone className="h-10 w-10 text-primary-foreground" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-white capitalize">{active.peerName}</h2>
        <p className="mt-2 text-sm text-gray-400">
          {active.status === 'ringing' ? 'Ringing…' : fmtDuration(elapsed)}
        </p>

        <div className="mt-12 flex items-center gap-8">
          <button onClick={onToggleMute} className="flex flex-col items-center gap-2">
            <div className={`flex h-14 w-14 items-center justify-center rounded-full ${muted ? 'bg-red-500' : 'bg-white/10'} active:scale-95 transition`}>
              {muted ? <MicOff className="h-6 w-6 text-white" /> : <Mic className="h-6 w-6 text-white" />}
            </div>
            <span className="text-xs text-gray-400">{muted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button onClick={onEnd} className="flex flex-col items-center gap-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/40 active:scale-95 transition">
              <PhoneOff className="h-7 w-7 text-white" />
            </div>
            <span className="text-xs text-gray-400">End</span>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
