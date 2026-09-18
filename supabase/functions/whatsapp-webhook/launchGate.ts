// WhatsApp launch gate — decides, server-side, whether an inbound WhatsApp
// number may enter the full ordering experience before public launch.
//
// Everything here is pure except the two loaders at the bottom, so the same
// decision logic runs in tests and in production.

export type LaunchState = "pre_launch" | "scheduled" | "live" | "paused";
export type LaunchLang = "en" | "yo" | "ig" | "ha";

export const LAUNCH_LANGS: LaunchLang[] = ["en", "yo", "ig", "ha"];

export const LAUNCH_SETTING_KEYS = [
  "whatsapp_launch_state",
  "whatsapp_launch_at",
  "whatsapp_launch_testers_bypass_pause",
  "whatsapp_launch_msg_en",
  "whatsapp_launch_msg_yo",
  "whatsapp_launch_msg_ig",
  "whatsapp_launch_msg_ha",
];

export interface LaunchSettings {
  state: LaunchState;
  /** UTC ISO timestamp, or null when no launch moment is scheduled. */
  launchAt: string | null;
  testersBypassPause: boolean;
  templates: Record<LaunchLang, string>;
}

/** Safe defaults. `{date}` is replaced with the scheduled moment when set. */
export const DEFAULT_LAUNCH_TEMPLATES: Record<LaunchLang, string> = {
  en: "FastCalories WhatsApp ordering is launching soon.{date} Thanks for your patience — we will let you know the moment it opens.",
  yo: "Ìtàjà oúnjẹ FastCalories lórí WhatsApp máa ṣí ní kété.{date} Ẹ ṣé fún sùúrù — a máa jẹ́ kí ẹ mọ̀ nígbà tí ó bá ṣí.",
  ig: "Ịtụ ihe oriri FastCalories na WhatsApp ga-emalite n'oge na-adịghị anya.{date} Daalụ maka ndidi — anyị ga-agwa gị mgbe ọ meghere.",
  ha: "Yin oda na abinci FastCalories a WhatsApp zai fara nan ba da jimawa ba.{date} Mun gode da haƙuri — za mu sanar da ku lokacin da ya buɗe.",
};

const APPROVED_LINK_HOSTS = [
  "fastcalories.online",
  "app.fastcalories.online",
  "fastcaloriesonline.lovable.app",
];

function isLaunchState(v: unknown): v is LaunchState {
  return v === "pre_launch" || v === "scheduled" || v === "live" || v === "paused";
}

export function parseLaunchSettings(raw: Record<string, unknown>): LaunchSettings {
  const stateRaw = String(raw["whatsapp_launch_state"] ?? "").trim();
  const state: LaunchState = isLaunchState(stateRaw) ? stateRaw : "pre_launch";

  const atRaw = String(raw["whatsapp_launch_at"] ?? "").trim();
  let launchAt: string | null = null;
  if (atRaw) {
    const d = new Date(atRaw);
    if (!Number.isNaN(d.getTime())) launchAt = d.toISOString();
  }

  const templates = { ...DEFAULT_LAUNCH_TEMPLATES };
  for (const lang of LAUNCH_LANGS) {
    const custom = String(raw[`whatsapp_launch_msg_${lang}`] ?? "").trim();
    if (custom) templates[lang] = custom;
  }

  return {
    state,
    launchAt,
    // Default true: testers must keep working while the platform is paused.
    testersBypassPause: String(raw["whatsapp_launch_testers_bypass_pause"] ?? "true") !== "false",
    templates,
  };
}

export type GateReason =
  | "LIVE"
  | "SCHEDULE_REACHED"
  | "TESTER_ALLOWLISTED"
  | "PRE_LAUNCH"
  | "SCHEDULED_NOT_REACHED"
  | "PAUSED";

export interface GateDecision {
  allow: boolean;
  reason: GateReason;
}

/**
 * The only gate decision. Testers are the sole pre-launch bypass, and even
 * they cannot pass a pause unless an admin enabled the bypass.
 */
export function evaluateLaunchGate(
  settings: LaunchSettings,
  opts: { now: Date; isTester: boolean },
): GateDecision {
  const { state, launchAt, testersBypassPause } = settings;

  if (state === "live") return { allow: true, reason: "LIVE" };

  if (state === "paused") {
    if (opts.isTester && testersBypassPause) return { allow: true, reason: "TESTER_ALLOWLISTED" };
    return { allow: false, reason: "PAUSED" };
  }

  if (state === "scheduled" && launchAt) {
    // Opens automatically at the exact UTC instant — no redeploy needed.
    if (opts.now.getTime() >= new Date(launchAt).getTime()) {
      return { allow: true, reason: "SCHEDULE_REACHED" };
    }
    if (opts.isTester) return { allow: true, reason: "TESTER_ALLOWLISTED" };
    return { allow: false, reason: "SCHEDULED_NOT_REACHED" };
  }

  if (opts.isTester) return { allow: true, reason: "TESTER_ALLOWLISTED" };
  return { allow: false, reason: state === "scheduled" ? "SCHEDULED_NOT_REACHED" : "PRE_LAUNCH" };
}

// ============================================================
// Tester identity
// ============================================================

export interface AllowlistRow {
  user_id: string;
  normalized_phone: string;
  phone_verified: boolean;
  enabled: boolean;
}

/** Digits-only comparison so +234/0/234 forms of one number match. */
export function phoneKey(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "234" + digits.slice(1);
  if (digits.length === 10) return "234" + digits;
  return digits;
}

/**
 * A tester passes only when the allowlisted account, its stored verified
 * phone and the inbound WhatsApp number are the same person. Chat text and
 * claimed identities are never consulted.
 */
