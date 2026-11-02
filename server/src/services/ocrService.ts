import { config } from "../config.js";
import { readPrivateObject } from "./privateStorageService.js";
import { providerHttpFailureReason, recordIntegrationCheck } from "./integrationStatusService.js";

export type OcrResult =
  | { status: "completed"; text: string; provider: string; confidence?: number }
  | { status: "unavailable" | "unsupported" | "failed"; provider: string; error: string };

const ocrContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function extractRequestText(key: string, contentType: string): Promise<OcrResult> {
  if (!ocrContentTypes.has(contentType)) {
    return { status: "unsupported", provider: "google-cloud-vision", error: "OCR currently supports JPEG, PNG, and WebP images; PDF files remain securely stored for human review." };
  }
  if (!config.GOOGLE_VISION_API_KEY) {
    return { status: "unavailable", provider: "not_configured", error: "OCR is unavailable because GOOGLE_VISION_API_KEY is not configured." };
  }
  if (!config.REQUEST_DATA_ENCRYPTION_KEY) {
    return { status: "unavailable", provider: "not_configured", error: "OCR text storage is unavailable because REQUEST_DATA_ENCRYPTION_KEY is not configured." };
  }

  try {
    const bytes = await readPrivateObject(key);
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(config.GOOGLE_VISION_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [{ image: { content: bytes.toString("base64") }, features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }] }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const error = providerHttpFailureReason("OCR", response.status);
      recordIntegrationCheck("ocr", "error", error);
      return { status: "failed", provider: "google-cloud-vision", error };
    }
    const result = await response.json() as {
      responses?: Array<{
        error?: { code?: number };
        fullTextAnnotation?: { text?: string; pages?: Array<{ confidence?: number }> };
        textAnnotations?: Array<{ description?: string }>;
      }>;
    };
    const annotation = result.responses?.[0];
    if (annotation?.error) {
      const error = annotation.error.code === 7
        ? "OCR provider denied this request. Check API enablement and project permissions."
        : annotation.error.code === 8
          ? "OCR provider quota or rate limit was reached."
          : annotation.error.code === 3
            ? "OCR provider rejected the image or request format."
            : "OCR provider returned an extraction error.";
      recordIntegrationCheck("ocr", "error", error);
      return { status: "failed", provider: "google-cloud-vision", error };
    }
    const text = annotation?.fullTextAnnotation?.text ?? annotation?.textAnnotations?.[0]?.description ?? "";
    if (!text.trim()) {
      const error = "OCR provider completed, but no readable text was found in the image.";
      recordIntegrationCheck("ocr", "error", error);
      return { status: "failed", provider: "google-cloud-vision", error };
    }
    const confidences = annotation?.fullTextAnnotation?.pages?.map((page) => page.confidence).filter((value): value is number => typeof value === "number") ?? [];
    recordIntegrationCheck("ocr", "verified");
    return {
      status: "completed",
      text: text.slice(0, 20_000),
      provider: "google-cloud-vision",
      ...(confidences.length ? { confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length } : {}),
    };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError"
      ? "OCR processing timed out."
      : "OCR provider could not be reached.";
    recordIntegrationCheck("ocr", "error", reason);
    return {
      status: "failed",
      provider: "google-cloud-vision",
      error: reason,
    };
  }
}
