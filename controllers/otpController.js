// controllers/otpController.js
const OTP = require('../models/OTP');
const { 
  generateOTP,
  formatPhoneNumber, 
  sendOTPViaSMS,
  sendSMSFallback
} = require('../utils/smsUtils');

// Maximum verification attempts allowed
const MAX_VERIFICATION_ATTEMPTS = 3;

// Send OTP
exports.sendOTP = async (req, res) => {
  try {
    const { phone, userId, sessionId } = req.body;

    // Comprehensive validation
    if (!phone || !userId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, userId, and sessionId are required'
      });
    }

    // Validate basic phone format
    if (!/^\d{10,15}$/.test(phone.replace(/\D/g, ''))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    try {
      // Format the phone number with country code
      const formattedPhone = formatPhoneNumber(phone);
      
      // Generate OTP
      const otp = generateOTP();

      // Delete any existing OTP for this phone/user/session
      await OTP.findOneAndDelete({ 
        phone: formattedPhone, 
        userId, 
        sessionId,
        verified: false
      });

      // Store new OTP
      const newOTP = new OTP({
        phone: formattedPhone,
        otp,
        userId,
        sessionId
      });
      
      await newOTP.save();

      // Send OTP via SMS
      let smsResult;
      try {
        // Try primary SMS provider (Twilio)
        smsResult = await sendOTPViaSMS(formattedPhone, otp);
      } catch (smsError) {
        console.error('Primary SMS provider failed:', smsError);
        
        // Try backup SMS provider if primary fails
        try {
          smsResult = await sendSMSFallback(
            formattedPhone, 
            `${otp} is your verification code. Valid for 5 minutes.`
          );
        } catch (backupError) {
          throw new Error('All SMS providers failed');
        }
      }

      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        phoneVerified: false
      });

    } catch (error) {
      console.error('Error in OTP sending process:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP',
        error: error.message
      });
    }
  } catch (outerError) {
    console.error('Unhandled error in sendOTP:', outerError);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Please try again later'
    });
  }
};

// Verify OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { phone, otp, userId, sessionId } = req.body;

    // Comprehensive validation
    if (!phone || !otp || !userId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, OTP, userId, and sessionId are required'
      });
    }

    try {
      // Format the phone number
      const formattedPhone = formatPhoneNumber(phone);

      // Find stored OTP
      const storedOTP = await OTP.findOne({
        phone: formattedPhone,
        userId,
        sessionId,
        verified: false
      });

      // Check if OTP exists and is valid
      if (!storedOTP) {
        return res.status(400).json({
          success: false,
          message: 'OTP not found or expired. Please request a new OTP.'
        });
      }

      // Check verification attempts
      if (storedOTP.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        // Delete the OTP if max attempts reached
        await OTP.findByIdAndDelete(storedOTP._id);
        
        return res.status(400).json({
          success: false,
          message: 'Maximum verification attempts reached. Please request a new OTP.'
        });
      }

      // Increment attempts
      storedOTP.attempts += 1;
      await storedOTP.save();

      // Verify OTP
      if (storedOTP.otp !== otp) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP. Please try again.',
          attemptsLeft: MAX_VERIFICATION_ATTEMPTS - storedOTP.attempts
        });
      }

      // Mark as verified and update
      storedOTP.verified = true;
      await storedOTP.save();

      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully',
        verified: true,
        phone: formattedPhone
      });

    } catch (error) {
      console.error('Error in OTP verification process:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify OTP',
        error: error.message
      });
    }
  } catch (outerError) {
    console.error('Unhandled error in verifyOTP:', outerError);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Please try again later'
    });
  }
};