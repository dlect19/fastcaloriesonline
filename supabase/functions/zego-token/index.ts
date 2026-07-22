// Generate Zego Kit Token (Token04) for authenticated user.
// Reference: https://github.com/zegoim/zego_server_assistant (token04, node)
// Format: JSON plaintext + AES-256-GCM, wrapped with expire + nonce + cipher + mode.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ID = Number(Deno.env.get('ZEGO_APP_ID') || '0');
const SERVER_SECRET = Deno.env.get('ZEGO_SERVER_SECRET') || '';

function makeNonce(): number {
  // int32 signed range
  return Math.floor(Math.random() * 0x100000000) - 0x80000000;
}

async function aesGcmEncrypt(
  plaintext: string,
  secret: string,
): Promise<{ cipherWithTag: Uint8Array; iv: Uint8Array }> {
  if (secret.length !== 32) throw new Error('ZEGO_SERVER_SECRET must be exactly 32 chars');
  const keyBytes = new TextEncoder().encode(secret); // 32 bytes -> AES-256
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 12-byte GCM nonce
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );
  // WebCrypto AES-GCM output already includes the 16-byte auth tag appended.
  return { cipherWithTag: new Uint8Array(ct), iv };
}

async function generateToken04(userId: string, effectiveTimeSeconds: number, payload: string): Promise<string> {
  if (!APP_ID) throw new Error('ZEGO_APP_ID missing');
  if (!SERVER_SECRET || SERVER_SECRET.length !== 32) throw new Error('ZEGO_SERVER_SECRET missing or not 32 chars');
  if (!userId) throw new Error('userId required');

  const createTime = Math.floor(Date.now() / 1000);
  const tokenInfo = {
    app_id: APP_ID,
    user_id: userId,
    nonce: makeNonce(),
    ctime: createTime,
    expire: createTime + effectiveTimeSeconds,
    payload: payload || '',
  };
  const plaintext = JSON.stringify(tokenInfo);

  const { cipherWithTag, iv } = await aesGcmEncrypt(plaintext, SERVER_SECRET);

  // Layout: expire(8, BE) | ivLen(2, BE) | iv(12) | cipherLen(2, BE) | cipher+tag | mode(1)=1(GCM)
  const total = 8 + 2 + iv.length + 2 + cipherWithTag.length + 1;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  let off = 0;
  dv.setBigInt64(off, BigInt(tokenInfo.expire), false); off += 8;
  dv.setUint16(off, iv.length, false); off += 2;
  buf.set(iv, off); off += iv.length;
  dv.setUint16(off, cipherWithTag.length, false); off += 2;
  buf.set(cipherWithTag, off); off += cipherWithTag.length;
  dv.setUint8(off, 1); off += 1;

  // base64
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return '04' + btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
    if (authErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = String(claims.claims.sub);

    const body = await req.json().catch(() => ({}));
    const roomId: string = body.roomId || '';
    const effective = Math.max(60, Math.min(24 * 3600, Number(body.effectiveTimeSeconds || 3600)));

    // For Express-Web SDK loginRoom, room-scoped privileges are required.
    const payload = roomId
      ? JSON.stringify({ room_id: roomId, privilege: { 1: 1, 2: 1 }, stream_id_list: null })
      : '';

    const kitToken = await generateToken04(userId, effective, payload);
    const expiresAt = Math.floor(Date.now() / 1000) + effective;

    console.log('[zego-token] issued', {
      appId: APP_ID,
      userId,
      roomId,
      tokenLen: kitToken.length,
      expiresAt,
      hasSecret: !!SERVER_SECRET,
      secretLen: SERVER_SECRET.length,
    });

    return new Response(
      JSON.stringify({ token: kitToken, appId: APP_ID, userId, expiresAt }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[zego-token] error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
