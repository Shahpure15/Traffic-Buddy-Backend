const DEEP_LINK_URL = 'gpsmapcamera://open';
const PLAY_STORE_LINK = 'https://play.google.com/store/apps/details?id=com.gpsmapcamera.geotagginglocationonphoto';
const crypto = require('crypto');
const ReportLink = require('../models/ReportLink');

module.exports = {
  /**
   * Get the deep link or Play Store link based on the user's device.
   * @returns {string} The deep link URL to be used in WhatsApp.
   */
  getCameraAppLink: () => {
    return DEEP_LINK_URL;
  },

  /**
   * Get the instruction message for the user with just the raw links
   * which WhatsApp will automatically make clickable.
   * @returns {string} The instruction message with clickable links.
   */
  getInstructionMessage: () => {
    // WhatsApp automatically makes URLs clickable, so we just provide them directly
    return `To ensure your images contain GPS data, please use the GPS Map Camera app:

1. Open the app and capture the image or download it from Play Store: ${PLAY_STORE_LINK}

2. After capturing the image, share it with us on WhatsApp. with description and location.`;
  },

  /**
   * Get a message with multiple link options
   * @returns {string} Text with multiple opening strategies
   */
  getUniversalLink: () => {
    return `Try opening GPS Map Camera:

Direct link: ${DEEP_LINK_URL}

Play Store: ${PLAY_STORE_LINK}`;
  },
  
  /**
   * Get the server URL based on environment variables or default
   * @returns {string} The server URL
   */
  getServerUrl: () => {
    return process.env.SERVER_URL || 'http://localhost:3000';
  },
  
  /**
 * Generate a URL for capture with user ID and report type parameters
 * @param {string} userId - The user's ID
 * @param {string} reportType - The type of report being created
 * @returns {string} The capture URL with query parameters
 */
getCaptureUrl: async function(userId, reportType) {
  try {
    console.log('Creating capture URL for:', { userId, reportType });
    
    // Generate a unique linkId
    const linkId = crypto.randomBytes(16).toString('hex');
    console.log('Generated linkId:', linkId);
    
    // Clean userId consistently
    const cleanUserId = userId.replace(/whatsapp:[ ]*/i, '').replace(/^\+/, '');
    console.log('Cleaned userId for storage:', cleanUserId);
    
    // Store the link in database
    const newLink = new ReportLink({
      linkId,
      userId: cleanUserId,
      reportType,
      createdAt: new Date()
    });
    
    await newLink.save();
    console.log('Saved link to database:', newLink);
    
    // Get the server URL from environment
    const serverUrl = process.env.SERVER_URL || 'https://yourserver.com';
    
    // Use suggestion-capture.html for suggestion reports (type 7)
    // and regular capture.html for all other types
    const capturePageUrl = reportType === '7' 
      ? `${serverUrl}/suggestion-capture.html` 
      : `${serverUrl}/capture.html`;
    
    // Use the original userId in URL for consistency with WhatsApp
    return `${capturePageUrl}?userId=${userId}&reportType=${reportType}&linkId=${linkId}`;
  } catch (error) {
    console.error('Error creating capture URL:', error);
    throw error;
  }
},

  /**
   * Get optimized instruction message with clickable capture link
   * @param {string} captureUrl - The URL to the capture page
   * @param {string} language - Language code ('en' or 'mr')
   * @returns {string} Formatted message with visible clickable link
   */
  getReportInstructionMessage: (captureUrl, language = 'en') => {
    if (language === 'mr') {
      return `📸 *अहवाल सादर करण्यासाठी खाली दिलेल्या लिंकवर क्लिक करा:*
      
📱 *📷 अहवाल सादर करा 📷*
👇👇👇👇👇👇👇👇
${captureUrl}
👆👆👆👆👆👆👆👆

वरील लिंकवर टॅप करून, आपले स्थान आणि फोटो सादर करा.
कृपया यशस्वी अहवाल सादर करण्यासाठी GPS स्थान प्रवेश परवानगी द्या.`;
    }
    
    return `📸 *Click the link below to submit your report:*
    
📱 *📷 CAPTURE & REPORT 📷*
👇👇👇👇👇👇👇👇
${captureUrl}
👆👆👆👆👆👆👆👆

Tap the link above to submit your location and photo.
Please make sure to allow location access for Successful reporting.`;
  },
  
  /**
   * Get a simple link message that's likely to be clickable in WhatsApp
   * @param {string} captureUrl - The URL to the capture page
   * @param {string} reportTypeName - Name of the report type
   * @param {string} language - Language code ('en' or 'mr')
   * @returns {string} Simple message with link
   */
  getSimpleReportLink: (captureUrl, reportTypeName, language = 'en') => {
    if (language === 'mr') {
      return `*${reportTypeName} अहवाल*\n\n${captureUrl}\n\nवरील लिंकवर क्लिक करा.`;
    }
    return `*${reportTypeName} Report*\n\n${captureUrl}\n\nClick on the link above.`;
  }
};