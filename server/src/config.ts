import "dotenv/config";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/impact_match"),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  PRIVATE_STORAGE_DIR: z.string().min(1).default(path.resolve(process.cwd(), "private-uploads")),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(15 * 1024 * 1024).default(5 * 1024 * 1024),
  UPLOAD_MAX_FILES: z.coerce.number().int().min(1).max(10).default(5),
  NGO_MATCH_RADIUS_KM: z.coerce.number().positive().max(500).default(50),
  NGO_MATCH_MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(10),
  VOLUNTEER_MATCH_RADIUS_KM: z.coerce.number().positive().max(500).default(30),
  VOLUNTEER_MATCH_MAX_OFFERS: z.coerce.number().int().min(1).max(50).default(10),
  VOLUNTEER_OFFER_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  GOOGLE_VISION_API_KEY: z.string().optional(),
  REQUEST_DATA_ENCRYPTION_KEY: z.string().regex(/^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$/).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  API_ORIGIN: z.string().url().default("http://localhost:4000"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid server configuration: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
}
if (parsed.data.NODE_ENV === "production" && !parsed.data.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set explicitly in production.");
}
if (parsed.data.NODE_ENV === "production" && !process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set explicitly in production.");
}
if (parsed.data.NODE_ENV === "production" && !process.env.CLIENT_ORIGIN) {
  throw new Error("CLIENT_ORIGIN must be set explicitly in production.");
}
if (parsed.data.NODE_ENV === "production" && !process.env.API_ORIGIN) {
  throw new Error("API_ORIGIN must be set explicitly in production.");
}
if (parsed.data.RAZORPAY_KEY_ID && !parsed.data.RAZORPAY_KEY_ID.startsWith("rzp_test_")) {
  throw new Error("Only Razorpay Test Mode keys are supported by this MVP.");
}
if (Boolean(parsed.data.RAZORPAY_KEY_ID) !== Boolean(parsed.data.RAZORPAY_KEY_SECRET)) {
  throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured together.");
}
if (parsed.data.RAZORPAY_KEY_ID && !parsed.data.RAZORPAY_WEBHOOK_SECRET) {
  throw new Error("RAZORPAY_WEBHOOK_SECRET is required when Razorpay payments are enabled.");
}

export const config = {
  ...parsed.data,
  SESSION_SECRET: parsed.data.SESSION_SECRET ?? randomBytes(48).toString("base64url"),
  isProduction: parsed.data.NODE_ENV === "production",
};
