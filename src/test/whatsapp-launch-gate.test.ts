import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LAUNCH_TEMPLATES,
  detectLanguage,
  evaluateLaunchGate,
  isTesterAllowed,
  parseLaunchSettings,
  phoneKey,
  renderLaunchMessage,
  sanitizeTemplate,
} from '../../supabase/functions/whatsapp-webhook/launchGate';
import { evaluateVendorNotification, isVendorActionable } from '../../supabase/functions/_shared/vendorNotifyGate';

const WEBHOOK = readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const ALERTS = readFileSync('supabase/functions/vendor-order-alerts/index.ts', 'utf8');

const settings = (over: Record<string, string> = {}) =>
  parseLaunchSettings({ whatsapp_launch_state: 'pre_launch', ...over });

describe('launch state behaviour', () => {
  it('defaults to pre-launch and blocks everyone who is not a tester', () => {
    const s = parseLaunchSettings({});
    expect(s.state).toBe('pre_launch');
    expect(evaluateLaunchGate(s, { now: new Date(), isTester: false })).toEqual({
      allow: false,
      reason: 'PRE_LAUNCH',
    });
  });

  it('lets an allowlisted tester through before launch', () => {
    expect(evaluateLaunchGate(settings(), { now: new Date(), isTester: true }).allow).toBe(true);
  });

  it('allows everyone when live', () => {
    const s = settings({ whatsapp_launch_state: 'live' });
    expect(evaluateLaunchGate(s, { now: new Date(), isTester: false })).toEqual({ allow: true, reason: 'LIVE' });
  });

  it('opens automatically at the exact scheduled UTC instant', () => {
    const at = '2026-10-01T09:00:00.000Z';
    const s = settings({ whatsapp_launch_state: 'scheduled', whatsapp_launch_at: at });
    expect(evaluateLaunchGate(s, { now: new Date('2026-10-01T08:59:59.999Z'), isTester: false }).allow).toBe(false);
    expect(evaluateLaunchGate(s, { now: new Date(at), isTester: false })).toEqual({
      allow: true,
      reason: 'SCHEDULE_REACHED',
    });
  });

  it('scheduled but not reached still admits testers', () => {
    const s = settings({ whatsapp_launch_state: 'scheduled', whatsapp_launch_at: '2030-01-01T00:00:00Z' });
    expect(evaluateLaunchGate(s, { now: new Date(), isTester: false }).reason).toBe('SCHEDULED_NOT_REACHED');
    expect(evaluateLaunchGate(s, { now: new Date(), isTester: true }).allow).toBe(true);
  });

  it('paused blocks everyone, testers only when the bypass is enabled', () => {
    const bypass = settings({ whatsapp_launch_state: 'paused' });
    expect(evaluateLaunchGate(bypass, { now: new Date(), isTester: false }).reason).toBe('PAUSED');
    expect(evaluateLaunchGate(bypass, { now: new Date(), isTester: true }).allow).toBe(true);

    const noBypass = settings({
      whatsapp_launch_state: 'paused',
      whatsapp_launch_testers_bypass_pause: 'false',
    });
    expect(evaluateLaunchGate(noBypass, { now: new Date(), isTester: true }).allow).toBe(false);
  });

  it('ignores an unknown state and falls back to pre-launch', () => {
    expect(parseLaunchSettings({ whatsapp_launch_state: 'open_sesame' }).state).toBe('pre_launch');
  });
});

