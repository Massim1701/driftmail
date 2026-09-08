import { describe, expect, it } from "vitest";
import { detectIpReputation } from "../src/ipReputation.js";

describe("detectIpReputation", () => {
  it("always returns 'unknown' (no network access to check a blocklist)", () => {
    expect(detectIpReputation()).toBe("unknown");
  });

  it("returns 'unknown' regardless of how many times it is called (no hidden state)", () => {
    expect(detectIpReputation()).toBe("unknown");
    expect(detectIpReputation()).toBe("unknown");
    expect(detectIpReputation()).toBe("unknown");
  });
});
