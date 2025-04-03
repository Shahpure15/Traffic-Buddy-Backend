const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const NodeCache = require('node-cache');
const locationCache = new NodeCache({ 
  stdTTL: 86400, // Cache for 24 hours (increased from 1 hour)
  checkperiod: 3600, // Check for expired keys every hour
  useClones: false // Don't clone objects for better performance
}); 


// Load environment variables
dotenv.config();

// Import utility functions
const { uploadImageToR2 } = require('./utils/imageupload');
const { sendQueryNotification } = require('./utils/emailer');
const { getCameraAppLink, getInstructionMessage, getUniversalLink, getCaptureUrl } = require('./utils/deeplink');
const { getText, getLanguagePrompt } = require('./utils/language');
const { getReportInstructionMessage } = require('./utils/deeplink');
const { getTwilioClient, sendWhatsAppMessage, notifyDivisionOfficers } = require('./utils/whatsapp');
const { getUserSession, updateUserSession } = require('./utils/sessionManager');


// Import database connection
const connectDB = require('./config/database');

// Import models
const Query = require('./models/Query');
const Session = require('./models/Session');
const { Division } = require('./models/Division');
const TeamApplication = require('./models/TeamApplication');
const Departments = require('./models/Departments');
const EmailRecord = require('./models/Departments');
const ReportLink = require('./models/ReportLink');

