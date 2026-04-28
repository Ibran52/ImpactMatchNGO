const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, select: false },
  role: { 
    type: String, 
    enum: ['admin', 'ngo', 'volunteer'], 
    default: 'volunteer' 
  },
  isVerified: { type: Boolean, default: false },
  isPendingVerification: { type: Boolean, default: false },
  
  // NGO DEEP VERIFICATION FIELDS
  trustDeedUrl: String,
  ngoDarpanId: String,
  certificate80GUrl: String,
  certificate12AUrl: String,
  auditReportUrl: String,
  panCardUrl: String,
  bankDetails: String,
  fcraStatus: String,
  sitePhotos: [String],

  // VOLUNTEER VERIFICATION FIELDS
  aadhaarNumber: String,
  aadhaarUrl: String,
  profilePhotoUrl: String,
  skillCertificates: [String],
  isAvailable: { type: Boolean, default: true },
  
  // COMMON FIELDS
  fullName: String,
  orgName: String,
  phone: String,
  qualifications: String,
  availability: String,
  skills: [String],
  address: String,
  currentLocation: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number] }
  },
  verificationSubmittedAt: Date,
}, { timestamps: true });

// Only index documents that have valid coordinates
userSchema.index(
  { currentLocation: '2dsphere' },
  { partialFilterExpression: { 'currentLocation.coordinates': { $exists: true } } }
);

module.exports = mongoose.model('User', userSchema);
