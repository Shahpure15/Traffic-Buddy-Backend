const Query = require("../models/Query");
const { Division } = require("../models/Division");
const TeamApplication = require("../models/TeamApplication");
const { sendWhatsAppMessage } = require("../utils/whatsapp");
const { getText } = require("../utils/language");
const Session = require("../models/Session");
const { sendQueryEmail } = require("../utils/email");
const mongoose = require("mongoose");
const EmailRecord = require("../models/EmailRecords");
const ExcelJS = require('exceljs'); // Import exceljs


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
    const { status, resolution_note } = req.body;

    if (!["Pending", "In Progress", "Resolved", "Rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
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

    // If status is being changed to Resolved, add resolution timestamp
    if (status === "Resolved") {
      query.resolved_at = new Date();
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
          // Replace placeholders with actual values
          statusMessage = getText("STATUS_RESOLVED", userLanguage)
            .replace("{0}", queryTypeForMessage.toLowerCase())
            .replace(
              "{1}",
              resolution_note || "No additional details provided."
            );
        } else if (status === "Rejected") {
          // Replace placeholders with actual values
          statusMessage = getText("STATUS_REJECTED", userLanguage)
            .replace("{0}", queryTypeForMessage.toLowerCase())
            .replace("{1}", resolution_note || "No reason specified.");
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

exports.getEmailRecords = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Aggregation pipeline to group by queryId and departmentName
    const aggregationPipeline = [
      {
        $sort: { sentAt: 1 }, // Sort to reliably get the first sent time and status
      },
      {
        $group: {
          _id: {
            queryId: "$queryId",
            departmentName: "$departmentName",
          },
          emails: { $push: "$emails" }, // Collect all emails for the group
          subject: { $first: "$subject" }, // Take details from the first record
          division: { $first: "$division" },
          status: { $first: "$status" }, // Represents status of the first attempt
          sentAt: { $first: "$sentAt" }, // Timestamp of the first email sent to this dept for this query
          queryObjectId: { $first: "$queryId" }, // Keep queryId for population
        },
      },
       {
        $lookup: { // Populate query details to get query_type
          from: 'queries', // Ensure this is the correct collection name for queries
          localField: 'queryObjectId',
          foreignField: '_id',
          as: 'queryInfo'
        }
      },
      {
        $unwind: { // Unwind the queryInfo array
          path: "$queryInfo",
          preserveNullAndEmptyArrays: true // Keep records even if query is deleted/not found
        }
      },
      {
        $project: { // Reshape the output
          _id: 0, // Exclude the default group _id
          queryId: "$_id.queryId",
          departmentName: "$_id.departmentName",
          emails: 1, // The array of emails sent
          subject: 1,
          division: 1,
          status: 1,
          sentAt: 1,
          queryType: "$queryInfo.query_type", // Add query type
        },
      },
      {
        $sort: { sentAt: -1 }, // Sort the final grouped results by the first sent time
      },
      {
        $facet: { // Use $facet for pagination on aggregated results
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: parseInt(limit) }],
        },
      },
    ];

    const results = await EmailRecord.aggregate(aggregationPipeline);

    const emailRecords = results[0].data;
    const totalRecords = results[0].metadata.length > 0 ? results[0].metadata[0].total : 0;
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      count: emailRecords.length, // Count of groups on the current page
      total: totalRecords, // Total number of groups
      totalPages: totalPages,
      currentPage: parseInt(page),
      data: emailRecords, // Send the grouped data
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

exports.exportEmailRecords = async (req, res) => {
  try {
    const { year, month } = req.query; // Expect year and month (1-12)

    if (!year || !month) {
      return res.status(400).json({ success: false, message: 'Year and month parameters are required.' });
    }

    // Validate year and month
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ success: false, message: 'Invalid year or month.' });
    }

    // Calculate start and end dates for the given month in UTC
    const startDate = new Date(Date.UTC(yearNum, monthNum - 1, 1, 0, 0, 0, 0)); // Month is 0-indexed in JS Date
    const endDate = new Date(Date.UTC(yearNum, monthNum, 1, 0, 0, 0, 0)); // Start of the next month
    endDate.setMilliseconds(endDate.getMilliseconds() - 1); // End of the specified month

    console.log(`Exporting email records from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Fetch RAW email records for the specified month/year
    const records = await EmailRecord.find({
      sentAt: { $gte: startDate, $lte: endDate },
    })
    .sort({ sentAt: -1 }) // Sort by date descending
    .populate({ // Populate query details
        path: 'queryId',
        select: 'query_type timestamp user_name location.address' // Select desired fields from Query model
    })
    .lean(); // Use lean() for better performance with large datasets

    if (!records || records.length === 0) {
        // Send a 404 status but allow frontend to handle message
        return res.status(404).send('No email records found for the selected month.');
    }

    // Create Excel workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Email Records ${yearNum}-${monthNum.toString().padStart(2, '0')}`);

    // Define columns for the Excel sheet
    worksheet.columns = [
      { header: 'Sr. No.', key: 'srNo', width: 8 },
      { header: 'Department Name', key: 'departmentName', width: 25 },
      { header: 'Recipient Email', key: 'email', width: 30 },
      { header: 'Subject', key: 'subject', width: 45 },
      { header: 'Query Type', key: 'queryType', width: 20 },
      { header: 'Query ID', key: 'queryIdStr', width: 28 },
      { header: 'Division', key: 'division', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Sent At', key: 'sentAt', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
      { header: 'Query Timestamp', key: 'queryTimestamp', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
      { header: 'Query User', key: 'queryUser', width: 25 },
      { header: 'Query Location', key: 'queryLocation', width: 40 },
    ];

    // Add rows to the worksheet
    records.forEach((record, index) => {
      worksheet.addRow({
        srNo: index + 1,
        departmentName: record.departmentName || 'N/A',
        email: record.emails, // This is the single email from the raw record
        subject: record.subject || 'N/A',
        queryType: record.queryId?.query_type || 'N/A',
        queryIdStr: record.queryId?._id.toString() || 'N/A', // Convert ObjectId to string
        division: record.division || 'N/A',
        status: record.status || 'N/A',
        sentAt: record.sentAt ? new Date(record.sentAt) : null, // Ensure it's a Date object for formatting
        queryTimestamp: record.queryId?.timestamp ? new Date(record.queryId.timestamp) : null,
        queryUser: record.queryId?.user_name || 'N/A',
        queryLocation: record.queryId?.location?.address || 'N/A',
      });
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern:'solid',
        fgColor:{argb:'FFD3D3D3'} // Light grey background
    };
    worksheet.getRow(1).border = {
        bottom: { style: 'thin' }
    };

    // Set response headers for Excel download
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="email_records_${yearNum}_${monthNum.toString().padStart(2, '0')}.xlsx"`
    );

    // Write workbook to response stream and end response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error exporting email records:', error);
     // Check if headers have already been sent before sending JSON error
     if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Internal server error during export.' });
     } else {
        // If headers are sent, we can't send JSON, just end the response or log
        console.error("Headers already sent, could not send JSON error response.");
        res.end();
     }
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
