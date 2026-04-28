const express = require('express');
const router = express.Router();
const { register, login, firebaseLogin } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/login', login);
router.post('/firebase', firebaseLogin);

module.exports = router;