// Import routes
const uploadRoutes = require('./routes/upload');
const queryRoutes = require('./routes/queryRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const authRoutes = require('./routes/authRoutes');
const otpRoutes = require('./routes/otpRoutes');
const userRoutes = require('./routes/userRoutes');
const reportRoutes = require('./routes/reportRoutes');
const teamApplicationRoutes = require('./routes/teamApplicationRoutes');



// Check for required environment variables
const requiredEnvVars = [
  'CLOUDFLARE_R2_BUCKET_NAME',
  'CLOUDFLARE_R2_ENDPOINT',
  'CLOUDFLARE_R2_ACCESS_KEY',
  'CLOUDFLARE_R2_SECRET_KEY',
  'CLOUDFLARE_R2_PUBLIC_URL',
  'TWILIO_AUTH_TOKEN',
  'EMAIL_USER',
  'EMAIL_PASS',
  'MAIN_ADMIN_USERNAME',
  'MAIN_ADMIN_PASSWORD'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (!process.env.MAIN_ADMIN_USERNAME || !process.env.MAIN_ADMIN_PASSWORD) {
  console.error('Missing main admin credentials in environment variables');
  console.error('MAIN_ADMIN_USERNAME & MAIN_ADMIN_PASSWORD are required');
  console.error('Please check your .env file');
  process.exit(1);
}

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:');
  missingEnvVars.forEach(envVar => console.error(`- ${envVar}`));
  console.error('Please check your .env file');
} else {
  console.log('All required environment variables found');
}

// Utility function to find which division a location belongs to
// Replace the findDivisionForLocation function with this improved version

// Replace the existing findDivisionForLocation function with this fixed version
// Update the findDivisionForLocation function to remove fallback to DIGHI ALANDI
async function findDivisionForLocation(latitude, longitude) {
  try {
    // Input validation
    if (!latitude || !longitude) {
      console.error('Invalid coordinates:', { latitude, longitude });
      return null;
    }
    
    // Convert to numbers explicitly
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    
    if (isNaN(lat) || isNaN(lng)) {
      console.error('Coordinates are not valid numbers:', { latitude, longitude });
      return null;
    }
    
    // First check the cache with precise coordinates
    const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const cachedDivision = locationCache.get(cacheKey);
    if (cachedDivision) {
      console.log(`Cache hit for location: ${cacheKey}`);
      // Get the full division document from database only if we have a valid division
      if (cachedDivision._id) {
        return await Division.findById(cachedDivision._id);
      } else {
        console.log('Cached location is marked as outside jurisdiction');
        return null;
      }
    }
    
    console.log(`Finding division for location: ${lat}, ${lng}`);
    
    // Get all divisions
    const divisions = await Division.find();
    console.log(`Checking against ${divisions.length} divisions`);
    
    // Define a bounding box for PCMC area (rough estimate)
    // These coordinates represent a rectangular area covering PCMC
    const pcmcBounds = {
      minLat: 18.44, // Southern border
      maxLat: 18.85, // Northern border
      minLng: 73.69, // Western border
      maxLng: 74.06  // Eastern border
    };
    
    // Check if the location is even in the general PCMC area
    if (lat < pcmcBounds.minLat || lat > pcmcBounds.maxLat || 
        lng < pcmcBounds.minLng || lng > pcmcBounds.maxLng) {
      console.log('Location is outside the PCMC area');
      // Cache this location as outside jurisdiction
      locationCache.set(cacheKey, { outside: true });
      return null;
    }
    
    // Test each division with valid boundaries
    for (const division of divisions) {
      if (!division.boundaries || !division.boundaries.coordinates || 
          !Array.isArray(division.boundaries.coordinates) || 
          division.boundaries.coordinates.length === 0 ||
          !Array.isArray(division.boundaries.coordinates[0])) {
        continue; // Skip divisions with invalid boundary data
      }
      
      const polygon = division.boundaries.coordinates[0];
      
      // Skip if polygon has fewer than 3 points (not a valid polygon)
      if (!Array.isArray(polygon) || polygon.length < 3) {
        continue;
      }
      
      // Check if the point is inside this division
      if (isPointInPolygon([lng, lat], polygon)) {
        console.log(`Found matching division: ${division.name}`);
        // Cache division ID and name for future lookups
        locationCache.set(cacheKey, { 
          _id: division._id, 
          name: division.name 
        });
        return division;
      }
    }
    
    // If we reach here, the location is not in any specific division
    // But it's within the PCMC bounding box
    console.log('Location is not within any defined division boundary');
    
    // Cache this result to avoid repeated checks
    locationCache.set(cacheKey, { outside: true });
    return null;
  } catch (error) {
    console.error('Error finding division for location:', error);
    return null;
  }
}

// Improved isPointInPolygon function
function isPointInPolygon(point, polygon) {
  // Validation
  if (!Array.isArray(point) || point.length < 2 || 
      !Array.isArray(polygon) || polygon.length < 3) {
    console.error('Invalid point or polygon', { point, polygonLength: polygon?.length });
    return false;
  }
  
  const x = parseFloat(point[0]); // longitude
  const y = parseFloat(point[1]); // latitude
  
  if (isNaN(x) || isNaN(y)) {
    console.error('Point coordinates are not valid numbers', point);
    return false;
  }
  
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    // Get current and previous vertices
    let xi = polygon[i][0];
    let yi = polygon[i][1];
    let xj = polygon[j][0];
    let yj = polygon[j][1];
    
    // Convert to numbers if they're strings
    xi = parseFloat(xi);
    yi = parseFloat(yi);
    xj = parseFloat(xj);
    yj = parseFloat(yj);
    
    // Skip invalid points
    if (isNaN(xi) || isNaN(yi) || isNaN(xj) || isNaN(yj)) {
      console.warn('Invalid polygon point detected, skipping', { xi, yi, xj, yj });
      continue;
    }
    
    // Check if ray from point crosses edge
    const intersect = ((yi > y) !== (yj > y)) && 
                     (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

function setupCors(req, res, next) {
  // Allow specific origins
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://trafficbuddy.yashraj221b.me',
    'https://traffic-buddy-frontend.vercel.app'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  // Set allowed methods and headers
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Access-Control-Allow-Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
}

// Initialize Express app
const app = express();
app.use(setupCors); // Add this line to use your custom CORS middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Enable CORS
// app.use(cors({
//   origin: ['http://localhost:5173', 'http://localhost:3000', 'https://trafficbuddy.yashraj221b.me' , 'https://traffic-buddy-frontend.vercel.app'],
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], 
//   allowedHeaders: ['Content-Type', 'Authorization']
// }));

app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://localhost:3000', 
    'https://trafficbuddy.yashraj221b.me', 
    'https://traffic-buddy-frontend.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Access-Control-Allow-Origin'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Add explicit OPTIONS handler for preflight requests
app.options('*', cors());

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/users', userRoutes);
app.use('/api', reportRoutes);
app.use('/api/applications', teamApplicationRoutes);

// Get Twilio client
const client = getTwilioClient();
const accountSid = process.env.TWILIO_SID || 'your_account_sid';
const authToken = process.env.TWILIO_AUTH_TOKEN || 'your_auth_token';

// Configure multer for handling media files
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper function to generate the main menu
function getMainMenu(language) {
  return getText('WELCOME_MESSAGE', language);
}

// Helper function to download and process media from Twilio
async function processMedia(body) {
  if (!body.NumMedia || parseInt(body.NumMedia) === 0) {
    return null;
  }

  console.log('Media found in message. Count:', body.NumMedia);

  try {
    const mediaUrl = body.MediaUrl0;
    const contentType = body.MediaContentType0 || 'image/jpeg';

    if (!mediaUrl) {
      console.error('No media URL found in the request');
      return null;
    }

    console.log(`Media URL: ${mediaUrl}`);
    console.log(`Content Type: ${contentType}`);

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await axios({
      method: 'get',
      url: mediaUrl,
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (response.status !== 200) {
      console.error('Failed to download media. Status:', response.status);
      return null;
    }

    console.log(`Downloaded media: ${response.data.length} bytes`);

    const base64Data = Buffer.from(response.data).toString('base64');
    const base64Image = `data:${contentType};base64,${base64Data}`;

    console.log('Uploading to R2...');
    const uploadedUrl = await uploadImageToR2(base64Image, 'traffic_buddy');
    console.log('Upload complete. URL:', uploadedUrl);

    return uploadedUrl;
  } catch (error) {
    console.error('Error processing media:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return null;
  }
}

function getReportTypeText(reportType) {
  const reportTypes = {
    '1': 'Traffic Violation',
    '2': 'Traffic Congestion',
    '3': 'Irregularity',
    '4': 'Road Damage',
    '5': 'Illegal Parking',
    '6': 'Traffic Signal Issue',
    '7': 'Suggestion'
  };
  
  return reportTypes[reportType] || 'Report';
}

// Return department details
app.get('/api/departments', async (req, res) => {
  try {
    const departments = await Departments.find();
    return res.status(200).json({
      success: true,
      departments: departments
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching departments'
    });
  }
});

// Serve the capture.html file
app.get('/capture.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'capture.html'));
});

// Add a new endpoint to check locations before submission

// Add a simple endpoint to check locations (useful for debugging and frontend validation)
app.get('/api/check-location', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Missing latitude or longitude parameters'
      });
    }
    
    const division = await findDivisionForLocation(lat, lng);
    
    if (!division) {
      return res.status(200).json({
        success: false,
        message: 'Location is outside PCMC jurisdiction. We can only process reports within PCMC limits.'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Location is within jurisdiction',
      division: division.name
    });
  } catch (error) {
    console.error('Error checking location:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking location'
    });
  }
});

