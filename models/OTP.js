// models/OTP.js
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true
  },
  otp: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  sessionId: {
    type: String,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // OTP expires after 5 minutes
  }
});

// Compound index for faster lookups
otpSchema.index({ phone: 1, userId: 1, sessionId: 1 });

// Ensure TTL index gets created
otpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

module.exports = mongoose.model('OTP', otpSchema);