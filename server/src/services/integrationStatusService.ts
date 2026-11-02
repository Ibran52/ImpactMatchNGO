export type RuntimeIntegration = "ocr" | "ai";
export type IntegrationCheck = {
  state: "verified" | "error";
  checkedAt: string;
  reason?: string;
};

const checks = new Map<RuntimeIntegration, IntegrationCheck>();

export function recordIntegrationCheck(
  integration: RuntimeIntegration,
  state: IntegrationCheck["state"],
  reason?: string,
): void {
  checks.set(integration, {
    state,
    checkedAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  });
}

export function integrationStatus(
  integration: RuntimeIntegration,
  configured: boolean,
  notConfiguredReason: string,
  unverifiedReason: string,
) {
  if (!configured) {
    return {
      configured: false,
      state: "unconfigured",
      runtimeVerified: false,
      reason: notConfiguredReason,
    };
  }
  const check = checks.get(integration);
  if (!check) {
    return {
      configured: true,
      state: "configured_but_unverified",
      runtimeVerified: false,
      reason: unverifiedReason,
    };
  }
  return {
    configured: true,
    state: check.state,
    runtimeVerified: check.state === "verified",
    checkedAt: check.checkedAt,
    ...(check.reason ? { reason: check.reason } : {}),
  };
}

export function providerHttpFailureReason(provider: "OCR" | "AI review", status: number): string {
  if (status === 401) return `${provider} provider rejected the configured credentials (HTTP 401). Check the key and project.`;
  if (status === 403) return `${provider} provider denied this API operation (HTTP 403). Check project permissions and API enablement.`;
  if (status === 429) return `${provider} provider rate limit or quota was reached (HTTP 429).`;
  if (status === 400 || status === 415) return `${provider} provider rejected the request or input format (HTTP ${status}).`;
  if (status === 408 || status === 504) return `${provider} provider request timed out (HTTP ${status}).`;
  if (status >= 500) return `${provider} provider is temporarily unavailable (HTTP ${status}).`;
  return `${provider} provider returned an unsuccessful response (HTTP ${status}).`;
}
