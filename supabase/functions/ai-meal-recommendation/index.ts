import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { calorieTarget, caloriesConsumed, healthGoal, mealType } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const remainingCalories = calorieTarget - caloriesConsumed;
    const currentTime = new Date().getHours();
    
    let suggestedMealType = mealType;
    if (!suggestedMealType) {
      if (currentTime < 11) suggestedMealType = "breakfast";
      else if (currentTime < 15) suggestedMealType = "lunch";
      else if (currentTime < 18) suggestedMealType = "snack";
      else suggestedMealType = "dinner";
    }

    const systemPrompt = `You are a Nigerian nutrition expert helping users find healthy meals. 
You specialize in Nigerian cuisine and understand local food options available on food delivery platforms.
Always suggest meals that are:
1. Available at typical Nigerian restaurants
2. Within the user's remaining calorie budget
3. Aligned with their health goals
4. Appropriate for the time of day

Format your response as JSON with this structure:
{
  "recommendations": [
    {
      "name": "Meal name",
      "description": "Brief description",
      "estimatedCalories": 500,
      "category": "restaurant|pharmacy|market",
      "tags": ["high-protein", "low-carb", etc]
    }
  ],
  "tip": "A helpful nutrition tip"
}`;

    const userPrompt = `I need meal recommendations for ${suggestedMealType}.
- My daily calorie target: ${calorieTarget} kcal
- Calories consumed today: ${caloriesConsumed} kcal
- Remaining calories: ${remainingCalories} kcal
- Health goal: ${healthGoal || "maintain weight"}

Please suggest 3 Nigerian meals that fit my remaining calorie budget and health goals.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please try again later." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    // Parse the JSON from the response
    let parsedContent;
    try {
      // Extract JSON from the response (handle markdown code blocks)
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      parsedContent = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response:", content);
      parsedContent = {
        recommendations: [
          {
            name: "Grilled Fish with Vegetables",
            description: "Light and protein-rich option perfect for your goals",
            estimatedCalories: Math.min(remainingCalories * 0.4, 450),
            category: "restaurant",
            tags: ["high-protein", "low-carb"]
          }
        ],
        tip: "Try to balance your meals throughout the day for optimal energy."
      };
    }

    return new Response(JSON.stringify(parsedContent), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ai-meal-recommendation error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
