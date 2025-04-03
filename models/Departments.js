const mongoose = require('mongoose');

const DepartmentsSchema = new mongoose.Schema({
    name: { type: String, required: true },
    emails: { type: String, required: true }
});

module.exports = mongoose.model('Departments', DepartmentsSchema);