describe('tester identity cannot be spoofed', () => {
  const row = {
    user_id: 'user-1',
    normalized_phone: '2348031234567',
    phone_verified: true,
    enabled: true,
  };

  it('accepts the allowlisted account on its own verified number', () => {
    const r = isTesterAllowed({
      row,
      inboundPhone: '+2348031234567',
      resolvedUserId: 'user-1',
      profilePhone: '08031234567',
      profilePhoneVerified: true,
    });
    expect(r.allowed).toBe(true);
  });

  it('normalises 0/234/+234 forms of the same number', () => {
    expect(phoneKey('08031234567')).toBe(phoneKey('+2348031234567'));
    expect(phoneKey('2348031234567')).toBe('2348031234567');
  });

  it('denies an unknown number', () => {
    expect(isTesterAllowed({ row: null, inboundPhone: '+2348031234567', resolvedUserId: null }).allowed).toBe(false);
  });

  it('denies a different number claiming the allowlisted account', () => {
    const r = isTesterAllowed({ row, inboundPhone: '+2349099999999', resolvedUserId: 'user-1' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('TESTER_PHONE_MISMATCH');
  });

  it('denies when the resolved account is a different customer', () => {
    const r = isTesterAllowed({ row, inboundPhone: '+2348031234567', resolvedUserId: 'user-2' });
    expect(r.reason).toBe('ACCOUNT_MISMATCH');
  });

  it('denies an unverified phone mapping', () => {
    const r = isTesterAllowed({
      row: { ...row, phone_verified: false },
      inboundPhone: '+2348031234567',
      resolvedUserId: 'user-1',
    });
    expect(r.reason).toBe('TESTER_PHONE_UNVERIFIED');
  });

  it('denies a disabled tester', () => {
    const r = isTesterAllowed({
      row: { ...row, enabled: false },
      inboundPhone: '+2348031234567',
      resolvedUserId: 'user-1',
    });
    expect(r.reason).toBe('TESTER_DISABLED');
  });

  it('denies when the account profile phone no longer matches', () => {
    const r = isTesterAllowed({
      row,
      inboundPhone: '+2348031234567',
      resolvedUserId: 'user-1',
      profilePhone: '08055555555',
    });
    expect(r.reason).toBe('PROFILE_PHONE_MISMATCH');
  });
});

describe('multilingual pre-launch reply', () => {
  it('detects Yoruba, Igbo and Hausa, and falls back to English', () => {
    expect(detectLanguage('Bawo ni, mo fe ounje')).toBe('yo');
    expect(detectLanguage('Kedu, biko achọrọ nri')).toBe('ig');
    expect(detectLanguage('Sannu, ina son abinci')).toBe('ha');
    expect(detectLanguage('hey there')).toBe('en');
    expect(detectLanguage('')).toBe('en');
  });

  it('uses the stored preference when the text gives no clue', () => {
    expect(detectLanguage('ok', 'ha')).toBe('ha');
    expect(detectLanguage('ok', 'klingon')).toBe('en');
  });

  it('renders a launch message in each language', () => {
    const s = settings({ whatsapp_launch_at: '2026-10-01T09:00:00Z' });
    for (const lang of ['en', 'yo', 'ig', 'ha'] as const) {
      const msg = renderLaunchMessage(s, lang);
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).toContain('2026');
    }
    expect(renderLaunchMessage(s, 'en')).toContain('FastCalories');
  });

  it('never lets a template inject an unapproved link', () => {
    expect(sanitizeTemplate('Pay here https://evil.example/pay now')).not.toContain('evil.example');
    expect(sanitizeTemplate('Visit https://app.fastcalories.online')).toContain('app.fastcalories.online');
    expect(DEFAULT_LAUNCH_TEMPLATES.en).not.toMatch(/https?:/);
  });
});

describe('gate placement in the webhook', () => {
  const gateIdx = WEBHOOK.indexOf('Launch gate');
  it('runs after signature verification and before any costly work', () => {
    expect(gateIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(WEBHOOK.indexOf('verifyTwilioSignature(req, params'));
    expect(gateIdx).toBeLessThan(WEBHOOK.indexOf('transcribeVoiceNoteGated'));
    expect(gateIdx).toBeLessThan(WEBHOOK.indexOf('runAgentTurn('));
    expect(gateIdx).toBeLessThan(WEBHOOK.indexOf('recordInboundMessage(supabase'));
  });

  it('deduplicates the launch reply by MessageSid and never transcribes media', () => {
    const block = WEBHOOK.slice(gateIdx, gateIdx + 3400);
    expect(block).toContain('eq("twilio_sid", messageSid)');
    expect(block).toContain('detectVoiceNote(params) ? ""');
    expect(block).toContain('renderLaunchMessage');
    expect(block).not.toContain('transcribeVoiceNoteGated');
    expect(block).not.toContain('recordUnverifiedPaymentProof');
  });
});

describe('vendor is never notified for an unpaid order', () => {
  it('does not notify a pending WhatsApp order', () => {
    const d = evaluateVendorNotification({ payment_status: 'pending', channel: 'whatsapp', status: 'pending' });
    expect(d).toEqual({ notify: false, reason: 'AWAITING_PAYMENT' });
    expect(isVendorActionable({ payment_status: 'awaiting_payment', channel: 'whatsapp' })).toBe(false);
  });

  it('notifies once payment is verified', () => {
    expect(evaluateVendorNotification({ payment_status: 'paid', channel: 'whatsapp' })).toEqual({
      notify: true,
      reason: 'PAID',
    });
  });

  it('never notifies twice for the same order', () => {
    const d = evaluateVendorNotification({
      payment_status: 'paid',
      channel: 'whatsapp',
      vendor_wa_new_order_alerted_at: new Date().toISOString(),
    });
    expect(d).toEqual({ notify: false, reason: 'ALREADY_NOTIFIED' });
  });

  it('never notifies for failed, cancelled or proof-only attempts', () => {
    for (const payment_status of ['failed', 'abandoned', 'expired', 'cancelled', 'underpaid', 'proof_submitted']) {
      expect(evaluateVendorNotification({ payment_status, channel: 'whatsapp' }).notify).toBe(false);
    }
    expect(evaluateVendorNotification({ payment_status: 'paid', status: 'cancelled' }).notify).toBe(false);
  });

  it('still allows POS and cash-on-delivery sales', () => {
    expect(evaluateVendorNotification({ channel: 'pos', payment_status: 'pending' }).notify).toBe(true);
    expect(evaluateVendorNotification({ payment_method: 'cash', payment_status: 'pending' }).notify).toBe(true);
  });

  it('the alert job claims the order before sending so retries cannot duplicate', () => {
    expect(ALERTS).toContain('evaluateVendorNotification');
    expect(ALERTS).toContain('.is("vendor_wa_new_order_alerted_at", null)');
    expect(ALERTS).toContain('if (!claimed || claimed.length === 0) continue;');
    expect(ALERTS).toContain('.eq("payment_status", "paid")');
  });
});
