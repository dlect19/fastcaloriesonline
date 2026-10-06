import { supabase } from '@/integrations/supabase/client';

// Fetches the restricted browser Maps key once per app session.
// The server only ever returns GOOGLE_MAPS_BROWSER_KEY (never the server key).
let pending: Promise<string> | null = null;

export class MapsKeyError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

export function fetchBrowserMapsKey(): Promise<string> {
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabase.functions.invoke('get-google-maps-key', { body: {} });
      if (error) {
        let code = 'unavailable';
        try { code = (await (error as any).context?.json())?.error || code; } catch { /* ignore */ }
        throw new MapsKeyError(
          code === 'browser_key_not_configured'
            ? 'Maps are not configured yet. An administrator needs to add the browser map key.'
            : code === 'rate_limited'
              ? 'Too many map requests. Please wait a minute and try again.'
              : 'Map unavailable right now.',
          code,
        );
      }
      if (!data?.key) throw new MapsKeyError('Map unavailable right now.', 'unavailable');
      return data.key as string;
    })().catch((e) => { pending = null; throw e; });
  }
  return pending;
}
