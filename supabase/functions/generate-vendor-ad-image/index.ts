import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    // Get vendor
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name, logo_url")
      .eq("user_id", user.id)
      .single();
    if (!vendor) throw new Error("Vendor account not found");

    const { prompt, format, menu_items } = await req.json();

    // Get AI ad image price
    const { data: priceSetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "ai_ad_image_price")
      .single();
    const aiPrice = Number(priceSetting?.value || 500);

    // Get ad wallet
    const { data: adWallet } = await supabase
      .from("ad_wallets")
      .select("id, balance, total_spent")
      .eq("vendor_id", vendor.id)
      .single();

    if (!adWallet || adWallet.balance < aiPrice) {
      return new Response(
        JSON.stringify({ error: `Insufficient ad wallet balance. AI image generation costs ₦${aiPrice}. Current balance: ₦${adWallet?.balance || 0}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI service not configured");

    // Format dimensions
    const FORMAT_SIZES: Record<string, { w: number; h: number; label: string }> = {
      carousel: { w: 1200, h: 400, label: "App Carousel (1200×400)" },
      announcement: { w: 1080, h: 1080, label: "Announcement (1080×1080)" },
      facebook_post: { w: 1200, h: 630, label: "Facebook Post (1200×630)" },
      instagram_post: { w: 1080, h: 1080, label: "Instagram Post (1080×1080)" },
      instagram_story: { w: 1080, h: 1920, label: "Instagram Story (1080×1920)" },
    };

    const selectedFormat = FORMAT_SIZES[format] || FORMAT_SIZES.carousel;

    // Build prompt
    let imagePrompt = `Create a vibrant, professional food delivery promotional banner image for "${vendor.name}" restaurant. ${prompt || "Show delicious food and the restaurant brand"}. `;
    if (menu_items && menu_items.length > 0) {
      imagePrompt += `Feature these menu items prominently: ${menu_items.join(", ")}. `;
    }
    imagePrompt += `Include the "Fast Calories" brand name subtly in the design. `;
    imagePrompt += `Modern food photography style, appetizing colors, clean layout. Dimensions: ${selectedFormat.w}x${selectedFormat.h} pixels for ${selectedFormat.label}. High quality marketing material.`;

    // Build multimodal content
    const contentParts: any[] = [{ type: "text", text: imagePrompt }];

    // Get Fast Calories platform logo
    const { data: logoSetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_logo_url")
      .single();

    if (logoSetting?.value) {
      contentParts.push({
        type: "image_url",
        image_url: { url: logoSetting.value },
      });
      contentParts.push({
        type: "text",
        text: "Above is the Fast Calories brand logo. Incorporate it subtly into the banner design.",
      });
    }

    // Add vendor logo
    if (vendor.logo_url) {
      contentParts.push({
        type: "image_url",
        image_url: { url: vendor.logo_url },
      });
      contentParts.push({
        type: "text",
        text: `Above is the ${vendor.name} logo. Include it prominently in the banner.`,
      });
    }

    console.log("Generating vendor ad image, format:", format, "vendor:", vendor.name);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: contentParts }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait and try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI generation failed: ${response.status}`);
    }

    const data = await response.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageData) throw new Error("No image was generated. Try a different prompt.");

    // Upload to storage
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const fileName = `vendor_ad_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
    const storagePath = `vendor-ads/${vendor.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("campaign-images")
      .upload(storagePath, imageBytes, { contentType: "image/png", upsert: false });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error("Failed to save generated image");
    }

    const { data: publicUrlData } = supabase.storage
      .from("campaign-images")
      .getPublicUrl(storagePath);

    // Deduct from ad wallet
    const newBalance = adWallet.balance - aiPrice;
    await supabase.from("ad_wallets").update({
      balance: newBalance,
      total_spent: (adWallet as any).total_spent + aiPrice,
      updated_at: new Date().toISOString(),
    }).eq("id", adWallet.id);

    await supabase.from("ad_wallet_transactions").insert({
      ad_wallet_id: adWallet.id,
      vendor_id: vendor.id,
      transaction_type: "debit",
      category: "ai_image_generation",
      amount: aiPrice,
      balance_after: newBalance,
      notes: `AI ad image generation (${selectedFormat.label})`,
    });

    return new Response(
      JSON.stringify({ image_url: publicUrlData.publicUrl, storage_path: storagePath, cost: aiPrice }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Vendor ad image generation error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
