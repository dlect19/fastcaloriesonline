import { describe, expect, it } from 'vitest';
import {
  isAgentEligible,
  isExplicitMenuRequest,
} from '../../supabase/functions/whatsapp-webhook/routing';
import {
  OTP_BODY_REDACTED,
  isTemplateApproved,
  planOtpDelivery,
} from '../../supabase/functions/send-phone-otp/otpChannel';

const base = { state: 'menu', hasMedia: false, hasSharedLocation: false };

describe('WhatsApp inbound routing (guest-first)', () => {
  it('sends a brand-new unknown number straight to the AI agent', () => {
    // No account exists yet — routing must not depend on identity at all.
    expect(isAgentEligible({ ...base, state: 'new', body: 'I want jollof rice in Ayobo' })).toBe(true);
  });

  it('lets a guest keep searching and building a cart', () => {
    expect(isAgentEligible({ ...base, body: 'add two shawarma' })).toBe(true);
    expect(isAgentEligible({ ...base, body: 'cheapest chicken near me' })).toBe(true);
  });

  it('routes a shared location pin to the agent, never the numbered menu', () => {
    expect(isAgentEligible({ ...base, body: '', hasSharedLocation: true })).toBe(true);
    expect(isExplicitMenuRequest('', null)).toBe(false);
  });

  it('keeps free-text names in the agent flow while awaiting a name', () => {
    expect(isAgentEligible({ ...base, state: 'awaiting_name', body: 'Ada Lovelace' })).toBe(true);
  });

  it('still honours an explicit menu request', () => {
    expect(isAgentEligible({ ...base, body: 'menu' })).toBe(false);
    expect(isExplicitMenuRequest('menu', null)).toBe(true);
    expect(isExplicitMenuRequest('Help', null)).toBe(true);
  });

  it('leaves taps, media and legacy states to the deterministic flow', () => {
    expect(isAgentEligible({ ...base, body: '', tap: 'BTN_MAIN_MENU' })).toBe(false);
    expect(isAgentEligible({ ...base, body: 'here', hasMedia: true })).toBe(false);
    expect(isAgentEligible({ ...base, state: 'selecting_addons', body: 'extra cheese' })).toBe(false);
    expect(isAgentEligible({ ...base, body: '2' })).toBe(false);
  });
});

describe('OTP channel selection', () => {
  const sid = 'HX398dd8e1602a1fb28abf1915109b4362';

  it('accepts approval status case-insensitively', () => {
    expect(isTemplateApproved('Approved')).toBe(true);
    expect(isTemplateApproved('APPROVED')).toBe(true);
    expect(isTemplateApproved('unsubmitted')).toBe(false);
    expect(isTemplateApproved('pending')).toBe(false);
    expect(isTemplateApproved('rejected')).toBe(false);
    expect(isTemplateApproved(null)).toBe(false);
  });

  it('uses the WhatsApp template when it is approved', () => {
    const plan = planOtpDelivery({ templateSid: sid, templateStatus: 'approved', smsFrom: '+15551234567' });
    expect(plan.channel).toBe('whatsapp');
    expect(plan.contentSid).toBe(sid);
    expect(plan.fellBack).toBe(false);
  });

  it('never attempts free-form WhatsApp when the template is not approved', () => {
    const plan = planOtpDelivery({ templateSid: sid, templateStatus: 'unsubmitted', smsFrom: '+15551234567' });
    expect(plan.channel).toBe('sms');
    expect(plan.contentSid).toBeNull();
    expect(plan.fellBack).toBe(true);
    expect(plan.reason).toBe('whatsapp_template_not_approved');
  });

  it('ignores a bare env ContentSid when the stored template is unapproved', () => {
    const plan = planOtpDelivery({
      templateSid: sid, templateStatus: 'rejected', envSid: 'HXdeadbeef', smsFrom: '+15551234567',
    });
    expect(plan.channel).toBe('sms');
    expect(plan.contentSid).toBeNull();
  });

  it('reports a configuration problem when neither channel is usable', () => {
    const plan = planOtpDelivery({ templateSid: sid, templateStatus: 'unsubmitted', smsFrom: '' });
    expect(plan.channel).toBeNull();
    expect(plan.reason).toBe('no_usable_channel');
  });

  it('honours an explicit SMS request only when a sender exists', () => {
    expect(planOtpDelivery({ preferSms: true, smsFrom: '+15551234567' }).channel).toBe('sms');
    expect(planOtpDelivery({ preferSms: true, smsFrom: '' }).channel).toBeNull();
  });

  it('logs a redacted body, never a six-digit code', () => {
    expect(OTP_BODY_REDACTED).toBe('[OTP REDACTED]');
    expect(/\d{6}/.test(OTP_BODY_REDACTED)).toBe(false);
  });
});
