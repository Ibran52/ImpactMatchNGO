export class IntegrationUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(
    readonly integration: string,
    readonly requiredEnvironment: string[],
  ) {
    super(`${integration} is not configured.`);
    this.name = "IntegrationUnavailableError";
  }
}

export type NotificationRequest = {
  recipientId: string;
  type: string;
  idempotencyKey: string;
  payload: Record<string, string>;
};

export const notificationService = {
  async send(_notification: NotificationRequest): Promise<void> {
    throw new IntegrationUnavailableError("Notification provider", ["NOTIFICATION_PROVIDER", "NOTIFICATION_CREDENTIALS"]);
  },
};
