const jwt = require('jsonwebtoken');
const admin = require('../config/firebase');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      
      // First try to verify as Firebase token if it's from client
      // Or verify as local JWT if it's our own
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id);
      } catch (e) {
        // If local JWT fails, try Firebase
        const firebaseUser = await admin.auth().verifyIdToken(token);
        req.user = await User.findOne({ firebaseUid: firebaseUser.uid });
      }

      if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: `User role ${req.user.role} is not authorized to access this route` });
    }
    next();
  };
};

module.exports = { protect, authorize };
