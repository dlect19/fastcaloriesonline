import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    // Get all working hours for today
    const { data: allHours, error: hoursError } = await supabase
      .from("vendor_working_hours")
      .select("vendor_id, outlet_id, open_time, close_time, is_closed")
      .eq("day_of_week", dayOfWeek);

    if (hoursError) throw hoursError;
    if (!allHours || allHours.length === 0) {
      return new Response(JSON.stringify({ message: "No working hours found for today", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by vendor_id to update vendors table
    const vendorUpdates: Record<string, boolean> = {};
    // Track outlet-level updates too
    const outletUpdates: Record<string, boolean> = {};

    for (const hours of allHours) {
      const openTime = hours.open_time.length === 5 ? hours.open_time + ":00" : hours.open_time;
      const closeTime = hours.close_time.length === 5 ? hours.close_time + ":00" : hours.close_time;
      const shouldBeOpen = !hours.is_closed && currentTime >= openTime && currentTime < closeTime;

      if (hours.outlet_id) {
        outletUpdates[hours.outlet_id] = shouldBeOpen;
      } else {
        vendorUpdates[hours.vendor_id] = shouldBeOpen;
      }
    }

    let updatedCount = 0;

    // Batch update vendors
    for (const [vendorId, shouldBeOpen] of Object.entries(vendorUpdates)) {
      const { error } = await supabase
        .from("vendors")
        .update({ is_open: shouldBeOpen })
        .eq("id", vendorId)
        .neq("is_open", shouldBeOpen);
      if (!error) updatedCount++;
    }

    // Batch update outlets
    for (const [outletId, shouldBeOpen] of Object.entries(outletUpdates)) {
      const { error } = await supabase
        .from("vendor_outlets")
        .update({ is_open: shouldBeOpen })
        .eq("id", outletId)
        .neq("is_open", shouldBeOpen);
      if (!error) updatedCount++;
    }

    return new Response(
      JSON.stringify({ message: "Auto store status check complete", updated: updatedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
