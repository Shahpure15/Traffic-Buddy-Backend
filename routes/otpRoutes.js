// routes/otpRoutes.js
const express = require('express');
const router = express.Router();
const otpController = require('../controllers/otpController');

// Send OTP
router.post('/send-otp', otpController.sendOTP);

// Verify OTP
router.post('/verify-otp', otpController.verifyOTP);

module.exports = router;