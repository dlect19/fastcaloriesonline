import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Web Push (VAPID) helpers ───────────────────────────────────────

async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const vapidPrivateKeyJwk = JSON.parse(Deno.env.get('VAPID_PRIVATE_KEY')!);
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@fastcalories.com';

  const vapidPrivateKey = await crypto.subtle.importKey(
    'jwk', vapidPrivateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );

  const clientPublicKey = base64UrlDecode(subscription.p256dh);
  const clientAuth = base64UrlDecode(subscription.auth);

  const clientKey = await crypto.subtle.importKey(
    'raw', clientPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, localKeyPair.privateKey, 256
  );

  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const ikmKey = await crypto.subtle.importKey(
    'raw', clientAuth, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const prk = await crypto.subtle.sign('HMAC', ikmKey, sharedSecret);

  const cekInfo = createInfo('aesgcm', clientPublicKey, new Uint8Array(localPublicKeyRaw));
  const cekHmacKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const cekInfoWithSalt = new Uint8Array([...salt, ...new Uint8Array([0, 0, 0, 1]), ...cekInfo]);
  const cekFull = new Uint8Array(await crypto.subtle.sign('HMAC', cekHmacKey, cekInfoWithSalt));
  const cek = cekFull.slice(0, 16);

  const nonceInfo = createInfo('nonce', clientPublicKey, new Uint8Array(localPublicKeyRaw));
  const nonceInfoWithSalt = new Uint8Array([...salt, ...new Uint8Array([0, 0, 0, 1]), ...nonceInfo]);
  const nonceFull = new Uint8Array(await crypto.subtle.sign('HMAC', cekHmacKey, nonceInfoWithSalt));
  const nonce = nonceFull.slice(0, 12);

  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = new Uint8Array(2 + payloadBytes.length);
  paddedPayload.set(payloadBytes, 2);

  const encryptionKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encryptionKey, paddedPayload);
  const body = new Uint8Array(encrypted);

  const audience = new URL(subscription.endpoint).origin;
  const jwt = await createVapidJwt(vapidPrivateKey, audience, vapidSubject);

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Encryption': `salt=${base64UrlEncode(salt)}`,
      'Crypto-Key': `dh=${base64UrlEncode(new Uint8Array(localPublicKeyRaw))};p256ecdsa=${vapidPublicKey}`,
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
  result[offset++] = 0;
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
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(unsignedToken)
  );

  const sig = derToRaw(new Uint8Array(signature));
  return `${unsignedToken}.${base64UrlEncode(sig)}`;
}

function derToRaw(der: Uint8Array): Uint8Array {
  if (der.length === 64) return der;
  const raw = new Uint8Array(64);
  let offset = 2;
  if (der[offset] !== 0x02) return der;
  offset++;
  const rLen = der[offset++];
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;
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

// ─── Firebase Cloud Messaging (FCM) helper ──────────────────────────

async function getFirebaseAccessToken(): Promise<string> {
  const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!serviceAccountJson) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not configured');
  
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  
  // Create JWT for Google OAuth2
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const claimB64 = btoa(JSON.stringify(claimSet)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsignedToken = `${headerB64}.${claimB64}`;
  
  // Import RSA private key
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\n/g, '');
  const keyData = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );
  
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${unsignedToken}.${sigB64}`;
  
  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Failed to get Firebase access token: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

async function sendFcmNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ success: boolean; status: number }> {
  const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  const sa = JSON.parse(serviceAccountJson!);
  const projectId = sa.project_id;
  
  const accessToken = await getFirebaseAccessToken();
  
  const message: any = {
    message: {
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: 'high',
        ttl: '0s',
        notification: {
          sound: data?.role === 'rider' ? 'fastcaloriesrider' : 'fastcaloriesvendor',
          channel_id: data?.type === 'CALL' ? 'order-calls-v5' : (data?.role === 'rider' ? 'rider-orders' : 'vendor-orders-v3'),
          icon: 'ic_notification',
          ...(data?.type === 'CALL' ? { tag: 'call_notification', click_action: 'OPEN_MAIN_ACTIVITY' } : {}),
        },
      },
    },
  };
  
  if (data) {
    message.message.data = data;
  }
  
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    }
  );
  
  return { success: response.ok, status: response.status };
}

// ─── Main handler ───────────────────────────────────────────────────

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

    const notifTitle = title || 'Fast Calories';
    const notifBody = body || '';

    let sent = 0;
    let failed = 0;
    const expiredEndpoints: string[] = [];

    for (const sub of subscriptions) {
      try {
        if (sub.subscription_type === 'fcm' && sub.fcm_token) {
          // ── FCM path ──
          const dataPayload: Record<string, string> = {
            url: url || '/',
            ...(data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {}),
          };
          
          const result = await sendFcmNotification(sub.fcm_token, notifTitle, notifBody, dataPayload);
          
          if (result.success) {
            sent++;
          } else if (result.status === 404 || result.status === 410) {
            expiredEndpoints.push(sub.endpoint);
            failed++;
          } else {
            console.error(`FCM failed for token: ${result.status}`);
            failed++;
          }
        } else {
          // ── Web Push path ──
          const payload = JSON.stringify({
            title: notifTitle,
            body: notifBody,
            icon: '/images/fast-calories-logo.png',
            badge: '/pwa-192x192.png',
            data: { url: url || '/', ...data },
          });
          
          const response = await sendWebPush(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload
          );

          if (response.status === 201 || response.status === 200) {
            sent++;
          } else if (response.status === 404 || response.status === 410) {
            expiredEndpoints.push(sub.endpoint);
            failed++;
          } else {
            console.error(`Push failed for ${sub.endpoint}: ${response.status}`);
            failed++;
          }
        }
      } catch (e) {
        console.error(`Push error:`, e);
        failed++;
      }
    }

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
