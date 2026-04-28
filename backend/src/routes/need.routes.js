const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/auth.middleware');
const { 
  createNeed, 
  getNeeds, 
  getNeedById, 
  updateNeed, 
  deleteNeed, 
  processOCR,
  completeTask
} = require('../controllers/need.controller');

const upload = multer({ storage: multer.memoryStorage() });

router.get('/', protect, getNeeds);
router.get('/:id', getNeedById);
router.post('/', protect, upload.single('file'), createNeed);
router.patch('/:id', protect, updateNeed);
router.delete('/:id', protect, deleteNeed);
router.post('/analyze', protect, upload.single('file'), processOCR);
router.post('/:id/complete', protect, upload.any(), completeTask);

module.exports = router;
