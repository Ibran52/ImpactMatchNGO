import { describe, expect, it } from "vitest";
import {
  integrationStatus,
  providerHttpFailureReason,
  recordIntegrationCheck,
} from "./integrationStatusService.js";

describe("integration runtime status", () => {
  it("distinguishes unconfigured, configured-unverified, verified, and error states", () => {
    expect(integrationStatus("ai", false, "missing", "unverified")).toMatchObject({
      configured: false,
      state: "unconfigured",
      runtimeVerified: false,
      reason: "missing",
    });
    expect(integrationStatus("ai", true, "missing", "unverified")).toMatchObject({
      configured: true,
      state: "configured_but_unverified",
      runtimeVerified: false,
      reason: "unverified",
    });

    recordIntegrationCheck("ai", "verified");
    expect(integrationStatus("ai", true, "missing", "unverified")).toMatchObject({
      state: "verified",
      runtimeVerified: true,
    });

    recordIntegrationCheck("ai", "error", "Provider returned HTTP 401.");
    expect(integrationStatus("ai", true, "missing", "unverified")).toMatchObject({
      state: "error",
      runtimeVerified: false,
      reason: "Provider returned HTTP 401.",
    });
  });

  it("reports useful status-class reasons without exposing provider payloads", () => {
    expect(providerHttpFailureReason("OCR", 401)).toContain("credentials");
    expect(providerHttpFailureReason("AI review", 429)).toContain("quota");
    expect(providerHttpFailureReason("AI review", 500)).toContain("temporarily unavailable");
  });
});