// Endpoint to handle reports from the capture page
// Update the report endpoint

// Find your existing /api/report endpoint and replace it with this
// Update the /api/report endpoint for immediate response
app.post('/api/report', upload.single('image'), async (req, res) => {
  try {
    console.log('----- NEW REPORT SUBMISSION -----');
    // Extract form data
    const { userId, reportType, description, latitude, longitude, address, linkId } = req.body;
    
    console.log('Processing report submission:', { userId, reportType, linkId });
    
    // Validate required fields
    if (!userId || !reportType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Mark the link as used if linkId was provided
    if (linkId) {
      // Clean userId consistently, same as in other functions
      const cleanUserId = userId.replace(/whatsapp:[ ]*/i, '').replace(/^\+/, '');
      console.log('Marking link as used:', { linkId, cleanUserId });
      
      const link = await ReportLink.findOneAndUpdate(
        { 
          linkId, 
          $or: [
            { userId: cleanUserId },
            { userId: '+' + cleanUserId }
          ]
        },
        { $set: { used: true, usedAt: new Date() } }
      );
      
      // If link not found, still proceed but log it
      if (!link) {
        console.warn(`Link with ID ${linkId} not found in database`);
      } else {
        console.log('Link marked as used:', link);
      }
    }
    
    // Send immediate success response to client
    res.status(200).json({ success: true });
    
    // Process the report in the background
    if (req.file) {
      processReportInBackground(
        req.file, 
        latitude, 
        longitude,
        description, 
        userId, 
        reportType,
        address
      ).catch(err => console.error('Background processing error:', err));
    } else {
      // If no image, still create the report but without image
      processReportWithoutImage(
        latitude,
        longitude, 
        description,
        userId,
        reportType,
        address
      ).catch(err => console.error('Background processing error (no image):', err));
    }
  } catch (error) {
    console.error('Error processing report:', error);
    // Try to send error response if client is still connected
    try {
      res.status(500).json({ error: error.message });
    } catch (responseError) {
      console.error('Could not send error response:', responseError);
    }
  }
});

// Function to process reports without images
async function processReportWithoutImage(latitude, longitude, description, userId, reportType, address) {
  try {
    // Clean userId format
    const cleanUserId = userId.replace(/whatsapp:[ ]*(\+?)whatsapp:[ ]*(\+?)/i, 'whatsapp:+');
    console.log(`Cleaned userId for processing without image: ${cleanUserId}`);
    
    // Similar to processReportInBackground but without image upload
    const reportTypes = {
      '1': 'Traffic Violation',
      '2': 'Traffic Congestion',
      '3': 'Irregularity', // Changed from 'Accident' to 'Irregularity'
      '4': 'Road Damage',
      '5': 'Illegal Parking',
      '6': 'Traffic Signal Issue',
      '7': 'Suggestion'
    };
    const queryTypeText = reportTypes[reportType] || 'Report';
    
    // Find which division this location belongs to
    let division = null;
    let divisionName = 'Unknown';
    
    if (latitude && longitude) {
      division = await findDivisionForLocation(latitude, longitude);
      if (division) {
        divisionName = division.name;
      } else {
        // Location outside jurisdiction - inform user and stop
        try {
          await sendWhatsAppMessage(
            cleanUserId,
            getText('LOCATION_OUTSIDE_JURISDICTION', 'en')
          );
        } catch (notifyError) {
          console.error('Error notifying user about location outside jurisdiction:', notifyError);
        }
        return;
      }
    }
    
    // Get user information for the report
    let userName = 'Anonymous';
    try {
      const userSession = await Session.findOne({ 
        user_id: { $in: [userId, cleanUserId] } // Try both formats
      });
      if (userSession && userSession.user_name) {
        userName = userSession.user_name;
      }
    } catch (userError) {
      console.error('Error retrieving user name:', userError);
    }
    
    // Create new query document
    const newQuery = new Query({
      user_id: cleanUserId, // Store the cleaned ID
      user_name: userName,
      query_type: queryTypeText,
      description,
      photo_url: null, // No photo
      location: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        address: address || 'Unknown location'
      },
      status: 'Pending',
      timestamp: new Date(),
      division: division ? division._id : null,
      divisionName
    });
    
    // Save the query
    await newQuery.save();
    console.log(`New ${queryTypeText} report (no image) saved with ID: ${newQuery._id}`);
    
    // Notify division officers if division was found
    if (division) {
      try {
        console.log(`Notifying officers of division: ${division.name}`);
        const notifiedContacts = await notifyDivisionOfficers(newQuery, division);
        
        // Update query with notification status
        if (notifiedContacts.length > 0) {
          await Query.findByIdAndUpdate(newQuery._id, {
            divisionNotified: true,
            divisionOfficersNotified: notifiedContacts.map(phone => ({
              phone,
              timestamp: new Date()
            }))
          });
          console.log(`Notification status updated for query ${newQuery._id}`);
        }
      } catch (notificationError) {
        console.error('Error notifying division officers:', notificationError);
      }
    }
    
    // Send confirmation to user
    try {
      await sendWhatsAppMessage(
        cleanUserId,
        `Thank you! Your ${queryTypeText} report has been submitted successfully and assigned to the ${divisionName} division. You will be notified when there are updates.`
      );
    } catch (notifyError) {
      console.error('Error sending confirmation to user:', notifyError);
    }
  } catch (error) {
    console.error('Error processing report without image:', error);
    
    // Try to notify user of failure
    try {
      const cleanUserId = userId.replace(/whatsapp:[ ]*(\+?)whatsapp:[ ]*(\+?)/i, 'whatsapp:+');
      await sendWhatsAppMessage(
        cleanUserId,
        getText('REPORT_ERROR', 'en')
      );
    } catch (notifyError) {
      console.error('Error notifying user of failure:', notifyError);
    }
  }
}

