const mongoose = require('mongoose');

const EmailRecordSchema = new mongoose.Schema({
    emails: { type: String, required: true },
    subject: { type: String, required: true },
    queryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Query', required: true },
    division: { type: String, required: true },
    departmentName: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
}, { timestamps: true });


module.exports = mongoose.model('EmailRecord', EmailRecordSchema);