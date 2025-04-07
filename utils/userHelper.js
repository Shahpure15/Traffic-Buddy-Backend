/**
 * Standardizes WhatsApp user IDs to consistent format
 * @param {string} userId - Raw user ID from WhatsApp
 * @param {boolean} includePrefix - Whether to include 'whatsapp:+' prefix 
 * @returns {string} - Normalized user ID
 */
function normalizeUserId(userId, includePrefix = true) {
    if (!userId) return includePrefix ? 'whatsapp:+unknown' : 'unknown';
    
    // Remove any existing whatsapp: prefix and spaces
    let cleanId = userId.replace(/whatsapp:[ ]*/ig, '');
    
    // Ensure it has exactly one + prefix
    cleanId = cleanId.replace(/^\++/, '');
    
    // Return with or without prefix as requested
    return includePrefix ? `whatsapp:+${cleanId}` : cleanId;
  }
  
  module.exports = { normalizeUserId };