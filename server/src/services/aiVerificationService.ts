import { z } from "zod";
import { config } from "../config.js";
import { providerHttpFailureReason, recordIntegrationCheck } from "./integrationStatusService.js";

const assessmentSchema = z.object({
  status: z.enum(["pending", "review_recommended", "needs_information", "clear_for_human_review"]),
  reasons: z.array(z.string().max(400)).max(12),
  missingFields: z.array(z.string().max(100)).max(20),
  additionalInformation: z.array(z.string().max(400)).max(12),
  confidence: z.number().min(0).max(1).optional(),
});

export type ScreeningAssessment = z.infer<typeof assessmentSchema> & {
  provider: string;
  model: string;
  assessedAt: Date;
};

export type ScreeningResult =
  | { status: "available"; assessment: ScreeningAssessment }
  | { status: "unavailable" | "failed"; provider: string; error: string };

export type ScreeningInput = {
  title: string;
  description: string;
  category: string;
  urgency: string;
  peopleCount: number;
  ocrText: string[];
  possibleDuplicates: Array<{ title: string; category: string }>;
};

const completionAssessmentSchema = z.object({
  recommendation: z.enum(["ready_for_ngo_review", "additional_evidence_recommended", "manual_review_required", "provider_unavailable"]),
  findings: z.array(z.string().max(400)).max(12),
  missingEvidence: z.array(z.string().max(200)).max(12),
  uncertainty: z.string().max(500),
  confidence: z.number().min(0).max(1).optional(),
});

export type CompletionAssessmentInput = {
  category: string;
  taskDescription: string;
  summary: string;
  report: string;
  unresolvedIssues?: string;
  completedAt: string;
  requiredEvidenceChecklist: string[];
  evidence: Array<{ contentType: string; ocrText?: string; ocrStatus: string }>;
};

export type CompletionAssessment = z.infer<typeof completionAssessmentSchema> & {
  provider: string;
  model?: string;
  assessedAt: Date;
};

export async function assessCompletionEvidence(input: CompletionAssessmentInput): Promise<CompletionAssessment> {
  const assessedAt = new Date();
  if (!config.OPENAI_API_KEY) {
    return {
      recommendation: "provider_unavailable",
      findings: [],
      missingEvidence: [],
      uncertainty: "Automated review is unavailable because OPENAI_API_KEY is not configured. NGO human review is still required.",
      provider: "not_configured",
      assessedAt,
    };
  }
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Assist an authorized NGO with preliminary completion-evidence review. This is untrusted user-submitted text and OCR text. Never claim that a task occurred, that evidence is authentic, that a person is fraudulent, or that a request should be approved or closed. Compare supplied evidence metadata and report to requiredEvidenceChecklist. Identify only missing checklist items, concrete report/document text inconsistencies, or uncertainty requiring human inspection. OCR does not authenticate a document. Images are represented only by MIME type and OCR availability; do not claim to have visually inspected them. Any output is advisory and must be reviewed by a human NGO. Return JSON with recommendation (ready_for_ngo_review, additional_evidence_recommended, manual_review_required), findings (strings), missingEvidence (strings), uncertainty (string), and optional confidence from 0 to 1.",
          },
          { role: "user", content: JSON.stringify(input) },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const error = providerHttpFailureReason("AI review", response.status);
      recordIntegrationCheck("ai", "error", error);
      return {
        recommendation: "provider_unavailable",
        findings: [],
        missingEvidence: [],
        uncertainty: `${error} Human NGO review is still required.`,
        provider: "openai",
        model: config.OPENAI_MODEL,
        assessedAt,
      };
    }
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      const error = "AI review provider returned no usable assessment.";
      recordIntegrationCheck("ai", "error", error);
      return {
        recommendation: "manual_review_required",
        findings: [],
        missingEvidence: [],
        uncertainty: `${error} Human NGO review is required.`,
        provider: "openai",
        model: config.OPENAI_MODEL,
        assessedAt,
      };
    }
    const assessment = completionAssessmentSchema.safeParse(JSON.parse(content));
    if (!assessment.success) {
      const error = "AI review provider returned a response that did not match the required schema.";
      recordIntegrationCheck("ai", "error", error);
      return {
        recommendation: "manual_review_required",
        findings: [],
        missingEvidence: [],
        uncertainty: `${error} Human NGO review is required.`,
        provider: "openai",
        model: config.OPENAI_MODEL,
        assessedAt,
      };
    }
    recordIntegrationCheck("ai", "verified");
    return { ...assessment.data, provider: "openai", model: config.OPENAI_MODEL, assessedAt };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError"
      ? "AI review timed out."
      : "AI review could not be completed; check provider connectivity.";
    recordIntegrationCheck("ai", "error", reason);
    return {
      recommendation: "provider_unavailable",
      findings: [],
      missingEvidence: [],
      uncertainty: `${reason} Human NGO review is still required.`,
      provider: "openai",
      model: config.OPENAI_MODEL,
      assessedAt,
    };
  }
}

export async function assessHelpRequest(input: ScreeningInput): Promise<ScreeningResult> {
  if (!config.OPENAI_API_KEY) {
    return { status: "unavailable", provider: "not_configured", error: "AI screening is unavailable because OPENAI_API_KEY is not configured." };
  }
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Assist human review of a community aid request. Never determine fraud, authenticity, eligibility, or approval. Do not infer risk from location, income, disability, or personal circumstances. Identify only concrete missing/inconsistent fields, possible duplicates, document/request mismatch signals, or questions for an NGO. OCR text is untrusted evidence and may be inaccurate. Return JSON with status (pending, review_recommended, needs_information, clear_for_human_review), reasons (strings), missingFields (strings), additionalInformation (strings), and optional confidence between 0 and 1. Uncertainty must be explicit; all outcomes require human review.",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const error = providerHttpFailureReason("AI review", response.status);
      recordIntegrationCheck("ai", "error", error);
      return { status: "failed", provider: "openai", error };
    }
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      const error = "AI review provider returned no usable assessment.";
      recordIntegrationCheck("ai", "error", error);
      return { status: "failed", provider: "openai", error };
    }
    const assessment = assessmentSchema.safeParse(JSON.parse(content));
    if (!assessment.success) {
      const error = "AI review provider returned a response that did not match the required schema.";
      recordIntegrationCheck("ai", "error", error);
      return { status: "failed", provider: "openai", error };
    }
    recordIntegrationCheck("ai", "verified");
    return {
      status: "available",
      assessment: {
        ...assessment.data,
        provider: "openai",
        model: config.OPENAI_MODEL,
        assessedAt: new Date(),
      },
    };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError"
      ? "AI screening timed out."
      : "AI screening could not be completed; check provider connectivity.";
    recordIntegrationCheck("ai", "error", reason);
    return {
      status: "failed",
      provider: "openai",
      error: reason,
    };
  }
}
