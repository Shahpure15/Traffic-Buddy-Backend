// utils/whatsapp.js
require('dotenv').config();
const twilio = require('twilio');

// Twilio credentials
const accountSid = process.env.TWILIO_SID || 'your_account_sid';
const authToken = process.env.TWILIO_AUTH_TOKEN || 'your_auth_token';
const client = twilio(accountSid, authToken);

/**
 * Get Twilio client instance
 * @returns {Object} - Twilio client
 */
exports.getTwilioClient = () => client;

/**
 * Send a WhatsApp message using Twilio
 * @param {string} to - Recipient's WhatsApp number in format 'whatsapp:+1234567890'
 * @param {string} body - Message body text
 * @returns {Promise} - Twilio message response
 */
exports.sendWhatsAppMessage = async (to, body) => {
  try {
    if (!to) {
      console.error('Invalid recipient phone number');
      throw new Error('Invalid recipient');
    }
    
    // Import the user ID normalization if available
    let normalizedTo;
    try {
      const { normalizeUserId } = require('./userHelper');
      normalizedTo = normalizeUserId(to);
    } catch (e) {
      // Fallback if import fails
      normalizedTo = to.replace(/whatsapp:[ ]*(\+?)whatsapp:[ ]*(\+?)/i, 'whatsapp:+');
      
      // Ensure the 'to' number starts with 'whatsapp:+' and has no spaces
      if (!normalizedTo.startsWith('whatsapp:+')) {
        // Remove any existing whatsapp: prefix
        normalizedTo = normalizedTo.replace(/^whatsapp:[ ]*/i, '');
        
        // Remove any existing + sign
        normalizedTo = normalizedTo.replace(/^\+/, '');
        
        // Add the correct prefix
        normalizedTo = `whatsapp:+${normalizedTo}`;
      }
    }
    
    console.log(`Sending message to: ${normalizedTo}`);
    
    const message = await client.messages.create({
      from: 'whatsapp:+918788649885', // Your Twilio WhatsApp number
      to: normalizedTo,
      body: body
    });
    
    console.log(`WhatsApp message sent with SID: ${message.sid}`);
    return message;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};

/**
 * Notify division officers about new queries
 * @param {Object} query - The traffic query object
 * @param {Object} division - The division object containing officers
 * @returns {Promise<Array>} - List of notified officers
 */
// Update the notification message to include the user's name
exports.notifyDivisionOfficers = async (query, division) => {
  if (!division || !division.officers || division.officers.length === 0) {
    console.log('No officers to notify for division');
    return [];
  }
  
  // Get Twilio client - fixed: using the exported function
  const client = exports.getTwilioClient();
  
  // Get the first officer regardless of active status
  const officerToNotify = division.officers[0];
  const notifiedContacts = [];
  
  try {
    const location = query.location?.address || `${query.location?.latitude}, ${query.location?.longitude}`;
    
    // Map numeric report types to text descriptions
    const reportTypes = {
      '1': 'Traffic Violation',
      '2': 'Traffic Congestion',
      '3': 'Irregularity',
      '4': 'Road Damage',
      '5': 'Illegal Parking',
      '6': 'Traffic Signal Issue',
      '7': 'Suggestion'
    };
    
    // Get the query type - handle both text and numeric formats
    let queryTypeText = query.query_type;
    
    // If query_type is a number (as string), convert it to text description
    if (reportTypes[query.query_type]) {
      queryTypeText = reportTypes[query.query_type];
    }
    
    // Get reporter name - use first character as initial if available
    const reporterName = query.user_name || 'Anonymous';
    const reporterInitial = reporterName.charAt(0);
    
    // Create notification message with reporter name
    const notificationMessage = `🚨 New Traffic Report in ${division.name}\n\n` +
      `Type: ${queryTypeText}\n` +
      `Location: ${query.location?.address || 'See map link'}\n` +
      `Description: ${query.description}\n\n` +
      `Reported by: ${reporterName}\n\n` +
      `To resolve this issue, click: ${process.env.SERVER_URL}/resolve.html?id=${query._id}`;
    
    // Phone numbers to notify
    const phoneNumbers = [];
    
    // Add officer's primary phone
    if (officerToNotify?.phone) {
      phoneNumbers.push(officerToNotify.phone);
    }
    
    // Add alternate phone if it exists
    if (officerToNotify?.alternate_phone) {
      phoneNumbers.push(officerToNotify.alternate_phone);
    }
    
    // Send messages to both phone numbers
    for (const phone of phoneNumbers) {
      try {
        // Ensure the 'to' number starts with 'whatsapp:+'
        const formattedPhone = phone.startsWith('whatsapp:+') ? phone : `whatsapp:+${phone.replace(/^\+/, '')}`;
        const message = await client.messages.create({
          from: 'whatsapp:+918788649885',
          to: formattedPhone,
          body: notificationMessage
        });
        
        console.log(`Notification sent to ${formattedPhone} with SID: ${message.sid}`);
        
        notifiedContacts.push({
          officer_id: officerToNotify._id || 'unknown',
          name: officerToNotify.name || 'Unknown',
          phone: phone,
          notification_time: new Date(),
          status: 'sent',
          message_sid: message.sid
        });
      } catch (error) {
        console.error(`Error sending notification to ${phone}:`, error);
      }
    }
    
    return notifiedContacts;
  } catch (error) {
    console.error('Error in notifyDivisionOfficers:', error);
    return [];
  }
};