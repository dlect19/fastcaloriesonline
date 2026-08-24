import {
  authenticateAdmin,
  AuditTrail,
  consumeStepUpToken,
  corsHeaders,
  HttpError,
  jsonResponse,
  requestMeta,
  serviceClient,
} from "../_shared/adminGuard.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface CreateStaffRequest {
  email: string;
  password: string;
  fullName: string;
  role: string;
  platform: "vendor" | "admin";
  vendorId?: string;
  vendorName?: string;
  inviterName?: string;
  /** Fresh authenticator (TOTP) verification token - required for admin staff creation. */
  stepUpToken?: string;
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

const ALLOWED_ADMIN_ROLES = new Set(["super_admin", "admin", "support", "analyst"]);
const ALLOWED_VENDOR_ROLES = new Set(["owner", "manager", "cashier", "viewer"]);

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = serviceClient();
  const meta = requestMeta(req);

  try {
    const body: CreateStaffRequest = await req.json();
    const { email, password, fullName, role, platform, vendorId, vendorName, stepUpToken } = body;

    if (!email || !password || !fullName || !role || !platform) {
      throw new HttpError("Missing required fields", 400);
    }
    if (platform !== "vendor" && platform !== "admin") throw new HttpError("Invalid platform", 400);
    if (platform === "vendor" && !vendorId) throw new HttpError("Vendor ID is required for vendor staff", 400);
    if (password.length < 8) throw new HttpError("Password must be at least 8 characters", 400);

    // ---- Authorization: the actor is ALWAYS derived from the JWT, never from the request body ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new HttpError("Unauthorized", 401);
    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !authData?.user) throw new HttpError("Invalid or expired session", 401);
    const actorId = authData.user.id;

    let auditTrail: AuditTrail | null = null;
    let actorLabel = authData.user.email ?? actorId;

    if (platform === "admin") {
      if (!ALLOWED_ADMIN_ROLES.has(role)) throw new HttpError("Invalid admin staff role", 400);

      // Only an ACTIVE super admin may create or modify admin staff, and only with fresh TOTP.
      const caller = await authenticateAdmin(req, supabaseAdmin);
      if (!caller.isSuperAdmin) {
        throw new HttpError("Active super admin access required to manage admin staff", 403);
      }
      actorLabel = caller.email ?? actorId;

      auditTrail = new AuditTrail(supabaseAdmin, caller, meta);
      const entry = {
        action: "admin_staff_create",
        category: "credentials" as const,
        targetType: "admin_staff",
        targetId: null,
        targetLabel: email,
        newValue: { role, email, full_name: fullName },
      };

      try {
        await consumeStepUpToken(supabaseAdmin, caller.id, "staff_create", null, stepUpToken);
      } catch (e) {
        await auditTrail.failure(entry, e instanceof Error ? e.message : "step-up failed");
        throw e;
      }
      await auditTrail.begin(entry);
    } else {
      if (!ALLOWED_VENDOR_ROLES.has(role)) throw new HttpError("Invalid vendor staff role", 400);

      // Vendor staff may only be created by the vendor owner, a vendor manager, or a platform admin.
      const [{ data: vendor }, { data: callerStaff }, { data: callerRoles }] = await Promise.all([
        supabaseAdmin.from("vendors").select("id, user_id, business_name").eq("id", vendorId).maybeSingle(),
        supabaseAdmin
          .from("vendor_staff")
          .select("role, is_active")
          .eq("vendor_id", vendorId)
          .eq("user_id", actorId)
          .eq("is_active", true)
          .maybeSingle(),
        supabaseAdmin.from("user_roles").select("role").eq("user_id", actorId),
      ]);

      if (!vendor) throw new HttpError("Vendor not found", 404);
      // deno-lint-ignore no-explicit-any
      const isPlatformAdmin = !!callerRoles?.some((r: any) => r.role === "admin");
      const isOwner = vendor.user_id === actorId;
      const isManager = callerStaff?.role === "owner" || callerStaff?.role === "manager";
      if (!isOwner && !isManager && !isPlatformAdmin) {
        throw new HttpError("You are not allowed to manage staff for this business", 403);
      }
      // Only the business owner (or a platform admin) may mint another owner-level account.
      if (role === "owner" && !isOwner && !isPlatformAdmin) {
        throw new HttpError("Only the business owner can create another owner account", 403);
      }
    }

    console.log(`Creating ${platform} staff account (actor: ${actorLabel})`);

    // Check if user already exists (paginate — a single listUsers page only covers the newest users)
    const targetEmail = email.trim().toLowerCase();
    // deno-lint-ignore no-explicit-any
    let existingUser: any = null;
    for (let page = 1; page <= 40; page++) {
      const { data: pageData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listErr) throw new HttpError(`Could not look up existing accounts: ${listErr.message}`, 500);
      const users = pageData?.users ?? [];
      // deno-lint-ignore no-explicit-any
      const found = users.find((u: any) => (u.email ?? "").toLowerCase() === targetEmail);
      if (found) { existingUser = found; break; }
      if (users.length < 200) break;
    }


    let userId: string;

    if (existingUser) {
      userId = existingUser.id;

      // Never let this endpoint reset the credentials of a platform admin / protected root account.
      const { data: existingAdminStaff } = await supabaseAdmin
        .from("admin_staff")
        .select("is_protected, role")
        .eq("user_id", userId)
        .maybeSingle();
      if (existingAdminStaff?.is_protected) {
        throw new HttpError("The protected root super admin cannot be modified here", 403);
      }
      if (platform === "vendor" && existingAdminStaff) {
        throw new HttpError("This email belongs to a platform admin account", 403);
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { ...existingUser.user_metadata, full_name: fullName },
      });
      if (updateError) throw new HttpError(`Failed to update user credentials: ${updateError.message}`, 400);
    } else {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createError || !newUser?.user) {
        const msg = createError?.message ?? "unknown";
        if (/already been registered|already exists/i.test(msg)) {
          throw new HttpError(
            "An account already exists for this email. Use the same email in the staff list to update the role, or pick a different email.",
            409,
          );
        }
        throw new HttpError(`Failed to create user account: ${msg}`, 400);
      }

      userId = newUser.user.id;
    }

    if (platform === "vendor") {
      const { data: existingStaff } = await supabaseAdmin
        .from("vendor_staff")
        .select("id")
        .eq("vendor_id", vendorId)
        .eq("user_id", userId)
        .maybeSingle();

      if (existingStaff) {
        const { error: staffError } = await supabaseAdmin
          .from("vendor_staff")
          .update({ role, is_active: true, invite_accepted_at: new Date().toISOString() })
          .eq("id", existingStaff.id);
        if (staffError) throw new HttpError(`Failed to update staff record: ${staffError.message}`, 400);
      } else {
        const { error: staffError } = await supabaseAdmin.from("vendor_staff").insert({
          vendor_id: vendorId,
          user_id: userId,
          role,
          invite_email: email,
          invited_by: actorId,
          is_active: true,
          invite_accepted_at: new Date().toISOString(),
        });
        if (staffError) throw new HttpError(`Failed to create staff record: ${staffError.message}`, 400);
      }
    } else {
      const { data: existingStaff } = await supabaseAdmin
        .from("admin_staff")
        .select("id, is_protected")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingStaff) {
        if (existingStaff.is_protected) {
          throw new HttpError("The protected root super admin cannot be modified here", 403);
        }
        const { error: staffError } = await supabaseAdmin
          .from("admin_staff")
          .update({ role, is_active: true, invite_accepted_at: new Date().toISOString() })
          .eq("id", existingStaff.id);
        if (staffError) throw new HttpError(`Failed to update staff record: ${staffError.message}`, 400);
      } else {
        const { error: staffError } = await supabaseAdmin.from("admin_staff").insert({
          user_id: userId,
          role,
          invite_email: email,
          invited_by: actorId,
          is_active: true,
          invite_accepted_at: new Date().toISOString(),
        });
        if (staffError) throw new HttpError(`Failed to create staff record: ${staffError.message}`, 400);
      }

      // Platform admin app-role for admin staff
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });

      await auditTrail?.success({
        action: "admin_staff_create",
        category: "credentials",
        targetType: "admin_staff",
        targetId: userId,
        targetLabel: email,
        newValue: { role, email, full_name: fullName },
      });
    }

    const baseUrl = req.headers.get("origin") || "https://fastcalories.online";
    const workspaceUrl = platform === "vendor"
      ? `${baseUrl}/vendor/staff-login/${vendorId}`
      : `${baseUrl}/admin/auth`;

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
          html: generateCredentialsEmailHtml(email, password, fullName, role, platform, workspaceUrl, vendorName),
        }),
      });
      if (!emailResponse.ok) {
        console.error("Resend API error status:", emailResponse.status);
      }
    }

    return jsonResponse({ success: true, userId, message: "Staff account created and credentials sent" });
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : 500;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error creating staff account:", errorMessage);
    return jsonResponse({ success: false, error: errorMessage }, status);
  }
};

Deno.serve(handler);