export function isTesterAllowed(input: {
  row: AllowlistRow | null | undefined;
  inboundPhone: string;
  resolvedUserId: string | null | undefined;
  profilePhone?: string | null;
  profilePhoneVerified?: boolean;
}): { allowed: boolean; reason: string } {
  const { row } = input;
  if (!row) return { allowed: false, reason: "NOT_ALLOWLISTED" };
  if (!row.enabled) return { allowed: false, reason: "TESTER_DISABLED" };
  if (!row.phone_verified) return { allowed: false, reason: "TESTER_PHONE_UNVERIFIED" };

  const inbound = phoneKey(input.inboundPhone);
  if (!inbound) return { allowed: false, reason: "NO_INBOUND_PHONE" };
  if (phoneKey(row.normalized_phone) !== inbound) {
    return { allowed: false, reason: "TESTER_PHONE_MISMATCH" };
  }
  if (!input.resolvedUserId || input.resolvedUserId !== row.user_id) {
    return { allowed: false, reason: "ACCOUNT_MISMATCH" };
  }
  if (input.profilePhone !== undefined && phoneKey(input.profilePhone) !== inbound) {
    return { allowed: false, reason: "PROFILE_PHONE_MISMATCH" };
  }
  if (input.profilePhoneVerified === false) {
    return { allowed: false, reason: "PROFILE_PHONE_UNVERIFIED" };
  }
  return { allowed: true, reason: "TESTER_ALLOWLISTED" };
}

// ============================================================
// Lightweight language detection (no AI call)
// ============================================================

const LANG_HINTS: Record<Exclude<LaunchLang, "en">, string[]> = {
  yo: [
    "bawo", "báwo", "jowo", "jọwọ", "mo fe", "mo fẹ", "ounje", "oúnjẹ", "e se", "ẹ ṣé",
    "kaabo", "káàbọ̀", "pele", "pẹlẹ", "sise", "wa fun mi", "ki lo", "elo ni", "beeni",
  ],
  ig: [
    "kedu", "biko", "nnoo", "nnọọ", "daalu", "daalụ", "ndewo", "achoro", "achọrọ",
    "nri", "ego", "ole", "ogini", "gini", "ka o di",
  ],
  ha: [
    "sannu", "ina kwana", "don allah", "na gode", "abinci", "yaya", "barka",
    "nawa ne", "ina son", "lafiya", "madalla",
  ],
};

/**
 * Keyword/stored-preference detection only — deliberately never calls Gemini,
 * because pre-launch traffic must cost nothing.
 */
export function detectLanguage(text: string | null | undefined, stored?: string | null): LaunchLang {
  const t = String(text ?? "").toLowerCase();
  if (t) {
    for (const lang of ["yo", "ig", "ha"] as const) {
      for (const hint of LANG_HINTS[lang]) {
        if (hint.includes(" ") ? t.includes(hint) : new RegExp(`(^|[^\\p{L}])${hint}([^\\p{L}]|$)`, "u").test(t)) {
          return lang;
        }
      }
    }
    // An explicit request such as "yoruba please".
    if (/\byoruba\b|\byorùbá\b/.test(t)) return "yo";
    if (/\bigbo\b/.test(t)) return "ig";
    if (/\bhausa\b/.test(t)) return "ha";
    if (/\benglish\b/.test(t)) return "en";
  }
  const pref = String(stored ?? "").trim().toLowerCase();
  if (LAUNCH_LANGS.includes(pref as LaunchLang)) return pref as LaunchLang;
  return "en";
}

// ============================================================
// Message rendering
// ============================================================

/** Strips any link that is not an approved FastCalories URL. */
export function sanitizeTemplate(text: string): string {
  return String(text ?? "")
    .replace(/\b(?:https?:\/\/|www\.)[^\s]+/gi, (match) => {
      const withScheme = match.startsWith("http") ? match : `https://${match}`;
      try {
        const host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
        return APPROVED_LINK_HOSTS.includes(host) ? match : "";
      } catch {
        return "";
      }
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Scheduled moment in the admin's timezone (Africa/Lagos by default). */
export function formatLaunchMoment(launchAt: string, timeZone = "Africa/Lagos"): string {
  const d = new Date(launchAt);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-NG", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function renderLaunchMessage(
  settings: LaunchSettings,
  lang: LaunchLang,
  timeZone = "Africa/Lagos",
): string {
  const template = settings.templates[lang] || DEFAULT_LAUNCH_TEMPLATES[lang] || DEFAULT_LAUNCH_TEMPLATES.en;
  const moment = settings.launchAt ? formatLaunchMoment(settings.launchAt, timeZone) : "";
  const datePart = moment ? ` We go live on ${moment} (WAT).` : "";
  const withDate = template.includes("{date}")
    ? template.replace(/\{date\}/g, datePart)
    : `${template}${datePart}`;
  return sanitizeTemplate(withDate);
}

// ============================================================
// Loaders (impure)
// ============================================================

export async function loadLaunchSettings(supabase: any): Promise<LaunchSettings> {
  const { data } = await supabase
    .from("platform_settings")
    .select("key,value")
    .in("key", LAUNCH_SETTING_KEYS);
  const raw: Record<string, unknown> = {};
  for (const row of data || []) raw[row.key] = row.value;
  return parseLaunchSettings(raw);
}

export async function loadAllowlistRow(
  supabase: any,
  userId: string | null | undefined,
): Promise<AllowlistRow | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("whatsapp_launch_allowlist")
    .select("user_id, normalized_phone, phone_verified, enabled")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as AllowlistRow | null) ?? null;
}
