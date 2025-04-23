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
  
  // Get active officers sorted by priority
  const activeOfficers = division.officers
    .filter(officer => officer.isActive)
    .slice(0, 2); // Only notify up to 2 officers
  
  if (activeOfficers.length === 0) {
    console.log('No active officers to notify for division');
    return [];
  }
  
  const client = exports.getTwilioClient();
  const notifiedContacts = [];
  
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
  
  // Get the query type text
  let queryTypeText = query.query_type;
  if (reportTypes[query.query_type]) {
    queryTypeText = reportTypes[query.query_type];
  }
  
  // Get reporter name
  const reporterName = query.user_name || 'Anonymous';
  
  // Create notification message with all required details
  const notificationMessage = `🚨 New Traffic Report in ${division.name}\n\n` +
    `Type: ${queryTypeText}\n` +
    `Location: ${query.location?.address || 'See map link'}\n` +
    `Description: ${query.description}\n\n` +
    `Reported by: ${reporterName}\n\n` +
    `To resolve this issue, click: ${process.env.SERVER_URL}/resolve.html?id=${query._id}`;
  
  // Track messages sent
  const messagePromises = [];
  
  // Send to each officer
  for (const officer of activeOfficers) {
    try {
      // Try primary phone
      if (officer.phone) {
        const formattedPhone = formatPhoneNumber(officer.phone);
        
        try {
          const message = await client.messages.create({
            from: 'whatsapp:+918788649885',
            to: formattedPhone,
            body: notificationMessage,
            statusCallback: `${process.env.SERVER_URL}/webhook/message-status` // Add status callback
          });
          
          console.log(`Notification sent to ${officer.name} (${formattedPhone}) with SID: ${message.sid}`);
          
          notifiedContacts.push({
            officer_id: officer._id || 'unknown',
            name: officer.name || 'Unknown',
            phone: formattedPhone,
            notification_time: new Date(),
            status: 'queued', // Initial status
            message_sid: message.sid
          });
          
          // Don't wait for backup notification if primary succeeded
          continue;
        } catch (primaryError) {
          console.error(`Error sending to primary number for ${officer.name}:`, primaryError);
        }
      }
      
      // Try alternate phone if primary failed or doesn't exist
      if (officer.alternate_phone && officer.alternate_phone !== officer.phone) {
        const formattedAlternatePhone = formatPhoneNumber(officer.alternate_phone);
        
        try {
          const message = await client.messages.create({
            from: 'whatsapp:+918788649885',
            to: formattedAlternatePhone,
            body: notificationMessage,
            statusCallback: `${process.env.SERVER_URL}/webhook/message-status` // Add status callback
          });
          
          console.log(`Alternate notification sent to ${officer.name} (${formattedAlternatePhone}) with SID: ${message.sid}`);
          
          notifiedContacts.push({
            officer_id: officer._id || 'unknown',
            name: officer.name || 'Unknown',
            phone: formattedAlternatePhone,
            notification_time: new Date(),
            status: 'queued', // Initial status
            message_sid: message.sid
          });
        } catch (alternateError) {
          console.error(`Error sending to alternate number for ${officer.name}:`, alternateError);
        }
      }
    } catch (officerError) {
      console.error(`Error in notification process for officer ${officer.name}:`, officerError);
    }
  }
  
  return notifiedContacts;
};

// Helper function to properly format phone numbers
function formatPhoneNumber(phone) {
  if (!phone) return null;
  
  // Clean the number of any non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // Remove any leading zeros
  cleaned = cleaned.replace(/^0+/, '');
  
  // Add country code if not present
  if (!cleaned.startsWith('91') && cleaned.length === 10) {
    cleaned = `91${cleaned}`;
  }
  
  // Ensure it has the WhatsApp prefix
  if (!phone.startsWith('whatsapp:')) {
    return `whatsapp:+${cleaned}`;
  }
  
  return phone;
}