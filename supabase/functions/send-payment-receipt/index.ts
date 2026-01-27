import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentReceiptRequest {
  orderId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { orderId }: PaymentReceiptRequest = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "Order ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Generating payment receipt for order: ${orderId}`);

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, vendors(name, address, phone)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.error("Order not found:", orderError);
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get order items
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId);

    // Get customer email from auth
    const { data: userData } = await supabase.auth.admin.getUserById(order.user_id);
    const customerEmail = userData?.user?.email;

    if (!customerEmail) {
      console.error("Customer email not found");
      return new Response(
        JSON.stringify({ error: "Customer email not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get customer profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", order.user_id)
      .maybeSingle();

    const customerName = profile?.full_name || "Customer";
    const vendorName = order.vendors?.name || "Restaurant";

    // Build items HTML
    const itemsHtml = (orderItems || [])
      .map(
        (item: any) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">${item.quantity}x ${item.product_name}</td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">₦${Number(item.total_price).toLocaleString()}</td>
        </tr>
      `
      )
      .join("");

    const receiptHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Payment Receipt - Fast Calories</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #16a34a; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Fast Calories</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Payment Receipt</p>
        </div>
        
        <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin-bottom: 25px; text-align: center;">
            <p style="color: #155724; margin: 0; font-weight: bold; font-size: 18px;">✓ Payment Successful</p>
          </div>

          <p style="color: #333; font-size: 16px;">Hi ${customerName},</p>
          <p style="color: #666; font-size: 14px; line-height: 1.6;">
            Thank you for your order! Your payment has been successfully processed. Here's your receipt:
          </p>

          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #666; padding: 5px 0;">Order Number:</td>
                <td style="text-align: right; font-weight: bold; color: #333;">#${order.order_number}</td>
              </tr>
              <tr>
                <td style="color: #666; padding: 5px 0;">Date:</td>
                <td style="text-align: right; color: #333;">${new Date(order.created_at).toLocaleDateString("en-NG", { dateStyle: "long" })}</td>
              </tr>
              <tr>
                <td style="color: #666; padding: 5px 0;">Restaurant:</td>
                <td style="text-align: right; color: #333;">${vendorName}</td>
              </tr>
              <tr>
                <td style="color: #666; padding: 5px 0;">Payment Reference:</td>
                <td style="text-align: right; color: #333; font-size: 12px;">${order.payment_reference || "N/A"}</td>
              </tr>
            </table>
          </div>

          <h3 style="color: #333; margin: 25px 0 15px 0; font-size: 16px;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; color: #495057;">Item</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6; color: #495057;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div style="margin-top: 25px; padding-top: 20px; border-top: 2px solid #dee2e6;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #666;">Subtotal:</td>
                <td style="text-align: right; color: #333;">₦${Number(order.subtotal).toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;">Delivery Fee:</td>
                <td style="text-align: right; color: #333;">₦${Number(order.delivery_fee || 0).toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;">Service Fee:</td>
                <td style="text-align: right; color: #333;">₦${Number(order.service_fee || 0).toLocaleString()}</td>
              </tr>
              ${order.discount > 0 ? `
              <tr>
                <td style="padding: 8px 0; color: #16a34a;">Discount:</td>
                <td style="text-align: right; color: #16a34a;">-₦${Number(order.discount).toLocaleString()}</td>
              </tr>
              ` : ""}
              <tr style="font-size: 18px; font-weight: bold;">
                <td style="padding: 15px 0 0 0; color: #333; border-top: 2px solid #333;">Total Paid:</td>
                <td style="text-align: right; color: #16a34a; padding: 15px 0 0 0; border-top: 2px solid #333;">₦${Number(order.total).toLocaleString()}</td>
              </tr>
            </table>
          </div>

          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-top: 25px;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #333;">Delivery Address:</p>
            <p style="margin: 0; color: #666;">${order.delivery_address_text}</p>
          </div>

          <p style="color: #888; font-size: 12px; margin-top: 30px; text-align: center;">
            This is an automated receipt from Fast Calories. Please keep it for your records.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; color: #888; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Fast Calories. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    // Send email
    const { error: emailError } = await resend.emails.send({
      from: "Fast Calories <noreply@fastcalories.online>",
      to: [customerEmail],
      subject: `Payment Receipt - Order #${order.order_number}`,
      html: receiptHtml,
    });

    if (emailError) {
      console.error("Failed to send receipt email:", emailError);
      return new Response(
        JSON.stringify({ error: "Failed to send receipt email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Payment receipt sent to ${customerEmail}`);

    return new Response(
      JSON.stringify({ success: true, message: "Receipt sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error sending payment receipt:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
