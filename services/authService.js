const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Division } = require('../models/Division');

const JWT_SECRET = process.env.JWT_SECRET || 'traffic-buddy-jwt-secret-key';
const JWT_EXPIRY = '24h'; // Token expiry time

/**
 * Authenticate a division dashboard user
 * @param {string} username - The username
 * @param {string} password - The password
 * @returns {Object} - Authentication result with token if successful
 */
const authenticateDivisionUser = async (username, password) => {
  try {
    // Find division by dashboard credentials username
    const division = await Division.findOne({
      'dashboard_credentials.username': username
    });

    if (!division) {
      return {
        success: false,
        message: 'Invalid credentials'
      };
    }

    // Compare passwords (plain text comparison for now, later we should use bcrypt)
    const isMatch = division.dashboard_credentials.password === password;
    
    if (!isMatch) {
      return {
        success: false,
        message: 'Invalid credentials'
      };
    }

    // Create token payload
    const payload = {
      divisionId: division._id,
      divisionCode: division.code,
      divisionName: division.name,
      role: 'division_admin'
    };

    // Sign token
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    return {
      success: true,
      token: token,
      division: {
        id: division._id,
        name: division.name,
        code: division.code
      }
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      success: false,
      message: 'Authentication failed',
      error: error.message
    };
  }
};

/**
 * Authenticate main dashboard admin
 * @param {string} username - The username
 * @param {string} password - The password
 * @returns {Object} - Authentication result with token if successful
 */
const authenticateMainAdmin = (username, password) => {
  // For now, hardcoded credentials for main dashboard
  const mainAdminUsername = process.env.MAIN_ADMIN_USERNAME;
  const mainAdminPassword = process.env.MAIN_ADMIN_PASSWORD;

  if (username === mainAdminUsername && password === mainAdminPassword) {
    // Create token payload
    const payload = {
      role: 'main_admin'
    };

    // Sign token
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    return {
      success: true,
      token: token,
      role: 'main_admin'
    };
  }

  return {
    success: false,
    message: 'Invalid credentials'
  };
};

  
/**
 * Verify JWT token
 * @param {string} token - The JWT token
 * @returns {Object} - Decoded token or error
 */
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      success: true,
      data: decoded
    };
  } catch (error) {
    return {
      success: false,
      message: 'Invalid token',
      error: error.message
    };
  }
};

/**
 * Middleware to verify authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authMiddleware = (req, res, next) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No authentication token provided' 
      });
    }

    // Verify token
    const result = verifyToken(token);
    
    if (!result.success) {
      return res.status(401).json({ 
        success: false, 
        message: result.message 
      });
    }

    // Attach user data to request
    req.user = result.data;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication error', 
      error: error.message 
    });
  }
};

/**
 * Middleware to restrict access to main admin only
 */
const mainAdminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'main_admin') {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied: Main admin privileges required'
  });
};

/**
 * Middleware to restrict access to specific division or main admin
 */
const divisionAccessOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Main admin has access to all divisions
  if (req.user.role === 'main_admin') {
    return next();
  }

  // For division admins, check if they're accessing their own division
  if (req.user.role === 'division_admin') {
    // If the request includes a division ID parameter, verify it matches the user's division
    if (req.params.divisionId && req.params.divisionId !== req.user.divisionId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only access your own division'
      });
    }
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied'
  });
};

/**
 * Generate a password reset token
 * @param {string} divisionId - The division ID
 * @returns {Object} - Reset token information
 */
const generatePasswordResetToken = async (divisionId) => {
  try {
    const division = await Division.findById(divisionId);
    
    if (!division) {
      return {
        success: false,
        message: 'Division not found'
      };
    }

    const resetToken = jwt.sign(
      { 
        divisionId: division._id,
        purpose: 'password_reset' 
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    return {
      success: true,
      resetToken,
      divisionCode: division.code
    };
  } catch (error) {
    console.error('Generate reset token error:', error);
    return {
      success: false,
      message: 'Failed to generate reset token',
      error: error.message
    };
  }
};

/**
 * Reset division dashboard password
 * @param {string} token - Reset token
 * @param {string} newPassword - New password
 * @returns {Object} - Reset result
 */
const resetPassword = async (token, newPassword) => {
  try {
    // Verify token
    const result = verifyToken(token);
    
    if (!result.success || result.data.purpose !== 'password_reset') {
      return {
        success: false,
        message: 'Invalid or expired reset token'
      };
    }

    const divisionId = result.data.divisionId;
    
    // Update password
    await Division.findByIdAndUpdate(divisionId, {
      'dashboard_credentials.password': newPassword
    });

    return {
      success: true,
      message: 'Password reset successful'
    };
  } catch (error) {
    console.error('Password reset error:', error);
    return {
      success: false,
      message: 'Password reset failed',
      error: error.message
    };
  }
};

module.exports = {
  authenticateDivisionUser,
  authenticateMainAdmin,
  verifyToken,
  authMiddleware,
  mainAdminOnly,
  divisionAccessOnly,
  generatePasswordResetToken,
  resetPassword
};