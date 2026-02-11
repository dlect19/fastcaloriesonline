import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Web Push encryption helpers using Web Crypto API
async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const vapidPrivateKeyJwk = JSON.parse(Deno.env.get('VAPID_PRIVATE_KEY')!);
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@fastcalories.com';

  // Import VAPID private key
  const vapidPrivateKey = await crypto.subtle.importKey(
    'jwk',
    vapidPrivateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // Generate local ECDH key pair for encryption
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // Decode subscription keys
  const clientPublicKey = base64UrlDecode(subscription.p256dh);
  const clientAuth = base64UrlDecode(subscription.auth);

  // Import client public key
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey },
    localKeyPair.privateKey,
    256
  );

  // Export local public key
  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);

  // Derive encryption keys using HKDF
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Create IKM (Input Key Material) = HKDF-Extract(auth, shared_secret)
  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const prkKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveBits']);

  // PRK = HKDF-Extract(auth, shared_secret)
  const ikmKey = await crypto.subtle.importKey(
    'raw',
    clientAuth,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const prk = await crypto.subtle.sign('HMAC', ikmKey, sharedSecret);

  // Derive content encryption key
  const cekInfo = createInfo('aesgcm', clientPublicKey, new Uint8Array(localPublicKeyRaw));
  const cekHmacKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const cekInfoWithSalt = new Uint8Array([...salt, ...new Uint8Array([0, 0, 0, 1]), ...cekInfo]);
  const cekFull = new Uint8Array(await crypto.subtle.sign('HMAC', cekHmacKey, cekInfoWithSalt));
  const cek = cekFull.slice(0, 16);

  // Derive nonce
  const nonceInfo = createInfo('nonce', clientPublicKey, new Uint8Array(localPublicKeyRaw));
  const nonceInfoWithSalt = new Uint8Array([...salt, ...new Uint8Array([0, 0, 0, 1]), ...nonceInfo]);
  const nonceFull = new Uint8Array(await crypto.subtle.sign('HMAC', cekHmacKey, nonceInfoWithSalt));
  const nonce = nonceFull.slice(0, 12);

  // Encrypt payload
  const payloadBytes = new TextEncoder().encode(payload);
  const paddingLength = 0;
  const paddedPayload = new Uint8Array(2 + paddingLength + payloadBytes.length);
  paddedPayload[0] = (paddingLength >> 8) & 0xff;
  paddedPayload[1] = paddingLength & 0xff;
  paddedPayload.set(payloadBytes, 2 + paddingLength);

  const encryptionKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encryptionKey, paddedPayload);

  const body = new Uint8Array(encrypted);

  // Create VAPID JWT
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await createVapidJwt(vapidPrivateKey, audience, vapidSubject);

  // Export VAPID public key as URL-safe base64
  const vapidPublicKeyForHeader = vapidPublicKey;

  // Send to push service
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Encryption': `salt=${base64UrlEncode(salt)}`,
      'Crypto-Key': `dh=${base64UrlEncode(new Uint8Array(localPublicKeyRaw))};p256ecdsa=${vapidPublicKeyForHeader}`,
      'Authorization': `WebPush ${jwt}`,
      'TTL': '86400',
    },
    body,
  });

  return response;
}

function createInfo(type: string, clientPublicKey: Uint8Array, serverPublicKey: Uint8Array): Uint8Array {
  const label = new TextEncoder().encode(`Content-Encoding: ${type}\0`);
  const result = new Uint8Array(label.length + 1 + 2 + clientPublicKey.length + 2 + serverPublicKey.length);
  let offset = 0;
  result.set(label, offset); offset += label.length;
  result[offset++] = 0; // P-256 context separator
  result[offset++] = 0; result[offset++] = clientPublicKey.length;
  result.set(clientPublicKey, offset); offset += clientPublicKey.length;
  result[offset++] = 0; result[offset++] = serverPublicKey.length;
  result.set(serverPublicKey, offset);
  return result;
}

async function createVapidJwt(privateKey: CryptoKey, audience: string, subject: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 86400, sub: subject };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw r||s format
  const sig = derToRaw(new Uint8Array(signature));
  const signatureB64 = base64UrlEncode(sig);

  return `${unsignedToken}.${signatureB64}`;
}

function derToRaw(der: Uint8Array): Uint8Array {
  // ECDSA signature from WebCrypto is already in raw format (r || s)
  if (der.length === 64) return der;

  // Parse DER format
  const raw = new Uint8Array(64);
  let offset = 2; // Skip sequence tag and length
  
  // Parse r
  if (der[offset] !== 0x02) return der;
  offset++;
  const rLen = der[offset++];
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;

  // Parse s
  if (der[offset] !== 0x02) return der;
  offset++;
  const sLen = der[offset++];
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 64 - sLen : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);

  return raw;
}

function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(base64 + padding);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { user_id, user_ids, title, body, data, url } = await req.json();

    const targetUserIds = user_ids || (user_id ? [user_id] : []);
    if (targetUserIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No target users specified' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch subscriptions for target users
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', targetUserIds);

    if (error) throw error;
    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No subscriptions found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.stringify({
      title: title || 'Fast Calories',
      body: body || '',
      icon: '/images/fast-calories-logo.png',
      badge: '/pwa-192x192.png',
      data: { url: url || '/', ...data },
    });

    let sent = 0;
    let failed = 0;
    const expiredEndpoints: string[] = [];

    for (const sub of subscriptions) {
      try {
        const response = await sendWebPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload
        );

        if (response.status === 201 || response.status === 200) {
          sent++;
        } else if (response.status === 404 || response.status === 410) {
          // Subscription expired, mark for cleanup
          expiredEndpoints.push(sub.endpoint);
          failed++;
        } else {
          console.error(`Push failed for ${sub.endpoint}: ${response.status}`);
          failed++;
        }
      } catch (e) {
        console.error(`Push error for ${sub.endpoint}:`, e);
        failed++;
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints);
    }

    return new Response(JSON.stringify({ sent, failed, cleaned: expiredEndpoints.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Send push error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
