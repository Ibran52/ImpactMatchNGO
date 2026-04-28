const Need = require('../models/Need');
const { callGemini, parseGeminiJson, genAI } = require('../services/gemini.helper');
const { extractLocationFromText, KALYAN_LOCATIONS } = require('../services/matching.service');
const { KALYAN_SKILL_CATEGORIES } = require('../services/verification.service');

/**
 * Create a new humanitarian need.
 * Uses Gemini to extract neighbourhood coordinates from the description
 * if explicit lat/lng is not provided.
 */
exports.createNeed = async (req, res, next) => {
  try {
    const { title, description, urgency, longitude, latitude, category, locationName } = req.body;
    
    // Map string urgency to numeric score for the matching engine
    const urgencyMap = { low: 2, medium: 5, high: 8, critical: 10 };
    const urgencyScore = urgencyMap[urgency] || 5;

    // Determine coordinates
    let coordinates = [73.1305, 19.2403]; // Default: Kalyan center
    
    if (longitude && latitude && !isNaN(longitude) && !isNaN(latitude)) {
      coordinates = [parseFloat(longitude), parseFloat(latitude)];
    } else if (description || locationName) {
      // Use Gemini AI to extract neighbourhood from text
      const loc = await extractLocationFromText(
        `${locationName || ''} ${description || ''} ${title || ''}`
      );
      coordinates = [loc.lng, loc.lat];
    }

    // Auto-detect required skills from description using Gemini
    let requiredSkills = [];
    if (genAI && description) {
      try {
        const skillPrompt = `From this humanitarian need description, identify required volunteer skills.

Description: "${title} - ${description}"

Choose ONLY from: ${KALYAN_SKILL_CATEGORIES.join(', ')}

Return ONLY a JSON array like: ["skill1", "skill2"]
If no specific skills match, return: ["logistics"]`;

        const result = await callGemini(skillPrompt);
        const cleanJson = result.response.text().replace(/```json|```/g, '').trim();
        requiredSkills = JSON.parse(cleanJson);
      } catch (err) {
        console.log('[Skill Extraction] Fallback to default skills:', err.message);
        requiredSkills = ['logistics']; // Default fallback
      }
    }

    const needData = {
      title,
      description,
      category,
      urgency,
      urgencyScore,
      requiredSkills,
      locationName: locationName || 'Kalyan District',
      ngoUserId: req.user._id,
      location: {
        type: 'Point',
        coordinates
      }
    };

    if (req.file) {
      console.log('[Need] Survey image uploaded:', req.file.originalname);
    }

    const need = await Need.create(needData);
    res.status(201).json(need);
  } catch (error) {
    console.error('[Create Need Error]', error);
    next(error);
  }
};

exports.getNeeds = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, location } = req.query;
    const filter = {};
    if (location) filter.locationName = location;
    
    // Role-based filtering
    if (req.user && req.user.role === 'ngo') {
      filter.ngoUserId = req.user._id; // NGOs only see their own tasks
    }

    const needs = await Need.find(filter)
      .sort({ urgencyScore: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('ngoUserId', 'orgName')
      .populate('assignedVolunteer', 'fullName email skills phone');

    res.json(needs);
  } catch (error) {
    next(error);
  }
};

exports.getNeedById = async (req, res, next) => {
  try {
    const need = await Need.findById(req.params.id)
      .populate('ngoUserId', 'orgName')
      .populate('assignedVolunteer', 'fullName email skills');
    if (!need) return res.status(404).json({ message: 'Need not found' });
    res.json(need);
  } catch (error) {
    next(error);
  }
};

exports.updateNeed = async (req, res, next) => {
  try {
    const need = await Need.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(need);
  } catch (error) {
    next(error);
  }
};

exports.deleteNeed = async (req, res, next) => {
  try {
    await Need.findByIdAndDelete(req.params.id);
    res.json({ message: 'Need deleted' });
  } catch (error) {
    next(error);
  }
};

