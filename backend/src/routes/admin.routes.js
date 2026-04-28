const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');
const { 
  getDashboardStats, 
  getUsers, 
  verifyUser, 
  deleteUser 
} = require('../controllers/admin.controller');

router.use(protect, authorize('admin'));

router.get('/dashboard/stats', getDashboardStats);
router.get('/users', getUsers);
router.patch('/users/:id/verify', verifyUser);
router.delete('/users/:id', deleteUser);

module.exports = router;
