import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Generate ECDSA P-256 key pair for VAPID
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    // Export as JWK
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // Convert public key to URL-safe base64 (applicationServerKey format)
    const rawPublic = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(rawPublic)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return new Response(JSON.stringify({
      publicKey: publicKeyBase64,
      privateKeyJwk: JSON.stringify(privateJwk),
      publicKeyJwk: JSON.stringify(publicJwk),
      instructions: 'Save publicKey as VAPID_PUBLIC_KEY and privateKeyJwk as VAPID_PRIVATE_KEY in your secrets.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
