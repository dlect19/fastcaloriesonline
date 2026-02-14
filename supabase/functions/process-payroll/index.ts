import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PayrollItemInput {
  payroll_employee_id: string;
  employee_name: string;
  base_salary: number;
  bonus: number;
  bonus_note: string;
  deductions: number;
  deduction_note: string;
  net_pay: number;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify super_admin
    const { data: adminStaff } = await supabaseAdmin
      .from("admin_staff")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!adminStaff || adminStaff.role !== "super_admin") {
      return new Response(JSON.stringify({ error: "Super admin access required" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const body = await req.json();
    const { title, periodStart, periodEnd, items } = body as {
      title: string;
      periodStart: string;
      periodEnd: string;
      items: PayrollItemInput[];
    };

    if (!title || !periodStart || !periodEnd || !items?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Get environment
    const { data: envSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();
    const environment = (envSetting?.value as string) || "production";

    // Get company name from platform settings (fallback to Dlect Technologies)
    const { data: companyNameSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "company_name")
      .single();
    const companyName = companyNameSetting?.value || "Dlect Technologies";

    // Build month label from period
    const periodDate = new Date(periodStart);
    const monthLabel = periodDate.toLocaleString("en-US", { month: "long", year: "numeric" });

    const paystackSecretKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

    // Calculate totals
    const totalGross = items.reduce((s, i) => s + i.base_salary + i.bonus, 0);
    const totalDeductions = items.reduce((s, i) => s + i.deductions, 0);
    const totalNet = items.reduce((s, i) => s + i.net_pay, 0);

    // Create payroll run
    const { data: payrollRun, error: runError } = await supabaseAdmin
      .from("payroll_runs")
      .insert({
        title,
        pay_period_start: periodStart,
        pay_period_end: periodEnd,
        status: "processing",
        total_gross: totalGross,
        total_deductions: totalDeductions,
        total_net: totalNet,
        total_employees: items.length,
        created_by: user.id,
        environment,
      })
      .select()
      .single();

    if (runError || !payrollRun) {
      console.error("Failed to create payroll run:", runError);
      return new Response(JSON.stringify({ error: "Failed to create payroll run" }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let processedCount = 0;
    let failedCount = 0;

    // Process each employee
    for (const item of items) {
      // Get employee bank details
      const { data: employee } = await supabaseAdmin
        .from("payroll_employees")
        .select("*")
        .eq("id", item.payroll_employee_id)
        .single();

      if (!employee || !employee.paystack_recipient_code) {
        // Skip - no bank account
        await supabaseAdmin.from("payroll_items").insert({
          payroll_run_id: payrollRun.id,
          payroll_employee_id: item.payroll_employee_id,
          employee_name: item.employee_name,
          base_salary: item.base_salary,
          bonus: item.bonus,
          bonus_note: item.bonus_note || null,
          deductions: item.deductions,
          deduction_note: item.deduction_note || null,
          net_pay: item.net_pay,
          status: "skipped",
          failure_reason: "No bank account configured",
          bank_name: employee?.bank_name || null,
          bank_account_number: employee?.bank_account_number || null,
        });
        failedCount++;
        continue;
      }

      if (item.net_pay <= 0) {
        await supabaseAdmin.from("payroll_items").insert({
          payroll_run_id: payrollRun.id,
          payroll_employee_id: item.payroll_employee_id,
          employee_name: item.employee_name,
          base_salary: item.base_salary,
          bonus: item.bonus,
          bonus_note: item.bonus_note || null,
          deductions: item.deductions,
          deduction_note: item.deduction_note || null,
          net_pay: item.net_pay,
          status: "skipped",
          failure_reason: "Net pay is zero or negative",
          bank_name: employee.bank_name,
          bank_account_number: employee.bank_account_number,
        });
        failedCount++;
        continue;
      }

      // Initiate Paystack transfer
      const reference = `PAYROLL-${payrollRun.id.slice(0, 8)}-${item.payroll_employee_id.slice(0, 8)}-${Date.now()}`;
      
      try {
        const transferResponse = await fetch("https://api.paystack.co/transfer", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: "balance",
            amount: Math.round(item.net_pay * 100), // Convert to kobo
            recipient: employee.paystack_recipient_code,
            reason: `Salary from ${companyName} for ${monthLabel} - ${item.employee_name}`,
            reference,
          }),
        });

        const transferData = await transferResponse.json();

        if (transferResponse.ok && transferData.status) {
          await supabaseAdmin.from("payroll_items").insert({
            payroll_run_id: payrollRun.id,
            payroll_employee_id: item.payroll_employee_id,
            employee_name: item.employee_name,
            base_salary: item.base_salary,
            bonus: item.bonus,
            bonus_note: item.bonus_note || null,
            deductions: item.deductions,
            deduction_note: item.deduction_note || null,
            net_pay: item.net_pay,
            status: "processing",
            paystack_reference: reference,
            paystack_transfer_code: transferData.data?.transfer_code || null,
            bank_name: employee.bank_name,
            bank_account_number: employee.bank_account_number,
          });
          processedCount++;
        } else {
          await supabaseAdmin.from("payroll_items").insert({
            payroll_run_id: payrollRun.id,
            payroll_employee_id: item.payroll_employee_id,
            employee_name: item.employee_name,
            base_salary: item.base_salary,
            bonus: item.bonus,
            bonus_note: item.bonus_note || null,
            deductions: item.deductions,
            deduction_note: item.deduction_note || null,
            net_pay: item.net_pay,
            status: "failed",
            paystack_reference: reference,
            failure_reason: transferData.message || "Transfer failed",
            bank_name: employee.bank_name,
            bank_account_number: employee.bank_account_number,
          });
          failedCount++;
        }
      } catch (transferError: unknown) {
        const errMsg = transferError instanceof Error ? transferError.message : "Transfer error";
        await supabaseAdmin.from("payroll_items").insert({
          payroll_run_id: payrollRun.id,
          payroll_employee_id: item.payroll_employee_id,
          employee_name: item.employee_name,
          base_salary: item.base_salary,
          bonus: item.bonus,
          bonus_note: item.bonus_note || null,
          deductions: item.deductions,
          deduction_note: item.deduction_note || null,
          net_pay: item.net_pay,
          status: "failed",
          paystack_reference: reference,
          failure_reason: errMsg,
          bank_name: employee.bank_name,
          bank_account_number: employee.bank_account_number,
        });
        failedCount++;
      }
    }

    // Update payroll run status
    const finalStatus = failedCount === 0 ? "completed" : processedCount === 0 ? "failed" : "partial";
    await supabaseAdmin
      .from("payroll_runs")
      .update({
        status: finalStatus,
        processed_count: processedCount,
        failed_count: failedCount,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", payrollRun.id);

    console.log(`Payroll ${payrollRun.id} completed: ${processedCount} processed, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Payroll processed: ${processedCount} payments initiated, ${failedCount} skipped/failed`,
        payroll_run_id: payrollRun.id,
        processed: processedCount,
        failed: failedCount,
        status: finalStatus,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Payroll error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
