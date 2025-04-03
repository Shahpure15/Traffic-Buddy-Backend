const mongoose = require('mongoose');
const { Division } = require('../models/Division');

// GET /current-officer
// This function retrieves the current officers of all divisions.
exports.getCurrentOfficers = async (req, res) => {
  try {
    const divisions = await Division.find();
    const officers = divisions
      .map(div => ({
        divisionId: div._id,
        divisionName: div.name,
        officer: div.officers.length ? div.officers[div.officers.length - 1] : null
      }))
      .filter(div => div.officer !== null); // Exclude divisions with no officer

    res.status(200).json({ success: true, officers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch current officers' });
  }
};

// GET /current-officer/:divisionId
// This function retrieves the current officer of a specific division by divisionId
exports.getCurrentOfficer = async (req, res) => {
  try {
    const { divisionId } = req.params;
    if (!mongoose.isValidObjectId(divisionId)) return res.status(400).json({ success: false, message: 'Invalid Division ID' });

    const division = await Division.findById(divisionId);
    if (!division) return res.status(404).json({ success: false, message: 'Division not found' });

    const currentOfficer = division.officers.length ? division.officers[division.officers.length - 1] : null;
    res.status(200).json({ success: true, currentOfficer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch officer' });
  }
};

// GET /all-officers
// GET /all-officers/:divisionId
// This function retrieves all officers of all divisions or a specific division if divisionId is provided.
exports.getAllOfficers = async (req, res) => {
  try {
    const { divisionId } = req.params;

    if (divisionId) {
      if (!mongoose.isValidObjectId(divisionId)) return res.status(400).json({ success: false, message: 'Invalid Division ID' });

      const division = await Division.findById(divisionId);
      if (!division) return res.status(404).json({ success: false, message: 'Division not found' });

      return res.status(200).json({ success: true, officers: division.officers.length });
    }

    const divisions = await Division.find();
    const officers = divisions.map(div => ({
      divisionId: div._id,
      divisionName: div.name,
      officers: div.officers
    }));
    res.status(200).json({ success: true, officers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch officers' });
  }
};

// PUT /update-officer/:divisionId
// This function updates the details of the current officer of a specific division.
exports.updateOfficer = async (req, res) => {
  try {
    const { divisionId } = req.params;
    const { name, phone, alternate_phone, email, post } = req.body;
    
    // console.log(name, phone, alternate_phone, email, post);
    // console.log(divisionId);
    
    if (!mongoose.isValidObjectId(divisionId)) return res.status(400).json({ success: false, message: 'Invalid Division ID' });
    
    const division = await Division.findById(divisionId);
    if (!division) return res.status(404).json({ success: false, message: 'Division not found' });
    
    const officer = division.officers.length ? division.officers[division.officers.length - 1] : null;
    if (!officer) return res.status(404).json({ success: false, message: 'No officer assigned' });
    
    if (name) officer.name = name;
    if (phone) officer.phone = phone;
    if (alternate_phone) officer.alternate_phone = alternate_phone;
    if (email) officer.email = email;
    if (post) officer.post = post;
    
    await division.save();
    res.status(200).json({ success: true, message: 'Officer updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update officer' });
  }
};

// POST assign-officer/:divisionId
// This function assigns a new officer to a division and automatically unassigns the current officer.
exports.assignOfficer = async (req, res) => {
  try {
    const { divisionId } = req.params;
    const { name, phone, alternate_phone, email, post } = req.body;
    // console.log(name, phone, alternate_phone, email, post);
    // console.log(divisionId);
    
    if (!name || !phone) return res.status(400).json({ success: false, message: 'Name and phone required' });
    if (!mongoose.isValidObjectId(divisionId)) return res.status(400).json({ success: false, message: 'Invalid Division ID' });
    
    const division = await Division.findById(divisionId);
    if (!division) return res.status(404).json({ success: false, message: 'Division not found' });
    
    // Unassign the current officer
    const currentOfficer = division.officers.length ? division.officers[division.officers.length - 1] : null;
    if (currentOfficer) {
      currentOfficer.isActive = false;
      currentOfficer.relievedAt = new Date();
      currentOfficer.status = 'relieved';
    }

    // Assign the new officer
    division.officers.push({
      name: name,
      phone: phone,
      alternate_phone: alternate_phone,
      email: email,
      post: post,
      isActive: true,
      joinedAt: new Date(),
      status: 'active'
    });

    await division.save();
    res.status(200).json({ success: true, message: 'Officer assigned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to assign officer' });
  }
};

// POST /unassign-officer/:divisionId (CURRENTLY NOT IN USE)
// This function unassigns (deactivates) the current officer of a specific division.
exports.unassignOfficer = async (req, res) => {
  try {
    const { divisionId } = req.params;
    if (!mongoose.isValidObjectId(divisionId)) return res.status(400).json({ success: false, message: 'Invalid Division ID' });

    const division = await Division.findById(divisionId);
    if (!division) return res.status(404).json({ success: false, message: 'Division not found' });

    const currentOfficer = division.officers.length ? division.officers[division.officers.length - 1] : null;
    if (!currentOfficer) return res.status(404).json({ success: false, message: 'No officer assigned' });

    currentOfficer.isActive = false;
    currentOfficer.relievedAt = new Date();
    currentOfficer.status = 'relieved';

    await division.save();
    res.status(200).json({ success: true, message: 'Officer unassigned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to unassign officer' });
  }
};

// GET /filter-officers
// Filters officers based on query params like name, phone, status, post, etc.
exports.filterOfficers = async (req, res) => {
  try {
    const { searchTerm, status } = req.query;

    const divisions = await Division.find();
    const filteredOfficers = [];

    divisions.forEach(division => {
      division.officers.forEach(officer => {
        if (
          (!searchTerm || 
          officer.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
          officer.phone.includes(searchTerm) || 
          officer.post.toLowerCase().includes(searchTerm.toLowerCase())) &&
          (!status || status == "all" || officer.status.toLowerCase() === status.toLowerCase())
        ) {
          filteredOfficers.push({
        divisionId: division._id,
        divisionName: division.name,
            officer 
          });
        }
      });
    });

    res.status(200).json({ success: true, officers: filteredOfficers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to filter officers' });
  }
};
