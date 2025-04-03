const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  user_id: String,
  current_state: String,
  last_option: String,
  language: { type: String, default: 'en' },
  last_interaction: { type: Date, default: Date.now },
  user_name: String
});

module.exports = mongoose.model('Session', sessionSchema);