// Add this function to your server.js
// Updated background processing function
// Find this function in server.js and replace it with this version

// Replace the existing processReportInBackground function with this fixed version
async function processReportInBackground(file, latitude, longitude, description, userId, reportType, address) {
  try {
    console.log(`Starting background processing for report from user ${userId}`);
    
    // Parse userId to get the phone number without duplicated prefixes
    const cleanUserId = userId.replace(/whatsapp:[ ]*(\+?)whatsapp:[ ]*(\+?)/i, 'whatsapp:+');
    console.log(`Cleaned userId for notifications: ${cleanUserId}`);
    
    // Check if location is in a division
    console.log('Checking if location is within any division...');
    const matchingDivision = await findDivisionForLocation(latitude, longitude);
    
    // If location is not in any division, inform the user and stop further processing
    if (!matchingDivision) {
      console.log('Location is outside PCMC jurisdiction');
      try {
        await sendWhatsAppMessage(
          cleanUserId,
          getText('LOCATION_OUTSIDE_JURISDICTION', 'en')
        );
      } catch (notifyError) {
        console.error('Error notifying user about location outside jurisdiction:', notifyError);
      }
      return;
    }
    
    // Upload image - now properly handling file object from multer
    let uploadedUrl = null;
    try {
      console.log('Uploading image to R2...');
      uploadedUrl = await uploadImageToR2(file);
      console.log('Image uploaded successfully:', uploadedUrl);
    } catch (uploadError) {
      console.error('Failed to upload image:', uploadError);
      // Continue without image if upload fails
    }
    
    // FIXED: Get user's session to retrieve their name
    // The issue was in how we were looking up the session
    let userName = 'Anonymous';
    try {
      // First try an exact match
      const formattedUserId = `whatsapp:+${userId.replace(/^\+|whatsapp:[ ]*(\+?)/gi, '')}`;
      console.log('Looking for session with user_id:', formattedUserId);
      
      let userSession = await Session.findOne({ user_id: formattedUserId });
      
      // If not found, try with just the number
      if (!userSession) {
        const phoneNumber = userId.replace(/^\+|whatsapp:[ ]*(\+?)/gi, '');
        console.log('Looking for session with phone number in user_id:', phoneNumber);
        userSession = await Session.findOne({ user_id: { $regex: phoneNumber } });
      }
      
      if (userSession && userSession.user_name) {
        userName = userSession.user_name;
        console.log(`Found user name in session: ${userName}`);
      } else {
        console.log('No user name found in session, using Anonymous');
      }
    } catch (userError) {
      console.error('Error retrieving user name:', userError);
    }
    
    // Get the query type text based on the report type number
    const reportTypes = {
      '1': 'Traffic Violation',
      '2': 'Traffic Congestion',
      '3': 'Irregularity', // Changed from 'Accident' to 'Irregularity'
      '4': 'Road Damage',
      '5': 'Illegal Parking',
      '6': 'Traffic Signal Issue',
      '7': 'Suggestion'
    };
    const queryTypeText = reportTypes[reportType] || 'Report';

    // Create query object with user name
    const query = new Query({
      user_id: cleanUserId,
      user_name: userName, // Now this should have the correct name
      query_type: queryTypeText,
      description: description || 'No description provided',
      location: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        address: address || 'Unknown location'
      },
      photo_url: uploadedUrl,
      division: matchingDivision._id,
      divisionName: matchingDivision.name,
      status: 'Pending',
      timestamp: new Date()
    });

    console.log(`Creating query with user_name: ${userName}`);
    
    // Save the query
    await query.save();
    console.log(`Query saved with ID: ${query._id}`);
    
    // Send confirmation to user immediately after saving the query
    const confirmationPromise = sendWhatsAppMessage(
      cleanUserId,
      `Thank you! Your ${queryTypeText} report has been submitted successfully and assigned to the ${matchingDivision.name} division. You will be notified when there are updates. Feel free to send another message in case of more reports.`
    );
    
    // Notify division officers in parallel
    const notificationPromise = notifyDivisionOfficers(query, matchingDivision)
      .then(notifiedContacts => {
        console.log(`Notified ${notifiedContacts.length} division officers`);
        return notifiedContacts;
      })
      .catch(error => {
        console.error('Error notifying division officers:', error);
        return [];
      });
    
    // Wait for both operations to complete
    await Promise.all([confirmationPromise, notificationPromise]);
    
    console.log('Background processing completed successfully');
  } catch (error) {
    console.error('Error in background processing:', error);
    
    // Notify user of failure
    try {
      const cleanUserId = userId.replace(/whatsapp:[ ]*(\+?)whatsapp:[ ]*(\+?)/i, 'whatsapp:+');
      await sendWhatsAppMessage(
        cleanUserId,
        getText('REPORT_ERROR', 'en')
      );
    } catch (notifyError) {
      console.error('Error notifying user of failure:', notifyError);
    }
  }
}

