import { describe, expect, it } from "vitest";
import { parseAuthHeaders } from "../src/authHeaders.js";

describe("parseAuthHeaders", () => {
  it("parses pass/pass/pass from a standard Authentication-Results header", () => {
    const headers = {
      "Authentication-Results":
        "mx.google.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass action=none header.from=example.com",
    };
    expect(parseAuthHeaders(headers)).toEqual({
      spfStatus: "pass",
      dkimStatus: "pass",
      dmarcStatus: "pass",
    });
  });

  it("maps fail-like verdicts (softfail, permerror, ...) to 'fail'", () => {
    const headers = {
      "Authentication-Results":
        "mx.example.com; spf=softfail smtp.mailfrom=evil.example; dkim=permerror; dmarc=fail",
    };
    expect(parseAuthHeaders(headers)).toEqual({
      spfStatus: "fail",
      dkimStatus: "fail",
      dmarcStatus: "fail",
    });
  });

  it("returns 'none' for all three when no auth header is present", () => {
    expect(parseAuthHeaders({})).toEqual({
      spfStatus: "none",
      dkimStatus: "none",
      dmarcStatus: "none",
    });
  });

  it("is case-insensitive on header keys", () => {
    const headers = {
      "authentication-results": "mx.example.com; spf=pass; dkim=fail; dmarc=none",
    };
    expect(parseAuthHeaders(headers)).toEqual({
      spfStatus: "pass",
      dkimStatus: "fail",
      dmarcStatus: "none",
    });
  });

  it("falls back to Received-SPF for spf when Authentication-Results lacks spf=", () => {
    const headers = {
      "Authentication-Results": "mx.example.com; dkim=pass; dmarc=pass",
      "Received-SPF": "pass (mx.example.com: domain of foo@example.com designates ...)",
    };
    expect(parseAuthHeaders(headers).spfStatus).toBe("pass");
  });

  it("does not infer dkim=pass merely from a DKIM-Signature header being present", () => {
    const headers = {
      "DKIM-Signature": "v=1; a=rsa-sha256; d=example.com; ...",
    };
    expect(parseAuthHeaders(headers).dkimStatus).toBe("none");
  });
});
