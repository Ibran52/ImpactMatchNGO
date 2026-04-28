const Need = require('../models/Need');
const User = require('../models/User');
const { callGemini, parseGeminiJson } = require('./gemini.helper');

/**
 * Kalyān Neighbourhood Coordinate Lookup
 * Maps known area names to lat/lng for heatmap and distance calculations.
 */
const KALYAN_LOCATIONS = {
  'kalyan east':         { lat: 19.2437, lng: 73.1355 },
  'kalyan west':         { lat: 19.2403, lng: 73.1205 },
  'kalyan station':      { lat: 19.2437, lng: 73.1294 },
  'dombivli east':       { lat: 19.2183, lng: 73.0867 },
  'dombivli west':       { lat: 19.2094, lng: 73.0718 },
  'ulhasnagar':          { lat: 19.2215, lng: 73.1645 },
  'ambernath':           { lat: 19.1935, lng: 73.1898 },
  'badlapur':            { lat: 19.1558, lng: 73.2281 },
  'titwala':             { lat: 19.2956, lng: 73.2050 },
  'shahad':              { lat: 19.2700, lng: 73.1500 },
  'vithalwadi':          { lat: 19.2206, lng: 73.1069 },
  'kopar':               { lat: 19.2000, lng: 73.0900 },
  'thakurli':            { lat: 19.2100, lng: 73.0770 },
  'katai naka':          { lat: 19.2480, lng: 73.1340 },
  'chinchpada':          { lat: 19.2550, lng: 73.1250 },
  'ganesh nagar':        { lat: 19.2350, lng: 73.1410 },
  'adharwadi':           { lat: 19.2270, lng: 73.1350 },
  'bail bazaar':         { lat: 19.2430, lng: 73.1310 },
  'default':             { lat: 19.2403, lng: 73.1305 }
};

/**
 * Use Gemini to extract the neighbourhood from raw survey text or description
 */
async function extractLocationFromText(text) {
  const areaNames = Object.keys(KALYAN_LOCATIONS).filter(k => k !== 'default').join(', ');
  
  const prompt = `You are a location extractor for the Kalyān-Dombivli region of Maharashtra, India.

From this text, identify the most likely neighbourhood or area:
"${text}"

Choose ONLY from this list: ${areaNames}

If you cannot identify a specific area, respond with "default".

Respond with ONLY the area name in lowercase, nothing else.`;

  try {
    const result = await callGemini(prompt);
    const areaName = result.response.text().trim().toLowerCase();
    return KALYAN_LOCATIONS[areaName] || KALYAN_LOCATIONS['default'];
  } catch (err) {
    console.error('[Location Extraction Error]', err.message);
    return KALYAN_LOCATIONS['default'];
  }
}

// Haversine formula for distance in km
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Gemini AI-Powered Intelligent Matching
 * 
 * Instead of a static scoring formula, Gemini analyzes:
 * - The need's description and urgency context
 * - Each candidate volunteer's skills, qualifications, and distance
 * - Returns a ranked recommendation with reasoning
 */
