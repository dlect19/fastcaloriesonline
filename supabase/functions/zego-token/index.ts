// Generate Zego Kit Token (Token04) for authenticated user
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ID = Number(Deno.env.get('ZEGO_APP_ID') || '0');
const SERVER_SECRET = Deno.env.get('ZEGO_SERVER_SECRET') || '';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// AES-128-CBC encrypt (returns raw ciphertext bytes)
async function aesEncrypt(key: string, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key.slice(0, 16)),
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  );
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, data);
  return new Uint8Array(out);
}

// Big-endian writers
function be32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, false);
  return b;
}
function be64(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, false);
  return b;
}
function be16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setInt16(0, n, false);
  return b;
}

async function generateToken04(userId: string, effectiveTimeSeconds: number, payload: string): Promise<string> {
  if (!APP_ID || !SERVER_SECRET || SERVER_SECRET.length !== 32) {
    throw new Error('Zego config missing or invalid');
  }
  const createTime = Math.floor(Date.now() / 1000);
  const tokenExpire = createTime + effectiveTimeSeconds;
  const nonce = Math.floor(Math.random() * 2147483647) - 1073741823;

  const userIdBytes = new TextEncoder().encode(userId);
  const payloadBytes = new TextEncoder().encode(payload);

  // Build packet: bigEndian
  // appId(8) signMemberId len(2)+bytes nonce(8) ctimeExpire(8) payload len(2)+bytes
  const parts: Uint8Array[] = [
    be64(BigInt(APP_ID)),
    be16(userIdBytes.length), userIdBytes,
    be64(BigInt(nonce)),
    be64(BigInt(tokenExpire)),
    be16(payloadBytes.length), payloadBytes,
  ];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const packet = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { packet.set(p, off); off += p.length; }

  // IV = first 16 bytes of nonce string
  const nonceStr = String(nonce);
  const iv = new Uint8Array(16);
  const nStrBytes = new TextEncoder().encode(nonceStr);
  iv.set(nStrBytes.subarray(0, Math.min(16, nStrBytes.length)));

  // PKCS5 padding via CBC does it automatically in WebCrypto (AES-CBC pads)
  const cipher = await aesEncrypt(SERVER_SECRET, iv, packet);

  // Assemble final buffer: expire(8) + ivLen(2) + iv(16) + cipherLen(2) + cipher
  const finalLen = 8 + 2 + 16 + 2 + cipher.length;
  const finalBuf = new Uint8Array(finalLen);
  let o = 0;
  finalBuf.set(be64(BigInt(tokenExpire)), o); o += 8;
  finalBuf.set(be16(16), o); o += 2;
  finalBuf.set(iv, o); o += 16;
  finalBuf.set(be16(cipher.length), o); o += 2;
  finalBuf.set(cipher, o);

  // base64
  let bin = '';
  for (let i = 0; i < finalBuf.length; i++) bin += String.fromCharCode(finalBuf[i]);
  const b64 = btoa(bin);
  return '04' + b64;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
    if (authErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = String(claims.claims.sub);

    const body = await req.json().catch(() => ({}));
    const roomId: string = body.roomId || '';
    const effective = Number(body.effectiveTimeSeconds || 3600);

    const payload = roomId
      ? JSON.stringify({ room_id: roomId, privilege: { 1: 1, 2: 1 }, stream_id_list: null })
      : '';

    const kitToken = await generateToken04(userId, effective, payload);

    return new Response(JSON.stringify({ token: kitToken, appId: APP_ID, userId, expiresAt: Math.floor(Date.now() / 1000) + effective }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('zego-token error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
