import { useRef, useState, useEffect, useCallback } from 'react';

interface UseRepeatingNotificationSoundOptions {
  intervalMs?: number;
  storageKey?: string;
}

export function useRepeatingNotificationSound(options: UseRepeatingNotificationSoundOptions = {}) {
  const { intervalMs = 10000, storageKey = 'notification-sound' } = options;
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem(storageKey) !== 'false';
  });
  const [isPlaying, setIsPlaying] = useState(false);

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
    console.log('playOnce called, soundEnabled:', soundEnabled, 'audioRef:', !!audioRef.current);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play()
        .then(() => console.log('Audio played successfully'))
        .catch((err) => {
          console.error('Failed to play notification sound:', err);
        });
      
      // Vibrate if supported (mobile devices)
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    }
  }, []);

  const startRepeating = useCallback(() => {
    console.log('startRepeating called, soundEnabled:', soundEnabled);
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
      console.log('Interval tick - playing sound');
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
    setSoundEnabled(enabled);
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
    setSoundEnabled: toggleSound 
  };
}
