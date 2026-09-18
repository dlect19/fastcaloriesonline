// Re-exports the launch-gate rules used by the WhatsApp webhook so the admin
// screen previews exactly what the server will do.
export {
  DEFAULT_LAUNCH_TEMPLATES,
  LAUNCH_LANGS,
  LAUNCH_SETTING_KEYS,
  detectLanguage,
  evaluateLaunchGate,
  formatLaunchMoment,
  isTesterAllowed,
  parseLaunchSettings,
  phoneKey,
  renderLaunchMessage,
  sanitizeTemplate,
} from '../../supabase/functions/whatsapp-webhook/launchGate';
export type {
  AllowlistRow,
  GateDecision,
  GateReason,
  LaunchLang,
  LaunchSettings,
  LaunchState,
} from '../../supabase/functions/whatsapp-webhook/launchGate';
