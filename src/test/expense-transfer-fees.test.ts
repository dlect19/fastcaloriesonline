import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { extractTransferFeeKobo } from "../../supabase/functions/_shared/expenseTransfer";
import { netFeesByRequisition, totalCashOut } from "@/components/admin/expenses/ExpenseRequisitionList";

const sql = readFileSync("drizzle/migrations/0045_expense_transfer_fees.sql", "utf8");
const fn = readFileSync("supabase/functions/process-expense/index.ts", "utf8");
const hook = readFileSync("supabase/functions/paystack-webhook/index.ts", "utf8");
const card = readFileSync("src/components/admin/CompanyProfitCard.tsx", "utf8");

describe("provider-confirmed fee extraction", () => {
  it("reads Paystack kobo fee exactly", () => {
    expect(extractTransferFeeKobo({ fee_charged: 7500 })).toBe(7500);
    expect(extractTransferFeeKobo({ fees: 2500 })).toBe(2500);
    expect(extractTransferFeeKobo({ fee_charged: 0 })).toBe(0);
  });
  it("never guesses: missing, fractional or negative fees are unconfirmed", () => {
    expect(extractTransferFeeKobo({})).toBeNull();
    expect(extractTransferFeeKobo({ fee_charged: null })).toBeNull();
    expect(extractTransferFeeKobo({ fee_charged: 75.5 })).toBeNull();
    expect(extractTransferFeeKobo({ fee_charged: -1 })).toBeNull();
    expect(extractTransferFeeKobo({ fee_charged: "abc" })).toBeNull();
  });
});

describe("fee ledger posting (SQL)", () => {
  it("posts a separate debit with a stable unique reference via post_platform_entry", () => {
    expect(sql).toMatch(/post_platform_entry\(p_fee_kobo::numeric \/ 100, 'expense_fee', 'debit', 'EXPFEE-'\|\|a\.reference/);
  });
  it("only posts after a successful principal debit", () => {
    expect(sql).toMatch(/a\.state <> 'success' OR a\.ledger_tx_id IS NULL/);
  });
  it("is idempotent and rejects a conflicting second fee", () => {
    expect(sql).toMatch(/a\.fee_kobo = p_fee_kobo THEN RETURN jsonb_build_object\('result','noop'/);
    expect(sql).toMatch(/'fee_conflict'/);
  });
  it("refunds only an explicit, evidenced amount not exceeding the fee", () => {
    expect(sql).toMatch(/p_evidence IS NULL THEN RAISE EXCEPTION 'EXPENSE_FEE_REFUND_INVALID'/);
    expect(sql).toMatch(/p_refund_kobo > a\.fee_kobo/);
    expect(sql).toMatch(/'EXPFEE-REV-'\|\|a\.reference/);
  });
  it("is service-role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.record_expense_transfer_fee\(text,bigint,text,jsonb\) FROM PUBLIC, anon, authenticated/);
  });
  it("never reduces the recipient transfer amount", () => {
    expect(fn).toMatch(/amount: Math\.round\(Number\(requisition\.amount\) \* 100\)/);
  });
});

describe("fee wiring", () => {
  it("records fees only from verified success / signed webhook success", () => {
    expect(fn).toMatch(/v\.outcome === "success" \? await recordFee/);
    expect(hook).toMatch(/eventType === "transfer\.success" && fee !== null/);
    expect(hook).not.toMatch(/record_expense_transfer_fee_refund/); // reversal never assumes a fee refund
  });
  it("profit card counts fees once in their own bucket", () => {
    expect(card).toMatch(/tx\.category === 'expense_fee'\) transferFees \+=/);
  });
});

describe("UI totals", () => {
  it("nets refunds and adds principal + fee without float drift", () => {
    const f = netFeesByRequisition([
      { requisition_id: "a", fee_kobo: 7500 },
      { requisition_id: "b", fee_kobo: 2500, fee_refund_kobo: 2500 },
      { requisition_id: "c", fee_kobo: null },
    ]);
    expect(f).toEqual({ a: 75, b: 0 });
    expect(totalCashOut(50000, f.a)).toBe(50075);
    expect(totalCashOut(0.1, 0.2)).toBe(0.3);
  });
});
