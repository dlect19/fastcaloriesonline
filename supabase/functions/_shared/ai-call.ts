// Shared AI chat completion helper with Lovable AI → Gemini fallback.
// Falls back to the user's own Gemini key (GEMINI_API_KEY) when Lovable AI
// returns 402 (credits exhausted) or 429 (rate limited).

const MODEL_MAP_TO_GEMINI: Record<string, string> = {
  "google/gemini-3-flash-preview": "gemini-2.5-flash",
  "google/gemini-3.5-flash": "gemini-2.5-flash",
  "google/gemini-3-pro-preview": "gemini-2.5-pro",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
};

// Image-capable models (Lovable gateway id -> native Gemini image model)
const IMAGE_MODEL_MAP_TO_GEMINI: Record<string, string> = {
  "google/gemini-3-pro-image-preview": "gemini-2.5-flash-image",
  "google/gemini-2.5-flash-image-preview": "gemini-2.5-flash-image",
  "google/gemini-2.5-flash-image": "gemini-2.5-flash-image",
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

async function callLovable(
  body: ChatCompletionBody,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Response> {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify(body),
  });
}

async function callGemini(
  body: ChatCompletionBody,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Response> {
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
      signal,
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
  opts?: { signal?: AbortSignal },
): Promise<ChatCompletionResult> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  // Primary attempt: Lovable AI
  if (lovableKey) {
    try {
      const resp = await callLovable(body, lovableKey, opts?.signal);
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
    const resp = await callGemini(body, geminiKey, opts?.signal);
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

/* ------------------------------------------------------------------ *
 * Image generation with Lovable AI -> native Gemini fallback
 * ------------------------------------------------------------------ */

export interface ImageContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ImageGenerationResult {
  ok: boolean;
  status: number;
  /** data URL (data:image/png;base64,...) when ok */
  imageDataUrl?: string;
  errorText?: string;
  provider: "lovable" | "gemini";
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Convert an OpenAI-style image_url (data URL or https) to Gemini inline_data. */
async function toInlineData(url: string): Promise<{ mime_type: string; data: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return null;
      return { mime_type: m[1], data: m[2] };
    }
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get("content-type")?.split(";")[0] || "image/png";
    return { mime_type: mime, data: toBase64(new Uint8Array(await r.arrayBuffer())) };
  } catch {
    return null;
  }
}

async function callGeminiImage(
  model: string,
  parts: ImageContentPart[],
  apiKey: string,
): Promise<ImageGenerationResult> {
  const geminiModel = IMAGE_MODEL_MAP_TO_GEMINI[model] || "gemini-2.5-flash-image";
  const geminiParts: any[] = [];
  for (const p of parts) {
    if (p.type === "text" && p.text) {
      geminiParts.push({ text: p.text });
    } else if (p.type === "image_url" && p.image_url?.url) {
      const inline = await toInlineData(p.image_url.url);
      if (inline) geminiParts.push({ inline_data: inline });
    }
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: geminiParts }] }),
    },
  );

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      errorText: (await resp.text()).slice(0, 500),
      provider: "gemini",
    };
  }

  const data = await resp.json();
  const cand = data?.candidates?.[0]?.content?.parts || [];
  const img = cand.find((p: any) => p?.inline_data?.data || p?.inlineData?.data);
  const inline = img?.inline_data || img?.inlineData;
  if (!inline?.data) {
    return {
      ok: false,
      status: 502,
      errorText: "Gemini returned no image.",
      provider: "gemini",
    };
  }
  const mime = inline.mime_type || inline.mimeType || "image/png";
  return {
    ok: true,
    status: 200,
    imageDataUrl: `data:${mime};base64,${inline.data}`,
    provider: "gemini",
  };
}

/**
 * Generate an image: Lovable AI gateway first, then the user's own
 * GEMINI_API_KEY (native Gemini image model) as fallback.
 */
export async function imageGenerationWithFallback(
  model: string,
  parts: ImageContentPart[],
): Promise<ImageGenerationResult> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  if (lovableKey) {
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: parts }],
          modalities: ["image", "text"],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const url = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (url) {
          return { ok: true, status: 200, imageDataUrl: url, provider: "lovable" };
        }
        console.log("[ai-image] Lovable returned 200 with no image — falling back to Gemini");
      } else {
        console.log(
          `[ai-image] Lovable returned ${resp.status}: ${(await resp.text()).slice(0, 300)} — falling back to Gemini`,
        );
      }
    } catch (e) {
      console.error("[ai-image] Lovable exception, trying Gemini:", e);
    }
  } else {
    console.log("[ai-image] No LOVABLE_API_KEY set, going straight to Gemini");
  }

  if (!geminiKey) {
    return {
      ok: false,
      status: 402,
      errorText: "AI image service unavailable and no GEMINI_API_KEY configured for fallback.",
      provider: "lovable",
    };
  }

  console.log("[ai-image] Calling Gemini image fallback...");
  try {
    return await callGeminiImage(model, parts, geminiKey);
  } catch (e) {
    return {
      ok: false,
      status: 500,
      errorText: e instanceof Error ? e.message : String(e),
      provider: "gemini",
    };
  }
}
