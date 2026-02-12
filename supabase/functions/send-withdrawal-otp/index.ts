import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OTPRequest {
  email: string;
  userName?: string;
  amount: number;
  userType: "vendor" | "rider";
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateEmailHtml(userName: string, otp: string, amount: number, userType: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Withdrawal OTP - Fast Calories</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td align="center" style="padding: 40px 0;">
            <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 32px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Fast Calories</h1>
                  <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Withdrawal Verification</p>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px 32px;">
                  <h2 style="margin: 0 0 16px 0; color: #1a1a1a; font-size: 24px; font-weight: 600;">
                    Withdrawal Verification Code
                  </h2>
                  <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.6;">
                    Hi ${userName || "there"},
                  </p>
                  <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.6;">
                    You've requested a withdrawal of <strong style="color: #22c55e;">₦${amount.toLocaleString()}</strong> from your ${userType} wallet. Use the code below to confirm:
                  </p>
                  
                  <!-- OTP Code Box -->
                  <div style="background: #f8f9fa; border: 2px dashed #22c55e; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                    <p style="margin: 0 0 8px 0; color: #666666; font-size: 14px;">Your verification code:</p>
                    <p style="margin: 0; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #22c55e;">${otp}</p>
                  </div>
                  
                  <p style="margin: 24px 0 0 0; color: #999999; font-size: 14px; line-height: 1.6;">
                    ⏰ This code expires in <strong>10 minutes</strong>.
                  </p>
                  <p style="margin: 16px 0 0 0; color: #999999; font-size: 14px; line-height: 1.6;">
                    🔒 If you didn't request this withdrawal, please ignore this email and secure your account immediately.
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #eeeeee;">
                  <p style="margin: 0; color: #999999; font-size: 12px;">
                    © ${new Date().getFullYear()} Fast Calories. All rights reserved.
                  </p>
                  <p style="margin: 8px 0 0 0; color: #999999; font-size: 12px;">
                    Eat Smart, Live Healthy 🥗
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { email, userName, amount, userType }: OTPRequest = await req.json();

    if (!email || !amount || !userType) {
      throw new Error("Missing required fields: email, amount, userType");
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Invalidate any previous unused OTPs for this email
    await supabase
      .from('withdrawal_otps')
      .update({ used: true })
      .eq('email', email)
      .eq('used', false);

    // Store OTP in database
    const { error: insertError } = await supabase
      .from('withdrawal_otps')
      .insert({
        email,
        otp_code: otp,
        amount,
        user_type: userType,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("Error storing OTP:", insertError);
      throw new Error("Failed to store OTP");
    }

    console.log(`Sending withdrawal OTP to ${email} for ₦${amount}`);

    // Send email using Resend API
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Fast Calories <noreply@fastcalories.online>",
        to: [email],
        subject: `Withdrawal Code: ${otp} - Fast Calories`,
        html: generateEmailHtml(userName || "", otp, amount, userType),
      }),
    });

    const emailResult = await emailResponse.json();
    console.log("Withdrawal OTP sent successfully:", emailResult);

    return new Response(
      JSON.stringify({ success: true, message: "OTP sent successfully" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending withdrawal OTP:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
