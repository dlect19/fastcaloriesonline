// Royalty-free call tones generated via Web Audio API.
// No audio assets required. Each starter returns a stop() function.
// - Dial/ringback: dual-tone ~440+480Hz, 2s on / 4s off (classic US ringback pattern, softened)
// - Incoming ringtone: pleasant two-tone chime loop

type Stop = () => void;

function createCtx(): AudioContext | null {
  try {
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return null;
    return new Ctor();
  } catch { return null; }
}

/** Outgoing ringback tone: repeating 2s ring, 4s silence. */
export function playDialTone(volume = 0.15): Stop {
  const ctx = createCtx();
  if (!ctx) return () => {};
  let stopped = false;
  let currentNodes: AudioNode[] = [];

  const tick = () => {
    if (stopped) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.05);
    gain.gain.setValueAtTime(volume, now + 1.95);
    gain.gain.linearRampToValueAtTime(0, now + 2.0);
    gain.connect(ctx.destination);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 440;
    o1.connect(gain);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 480;
    o2.connect(gain);
    o1.start(now); o2.start(now);
    o1.stop(now + 2.0); o2.stop(now + 2.0);
    currentNodes = [o1, o2, gain];
    setTimeout(tick, 6000);
  };
  tick();

  return () => {
    stopped = true;
    try { currentNodes.forEach((n: any) => { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} }); } catch {}
    try { ctx.close(); } catch {}
  };
}

/** Incoming ringtone: pleasant two-tone chime, looping. */
export function playRingTone(volume = 0.2): Stop {
  const ctx = createCtx();
  if (!ctx) return () => {};
  let stopped = false;
  let nodes: AudioNode[] = [];

  const tick = () => {
    if (stopped) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.connect(ctx.destination);

    const notes = [
      { f: 660, t: 0.0, d: 0.35 },
      { f: 880, t: 0.35, d: 0.5 },
      { f: 660, t: 1.1, d: 0.35 },
      { f: 880, t: 1.45, d: 0.5 },
    ];
    notes.forEach(({ f, t, d }) => {
      gain.gain.setValueAtTime(0, now + t);
      gain.gain.linearRampToValueAtTime(volume, now + t + 0.03);
      gain.gain.setValueAtTime(volume, now + t + d - 0.05);
      gain.gain.linearRampToValueAtTime(0, now + t + d);
    });
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    notes.forEach(({ f, t }) => osc.frequency.setValueAtTime(f, now + t));
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 2.1);
    nodes = [osc, gain];
    setTimeout(tick, 3000);
  };
  tick();

  return () => {
    stopped = true;
    try { nodes.forEach((n: any) => { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} }); } catch {}
    try { ctx.close(); } catch {}
  };
}
