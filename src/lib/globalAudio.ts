import { claimSoundEvent } from './orderSoundGate';
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

// Unlock audio on user interaction WITHOUT ever playing the real order sound.
// iOS Safari/WKWebView ignores HTMLAudioElement.volume, so "silent" play of
// new-order.mp3 is audible there. We only resume the Web Audio context and
// play a generated silent buffer, which unlocks output on every platform.
export async function unlockAudio(): Promise<boolean> {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch { /* ignore */ }
  try {
    const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = silent;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
  decodeBuffer();
  if (!isUnlocked) {
    isUnlocked = true;
    startKeepAlive();
  }
  return ctx.state === 'running' || isUnlocked;
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

// One-time gesture unlock; afterwards only resume a suspended context.
if (typeof window !== 'undefined') {
  const events = ['click', 'touchstart', 'keydown', 'pointerdown'];
  const handler = () => {
    if (isUnlocked && audioCtx?.state !== 'suspended') {
      events.forEach(e => document.removeEventListener(e, handler, { capture: true } as any));
      return;
    }
    unlockAudio();
  };
  events.forEach(e =>
    document.addEventListener(e, handler, { capture: true, passive: true })
  );

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

/**
 * Play the order sound only if this event key has never been claimed on this
 * device. Returns true when it played.
 */
export function playOrderSoundOnce(key: string | null | undefined): boolean {
  if (!claimSoundEvent(key)) return false;
  playGlobalNotificationSound();
  return true;
}

export function isAudioUnlocked() {
  return isUnlocked;
}
