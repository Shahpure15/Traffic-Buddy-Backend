const TeamApplication = require('../models/TeamApplication');
const Session = require('../models/Session');
const { uploadImageToR2 } = require('../utils/imageupload');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
const { getText } = require('../utils/language');
const { Division } = require('../models/Division'); 
const mongoose = require('mongoose'); 


// Create a new application session
exports.createApplicationSession = async (req, res) => {
  try {
    const { userId, language = 'en' } = req.body;
    
    // Check if user exists in session
    const session = await Session.findOne({ user_id: userId });
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'User session not found'
      });
    }
    
    // Generate unique session ID for the application
    const sessionId = `join_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // Calculate session expiry (24 hours from now)
    const sessionExpires = new Date();
    sessionExpires.setHours(sessionExpires.getHours() + 24);
    
    // Generate the form URL
    const formUrl = `${process.env.SERVER_URL}/join-team.html?userId=${encodeURIComponent(userId)}&sessionId=${sessionId}`;
    
    // Send WhatsApp message with form link
    await sendWhatsAppMessage(
      userId,
      getText('JOIN_FORM_LINK', language, formUrl)
    );
    
    return res.status(200).json({
      success: true,
      message: 'Join form link sent',
      sessionId,
      formUrl
    });
  } catch (error) {
    console.error('Error creating application session:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Process form submission
exports.submitApplication = async (req, res) => {
  try {
    const { 
      userId, 
      sessionId, 
      fullName, 
      division,
      motivation,
      address,
      phone,
      email,
      aadharNumber,
      profession,
      hasCourtCase,
      courtCaseDescription
    } = req.body;
    
    // Validate required fields
    if (!userId || !sessionId || !fullName || !division || !motivation || !address || !phone || !email || !aadharNumber || !profession) {
      return res.status(400).json({
        success: false,
        error: 'All required fields must be filled'
      });
    }
    
    // Validate that name contains only letters (allowing spaces, dots, and basic characters)
    const nameRegex = /^[A-Za-z\s.'()-]+$/;
    if (!nameRegex.test(fullName)) {
      return res.status(400).json({
        success: false,
        error: 'Name should only contain letters and basic characters'
      });
    }
    
    // Check if there's a valid user session
    const userSession = await Session.findOne({ user_id: userId });
    if (!userSession) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Calculate session expiry (24 hours from now)
    const sessionExpires = new Date();
    sessionExpires.setHours(sessionExpires.getHours() + 24);
    
    // Process aadhar document if provided
    let aadharDocumentUrl = null;
    if (req.file) {
      const imageBuffer = req.file.buffer;
      const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
      aadharDocumentUrl = await uploadImageToR2(base64Image, 'TrafficBuddyDocs');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Aadhar document is required'
      });
    }
    
    // Validate court case description if hasCourtCase is true
    const hasCourt = hasCourtCase === 'true' || hasCourtCase === true;
    if (hasCourt && !courtCaseDescription) {
      return res.status(400).json({
        success: false,
        error: 'Court case description is required when "Has court case" is selected'
      });
    }
    
    // Create new application
    const application = new TeamApplication({
      user_id: userId,
      user_name: userSession.user_name || 'Unknown',
      full_name: fullName,
      division,
      motivation,
      address,
      phone,
      email,
      aadhar_number: aadharNumber,
      aadhar_document_url: aadharDocumentUrl,
      profession: profession,
      has_court_case: hasCourt,
      court_case_description: hasCourt ? courtCaseDescription : '',
      status: 'Pending',
      session_id: sessionId,
      session_expires: sessionExpires
    });
    
    await application.save();
    
    // Send confirmation message via WhatsApp
    await sendWhatsAppMessage(
      userId,
      getText('JOIN_APPLICATION_RECEIVED', userSession.language || 'en', fullName)
    );
    
    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      applicationId: application._id
    });
  } catch (error) {
    console.error('Error submitting application:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.'
    });
  }
};

// Get all applications with pagination and filtering
exports.getAllApplications = async (req, res) => {
  try {
      let { page = 1, limit = 10, status, division, month, year, search, hasCourtCase } = req.query;

      // Convert page and limit to numbers, handle potential non-numeric values
      page = parseInt(page, 10);
      limit = parseInt(limit, 10);
      if (isNaN(page) || page < 1) page = 1;
      // Allow fetching all records if limit is -1 or non-positive (for download)
      const fetchAll = limit <= 0;
      if (isNaN(limit) || (limit <= 0 && !fetchAll)) limit = 10; // Default limit if invalid and not fetching all

      const skip = fetchAll ? 0 : (page - 1) * limit;

      let filter = {};
      if (status) {
          // Make status check case-insensitive by capitalizing first letter
          const normalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
          if (['Pending', 'Approved', 'Rejected'].includes(normalizedStatus)) {
              filter.status = normalizedStatus;
          }
      }
      
      if (division) {
        filter.division = new RegExp('^' + division.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'); // Escape regex special chars
        console.log(`Applying case-insensitive division filter: ${filter.division}`);
      }
      
      // Add filter for court case if specified
      if (hasCourtCase !== undefined) {
        filter.has_court_case = hasCourtCase === 'true';
      }

      // Add month and year filtering based on 'applied_at'
      if (month && year) {
          const monthInt = parseInt(month, 10);
          const yearInt = parseInt(year, 10);

          if (!isNaN(monthInt) && !isNaN(yearInt) && monthInt >= 1 && monthInt <= 12) {
              // Create date range for the selected month
              const startDate = new Date(yearInt, monthInt - 1, 1); // Month is 0-indexed
              const endDate = new Date(yearInt, monthInt, 0, 23, 59, 59, 999); // Last day of the month

              filter.applied_at = {
                  $gte: startDate,
                  $lte: endDate,
              };
          } else {
              console.warn(`Invalid month (${month}) or year (${year}) provided for filtering.`);
          }
      }

      // Add search filter (case-insensitive, matches name, email, phone, etc.)
      if (search && search.trim() !== "") {
          const searchRegex = new RegExp(search.trim(), "i");
          filter.$or = [
              { full_name: searchRegex },
              { user_name: searchRegex },
              { email: searchRegex },
              { phone: searchRegex },
              { motivation: searchRegex },
              { aadhar_number: searchRegex },
              { division: searchRegex }
          ];
      }

      const query = TeamApplication.find(filter).sort({ applied_at: -1 });

      let applications;
      let total;

      if (fetchAll) {
          applications = await query;
          total = applications.length; // Total is just the count of fetched items
      } else {
          applications = await query.skip(skip).limit(limit);
          total = await TeamApplication.countDocuments(filter); // Count matching documents for pagination
      }

      return res.status(200).json({
          success: true,
          count: applications.length,
          total,
          totalPages: fetchAll ? 1 : Math.ceil(total / limit),
          currentPage: fetchAll ? 1 : page,
          data: applications
      });
  } catch (error) {
      console.error('Error fetching applications:', error);
      return res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
      });
  }
};

exports.getApplicationById = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await TeamApplication.findById(id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    return res.status(200).json({
      success: true,
      data: application
    });
  } catch (error) {
    console.error('Error fetching application:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.getApplicationStatistics = async (req, res) => {
  try {
    const { division } = req.query;
    let filter = {};
    if (division) filter.division = division;

    const totalApplications = await TeamApplication.countDocuments(filter);
    const pendingApplications = await TeamApplication.countDocuments({ ...filter, status: 'Pending' });
    const approvedApplications = await TeamApplication.countDocuments({ ...filter, status: 'Approved' });
    const rejectedApplications = await TeamApplication.countDocuments({ ...filter, status: 'Rejected' });

    return res.status(200).json({
      success: true,
      total: totalApplications,
      pending: pendingApplications,
      approved: approvedApplications,
      rejected: rejectedApplications
    });

  } catch (error) {
    console.error('Error fetching application statistics:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
}

// Update application status
exports.updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, verification_notes, verified_by } = req.body;

    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const application = await TeamApplication.findById(id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    application.status = status;
    application.verification_notes = verification_notes || '';
    
    if (status !== 'Pending') {
      application.processed_at = new Date();
      application.verified_by = verified_by;
    }

    await application.save();

    // Send status update via WhatsApp
    const userSession = await Session.findOne({ user_id: application.user_id });
    const language = userSession?.language || 'en';
    
    await sendWhatsAppMessage(
      application.user_id,
      getText(`TEAM_APPLICATION_${status.toUpperCase()}`, language, application.full_name, verification_notes || '')
    );

    return res.status(200).json({
      success: true,
      message: `Application ${status.toLowerCase()} successfully`,
      data: application
    });
  } catch (error) {
    console.error('Error updating application:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};
