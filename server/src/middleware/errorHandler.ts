import mongoose from "mongoose";
import type { ErrorRequestHandler } from "express";
import { IntegrationUnavailableError } from "../services/unconfiguredProviders.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("API request failed:", {
    name: error instanceof Error ? error.name : "Unknown error",
    ...(error && typeof error === "object" && "code" in error && typeof error.code === "number"
      ? { code: error.code }
      : {}),
    ...(error && typeof error === "object" && "codeName" in error && typeof error.codeName === "string"
      ? { codeName: error.codeName }
      : {}),
    ...(error instanceof Error && error.stack
      ? { stackFrames: error.stack.split("\n").slice(-12).map((frame) => frame.trim()) }
      : {}),
  });
  if (error instanceof mongoose.Error.ValidationError) {
    console.error("API document validation paths:", Object.values(error.errors).map(({ path, name, kind }) => ({ path, name, kind })));
  }
  if (res.headersSent) return;
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 413) {
    res.status(413).json({ message: "The request body exceeds the allowed size." });
    return;
  }
  if (status === 400) {
    res.status(400).json({ message: "The request body could not be parsed." });
    return;
  }
  if (error instanceof IntegrationUnavailableError) {
    res.status(503).json({
      message: error.message,
      requiredConfiguration: error.requiredEnvironment,
    });
    return;
  }
  res.status(500).json({ message: "Something went wrong. Please try again." });
};
