const express = require("express");
const router = express.Router();
const queryController = require("../controllers/queryController");
const { sendWhatsAppMessage } = require("../utils/whatsapp");
const { authMiddleware, mainAdminOnly } = require("../services/authService");

// Apply auth middleware to all query routes
router.use(authMiddleware);

// Get all queries with filtering and pagination
router.get("/", authMiddleware, queryController.getAllQueries);

// get all queries for a specific division
router.get("/division/:division", queryController.getQueriesByDivision);

// get stats for a specific division
router.get("/division/:division/stats", queryController.getStatsByDivision);

// Get query statistics
router.get("/statistics", queryController.getQueryStatistics);

// Get statistics by division (for main dashboard)
router.get("/division-statistics", queryController.getStatisticsByDivision);

// IMPORTANT: Use path parameter pattern with hyphens to avoid confusion with IDs
router.get("/time-filter", queryController.getqueriesbytimefilter);

// Get queries by type
router.get("/type/:type", queryController.getQueriesByType);

// Get query by ID - This should come after more specific routes
router.get("/:id([0-9a-fA-F]{24})", queryController.getQueryById);

// Update query status
router.put("/:id/status", queryController.updateQueryStatus);

// Delete a query - Restrict to main admin only
router.delete("/:id", mainAdminOnly, queryController.deleteQuery);

router.post("/:id/notify-department", queryController.notifyDepartmentByEmail);


// Broadcast features should be restricted to main admin
router.post("/broadcast", mainAdminOnly, queryController.broadcastMessage);
router.post(
  "/broadcasttoVolunteers",
  mainAdminOnly,
  queryController.broadcastMessageToVolunteers
);

router.post(
  "/broadcastMessageByOptions",
  queryController.broadcastMessageByOptions
);

router.get("/email-records", queryController.getEmailRecords);

router.get("email-records/export", queryController.exportEmailRecords);

// Test WhatsApp messaging (restrict to main admin)
router.post("/test-notification", mainAdminOnly, async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        success: false,
        message: 'Both "to" and "message" are required',
      });
    }

    // Format the number if not already in WhatsApp format
    const formattedNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    // Send test message
    const result = await sendWhatsAppMessage(formattedNumber, message);

    return res.status(200).json({
      success: true,
      message: "Test message sent successfully",
      sid: result.sid,
    });
  } catch (error) {
    console.error("Error sending test message:", error);
    return res.status(500).json({
      success: false,
      message: "Error sending test message",
      error: error.message,
    });
  }
});

module.exports = router;
