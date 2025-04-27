const Session = require('../models/Session');

/**
 * Get or create a user session
 * @param {string} userId - The user ID (WhatsApp number)
 * @returns {Object} - The user session
 */
exports.getUserSession = async (userId) => {
  let session = await Session.findOne({ user_id: userId });
  const now = new Date();
  
  // Define what constitutes a "new conversation" - e.g., 6 hours of inactivity
  const conversationTimeout = 1 * 60 * 60 * 1000; // 1 hour in milliseconds
  
  if (!session) {
    // Create new session with language selection as first state
    session = new Session({
      user_id: userId,
      current_state: 'LANGUAGE_SELECT',
      last_option: null,
      language: 'en', // Default language is English
      last_interaction: now,
      user_name: null // Initialize as null
    });
    await session.save();
    console.log('New user session created with language selection prompt');
  } else if ((now - session.last_interaction) > conversationTimeout) {
    // If it's been more than the timeout period, reset conversation state
    // BUT preserve the user's name if it exists
    const userName = session.user_name; // Save the existing user name
    
    // If user already has a name, skip the name collection step
    if (userName) {
      session.current_state = 'MENU'; // Go directly to menu
      console.log(`Returning user ${userName} detected, skipping name collection`);
    } else {
      session.current_state = 'LANGUAGE_SELECT'; // Otherwise start with language
    }
    
    session.last_option = null;
    session.last_interaction = now;
    await session.save();
  } else {
    // Regular session update
    session.last_interaction = now;
    await session.save();
  }
  
  return session;
};

/**
 * Update user session
 * @param {Object} session - The session object
 * @param {string} newState - New state
 * @param {string} newLastOption - New last option
 * @param {string} newLanguage - New language
 */
exports.updateUserSession = async (session, newState, newLastOption, newLanguage) => {
  session.current_state = newState;
  session.last_option = newLastOption;
  if (newLanguage) {
    session.language = newLanguage;
  }
  session.last_interaction = new Date();
  await session.save();
};