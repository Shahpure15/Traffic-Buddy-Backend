const authService = require('../services/authService');
const { Division } = require('../models/Division');

// Login handler
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }
    
    // First try to authenticate as main admin
    const mainAdminResult = authService.authenticateMainAdmin(username, password);
    
    if (mainAdminResult.success) {
      return res.status(200).json({
        success: true,
        token: mainAdminResult.token,
        role: 'main_admin',
        message: 'Main admin login successful'
      });
    }
    
    // If not main admin, try division login
    const divisionResult = await authService.authenticateDivisionUser(username, password);
    
    if (divisionResult.success) {
      return res.status(200).json({
        success: true,
        token: divisionResult.token,
        role: 'division_admin',
        division: divisionResult.division,
        message: 'Division admin login successful'
      });
    }
    
    // If neither worked, return error
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during login',
      error: error.message
    });
  }
};

// Get current user info
exports.getCurrentUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }
    
    // If user is division admin, include division details
    if (req.user.role === 'division_admin' && req.user.divisionId) {
      const division = await Division.findById(req.user.divisionId).select('-dashboard_credentials.password');
      
      return res.status(200).json({
        success: true,
        user: {
          ...req.user,
          division
        }
      });
    }
    
    // For main admin
    return res.status(200).json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching user data',
      error: error.message
    });
  }
};

// Generate reset token for division password reset
exports.requestResetToken = async (req, res) => {
  try {
    const { divisionId } = req.body;
    
    if (!divisionId) {
      return res.status(400).json({
        success: false,
        message: 'Division ID is required'
      });
    }
    
    // Only main admin can request password resets
    if (req.user.role !== 'main_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only main admin can request password resets'
      });
    }
    
    const result = await authService.generatePasswordResetToken(divisionId);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Reset token generation error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while generating reset token',
      error: error.message
    });
  }
};

// Reset division password
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }
    
    const result = await authService.resetPassword(token, newPassword);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during password reset',
      error: error.message
    });
  }
};