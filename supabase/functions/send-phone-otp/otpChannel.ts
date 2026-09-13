// Pure channel/template selection for phone OTP delivery.
//
// WhatsApp OTP may ONLY go out on an approved WhatsApp template (ContentSid).
// Meta rejects free-form messages outside the 24-hour customer-service window
// (Twilio error 63016), which is what produced the misleading
// "window period" errors. When no approved template exists we fall back to SMS,
// and when SMS is not configured we report a configuration error instead.

export const OTP_BODY_REDACTED = "[OTP REDACTED]";

/** Template states we accept as usable for sending. Case-insensitive. */
const APPROVED_STATES = new Set(["approved", "active", "approved_by_meta"]);

export function isTemplateApproved(status?: string | null): boolean {
  if (!status) return false;
  return APPROVED_STATES.has(String(status).trim().toLowerCase());
}

export interface OtpDeliveryInput {
  /** Caller explicitly asked for SMS. */
  preferSms?: boolean;
  /** content_sid from whatsapp_templates for wa_otp_code. */
  templateSid?: string | null;
  /** approval_status from whatsapp_templates for wa_otp_code (null when no row). */
  templateStatus?: string | null;
  /** TWILIO_OTP_CONTENT_SID env override. */
  envSid?: string | null;
  /** TWILIO_SMS_FROM presence. */
  smsFrom?: string | null;
}

export interface OtpDeliveryPlan {
  channel: "whatsapp" | "sms" | null;
  contentSid: string | null;
  /** Machine-readable explanation of why this channel was chosen. */
  reason:
    | "sms_requested"
    | "approved_whatsapp_template"
    | "whatsapp_template_not_approved"
    | "whatsapp_template_missing"
    | "no_usable_channel";
  /** True when WhatsApp was wanted but SMS is being used instead. */
  fellBack: boolean;
}

/**
 * Decide how the OTP goes out. Never returns a WhatsApp plan without a
 * ContentSid, so a free-form WhatsApp OTP is structurally impossible.
 */
export function planOtpDelivery(input: OtpDeliveryInput): OtpDeliveryPlan {
  const smsFrom = input.smsFrom?.trim() || "";
  const dbSid = input.templateSid?.trim() || "";
  const envSid = input.envSid?.trim() || "";
  const hasRecord = !!input.templateStatus || !!dbSid;
  const approved = isTemplateApproved(input.templateStatus);

  if (input.preferSms) {
    return smsFrom
      ? { channel: "sms", contentSid: null, reason: "sms_requested", fellBack: false }
      : { channel: null, contentSid: null, reason: "no_usable_channel", fellBack: false };
  }

  // The env override is a convenience, not a bypass: it is only trusted when
  // the stored template is approved, or when there is no stored record at all.
  const usableSid = approved ? (envSid || dbSid) : (hasRecord ? "" : envSid);

  if (usableSid) {
    return { channel: "whatsapp", contentSid: usableSid, reason: "approved_whatsapp_template", fellBack: false };
  }

  const reason = hasRecord ? "whatsapp_template_not_approved" : "whatsapp_template_missing";
  if (smsFrom) return { channel: "sms", contentSid: null, reason, fellBack: true };
  return { channel: null, contentSid: null, reason: "no_usable_channel", fellBack: false };
}

/** Human-safe explanation for the UI when no channel could be used. */
export function describeUnusableChannel(reason: OtpDeliveryPlan["reason"]): string {
  if (reason === "no_usable_channel") {
    return "Verification codes aren't set up yet: no approved WhatsApp code template and no SMS sender is configured. Please contact support.";
  }
  return "We couldn't send your code right now. Please try again shortly.";
}
