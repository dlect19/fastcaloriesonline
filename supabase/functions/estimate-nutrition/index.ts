import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { chatCompletionWithFallback } from "../_shared/ai-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { name, description, serving_unit, category } = await req.json();

    if (!name) {
      return new Response(
        JSON.stringify({ error: "Product name is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const prompt = `Estimate the nutritional information for this Nigerian/African food item:
Name: ${name}
${description ? `Description: ${description}` : ""}
${serving_unit ? `Serving unit: ${serving_unit}` : ""}
${category ? `Category: ${category}` : ""}

Provide accurate estimates based on standard Nigerian food portion sizes and common recipes.`;

    const result = await chatCompletionWithFallback({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: "You are a nutrition expert specializing in Nigerian and African cuisine. You estimate accurate nutritional values based on standard portion sizes and common recipes. Always provide realistic estimates."
        },
        { role: "user", content: prompt }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "estimate_nutrition",
            description: "Return estimated nutritional information for a food item per serving",
            parameters: {
              type: "object",
              properties: {
                calories: { type: "number" },
                protein_grams: { type: "number" },
                carbs_grams: { type: "number" },
                fats_grams: { type: "number" },
                fiber_grams: { type: "number" },
                serving_size_grams: { type: "number" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                notes: { type: "string" }
              },
              required: ["calories", "protein_grams", "carbs_grams", "fats_grams", "serving_size_grams", "confidence"],
              additionalProperties: false
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "estimate_nutrition" } },
    });

    if (!result.ok) {
      console.error("AI error:", result.status, result.errorText);
      return new Response(JSON.stringify({ error: result.errorText || "AI estimation failed" }), {
        status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`[estimate-nutrition] provider=${result.provider}`);
    const toolCall = result.data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "No estimation returned" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const nutrition = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({
      success: true,
      nutrition: {
        calories: Math.round(nutrition.calories),
        protein_grams: Math.round(nutrition.protein_grams * 10) / 10,
        carbs_grams: Math.round(nutrition.carbs_grams * 10) / 10,
        fats_grams: Math.round(nutrition.fats_grams * 10) / 10,
        fiber_grams: Math.round((nutrition.fiber_grams || 0) * 10) / 10,
        serving_size_grams: Math.round(nutrition.serving_size_grams),
        confidence: nutrition.confidence,
        notes: nutrition.notes || null,
        source: "ai_estimated"
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Estimation error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
