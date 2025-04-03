const Query = require("../models/Query");
const Session = require("../models/Session");
const { Division } = require("../models/Division");
const mongoose = require("mongoose");

// Get dashboard summary statistics
exports.getDashboardSummary = async (req, res) => {
  try {
    // Check if we should filter by division
    let divisionFilter = {};
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      divisionFilter = {
        division: new mongoose.Types.ObjectId(req.user.divisionId),
        query_type: { $nin: ["Road Damage", "Suggestion"] },
      };
    } else if (req.query.division) {
      // Allow filtering by division for main admin
      if (mongoose.Types.ObjectId.isValid(req.query.division)) {
        divisionFilter = {
          division: new mongoose.Types.ObjectId(req.query.division),
        };
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({
          code: req.query.division,
        });
        if (divisionDoc) {
          divisionFilter = { division: divisionDoc._id };
        }
      }
    }

    // Get total queries with division filter
    const totalQueries = await Query.countDocuments(divisionFilter);

    // Get total users (unique user_ids from queries) with division filter
    const uniqueUsers = await Query.distinct("user_id", divisionFilter);
    const userCount = uniqueUsers.length;

    // Get active sessions (modified in the last day)
    // Note: Sessions are not division-specific, so this will show all sessions
    // If you want to restrict this for division admins, you'd need to adjust the Session model
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const activeSessions = await Session.countDocuments({
      last_interaction: { $gte: yesterday },
    });

    // Get queries by status with division filter
    const pendingQueries = await Query.countDocuments({
      ...divisionFilter,
      status: "Pending",
    });
    const inProgressQueries = await Query.countDocuments({
      ...divisionFilter,
      status: "In Progress",
    });
    const resolvedQueries = await Query.countDocuments({
      ...divisionFilter,
      status: "Resolved",
    });
    const rejectedQueries = await Query.countDocuments({
      ...divisionFilter,
      status: "Rejected",
    });

    // Get queries by type with division filter
    const queryTypes = await Query.aggregate([
      { $match: divisionFilter },
      { $group: { _id: "$query_type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Get most recent queries with division filter
    const recentQueries = await Query.find(divisionFilter)
      .sort({ timestamp: -1 })
      .limit(5);

    // Get most active users with division filter
    const activeUsers = await Query.aggregate([
      { $match: divisionFilter },
      {
        $group: {
          _id: "$user_id",
          count: { $sum: 1 },
          userName: { $first: "$user_name" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Get queries per day (past week) with division filter
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const queriesPerDay = await Query.aggregate([
      {
        $match: {
          ...divisionFilter,
          timestamp: { $gte: oneWeekAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Build and send response
    return res.status(200).json({
      success: true,
      data: {
        totalQueries,
        userCount,
        activeSessions,
        queryStatus: {
          pending: pendingQueries,
          inProgress: inProgressQueries,
          resolved: resolvedQueries,
          rejected: rejectedQueries,
        },
        queryTypes,
        recentQueries,
        activeUsers,
        queriesPerDay,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard summary:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get recent activity for dashboard
exports.getRecentActivity = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    // Check if we should filter by division
    let divisionFilter = {};
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      divisionFilter = {
        division: new mongoose.Types.ObjectId(req.user.divisionId),
        query_type: { $nin: ["Road Damage", "Suggestion"] },
      };
    } else if (req.query.division) {
      // Allow filtering by division for main admin
      if (mongoose.Types.ObjectId.isValid(req.query.division)) {
        divisionFilter = {
          division: new mongoose.Types.ObjectId(req.query.division),
        };
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({
          code: req.query.division,
        });
        if (divisionDoc) {
          divisionFilter = { division: divisionDoc._id };
        }
      }
    }

    // Get most recent queries with division filter
    const recentQueries = await Query.find(divisionFilter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      data: recentQueries,
    });
  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get geolocated queries for map display
exports.getMapData = async (req, res) => {
  try {
    // Check if we should filter by division
    let divisionFilter = {};
    if (req.user && req.user.role === "division_admin" && req.user.divisionId) {
      divisionFilter = {
        division: new mongoose.Types.ObjectId(req.user.divisionId),
        query_type: { $nin: ["Road Damage", "Suggestion"] },
      };
    } else if (req.query.division) {
      // Allow filtering by division for main admin
      if (mongoose.Types.ObjectId.isValid(req.query.division)) {
        divisionFilter = {
          division: new mongoose.Types.ObjectId(req.query.division),
        };
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({
          code: req.query.division,
        });
        if (divisionDoc) {
          divisionFilter = { division: divisionDoc._id };
        }
      }
    }

    // Only get queries that have valid location data with division filter
    const geoQueries = await Query.find({
      ...divisionFilter,
      "location.latitude": { $ne: null },
      "location.longitude": { $ne: null },
    }).select("query_type location status timestamp description photo_url");

    return res.status(200).json({
      success: true,
      data: geoQueries,
    });
  } catch (error) {
    console.error("Error fetching map data:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getAllDivisions = async (req, res) => {
  try {
    const divisions = await Division.find().select("name code");

    return res.status(200).json({
      success: true,
      data: divisions,
    });
  } catch (error) {
    console.error("Error fetching divisions:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getDivisionPerformance = async (req, res) => {
  try {
    // Get all divisions
    const divisions = await Division.find().select("name code");

    // For each division, calculate performance metrics
    const performanceData = await Promise.all(
      divisions.map(async (division) => {
        const totalQueries = await Query.countDocuments({
          division: division._id,
        });
        const resolvedQueries = await Query.countDocuments({
          division: division._id,
          status: "Resolved",
        });

        // Queries from the last 7 days
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);

        const recentQueries = await Query.countDocuments({
          division: division._id,
          timestamp: { $gte: lastWeek },
        });

        const recentResolved = await Query.countDocuments({
          division: division._id,
          status: "Resolved",
          resolved_at: { $gte: lastWeek },
        });

        // Calculate resolution rate
        const resolutionRate =
          totalQueries > 0
            ? ((resolvedQueries / totalQueries) * 100).toFixed(1)
            : 0;
        const recentResolutionRate =
          recentQueries > 0
            ? ((recentResolved / recentQueries) * 100).toFixed(1)
            : 0;

        return {
          division: {
            id: division._id,
            name: division.name,
            code: division.code,
          },
          totalQueries,
          resolvedQueries,
          pendingQueries: totalQueries - resolvedQueries,
          resolutionRate,
          recentQueries,
          recentResolved,
          recentResolutionRate,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: performanceData,
    });
  } catch (error) {
    console.error("Error fetching division performance:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
