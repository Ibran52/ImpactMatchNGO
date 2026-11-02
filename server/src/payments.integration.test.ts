import { createHmac, randomUUID } from "node:crypto";
import session from "express-session";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const paymentTestConfig = vi.hoisted(() => ({
  RAZORPAY_KEY_ID: "rzp_test_impactmatch",
  RAZORPAY_KEY_SECRET: "test-payment-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-webhook-secret",
}));
const razorpayOrders = vi.hoisted(() => ({
  nextId: 0,
  payments: {} as Record<string, { order_id: string; amount: number }>,
}));

vi.mock("./config.js", () => ({
  config: {
    ...paymentTestConfig,
    NODE_ENV: "test",
    isProduction: false,
    SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
    SESSION_TTL_DAYS: 14,
    MONGODB_URI: "mongodb://127.0.0.1:27017/impact_match_test",
    CLIENT_ORIGIN: "http://localhost:5173",
    API_ORIGIN: "http://localhost:4000",
  },
}));

vi.mock("razorpay", () => ({
  default: class RazorpayMock {
    orders = {
      create: async (order: { amount: number; currency: string }) => ({
        id: `order_impactmatch_${++razorpayOrders.nextId}`,
        amount: order.amount,
        currency: order.currency,
      }),
    };
    payments = {
      fetch: async (paymentId: string) => ({
        id: paymentId,
        order_id: razorpayOrders.payments[paymentId]?.order_id,
        amount: razorpayOrders.payments[paymentId]?.amount,
        currency: "INR",
        status: "captured",
        captured: true,
      }),
    };
  },
}));

import { createApp } from "./app.js";
import { Contribution, Need, User } from "./models.js";
import { expireDonationReservations } from "./routes.js";

const paymentTestMongoUri = process.env.PAYMENT_TEST_MONGODB_URI;
if (paymentTestMongoUri) {
  const database = new URL(paymentTestMongoUri).pathname.replace(/^\/+/, "");
  if (!/test$/i.test(database)) {
    throw new Error("PAYMENT_TEST_MONGODB_URI must point to a dedicated database whose name ends in 'test'.");
  }
}

const paymentTests = paymentTestMongoUri ? describe : describe.skip;
const app = createApp(new session.MemoryStore());

