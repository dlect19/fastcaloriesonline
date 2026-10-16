import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  classifyInitiation, classifyVerify, decideTransition, isExpenseReference, mapProviderStatus,
  matchTransferToRequisition, safeTransferSnapshot, canStartNewTransfer,
} from "../../supabase/functions/_shared/expenseTransfer";
import { classifyPaystackPurpose } from "../../supabase/functions/_shared/paystackAudit";
import { canStartNewTransfer as uiCanStart } from "@/components/admin/expenses/ExpenseRequisitionList";

const sql = readFileSync("drizzle/migrations/0044_expense_transfer_attempts.sql", "utf8");
const fn = readFileSync("supabase/functions/process-expense/index.ts", "utf8");
const hook = readFileSync("supabase/functions/paystack-webhook/index.ts", "utf8");

const req = { amount: 50000, account_number: "8127917744", bank_code: "999992" };
const ok = {
  reference: "EXP-1791287472953-wr1hbu", currency: "NGN", amount: 5000000, status: "success",
  recipient: { details: { account_number: "8127917744", bank_code: "999992", bank_name: "OPay" } },
};

describe("expense transfer classification", () => {
  it("never treats a Paystack error body as 'no transfer' (2026-10-06 incident)", () => {
    expect(classifyInitiation(false, { status: false, message: "Your balance is not enough" })).toBe("unknown");
    expect(classifyInitiation(true, null)).toBe("unknown");
    expect(classifyInitiation(true, { status: true, data: { status: "pending" } })).toBe("pending");
    expect(classifyInitiation(true, { status: true, data: { status: "otp" } })).toBe("pending");
  });
  it("verify: 404 → not_found, success/failed/reversed mapped, errors → unknown", () => {
    expect(classifyVerify(404, null).outcome).toBe("not_found");
    expect(classifyVerify(500, null).outcome).toBe("unknown");
    expect(classifyVerify(200, { status: true, data: { status: "success" } }).outcome).toBe("success");
    expect(mapProviderStatus("reversed")).toBe("reversed");
    expect(mapProviderStatus("abandoned")).toBe("failed");
    expect(mapProviderStatus("weird")).toBe("unknown");
  });
  it("destination must match reference, amount, currency, account and bank", () => {
    expect(matchTransferToRequisition(ok, req, ok.reference).ok).toBe(true);
    const bad = { ...ok, recipient: { details: { account_number: "0000000000", bank_code: "999992" } } };
    expect(matchTransferToRequisition(bad, req, ok.reference).mismatches).toContain("account_number");
    expect(matchTransferToRequisition({ ...ok, amount: 4999900 }, req, ok.reference).mismatches).toContain("amount");
    expect(matchTransferToRequisition(ok, req, "EXP-1-other").mismatches).toContain("reference");
  });
  it("snapshot keeps only last 4 digits", () => {
    const s = safeTransferSnapshot(ok, "production");
    expect(s.account_last4).toBe("7744");
    expect(JSON.stringify(s)).not.toContain("8127917744");
  });
});

