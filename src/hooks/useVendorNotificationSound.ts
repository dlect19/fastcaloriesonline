import { isStaffPortalPath } from '@/lib/portalScope';
import { useRef, useState, useEffect, useCallback } from 'react';

export function useVendorNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('vendor-notification-sound') !== 'false';
  });

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('vendor-notification-sound', String(soundEnabled));
  }, [soundEnabled]);

  const playNotification = useCallback(() => {
    if (soundEnabled && isStaffPortalPath(window.location.pathname)) {
      if (!audioRef.current) audioRef.current = new Audio(['/sounds/', 'new-order', '.mp3'].join(''));
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        console.error('Failed to play notification sound:', err);
      });
      
      // Vibrate if supported (mobile devices)
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    }
  }, [soundEnabled]);

  const toggleSound = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled);
  }, []);

  return { 
    playNotification, 
    soundEnabled, 
    setSoundEnabled: toggleSound 
  };
}
