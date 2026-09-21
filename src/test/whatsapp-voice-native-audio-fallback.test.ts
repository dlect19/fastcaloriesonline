import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  audioMimeForPart,
  chatCompletionWithFallback,
  hasAudioPart,
} from '../../supabase/functions/_shared/ai-call';
import {
  VOICE_FAIL_TEXT,
  VOICE_SERVICE_DOWN_TEXT,
  transcribeVoiceNoteGated,
} from '../../supabase/functions/whatsapp-webhook/voice';

const AUDIO_B64 = 'T2dnUwABAgMEBQY=';

function audioMessages(mime = 'audio/ogg') {
  return [
    { role: 'system' as const, content: 'You transcribe short WhatsApp voice notes.' },
    {
      role: 'user' as const,
      content: [
        { type: 'text', text: 'Transcribe this voice note.' },
        { type: 'input_audio', input_audio: { data: AUDIO_B64, format: 'ogg', mime_type: mime } },
      ],
    },
  ];
}

/** Lovable gateway refuses (credit limit), exactly like production did. */
const CREDIT_LIMIT = () =>
  new Response(JSON.stringify({ status: 403, type: 'credit_limit_reached' }), { status: 403 });

describe('audio part detection', () => {
  it('spots WhatsApp audio and keeps its real MIME type', () => {
    expect(hasAudioPart(audioMessages() as any)).toBe(true);
    expect(hasAudioPart([{ role: 'user', content: 'hello' }] as any)).toBe(false);
    expect(audioMimeForPart({ input_audio: { format: 'ogg', mime_type: 'audio/ogg' } })).toBe('audio/ogg');
    expect(audioMimeForPart({ input_audio: { format: 'ogg' } })).toBe('audio/ogg');
    expect(audioMimeForPart({ input_audio: { format: 'mp3' } })).toBe('audio/mpeg');
    expect(audioMimeForPart({ input_audio: { format: 'wav' } })).toBe('audio/wav');
  });
});

describe('Gemini fallback for WhatsApp audio', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const logs: string[] = [];

  beforeEach(() => {
    (globalThis as any).Deno = {
      env: {
        get: (k: string) => ({ LOVABLE_API_KEY: 'lov_test', GEMINI_API_KEY: 'gem_test' } as Record<string, string>)[k],
      },
    };
    logs.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    }
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).Deno;
  });

  const nativeOk = (text: string) =>
    new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
    }), { status: 200 });

  it('sends ogg audio as native inline data, never through the wav/mp3 compatibility interface', async () => {
    fetchMock.mockResolvedValueOnce(CREDIT_LIMIT()).mockResolvedValueOnce(nativeOk('two jollof rice'));

    const r = await chatCompletionWithFallback({
      model: 'google/gemini-3.5-flash',
      messages: audioMessages() as any,
    });

    expect(r.ok).toBe(true);
    expect(r.provider).toBe('gemini');
    expect(r.data?.choices?.[0]?.message?.content).toBe('two jollof rice');
    expect(r.data?.usage?.prompt_tokens).toBe(12);
    expect(r.data?.usage?.completion_tokens).toBe(5);

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain(':generateContent');
    expect(String(url)).not.toContain('openai/chat/completions');
    const body = JSON.parse(String((init as any).body));
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'audio/ogg', data: AUDIO_B64 });
    expect(body.systemInstruction.parts[0].text).toContain('transcribe');
    expect(JSON.stringify(body)).not.toContain('input_audio');
    expect(JSON.stringify(body)).not.toContain('"format"');
  });

  it('treats an empty answer as no speech, not as a failure', async () => {
    fetchMock.mockResolvedValueOnce(CREDIT_LIMIT())
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 }));
    const r = await chatCompletionWithFallback({ model: 'google/gemini-3.5-flash', messages: audioMessages() as any });
    expect(r.ok).toBe(true);
    expect(r.data?.choices?.[0]?.message?.content).toBe('');
  });

  it('reports provider 4xx/5xx and network faults as failures', async () => {
    fetchMock.mockResolvedValueOnce(CREDIT_LIMIT())
      .mockResolvedValueOnce(new Response('{"error":{"code":429}}', { status: 429 }));
    const rateLimited = await chatCompletionWithFallback({ model: 'google/gemini-3.5-flash', messages: audioMessages() as any });
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.status).toBe(429);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(CREDIT_LIMIT()).mockRejectedValueOnce(new Error('socket hang up'));
    const offline = await chatCompletionWithFallback({ model: 'google/gemini-3.5-flash', messages: audioMessages() as any });
    expect(offline.ok).toBe(false);
    expect(offline.status).toBe(503);
  });

  it('never logs the audio bytes or the API keys', async () => {
    fetchMock.mockResolvedValueOnce(CREDIT_LIMIT()).mockResolvedValueOnce(nativeOk('hello'));
    await chatCompletionWithFallback({ model: 'google/gemini-3.5-flash', messages: audioMessages() as any });
    const joined = logs.join('\n');
    expect(joined).not.toContain(AUDIO_B64);
    expect(joined).not.toContain('gem_test');
    expect(joined).not.toContain('lov_test');
  });

  it('non-audio requests still use the OpenAI-compatible endpoint', async () => {
    fetchMock.mockResolvedValueOnce(CREDIT_LIMIT())
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }));
    const r = await chatCompletionWithFallback({
      model: 'google/gemini-3.5-flash',
      messages: [{ role: 'user', content: 'hi' }] as any,
    });
    expect(r.ok).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toContain('openai/chat/completions');
  });
});

