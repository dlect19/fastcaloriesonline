// Shared helper: send voucher purchase confirmation via Resend and log every attempt.
// deno-lint-ignore no-explicit-any
type Sb = any;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("VOUCHER_EMAIL_FROM") || "FastCalories Vouchers <notify@notify.fastcalories.online>";
const REPLY_TO = Deno.env.get("VOUCHER_EMAIL_REPLY_TO") || "support@fastcalories.online";

function money(n: number) {
  try { return `₦${Number(n).toLocaleString("en-NG")}`; } catch { return `₦${n}`; }
}
function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface VoucherEmailInput {
  recipientEmail: string;
  recipientName?: string | null;
  code: string;
  amount: number;
  categoryName?: string | null;
  vendorName?: string | null;
  vendorLogoUrl?: string | null;
  bgColor?: string | null;
  bgImageUrl?: string | null;
  purchasedAt: Date | string;
  expiryDate: Date | string;
  orderId: string;
}

function renderHtml(v: VoucherEmailInput): string {
  const purchased = new Date(v.purchasedAt);
  const expiry = new Date(v.expiryDate);
  const bg = v.bgImageUrl
    ? `background-image:url('${esc(v.bgImageUrl)}');background-size:cover;background-position:center;`
    : `background:linear-gradient(135deg, ${esc(v.bgColor || "#0f766e")} 0%, #0f172a 100%);`;
  const logo = v.vendorLogoUrl
    ? `<img src="${esc(v.vendorLogoUrl)}" alt="${esc(v.vendorName || "")}" style="max-height:56px;max-width:140px;border-radius:12px;background:#fff;padding:6px" />`
    : `<div style="font-size:20px;font-weight:700;color:#fff">${esc(v.vendorName || "Voucher")}</div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Your Voucher</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <p style="font-size:14px;color:#52525b">Hi ${esc(v.recipientName || "there")},</p>
    <p style="font-size:15px;line-height:1.5;color:#27272a">
      Thank you for your purchase. Your ${esc(v.categoryName || "")} voucher is ready.
    </p>
    <div style="border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.15);margin:20px 0">
      <div style="${bg}padding:28px 24px;color:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
          ${logo}
          <div style="text-align:right;font-size:12px;opacity:.9">
            <div style="text-transform:uppercase;letter-spacing:1px;font-weight:600">Voucher</div>
            <div>${esc(v.categoryName || "")}</div>
          </div>
        </div>
        <div style="font-size:13px;opacity:.85;text-transform:uppercase;letter-spacing:1.5px">Redemption code</div>
        <div style="font-family:'Courier New',monospace;font-size:30px;font-weight:800;letter-spacing:4px;margin:6px 0 18px;background:rgba(0,0,0,0.28);padding:14px 16px;border-radius:12px;text-align:center">
          ${esc(v.code)}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;opacity:.95">
          <div>
            <div style="opacity:.7">Value</div>
            <div style="font-weight:700;font-size:16px">${money(v.amount)}</div>
          </div>
          <div style="text-align:right">
            <div style="opacity:.7">Expires</div>
            <div style="font-weight:700;font-size:16px">${expiry.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</div>
          </div>
        </div>
      </div>
      <div style="background:#fff;padding:16px 20px;font-size:12px;color:#71717a">
        Purchased ${purchased.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })} · Order #${esc(v.orderId.slice(0, 8))}
      </div>
    </div>
    <p style="font-size:13px;color:#52525b;line-height:1.5">
      Present this code at ${esc(v.vendorName || "the vendor")} to redeem. Keep this email — the code is required at checkout.
    </p>
    <p style="font-size:12px;color:#a1a1aa;margin-top:24px">
      Sent by FastCalories · Reply to this email if you need help.
    </p>
  </div>
</body></html>`;
}

async function logEmail(admin: Sb, row: Record<string, unknown>) {
  try { await admin.from("email_send_log").insert(row); } catch (e) { console.error("email_send_log insert failed:", e); }
}

export async function sendVoucherEmail(admin: Sb, input: VoucherEmailInput): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const template = "voucher-purchase-confirmation";
  const meta = { order_id: input.orderId, vendor: input.vendorName, category: input.categoryName, amount: input.amount };

  if (!RESEND_API_KEY) {
    const err = "RESEND_API_KEY not configured";
    console.error(err);
    await logEmail(admin, { template_name: template, recipient_email: input.recipientEmail, status: "failed", provider: "resend", error_message: err, metadata: meta });
    return { ok: false, error: err };
  }
  if (!input.recipientEmail) {
    await logEmail(admin, { template_name: template, recipient_email: "", status: "failed", provider: "resend", error_message: "missing recipient", metadata: meta });
    return { ok: false, error: "missing recipient email" };
  }

  const html = renderHtml(input);
  const subject = `Your ${input.categoryName || "voucher"} · Code ${input.code}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SENDER_EMAIL,
        to: [input.recipientEmail],
        reply_to: REPLY_TO,
        subject,
        html,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = `resend ${res.status}: ${body?.message || JSON.stringify(body)}`;
      console.error("Voucher email failed:", errMsg);
      await logEmail(admin, { template_name: template, recipient_email: input.recipientEmail, status: "failed", provider: "resend", error_message: errMsg, metadata: meta });
      return { ok: false, error: errMsg };
    }
    const messageId = body?.id as string | undefined;
    await logEmail(admin, { template_name: template, recipient_email: input.recipientEmail, status: "sent", provider: "resend", message_id: messageId, metadata: meta });
    console.log(`Voucher email sent ok id=${messageId} order=${input.orderId}`);
    return { ok: true, messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Voucher email exception:", msg);
    await logEmail(admin, { template_name: template, recipient_email: input.recipientEmail, status: "failed", provider: "resend", error_message: msg, metadata: meta });
    return { ok: false, error: msg };
  }
}

// Fetch vendor + template info and dispatch. Never throws — logs and returns.
export async function sendVoucherEmailForOrder(admin: Sb, orderId: string, recipientEmail: string, recipientName: string | null): Promise<void> {
  try {
    const { data: order } = await admin
      .from("voucher_orders")
      .select("id, amount, purchased_at, expiry_date, code_id, category_id, vendor_id, guest_email, guest_name")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) { console.error("sendVoucherEmailForOrder: order not found", orderId); return; }
    const [{ data: code }, { data: category }, { data: vendor }, { data: template }] = await Promise.all([
      admin.from("voucher_codes").select("code").eq("id", order.code_id).maybeSingle(),
      admin.from("voucher_categories").select("name").eq("id", order.category_id).maybeSingle(),
      admin.from("vendors").select("name, logo_url").eq("id", order.vendor_id).maybeSingle(),
      admin.from("vendor_templates").select("logo_url, background_color, background_image_url").eq("vendor_id", order.vendor_id).maybeSingle(),
    ]);
    await sendVoucherEmail(admin, {
      recipientEmail,
      recipientName: recipientName || order.guest_name || null,
      code: code?.code || "",
      amount: Number(order.amount || 0),
      categoryName: category?.name || null,
      vendorName: vendor?.name || null,
      vendorLogoUrl: template?.logo_url || vendor?.logo_url || null,
      bgColor: template?.background_color || null,
      bgImageUrl: template?.background_image_url || null,
      purchasedAt: order.purchased_at,
      expiryDate: order.expiry_date,
      orderId: order.id,
    });
  } catch (e) {
    console.error("sendVoucherEmailForOrder failed:", e);
  }
}
