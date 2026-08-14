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

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (!roles?.some((r: any) => r.role === "admin")) {
      throw new Error("Admin access required");
    }

    const { prompt, campaign_type, vendor_name, vendor_logo_url, platform_logo_base64, menu_items, format, custom_width, custom_height } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Format dimensions
    const FORMAT_SIZES: Record<string, { w: number; h: number; label: string }> = {
      facebook_post: { w: 1200, h: 630, label: "Facebook Post (1200×630)" },
      facebook_story: { w: 1080, h: 1920, label: "Facebook Story (1080×1920)" },
      instagram_post: { w: 1080, h: 1080, label: "Instagram Post (1080×1080)" },
      instagram_story: { w: 1080, h: 1920, label: "Instagram Story (1080×1920)" },
      tiktok: { w: 1080, h: 1920, label: "TikTok (1080×1920)" },
      x_post: { w: 1200, h: 675, label: "X/Twitter Post (1200×675)" },
      whatsapp_status: { w: 1080, h: 1920, label: "WhatsApp Status (1080×1920)" },
      youtube_thumbnail: { w: 1280, h: 720, label: "YouTube Thumbnail (1280×720)" },
      app_carousel: { w: 1200, h: 600, label: "App Carousel (1200×600)" },
    };

    let selectedFormat = FORMAT_SIZES[format] || FORMAT_SIZES.app_carousel;

    if (format === "custom") {
      const w = Math.round(Number(custom_width));
      const h = Math.round(Number(custom_height));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 256 || h < 256 || w > 4096 || h > 4096) {
        return new Response(
          JSON.stringify({ error: "Custom size must be between 256 and 4096 pixels for width and height." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      selectedFormat = { w, h, label: `Custom (${w}×${h})` };
    }

    // Build prompt
    let imagePrompt = "";

    if (campaign_type === "vendor_promo" && vendor_name) {
      imagePrompt = `Create a vibrant, professional food delivery promotional banner image for "${vendor_name}" restaurant. ${prompt || ""}. `;
      if (menu_items && menu_items.length > 0) {
        imagePrompt += `Feature these menu items prominently: ${menu_items.join(", ")}. `;
      }
      imagePrompt += `Include the "Fast Calories" brand name/logo subtly in the design. The image MUST incorporate and prominently display the vendor's logo provided. `;
      imagePrompt += `Modern food photography style, appetizing colors, clean layout. Dimensions: ${selectedFormat.w}x${selectedFormat.h} pixels for ${selectedFormat.label}. High quality marketing material.`;
    } else if (campaign_type === "platform_branding") {
      imagePrompt = `Create a professional marketing banner for "Fast Calories" food delivery app. ${prompt || "Show the app's convenience and speed"}. The "Fast Calories" brand logo provided MUST be prominently displayed in the design. Modern, clean design with appetizing food imagery. Dimensions: ${selectedFormat.w}x${selectedFormat.h} pixels for ${selectedFormat.label}. High quality digital marketing material.`;
    } else if (campaign_type === "seasonal") {
      imagePrompt = `Create a festive promotional banner for "Fast Calories" food delivery app. ${prompt || "Seasonal celebration theme"}. Include the "Fast Calories" brand logo provided prominently. Appetizing food imagery with seasonal/holiday decorations. Dimensions: ${selectedFormat.w}x${selectedFormat.h} pixels for ${selectedFormat.label}. High quality.`;
    } else {
      imagePrompt = `Create a professional food delivery promotional banner. ${prompt || "Fast Calories delivery service promotion"}. Include the "Fast Calories" branding/logo provided. Modern design, appetizing food imagery. Dimensions: ${selectedFormat.w}x${selectedFormat.h} pixels for ${selectedFormat.label}. High quality marketing material.`;
    }

    console.log("Generating image with prompt:", imagePrompt, "format:", format);

    // Build multimodal content with logos
    const contentParts: any[] = [{ type: "text", text: imagePrompt }];

    // Add Fast Calories logo
    if (platform_logo_base64) {
      contentParts.push({
        type: "image_url",
        image_url: { url: platform_logo_base64 },
      });
      contentParts.push({
        type: "text",
        text: "Above is the Fast Calories brand logo. Incorporate it into the banner design.",
      });
    }

    // Add vendor logo
    if (vendor_logo_url) {
      contentParts.push({
        type: "image_url",
        image_url: { url: vendor_logo_url },
      });
      contentParts.push({
        type: "text",
        text: `Above is the ${vendor_name || "vendor"} logo. Include it prominently in the banner.`,
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait and try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please top up in workspace settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageData) {
      throw new Error("No image was generated. Try a different prompt.");
    }

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const fileName = `campaign_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
    const storagePath = `campaigns/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("campaign-images")
      .upload(storagePath, imageBytes, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error("Failed to save generated image");
    }

    const { data: publicUrlData } = supabase.storage
      .from("campaign-images")
      .getPublicUrl(storagePath);

    return new Response(
      JSON.stringify({
        image_url: publicUrlData.publicUrl,
        storage_path: storagePath,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Campaign image generation error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