describe('customer wording separates our failure from a bad recording', () => {
  const OGG = (() => {
    const b = new Uint8Array(2048);
    b.set(new TextEncoder().encode('OggS'), 0);
    return b;
  })();
  const TWILIO_MEDIA = 'https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME1';
  let fetchMock: ReturnType<typeof vi.fn>;

  function voiceStub() {
    const calls: Array<{ name: string; args: any }> = [];
    return {
      calls,
      client: {
        rpc: async (name: string, args: any) => {
          calls.push({ name, args });
          return { data: name === 'whatsapp_voice_reserve' ? { ok: true, max_bytes: 5 * 1024 * 1024 } : null, error: null };
        },
      },
    };
  }

  beforeEach(() => {
    (globalThis as any).Deno = {
      env: {
        get: (k: string) => ({
          TWILIO_ACCOUNT_SID: 'AC_test',
          TWILIO_AUTH_TOKEN: 'tok_test',
          LOVABLE_API_KEY: 'lov_test',
          GEMINI_API_KEY: 'gem_test',
        } as Record<string, string>)[k],
      },
    };
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).Deno;
  });

  const base = { url: TWILIO_MEDIA, contentType: 'audio/ogg', phone: '+2348000000000' };
  const audio = () => new Response(OGG, { status: 200, headers: { 'content-type': 'audio/ogg' } });

  it('says the service is unavailable when the provider fails', async () => {
    fetchMock.mockResolvedValueOnce(audio())
      .mockResolvedValueOnce(CREDIT_LIMIT())
      .mockResolvedValueOnce(new Response('{"error":{"code":400}}', { status: 400 }));
    const s = voiceStub();
    const r = await transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_down' });
    expect(r.code).toBe('AI_FAILED');
    expect(r.message).toBe(VOICE_SERVICE_DOWN_TEXT);
    expect(r.message).not.toContain('quieter');
    expect(s.calls[1].args.p_outcome).toBe('AI_400');
  });

  it('keeps the quiet-place wording for a genuinely silent clip', async () => {
    fetchMock.mockResolvedValueOnce(audio())
      .mockResolvedValueOnce(CREDIT_LIMIT())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'NO_SPEECH' }] } }],
      }), { status: 200 }));
    const s = voiceStub();
    const r = await transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_quiet' });
    expect(r.code).toBe('NO_SPEECH');
    expect(r.message).toBe(VOICE_FAIL_TEXT);
    expect(s.calls[1].args.p_outcome).toBe('NO_SPEECH');
  });

  it('transcribes an ogg voice note end to end through the native fallback', async () => {
    fetchMock.mockResolvedValueOnce(audio())
      .mockResolvedValueOnce(CREDIT_LIMIT())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'I want two jollof rice' }] } }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 },
      }), { status: 200 }));
    const s = voiceStub();
    const r = await transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_ok' });
    expect(r.code).toBe('TRANSCRIBED');
    expect(r.transcript).toBe('I want two jollof rice');
    expect(r.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
    expect(s.calls[1].args.p_outcome).toBe('TRANSCRIBED');
  });

  it('still refuses a foreign media host and a non-audio attachment', async () => {
    const a = await transcribeVoiceNoteGated(voiceStub().client, { ...base, url: 'https://evil.example.com/a.ogg', messageSid: 'MM_x' });
    expect(a.code).toBe('MEDIA_HOST_REJECTED');
    const b = await transcribeVoiceNoteGated(voiceStub().client, { ...base, contentType: 'image/png', messageSid: 'MM_y' });
    expect(b.code).toBe('MIME_REJECTED');
  });

  it('still refuses an oversized clip', async () => {
    fetchMock.mockResolvedValueOnce(new Response(OGG, {
      status: 200,
      headers: { 'content-type': 'audio/ogg', 'content-length': String(9 * 1024 * 1024) },
    }));
    const s = voiceStub();
    const r = await transcribeVoiceNoteGated(s.client, { ...base, messageSid: 'MM_big' });
    expect(r.code).toBe('TOO_LARGE');
    expect(s.calls[1].args.p_outcome).toBe('TOO_LARGE');
  });
});
