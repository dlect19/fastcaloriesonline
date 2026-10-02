import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const sql = readFileSync("drizzle/migrations/0039_payout_environment_before_insert.sql", "utf8");

describe("payout environment guard (0039)", () => {
  it("stamps environment BEFORE INSERT so the stored row matches the ledger debit", () => {
    expect(sql).toMatch(/BEFORE INSERT ON public\.payout_requests/);
    expect(sql).toMatch(/get_platform_environment\(\)/);
  });
  it("still requires exactly one completed matching withdrawal debit", () => {
    expect(sql).toMatch(/IF v_n <> 1 THEN/);
    expect(sql).toMatch(/'PAYOUT-REQ-' \|\| NEW\.id::text/);
    expect(sql).toMatch(/status = 'completed' AND amount = NEW\.amount/);
  });
});
