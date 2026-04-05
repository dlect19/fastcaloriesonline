import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const prompt = `Estimate the nutritional information for this Nigerian/African food item:
Name: ${name}
${description ? `Description: ${description}` : ""}
${serving_unit ? `Serving unit: ${serving_unit}` : ""}
${category ? `Category: ${category}` : ""}

Provide accurate estimates based on standard Nigerian food portion sizes and common recipes.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
                  calories: { type: "number", description: "Estimated calories per serving (kcal)" },
                  protein_grams: { type: "number", description: "Estimated protein in grams per serving" },
                  carbs_grams: { type: "number", description: "Estimated carbohydrates in grams per serving" },
                  fats_grams: { type: "number", description: "Estimated fats in grams per serving" },
                  fiber_grams: { type: "number", description: "Estimated fiber in grams per serving" },
                  serving_size_grams: { type: "number", description: "Estimated weight of one serving in grams" },
                  confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level of the estimate" },
                  notes: { type: "string", description: "Brief explanation of the estimate basis" }
                },
                required: ["calories", "protein_grams", "carbs_grams", "fats_grams", "serving_size_grams", "confidence"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "estimate_nutrition" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI estimation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

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
