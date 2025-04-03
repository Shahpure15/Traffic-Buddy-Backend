// Division Schema
const mongoose = require('mongoose');

const DivisionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  boundaries: {
    type: { type: String, default: 'Polygon' },
    coordinates: {
      type: [[[Number]]], // GeoJSON polygon format: array of linear rings
      required: true
    }
  },
  officers: [{
    name: { type: String, required: true },
    phone: { type: String, required: true }, // WhatsApp number with country code
    alternate_phone: { type: String },
    email: { type: String },
    post: { type: String },
    isActive: { type: Boolean, default: true }, // True if currently assigned, false if relieved
    joinedAt: { type: Date, default: Date.now },
    relievedAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'relieved'], default: 'active' }
  }],
  dashboard_url: String, // Optional: If each division has a separate access URL
  dashboard_credentials: {
    username: String,
    password: String
  },
});

module.exports = mongoose.model('Division', DivisionSchema);

// Add geospatial index
DivisionSchema.index({ "boundaries": "2dsphere" });

const Division = mongoose.model('Division', DivisionSchema);

const insertDighiAlandiDivision = async () => {
  try {
    // Define coordinates as [longitude, latitude] pairs (GeoJSON format)
    const coordinates = [
      [73.8556601, 18.6805209],
      [73.8553479, 18.6290241],
      [73.8435033, 18.57322],
      [73.8501904, 18.5741585],
      [73.8541463, 18.5820067],
      [73.8627294, 18.5837965],
      [73.8769773, 18.5715928],
      [73.881191, 18.5755842],
      [73.8854825, 18.5838826],
      [73.8966405, 18.5946212],
      [73.9261788, 18.5968977],
      [73.926596, 18.6020731],
      [73.9328736, 18.6034055],
      [73.9383668, 18.6099944],
      [73.9436727, 18.6131249],
      [73.9518036, 18.6235021],
      [73.9546746, 18.6299222],
      [73.9605905, 18.6368306],
      [73.9665606, 18.6359204],
      [73.9684934, 18.6333382],
      [73.9632577, 18.6256115],
      [73.9642018, 18.6199993],
      [73.9689513, 18.6187993],
      [73.972585, 18.6200394],
      [73.9784497, 18.6248795],
      [73.984372, 18.637974],
      [73.9848012, 18.6444803],
      [73.9834004, 18.6480151],
      [73.9788514, 18.6498855],
      [73.9779923, 18.6547671],
      [73.9832562, 18.6596063],
      [73.9901227, 18.6627777],
      [73.9896211, 18.6662178],
      [73.9829988, 18.6761946],
      [73.9860028, 18.6799349],
      [73.9926118, 18.67839],
      [73.9961309, 18.6726982],
      [74.0025252, 18.6785119],
      [73.9974183, 18.688716],
      [74.0020532, 18.6964399],
      [73.999125, 18.69417],
      [73.99964, 18.698236],
      [73.997924, 18.699699],
      [73.996035, 18.704577],
      [73.998953, 18.707829],
      [74.001528, 18.715633],
      [73.999468, 18.715796],
      [73.994662, 18.712219],
      [73.990027, 18.711731],
      [73.984019, 18.717096],
      [73.9792247, 18.71651],
      [73.973033, 18.716771],
      [73.967196, 18.721486],
      [73.952948, 18.722624],
      [73.949172, 18.727826],
      [73.948313, 18.731891],
      [73.945738, 18.734492],
      [73.942477, 18.733191],
      [73.939902, 18.72929],
      [73.937842, 18.725388],
      [73.93355, 18.720673],
      [73.929431, 18.719372],
      [73.922187, 18.7181826],
      [73.916213, 18.717584],
      [73.906943, 18.714983],
      [73.900248, 18.713844],
      [73.892836, 18.7115783],
      [73.886515, 18.709942],
      [73.87982, 18.703276],
      [73.8760137, 18.6968894],
      [73.8750159, 18.6950754],
      [73.8733208, 18.6920875],
      [73.8726234, 18.6905986],
      [73.8720065, 18.6882865],
      [73.871493, 18.686442],
      [73.866686, 18.684491],
      [73.8635425, 18.680052],
      [73.859101, 18.6794279],
      [73.8557536, 18.6815419],
      [73.8556601, 18.6805209]
    ];

    const dighiAlandiDivision = new Division({
      name: "DIGHI ALANDI",
      code: "DIGA",
      boundaries: {
        type: "Polygon",
        coordinates: [[...coordinates]] // Wrap in an array for GeoJSON Polygon format
      },
      officers: [
        {
          name: "PI NANDURKAR",
          phone: "+918180094312",
          isActive: true
        }
      ],
      dashboard_url: "",
      dashboard_credentials: {
        username: "dighialandi_admin",
        password: "Admin@dighialandi#123"
      },
      email: "dighialanditraffic@gmail.com",
      alternate_phone: "+918180094312"
    });

    const savedDivision = await dighiAlandiDivision.save();
    console.log("Dighi Alandi division inserted successfully:", savedDivision);
    return savedDivision;
  } catch (error) {
    console.error("Error inserting Dighi Alandi division:", error);
    throw error;
  }
};

module.exports = {
  Division,
  insertDighiAlandiDivision
};