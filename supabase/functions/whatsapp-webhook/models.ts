// Model ids used by the WhatsApp assistant. Kept in their own module so cost
// accounting can reference them without importing the agent (avoids a cycle).
// Exact ids from the Lovable AI Gateway model listing — never edited by hand
// to a remembered id.
export const WHATSAPP_AGENT_MODEL = "google/gemini-3.8-flash";
export const WHATSAPP_TRANSCRIBE_MODEL = "google/gemini-3.5-flash";
