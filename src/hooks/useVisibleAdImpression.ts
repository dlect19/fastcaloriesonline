import { useEffect, useRef } from 'react';

/** Count only the selected creative while actually in a visible document/viewport. */
export function useVisibleAdImpression(
  identity: string | null | undefined,
  record: () => Promise<boolean>,
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!identity || !element || typeof IntersectionObserver === 'undefined') return;
    let visible = false;
    let stopped = false;
    let pending = false;
    let saved = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      if (stopped || saved || pending || !visible || document.visibilityState !== 'visible' || attempts >= 3) return;
      pending = true;
      attempts++;
      try { saved = await record(); } catch { saved = false; }
      pending = false;
      if (!saved && !stopped && attempts < 3) retry = setTimeout(attempt, attempts * 2000);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      void attempt();
    }, { threshold: [0, 0.5] });
    observer.observe(element);
    document.addEventListener('visibilitychange', attempt);
    return () => {
      stopped = true;
      observer.disconnect();
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', attempt);
    };
  }, [identity, record]);
  return ref;
}