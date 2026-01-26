import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateStaffRequest {
  email: string;
  password: string;
  fullName: string;
  role: string;
  platform: "vendor" | "admin";
  vendorId?: string;
  vendorName?: string;
  inviterName?: string;
  inviterId: string;
}

const generateCredentialsEmailHtml = (
  email: string,
  password: string,
  fullName: string,
  role: string,
  platform: "vendor" | "admin",
  workspaceUrl: string,
  vendorName?: string
) => {
  const platformName = platform === "vendor" ? "Vendor Portal" : "Admin Portal";
  const teamName = platform === "vendor" && vendorName ? vendorName : "Fast Calories";
  const roleLabel = role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ${teamName} Account - Fast Calories</title>
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
                Welcome to ${teamName}! 🎉
              </h1>
              <p style="color: #71717a; font-size: 16px; line-height: 1.6; margin: 0 0 8px 0; text-align: center;">
                Hi ${fullName},
              </p>
              <p style="color: #71717a; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">
                Your account has been created. Here are your login credentials:
              </p>
              
              <!-- Credentials Box -->
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                <p style="color: #166534; font-size: 14px; margin: 0 0 12px 0;">
                  <strong>Role:</strong> ${roleLabel}
                </p>
                <p style="color: #166534; font-size: 14px; margin: 0 0 12px 0;">
                  <strong>Email:</strong> ${email}
                </p>
                <p style="color: #166534; font-size: 14px; margin: 0;">
                  <strong>Password:</strong> ${password}
                </p>
              </div>
              
              <p style="color: #ef4444; font-size: 13px; text-align: center; margin: 0 0 24px 0;">
                ⚠️ Please change your password after your first login for security.
              </p>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);">
                      Go to Workspace
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 32px 0 0 0; text-align: center;">
                Workspace URL:
              </p>
              <p style="color: #22c55e; font-size: 12px; word-break: break-all; margin: 8px 0 0 0; text-align: center;">
                ${workspaceUrl}
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 32px; border-top: 1px solid #e4e4e7;">
              <p style="color: #a1a1aa; font-size: 12px; margin: 0; text-align: center;">
                This email contains sensitive login information. Please keep it secure and do not share it with others.
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      email,
      password,
      fullName,
      role,
      platform,
      vendorId,
      vendorName,
      inviterName,
      inviterId
    }: CreateStaffRequest = await req.json();

    // Validate required fields
    if (!email || !password || !fullName || !role || !platform || !inviterId) {
      throw new Error("Missing required fields");
    }

    if (platform === "vendor" && !vendorId) {
      throw new Error("Vendor ID is required for vendor staff");
    }

    // Validate password strength
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    console.log(`Creating ${platform} staff account for ${email}`);

    // Create Supabase admin client
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    let userId: string;

    if (existingUser) {
      // User exists, use their ID
      userId = existingUser.id;
      console.log(`User ${email} already exists, linking to staff record`);
    } else {
      // Create new user account
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName
        }
      });

      if (createError) {
        console.error("Error creating user:", createError);
        throw new Error(`Failed to create user account: ${createError.message}`);
      }

      userId = newUser.user.id;
      console.log(`Created new user account for ${email}`);
    }

    // Create staff record based on platform
    if (platform === "vendor") {
      const { error: staffError } = await supabaseAdmin
        .from('vendor_staff')
        .insert({
          vendor_id: vendorId,
          user_id: userId,
          role: role,
          invite_email: email,
          invited_by: inviterId,
          is_active: true,
          invite_accepted_at: new Date().toISOString()
        });

      if (staffError) {
        console.error("Error creating vendor staff record:", staffError);
        throw new Error(`Failed to create staff record: ${staffError.message}`);
      }
    } else {
      const { error: staffError } = await supabaseAdmin
        .from('admin_staff')
        .insert({
          user_id: userId,
          role: role,
          invite_email: email,
          invited_by: inviterId,
          is_active: true,
          invite_accepted_at: new Date().toISOString()
        });

      if (staffError) {
        console.error("Error creating admin staff record:", staffError);
        throw new Error(`Failed to create staff record: ${staffError.message}`);
      }
    }

    // Determine workspace URL
    const baseUrl = req.headers.get('origin') || 'https://fastcalories.online';
    const workspaceUrl = platform === "vendor" 
      ? `${baseUrl}/vendor/auth`
      : `${baseUrl}/admin/auth`;

    // Send credentials email
    if (RESEND_API_KEY) {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Fast Calories <noreply@fastcalories.online>",
          to: [email],
          subject: `Your ${platform === "vendor" && vendorName ? vendorName : "Fast Calories"} Account Credentials`,
          html: generateCredentialsEmailHtml(
            email,
            password,
            fullName,
            role,
            platform,
            workspaceUrl,
            vendorName
          ),
        }),
      });

      const emailData = await emailResponse.json();

      if (!emailResponse.ok) {
        console.error("Resend API error:", emailData);
        // Don't throw, account is created, just log the email error
      } else {
        console.log("Credentials email sent successfully");
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId,
        message: "Staff account created and credentials sent"
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error creating staff account:", errorMessage);
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
