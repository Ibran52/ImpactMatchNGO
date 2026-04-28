const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcrypt');
const { protect } = require('../middleware/auth.middleware');
const User = require('../models/User');
const Need = require('../models/Need');
const { verifyDocumentWithOCR } = require('../services/verification.service');

const upload = multer({ storage: multer.memoryStorage() });

// Get my profile
router.get('/profile', protect, async (req, res) => {
  res.json(req.user);
});

// Update my profile
router.patch('/profile', protect, async (req, res) => {
  try {
    // Prevent overwriting sensitive fields
    const { password, role, isVerified, ...safeData } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, safeData, { new: true });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Change password
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Both current and new passwords are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user || !user.password) {
      return res.status(400).json({ message: 'Password change not available for social login accounts.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Password changed successfully!' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update my current location
router.patch('/location', protect, async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Latitude and longitude are required.' });
    }
    const updateData = {
      currentLocation: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      }
    };
    if (address) updateData.address = address;
    
    const user = await User.findByIdAndUpdate(req.user._id, updateData, { new: true });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Join a task (volunteer applies to a need)
router.post('/join-task/:needId', protect, async (req, res) => {
  try {
    const need = await Need.findById(req.params.needId);
    if (!need) return res.status(404).json({ message: 'Task not found.' });
    if (need.status === 'assigned') {
      return res.status(400).json({ message: 'This task has already been assigned.' });
    }
    if (need.status === 'completed') {
      return res.status(400).json({ message: 'This task is already completed.' });
    }

    // Assign the volunteer to the need
    need.assignedVolunteer = req.user._id;
    need.status = 'assigned';
    await need.save();

    // Mark volunteer as busy
    await User.findByIdAndUpdate(req.user._id, { isAvailable: false });

    res.json({ message: 'You have been assigned to this task!', need });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get my assigned tasks
router.get('/my-tasks', protect, async (req, res) => {
  try {
    const tasks = await Need.find({ assignedVolunteer: req.user._id })
      .sort({ createdAt: -1 })
      .populate('ngoUserId', 'orgName fullName');
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * POST /users/verify
 * Upload a document image → Gemini OCR analyzes it →
 * auto-verifies the user and extracts skills.
 */
router.post('/verify', protect, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a document image (JPEG/PNG/PDF).' });
    }

    const result = await verifyDocumentWithOCR(
      req.user._id,
      req.file.buffer,
      req.file.mimetype,
      req.user.role
    );

    res.json(result);
  } catch (error) {
    console.error('[Verify Route Error]', error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