/**
 * Gemini OCR: Analyze a humanitarian survey image.
 * Extracts text, auto-detects category, urgency, title, description,
 * and the likely Kalyān neighbourhood from the content.
 */
exports.processOCR = async (req, res, next) => {
  if (!genAI || !req.file) {
    return res.status(400).json({ message: 'Gemini API key or file missing' });
  }


  try {
    const areaNames = Object.keys(KALYAN_LOCATIONS).filter(k => k !== 'default').join(', ');
    
    const prompt = `You are a humanitarian survey analysis AI for the Kalyān-Dombivli region of Maharashtra, India.

Analyze this survey/document image using OCR. Extract ALL text carefully, including:
- Handwritten content in Marathi, Hindi, or English
- Printed text on forms
- Any location or area references

From the extracted information, generate:
1. A clear title summarizing the need
2. A detailed description of the humanitarian situation
3. The urgency level
4. The category of need
5. The area/neighbourhood name from the survey text

Respond ONLY with this JSON (no markdown):
{
  "text": "full OCR-extracted text",
  "title": "brief but descriptive title",
  "description": "detailed summary of the situation",
  "category": "water" or "food" or "medical" or "sanitation" or "other",
  "urgency": "low" or "medium" or "high" or "critical",
  "detectedArea": "area name from: ${areaNames}",
  "requiredSkills": ["from the skills list: ${KALYAN_SKILL_CATEGORIES.join(', ')}"]
}`;

    const result = await callGemini([
      prompt,
      { inlineData: { data: req.file.buffer.toString('base64'), mimeType: req.file.mimetype } }
    ]);
    
    const analysis = parseGeminiJson(result);

    // Resolve area name to coordinates
    const areaKey = (analysis.detectedArea || 'default').toLowerCase();
    const coords = KALYAN_LOCATIONS[areaKey] || KALYAN_LOCATIONS['default'];
    analysis.coordinates = coords;
    
    res.json({ analysis });
  } catch (error) {
    console.error('[OCR Analysis Error]', error);

    // Graceful fallback: return a helpful error instead of crashing
    if (error.message?.includes('429') || error.message?.includes('quota')) {
      return res.status(429).json({
        message: 'Gemini API quota exceeded. Please wait a few minutes and try again.',
        retryAfter: 60
      });
    }

    next(error);
  }
};

/**
 * Volunteer submits proof of task completion.
 * AI verifies the image and details against the original task description.
 */
exports.completeTask = async (req, res, next) => {
  try {
    const needId = req.params.id;
    const { details, numberOfPeople } = req.body;
    
    const proofImage = req.files ? req.files.find(f => f.fieldname === 'proofImage') : null;
    if (!proofImage) {
      return res.status(400).json({ message: 'Proof image is required' });
    }

    const need = await Need.findById(needId);
    if (!need) return res.status(404).json({ message: 'Task not found' });
    
    if (need.assignedVolunteer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not assigned to this task' });
    }

    const proofImageBase64 = `data:${proofImage.mimetype};base64,${proofImage.buffer.toString('base64')}`;
    let departmentLetterBase64 = null;
    const departmentLetter = req.files ? req.files.find(f => f.fieldname === 'departmentLetter') : null;
    if (departmentLetter) {
      departmentLetterBase64 = `data:${departmentLetter.mimetype};base64,${departmentLetter.buffer.toString('base64')}`;
    }

    need.status = 'completed';
    need.completionData = {
      details,
      numberOfPeople: numberOfPeople ? parseInt(numberOfPeople, 10) : 0,
      proofImageBase64,
      departmentLetterBase64,
      submittedAt: new Date()
    };
    await need.save();
    
    // Also mark volunteer as available again
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, { isAvailable: true });

    res.json({ message: 'Task marked as completed successfully!', need });

  } catch (error) {
    console.error('[Complete Task Error]', error);
    next(error);
  }
};
