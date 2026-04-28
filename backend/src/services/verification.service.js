const { callGemini, parseGeminiJson } = require('./gemini.helper');
const User = require('../models/User');

/**
 * Kalyān-specific skill categories that local NGOs require.
 * Used as the reference for OCR extraction and matching.
 */
const KALYAN_SKILL_CATEGORIES = [
  'driving', 'medical_first_aid', 'teaching_marathi', 'teaching_english',
  'cooking_bulk', 'data_entry', 'construction', 'plumbing', 'electrical',
  'counselling', 'translation', 'logistics', 'photography', 'social_work',
  'child_care', 'nursing', 'crowd_management', 'legal_aid', 'fundraising'
];

/**
 * Gemini OCR-powered Document Verification
 * Takes a raw image buffer, runs OCR, extracts credentials,
 * and auto-verifies if they are valid.
 * 
 * @param {string} userId - MongoDB User ID
 * @param {Buffer} fileBuffer - Raw image buffer from multer
 * @param {string} mimeType - MIME type of uploaded file (e.g., 'image/jpeg')
 * @param {string} role - 'volunteer' | 'ngo'
 */
async function verifyDocumentWithOCR(userId, fileBuffer, mimeType, role) {
  const prompt = `You are a humanitarian volunteer verification system for the Kalyān region of Maharashtra, India.

Analyze this document image using OCR. Extract all text carefully, including handwritten content in Hindi, Marathi, or English.

Based on the extracted text, determine:
1. Is this a valid identity or professional credential document? (Aadhaar, Voter ID, Medical License, NGO Certificate, etc.)
2. What is the person's/organization's name?
3. What relevant skills can be inferred? Choose ONLY from this list: ${KALYAN_SKILL_CATEGORIES.join(', ')}
4. Is the document expired? (check for expiry dates)

Respond ONLY with this exact JSON format (no markdown):
{
  "ocrText": "full extracted text here",
  "isValid": true or false,
  "reason": "brief explanation of decision",
  "extractedName": "name if found",
  "detectedSkills": ["skill1", "skill2"],
  "documentType": "type of document found",
  "confidence": 0.0 to 1.0
}`;

  try {
    const imagePart = {
      inlineData: {
        data: fileBuffer.toString('base64'),
        mimeType: mimeType
      }
    };

    const result = await callGemini([prompt, imagePart]);
    const analysis = parseGeminiJson(result);

    console.log(`[OCR Verification] User: ${userId} | Valid: ${analysis.isValid} | Confidence: ${analysis.confidence}`);

    if (analysis.isValid && analysis.confidence >= 0.6) {
      // Auto-approve: update user in MongoDB
      await User.findByIdAndUpdate(userId, {
        isVerified: true,
        isPendingVerification: false,
        ...(analysis.extractedName && { fullName: analysis.extractedName }),
        ...(analysis.detectedSkills?.length && {
          $addToSet: { skills: { $each: analysis.detectedSkills } }
        })
      });

      return {
        success: true,
        message: `Verified! Document recognized as "${analysis.documentType}".`,
        detectedSkills: analysis.detectedSkills,
        ocrText: analysis.ocrText,
        confidence: analysis.confidence
      };
    } else {
      return {
        success: false,
        message: `Verification failed: ${analysis.reason}`,
        ocrText: analysis.ocrText,
        confidence: analysis.confidence
      };
    }
  } catch (error) {
    console.error('[OCR Verification Error]', error.message);
    // If Gemini parsing fails, return a descriptive error
    throw new Error(`AI OCR failed: ${error.message}`);
  }
}

/**
 * Simple text-based reverification — for already-extracted text (re-checks)
 */
async function verifyTextCredential(userId, ocrText, role) {
  const prompt = `Given this OCR-extracted text from a document, verify if this person qualifies as a "${role}" for humanitarian work in Kalyān, Maharashtra:

"${ocrText}"

Available skills list: ${KALYAN_SKILL_CATEGORIES.join(', ')}

Return JSON only:
{
  "isValid": true/false,
  "reason": "explanation",
  "detectedSkills": ["skill1"],
  "confidence": 0.0-1.0
}`;

  const result = await callGemini(prompt);
  return parseGeminiJson(result);
}

module.exports = { verifyDocumentWithOCR, verifyTextCredential, KALYAN_SKILL_CATEGORIES };
