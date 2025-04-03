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
    const report = await Query.findById(req.params.id);
    
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    
    const { status, resolution_note } = req.body;
    
    // Validate status
    if (!['Pending', 'In Progress', 'Resolved', 'Rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }
    
    // Upload resolution image if provided
    let resolutionImageUrl = null;
    if (req.file) {
      const imageBuffer = req.file.buffer;
      const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
      resolutionImageUrl = await uploadImageToR2(base64Image, 'traffic_buddy_resolutions');
    }
    
    // Update the report status
    report.status = status;
    
    if (resolution_note) {
      report.resolution_note = resolution_note;
    }
    
    if (resolutionImageUrl) {
      report.resolution_image_url = resolutionImageUrl;
    }
    
    // If status is Resolved or Rejected, set resolved_at date
    if (status === 'Resolved' || status === 'Rejected') {
      report.resolved_at = new Date();
    }
    
    await report.save();
    
    // Send WhatsApp notification to the user about status change
    try {
      // Only notify for significant status changes
      if (status === 'Resolved' || status === 'Rejected' || status === 'In Progress') {
        // Get user's preferred language
        const userSession = await Session.findOne({ user_id: report.user_id });
        const userLanguage = userSession?.language || 'en';
        
        let message = '';
        // Get appropriate message based on status and language
        if (status === 'In Progress') {
          message = getText('STATUS_IN_PROGRESS', userLanguage, report.query_type);
        } else if (status === 'Resolved') {
          message = getText('STATUS_RESOLVED', userLanguage, report.query_type, resolution_note || '');
        } else if (status === 'Rejected') {
          message = getText('STATUS_REJECTED', userLanguage, report.query_type, resolution_note || '');
        }
        
        if (message) {
          await sendWhatsAppMessage(report.user_id, message);
          console.log(`Status update notification sent to user: ${report.user_id}`);
        }
      }
    } catch (notifyError) {
      console.error('Error notifying user about status change:', notifyError);
      // We don't fail the request if notification fails
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Report updated successfully' 
    });
  } catch (error) {
    console.error('Error updating report:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
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