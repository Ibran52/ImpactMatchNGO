const mongoose = require('mongoose');

const needSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['water', 'food', 'medical', 'sanitation', 'other'], 
    default: 'other' 
  },
  description: String,
  locationName: String,
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [73.1305, 19.2403] } // [longitude, latitude] default Kalyan
  },
  urgency: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  urgencyScore: { type: Number, min: 1, max: 10, default: 5 },
  requiredSkills: [{ type: String }],
  ngoUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { 
    type: String, 
    enum: ['pending', 'assigned', 'completed'], 
    default: 'pending' 
  },
  assignedVolunteer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completionData: {
    details: String,
    numberOfPeople: Number,
    proofImageBase64: String,
    departmentLetterBase64: String,
    submittedAt: Date
  }
}, { timestamps: true });

needSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Need', needSchema);