// Modify your existing endpoint
app.get('/api/check-link-validity', async (req, res) => {
  try {
    const { linkId, userId } = req.query;
    
    console.log('Checking link validity:', { linkId, userId });
    
    if (!linkId || !userId) {
      return res.status(400).json({ 
        valid: false, 
        message: 'Missing required parameters'
      });
    }
    
    // Fix the userId cleanup to handle multiple formats
    // This handles: "whatsapp:+123456", "whatsapp: +123456", "whatsapp:123456", "+123456", "123456"
    const cleanUserId = userId.replace(/whatsapp:[ ]*/i, '').replace(/^\+/, '');
    console.log('Cleaned userId for lookup:', cleanUserId);
    
    // Find link in database - LOOK FOR RECORDS WITH AND WITHOUT + PREFIX
    const link = await ReportLink.findOne({
      linkId,
      $or: [
        { userId: cleanUserId },
        { userId: '+' + cleanUserId }
      ]
    });
    
    console.log('Link found in database:', link);
    
    // If link doesn't exist
    if (!link) {
      console.log('Link not found in database');
      return res.status(404).json({ 
        valid: false, 
        message: 'This reporting link was not found'
      });
    }
    
    // Check if link is already used
    if (link.used) {
      return res.status(403).json({ 
        valid: false, 
        message: 'This reporting link has already been used'
      });
    }
    
    // Check if link is expired (links valid for 24 hours)
    const now = new Date();
    const linkCreatedAt = new Date(link.createdAt);
    const diffHours = Math.abs(now - linkCreatedAt) / 36e5; // hours
    
    if (diffHours > 24) {
      return res.status(403).json({ 
        valid: false, 
        message: 'This reporting link has expired'
      });
    }
    
    // Link is valid
    return res.status(200).json({ valid: true });
    
  } catch (error) {
    console.error('Error checking link validity:', error);
    return res.status(500).json({ 
      valid: false, 
      message: 'An error occurred checking the link validity'
    });
  }
});

