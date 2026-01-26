import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerificationEmailRequest {
  email: string;
  verificationUrl: string;
  userName?: string;
  platform: "customer" | "vendor";
}

const generateEmailHtml = (
  userName: string,
  verificationUrl: string,
  platform: "customer" | "vendor"
) => {
  const platformName = platform === "vendor" ? "Vendor Portal" : "App";
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email - Fast Calories</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 32px; text-align: center;">
              <div style="display: inline-flex; align-items: center; gap: 12px;">
                <div style="width: 48px; height: 48px; background-color: rgba(255,255,255,0.2); border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                  <span style="font-size: 24px;">🍃</span>
                </div>
                <span style="color: #ffffff; font-size: 24px; font-weight: 700;">Fast Calories</span>
              </div>
              <p style="color: rgba(255,255,255,0.9); margin: 12px 0 0 0; font-size: 14px;">${platformName}</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 32px;">
              <h1 style="color: #18181b; font-size: 24px; font-weight: 700; margin: 0 0 16px 0; text-align: center;">
                Verify your email address
              </h1>
              <p style="color: #71717a; font-size: 16px; line-height: 1.6; margin: 0 0 8px 0; text-align: center;">
                Hi ${userName || "there"},
              </p>
              <p style="color: #71717a; font-size: 16px; line-height: 1.6; margin: 0 0 32px 0; text-align: center;">
                Thanks for signing up! Please click the button below to verify your email address and activate your account.
              </p>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${verificationUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 32px 0 0 0; text-align: center;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="color: #22c55e; font-size: 12px; word-break: break-all; margin: 8px 0 0 0; text-align: center;">
                ${verificationUrl}
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 32px; border-top: 1px solid #e4e4e7;">
              <p style="color: #a1a1aa; font-size: 12px; margin: 0; text-align: center;">
                This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
              </p>
              <p style="color: #a1a1aa; font-size: 12px; margin: 16px 0 0 0; text-align: center;">
                © ${new Date().getFullYear()} Fast Calories. Health-aware food delivery.
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
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, verificationUrl, userName, platform }: VerificationEmailRequest = await req.json();

    // Validate required fields
    if (!email || !verificationUrl) {
      throw new Error("Missing required fields: email and verificationUrl");
    }

    console.log(`Sending verification email to ${email} for ${platform} platform`);

    // Use fetch to call Resend API directly
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Fast Calories <noreply@fastcalories.online>",
        to: [email],
        subject: "Verify your email - Fast Calories",
        html: generateEmailHtml(userName || "", verificationUrl, platform || "customer"),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Resend API error:", data);
      throw new Error(data.message || "Failed to send email");
    }

    console.log("Verification email sent successfully:", data);

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error sending verification email:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
