const mongoose = require('mongoose');

const teamApplicationSchema = new mongoose.Schema({
    user_id: {
        type: String,
        required: true
    },
    user_name: {
        type: String,
        required: true
    },
    full_name: {
        type: String,
        required: true
    },
    division: {
        type: String,
        enum: [
            'CHAKAN', 'NIGDI', 'DIGHI ALANDI', 'MAHALUNGE',
            'CHINCHWAD', 'PIMPRI', 'BAVDHAN', 'WAKAD',
            'TALWADE', 'TALEGAON', 'SANGHVI', 'BHOSARI',
            'DEHUROAD', 'HINJEWADI'
        ],
        required: true
    },
    motivation: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    aadhar_number: {
        type: String,
        required: true
    },
    aadhar_document_url: {
        type: String
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    session_id: {
        type: String,
        required: true
    },
    session_expires: {
        type: Date,
        required: true
    },
    applied_at: {
        type: Date,
        default: Date.now
    },
    verification_notes: String,
    processed_at: Date,
    verified_by: String,
    note: String,
    profession: {
        type: String,
        required: true
    },
    date_of_birth: {
        type: Date,
        required: true
    },
    has_court_case: {
        type: Boolean,
        default: false
    },
    court_case_description: {
        type: String,
        default: ''
    }
}, { timestamps: true });

// Add indexes for better query performance
teamApplicationSchema.index({ user_id: 1 });
teamApplicationSchema.index({ session_id: 1 });
teamApplicationSchema.index({ status: 1 });
teamApplicationSchema.index({ division: 1 });

module.exports = mongoose.model('TeamApplication', teamApplicationSchema);
