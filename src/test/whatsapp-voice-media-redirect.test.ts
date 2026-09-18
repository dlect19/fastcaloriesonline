import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import {
  checkInitialMediaUrl,
  checkRedirectTarget,
  isDisallowedMediaContentType,
  isRedirectStatus,
  looksLikeMediaBytes,
  readCapped,
} from '../../supabase/functions/whatsapp-webhook/mediaFetch';

const TWILIO_MEDIA = 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1';
const SIGNED = 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123&X-Amz-Expires=3600';

describe('initial media URL policy', () => {
  it('accepts Twilio API and CDN origins over https', () => {
    expect(checkInitialMediaUrl(TWILIO_MEDIA).ok).toBe(true);
    expect(checkInitialMediaUrl('https://media.twiliocdn.com/AC1/abc').ok).toBe(true);
  });

  it('refuses anything else', () => {
    expect(checkInitialMediaUrl('http://api.twilio.com/x').reason).toBe('NOT_HTTPS');
    expect(checkInitialMediaUrl('https://api.twilio.com.evil.com/x').reason).toBe('HOST_NOT_ALLOWED');
    expect(checkInitialMediaUrl('https://evil.example.com/a.ogg').reason).toBe('HOST_NOT_ALLOWED');
    expect(checkInitialMediaUrl('not-a-url').reason).toBe('MALFORMED_URL');
  });
});

