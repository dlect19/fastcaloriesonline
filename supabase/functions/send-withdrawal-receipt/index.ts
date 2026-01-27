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

interface WithdrawalReceiptRequest {
  payoutRequestId: string;
  status: "processing" | "success" | "failed";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { payoutRequestId, status }: WithdrawalReceiptRequest = await req.json();

    if (!payoutRequestId) {
      return new Response(
        JSON.stringify({ error: "Payout request ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Generating withdrawal receipt for payout: ${payoutRequestId}`);

    // Get payout request details
    const { data: payoutRequest, error: payoutError } = await supabase
      .from("payout_requests")
      .select("*")
      .eq("id", payoutRequestId)
      .single();

    if (payoutError || !payoutRequest) {
      console.error("Payout request not found:", payoutError);
      return new Response(
        JSON.stringify({ error: "Payout request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user email from auth
    const { data: userData } = await supabase.auth.admin.getUserById(payoutRequest.user_id);
    const userEmail = userData?.user?.email;

    if (!userEmail) {
      console.error("User email not found");
      return new Response(
        JSON.stringify({ error: "User email not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", payoutRequest.user_id)
      .maybeSingle();

    const userName = profile?.full_name || (payoutRequest.user_type === "vendor" ? "Vendor" : "Rider");
    const userType = payoutRequest.user_type === "vendor" ? "Vendor" : "Rider";

    const statusConfig = {
      processing: {
        color: "#f59e0b",
        bgColor: "#fef3c7",
        borderColor: "#fcd34d",
        icon: "⏳",
        title: "Withdrawal Processing",
        message: "Your withdrawal is being processed and will be credited to your bank account shortly.",
      },
      success: {
        color: "#16a34a",
        bgColor: "#d4edda",
        borderColor: "#c3e6cb",
        icon: "✓",
        title: "Withdrawal Successful",
        message: "Your withdrawal has been successfully processed and credited to your bank account.",
      },
      failed: {
        color: "#dc2626",
        bgColor: "#fee2e2",
        borderColor: "#fecaca",
        icon: "✗",
        title: "Withdrawal Failed",
        message: `Your withdrawal could not be processed. Reason: ${payoutRequest.failure_reason || "Unknown error"}. Please try again or contact support.`,
      },
    };

    const statusInfo = statusConfig[status];

    const receiptHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Withdrawal Receipt - Fast Calories</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #16a34a; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Fast Calories</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">${userType} Withdrawal Receipt</p>
        </div>
        
        <div style="background-color: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="background-color: ${statusInfo.bgColor}; border: 1px solid ${statusInfo.borderColor}; padding: 15px; border-radius: 6px; margin-bottom: 25px; text-align: center;">
            <p style="color: ${statusInfo.color}; margin: 0; font-weight: bold; font-size: 18px;">${statusInfo.icon} ${statusInfo.title}</p>
          </div>

          <p style="color: #333; font-size: 16px;">Hi ${userName},</p>
          <p style="color: #666; font-size: 14px; line-height: 1.6;">
            ${statusInfo.message}
          </p>

          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #666; padding: 8px 0;">Reference:</td>
                <td style="text-align: right; font-weight: bold; color: #333; font-size: 12px;">${payoutRequest.paystack_reference || "N/A"}</td>
              </tr>
              <tr>
                <td style="color: #666; padding: 8px 0;">Date:</td>
                <td style="text-align: right; color: #333;">${new Date(payoutRequest.created_at).toLocaleDateString("en-NG", { dateStyle: "long" })}</td>
              </tr>
              <tr>
                <td style="color: #666; padding: 8px 0;">Time:</td>
                <td style="text-align: right; color: #333;">${new Date(payoutRequest.created_at).toLocaleTimeString("en-NG", { timeStyle: "short" })}</td>
              </tr>
            </table>
          </div>

          <h3 style="color: #333; margin: 25px 0 15px 0; font-size: 16px;">Withdrawal Details</h3>
          <div style="border: 1px solid #dee2e6; border-radius: 6px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 15px; background-color: #f8f9fa; color: #666; border-bottom: 1px solid #dee2e6;">Amount Withdrawn:</td>
                <td style="padding: 15px; text-align: right; font-weight: bold; color: #16a34a; font-size: 20px; border-bottom: 1px solid #dee2e6;">₦${Number(payoutRequest.amount).toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 15px; color: #666; border-bottom: 1px solid #dee2e6;">Bank:</td>
                <td style="padding: 15px; text-align: right; color: #333; border-bottom: 1px solid #dee2e6;">${payoutRequest.bank_name || "N/A"}</td>
              </tr>
              <tr>
                <td style="padding: 15px; color: #666; border-bottom: 1px solid #dee2e6;">Account Number:</td>
                <td style="padding: 15px; text-align: right; color: #333; border-bottom: 1px solid #dee2e6;">${payoutRequest.bank_account_number ? "****" + payoutRequest.bank_account_number.slice(-4) : "N/A"}</td>
              </tr>
              <tr>
                <td style="padding: 15px; color: #666;">Account Name:</td>
                <td style="padding: 15px; text-align: right; color: #333;">${payoutRequest.bank_account_name || "N/A"}</td>
              </tr>
            </table>
          </div>

          <div style="background-color: ${status === "success" ? "#d4edda" : "#f8f9fa"}; padding: 20px; border-radius: 6px; margin-top: 25px; text-align: center;">
            <p style="margin: 0; font-weight: bold; color: ${status === "success" ? "#155724" : "#333"};">
              Status: ${status.charAt(0).toUpperCase() + status.slice(1)}
            </p>
            ${payoutRequest.processed_at ? `<p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">Processed at: ${new Date(payoutRequest.processed_at).toLocaleString("en-NG")}</p>` : ""}
          </div>

          <p style="color: #888; font-size: 12px; margin-top: 30px; text-align: center;">
            This is an automated receipt from Fast Calories. Please keep it for your records.
            If you have any questions, please contact our support team.
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
      to: [userEmail],
      subject: `Withdrawal ${status === "success" ? "Successful" : status === "failed" ? "Failed" : "Processing"} - ₦${Number(payoutRequest.amount).toLocaleString()}`,
      html: receiptHtml,
    });

    if (emailError) {
      console.error("Failed to send withdrawal receipt:", emailError);
      return new Response(
        JSON.stringify({ error: "Failed to send withdrawal receipt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Withdrawal receipt sent to ${userEmail}`);

    return new Response(
      JSON.stringify({ success: true, message: "Receipt sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error sending withdrawal receipt:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
