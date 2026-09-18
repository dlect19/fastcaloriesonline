// Hardened media-URL policy for inbound WhatsApp/Twilio media.
//
// Twilio's authenticated media endpoint (api.twilio.com/.../Media/ME...) answers
// with a single 30x redirect to a short-lived, signed download URL on one of
// Twilio's own media stores. The download must therefore follow exactly one hop,
// but only to a host Twilio actually owns/uses — never to an arbitrary target,
// and never with the Twilio credentials attached.
//
// Every function here is pure so both the edge function and the test suite can
// use them without network, Deno or credentials.

/** Hosts an *initial* media URL may point at (the authenticated Twilio origin). */
const INITIAL_HOST_PATTERNS: RegExp[] = [
  /^api\.twilio\.com$/,
  /^api\.[a-z0-9-]+\.twilio\.com$/, // regional API edges
  /^media\.twiliocdn\.com$/,
  /^media(\.[a-z0-9-]+)*\.twiliocdn\.com$/,
];

/**
 * Hosts a single redirect from the authenticated Twilio origin may point at.
 * Region-aware Twilio media/content stores only.
 */
const REDIRECT_HOST_PATTERNS: RegExp[] = [
  /^api\.twilio\.com$/,
  /^mcs(\.[a-z0-9-]+)*\.twilio\.com$/, // mcs.us1.twilio.com, mcs.twilio.com
  /^media(\.[a-z0-9-]+)*\.twilio\.com$/,
  /^media(\.[a-z0-9-]+)*\.twiliocdn\.com$/,
  /^mcs(\.[a-z0-9-]+)*\.twiliocdn\.com$/,
  // Twilio MMS media CDN: mms.twiliocdn.com and regional mms.<region>.twiliocdn.com
  /^mms(\.[a-z0-9-]+)*\.twiliocdn\.com$/,
];

/**
 * Twilio's documented S3-backed media store. Allowed only for a redirect that
 * came from the authenticated Twilio origin, only for Twilio's own bucket, and
 * only when the URL is signed/time-limited. Generic amazonaws.com is refused.
 */
const S3_VIRTUAL_HOST = /^com\.twilio\.[a-z0-9.-]+\.s3([.-][a-z0-9-]+)*\.amazonaws\.com$/;
const S3_PATH_HOSTS = [
  /^s3-external-1\.amazonaws\.com$/,
  /^s3\.amazonaws\.com$/,
  /^s3([.-][a-z0-9-]+)*\.amazonaws\.com$/,
];
const S3_TWILIO_BUCKET_PATH = /^\/com\.twilio\.[a-z0-9.-]+\//;
/** Query keys that prove the redirect is a signed, time-limited download link. */
const SIGNED_QUERY_KEYS = [
  "x-amz-signature", "x-amz-credential", "x-amz-expires", "signature", "expires",
  "awsaccesskeyid", "x-amz-security-token", "token",
];

/** IPv4 / IPv6 literals and other non-DNS hosts are never acceptable. */
function isIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  if (hostname.startsWith("[") || hostname.includes(":")) return true; // IPv6 literal
  if (/^\d+$/.test(hostname)) return true; // decimal-encoded IPv4
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  return false;
}

const BLOCKED_NAMES = [
  "localhost", "localhost.localdomain", "metadata", "metadata.google.internal",
  "instance-data", "169.254.169.254",
];

function isBlockedName(hostname: string): boolean {
  if (BLOCKED_NAMES.includes(hostname)) return true;
  return hostname.endsWith(".localhost") || hostname.endsWith(".internal") ||
    hostname.endsWith(".local") || hostname.endsWith(".localdomain");
}

export interface UrlVerdict {
  ok: boolean;
  /** Normalized hostname — safe to log. Never log path/query/signature. */
  host: string | null;
  reason: string;
}

