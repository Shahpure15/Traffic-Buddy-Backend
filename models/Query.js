const mongoose = require('mongoose');

const querySchema = new mongoose.Schema({
  user_id: String,
  user_name: String,
  query_type: String,
  vehicle_number: String,
  name: String,
  email: String,
  phone: String,
  location: { 
    latitude: Number, 
    longitude: Number,
    address: String
  },
  description: String,
  photo_url: String,
  status: { type: String, default: 'Pending' },
  timestamp: { type: Date, default: Date.now },
  resolution_note: String,
  resolved_at: Date,
  resolution_image_url: String, // New field for resolution proof images
  division: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Division' 
  },
  divisionName: String, // For quick reference without joins
  divisionNotified: { type: Boolean, default: false },
  divisionOfficersNotified: [{ phone: String, timestamp: Date }]
});

module.exports = mongoose.model('Query', querySchema);

// const mongoose = require('mongoose');

// const querySchema = new mongoose.Schema({
//   user_id: String,
//   user_name: String,
//   query_type: String,
//   vehicle_number: String,
//   name: String,
//   email: String,
//   phone: String,
//   location: { 
//     latitude: Number, 
//     longitude: Number,
//     address: String
//   },
//   description: String,
//   photo_url: String,
//   status: { type: String, default: 'Pending' },
//   timestamp: { type: Date, default: Date.now },
//   resolution_note: String,
//   resolved_at: Date
// });

// module.exports = mongoose.model('Query', querySchema);