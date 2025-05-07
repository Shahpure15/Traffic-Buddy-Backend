const Query = require("../models/Query");
const { Division } = require("../models/Division");
const TeamApplication = require("../models/TeamApplication");
const { sendWhatsAppMessage } = require("../utils/whatsapp");
const { getText } = require("../utils/language");
const Session = require("../models/Session");
const { sendQueryEmail } = require("../utils/email");
const mongoose = require("mongoose");
const EmailRecord = require("../models/EmailRecords");

// Get all queries (with pagination and filtering)
exports.getAllQueries = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      query_type,
      sort = "timestamp",
      order = "desc",
      aggregate = false,
      search,
      division,
    } = req.query;

    const skip = (page - 1) * limit;

    // Build filter object
    let filter = {};

    if (status) {
      filter.status = status;
    }

    if (query_type) {
      filter.query_type = query_type;
    }

    // Filter by division if specified (for division dashboards)
    if (division && division !== "NOT_SPECIFIED") {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }
    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
      // Exclude 'Road Damage' reports for division_admin
      if (filter.query_type !== "Road Damage" && filter.query_type !== "Suggestion") {
        filter.query_type = query_type || { $nin: ["Road Damage", "Suggestion"] };
      } else {
        filter.query_type = "UNDEFINED";
      }
    }

    // Search functionality
    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: "i" } },
        { user_name: { $regex: search, $options: "i" } },
        { vehicle_number: { $regex: search, $options: "i" } },
        { "location.address": { $regex: search, $options: "i" } },
      ];
    }

    // Set up sorting
    const sortDirection = order.toLowerCase() === "asc" ? 1 : -1;
    const sortOptions = {};
    sortOptions[sort] = sortDirection;
    const totalQueries = await Query.countDocuments(filter);
    // Execute query with pagination
    if (aggregate === "false" || aggregate === false || status) {
      const queries = await Query.find(filter)
        .populate("division", "name code")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));

      console.log("NORMAL: ", totalQueries, queries.length);

      return res.status(200).json({
        success: true,
        count: queries.length,
        total: totalQueries,
        totalPages: Math.ceil(totalQueries / limit),
        currentPage: parseInt(page),
        data: queries,
      });
    } else {
      const all_queries = [];
      const pending_queries = await Query.find({ ...filter, status: "Pending" })
        .populate("division", "name code")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));
      all_queries.push(...pending_queries);
      const in_progress_queries = await Query.find({
        ...filter,
        status: "In Progress",
      })
        .populate("division", "name code")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));
      all_queries.push(...in_progress_queries);
      const resolved_queries = await Query.find({
        ...filter,
        status: "Resolved",
      })
        .populate("division", "name code")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));
      all_queries.push(...resolved_queries);
      const rejected_queries = await Query.find({
        ...filter,
        status: "Rejected",
      })
        .populate("division", "name code")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));
      all_queries.push(...rejected_queries);
      const queries = all_queries.filter(
        (query, index, self) =>
          index ===
          self.findIndex((q) => q._id.toString() === query._id.toString())
      );
      return res.status(200).json({
        success: true,
        count: queries.length,
        total: totalQueries,
        totalPages: Math.ceil(totalQueries / limit),
        currentPage: parseInt(page),
        data: queries,
      });
    }
  } catch (error) {
    console.error("Error fetching queries:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get query by ID
exports.getQueryById = async (req, res) => {
  try {
    const { id } = req.params;

    const query = await Query.findById(id);

    if (!query) {
      return res.status(404).json({
        success: false,
        message: "Query not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: query,
    });
  } catch (error) {
    console.error("Error fetching query:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update query status
// Update the updateQueryStatus function

exports.updateQueryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Extract data from request body, handling both JSON and FormData
    const status = req.body.status;
    const resolution_note = req.body.resolution_note;
    const resolver_name = req.body.resolver_name;
    
    console.log("Update request received:", { 
      id, 
      status, 
      hasNote: !!resolution_note, 
      hasName: !!resolver_name,
      contentType: req.headers['content-type']
    });

    if (!["Pending", "In Progress", "Resolved", "Rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    // If status is 'Resolved' or 'Rejected', resolver name is required
    if ((status === "Resolved" || status === "Rejected") && !resolver_name) {
      return res.status(400).json({
        success: false,
        message: "Resolver name is required for resolving or rejecting a query",
      });
    }

    // Find the query by ID
    const query = await Query.findById(id);

    if (!query) {
      return res.status(404).json({
        success: false,
        message: "Query not found",
      });
    }

    // Update status and add resolution note if provided
    query.status = status;
    if (resolution_note) {
      query.resolution_note = resolution_note;
    }

    // If status is being changed to Resolved or Rejected, add resolution details
    if (status === "Resolved" || status === "Rejected") {
      query.resolved_at = new Date();
      
      // Get client IP address (if available)
      const ipAddress = req.headers['x-forwarded-for'] || 
                         req.connection.remoteAddress || 
                         'Unknown';
      
      // Save resolver information
      query.resolved_by = {
        name: resolver_name,
        timestamp: new Date(),
        ip_address: ipAddress
      };
      
      // If an image was uploaded, handle it here
      if (req.file) {
        try {
          const uploadedUrl = await uploadImageToR2(req.file);
          query.resolution_image_url = uploadedUrl;
        } catch (uploadError) {
          console.error("Error uploading resolution image:", uploadError);
          // Continue without the image if upload fails
        }
      }
    }

    await query.save();

    // Get the user's language preference for WhatsApp notification
    const userSession = await Session.findOne({ user_id: query.user_id });
    const userLanguage = userSession?.language || "en";

    // Send WhatsApp notification to user about status change
    if (query.user_id && query.user_id.startsWith("whatsapp:")) {
      try {
        console.log(`Sending status update to ${query.user_id}`);

        // Format query type for message
        const queryTypeForMessage = query.query_type || "report";

        // Prepare status update message with proper string formatting
        let statusMessage = "";

        if (status === "In Progress") {
          // Replace placeholder with actual value
          statusMessage = getText("STATUS_IN_PROGRESS", userLanguage).replace(
            "{0}",
            queryTypeForMessage.toLowerCase()
          );
        } else if (status === "Resolved") {
          // Replace placeholders with actual values but remove resolver name from the message
          statusMessage = getText("STATUS_RESOLVED", userLanguage)
            .replace("{0}", queryTypeForMessage.toLowerCase())
            .replace(
              "{1}",
              resolution_note || "No additional details provided."
            );
        } else if (status === "Rejected") {
          // Replace placeholders with actual values but remove resolver name from the message
          statusMessage = getText("STATUS_REJECTED", userLanguage)
            .replace("{0}", queryTypeForMessage.toLowerCase())
            .replace(
              "{1}", 
              resolution_note || "No reason specified."
            );
        }

        if (statusMessage) {
          console.log("Message to be sent:", statusMessage);

          // Send the message
          const messageSent = await sendWhatsAppMessage(
            query.user_id,
            statusMessage
          );
          console.log(
            "WhatsApp message status update sent successfully:",
            messageSent.sid
          );
        }
      } catch (notificationError) {
        console.error(
          "Error sending WhatsApp notification:",
          notificationError
        );
        // Don't fail the request if notification fails
      }
    } else {
      console.log(
        "Cannot send status update - invalid user ID format:",
        query.user_id
      );
    }

    return res.status(200).json({
      success: true,
      message: `Query status updated to ${status}`,
      data: query,
    });
  } catch (error) {
    console.error("Error updating query status:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get queries by type
exports.getQueriesByType = async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;

    const queries = await Query.find({ query_type: type })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalQueries = await Query.countDocuments({ query_type: type });

    return res.status(200).json({
      success: true,
      count: queries.length,
      total: totalQueries,
      totalPages: Math.ceil(totalQueries / limit),
      currentPage: parseInt(page),
      data: queries,
    });
  } catch (error) {
    console.error("Error fetching queries by type:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get query statistics

// Delete a query (admin feature)
exports.deleteQuery = async (req, res) => {
  try {
    const { id } = req.params;

    const query = await Query.findById(id);

    if (!query) {
      return res.status(404).json({
        success: false,
        message: "Query not found",
      });
    }

    await Query.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Query deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting query:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Send query information to department via email
// In queryController.js, look for the notifyDepartmentByEmail function
exports.notifyDepartmentByEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { emails, departmentName } = req.body;

    console.log("Received request to notify department:", {
      id,
      emails,
      departmentName,
    });

    // Validation
    if (!emails || !departmentName) {
      return res.status(400).json({
        success: false,
        message: "Email addresses and department name are required",
      });
    }

    // Split emails by semicolon and validate
    const emailList = emails
      .split(";")
      .map((email) => email.trim())
      .filter((email) => email);
    if (emailList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid email address is required",
      });
    }

    // Find the query by ID
    const query = await Query.findById(id);

    if (!query) {
      return res.status(404).json({
        success: false,
        message: "Query not found",
      });
    }

    // Generate subject based on query type and ID
    const subject = `Traffic Buddy: ${
      query.query_type
    } Report - Ref #${query._id.toString().slice(-6)}`;

    // Send email to each recipient
    for (const email of emailList) {
      try {
        await sendQueryEmail(email, subject, query, departmentName);
        console.log(`Email sent to ${email}`);
        
        // FIX: Make sure to include all required fields including division
        await EmailRecord.create({
          emails: email,
          subject: subject,
          queryId: query._id,
          division: query.divisionName || "Unknown", // Make sure division is provided
          departmentName: departmentName,
          sentAt: new Date(),
          status: "sent",
        });
      } catch (emailError) {
        // Also update this error case
        await EmailRecord.create({
          emails: email,
          subject: subject,
          queryId: query._id,
          division: query.divisionName || "Unknown", // Make sure division is provided
          departmentName: departmentName,
          sentAt: new Date(),
          status: "failed",
        });
      }

      // Update query to track notification
      query.notifications = query.notifications || [];
      query.notifications.push({
        type: "email",
        recipient: email,
        department: departmentName,
        timestamp: new Date(),
      });
    }

    await query.save();

    return res.status(200).json({
      success: true,
      message: `Query details successfully sent to ${departmentName} at ${emailList.join(
        ", "
      )}`,
      notificationCount: query.notifications ? query.notifications.length : 0,
    });
  } catch (error) {
    console.error("Error sending query notification email:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// function to brodcast message to all users
exports.broadcastMessage = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    // Get all active sessions
    const activeSessions = await Session.find({ active: true });

    // Send message to each active session
    activeSessions.forEach(async (session) => {
      try {
        // Send the message
        const messageSent = await sendWhatsAppMessage(session.user_id, message);
        console.log("WhatsApp message sent successfully:", messageSent.sid);
      } catch (error) {
        console.error("Error sending WhatsApp message:", error);
        // Don't fail the request if notification fails
      }
    });

    return res.status(200).json({
      success: true,
      message: "Message broadcast successfully",
    });
  } catch (error) {
    console.error("Error broadcasting message:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

//brodcase msg to volunteers in a specific area
exports.broadcastMessageToVolunteers = async (req, res) => {
  try {
    const { message, area } = req.body;

    if (!message || !area) {
      return res.status(400).json({
        success: false,
        message: "Message and area are required",
      });
    }

    // Get all active sessions in the area
    const activeSessions = await Session.find({
      active: true,
      "location.area": area,
    });

    // Send message to each active session
    activeSessions.forEach(async (session) => {
      try {
        // Send the message
        const messageSent = await sendWhatsAppMessage(session.user_id, message);
        console.log("WhatsApp message sent successfully:", messageSent.sid);
      } catch (error) {
        console.error("Error sending WhatsApp message:", error);
        // Don't fail the request if notification fails
      }
    });

    return res.status(200).json({
      success: true,
      message: "Message broadcast successfully",
    });
  } catch (error) {
    console.error("Error broadcasting message:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.broadcastMessageByOptions = async (req, res) => {
  try {
    const { message, users = false, volunteers = false, divisions } = req.body;

    console.log("Broadcasting message with options:", {
      users,
      volunteers,
      divisions,
    });

    if (!message || message.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const sentUsers = new Set(); // To track users who have already received the message

    if (users) {
      const allUsers = await Query.distinct("user_id");
      for (const user of allUsers) {
        if (!sentUsers.has(user)) {
          try {
            console.log(`Sending message to user ${user}`);
            const messageSent = await sendWhatsAppMessage(user, message);
            console.log(
              `WhatsApp message sent successfully to user ${user}:`,
              messageSent.sid
            );
            sentUsers.add(user); // Mark user as messaged
          } catch (error) {
            console.error("Error sending WhatsApp message:", error);
          }
        }
      }
    }

    // Send message to all volunteers (if true) which are stored in teamApplications
    if (volunteers) {
      const allVolunteers = await TeamApplication.find({ status: "Approved" });
      for (const volunteer of allVolunteers) {
        if (!sentUsers.has(volunteer.user_id)) {
          try {
            const messageSent = await sendWhatsAppMessage(
              volunteer.user_id,
              message
            );
            console.log(
              `WhatsApp message sent successfully to volunteer ${volunteer.user_id}:`,
              messageSent.sid
            );
            sentUsers.add(volunteer.user_id); // Mark volunteer as messaged
          } catch (error) {
            console.error("Error sending WhatsApp message:", error);
          }
        }
      }
    }

    // Send message to all division officers from the specified divisions
    if (divisions && divisions.length > 0) {
      const allDivisions = await Division.find({ name: { $in: divisions } });
      console.log("Filtered Divisions:", allDivisions);
      for (const division of allDivisions) {
        try {
          if (division.officers && division.officers.length > 0) {
            for (const officer of division.officers) {
              if (!officer.isActive) {
                continue;
              }
              if (!sentUsers.has(officer.phone)) {
                const messageSentPri = await sendWhatsAppMessage(
                  officer.phone,
                  message
                );
                console.log(
                  `WhatsApp message sent successfully to officer ${officer.name} (primary):`,
                  messageSentPri.sid
                );
                sentUsers.add(officer.phone); // Mark officer's primary phone as messaged
              }
              if (
                officer.alternate_phone &&
                !sentUsers.has(officer.alternate_phone)
              ) {
                const messageSentSec = await sendWhatsAppMessage(
                  officer.alternate_phone,
                  message
                );
                console.log(
                  `WhatsApp message sent successfully to officer ${officer.name} (secondary):`,
                  messageSentSec.sid
                );
                sentUsers.add(officer.alternate_phone); // Mark officer's alternate phone as messaged
              }
            }
          }
        } catch (error) {
          console.error("Error sending WhatsApp message:", error);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message:
        "Message broadcast successfully to all specified users, volunteers, and divisions",
    });
  } catch (error) {
    console.error("Error broadcasting message:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// ...existing code...

exports.getEmailRecords = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit, // Let limit be undefined by default if not passed
      startDate, 
      endDate, 
      division // This is the string name like "Sangavi"
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    let queryLimit = parseInt(limit, 10);

    // If limit is not a positive number (e.g., 0, undefined, NaN from parseInt),
    // we interpret it as fetching all records (for export).
    // Otherwise, use it for pagination.
    const fetchAll = !(queryLimit > 0);
    
    const skip = fetchAll ? 0 : (pageNum - 1) * queryLimit;

    let filter = {};
    
    if (startDate && endDate) {
      filter.sentAt = {
        $gte: new Date(startDate), // Assumes startDate is YYYY-MM-DD
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) // End of day for endDate
      };
    }
    
    if (division) { // If a division string is provided (e.g., "Sangavi")
      filter.division = division; // Filter by this exact string
    }
    // If 'division' is empty or undefined, all divisions (matching other criteria) will be fetched.

    let emailRecordsQuery = EmailRecord.find(filter).sort({ sentAt: -1 });

    if (!fetchAll) {
      emailRecordsQuery = emailRecordsQuery.skip(skip).limit(queryLimit);
    }

    const emailRecords = await emailRecordsQuery.exec();
    const totalRecords = await EmailRecord.countDocuments(filter);

    return res.status(200).json({
      success: true,
      count: emailRecords.length,
      total: totalRecords,
      totalPages: fetchAll ? 1 : Math.ceil(totalRecords / queryLimit),
      currentPage: fetchAll ? 1 : pageNum,
      data: emailRecords,
    });
  } catch (error) {
    console.error("Error fetching email records:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getQueriesByDivision = async (req, res) => {
  try {
    const { division } = req.params;

    let filter = {};
    if (division && division !== "NOT_SPECIFIED") {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }

    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
      filter.query_type = { $nin: ["Road Damage", "Suggestion"] };
    }

    const queries = await Query.find(filter).sort({ timestamp: -1 });

    console.log(`Found ${queries.length} queries matching the division`);

    return res.status(200).json({
      success: true,
      count: queries.length,
      data: queries,
    });
  } catch (error) {
    console.error("Error fetching queries by time filter:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getqueriesbytimefilter = async (req, res) => {
  try {
    const { start, end, division } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "Both start and end dates are required",
      });
    }

    // Parse the dates correctly
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    // Add console logs to debug date parsing
    console.log("Original start date string:", start);
    console.log("Original end date string:", end);
    console.log("Parsed startDate:", startDate);
    console.log("Parsed endDate:", endDate);

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid date format. Please use ISO format (YYYY-MM-DD) or timestamp",
      });
    }

    let filter = { timestamp: { $gte: startDate, $lte: endDate } };

    // Filter by division if specified (for division dashboards)
    if (division && division !== "NOT_SPECIFIED") {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }

    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
      filter.query_type = { $nin: ["Road Damage", "Suggestion"] };
    }

    const queries = await Query.find(filter).sort({ timestamp: -1 });

    console.log(`Found ${queries.length} queries matching the date range`);

    return res.status(200).json({
      success: true,
      count: queries.length,
      timeRange: {
        start: startDate,
        end: endDate,
      },
      data: queries,
    });
  } catch (error) {
    console.error("Error fetching queries by time filter:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get stats by division
exports.getStatsByDivision = async (req, res) => {
  try {
    const { division } = req.params;

    if (!division) {
      return res.status(400).json({
        success: false,
        message: "Division is required",
      });
    }

    let filter = {};
    if (division && division !== "NOT_SPECIFIED") {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }

    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
      // Exclude 'Road Damage' reports for division_admin
      filter.query_type = { $nin: ["Road Damage", "Suggestion"] };
    }

    // Get counts for each status
    const pending = await Query.countDocuments({
      ...filter,
      status: "Pending",
    });
    const inProgress = await Query.countDocuments({
      ...filter,
      status: "In Progress",
    });
    const resolved = await Query.countDocuments({
      ...filter,
      status: "Resolved",
    });
    const rejected = await Query.countDocuments({
      ...filter,
      status: "Rejected",
    });

    // Get counts for each query type
    const trafficViolation = await Query.countDocuments({
      ...filter,
      query_type: "Traffic Violation",
    });
    const trafficCongestion = await Query.countDocuments({
      ...filter,
      query_type: "Traffic Congestion",
    });
    const accident = await Query.countDocuments({
      ...filter,
      query_type: "Accident",
    });
    const roadDamage =
      req.user && req.user.role === "main_admin"
        ? await Query.countDocuments({ ...filter, query_type: "Road Damage" })
        : 0;
    const illegalParking = await Query.countDocuments({
      ...filter,
      query_type: "Illegal Parking",
    });
    const trafficSignalIssue = await Query.countDocuments({
      ...filter,
      query_type: "Traffic Signal Issue",
    });
    const suggestion = 
      req.user && req.user.role === "main_admin"
      ? await Query.countDocuments({...filter, query_type: "Suggestion" })
      : 0;
    const joinRequest = await Query.countDocuments({
      ...filter,
      query_type: "Join Request",
    });
    const generalReport = await Query.countDocuments({
      ...filter,
      query_type: "General Report",
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentQueries = await Query.countDocuments({
      ...filter,
      timestamp: { $gte: thirtyDaysAgo },
    });
    const recentResolved = await Query.countDocuments({
      ...filter,
      status: "Resolved",
      resolved_at: { $gte: thirtyDaysAgo },
    });

    // Get daily counts for the past month for a chart
    const dailyCounts = await Query.aggregate([
      {
        $match: {
          ...filter,
          timestamp: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        total: pending + inProgress + resolved + rejected,
        byStatus: { pending, inProgress, resolved, rejected },
        byType: {
          trafficViolation,
          trafficCongestion,
          accident,
          roadDamage,
          illegalParking,
          trafficSignalIssue,
          suggestion,
          joinRequest,
          generalReport,
        },
        recent: {
          totalQueries: recentQueries,
          resolvedQueries: recentResolved,
          dailyCounts,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching division stats:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get query statistics with division filtering
exports.getQueryStatistics = async (req, res) => {
  try {
    filter = {};

    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
      // Exclude 'Road Damage' reports for division_admin
      filter.query_type = { $nin: ["Road Damage", "Suggestion"] };
    }

    // Get counts for each status
    const pending = await Query.countDocuments({
      ...filter,
      status: "Pending",
    });
    const inProgress = await Query.countDocuments({
      ...filter,
      status: "In Progress",
    });
    const resolved = await Query.countDocuments({
      ...filter,
      status: "Resolved",
    });
    const rejected = await Query.countDocuments({
      ...filter,
      status: "Rejected",
    });

    // Get counts for each query type
    const trafficViolation = await Query.countDocuments({
      ...filter,
      query_type: "Traffic Violation",
    });
    const trafficCongestion = await Query.countDocuments({
      ...filter,
      query_type: "Traffic Congestion",
    });
    const accident = await Query.countDocuments({
      ...filter,
      query_type: "Accident",
    });
    const roadDamage = await Query.countDocuments({
      ...filter,
      query_type: "Road Damage",
    });
    const illegalParking = await Query.countDocuments({
      ...filter,
      query_type: "Illegal Parking",
    });
    const suggestion = await Query.countDocuments({
      ...filter,
      query_type: "Suggestion",
    });
    const joinRequest = await Query.countDocuments({
      ...filter,
      query_type: "Join Request",
    });
    const generalReport = await Query.countDocuments({
      ...filter,
      query_type: "General Report",
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentQueries = await Query.countDocuments({
      ...filter,
      timestamp: { $gte: thirtyDaysAgo },
    });
    const recentResolved = await Query.countDocuments({
      ...filter,
      status: "Resolved",
      resolved_at: { $gte: thirtyDaysAgo },
    });

    // Get daily counts for the past month for a chart
    const dailyCounts = await Query.aggregate([
      {
        $match: {
          timestamp: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        total: pending + inProgress + resolved + rejected,
        byStatus: { pending, inProgress, resolved, rejected },
        byType: {
          trafficViolation,
          trafficCongestion,
          accident,
          roadDamage,
          illegalParking,
          suggestion,
          joinRequest,
          generalReport,
        },
        recent: {
          totalQueries: recentQueries,
          resolvedQueries: recentResolved,
          dailyCounts,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching query statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// New function to get statistics by division (for main dashboard)
exports.getStatisticsByDivision = async (req, res) => {
  try {
    // Get all divisions
    const divisions = await Division.find().select("name code");

    // For each division, get the statistics
    const divisionStats = await Promise.all(
      divisions.map(async (division) => {
        // Filter by this division
        const filter = { division: division._id };

        // Get counts by status
        const pending = await Query.countDocuments({
          ...filter,
          status: "Pending",
        });
        const inProgress = await Query.countDocuments({
          ...filter,
          status: "In Progress",
        });
        const resolved = await Query.countDocuments({
          ...filter,
          status: "Resolved",
        });
        const rejected = await Query.countDocuments({
          ...filter,
          status: "Rejected",
        });

        // Get total for this division
        const total = pending + inProgress + resolved + rejected;

        // Get resolution rate
        const resolutionRate =
          total > 0 ? ((resolved / total) * 100).toFixed(1) : 0;

        return {
          division: {
            id: division._id,
            name: division.name,
            code: division.code,
          },
          total,
          byStatus: { pending, inProgress, resolved, rejected },
          resolutionRate,
        };
      })
    );

    return res.status(200).json({
      success: true,
      divisionStats,
    });
  } catch (error) {
    console.error("Error fetching division statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


