/**
 * Middleware to log all incoming requests
 */
function requestLogger(req, res, next) {
    // Create unique request ID
    const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    req.requestId = requestId;
    
    // Log request details
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.originalUrl || req.url;
    
    // Don't log full body for privacy/performance, just log it exists
    const hasBody = req.body && Object.keys(req.body).length > 0;
    
    console.log(`[${timestamp}] [REQ:${requestId}] ${method} ${url} ${hasBody ? 'WITH BODY' : ''}`);
    
    // Track response time
    const startTime = Date.now();
    
    // Capture response
    const originalSend = res.send;
    res.send = function(data) {
      const duration = Date.now() - startTime;
      console.log(`[${timestamp}] [RES:${requestId}] STATUS: ${res.statusCode} TIME: ${duration}ms`);
      return originalSend.apply(res, arguments);
    };
    
    next();
  }
  
  module.exports = requestLogger;