describe('redirect target policy', () => {
  it('accepts one hop to a regional Twilio media host', () => {
    const v = checkRedirectTarget('https://mcs.us1.twilio.com/Content/ME1', TWILIO_MEDIA);
    expect(v.ok).toBe(true);
    expect(v.host).toBe('mcs.us1.twilio.com');
    expect(checkRedirectTarget('https://media.us1.twilio.com/x', TWILIO_MEDIA).ok).toBe(true);
    expect(checkRedirectTarget('https://media.dublin.twiliocdn.com/x', TWILIO_MEDIA).ok).toBe(true);
  });

  it('accepts the Twilio MMS media CDN as a redirect target only', () => {
    const exact = checkRedirectTarget('https://mms.twiliocdn.com/ME1', TWILIO_MEDIA);
    expect(exact.ok).toBe(true);
    expect(exact.host).toBe('mms.twiliocdn.com');
    expect(checkRedirectTarget('https://mms.us1.twiliocdn.com/ME1', TWILIO_MEDIA).ok).toBe(true);
    expect(checkRedirectTarget('https://mms.dublin.twiliocdn.com/ME1', TWILIO_MEDIA).ok).toBe(true);
    // lookalikes and malformed labels stay refused
    for (const bad of [
      'https://mms.twiliocdn.com.evil.tld/ME1',
      'https://evilmms.twiliocdn.com/ME1',
      'https://mms.twiliocdn.evil.com/ME1',
      'https://mms..twiliocdn.com/ME1',
      'https://mms.twiliocdn.com.br/ME1',
    ]) {
      expect(checkRedirectTarget(bad, TWILIO_MEDIA).ok, bad).toBe(false);
    }
    expect(checkRedirectTarget('http://mms.twiliocdn.com/ME1', TWILIO_MEDIA).reason).toBe('NOT_HTTPS');
    expect(checkRedirectTarget('https://mms.twiliocdn.com:8443/ME1', TWILIO_MEDIA).reason).toBe('UNSAFE_PORT');
    // must never be accepted as the initial MediaUrl
    expect(checkInitialMediaUrl('https://mms.twiliocdn.com/ME1').reason).toBe('HOST_NOT_ALLOWED');
    expect(checkInitialMediaUrl('https://mms.us1.twiliocdn.com/ME1').reason).toBe('HOST_NOT_ALLOWED');
  });



  it('accepts the signed Twilio S3-backed media store, path and virtual hosted', () => {
    expect(checkRedirectTarget(
      `https://s3-external-1.amazonaws.com/com.twilio.prod.twilio-messaging-media/ME1?${SIGNED}`,
      TWILIO_MEDIA,
    )).toMatchObject({ ok: true, reason: 'TWILIO_MEDIA_STORE' });
    expect(checkRedirectTarget(
      `https://com.twilio.prod.twilio-messaging-media.s3.amazonaws.com/ME1?${SIGNED}`,
      TWILIO_MEDIA,
    ).ok).toBe(true);
  });

  it('refuses an unsigned Twilio storage URL', () => {
    expect(checkRedirectTarget(
      'https://s3-external-1.amazonaws.com/com.twilio.prod.twilio-messaging-media/ME1',
      TWILIO_MEDIA,
    ).reason).toBe('UNSIGNED_STORAGE_URL');
  });

  it('refuses a generic attacker-controlled bucket or host', () => {
    expect(checkRedirectTarget(`https://evil-bucket.s3.amazonaws.com/a.ogg?${SIGNED}`, TWILIO_MEDIA).reason)
      .toBe('REDIRECT_HOST_NOT_ALLOWED');
    expect(checkRedirectTarget(`https://s3.amazonaws.com/evil-bucket/a.ogg?${SIGNED}`, TWILIO_MEDIA).reason)
      .toBe('REDIRECT_HOST_NOT_ALLOWED');
    expect(checkRedirectTarget('https://evil.example.com/a.ogg', TWILIO_MEDIA).reason)
      .toBe('REDIRECT_HOST_NOT_ALLOWED');
    expect(checkRedirectTarget('https://twilio.com.evil.com/a.ogg', TWILIO_MEDIA).reason)
      .toBe('REDIRECT_HOST_NOT_ALLOWED');
  });

  it('refuses SSRF targets: localhost, private and metadata addresses, IP literals', () => {
    for (const target of [
      'https://localhost/a.ogg',
      'https://127.0.0.1/a.ogg',
      'https://10.0.0.5/a.ogg',
      'https://192.168.1.10/a.ogg',
      'https://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://[::1]/a.ogg',
      'https://2130706433/a.ogg',
      'https://vault.internal/a.ogg',
    ]) {
      expect(checkRedirectTarget(target, TWILIO_MEDIA).ok, target).toBe(false);
    }
  });

  it('refuses http downgrade, credentials, fragments and odd ports', () => {
    expect(checkRedirectTarget('http://mcs.us1.twilio.com/x', TWILIO_MEDIA).reason).toBe('NOT_HTTPS');
    expect(checkRedirectTarget('https://user:pass@mcs.us1.twilio.com/x', TWILIO_MEDIA).reason).toBe('URL_CREDENTIALS');
    expect(checkRedirectTarget('https://mcs.us1.twilio.com/x#frag', TWILIO_MEDIA).reason).toBe('URL_FRAGMENT');
    expect(checkRedirectTarget('https://mcs.us1.twilio.com:8443/x', TWILIO_MEDIA).reason).toBe('UNSAFE_PORT');
    expect(checkRedirectTarget('', TWILIO_MEDIA).reason).toBe('NO_LOCATION');
  });

  it('resolves a relative Location against the Twilio origin', () => {
    const v = checkRedirectTarget('/2010-04-01/Media/ME1.ogg', TWILIO_MEDIA);
    expect(v).toMatchObject({ ok: true, host: 'api.twilio.com' });
  });

  it('knows which statuses are redirects', () => {
    for (const s of [301, 302, 303, 307, 308]) expect(isRedirectStatus(s)).toBe(true);
    for (const s of [200, 304, 305, 400, 500]) expect(isRedirectStatus(s)).toBe(false);
  });
});

