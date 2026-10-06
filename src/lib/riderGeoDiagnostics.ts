// Truthful classification of rider location problems (no network, no coordinates).

export type GeoProblem =
  | 'device_location_off'     // phone location service off (native) / likely off (web code 2)
  | 'site_permission_denied'  // browser/site permission blocked (web/PWA)
  | 'app_permission_denied'   // Android/iOS app permission denied (native)
  | 'permission_prompt'       // permission not yet granted; needs a tap
  | 'timeout'                 // no fix within the bounded timeout
  | 'position_unavailable'    // browser could not obtain a fix
  | 'insecure_context'        // page not served over HTTPS
  | 'unsupported';            // no geolocation API

export const GEO_DIAGNOSTIC_CODE: Record<GeoProblem, string> = {
  device_location_off: 'LOC_SERVICE_OFF',
  site_permission_denied: 'WEB_PERMISSION_DENIED',
  app_permission_denied: 'APP_PERMISSION_DENIED',
  permission_prompt: 'PERMISSION_PROMPT',
  timeout: 'GPS_TIMEOUT',
  position_unavailable: 'POSITION_UNAVAILABLE',
  insecure_context: 'INSECURE_CONTEXT',
  unsupported: 'GEO_UNSUPPORTED',
};

export type WebPermState = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Environment problems detectable before asking for a fix. */
export function webPreflight(env: { secure: boolean; hasGeo: boolean }): GeoProblem | null {
  if (!env.secure) return 'insecure_context';
  if (!env.hasGeo) return 'unsupported';
  return null;
}

/**
 * Web GeolocationPositionError → problem. Code 1 is a permission denial
 * (site setting, or Chrome itself lacking Android location permission);
 * if the Permissions API still says "prompt" the rider dismissed the prompt.
 */
export function classifyWebError(code: number | undefined, perm: WebPermState): GeoProblem {
  if (code === 1) return perm === 'prompt' ? 'permission_prompt' : 'site_permission_denied';
  if (code === 3) return 'timeout';
  return 'position_unavailable';
}

/** Capacitor Geolocation error/permission → problem. */
export function classifyNativeError(message: string | undefined): GeoProblem {
  const m = String(message || '').toLowerCase();
  if (/services? (are )?not enabled|location (is )?disabled|location services/.test(m)) return 'device_location_off';
  if (/denied|permission/.test(m)) return 'app_permission_denied';
  if (/timeout|timed out/.test(m)) return 'timeout';
  return 'position_unavailable';
}

export const GEO_HELP: Record<GeoProblem, { title: string; body: string }> = {
  device_location_off: { title: 'Phone location is off', body: 'Turn on Location in your phone settings, then tap Retry.' },
  site_permission_denied: {
    title: 'Location blocked for this site',
    body: 'In Chrome: tap the lock/settings icon by the address → Permissions → Location → Allow (or Chrome menu → Settings → Site settings → Location → app.fastcalories.online → Allow). Also check Android Settings → Apps → Chrome → Permissions → Location → Allow. Then tap Retry.',
  },
  app_permission_denied: { title: 'Location permission denied', body: 'Open phone Settings → Apps → FastCalories → Permissions → Location → Allow while using the app, then tap Retry.' },
  permission_prompt: { title: 'Allow location to share with your customer', body: 'Tap Retry and choose Allow when asked.' },
  timeout: { title: 'Still looking for GPS signal', body: 'Move near a window or outdoors, keep the app open, then tap Retry.' },
  position_unavailable: { title: "Can't get your location", body: 'Your phone location may be off or unable to get a fix. Check Location (and Google Location Accuracy) is on, then tap Retry.' },
  insecure_context: { title: 'Open the secure app', body: 'Location only works on https://app.fastcalories.online. Open that address and try again.' },
  unsupported: { title: 'Browser not supported', body: 'This browser cannot share location. Open the app in Chrome, or update it.' },
};
