import { useRef, useState, useEffect, useCallback } from 'react';

interface UseRepeatingNotificationSoundOptions {
  intervalMs?: number;
  storageKey?: string;
}

interface UseRepeatingNotificationSoundReturn {
  playOnce: () => void;
  startRepeating: () => void;
  stopRepeating: () => void;
  isPlaying: boolean;
  soundEnabled: boolean;
  isBlocked: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  unlock: () => Promise<boolean>;
}

export function useRepeatingNotificationSound(options: UseRepeatingNotificationSoundOptions = {}): UseRepeatingNotificationSoundReturn {
  const { intervalMs = 10000, storageKey = 'notification-sound' } = options;
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState(() => {
    return localStorage.getItem(storageKey) !== 'false';
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    // Preload the audio
    const audio = new Audio('/sounds/new-order.mp3');
    audio.load();
    audioRef.current = audio;
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, String(soundEnabled));
  }, [soundEnabled, storageKey]);

  const playOnce = useCallback(() => {
    if (!audioRef.current) return;
    
    audioRef.current.currentTime = 0;
    audioRef.current.play()
      .then(() => {
        setIsBlocked(false);
        // Vibrate if supported (mobile devices)
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      })
      .catch((err) => {
        console.warn('Audio playback blocked:', err.name);
        if (err.name === 'NotAllowedError') {
          setIsBlocked(true);
        }
      });
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    if (!audioRef.current) return false;
    
    try {
      audioRef.current.currentTime = 0;
      await audioRef.current.play();
      setIsBlocked(false);
      setSoundEnabledState(true);
      localStorage.setItem(storageKey, 'true');
      return true;
    } catch (err) {
      console.warn('Failed to unlock audio:', err);
      return false;
    }
  }, [storageKey]);

  const startRepeating = useCallback(() => {
    if (!soundEnabled) {
      console.log('Sound disabled, not starting repeat');
      return;
    }
    
    // Play immediately
    playOnce();
    setIsPlaying(true);
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    // Set up repeating interval
    intervalRef.current = setInterval(() => {
      playOnce();
    }, intervalMs);
  }, [soundEnabled, playOnce, intervalMs]);

  const stopRepeating = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const toggleSound = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    if (!enabled) {
      stopRepeating();
    }
  }, [stopRepeating]);

  return { 
    playOnce,
    startRepeating,
    stopRepeating,
    isPlaying,
    soundEnabled,
    isBlocked,
    setSoundEnabled: toggleSound,
    unlock
  };
}