describe('body sanity', () => {
  it('rejects empty, HTML, XML, JSON and PDF bodies whatever the content type says', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(looksLikeMediaBytes(new Uint8Array(0))).toBe(false);
    expect(looksLikeMediaBytes(enc('<html><body>Access denied</body></html>'))).toBe(false);
    expect(looksLikeMediaBytes(enc('<?xml version="1.0"?><Error/>'))).toBe(false);
    expect(looksLikeMediaBytes(enc('{"code":20003}'))).toBe(false);
    expect(looksLikeMediaBytes(enc('%PDF-1.4'))).toBe(false);
    expect(looksLikeMediaBytes(enc('OggS\u0000\u0002'))).toBe(true);
  });

  it('rejects text/html-like content types', () => {
    expect(isDisallowedMediaContentType('text/html; charset=utf-8')).toBe(true);
    expect(isDisallowedMediaContentType('application/json')).toBe(true);
    expect(isDisallowedMediaContentType('application/pdf')).toBe(true);
    expect(isDisallowedMediaContentType('audio/ogg; codecs=opus')).toBe(false);
  });

  it('caps the stream before buffering more than the limit', async () => {
    const big = new Uint8Array(4096);
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(big); c.enqueue(big); c.close(); },
    });
    expect(await readCapped(new Response(body), 5000)).toBeNull();
    const ok = await readCapped(new Response(new Uint8Array([1, 2, 3])), 5000);
    expect(ok?.length).toBe(3);
  });
});

// ---- End-to-end gate behaviour with a mocked network ----

const aiMock = vi.fn();
vi.mock('../../supabase/functions/_shared/ai-call.ts', () => ({
  chatCompletionWithFallback: (...args: unknown[]) => aiMock(...args),
}));

const OGG = (() => {
  const b = new Uint8Array(2048);
  b.set(new TextEncoder().encode('OggS'), 0);
  return b;
})();

function voiceStub(reserve: any = { ok: true, max_bytes: 5 * 1024 * 1024 }) {
  const calls: Array<{ name: string; args: any }> = [];
  return {
    calls,
    client: {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return { data: name === 'whatsapp_voice_reserve' ? reserve : null, error: null };
      },
    },
  };
}