/** Shared structural checks: https, no credentials, no fragment, safe port, real DNS host. */
function baseChecks(u: URL): UrlVerdict | null {
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:") return { ok: false, host, reason: "NOT_HTTPS" };
  if (u.username || u.password) return { ok: false, host, reason: "URL_CREDENTIALS" };
  if (u.hash) return { ok: false, host, reason: "URL_FRAGMENT" };
  if (u.port && u.port !== "443") return { ok: false, host, reason: "UNSAFE_PORT" };
  if (!host) return { ok: false, host: null, reason: "NO_HOST" };
  if (isIpLiteral(host)) return { ok: false, host, reason: "IP_LITERAL" };
  if (isBlockedName(host)) return { ok: false, host, reason: "BLOCKED_HOST" };
  return null;
}

/** Verdict for the URL Twilio put in the webhook payload. */
export function checkInitialMediaUrl(raw: string): UrlVerdict {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, host: null, reason: "MALFORMED_URL" };
  }
  const bad = baseChecks(u);
  if (bad) return bad;
  const host = u.hostname.toLowerCase();
  if (!INITIAL_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, host, reason: "HOST_NOT_ALLOWED" };
  }
  return { ok: true, host, reason: "OK" };
}

/** Backwards-compatible boolean form used by existing callers/tests. */
export function isAllowedMediaUrl(url: string): boolean {
  return checkInitialMediaUrl(url).ok;
}

function hasSignedQuery(u: URL): boolean {
  for (const key of u.searchParams.keys()) {
    if (SIGNED_QUERY_KEYS.includes(key.toLowerCase())) return true;
  }
  return false;
}

/**
 * Verdict for a single redirect hop taken from the authenticated Twilio origin.
 * `location` may be relative; it is resolved against the request URL.
 */
export function checkRedirectTarget(location: string, from: string): UrlVerdict {
  if (!location || !location.trim()) return { ok: false, host: null, reason: "NO_LOCATION" };
  let u: URL;
  try {
    u = new URL(location.trim(), from);
  } catch {
    return { ok: false, host: null, reason: "MALFORMED_REDIRECT" };
  }
  const bad = baseChecks(u);
  if (bad) return bad;

  const host = u.hostname.toLowerCase();
  if (REDIRECT_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: true, host, reason: "TWILIO_MEDIA_HOST" };
  }

  // Twilio's S3-backed media store, narrowly.
  const virtualHosted = S3_VIRTUAL_HOST.test(host);
  const pathStyle = S3_PATH_HOSTS.some((re) => re.test(host)) && S3_TWILIO_BUCKET_PATH.test(u.pathname);
  if (virtualHosted || pathStyle) {
    if (!hasSignedQuery(u)) return { ok: false, host, reason: "UNSIGNED_STORAGE_URL" };
    return { ok: true, host, reason: "TWILIO_MEDIA_STORE" };
  }

  return { ok: false, host, reason: "REDIRECT_HOST_NOT_ALLOWED" };
}

/** Redirect status codes we are willing to follow (exactly once). */
export const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.includes(status);
}

/**
 * Bodies that are clearly not media: provider HTML/XML error pages, PDFs, empty
 * responses. Checked on the bytes, so a wrong Content-Type cannot slip through.
 */
export function looksLikeMediaBytes(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(64, bytes.length)))
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<")) return false; // html, xml, svg, provider error page
  if (head.startsWith("{") || head.startsWith("[")) return false; // JSON error envelope
  if (head.startsWith("%pdf")) return false;
  return true;
}

/** Content types that must never be treated as audio, whatever the extension says. */
export function isDisallowedMediaContentType(contentType: string): boolean {
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  if (!ct) return false;
  return ct.startsWith("text/") || ct === "application/json" || ct === "application/xml" ||
    ct === "application/xhtml+xml" || ct === "image/svg+xml" || ct === "application/pdf";
}

/**
 * Read a response body with a hard cap, without ever buffering more than the cap.
 * Returns null when the stream exceeds `maxBytes`.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}
