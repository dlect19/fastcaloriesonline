// Token-authenticated wallet API for event organizers.
// Actions: balance | save_bank | request_otp | withdraw
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const { token, action } = body;
    if (!token || typeof token !== "string") return json({ error: "Missing token" }, 401);

    // Resolve organizer from event token
    const { data: ev } = await supabase
      .from("events").select("id, organizer_id").eq("organizer_access_token", token).maybeSingle();
    if (!ev?.organizer_id) return json({ error: "Invalid organizer link" }, 404);
    const organizerId = ev.organizer_id as string;

    const { data: organizer } = await supabase
      .from("event_organizers")
      .select("id, name, contact_email, contact_phone, bank_name, bank_account_number, bank_account_name, paystack_recipient_code, payout_period_hours")
      .eq("id", organizerId).maybeSingle();
    if (!organizer) return json({ error: "Organizer not found" }, 404);

    // Ensure wallet exists
    const { data: walletIdRes } = await supabase.rpc("ensure_event_organizer_wallet", { _organizer_id: organizerId });
    const walletId = walletIdRes as string;

    // Run maturity release + reconcile (cheap, idempotent)
    await supabase.rpc("release_event_organizer_matured_holds");
    await supabase.rpc("reconcile_event_organizer_wallet", { _wallet_id: walletId });

    const { data: wallet } = await supabase
      .from("wallets")
      .select("id, balance, pending_balance, eligible_balance, total_earned, total_withdrawn")
      .eq("id", walletId).maybeSingle();

    if (action === "balance" || !action) {
      const { data: txs } = await supabase
        .from("wallet_transactions")
        .select("id, amount, type, status, description, created_at")
        .eq("wallet_id", walletId)
        .order("created_at", { ascending: false })
        .limit(50);
      const { data: payouts } = await supabase
        .from("payout_requests")
        .select("id, amount, status, bank_name, bank_account_number, created_at, processed_at, failure_reason")
        .eq("wallet_id", walletId)
        .order("created_at", { ascending: false })
        .limit(20);
      const { data: minSetting } = await supabase
        .from("platform_settings").select("value").eq("key", "event_organizer_minimum_payout").maybeSingle();
      const { data: holdSetting } = await supabase
        .from("platform_settings").select("value").eq("key", "event_organizer_payout_period_hours").maybeSingle();
      return json({
        organizer: { name: organizer.name, email: organizer.contact_email, phone: organizer.contact_phone,
          bank_name: organizer.bank_name, bank_account_number: organizer.bank_account_number, bank_account_name: organizer.bank_account_name,
          payout_period_hours: organizer.payout_period_hours ?? Number(holdSetting?.value ?? 48) },
        wallet, transactions: txs || [], payouts: payouts || [],
        minimum_payout: Number(minSetting?.value ?? 1000),
      });
    }

    if (action === "save_bank") {
      const { bank_name, bank_code, account_number, account_name, recipient_code } = body;
      if (!bank_name || !account_number || !account_name) return json({ error: "Missing bank fields" }, 400);
      await supabase.from("event_organizers").update({
        bank_name, bank_account_number: account_number, bank_account_name: account_name,
        paystack_recipient_code: recipient_code || null,
      }).eq("id", organizerId);
      await supabase.from("wallets").update({
        bank_name, bank_account_number: account_number, bank_account_name: account_name,
        paystack_recipient_code: recipient_code || null,
      }).eq("id", walletId);
      return json({ ok: true });
    }

    if (action === "request_otp") {
      const { amount } = body;
      const amt = Number(amount || 0);
      if (!amt || amt <= 0) return json({ error: "Invalid amount" }, 400);
      const eligible = Number(wallet?.eligible_balance || 0);
      if (amt > eligible) return json({ error: `Amount exceeds eligible balance (₦${eligible.toLocaleString()})` }, 400);
      const email = organizer.contact_email;
      if (!email) return json({ error: "Organizer has no contact email on file" }, 400);

      // Generate 6-digit OTP, store in withdrawal_otps
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase.from("withdrawal_otps").insert({
        email, otp_code: otp, amount: amt, expires_at: expiresAt,
      });
      // Reuse send-withdrawal-otp function for branded email
      try {
        await supabase.functions.invoke("send-withdrawal-otp", { body: { email, otp, amount: amt, recipientName: organizer.name } });
      } catch (e) {
        console.error("send-withdrawal-otp failed", e);
      }
      return json({ ok: true, message: `OTP sent to ${email}` });
    }

    if (action === "withdraw") {
      const { amount, otp } = body;
      const amt = Number(amount || 0);
      if (!amt || amt <= 0) return json({ error: "Invalid amount" }, 400);
      if (!otp || !/^\d{6}$/.test(otp)) return json({ error: "Invalid OTP" }, 400);
      if (!organizer.bank_account_number) return json({ error: "Add a bank account first" }, 400);

      const { data: minSetting } = await supabase
        .from("platform_settings").select("value").eq("key", "event_organizer_minimum_payout").maybeSingle();
      const minPayout = Number(minSetting?.value ?? 1000);
      if (amt < minPayout) return json({ error: `Minimum withdrawal is ₦${minPayout.toLocaleString()}` }, 400);

      const eligible = Number(wallet?.eligible_balance || 0);
      if (amt > eligible) return json({ error: `Amount exceeds eligible balance (₦${eligible.toLocaleString()})` }, 400);

      // Verify OTP via existing function
      const { data: vr } = await supabase.functions.invoke("verify-withdrawal-otp", {
        body: { email: organizer.contact_email, otp, expectedAmount: amt },
      });
      if (!vr?.valid) return json({ error: vr?.error || "OTP verification failed" }, 400);

      // Get environment
      const { data: envRow } = await supabase
        .from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
      const environment = (envRow?.value as string) || "development";

      // Create payout request (admin queues / auto-processes downstream)
      const { data: pr, error: prErr } = await supabase.from("payout_requests").insert({
        wallet_id: walletId,
        user_id: null,
        user_type: "event_organizer",
        amount: amt,
        status: "pending",
        bank_name: organizer.bank_name,
        bank_account_number: organizer.bank_account_number,
        bank_account_name: organizer.bank_account_name,
        environment,
      }).select("id").single();
      if (prErr) return json({ error: prErr.message }, 500);

      // Ledger debit (pending until processed)
      await supabase.from("wallet_transactions").insert({
        wallet_id: walletId,
        amount: -amt,
        type: "withdrawal",
        status: "pending",
        description: `Withdrawal request ${pr.id}`,
        reference_id: pr.id,
        environment,
      });
      await supabase.rpc("reconcile_event_organizer_wallet", { _wallet_id: walletId });

      return json({ ok: true, payout_request_id: pr.id });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("organizer-wallet error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
