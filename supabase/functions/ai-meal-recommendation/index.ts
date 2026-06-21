import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatCompletionWithFallback } from "../_shared/ai-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { calorieTarget, caloriesConsumed, healthGoal, mealType, orderHistory } = await req.json();
    
    // Keys handled by chatCompletionWithFallback (Lovable AI → Gemini fallback)

    const remainingCalories = calorieTarget - caloriesConsumed;
    const currentTime = new Date().getHours();
    
    let suggestedMealType = mealType;
    if (!suggestedMealType) {
      if (currentTime < 11) suggestedMealType = "breakfast";
      else if (currentTime < 15) suggestedMealType = "lunch";
      else if (currentTime < 18) suggestedMealType = "snack";
      else suggestedMealType = "dinner";
    }

    // Build order history context
    let orderHistoryContext = "";
    if (orderHistory && orderHistory.length > 0) {
      const topItems = orderHistory.slice(0, 10);
      orderHistoryContext = `\n\nThe user's recent order history (most ordered items):\n${topItems.map((item: any) => 
        `- ${item.name} (ordered ${item.count} times, ~${item.calories || 'unknown'} kcal)`
      ).join('\n')}
      
Use this history to understand their taste preferences and suggest meals they might enjoy, while still aligning with their health goals.`;
    }

    const systemPrompt = `You are a Nigerian nutrition expert helping users find healthy meals. 
You specialize in Nigerian cuisine and understand local food options available on food delivery platforms.

Always suggest meals that are:
1. Available at typical Nigerian restaurants
2. Within the user's remaining calorie budget
3. Aligned with their health goals
4. Appropriate for the time of day

For each recommendation, provide:
- A brief nutritional analysis explaining WHY this meal suits their goals
- Estimated macros (protein, carbs, fat in grams)
- A recipe search query for home preparation

Format your response as JSON with this structure:
{
  "recommendations": [
    {
      "name": "Meal name",
      "description": "Brief description",
      "estimatedCalories": 500,
      "category": "restaurant",
      "tags": ["high-protein", "low-carb", etc],
      "analysis": "Why this meal is good for the user's goals - 1-2 sentences",
      "macros": { "protein": 30, "carbs": 40, "fat": 15 },
      "recipeQuery": "how to prepare [meal name] Nigerian recipe"
    }
  ],
  "tip": "A helpful nutrition tip",
  "overallAnalysis": "A 2-3 sentence analysis of the user's current intake status and what they should focus on for the rest of the day"
}`;

    const userPrompt = `I need meal recommendations for ${suggestedMealType}.
- My daily calorie target: ${calorieTarget} kcal
- Calories consumed today: ${caloriesConsumed} kcal
- Remaining calories: ${remainingCalories} kcal
- Health goal: ${healthGoal || "maintain weight"}${orderHistoryContext}

Please suggest 3 Nigerian meals that fit my remaining calorie budget and health goals. Include nutritional analysis for each and a recipe search query.`;

    const result = await chatCompletionWithFallback({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    if (!result.ok) {
      console.error("AI gateway error:", result.status, result.errorText);
      return new Response(JSON.stringify({ error: result.errorText || "AI gateway error" }), {
        status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[ai-meal-recommendation] provider=${result.provider}`);
    const content = result.data.choices?.[0]?.message?.content;

    let parsedContent;
    try {
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
            tags: ["high-protein", "low-carb"],
            analysis: "A balanced meal that fits your calorie budget while providing essential nutrients.",
            macros: { protein: 35, carbs: 15, fat: 10 },
            recipeQuery: "how to prepare grilled fish with vegetables Nigerian recipe"
          }
        ],
        tip: "Try to balance your meals throughout the day for optimal energy.",
        overallAnalysis: "Based on your intake so far, focus on protein-rich meals to meet your daily nutritional needs."
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
