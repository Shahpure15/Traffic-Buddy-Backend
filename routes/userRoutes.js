const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authMiddleware, mainAdminOnly } = require('../services/authService');

router.use(authMiddleware);
router.use(mainAdminOnly);

// GET current officer of all divisions
router.get('/current-officer', userController.getCurrentOfficers);
// GET current officer of a particular division
router.get('/current-officer/:divisionId', userController.getCurrentOfficer);

// GET all officers of all divisions
router.get('/all-officers', userController.getAllOfficers);
// GET all officers of a particular division
router.get('/all-officers/:divisionId', userController.getAllOfficers);

// PUT update officer details
router.put('/update-officer/:divisionId', userController.updateOfficer);

// POST assign officer to a region
router.post('/add-officer/:divisionId', userController.assignOfficer);

// POST unassign officer from a region
router.post('/unassign-officer/:divisionId', userController.unassignOfficer);

// GET filter officers by any given field
router.get('/filter-officers', userController.filterOfficers);

module.exports = router;