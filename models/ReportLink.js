const mongoose = require('mongoose');

const reportLinkSchema = new mongoose.Schema({
  linkId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true
  },
  reportType: {
    type: String,
    required: true
  },
  used: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // TTL index: auto-delete after 24 hours
  },
  usedAt: {
    type: Date
  }
});

// Compound index for faster lookups
reportLinkSchema.index({ linkId: 1, userId: 1 });

module.exports = mongoose.model('ReportLink', reportLinkSchema);