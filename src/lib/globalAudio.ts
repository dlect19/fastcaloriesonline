// Global audio manager for push notification sounds
// Ensures audio is unlocked once via user interaction and reused everywhere

let globalAudio: HTMLAudioElement | null = null;
let isUnlocked = false;

function getAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio('/sounds/new-order.mp3');
    globalAudio.load();
  }
  return globalAudio;
}

// Unlock audio context on first user interaction
function unlockAudio() {
  if (isUnlocked) return;
  const audio = getAudio();
  audio.volume = 0;
  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1.0;
    isUnlocked = true;
    console.log('[GlobalAudio] Audio unlocked via user interaction');
  }).catch(() => {
    // Still blocked, will retry on next interaction
  });
}

// Listen for any user interaction to unlock audio
if (typeof window !== 'undefined') {
  const events = ['click', 'touchstart', 'keydown'];
  const handler = () => {
    unlockAudio();
    if (isUnlocked) {
      events.forEach(e => document.removeEventListener(e, handler, true));
    }
  };
  events.forEach(e => document.addEventListener(e, handler, { capture: true, passive: true }));
}

export function playGlobalNotificationSound() {
  const audio = getAudio();
  audio.currentTime = 0;
  audio.volume = 1.0;
  audio.play().catch(err => {
    console.warn('[GlobalAudio] Playback blocked:', err.message);
  });

  // Vibrate if supported
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }
}

export function isAudioUnlocked() {
  return isUnlocked;
}
