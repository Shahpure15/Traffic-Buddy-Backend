// smsUtils.js
const axios = require('axios');
const twilio = require('twilio');

// Twilio configuration
const twilioClient = () => {
  const accountSid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    console.error('Twilio credentials not properly configured');
    throw new Error('Twilio configuration error');
  }
  
  return twilio(accountSid, authToken);
};

// Generate a 6-digit OTP
exports.generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Format phone number with country code
exports.formatPhoneNumber = (phone, countryCode = '91') => {
  // Remove any non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Remove country code if it's already there
  const withoutCountry = cleaned.startsWith(countryCode) 
    ? cleaned.substring(countryCode.length) 
    : cleaned;
  
  // Validate phone number length (assuming 10 digits for most countries)
  if (withoutCountry.length !== 10) {
    throw new Error('Invalid phone number format');
  }
  
  return `+${countryCode}${withoutCountry}`;
};

// Send OTP via Twilio SMS
exports.sendOTPViaSMS = async (phone, otp) => {
  try {
    const client = twilioClient();
    
    // Create the message
    const message = await client.messages.create({
      body: `${otp} is your verification code. Valid for 5 minutes. Do not share this code.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    
    return { success: true, messageId: message.sid };
  } catch (error) {
    console.error('Failed to send SMS:', error);
    throw new Error(`SMS sending failed: ${error.message}`);
  }
};

// Backup SMS sender using alternative provider if Twilio fails
exports.sendSMSFallback = async (phone, message) => {
  try {
    // This is a placeholder. Replace with your actual backup SMS service
    const response = await axios.post(process.env.BACKUP_SMS_API_URL, {
      apiKey: process.env.BACKUP_SMS_API_KEY,
      phone: phone,
      message: message
    });
    
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Backup SMS sending failed:', error);
    throw new Error(`Backup SMS failed: ${error.message}`);
  }
};