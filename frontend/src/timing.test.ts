import { describe, expect, it } from "vitest";
import { MIN_ACTIVE_MS, remainingDelay } from "./timing";

describe("remainingDelay", () => {
  it("returns the full minimum when no time has elapsed", () => {
    expect(remainingDelay(0)).toBe(MIN_ACTIVE_MS);
  });

  it("returns the remaining gap when partially elapsed", () => {
    expect(remainingDelay(200, 650)).toBe(450);
  });

  it("returns zero once the minimum has already elapsed", () => {
    expect(remainingDelay(650, 650)).toBe(0);
    expect(remainingDelay(5000, 650)).toBe(0);
  });

  it("never returns a negative delay", () => {
    expect(remainingDelay(999999)).toBeGreaterThanOrEqual(0);
  });
});
