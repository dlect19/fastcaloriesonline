import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chatCompletionWithFallback } from "../_shared/ai-call.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface NutritionEstimate {
  calories: number;
  protein_grams: number;
  carbs_grams: number;
  fats_grams: number;
  fiber_grams: number;
  confidence: 'high' | 'medium' | 'low';
  food_items: string[];
  food_classes: ('carbs' | 'protein' | 'fats' | 'fiber')[];
  nutrient_tags: ('water-rich' | 'vitamin-rich' | 'mineral-rich')[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'Image URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Analyzing food image for calorie estimation:', imageUrl.substring(0, 100) + '...');

    const systemPrompt = `You are a nutrition expert AI that analyzes food images to estimate nutritional content. 
When given a food image, analyze it carefully and provide:
1. Estimated total calories (kcal)
2. Protein content (grams)
3. Carbohydrates (grams)
4. Fats (grams)
5. Fiber (grams)
6. List of detected food items
7. Food classes - classify by dominant macros: 'carbs' (rice, bread, pasta, yam, fufu), 'protein' (meat, fish, eggs, beans), 'fats' (fried foods, oils, nuts), 'fiber' (vegetables, fruits). A food can have multiple classes.
8. Nutrient tags - identify if food is: 'water-rich' (soups, fruits, vegetables with high water), 'vitamin-rich' (fruits, vegetables, liver), 'mineral-rich' (leafy greens, nuts, fish)

Base your estimates on typical serving sizes visible in the image.
If the image is not a food item, return zeros with low confidence.
Be reasonably accurate - these values will be used for dietary tracking.`;

    const userPrompt = `Analyze this food image and estimate its nutritional content. 
Provide your response using the estimate_nutrition function.
Consider portion sizes visible in the image.`;

    const result = await chatCompletionWithFallback({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'estimate_nutrition',
            description: 'Return nutritional estimates for the food image',
            parameters: {
              type: 'object',
              properties: {
                calories: { type: 'number' },
                protein_grams: { type: 'number' },
                carbs_grams: { type: 'number' },
                fats_grams: { type: 'number' },
                fiber_grams: { type: 'number' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                food_items: { type: 'array', items: { type: 'string' } },
                food_classes: { type: 'array', items: { type: 'string', enum: ['carbs', 'protein', 'fats', 'fiber'] } },
                nutrient_tags: { type: 'array', items: { type: 'string', enum: ['water-rich', 'vitamin-rich', 'mineral-rich'] } }
              },
              required: ['calories', 'protein_grams', 'carbs_grams', 'fats_grams', 'fiber_grams', 'confidence', 'food_items', 'food_classes', 'nutrient_tags'],
              additionalProperties: false
            }
          }
        }
      ],
      tool_choice: { type: 'function', function: { name: 'estimate_nutrition' } }
    });

    if (!result.ok) {
      console.error('AI error:', result.status, result.errorText);
      return new Response(
        JSON.stringify({ error: result.errorText || 'AI estimation failed' }),
        { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[estimate-calories-from-image] provider=${result.provider}`);
    const aiResponse = result.data;

    // Extract the tool call result
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'estimate_nutrition') {
      throw new Error('Invalid AI response format');
    }

    const nutritionData: NutritionEstimate = JSON.parse(toolCall.function.arguments);
    
    console.log('Nutrition estimate:', {
      calories: nutritionData.calories,
      protein: nutritionData.protein_grams,
      carbs: nutritionData.carbs_grams,
      fats: nutritionData.fats_grams,
      fiber: nutritionData.fiber_grams,
      confidence: nutritionData.confidence,
      items: nutritionData.food_items,
      food_classes: nutritionData.food_classes,
      nutrient_tags: nutritionData.nutrient_tags
    });

    return new Response(
      JSON.stringify({
        success: true,
        ...nutritionData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error estimating calories:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
