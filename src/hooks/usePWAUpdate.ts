import { useEffect, useCallback, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function usePWAUpdate() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Check for updates every 60 seconds
      if (registration) {
        setInterval(() => {
          registration.update();
        }, 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error);
    },
  });

  useEffect(() => {
    if (needRefresh) {
      setShowUpdateBanner(true);
    }
  }, [needRefresh]);

  const applyUpdate = useCallback(() => {
    setShowUpdateBanner(false);
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  const dismissUpdate = useCallback(() => {
    setShowUpdateBanner(false);
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  return {
    showUpdateBanner,
    applyUpdate,
    dismissUpdate,
  };
}
