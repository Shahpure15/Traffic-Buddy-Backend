
const nodemailer = require('nodemailer');

// Create a transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER || 'shripadgaurav444@gmail.com',
    pass: process.env.EMAIL_PASS || 'jcvq vcay ukbz kajm',
  },
});

/**
 * Generate HTML email template for query notification
 * @param {Object} query - The query object 
 * @param {String} departmentName - Name of the department 
 * @returns {String} - HTML email content
 */
const generateQueryEmailTemplate = (query, departmentName) => {
  const statusBadgeColor = {
    'Pending': '#FFA500',
    'In Progress': '#3498db',
    'Resolved': '#2ecc71',
    'Rejected': '#e74c3c'
  };

  // Format date in a readable format
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Location string handling
  let locationString = 'Not specified';
  if (query.location) {
    if (query.location.address) {
      locationString = query.location.address;
    } else if (query.location.coordinates && query.location.coordinates.length === 2) {
      locationString = `Lat: ${query.location.coordinates[1]}, Lng: ${query.location.coordinates[0]}`;
    }
  }

  // Generate map link if coordinates are available
  let mapLink = '';
  if (query.location && query.location.coordinates && query.location.coordinates.length === 2) {
    const [lng, lat] = query.location.coordinates;
    mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
  }

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Traffic Buddy - ${query.query_type}</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        line-height: 1.6;
        color: #333;
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        border: 1px solid #ddd;
        border-radius: 8px;
      }
      .header {
        background-color: #1e88e5;
        padding: 15px;
        text-align: center;
        color: white;
        border-radius: 6px 6px 0 0;
      }
      .content {
        padding: 20px;
      }
      .footer {
        background-color: #f5f5f5;
        padding: 15px;
        text-align: center;
        font-size: 12px;
        color: #666;
        border-radius: 0 0 6px 6px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      th, td {
        padding: 12px 15px;
        border-bottom: 1px solid #ddd;
        text-align: left;
      }
      th {
        background-color: #f5f5f7;
      }
      .status-badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        color: white;
        font-size: 12px;
        font-weight: bold;
      }
      .map-link {
        display: block;
        margin-top: 15px;
        text-align: center;
      }
      .map-link a {
        display: inline-block;
        background-color: #1e88e5;
        color: white;
        padding: 10px 15px;
        text-decoration: none;
        border-radius: 4px;
      }
      .description-box {
        background-color: #f9f9f9;
        border-left: 4px solid #1e88e5;
        padding: 15px;
        margin-bottom: 20px;
        border-radius: 0 4px 4px 0;
      }
      .image-container {
        text-align: center;
        margin: 20px 0;
      }
      .image-container img {
        max-width: 100%;
        border-radius: 6px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Traffic Buddy - ${query.query_type}</h1>
        <p>Notification for ${departmentName}</p>
      </div>
      <div class="content">
        <p>Dear ${departmentName} Team,</p>
        <p>A new ${query.query_type.toLowerCase()} has been reported through the Traffic Buddy system that requires your attention.</p>
        
        <h3>Query Details:</h3>
        <table>
          <tr>
            <th>Reference ID</th>
            <td>${query._id}</td>
          </tr>
          <tr>
            <th>Type</th>
            <td>${query.query_type}</td>
          </tr>
          <tr>
            <th>Reported By</th>
            <td>${query.user_name || 'Anonymous User'}</td>
          </tr>
          <tr>
            <th>Reported On</th>
            <td>${formatDate(query.timestamp)}</td>
          </tr>
          <tr>
            <th>Status</th>
            <td><span class="status-badge" style="background-color: ${statusBadgeColor[query.status]};">${query.status}</span></td>
          </tr>
          ${query.vehicle_number ? `
          <tr>
            <th>Vehicle Number</th>
            <td>${query.vehicle_number}</td>
          </tr>` : ''}
          <tr>
            <th>Location</th>
            <td>${locationString}</td>
          </tr>
        </table>

        <h3>Description:</h3>
        <div class="description-box">
          <p>${query.description || 'No description provided'}</p>
        </div>

        ${query.media && query.media.length > 0 ? `
        <h3>Attached Media:</h3>
        <div class="image-container">
          <img src="${query.media[0]}" alt="Reported issue image" />
        </div>
        ` : ''}

        ${mapLink ? `
        <div class="map-link">
          <a href="${mapLink}" target="_blank">View Location on Map</a>
        </div>
        ` : ''}

        <p>Please take appropriate action and update the status of this query through the Traffic Buddy admin panel.</p>
        <p>Thank you for your prompt attention to this matter.</p>
      </div>
      <div class="footer">
        <p>This is an automated notification from Traffic Buddy. Please do not reply directly to this email.</p>
        <p>&copy; 2025 Traffic Buddy. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
  `;
};

/**
 * Send email with query information to department
 * @param {String} to - Recipient email address
 * @param {String} subject - Email subject
 * @param {Object} query - Query object
 * @param {String} departmentName - Name of the department
 * @returns {Promise} - Nodemailer send mail promise
 */
const sendQueryEmail = async (to, subject, query, departmentName) => {
    const htmlContent = generateQueryEmailTemplate(query, departmentName);
    
    const mailOptions = {
      from: `"Traffic Buddy" <${process.env.EMAIL_USER || config.EMAIL_USER || 'shripadgaurav444@gmail.com'}>`,
      to: to,
      subject: subject,
      html: htmlContent,
    };
  
    return transporter.sendMail(mailOptions);
  };
  
  module.exports = {
    sendQueryEmail,
  };