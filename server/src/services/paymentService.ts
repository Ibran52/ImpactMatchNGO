import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { config } from "../config.js";

export type PaymentOrderRequest = {
  amountMinor: number;
  receipt: string;
  notes: Record<string, string>;
};

export type PaymentOrder = {
  id: string;
  amount: number;
  currency: string;
};

function razorpayClient(): Razorpay {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay test credentials are not configured.");
  }
  return new Razorpay({
    key_id: config.RAZORPAY_KEY_ID,
    key_secret: config.RAZORPAY_KEY_SECRET,
  });
}

export async function createPaymentOrder(input: PaymentOrderRequest): Promise<PaymentOrder> {
  const created = await razorpayClient().orders.create({
    amount: input.amountMinor,
    currency: "INR",
    receipt: input.receipt,
    notes: input.notes,
  });
  if (!created.id || typeof created.amount !== "number" ||
      created.amount !== input.amountMinor || created.currency !== "INR") {
    throw new Error("Payment provider returned an order with unexpected amount or currency.");
  }
  return { id: created.id, amount: created.amount, currency: created.currency };
}

export function fetchPayment(paymentId: string) {
  return razorpayClient().payments.fetch(paymentId);
}

export function verifyProviderSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