async function findBestVolunteerWithAI(need) {
  // Step 1: Get all available, verified volunteers
  const candidates = await User.find({
    role: 'volunteer',
    isVerified: true,
    isAvailable: true
  });

  if (!candidates || candidates.length === 0) {
    console.log(`[Matching] No available volunteers for: ${need.title}`);
    return null;
  }

  // Step 2: Filter by required skills (if any)
  let filtered = candidates;
  if (need.requiredSkills && need.requiredSkills.length > 0) {
    const skillMatched = candidates.filter(v =>
      v.skills && v.skills.some(s => need.requiredSkills.includes(s))
    );
    // If we have skill matches, prefer them; otherwise fall back to all
    if (skillMatched.length > 0) filtered = skillMatched;
  }

  // Step 3: Build candidate profiles for Gemini
  const candidateProfiles = filtered.slice(0, 15).map((v, i) => {
    let distanceKm = 'unknown';
    if (v.currentLocation?.coordinates?.length === 2 && need.location?.coordinates?.length === 2) {
      distanceKm = calculateDistance(
        need.location.coordinates[1], need.location.coordinates[0],
        v.currentLocation.coordinates[1], v.currentLocation.coordinates[0]
      ).toFixed(1) + ' km';
    }
    return `${i + 1}. ID: ${v._id} | Name: ${v.fullName || v.email} | Skills: [${(v.skills || []).join(', ')}] | Distance: ${distanceKm}`;
  });

  // Step 4: Ask Gemini to pick the best match
  const prompt = `You are the Task Assignment AI for a humanitarian disaster relief system in Kalyān, Maharashtra.

TASK DETAILS:
- Title: "${need.title}"
- Description: "${need.description || 'No description'}"
- Urgency: ${need.urgency} (Score: ${need.urgencyScore}/10)
- Required Skills: [${(need.requiredSkills || []).join(', ')}]
- Location: ${need.locationName || 'Kalyan District'}

AVAILABLE VOLUNTEERS:
${candidateProfiles.join('\n')}

ASSIGNMENT RULES:
1. Skill match is the HIGHEST priority. A volunteer with matching skills always beats one without.
2. For equal skills, prefer the CLOSEST volunteer (shortest distance).
3. For critical urgency (8-10), strongly prefer volunteers with medical or emergency skills.
4. If no one has matching skills, pick the closest volunteer who could still help.

Respond ONLY with this JSON (no markdown):
{
  "selectedId": "MongoDB ObjectId of best volunteer",
  "reason": "one-sentence explanation of why this volunteer was chosen",
  "confidence": 0.0 to 1.0
}`;

  try {
    const result = await callGemini(prompt);
    const decision = parseGeminiJson(result);

    console.log(`[AI Matching] Task "${need.title}" → Volunteer ${decision.selectedId} | Reason: ${decision.reason}`);

    // Verify the selected volunteer exists in our candidate list
    const chosen = filtered.find(v => v._id.toString() === decision.selectedId);
    return chosen || filtered[0]; // Fallback to first candidate if AI returns unknown ID
  } catch (error) {
    console.error('[AI Matching Error]', error.message);
    // Fallback: use simple distance-based scoring
    return fallbackMatch(need, filtered);
  }
}

/**
 * Fallback: Classic weighted scoring if Gemini is unavailable
 */
function fallbackMatch(need, volunteers) {
  let bestMatch = null;
  let highestScore = -Infinity;

  for (const v of volunteers) {
    let distance = 50; // Default 50km if no coords
    if (v.currentLocation?.coordinates?.length === 2 && need.location?.coordinates?.length === 2) {
      distance = calculateDistance(
        need.location.coordinates[1], need.location.coordinates[0],
        v.currentLocation.coordinates[1], v.currentLocation.coordinates[0]
      );
    }

    // Classic formula: Score = (Urgency × 10) - (Distance × 2)
    let score = (need.urgencyScore * 10) - (distance * 2);

    // Skill bonus: +20 for each matching skill
    if (need.requiredSkills && v.skills) {
      const matchCount = v.skills.filter(s => need.requiredSkills.includes(s)).length;
      score += matchCount * 20;
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = v;
    }
  }

  return bestMatch;
}

/**
 * Main auto-assignment loop — runs every 5 minutes
 */
async function runAutoAssignment() {
  console.log('--- [Matching Engine] Starting Assignment Cycle ---');
  
  try {
    const pendingNeeds = await Need.find({ status: 'pending' }).sort({ urgencyScore: -1 });

    if (pendingNeeds.length === 0) {
      console.log('[Matching Engine] No pending tasks. Cycle complete.');
      return;
    }

    console.log(`[Matching Engine] Found ${pendingNeeds.length} pending tasks.`);

    for (const need of pendingNeeds) {
      const bestVolunteer = await findBestVolunteerWithAI(need);
      
      if (bestVolunteer) {
        console.log(`[ASSIGNED] "${need.title}" → ${bestVolunteer.fullName || bestVolunteer.email}`);

        await Need.findByIdAndUpdate(need._id, {
          status: 'assigned',
          assignedVolunteer: bestVolunteer._id
        });

        await User.findByIdAndUpdate(bestVolunteer._id, {
          isAvailable: false
        });
      } else {
        console.log(`[NO MATCH] "${need.title}" — No suitable volunteers available.`);
      }
    }

    console.log('--- [Matching Engine] Cycle Complete ---');
  } catch (error) {
    console.error('[Matching Engine Error]', error.message);
  }
}

module.exports = { runAutoAssignment, findBestVolunteerWithAI, extractLocationFromText, KALYAN_LOCATIONS };
