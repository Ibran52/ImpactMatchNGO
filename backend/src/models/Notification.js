const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['match', 'match_found', 'need_updated', 'verification_success', 'system_alert'], 
    required: true 
  },
  isRead: { type: Boolean, default: false },
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
