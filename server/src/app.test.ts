import session from "express-session";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp(new session.MemoryStore());

describe("Impact Match API", () => {
  it("reports MongoDB readiness to callers", async () => {
    const response = await request(app).get("/api/health");
    const connected = mongoose.connection.readyState === 1;
    expect(response.status).toBe(connected ? 200 : 503);
    expect(response.body).toEqual({
      status: connected ? "ok" : "unavailable",
      service: "impact-match-api",
      database: connected ? "connected" : "disconnected",
    });
  });

  it("returns a clear not-found response for unknown endpoints", async () => {
    const response = await request(app).get("/api/not-a-route");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "This endpoint does not exist." });
  });

  it("requires a signed-in user for personal impact", async () => {
    const response = await request(app).get("/api/impact/me");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Please sign in to continue." });
  });

  it("mounts the authenticated profile update endpoint", async () => {
    const response = await request(app).patch("/api/profile/me")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .send({ name: "Updated name" });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Please sign in to continue." });
  });

  it("mounts the authenticated contribution history endpoint", async () => {
    const response = await request(app).get("/api/impact/contributions/me");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Please sign in to continue." });
  });

  it("mounts the authenticated notification endpoints at startup", async () => {
    const [page, unreadCount] = await Promise.all([
      request(app).get("/api/notifications/me"),
      request(app).get("/api/notifications/unread-count"),
    ]);
    expect(page.status).toBe(401);
    expect(unreadCount.status).toBe(401);
  });

  it("rejects cross-origin state-changing requests", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://attacker.example")
      .send({ email: "person@example.com", password: "password123" });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Cross-origin requests are not allowed." });
  });

  it("allows same-origin state-changing requests to reach route validation", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .send({ email: "invalid", password: "password123" });
    expect(response.status).toBe(400);
  });

  it("accepts a same-origin Referer when Origin is unavailable", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Referer", `${new URL(config.CLIENT_ORIGIN).origin}/signin`)
      .send({ email: "invalid", password: "password123" });
    expect(response.status).toBe(400);
  });

  it("does not allow anonymous callers to publish NGO opportunities", async () => {
    const response = await request(app).post("/api/needs")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .send({});
    expect(response.status).toBe(401);
  });

  it("does not allow anonymous callers to view volunteer recommendations", async () => {
    const response = await request(app).get("/api/volunteer/recommendations");
    expect(response.status).toBe(401);
  });

  it("does not allow anonymous callers to review NGO applications", async () => {
    const response = await request(app)
      .patch("/api/admin/organizations/507f1f77bcf86cd799439011")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .send({ status: "verified" });
    expect(response.status).toBe(401);
  });

  it("protects verification status, uploads, and resubmission behind authentication", async () => {
    const status = await request(app).get("/api/verification/me");
    const upload = await request(app)
      .post("/api/verification/me/documents")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .set("Content-Type", "application/pdf")
      .set("X-Document-Kind", "ngo_registration")
      .set("X-Upload-Filename", "registration.pdf")
      .send(Buffer.from("%PDF-1.7"));
    const resubmit = await request(app)
      .post("/api/verification/me/resubmit")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .send({});
    expect(status.status).toBe(401);
    expect(upload.status).toBe(401);
    expect(resubmit.status).toBe(401);
  });

  it("does not allow anonymous access to private verification files", async () => {
    const response = await request(app).get("/api/admin/verification-documents/507f1f77bcf86cd799439011/content");
    expect(response.status).toBe(401);
  });

  it("rejects invalid registration data before touching the database", async () => {
    const response = await request(app).post("/api/auth/register")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .send({ email: "not-an-email" });
    expect(response.status).toBe(400);
    expect(response.body.message).toBeTruthy();
  });

  it("does not accept public admin registration", async () => {
    const response = await request(app).post("/api/auth/register")
      .set("Origin", new URL(config.CLIENT_ORIGIN).origin)
      .send({
        name: "Unauthorized Admin",
        email: "unauthorized-admin@example.com",
        password: "example-password",
        role: "admin",
        city: "Pune",
      });
    expect(response.status).toBe(400);
  });

  it("rejects state-changing requests without an Origin or Referer", async () => {
    const response = await request(app).post("/api/auth/login").send({});
    expect(response.status).toBe(403);
  });
});