paymentTests("donation reservation and settlement integration", () => {
  beforeAll(async () => {
    await mongoose.connect(paymentTestMongoUri!);
    await Promise.all([User.init(), Need.init(), Contribution.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  async function scenario(targetAmount = 100) {
    const suffix = randomUUID();
    const ngo = await User.create({
      name: "Payment Test NGO",
      email: `ngo-${suffix}@example.test`,
      passwordHash: await bcrypt.hash("test-password", 4),
      role: "ngo",
      city: "Test City",
      organizationStatus: "verified",
    });
    const donor = await User.create({
      name: "Payment Test Donor",
      email: `donor-${suffix}@example.test`,
      passwordHash: await bcrypt.hash("test-password", 4),
      role: "donor",
      city: "Test City",
    });
    const need = await Need.create({
      title: "Test campaign contribution",
      description: "A contribution campaign created only for isolated payment tests.",
      kind: "donation",
      category: "Education",
      city: "Test City",
      organizationId: ngo._id,
      targetAmount,
      raisedAmount: 0,
    });
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").set("Origin", "http://localhost:5173").send({
      email: donor.email,
      password: "test-password",
    });
    expect(login.status).toBe(200);
    const session = await agent.get("/api/auth/me");
    expect(session.body.user?.id).toBe(donor.id);
    return { agent, need };
  }

  async function createOrder(agent: ReturnType<typeof request.agent>, needId: string, amount: number) {
    return agent.post("/api/payments/order").set("Origin", "http://localhost:5173").send({ needId, amount });
  }

  function signWebhook(raw: string) {
    return createHmac("sha256", paymentTestConfig.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  }

  async function captureWebhook(agent: ReturnType<typeof request.agent>, orderId: string, paymentId: string, amount: number) {
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: {
        order_id: orderId,
        id: paymentId,
        amount,
        currency: "INR",
        status: "captured",
      } } },
    });
    return agent.post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signWebhook(raw))
      .send(raw);
  }

  async function failedWebhook(agent: ReturnType<typeof request.agent>, orderId: string, paymentId: string) {
    const raw = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: { order_id: orderId, id: paymentId } } },
    });
    return agent.post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signWebhook(raw))
      .send(raw);
  }

  it("atomically prevents concurrent orders from reserving more than the goal", async () => {
    const { agent, need } = await scenario(100);
    const [first, second] = await Promise.all([
      createOrder(agent, need.id, 60),
      createOrder(agent, need.id, 60),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 400]);
    const campaign = await Need.findById(need.id);
    expect(campaign?.reservedAmount).toBe(60);
    expect(campaign?.raisedAmount).toBe(0);
    expect(campaign?.paymentReservations).toHaveLength(1);
  });

  it("releases an expired reservation before admitting another order", async () => {
    const { agent, need } = await scenario(100);
    const first = await createOrder(agent, need.id, 60);
    expect(first.status).toBe(201);
    await Contribution.updateOne(
      { orderId: first.body.orderId },
      { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } },
    );
    await Need.updateOne(
      { _id: need.id },
      { $set: { "paymentReservations.$[].expiresAt": new Date(Date.now() - 1000) } },
    );

    const second = await createOrder(agent, need.id, 100);
    expect(second.status).toBe(201);
    const oldOrder = await Contribution.findOne({ orderId: first.body.orderId });
    const campaign = await Need.findById(need.id);
    expect(oldOrder?.status).toBe("expired");
    expect(campaign?.reservedAmount).toBe(100);
    expect(campaign?.paymentReservations).toHaveLength(1);
  });

  it("flags a delayed capture after expiry for refund review", async () => {
    const { agent, need } = await scenario(100);
    const order = await createOrder(agent, need.id, 60);
    await Contribution.updateOne(
      { orderId: order.body.orderId },
      { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } },
    );
    await Need.updateOne(
      { _id: need.id },
      { $set: { "paymentReservations.$[].expiresAt": new Date(Date.now() - 1000) } },
    );

    await createOrder(agent, need.id, 1);
    const captured = await captureWebhook(agent, order.body.orderId, "pay_delayed_test", 6000);
    const contribution = await Contribution.findOne({ orderId: order.body.orderId });
    const campaign = await Need.findById(need.id);
    expect(captured.status).toBe(200);
    expect(contribution?.status).toBe("refund_required");
    expect(campaign?.raisedAmount).toBe(0);
    expect(campaign?.reservedAmount).toBe(1);
  });

  it("settles duplicate captured webhooks only once", async () => {
    const { agent, need } = await scenario(100);
    const order = await createOrder(agent, need.id, 70);
    const [first, duplicate] = await Promise.all([
      captureWebhook(agent, order.body.orderId, "pay_duplicate_test", 7000),
      captureWebhook(agent, order.body.orderId, "pay_duplicate_test", 7000),
    ]);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const contribution = await Contribution.findOne({ orderId: order.body.orderId });
    const campaign = await Need.findById(need.id);
    expect(contribution?.status).toBe("completed");
    expect(campaign?.raisedAmount).toBe(70);
    expect(campaign?.reservedAmount).toBe(0);
  });

  it("recovers a settlement interrupted after its idempotency claim", async () => {
    const { agent, need } = await scenario(100);
    const order = await createOrder(agent, need.id, 35);
    const paymentId = "pay_interrupted_settlement";
    const contribution = await Contribution.findOne({ orderId: order.body.orderId });
    expect(contribution?.reservationToken).toBeTruthy();

    await Contribution.updateOne(
      { orderId: order.body.orderId },
      { $set: { status: "settling", paymentId } },
    );
    await Need.updateOne(
      { _id: need.id, paymentReservations: { $elemMatch: { token: contribution!.reservationToken } } },
      { $set: { "paymentReservations.$.settlementPaymentId": paymentId } },
    );
    await expireDonationReservations();

    const recovered = await Contribution.findOne({ orderId: order.body.orderId });
    const campaign = await Need.findById(need.id);
    expect(recovered?.status).toBe("completed");
    expect(campaign?.raisedAmount).toBe(35);
    expect(campaign?.reservedAmount).toBe(0);
  });

  it("settles a browser verification and webhook race idempotently", async () => {
    const { agent, need } = await scenario(100);
    const order = await createOrder(agent, need.id, 45);
    const paymentId = "pay_browser_webhook_race";
    razorpayOrders.payments[paymentId] = { order_id: order.body.orderId, amount: 4500 };
    const signature = createHmac("sha256", paymentTestConfig.RAZORPAY_KEY_SECRET)
      .update(`${order.body.orderId}|${paymentId}`)
      .digest("hex");
    const [browser, webhook] = await Promise.all([
      agent.post("/api/payments/verify").set("Origin", "http://localhost:5173").send({
        orderId: order.body.orderId,
        paymentId,
        signature,
      }),
      captureWebhook(agent, order.body.orderId, paymentId, 4500),
    ]);

    expect(browser.status).toBe(200);
    expect(webhook.status).toBe(200);
    const campaign = await Need.findById(need.id);
    expect(campaign?.raisedAmount).toBe(45);
    expect(campaign?.reservedAmount).toBe(0);
  });

  it("marks a captured amount mismatch for refund review without changing campaign totals", async () => {
    const { agent, need } = await scenario(100);
    const order = await createOrder(agent, need.id, 45);
    const result = await captureWebhook(agent, order.body.orderId, "pay_wrong_amount", 4600);

    expect(result.status).toBe(200);
    const contribution = await Contribution.findOne({ orderId: order.body.orderId });
    const campaign = await Need.findById(need.id);
    expect(contribution?.status).toBe("refund_required");
    expect(campaign?.raisedAmount).toBe(0);
    expect(campaign?.reservedAmount).toBe(0);
  });

  it("does not credit a capture delivered after a failure event", async () => {
    const { agent, need } = await scenario(100);
    const order = await createOrder(agent, need.id, 45);
    await failedWebhook(agent, order.body.orderId, "pay_failed_then_captured");
    const captured = await captureWebhook(agent, order.body.orderId, "pay_failed_then_captured", 4500);
    const contribution = await Contribution.findOne({ orderId: order.body.orderId });
    const campaign = await Need.findById(need.id);

    expect(captured.status).toBe(200);
    expect(contribution?.status).toBe("refund_required");
    expect(campaign?.raisedAmount).toBe(0);
    expect(campaign?.reservedAmount).toBe(0);
  });

  it("requires the raw webhook body and rejects malformed signed JSON", async () => {
    const raw = "{";
    const result = await request(app).post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signWebhook(raw))
      .send(raw);
    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/valid JSON/i);
  });
});
