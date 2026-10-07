// Truthful classification of rider location problems (no network, no coordinates).

export type GeoProblem =
  | 'device_location_off'     // phone location service off (native) / likely off (web code 2)
  | 'site_permission_denied'  // browser/site permission blocked (web/PWA)
  | 'app_permission_denied'   // Android/iOS app permission denied (native)
  | 'permission_prompt'       // permission not yet granted; needs a tap
  | 'timeout'                 // no fix within the bounded timeout
  | 'position_unavailable'    // browser could not obtain a fix
  | 'insecure_context'        // page not served over HTTPS
  | 'unsupported'             // no geolocation API
  | 'app_update_required';    // installed app shell has no native bridge for this page

export const GEO_DIAGNOSTIC_CODE: Record<GeoProblem, string> = {
  device_location_off: 'LOC_SERVICE_OFF',
  site_permission_denied: 'WEB_PERMISSION_DENIED',
  app_permission_denied: 'APP_PERMISSION_DENIED',
  permission_prompt: 'PERMISSION_PROMPT',
  timeout: 'GPS_TIMEOUT',
  position_unavailable: 'POSITION_UNAVAILABLE',
  insecure_context: 'INSECURE_CONTEXT',
  unsupported: 'GEO_UNSUPPORTED',
  app_update_required: 'NATIVE_SHELL_OUTDATED',
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

/** Capacitor Geolocation error (OS-PLUG-GLOC-xxxx code or message) → problem. */
export function classifyNativeError(message: string | undefined, code?: string): GeoProblem {
  const c = String(code || message || '').match(/OS-PLUG-GLOC-(\d{4})/)?.[1];
  if (c) {
    if (c === '0003' || c === '0008') return 'app_permission_denied';
    if (c === '0007' || c === '0009' || c === '0017') return 'device_location_off';
    if (c === '0010') return 'timeout';
    return 'position_unavailable';
  }
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
  position_unavailable: {
    title: "Phone can't find your position",
    body: 'Permission is fine, but Android returned no location. On Android: Settings → Location → Location services → Google Location Accuracy ON; Wi-Fi scanning and Bluetooth scanning ON. Settings → Apps → Chrome (or FastCalories) → Permissions → Location → Allow while using app, with Precise location ON. Turn off Battery saver / Data saver for the app. Move near a window or outdoors, then tap Retry. Note: Google Maps working does not prove Chrome lets this site use location. Reset it: Chrome ⋮ → Settings → Site settings → All sites → app.fastcalories.online → Clear & reset, reopen the app, tap Retry and choose Allow.',
  },
  insecure_context: { title: 'Open the secure app', body: 'Location only works on https://app.fastcalories.online. Open that address and try again.' },
  unsupported: { title: 'Browser not supported', body: 'This browser cannot share location. Open the app in Chrome, or update it.' },
  app_update_required: {
    title: 'App update required',
    body: 'This installed FastCalories app cannot reach the phone\'s location service. Update the app from the Play Store / App Store (or install the latest version), reopen it, then tap Retry.',
  },
};

/**
 * First-fix ladder: recent cached fix → balanced (network/Wi-Fi) → high-accuracy
 * GPS. Stops at the first usable fix or a permission denial; never loops.
 */
export const FIRST_FIX_LADDER: PositionOptions[] = [
  { enableHighAccuracy: false, maximumAge: 120_000, timeout: 5_000 },
  { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
];

/** Problems that need the rider to change a setting/tap, not auto-recovery. */
export const NEEDS_RIDER_ACTION: GeoProblem[] = ['site_permission_denied', 'app_permission_denied', 'permission_prompt', 'insecure_context', 'unsupported', 'app_update_required'];