// Webhook for incoming messages with image handling
app.post('/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('----- NEW WEBHOOK REQUEST -----');
    console.log('Request body:', JSON.stringify(req.body));

    const userMessage = req.body.Body || '';
    const userNumber = req.body.From || '';

    console.log(`From: ${userNumber}, Message: ${userMessage}`);

    // Process media first (if any)
    let mediaUrl = null;
    if (req.body.NumMedia && parseInt(req.body.NumMedia) > 0) {
      console.log('Processing media attachment');
      mediaUrl = await processMedia(req.body);
    }

    // Check for location data in the WhatsApp message
    let latitude = req.body.Latitude || null;
    let longitude = req.body.Longitude || null;
    let locationAddress = req.body.Address || null;

    // Get user session using the helper function
    const userSession = await getUserSession(userNumber);
    console.log('User session:', userSession);

    const currentState = userSession.current_state;
    const lastOption = userSession.last_option;
    const userLanguage = userSession.language || 'en';

    console.log(`Current state: ${currentState}, Last option: ${lastOption}, Language: ${userLanguage}`);

    // Process the message based on current state
    let responseMessage = '';
    let newState = currentState;
    let newLastOption = lastOption;
    let newLanguage = userLanguage;

    // Special command to reset the session and force language selection
    if (userMessage && userMessage.toLowerCase() === 'reset') {
      responseMessage = getLanguagePrompt('en'); // Default to English prompt for reset
      newState = 'LANGUAGE_SELECT';
      newLastOption = null;
      console.log('User session reset to language selection');
    }
    // Handle language selection state
    else if (currentState === 'LANGUAGE_SELECT') {
      if (userMessage === '1') {
        // English selected
        newLanguage = 'en';
        responseMessage = getText('NAME_REQUEST', 'en');
        newState = 'NAME_COLLECTION';
      } else if (userMessage === '2') {
        // Marathi selected
        newLanguage = 'mr';
        responseMessage = getText('NAME_REQUEST', 'mr');
        newState = 'NAME_COLLECTION';
      } else {
        // Invalid selection, show language prompt again
        responseMessage = getLanguagePrompt(userLanguage);
      }
    }
    // Handle name collection state
    else if (currentState === 'NAME_COLLECTION') {
      // Store the user's name
      userSession.user_name = userMessage;
      await userSession.save();
      
      // Confirm the name was saved
      responseMessage = getText('NAME_CONFIRMATION', userLanguage, userMessage);
      
      // Then show the main menu
      responseMessage += '\n\n' + getMainMenu(userLanguage);
      newState = 'MENU';
    }
    // Special command to return to menu from any state
    else if (userMessage && userMessage.toLowerCase() === 'menu') {
      responseMessage = getMainMenu(userLanguage);
      newState = 'MENU';
      newLastOption = null;
    }
    // Handle menu state
    else if (currentState === 'MENU') {
      // User is at the main menu
      if (userMessage === '1' || userMessage === '2' || userMessage === '3' || 
          userMessage === '4' || userMessage === '5' || userMessage === '6' || 
          userMessage === '7') {  // Now include option 7 in this group
      
        try {
          // FIX: Properly await the capture URL generation
          const captureUrl = await getCaptureUrl(userNumber, userMessage);
          console.log('Generated capture URL:', captureUrl); // Add debugging log
          
          // Now captureUrl is a resolved string, not a Promise
          const instructions = getReportInstructionMessage(captureUrl, userLanguage);
          responseMessage = getText('CAMERA_INSTRUCTIONS', userLanguage, instructions);
          
          newState = 'AWAITING_REPORT';
          newLastOption = userMessage;
        } catch (error) {
          console.error('Error generating capture URL:', error);
          responseMessage = "We're experiencing technical difficulties. Please try again later.";
          // Don't change state if there was an error
        }
      } else if (userMessage === '8') {
        // Handle join team request
        try {
          // Create a new application session
          const sessionId = `join_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
          
          // Generate the form URL
          const formUrl = `${process.env.SERVER_URL}/join-team.html?userId=${encodeURIComponent(userNumber)}&sessionId=${sessionId}`;
          
          // Send the link via WhatsApp
          responseMessage = getText('JOIN_FORM_LINK', userLanguage, formUrl);
          
          // Update user state
          newState = 'JOIN_TEAM_LINK_SENT';
          newLastOption = '8';
        } catch (error) {
          console.error('Error handling join team request:', error);
          responseMessage = 'Sorry, there was an error processing your request. Please try again later.';
        }
      } else {
        // Invalid option
        responseMessage = getMainMenu(userLanguage);
      }
    }
    // Handle AWAITING_REPORT state
    else if (currentState === 'AWAITING_REPORT') {
      // If the user sends a text message while in AWAITING_REPORT state,
      // return them to the main menu instead of showing an error
      responseMessage = getMainMenu(userLanguage);
      newState = 'MENU';
      newLastOption = null;
    }  
    // Handle direct suggestion text input
    else if (currentState === 'AWAITING_SUGGESTION_TEXT') {
      try {
        // Create a new Query for the suggestion
        const newQuery = new Query({
          user_id: userNumber,
          user_name: userSession.user_name || 'Anonymous',
          query_type: 'Suggestion',
          description: userMessage,
          photo_url: null, // No photo for suggestions
          status: 'Pending'
        });
        
        await newQuery.save();
        console.log('Saved suggestion to database');
        
        // Send confirmation to user
        responseMessage = getText('SUGGESTION_RESPONSE', userLanguage);
        newState = 'MENU';
        newLastOption = null;
      } catch (error) {
        console.error('Error saving suggestion:', error);
        responseMessage = getText('REPORT_ERROR', userLanguage);
        newState = 'MENU';
        newLastOption = null;
      }
    } else if (currentState === 'AWAITING_LOCATION') {
      // User should have sent location data
      if (latitude && longitude) {
        const matchingDivision = await findDivisionForLocation(latitude, longitude);
        if (!matchingDivision) {
          console.log('Location is outside PCMC jurisdiction');
          responseMessage = getText('LOCATION_OUTSIDE_JURISDICTION', userLanguage);
          newState = 'MENU';
          newLastOption = null;

          // Update user session
          await updateUserSession(userSession, newState, newLastOption, newLanguage);

          // Send response back to the user
          console.log('Sending response:', responseMessage);
          await client.messages.create({
            from: 'whatsapp:+918788649885',
            to: userNumber,
            body: responseMessage
          });

          return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }

        // Determine report type based on last option
        let reportType = 'General Report';
        switch (lastOption) {
          case '1':
            reportType = 'Traffic Violation';
            break;
          case '2':
            reportType = 'Traffic Congestion';
            break;
          case '3':
            reportType = 'Irregularity'; // Changed from 'Accident' to 'Irregularity'
            break;
          case '4':
            reportType = 'Road Damage';
            break;
          case '5':
            reportType = 'Illegal Parking';
            break;
          case '6':
            reportType = 'Traffic Signal Issue';
            break;
          case '7':
            reportType = 'Suggestion';
            break;
          default:
            reportType = 'General Report';
        }

        // Retrieve description and photo URL from session
        const description = userSession.last_description || 'No description provided';
        const photoUrl = userSession.last_photo_url || null;

        // Create a new report with user's name
        const newQuery = new Query({
          user_id: userNumber,
          user_name: userSession.user_name || 'Anonymous',
          query_type: reportType,
          description: description,
          photo_url: photoUrl,
          location: { 
            latitude: parseFloat(latitude), 
            longitude: parseFloat(longitude),
            address: locationAddress || `${latitude}, ${longitude}`
          },
          status: 'Pending',
          division: matchingDivision._id,
          divisionName: matchingDivision.name,
          divisionNotified: false
        });

        // Notify division officers via WhatsApp if they exist
        let notifiedOfficers = [];
        let divisionNotified = false;

        try {
          if (matchingDivision.officers && matchingDivision.officers.length > 0) {
            const activeOfficers = matchingDivision.officers.filter(officer => officer.isActive);
            
            // Only notify up to 2 officers
            const officersToNotify = activeOfficers.slice(0, 2);
            
            if (officersToNotify.length > 0) {
              const notificationMessage = `🚨 New Traffic Report in ${matchingDivision.name}\n\n` +
                `Type: ${reportType}\n` + // Using reportType which now has Irregularity instead of Accident
                `Location: ${locationAddress || 'See map link'}\n` +
                `Description: ${description}\n\n` +
                `To resolve this issue, click: ${process.env.SERVER_URL}/resolve.html?id=${newQuery._id}`;
                            
              // Send messages to officers
              for (const officer of officersToNotify) {
                try {
                  await sendWhatsAppMessage(officer.phone, notificationMessage);
                  console.log(`Notification sent to officer: ${officer.name} (${officer.phone})`);
                  
                  // Record that officer was notified
                  notifiedOfficers.push({
                    phone: officer.phone,
                    timestamp: new Date()
                  });
                } catch (officerError) {
                  console.error(`Failed to notify officer ${officer.name} (${officer.phone}):`, officerError);
                }
              }
              
              // Set divisionNotified to true if at least one officer was notified
              if (notifiedOfficers.length > 0) {
                divisionNotified = true;
              }
            } else {
              console.log('No active officers to notify for this division');
            }
          } else {
            console.log('No officers found for this division');
          }
        } catch (notificationError) {
          console.error('Error notifying division officers:', notificationError);
        }

        // Only save the query if divisionNotified is true
        if (!divisionNotified) {
          console.log('Division was not notified. Query will not be saved.');
          responseMessage = getText('NOTIFICATION_FAILED', userLanguage);
          newState = 'MENU';
          newLastOption = null;

          // Update user session
          await updateUserSession(userSession, newState, newLastOption, newLanguage);

          // Send response back to the user
          console.log('Sending response:', responseMessage);
          await client.messages.create({
            from: 'whatsapp:+918788649885',
            to: userNumber,
            body: responseMessage
          });

          return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }

        // Update the query object with notification details and save it
        newQuery.divisionNotified = true;
        newQuery.divisionOfficersNotified = notifiedOfficers;
        await newQuery.save();
        console.log(`Saved ${reportType} report to database with division: ${matchingDivision.name}`);

        // Update the notification message with the actual query ID
        if (notifiedOfficers.length > 0) {
          const updatedNotificationMessage = `🚨 New Traffic Report in ${matchingDivision.name}\n\n` +
            `Type: ${reportType}\n` +
            `Location: ${locationAddress || 'See map link'}\n` +
            `Description: ${description}\n\n` +
            `To resolve this issue, click: ${process.env.SERVER_URL}/resolve/${newQuery._id}`;
          
          // Resend the notification with the correct link
          for (const officer of notifiedOfficers) {
            try {
              await sendWhatsAppMessage(officer.phone, updatedNotificationMessage);
              console.log(`Updated notification sent to officer with correct link: ${officer.phone}`);
            } catch (updateError) {
              console.error(`Failed to send updated notification to ${officer.phone}:`, updateError);
            }
          }
        }

        // Send email notification
        try {
          await sendQueryNotification(newQuery, matchingDivision);
          console.log('Email notification sent');
        } catch (emailError) {
          console.error('Error sending email notification:', emailError);
        }

        // Send confirmation to user
        responseMessage = getText('REPORT_RESPONSE', userLanguage, reportType, !!photoUrl);
        newState = 'MENU';
        newLastOption = null;

        // Clear temporary session data
        userSession.last_description = null;
        userSession.last_photo_url = null;
        await userSession.save();
      } else {
        responseMessage = getText('LOCATION_MISSING_HINT', userLanguage);
        newState = 'AWAITING_LOCATION';
      }
    } else if (currentState === 'AWAITING_JOIN') {
      // Process join request
      // Join requests don't require location/division, so we can save them directly
      const infoLines = userMessage.split('\n');
      let name = '';
      let email = '';
      let phone = '';
      let location = '';
      
      for (const line of infoLines) {
        if (line.toLowerCase().includes('name:')) {
          name = line.split(':')[1]?.trim() || '';
        } else if (line.toLowerCase().includes('email:')) {
          email = line.split(':')[1]?.trim() || '';
        } else if (line.toLowerCase().includes('phone:')) {
          phone = line.split(':')[1]?.trim() || '';
        } else if (line.toLowerCase().includes('location:')) {
          location = line.split(':')[1]?.trim() || '';
        }
      }
      
      // Create a new join request
      const joinQuery = new Query({
        user_id: userNumber,
        user_name: userSession.user_name || 'Anonymous',
        query_type: 'Join Request',
        name: name,
        email: email,
        phone: phone,
        description: userMessage,
        status: 'Pending'
      });
      
      await joinQuery.save();
      console.log('Saved join request to database');
      
      // Send email notification
      try {
        await sendQueryNotification(joinQuery);
        console.log('Email notification sent');
      } catch (emailError) {
        console.error('Error sending email notification:', emailError);
      }
      
      // Send confirmation to user
      responseMessage = getText('JOIN_RESPONSE', userLanguage);
      newState = 'MENU';
      newLastOption = null;
    } else {
      // Default behavior for any other state
      responseMessage = getMainMenu(userLanguage);
      newState = 'MENU';
      newLastOption = null;
    }

    // Update user session with new state using the helper function
    await updateUserSession(userSession, newState, newLastOption, newLanguage);

    // Send response back to the user
    console.log('Sending response:', responseMessage);

    const message = await client.messages.create({
      from: 'whatsapp:+918788649885',
      to: userNumber,
      body: responseMessage
    });

    console.log(`Response sent with SID: ${message.sid}`);

    // Respond to Twilio webhook with success
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// Add this to server.js, below your other endpoint definitions
app.get('/join-team.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'join-team.html'));
});

// Endpoint to handle form submission 
app.post('/api/join-team', upload.single('aadharDocument'), async (req, res) => {
  try {
    const { 
      userId, 
      sessionId, 
      fullName, 
      division,
      motivation,
      address,
      phone,
      email,
      aadharNumber
    } = req.body;
    
    // Validate required fields
    if (!userId || !sessionId || !fullName || !division || !motivation || !address || !phone || !email || !aadharNumber) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }
    
    // Check if there's a valid user session
    const userSession = await Session.findOne({ user_id: userId });
    if (!userSession) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Calculate session expiry (24 hours from now)
    const sessionExpires = new Date();
    sessionExpires.setHours(sessionExpires.getHours() + 24);
    
    // Process aadhar document
    let aadharDocumentUrl = null;
    if (req.file) {
      const imageBuffer = req.file.buffer;
      const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
      aadharDocumentUrl = await uploadImageToR2(base64Image, 'TrafficBuddyDocs');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Aadhar document is required'
      });
    }
    
    // Create new application
    const application = new TeamApplication({
      user_id: userId,
      user_name: userSession.user_name || fullName || 'Unknown',
      full_name: fullName,
      division,
      motivation,
      address,
      phone,
      email,
      aadhar_number: aadharNumber,
      aadhar_document_url: aadharDocumentUrl,
      status: 'Pending',
      session_id: sessionId,
      session_expires: sessionExpires
    });
    
    await application.save();
    
    // Send confirmation message via WhatsApp
    await sendWhatsAppMessage(
      userId,
      getText('JOIN_APPLICATION_RECEIVED', userSession.language || 'en', 
              fullName, application._id.toString())
    );
    
    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      applicationId: application._id
    });
  } catch (error) {
    console.error('Error submitting application:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.'
    });
  }
});

// Add this new endpoint for suggestions
// Replace the existing /api/suggestion endpoint with this improved version
app.post('/api/suggestion', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('----- NEW SUGGESTION SUBMISSION -----');
    console.log('Request body:', req.body);
    console.log('Content-Type:', req.headers['content-type']);
    
    const { description, userId, linkId } = req.body;
    const latitude = req.body.latitude || null;
    const longitude = req.body.longitude || null;
    const address = req.body.address || null;
    
    if (!description || !userId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    // Mark the link as used if linkId was provided
    if (linkId) {
      // Clean userId consistently, same as in other functions
      const cleanUserId = userId.replace(/whatsapp:[ ]*/i, '').replace(/^\+/, '');
      console.log('Marking suggestion link as used:', { linkId, cleanUserId });
      
      const link = await ReportLink.findOneAndUpdate(
        { 
          linkId, 
          $or: [
            { userId: cleanUserId },
            { userId: '+' + cleanUserId }
          ]
        },
        { $set: { used: true, usedAt: new Date() } }
      );
      
      if (!link) {
        console.warn(`Link with ID ${linkId} not found in database`);
      } else {
        console.log('Link marked as used:', link);
      }
    }
    
    // Respond to user immediately
    res.status(202).json({ 
      success: true, 
      message: 'Suggestion received. Thank you for your feedback!' 
    });
    
    // Process in background
    setImmediate(async () => {
      try {
        // Clean userId for consistent handling
        const cleanUserId = userId.replace(/whatsapp:[ ]*(\+?)whatsapp:[ ]*(\+?)/i, 'whatsapp:+');
        
        // IMPORTANT FIX: Get user's name from Session collection
        let userName = 'Anonymous';
        try {
          // First try an exact match
          const formattedUserId = `whatsapp:+${userId.replace(/^\+|whatsapp:[ ]*(\+?)/gi, '')}`;
          console.log('Looking for session with user_id:', formattedUserId);
          
          let userSession = await Session.findOne({ user_id: formattedUserId });
          
          // If not found, try with just the number
          if (!userSession) {
            const phoneNumber = userId.replace(/^\+|whatsapp:[ ]*(\+?)/gi, '');
            console.log('Looking for session with phone number in user_id:', phoneNumber);
            userSession = await Session.findOne({ user_id: { $regex: phoneNumber } });
          }
          
          if (userSession && userSession.user_name) {
            userName = userSession.user_name;
            console.log(`Found user name in session: ${userName}`);
          } else {
            console.log('No user name found in session, using Anonymous');
          }
        } catch (userError) {
          console.error('Error retrieving user name:', userError);
        }
        
        // Create and save the suggestion query
        const newSuggestion = new Query({
          user_id: cleanUserId,
          user_name: userName, // Now using the retrieved name
          query_type: 'Suggestion',
          description: description,
          location: latitude && longitude ? {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            address: address || 'Unknown location'
          } : null,
          status: 'Pending',
          timestamp: new Date()
        });
        
        await newSuggestion.save();
        console.log(`Saved suggestion to database with ID: ${newSuggestion._id}`);
        
        // Send confirmation message
        try {
          await sendWhatsAppMessage(
            cleanUserId,
            `Thank you for your suggestion! We value your feedback and will review it soon.`
          );
          console.log('Confirmation message sent to user');
        } catch (messageError) {
          console.error('Error sending confirmation message:', messageError);
        }
      } catch (error) {
        console.error('Error processing suggestion in background:', error);
      }
    });
    
  } catch (error) {
    console.error('Error in suggestion submission:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

app.get('/resolve.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'resolve.html'));
});

app.get('/suggestion-capture.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'suggestion-capture.html'));
});

app.get('/pending-reports.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'pending-reports.html'));
});

app.get('/api/divisions', async (req, res) => {
  try {
    const divisions = await Division.find().select('name code');
    return res.status(200).json({ success: true, divisions });
  } catch (error) {
    console.error('Error fetching divisions:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Get a specific division
app.get('/api/divisions/:divisionId', async (req, res) => {
  try {
    const division = await Division.findById(req.params.divisionId).select('-dashboard_credentials.password');
    
    if (!division) {
      return res.status(404).json({ success: false, message: 'Division not found' });
    }
    
    return res.status(200).json({ success: true, division });
  } catch (error) {
    console.error('Error fetching division:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/reset-all-sessions', async (req, res) => {
  try {
    await Session.updateMany({}, { current_state: 'LANGUAGE_SELECT' });
    res.status(200).json({ message: 'All sessions reset to language selection' });
  } catch (error) {
    console.error('Error resetting sessions:', error);
    res.status(500).json({ error: 'Failed to reset sessions' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Connect to database before starting server
(async () => {
  try {
    await connectDB();
    
    // Start the server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to database. Server not started.');
    console.error(err);
  }
})();