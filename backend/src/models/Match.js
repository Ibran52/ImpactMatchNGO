const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  needId: { type: mongoose.Schema.Types.ObjectId, ref: 'Need', required: true },
  volunteerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { 
    type: String, 
    enum: ['proposed', 'accepted', 'completed', 'rejected'], 
    default: 'proposed' 
  },
  distance: Number, // In kilometers
  acceptedAt: Date,
  completedAt: Date
}, { timestamps: true });

matchSchema.index({ needId: 1, volunteerId: 1 }, { unique: true });

module.exports = mongoose.model('Match', matchSchema);
