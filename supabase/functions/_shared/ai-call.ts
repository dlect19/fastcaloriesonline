// Shared AI chat completion helper with Lovable AI → Gemini fallback.
// Falls back to the user's own Gemini key (GEMINI_API_KEY) when Lovable AI
// returns 402 (credits exhausted) or 429 (rate limited).

const MODEL_MAP_TO_GEMINI: Record<string, string> = {
  "google/gemini-3-flash-preview": "gemini-2.5-flash",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: any;
}

export interface ChatCompletionBody {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: any;
  tools?: any[];
  tool_choice?: any;
}

export interface ChatCompletionResult {
  ok: boolean;
  status: number;
  data?: any;
  errorText?: string;
  provider: "lovable" | "gemini";
}

async function callLovable(body: ChatCompletionBody, apiKey: string): Promise<Response> {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function callGemini(body: ChatCompletionBody, apiKey: string): Promise<Response> {
  const geminiModel = MODEL_MAP_TO_GEMINI[body.model] || "gemini-2.5-flash";
  // Gemini exposes an OpenAI-compatible chat completions endpoint.
  return await fetch(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, model: geminiModel }),
    },
  );
}

/**
 * Try Lovable AI first; on 402/429 (or missing key) fall back to direct
 * Google Gemini using the user-supplied GEMINI_API_KEY secret.
 */
export async function chatCompletionWithFallback(
  body: ChatCompletionBody,
): Promise<ChatCompletionResult> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  // Primary attempt: Lovable AI
  if (lovableKey) {
    try {
      const resp = await callLovable(body, lovableKey);
      if (resp.ok) {
        const data = await resp.json();
        // Validate response shape; some failures return 200 with error body
        if (data?.choices?.length) {
          return { ok: true, status: resp.status, data, provider: "lovable" };
        }
        console.log(
          `[ai-call] Lovable returned 200 but no choices (likely credit/quota issue):`,
          JSON.stringify(data).slice(0, 300),
        );
        // fall through to Gemini
      } else {
        const errText = await resp.text();
        console.log(
          `[ai-call] Lovable returned ${resp.status}: ${errText.slice(0, 300)} — falling back to Gemini`,
        );
        // Only surface error directly for clear non-quota client errors (400 with no key issue)
        // Otherwise fall back to Gemini for any failure
      }
    } catch (e) {
      console.error("[ai-call] Lovable AI exception, trying Gemini:", e);
    }
  } else {
    console.log("[ai-call] No LOVABLE_API_KEY set, going straight to Gemini");
  }

  if (!geminiKey) {
    return {
      ok: false,
      status: 402,
      errorText:
        "Lovable AI unavailable and no GEMINI_API_KEY configured for fallback.",
      provider: "lovable",
    };
  }

  console.log("[ai-call] Calling Gemini fallback...");

  try {
    const resp = await callGemini(body, geminiKey);
    if (resp.ok) {
      return { ok: true, status: resp.status, data: await resp.json(), provider: "gemini" };
    }
    return {
      ok: false,
      status: resp.status,
      errorText: await resp.text(),
      provider: "gemini",
    };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      errorText: e instanceof Error ? e.message : String(e),
      provider: "gemini",
    };
  }
}
