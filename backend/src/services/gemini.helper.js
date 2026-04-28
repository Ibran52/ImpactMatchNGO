const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Centralized Gemini API helper with automatic retry + exponential backoff.
 * Handles 429 rate-limit errors gracefully.
 */

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Preferred model order — if one is rate-limited we can try the next
const MODEL_FALLBACK_ORDER = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

/**
 * Call Gemini with automatic retry on 429 errors.
 *
 * @param {string|Array} prompt - The prompt text or multi-part array (for vision)
 * @param {object} options
 * @param {string}  options.modelName  - Override the model (default: first in fallback list)
 * @param {number}  options.maxRetries - Max retry attempts (default: 3)
 * @param {number}  options.baseDelay  - Base delay in ms (default: 5000)
 * @returns {object} The Gemini result object
 */
async function callGemini(prompt, options = {}) {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelay ?? 5000;
  const models = options.modelName
    ? [options.modelName]
    : MODEL_FALLBACK_ORDER;

  let lastError = null;

  for (const modelName of models) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        return result; // Success!
      } catch (err) {
        lastError = err;
        const is429 = err.message?.includes('429') ||
                       err.message?.includes('Too Many Requests') ||
                       err.message?.includes('quota');
        const is503 = err.message?.includes('503') ||
                       err.message?.includes('overloaded');

        if (is429 || is503) {
          // Parse retry delay from error message if available
          const retryMatch = err.message?.match(/retry\s*(?:in|after|Delay[":]*)\s*"?(\d+)/i);
          const serverDelay = retryMatch ? parseInt(retryMatch[1], 10) * 1000 : 0;
          const delay = Math.max(serverDelay, baseDelay * Math.pow(2, attempt));

          if (attempt < maxRetries) {
            console.warn(
              `[Gemini] ${modelName} rate-limited (attempt ${attempt + 1}/${maxRetries + 1}). ` +
              `Retrying in ${(delay / 1000).toFixed(1)}s...`
            );
            await sleep(delay);
          } else {
            console.warn(`[Gemini] ${modelName} exhausted all retries. Trying next model...`);
          }
        } else {
          // Non-rate-limit error — don't retry
          throw err;
        }
      }
    }
  }

  // All models and retries exhausted
  console.error('[Gemini] All models exhausted. Returning null for graceful fallback.');
  throw lastError || new Error('All Gemini models rate-limited. Please try again later.');
}

/**
 * Parse Gemini response text, stripping markdown fences.
 */
function parseGeminiJson(result) {
  const text = result.response.text().trim();
  const cleanJson = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleanJson);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { genAI, callGemini, parseGeminiJson, MODEL_FALLBACK_ORDER };
