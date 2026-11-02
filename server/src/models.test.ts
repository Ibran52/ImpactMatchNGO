import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { HelpRequest } from "./models.js";

describe("HelpRequest model", () => {
  it("allows a submitted request before optional screening has run", async () => {
    const request = new HelpRequest({
      requesterId: new mongoose.Types.ObjectId(),
      title: "QA assistance request",
      category: "food",
      description: "Synthetic request for model validation.",
      urgency: "high",
      peopleCount: 2,
      city: "Pune",
      preferredContactMethod: "in_app",
      consentToProcess: true,
      timeline: [{ status: "submitted", actorId: new mongoose.Types.ObjectId() }],
    });

    await expect(request.validate()).resolves.toBeUndefined();
    expect(request.screening).toBeUndefined();
  });
});
