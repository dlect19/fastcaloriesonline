import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  detectVoiceNote,
  isAllowedAudioType,
  isAllowedMediaUrl,
  transcribeVoiceNoteGated,
} from '../../supabase/functions/whatsapp-webhook/voice';

const WEBHOOK = readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const TOOLS = readFileSync('supabase/functions/whatsapp-webhook/tools.ts', 'utf8');

/** Supabase stub whose rpc answers are scripted per function name. */
function stub(answers: Record<string, any>) {
  const calls: Array<{ name: string; args: any }> = [];
  return {
    calls,
    client: {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return { data: answers[name] ?? null, error: null };
      },
    },
  };
}

describe('voice media source is restricted', () => {
  it('accepts only Twilio https media hosts', () => {
    expect(isAllowedMediaUrl('https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME')).toBe(true);
    expect(isAllowedMediaUrl('https://media.twiliocdn.com/AC/abc')).toBe(true);
    expect(isAllowedMediaUrl('https://evil.example.com/clip.ogg')).toBe(false);
    expect(isAllowedMediaUrl('http://api.twilio.com/clip.ogg')).toBe(false);
    expect(isAllowedMediaUrl('https://api.twilio.com.evil.com/clip.ogg')).toBe(false);
    expect(isAllowedMediaUrl('not-a-url')).toBe(false);
  });

  it('accepts only real audio types', () => {
    expect(isAllowedAudioType('audio/ogg; codecs=opus')).toBe(true);
    expect(isAllowedAudioType('audio/mpeg')).toBe(true);
    expect(isAllowedAudioType('image/png')).toBe(false);
    expect(isAllowedAudioType('application/pdf')).toBe(false);
    expect(isAllowedAudioType('')).toBe(false);
  });

  it('detects an inbound voice note', () => {
    expect(detectVoiceNote({ NumMedia: '1', MediaContentType0: 'audio/ogg', MediaUrl0: 'https://api.twilio.com/x' }))
      .toEqual({ url: 'https://api.twilio.com/x', contentType: 'audio/ogg' });
    expect(detectVoiceNote({ NumMedia: '1', MediaContentType0: 'image/jpeg', MediaUrl0: 'https://api.twilio.com/x' }))
      .toBeNull();
  });
});

describe('voice cost gating', () => {
  const base = {
    url: 'https://api.twilio.com/2010-04-01/Accounts/AC/Media/ME',
    contentType: 'audio/ogg',
    messageSid: 'SM123',
    phone: '+2348000000000',
  };

  it('refuses a spoofed media host before any reservation or download', async () => {
    const s = stub({});
    const r = await transcribeVoiceNoteGated(s.client, { ...base, url: 'https://evil.example.com/a.ogg' });
    expect(r.code).toBe('MEDIA_HOST_REJECTED');
    expect(r.transcript).toBeNull();
    expect(s.calls).toEqual([]);
  });

  it('refuses a non-audio attachment before any reservation', async () => {
    const s = stub({});
    const r = await transcribeVoiceNoteGated(s.client, { ...base, contentType: 'image/png' });
    expect(r.code).toBe('MIME_REJECTED');
    expect(s.calls).toEqual([]);
  });

  it('requires a provider message id', async () => {
    const s = stub({});
    const r = await transcribeVoiceNoteGated(s.client, { ...base, messageSid: null });
    expect(r.code).toBe('MESSAGE_ID_REQUIRED');
    expect(s.calls).toEqual([]);
  });

  it('reserves before any expensive work', async () => {
    const s = stub({ whatsapp_voice_reserve: { ok: false, reason: 'RATE_LIMITED_MINUTE' } });
    const r = await transcribeVoiceNoteGated(s.client, base);
    expect(r.code).toBe('RATE_LIMITED_MINUTE');
    expect(r.message).toContain('type your message');
    expect(s.calls.map((c) => c.name)).toEqual(['whatsapp_voice_reserve']);
    expect(s.calls[0].args.p_message_sid).toBe('SM123');
  });

  it('says voice is off when the master switch is off', async () => {
    const s = stub({ whatsapp_voice_reserve: { ok: false, reason: 'VOICE_DISABLED' } });
    const r = await transcribeVoiceNoteGated(s.client, base);
    expect(r.code).toBe('VOICE_DISABLED');
    expect(r.message).toContain("aren't available");
  });

  it('answers a replayed provider delivery silently — no second transcription', async () => {
    const s = stub({ whatsapp_voice_reserve: { ok: false, reason: 'REPLAY', replay: true } });
    const r = await transcribeVoiceNoteGated(s.client, base);
    expect(r.code).toBe('REPLAY');
    expect(r.transcript).toBeNull();
    expect(r.message).toBeNull();
    expect(s.calls).toHaveLength(1);
  });

  it('refuses when the platform is at its daily ceiling or busy', async () => {
    for (const reason of ['DAILY_CEILING', 'BUSY', 'RATE_LIMITED_DAY']) {
      const s = stub({ whatsapp_voice_reserve: { ok: false, reason } });
      const r = await transcribeVoiceNoteGated(s.client, base);
      expect(r.code).toBe(reason);
      expect(r.transcript).toBeNull();
    }
  });

  it('fails closed when the reservation itself errors', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'db down' } }) };
    const r = await transcribeVoiceNoteGated(client, base);
    expect(r.code).toBe('RESERVE_FAILED');
    expect(r.transcript).toBeNull();
  });

  it('the webhook answers a replay once and never re-enters the conversation', () => {
    expect(WEBHOOK).toContain('transcribeVoiceNoteGated');
    expect(WEBHOOK).toContain("gated.code === \"REPLAY\"");
    expect(WEBHOOK).not.toContain('transcribeVoiceNote(voice.url');
  });
});

describe('no outlet guessing on order-capable paths', () => {
  it('checkout requires an explicit branch', () => {
    expect(TOOLS).toContain('if (!cart.vendor_id || !cart.outlet_id) return { ok: false, reason: "no_branch" }');
  });

  it('reorder asks the customer to choose instead of defaulting a branch', () => {
    expect(TOOLS).toContain('reason: "choose_branch"');
    expect(TOOLS).not.toContain('resolveDefaultOutletId(ctx.supabase, order.vendor_id)');
    expect(TOOLS).not.toContain('resolveDefaultOutletId');
  });

  it('branch eligibility is revalidated at checkout', () => {
    expect(TOOLS).toContain('const gate = await outletOrderable(ctx, cart.outlet_id)');
    expect(TOOLS).toContain('closed_by_schedule');
    expect(TOOLS).toContain('closed_by_admin');
    expect(TOOLS).toContain('branch_inactive');
  });
});

describe('atomic checkout is the only WhatsApp order/pay route', () => {
  it('the webhook creates no order or wallet row itself', () => {
    expect(WEBHOOK).not.toContain('from("orders").insert');
    expect(WEBHOOK).not.toContain('from("order_items").insert');
    expect(WEBHOOK).not.toContain('post_wallet_entry');
  });

  it('order creation goes through the atomic transaction', () => {
    expect(TOOLS).toContain('rpc("whatsapp_create_order_atomic"');
    const inserts = TOOLS.match(/from\("orders"\)\s*\.insert/g) || [];
    expect(inserts).toHaveLength(0);
  });

  it('checkout is idempotent per checkout intent', () => {
    expect(TOOLS).toContain('checkout_intent_key');
    expect(TOOLS).toContain('idempotency_key');
    expect(TOOLS).toContain('already_created: true');
  });
});