describe("state machine: duplicate and out-of-order events", () => {
  it("duplicate success is a no-op; late failure cannot overwrite success", () => {
    expect(decideTransition("success", "success")).toBe("noop");
    expect(decideTransition("success", "failed")).toBe("ignored_stale");
  });
  it("success after pending/unknown applies; success after reversal is stale", () => {
    expect(decideTransition("pending", "success")).toBe("apply");
    expect(decideTransition("unknown", "success")).toBe("apply");
    expect(decideTransition("reversed", "success")).toBe("ignored_stale");
  });
  it("reversal after success applies once", () => {
    expect(decideTransition("success", "reversed")).toBe("apply");
    expect(decideTransition("reversed", "reversed")).toBe("noop");
  });
  it("pending never regresses a terminal state", () => {
    expect(decideTransition("success", "pending")).toBe("noop");
    expect(decideTransition("failed", "pending")).toBe("noop");
  });
  it("SQL mirrors the same rules", () => {
    expect(sql).toMatch(/IF a\.state = 'success' THEN\s+UPDATE public\.expense_transfer_attempts SET last_event = p_source\|\|':stale_failed_ignored'/);
    expect(sql).toMatch(/IF a\.state = 'reversed' THEN RETURN jsonb_build_object\('result','ignored_stale'/);
    expect(sql).toMatch(/v_latest AND r\.status = 'approved'/); // older attempt can't overwrite note
  });
});

describe("ledger + concurrency guards", () => {
  it("expense debit is idempotent per requisition via post_platform_entry", () => {
    expect(sql).toMatch(/post_platform_entry\(r\.amount, 'expense', 'debit', 'EXP-'\|\|r\.id::text/);
    expect(sql).toMatch(/'EXP-REV-'\|\|a\.reference/);
    expect(sql).not.toMatch(/UPDATE public\.platform_wallet/);
  });
  it("one open attempt per requisition and row lock before insert", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX expense_transfer_one_open_attempt[\s\S]*WHERE state IN \('initiating','pending','unknown','success'\)/);
    expect(sql).toMatch(/FROM public\.expense_requisitions WHERE id = p_requisition_id FOR UPDATE/);
  });
  it("outcome RPCs are service-role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.record_expense_transfer_outcome[^;]*FROM PUBLIC, anon, authenticated/);
  });
  it("manual Mark Paid is blocked while a transfer is in flight", () => {
    expect(sql).toMatch(/guard_expense_manual_payment[\s\S]*EXPENSE_TRANSFER_IN_FLIGHT/);
  });
  it("attempt is recorded BEFORE the money-moving call, then verified by reference", () => {
    const begin = fn.indexOf('rpc("begin_expense_transfer"');
    const transfer = fn.indexOf('"https://api.paystack.co/transfer",');
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(transfer);
    expect(fn.indexOf("verifyTransfer(paystackKey, reference)", transfer)).toBeGreaterThan(transfer);
    expect(fn).not.toMatch(/finalize_expense_payment/);
  });
  it("reconcile never sends money", () => {
    const rec = fn.slice(fn.indexOf('if (action === "reconcile")'), fn.indexOf("// ---------------- PAY"));
    expect(rec).not.toMatch(/api\.paystack\.co\/transfer"/);
    expect(rec).not.toMatch(/method: "POST"/);
    expect(rec).toMatch(/signature_valid", true/);
  });
});

describe("expense vs payout separation", () => {
  it("EXP references route to the expense handler; PAY references stay payouts", () => {
    expect(isExpenseReference("EXP-1791287472953-wr1hbu")).toBe(true);
    expect(isExpenseReference("PAY-1792103271579-0zkho")).toBe(false);
    expect(classifyPaystackPurpose({ eventType: "transfer.success", reference: "EXP-1791287472953-wr1hbu" })).toBe("expense_transfer");
    expect(classifyPaystackPurpose({ eventType: "transfer.success", reference: "PAY-1792103271579-0zkho" })).toBe("payout_transfer");
    expect(hook).toMatch(/if \(isExpenseReference\(ref\)\)/);
  });
  it("unmatched transfers are not audited as processed", () => {
    expect(hook).toMatch(/processingState: "failed", reasonCode: "unmatched_transfer"/);
  });
});

describe("UI pay gating", () => {
  it("hides Pay while transfer is processing/unknown", () => {
    for (const f of [canStartNewTransfer, uiCanStart]) {
      expect(f("approved", null)).toBe(true);
      expect(f("approved", "failed")).toBe(true);
      expect(f("approved", "processing")).toBe(false);
      expect(f("approved", "unknown")).toBe(false);
      expect(f("approved", "initiating")).toBe(false);
      expect(f("paid", null)).toBe(false);
    }
  });
});
