const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const admin = require('../config/firebase');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

exports.register = async (req, res, next) => {
  try {
    const { email, password, role, fullName, orgName, address, latitude, longitude } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      password: hashedPassword,
      role: role || 'volunteer',
      fullName,
      orgName: role === 'ngo' ? orgName : undefined,
      address,
      currentLocation: (latitude && longitude) ? {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      } : undefined,
      isVerified: false
    });

    res.status(201).json({
      _id: user._id,
      email: user.email,
      role: user.role,
      token: generateToken(user._id)
    });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({
        _id: user._id,
        email: user.email,
        role: user.role,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    next(error);
  }
};

exports.firebaseLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email } = decodedToken;

    let user = await User.findOne({ firebaseUid: uid });
    const isAdminEmail = email === 'mdibransiddique02@gmail.com';

    if (!user) {
      user = await User.create({
        firebaseUid: uid,
        email,
        role: isAdminEmail ? 'admin' : 'volunteer',
        isVerified: isAdminEmail
      });
    } else if (isAdminEmail && user.role !== 'admin') {
      user.role = 'admin';
      user.isVerified = true;
      await user.save();
    }

    res.json({
      _id: user._id,
      email: user.email,
      role: user.role,
      token: generateToken(user._id)
    });
  } catch (error) {
    next(error);
  }
};
