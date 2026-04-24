// Global audio manager for push notification sounds
// Uses Web Audio API as primary (works reliably in background tabs once unlocked)
// HTMLAudioElement as fallback for iOS / older browsers.

let htmlAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let decodedBuffer: AudioBuffer | null = null;
let isUnlocked = false;
let decodingPromise: Promise<void> | null = null;

const SOUND_URL = '/sounds/new-order.mp3';

function getHtmlAudio(): HTMLAudioElement {
  if (!htmlAudio) {
    htmlAudio = new Audio(SOUND_URL);
    htmlAudio.preload = 'auto';
    htmlAudio.load();
  }
  return htmlAudio;
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctx: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  try {
    audioCtx = new Ctx();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

async function decodeBuffer(): Promise<void> {
  const ctx = ensureAudioContext();
  if (!ctx || decodedBuffer) return;
  if (decodingPromise) return decodingPromise;
  decodingPromise = (async () => {
    try {
      const res = await fetch(SOUND_URL);
      const arr = await res.arrayBuffer();
      decodedBuffer = await ctx.decodeAudioData(arr.slice(0));
      console.log('[GlobalAudio] Web Audio buffer decoded');
    } catch (e) {
      console.warn('[GlobalAudio] Failed to decode buffer:', e);
    }
  })();
  return decodingPromise;
}

// Unlock both APIs on user interaction. Re-runs on every gesture so the
// AudioContext is resumed after any browser auto-suspend.
async function unlockAudio() {
  // 1. Unlock HTMLAudioElement (silent play/pause)
  try {
    const a = getHtmlAudio();
    const prevVol = a.volume;
    a.volume = 0;
    await a.play();
    a.pause();
    a.currentTime = 0;
    a.volume = prevVol || 1.0;
  } catch {
    // ignore
  }

  // 2. Resume / create AudioContext
  const ctx = ensureAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    // Decode the sound buffer once the context is alive
    decodeBuffer();
  }

  if (!isUnlocked) {
    isUnlocked = true;
    console.log('[GlobalAudio] Audio unlocked via user interaction');
    startKeepAlive();
  }
}

// ----- Keep-alive: a near-silent looping Web Audio source keeps the tab
// considered "playing audio", which prevents Chrome from suspending the
// AudioContext and from throttling our timers in background tabs. -----
let keepAliveStarted = false;
function startKeepAlive() {
  if (keepAliveStarted) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    // 1-second silent buffer, looped forever
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001; // effectively silent
    src.connect(gain).connect(ctx.destination);
    src.start(0);
    keepAliveStarted = true;
    console.log('[GlobalAudio] Keep-alive silent track started');
  } catch (e) {
    console.warn('[GlobalAudio] Keep-alive failed:', e);
  }
}

// Listen for user interactions — keep listening (don't remove) so we can
// resume the AudioContext if the browser ever suspends it.
if (typeof window !== 'undefined') {
  const events = ['click', 'touchstart', 'keydown', 'pointerdown'];
  const handler = () => { unlockAudio(); };
  events.forEach(e =>
    document.addEventListener(e, handler, { capture: true, passive: true })
  );

  // When tab becomes visible, resume the AudioContext (it can suspend in bg)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audioCtx?.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  });
}

function playViaWebAudio(): boolean {
  const ctx = audioCtx;
  if (!ctx || !decodedBuffer) return false;
  // Resume if suspended (best-effort, fire-and-forget)
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  try {
    const source = ctx.createBufferSource();
    source.buffer = decodedBuffer;
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    source.connect(gain).connect(ctx.destination);
    source.start(0);
    return true;
  } catch (e) {
    console.warn('[GlobalAudio] Web Audio play failed:', e);
    return false;
  }
}

function playViaHtmlAudio() {
  const audio = getHtmlAudio();
  audio.currentTime = 0;
  audio.volume = 1.0;
  audio.play().catch(err => {
    console.warn('[GlobalAudio] HTMLAudio playback blocked:', err.message);
  });
}

export function playGlobalNotificationSound() {
  // Prefer Web Audio (reliable in background tabs once unlocked)
  const played = playViaWebAudio();
  if (!played) {
    playViaHtmlAudio();
  }

  // Vibrate if supported (mobile only)
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }
}

export function isAudioUnlocked() {
  return isUnlocked;
}
