const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const Match = require('../models/Match');

router.get('/', protect, async (req, res) => {
  try {
    const matches = await Match.find({ volunteerId: req.user._id }).populate('needId');
    res.json(matches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch('/:id/accept', protect, async (req, res) => {
  try {
    const match = await Match.findByIdAndUpdate(req.params.id, { 
      status: 'accepted', 
      acceptedAt: new Date() 
    }, { new: true });
    res.json(match);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