describe('voice gate over a mocked Twilio media network', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let mod: typeof import('../../supabase/functions/whatsapp-webhook/voice');
  const logs: string[] = [];

  beforeEach(async () => {
    (globalThis as any).Deno = {
      env: {
        get: (k: string) => ({
          TWILIO_ACCOUNT_SID: 'AC_test',
          TWILIO_AUTH_TOKEN: 'tok_test',
          LOVABLE_API_KEY: 'lov_test',
        } as Record<string, string>)[k],
      },
    };
    logs.length = 0;
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
    aiMock.mockReset();
    aiMock.mockResolvedValue({
      ok: true,
      data: { choices: [{ message: { content: 'I want two jollof rice' } }], usage: { prompt_tokens: 10, completion_tokens: 6 } },
    });
    mod = await import('../../supabase/functions/whatsapp-webhook/voice');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).Deno;
  });

  const base = { url: TWILIO_MEDIA, contentType: 'audio/ogg', phone: '+2348000000000' };

  const redirectTo = (location: string, status = 307) =>
    new Response(null, { status, headers: { location } });
  const audioResponse = () =>
    new Response(OGG, { status: 200, headers: { 'content-type': 'audio/ogg' } });

  it('follows one hop to a signed Twilio media store and transcribes', async () => {
    const target = `https://s3-external-1.amazonaws.com/com.twilio.prod.twilio-messaging-media/ME1?${SIGNED}`;
    fetchMock.mockResolvedValueOnce(redirectTo(target)).mockResolvedValueOnce(audioResponse());
    const s = voiceStub();
    const r = await mod.transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_a' });
    expect(r.code).toBe('TRANSCRIBED');
    expect(r.transcript).toBe('I want two jollof rice');
    expect(aiMock).toHaveBeenCalledTimes(1);
    expect(s.calls.map((c) => c.name)).toEqual(['whatsapp_voice_reserve', 'whatsapp_voice_finalize']);
    expect(s.calls[1].args.p_outcome).toBe('TRANSCRIBED');
  });

  it('follows one hop to a regional mcs host and transcribes', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('https://mcs.us1.twilio.com/Content/ME1'))
      .mockResolvedValueOnce(audioResponse());
    const r = await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_b' });
    expect(r.code).toBe('TRANSCRIBED');
  });

  it('never forwards Twilio credentials to the redirected host', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('https://mcs.us1.twilio.com/Content/ME1'))
      .mockResolvedValueOnce(audioResponse());
    await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_c' });
    const firstHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(firstHeaders.Authorization).toMatch(/^Basic /);
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.headers).toBeUndefined();
  });

  it('refuses a redirect to an unrelated host and finalises with no AI cost', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('https://evil.example.com/a.ogg'));
    const s = voiceStub();
    const r = await mod.transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_d' });
    expect(r.code).toBe('REDIRECT_REJECTED');
    expect(aiMock).not.toHaveBeenCalled();
    expect(s.calls[1].args).toMatchObject({ p_status: 'failed', p_outcome: 'REDIRECT_REJECTED' });
  });

  it('refuses a second redirect hop', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('https://mcs.us1.twilio.com/Content/ME1'))
      .mockResolvedValueOnce(redirectTo('https://mcs.us1.twilio.com/Content/ME2'));
    const r = await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_e' });
    expect(r.code).toBe('REDIRECT_REJECTED');
    expect(aiMock).not.toHaveBeenCalled();
  });

  it('never logs the signed path, query or credentials on refusal', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo(`https://evil-bucket.s3.amazonaws.com/secret/a.ogg?${SIGNED}`));
    await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_f' });
    const joined = logs.join('\n');
    expect(joined).toContain('evil-bucket.s3.amazonaws.com');
    expect(joined).toContain('MM_f');
    expect(joined).not.toContain('X-Amz-Signature');
    expect(joined).not.toContain('abc123');
    expect(joined).not.toContain('secret/a.ogg');
    expect(joined).not.toContain('tok_test');
  });

  it('refuses an HTML error body served with an audio content type', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      new TextEncoder().encode('<html><body>Access Denied</body></html>'),
      { status: 200, headers: { 'content-type': 'audio/ogg' } },
    ));
    const s = voiceStub();
    const r = await mod.transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_g' });
    expect(r.code).toBe('NOT_MEDIA_BODY');
    expect(aiMock).not.toHaveBeenCalled();
    expect(s.calls[1].args.p_status).toBe('refused');
  });

  it('refuses an html content type outright', async () => {
    fetchMock.mockResolvedValueOnce(new Response(OGG, { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_h' });
    expect(r.code).toBe('CONTENT_TYPE_REJECTED');
  });

  it('refuses an empty body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'audio/ogg' } }));
    const r = await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_i' });
    expect(r.code).toBe('NOT_MEDIA_BODY');
    expect(aiMock).not.toHaveBeenCalled();
  });

  it('refuses an oversized clip using the streaming cap', async () => {
    const s = voiceStub({ ok: true, max_bytes: 1024 });
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(4096), { status: 200, headers: { 'content-type': 'audio/ogg' } }));
    const r = await mod.transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_j' });
    expect(r.code).toBe('TOO_LARGE');
    expect(aiMock).not.toHaveBeenCalled();
  });

  it('processes two different MessageSids independently', async () => {
    fetchMock.mockImplementation(async () => audioResponse());
    const a = await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_k1' });
    const b = await mod.transcribeVoiceNoteGated(voiceStub().client, { ...base, messageSid: 'MM_k2' });
    expect([a.code, b.code]).toEqual(['TRANSCRIBED', 'TRANSCRIBED']);
    expect(aiMock).toHaveBeenCalledTimes(2);
  });

  it('a replayed MessageSid does not fetch, transcribe or cost again', async () => {
    const s = voiceStub({ ok: false, reason: 'REPLAY', replay: true });
    const r = await mod.transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_k1' });
    expect(r.code).toBe('REPLAY');
    expect(r.message).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(aiMock).not.toHaveBeenCalled();
    expect(s.calls.map((c) => c.name)).toEqual(['whatsapp_voice_reserve']);
  });

  it('caps max_bytes at 5 MB even if settings ask for more', async () => {
    const s = voiceStub({ ok: true, max_bytes: 50 * 1024 * 1024 });
    fetchMock.mockResolvedValueOnce(new Response(OGG, {
      status: 200,
      headers: { 'content-type': 'audio/ogg', 'content-length': String(6 * 1024 * 1024) },
    }));
    const r = await mod.transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_l' });
    expect(r.code).toBe('TOO_LARGE');
  });
});
