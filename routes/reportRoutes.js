const express = require('express');
const multer = require('multer');
const router = express.Router();
const Query = require('../models/Query');
const { uploadImageToR2 } = require('../utils/imageupload');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
const { getText } = require('../utils/language');
const Session = require('../models/Session');

// Configure multer for handling media files
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Get a specific report details
router.get('/reports/:id', async (req, res) => {
  try {
    const report = await Query.findById(req.params.id);
    
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    
    return res.status(200).json({ success: true, report });
  } catch (error) {
    console.error('Error fetching report:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update report status with resolution details
router.post('/reports/:id/resolve', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolution_note, resolver_name } = req.body;
    
    // Validate required fields
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }
    
    // If resolving or rejecting, resolver name is required
    if ((status === 'Resolved' || status === 'Rejected') && !resolver_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Your name is required when resolving or rejecting a report' 
      });
    }
    
    // Find the report
    const report = await Query.findById(id);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    
    // Update status and notes
    report.status = status;
    if (resolution_note) {
      report.resolution_note = resolution_note;
    }
    
    // Get client IP address (if available)
    const ipAddress = req.headers['x-forwarded-for'] || 
                       req.connection.remoteAddress || 
                       'Unknown';
    
    // If resolving or rejecting, add resolver information
    if (status === 'Resolved' || status === 'Rejected') {
      report.resolved_at = new Date();
      report.resolved_by = {
        name: resolver_name,
        timestamp: new Date(),
        ip_address: ipAddress
      };
    }
    
    // Handle resolution image if provided
    if (req.file) {
      const uploadedUrl = await uploadImageToR2(req.file);
      report.resolution_image_url = uploadedUrl;
    }
    
    await report.save();
    
    // Notify user via WhatsApp if they have a valid WhatsApp ID
    if (report.user_id && report.user_id.startsWith('whatsapp:')) {
      try {
        // Get user's language preference
        const userSession = await Session.findOne({ user_id: report.user_id });
        const userLanguage = userSession?.language || 'en';
        
        let statusMessage = '';
        if (status === 'Resolved') {
          statusMessage = getText('STATUS_RESOLVED', userLanguage)
            .replace('{0}', report.query_type.toLowerCase())
            .replace('{1}', `${resolution_note || 'No additional details provided.'} (Resolved by: ${resolver_name})`);
        } else if (status === 'Rejected') {
          statusMessage = getText('STATUS_REJECTED', userLanguage)
            .replace('{0}', report.query_type.toLowerCase())
            .replace('{1}', `${resolution_note || 'No reason specified.'} (Rejected by: ${resolver_name})`);
        } else if (status === 'In Progress') {
          statusMessage = getText('STATUS_IN_PROGRESS', userLanguage)
            .replace('{0}', report.query_type.toLowerCase());
        }
        
        if (statusMessage) {
          await sendWhatsAppMessage(report.user_id, statusMessage);
        }
      } catch (notifyError) {
        console.error('Error sending WhatsApp notification:', notifyError);
        // Don't fail the request if notification fails
      }
    }
    
    return res.status(200).json({ 
      success: true, 
      message: `Report status updated to ${status}` 
    });
    
  } catch (error) {
    console.error('Error resolving report:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error updating report status', 
      error: error.message 
    });
  }
});

// Get all pending reports
router.get('/reports/status/pending', async (req, res) => {
  try {
    const pendingReports = await Query.find({ status: 'Pending' }).sort('-timestamp');
    return res.status(200).json({ success: true, reports: pendingReports });
  } catch (error) {
    console.error('Error fetching pending reports:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Route to serve pending reports page
router.get('/pending-reports', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'pending-reports.html'));
});

module.exports = router;