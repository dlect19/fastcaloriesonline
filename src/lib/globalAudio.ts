import { claimSoundEvent } from './orderSoundGate';
import { isStaffPortalPath } from './portalScope';

// Staff-portal order alert audio. SIDE-EFFECT FREE ON IMPORT:
// - no document/window gesture listeners, no automatic unlock
// - no Audio element, fetch or decode until a claimed, keyed order event plays
// - only ever plays while the current route is a vendor/admin/rider portal
// Customer routes never import this module (portal pages are lazy-loaded).

let audioCtx: AudioContext | null = null;
let decodedBuffer: AudioBuffer | null = null;
let decodingPromise: Promise<void> | null = null;
let isUnlocked = false;

// Built at runtime so the customer entry bundle never contains the file name.
function orderSoundUrl(): string {
  return ['/sounds/', 'new-order', '.mp3'].join('');
}

function inPortal(): boolean {
  return typeof window !== 'undefined' && isStaffPortalPath(window.location?.pathname);
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctx: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  try { audioCtx = new Ctx(); } catch { audioCtx = null; }
  return audioCtx;
}

async function decodeBuffer(): Promise<void> {
  const ctx = ensureAudioContext();
  if (!ctx || decodedBuffer) return;
  if (decodingPromise) return decodingPromise;
  decodingPromise = (async () => {
    try {
      const res = await fetch(orderSoundUrl());
      const arr = await res.arrayBuffer();
      decodedBuffer = await ctx.decodeAudioData(arr.slice(0));
    } catch (e) {
      console.warn('[OrderAudio] decode failed:', e);
      decodingPromise = null;
    }
  })();
  return decodingPromise;
}

/**
 * Explicit "Enable Sound" control inside a staff portal. Resumes Web Audio and
 * plays a generated one-sample silent buffer. Never touches the order file.
 */
export async function unlockAudio(): Promise<boolean> {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  try { if (ctx.state === 'suspended') await ctx.resume(); } catch { /* ignore */ }
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
  isUnlocked = true;
  return true;
}

async function playNow() {
  const ctx = ensureAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    await decodeBuffer();
    if (decodedBuffer) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(ctx.destination);
        source.start(0);
        return;
      } catch { /* fall through */ }
    }
  }
  try {
    const a = new Audio(orderSoundUrl());
    await a.play();
  } catch (err: any) {
    console.warn('[OrderAudio] playback blocked:', err?.message);
  }
}

/** Plays the order tone (portal routes only). Used by portal repeaters. */
export function playGlobalNotificationSound() {
  if (!inPortal()) return;
  void playNow();
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }
}

/** Plays once per stable event key per device, portal routes only. */
export function playOrderSoundOnce(key: string | null | undefined): boolean {
  if (!inPortal()) return false;
  if (!claimSoundEvent(key)) return false;
  playGlobalNotificationSound();
  return true;
}

export function isAudioUnlocked() {
  return isUnlocked;
}
