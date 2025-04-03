/**
 * Creates the main menu with interactive buttons
 * @returns {Object} - Main menu message with buttons
 */
const getInteractiveMainMenu = () => {
    const bodyText = '*Welcome to Traffic Buddy!* 🚦\n\nChoose an option:';
    
    const buttons = [
      { id: "1", title: "Traffic Violation" },
      { id: "2", title: "Traffic Congestion" },
      { id: "3", title: "Accident" }
    ];
    
    return createButtonMessage(bodyText, buttons);
  };
  
  /**
   * Creates the second set of menu buttons
   * @returns {Object} - Second part of main menu with buttons
   */
  const getSecondaryMenu = () => {
    const bodyText = '*More Options:*';
    
    const buttons = [
      { id: "4", title: "Road Damage" },
      { id: "5", title: "Illegal Parking" },
      { id: "6", title: "Traffic Info" }
    ];
    
    return createButtonMessage(bodyText, buttons);
  };
  
  /**
   * Creates the third set of menu buttons
   * @returns {Object} - Third part of main menu with buttons
   */
  const getThirdMenu = () => {
    const bodyText = '*Additional Options:*';
    
    const buttons = [
      { id: "7", title: "Share Suggestion" },
      { id: "8", title: "Join Our Team" },
      { id: "menu", title: "Return to Menu" }
    ];
    
    return createButtonMessage(bodyText, buttons);
  };