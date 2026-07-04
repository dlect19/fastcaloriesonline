// Shared WhatsApp sender helpers.

const SANDBOX_FROM = "whatsapp:+14155238886";

/**
 * Resolve the active WhatsApp "From" number.
 * Priority:
 * 1. platform_settings.whatsapp_from_number (set from Admin → WhatsApp)
 * 2. TWILIO_WHATSAPP_FROM env var (legacy fallback)
 * 3. Twilio shared sandbox number
 *
 * Always returns a string prefixed with "whatsapp:".
 */
export async function getWhatsAppFromNumber(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "whatsapp_from_number")
      .maybeSingle();
    const fromSetting = data?.value || Deno.env.get("TWILIO_WHATSAPP_FROM");
    if (!fromSetting) return SANDBOX_FROM;
    return fromSetting.startsWith("whatsapp:") ? fromSetting : `whatsapp:${fromSetting}`;
  } catch (e) {
    console.error("getWhatsAppFromNumber error", e);
    const env = Deno.env.get("TWILIO_WHATSAPP_FROM");
    return env ? (env.startsWith("whatsapp:") ? env : `whatsapp:${env}`) : SANDBOX_FROM;
  }
}
