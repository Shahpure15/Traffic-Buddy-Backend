const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authMiddleware } = require('../services/authService');

// Apply auth middleware to all dashboard routes
router.use(authMiddleware);

// Get dashboard summary data
router.get('/summary', dashboardController.getDashboardSummary);

// Get recent activity
router.get('/recent-activity', dashboardController.getRecentActivity);

// Get map data
router.get('/map-data', dashboardController.getMapData);

// Get all divisions (for dropdown selection)
router.get('/divisions', dashboardController.getAllDivisions);

// Get division performance metrics (for main dashboard)
router.get('/division-performance', dashboardController.getDivisionPerformance);

module.exports = router;
