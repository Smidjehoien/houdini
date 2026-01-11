// ============================================================================
// CONSTANTS & DEFAULTS
// ============================================================================

const SEVERITIES = ['Critical', 'Major', 'Minor'];

const DEFAULT_STATE = {
  coderabbit: {
    visibilityState: {
      'Critical': true,
      'Major': true,
      'Minor': true
    },
    showAllState: true
  },
  customBots: {}  // { "botName": true|false }
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state manager for filter settings
 * Handles both global persistence and session overrides
 */
class FilterState {
  constructor() {
    this.currentState = this.getDefaultState();
  }

  /**
   * Get a fresh copy of default state
   */
  getDefaultState() {
    return {
      coderabbit: {
        visibilityState: { ...DEFAULT_STATE.coderabbit.visibilityState },
        showAllState: DEFAULT_STATE.coderabbit.showAllState
      },
      customBots: { ...DEFAULT_STATE.customBots }
    };
  }

  /**
   * Validate and sanitize state object
   */
  validateState(state) {
    if (!state || typeof state !== 'object') {
      return this.getDefaultState();
    }

    const validated = {
      coderabbit: {
        visibilityState: {},
        showAllState: state.coderabbit?.showAllState ?? true
      },
      customBots: {}
    };

    // Validate CodeRabbit severities
    SEVERITIES.forEach(severity => {
      validated.coderabbit.visibilityState[severity] = 
        state.coderabbit?.visibilityState?.[severity] ?? true;
    });

    // Validate custom bots (ensure all values are boolean)
    if (state.customBots && typeof state.customBots === 'object') {
      Object.entries(state.customBots).forEach(([botName, showAll]) => {
        if (typeof botName === 'string' && botName.trim()) {
          validated.customBots[botName.toLowerCase().trim()] = Boolean(showAll);
        }
      });
    }

    return validated;
  }

  /**
   * Get session storage key for a tab
   */
  getSessionKey(tabId) {
    return `session_${tabId}`;
  }

  /**
   * Load settings for a specific tab
   * Priority: session storage > global storage > defaults
   */
  async load(tabId) {
    try {
      // Check if chrome.storage is available
      if (!chrome?.storage) {
        console.warn('chrome.storage not available, using defaults');
        this.currentState = this.getDefaultState();
        return this.currentState;
      }

      // Try to load from session storage first
      const sessionKey = this.getSessionKey(tabId);
      const sessionResult = await chrome.storage.session.get(sessionKey);
      
      if (sessionResult[sessionKey]) {
        console.log('Loading from session storage for tab', tabId);
        this.currentState = this.validateState(sessionResult[sessionKey]);
        return this.currentState;
      }

      // Load from global storage
      const result = await chrome.storage.sync.get(['coderabbit', 'customBots']);
      console.log('Loading from global storage:', result);
      this.currentState = this.validateState(result);
      return this.currentState;
    } catch (error) {
      console.error('Error loading settings:', error);
      this.currentState = this.getDefaultState();
      return this.currentState;
    }
  }

  /**
   * Save current state to session for this tab
   */
  async saveToSession(tabId) {
    try {
      if (!chrome?.storage?.session) {
        console.warn('chrome.storage.session not available');
        return;
      }

      const sessionKey = this.getSessionKey(tabId);
      await chrome.storage.session.set({
        [sessionKey]: {
          coderabbit: {
            visibilityState: { ...this.currentState.coderabbit.visibilityState },
            showAllState: this.currentState.coderabbit.showAllState
          },
          customBots: { ...this.currentState.customBots }
        }
      });
      console.log('Saved to session storage for tab', tabId);
    } catch (error) {
      console.error('Error saving to session:', error);
    }
  }

  /**
   * Save current state as global defaults
   */
  async saveAsDefault() {
    try {
      // Check if chrome.storage is available
      if (!chrome?.storage?.sync) {
        console.error('chrome.storage.sync not available');
        return false;
      }

      await chrome.storage.sync.set({
        coderabbit: {
          visibilityState: this.currentState.coderabbit.visibilityState,
          showAllState: this.currentState.coderabbit.showAllState
        },
        customBots: this.currentState.customBots
      });
      console.log('Saved as global defaults:', this.currentState);
      return true;
    } catch (error) {
      console.error('Error saving defaults:', error);
      return false;
    }
  }

  /**
   * Update visibility for a specific severity (CodeRabbit)
   */
  setSeverityVisibility(severity, isVisible) {
    if (SEVERITIES.includes(severity)) {
      this.currentState.coderabbit.visibilityState[severity] = Boolean(isVisible);
    }
  }

  /**
   * Set show all state (CodeRabbit)
   */
  setShowAll(showAll) {
    this.currentState.coderabbit.showAllState = Boolean(showAll);
    
    // Update all severities when show/hide all is toggled
    SEVERITIES.forEach(severity => {
      this.currentState.coderabbit.visibilityState[severity] = showAll;
    });
  }

  /**
   * Add or update a custom bot filter
   * @param {string} botName - Name of the bot (will be normalized to lowercase)
   * @param {boolean} showAll - true = show, false = hide
   */
  setCustomBot(botName, showAll) {
    if (typeof botName === 'string' && botName.trim()) {
      const normalizedName = botName.toLowerCase().trim();
      this.currentState.customBots[normalizedName] = Boolean(showAll);
    }
  }

  /**
   * Remove a custom bot filter
   * @param {string} botName - Name of the bot to remove
   */
  removeCustomBot(botName) {
    if (typeof botName === 'string') {
      const normalizedName = botName.toLowerCase().trim();
      delete this.currentState.customBots[normalizedName];
    }
  }

  /**
   * Get list of custom bots being filtered
   * @returns {Array} Array of bot names
   */
  getCustomBotNames() {
    return Object.keys(this.currentState.customBots);
  }

  /**
   * Get current state (read-only copy)
   */
  get() {
    return {
      coderabbit: {
        visibilityState: { ...this.currentState.coderabbit.visibilityState },
        showAllState: this.currentState.coderabbit.showAllState
      },
      customBots: { ...this.currentState.customBots }
    };
  }
}

// Global state manager instance
const filterState = new FilterState();

// ============================================================================
// UI CONTROLLER
// ============================================================================

/**
 * Manages UI elements and their interactions
 */
class UIController {
  constructor() {
    this.severityButtons = {};
    this.currentTabId = null;
  }

  /**
   * Initialize the popup UI
   */
  async init() {
    try {
      const tab = await this.getCurrentTab();
      
      if (!this.validateTab(tab)) {
        return;
      }

      this.currentTabId = tab.id;

      // Load settings
      await filterState.load(tab.id);

      // Update UI to reflect loaded state
      this.updateShowHideAllButtons();
      this.updateCustomBotUI();

      // Scan and build severity controls
      const severities = await this.scanSeverities(tab.id);
      this.buildSeverityControls(severities);

      // Apply loaded settings
      await this.applyFilters();

    } catch (error) {
      console.error('Error initializing popup:', error);
      this.showStatus('Error initializing extension: ' + error.message, 'error');
    }
  }

  /**
   * Get current active tab
   */
  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  /**
   * Validate that tab is suitable for the extension
   */
  validateTab(tab) {
    if (!tab) {
      this.showStatus('Error: No active tab found', 'error');
      return false;
    }

    if (!tab.url || !tab.url.includes('github.com')) {
      this.showStatus('Please open a GitHub PR page', 'error');
      return false;
    }

    if (!tab.id) {
      this.showStatus('Error: Invalid tab ID', 'error');
      return false;
    }

    return true;
  }

  /**
   * Scan GitHub page for CodeRabbit comments
   */
  async scanSeverities(tabId) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript({
        target: { tabId },
        function: getAvailableSeverities
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.error('Error scanning severities:', chrome.runtime.lastError);
          resolve({});
          return;
        }

        if (!results?.[0]?.result) {
          console.error('Invalid scan results:', results);
          resolve({});
          return;
        }

        resolve(results[0].result);
      });
    });
  }

  /**
   * Build severity filter controls
   */
  buildSeverityControls(availableSeverities) {
    const container = document.getElementById('severityControls');
    if (!container) {
      console.error('Severity controls container not found');
      return;
    }

    // Clear existing controls
    container.innerHTML = '';

    const state = filterState.get();

    SEVERITIES.forEach(severity => {
      const count = availableSeverities[severity] || 0;
      if (count === 0) return; // Skip if no comments

      const group = this.createSeverityGroup(severity, count, state.coderabbit.visibilityState[severity]);
      container.appendChild(group);
    });
  }

  /**
   * Create a severity group UI element
   */
  createSeverityGroup(severity, count, isVisible) {
    const group = document.createElement('div');
    group.className = 'severity-group';

    const label = document.createElement('div');
    label.className = 'severity-label';
    label.innerHTML = `
      <span>${severity}</span>
      <span style="color: #57606a; font-size: 11px;">(${count})</span>
    `;

    const buttons = document.createElement('div');
    buttons.className = 'toggle-buttons';

    const showBtn = this.createToggleButton('Show', isVisible, () => {
      this.handleSeverityToggle(severity, true);
    });

    const hideBtn = this.createToggleButton('Hide', !isVisible, () => {
      this.handleSeverityToggle(severity, false);
    });

    this.severityButtons[severity] = { showBtn, hideBtn };

    buttons.appendChild(showBtn);
    buttons.appendChild(hideBtn);

    group.appendChild(label);
    group.appendChild(buttons);

    return group;
  }

  /**
   * Create a toggle button
   */
  createToggleButton(text, isActive, onClick) {
    const btn = document.createElement('button');
    btn.className = isActive ? 'toggle-btn active' : 'toggle-btn';
    btn.textContent = text;
    btn.onclick = onClick;
    return btn;
  }

  /**
   * Handle severity visibility toggle
   */
  async handleSeverityToggle(severity, isVisible) {
    try {
      filterState.setSeverityVisibility(severity, isVisible);

      const buttons = this.severityButtons[severity];
      if (buttons) {
        if (isVisible) {
          buttons.showBtn.classList.add('active');
          buttons.hideBtn.classList.remove('active');
        } else {
          buttons.showBtn.classList.remove('active');
          buttons.hideBtn.classList.add('active');
        }
      }

      await this.applyFilters();
    } catch (error) {
      console.error('Error toggling severity:', error);
      this.showStatus('Error toggling visibility', 'error');
    }
  }

  /**
   * Handle show all button click
   */
  async handleShowAll() {
    try {
      filterState.setShowAll(true);
      this.updateAllButtons(true);
      await this.applyFilters();
    } catch (error) {
      console.error('Error showing all:', error);
      this.showStatus('Error showing all', 'error');
    }
  }

  /**
   * Handle hide all button click
   */
  async handleHideAll() {
    try {
      filterState.setShowAll(false);
      this.updateAllButtons(false);
      await this.applyFilters();
    } catch (error) {
      console.error('Error hiding all:', error);
      this.showStatus('Error hiding all', 'error');
    }
  }

  /**
   * Update all button states
   */
  updateAllButtons(showAll) {
    this.updateShowHideAllButtons();

    Object.values(this.severityButtons).forEach(({ showBtn, hideBtn }) => {
      if (showAll) {
        showBtn?.classList.add('active');
        hideBtn?.classList.remove('active');
      } else {
        showBtn?.classList.remove('active');
        hideBtn?.classList.add('active');
      }
    });
  }

  /**
   * Update show/hide all buttons
   */
  updateShowHideAllButtons() {
    const state = filterState.get();
    const showAllBtn = document.getElementById('showAllBtn');
    const hideAllBtn = document.getElementById('hideAllBtn');

    if (state.coderabbit.showAllState) {
      showAllBtn?.classList.add('active');
      hideAllBtn?.classList.remove('active');
    } else {
      showAllBtn?.classList.remove('active');
      hideAllBtn?.classList.add('active');
    }
  }

  /**
   * Update custom bot UI to reflect current state
   */
  updateCustomBotUI() {
    const state = filterState.get();
    const listContainer = document.getElementById('customBotList');
    const allToggleContainer = document.getElementById('customBotAllToggle');
    
    if (!listContainer) return;

    // Clear existing list
    listContainer.innerHTML = '';

    // Display current custom bots
    const botNames = Object.keys(state.customBots);
    
    // Show/hide "All" toggle based on whether there are custom bots
    if (allToggleContainer) {
      if (botNames.length === 0) {
        allToggleContainer.style.display = 'none';
      } else {
        allToggleContainer.style.display = '';
        this.updateCustomBotAllButtons();
      }
    }

    if (botNames.length === 0) {
      listContainer.innerHTML = '<div class="no-bots">No custom bot filters</div>';
      return;
    }

    botNames.forEach(botName => {
      const showAll = state.customBots[botName];
      const item = this.createCustomBotItem(botName, showAll);
      listContainer.appendChild(item);
    });
  }

  /**
   * Update the "All" toggle buttons for custom bots
   */
  updateCustomBotAllButtons() {
    const state = filterState.get();
    const botNames = Object.keys(state.customBots);
    
    if (botNames.length === 0) return;

    // Check if all bots are shown or all are hidden
    const allShown = botNames.every(name => state.customBots[name] === true);
    const allHidden = botNames.every(name => state.customBots[name] === false);

    const showBtn = document.getElementById('customBotShowAllBtn');
    const hideBtn = document.getElementById('customBotHideAllBtn');

    if (showBtn && hideBtn) {
      if (allShown) {
        showBtn.classList.add('active');
        hideBtn.classList.remove('active');
      } else if (allHidden) {
        showBtn.classList.remove('active');
        hideBtn.classList.add('active');
      } else {
        // Mixed state - no button active
        showBtn.classList.remove('active');
        hideBtn.classList.remove('active');
      }
    }
  }

  /**
   * Create a custom bot list item
   */
    createCustomBotItem(botName, showAll) {
    const item = document.createElement('div');
    item.className = 'custom-bot-item';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';;
    removeBtn.title = 'Remove filter';
    removeBtn.onclick = () => this.handleRemoveCustomBot(botName);

    const nameLabel = document.createElement('div');
    nameLabel.className = 'bot-name';
    nameLabel.textContent = botName;

    const buttons = document.createElement('div');
    buttons.className = 'toggle-buttons';

    const showBtn = this.createToggleButton('Show', showAll, () => {
        this.handleCustomBotToggle(botName, true);
    });

    const hideBtn = this.createToggleButton('Hide', !showAll, () => {
        this.handleCustomBotToggle(botName, false);
    });

    buttons.appendChild(showBtn);
    buttons.appendChild(hideBtn);

    item.appendChild(removeBtn);    // First: Remove button
    item.appendChild(nameLabel);    // Second: Bot name
    item.appendChild(buttons);      // Third: Show/Hide buttons

    return item;
    }

  /**
   * Handle adding custom bots from input
   */
  async handleAddCustomBots() {
    const input = document.getElementById('botNameInput');
    if (!input) return;

    const rawInput = input.value.trim();
    if (!rawInput) {
      this.showStatus('Please enter bot name(s)', 'error');
      return;
    }

    // Parse comma-separated bot names
    const botNames = rawInput.split(',')
      .map(name => name.trim().toLowerCase())
      .filter(name => name.length > 0);

    if (botNames.length === 0) {
      this.showStatus('Please enter valid bot name(s)', 'error');
      return;
    }

    // Check which bots are new
    const state = filterState.get();
    const newBots = botNames.filter(name => !(name in state.customBots));
    
    if (newBots.length === 0) {
      this.showStatus('Bot(s) already filtered', 'info');
      return;
    }

    // Add new bots with default state (hidden)
    newBots.forEach(botName => {
      filterState.setCustomBot(botName, false); // Default to hidden
    });

    // Clear input
    input.value = '';

    // Update UI
    this.updateCustomBotUI();

    // Apply filters
    await this.applyFilters();

    this.showStatus(`Added ${newBots.length} bot filter(s)`, 'success');
  }

  /**
   * Handle toggling a custom bot's visibility
   */
  async handleCustomBotToggle(botName, showAll) {
    try {
      filterState.setCustomBot(botName, showAll);
      this.updateCustomBotUI();
      await this.applyFilters();
    } catch (error) {
      console.error('Error toggling custom bot:', error);
      this.showStatus('Error toggling bot visibility', 'error');
    }
  }

  /**
   * Handle removing a custom bot filter
   */
  async handleRemoveCustomBot(botName) {
    try {
      filterState.removeCustomBot(botName);
      this.updateCustomBotUI();
      await this.applyFilters();
      this.showStatus(`Removed filter for ${botName}`, 'success');
    } catch (error) {
      console.error('Error removing custom bot:', error);
      this.showStatus('Error removing bot filter', 'error');
    }
  }

  /**
   * Handle show all custom bots
   */
  async handleShowAllCustomBots() {
    const botNames = filterState.getCustomBotNames();
    if (botNames.length === 0) {
      this.showStatus('No custom bot filters', 'info');
      return;
    }

    botNames.forEach(botName => {
      filterState.setCustomBot(botName, true);
    });

    this.updateCustomBotUI();
    await this.applyFilters();
  }

  /**
   * Handle hide all custom bots
   */
  async handleHideAllCustomBots() {
    const botNames = filterState.getCustomBotNames();
    if (botNames.length === 0) {
      this.showStatus('No custom bot filters', 'info');
      return;
    }

    botNames.forEach(botName => {
      filterState.setCustomBot(botName, false);
    });

    this.updateCustomBotUI();
    await this.applyFilters();
  }

  /**
   * Apply filters to the GitHub page
   */
  async applyFilters() {
    if (!this.currentTabId) {
      console.error('No tab ID available');
      return;
    }

    try {
      // Save to session
      await filterState.saveToSession(this.currentTabId);

      const state = filterState.get();

      chrome.scripting.executeScript({
        target: { tabId: this.currentTabId },
        function: applyVisibilityFilter,
        args: [state.coderabbit.visibilityState, state.coderabbit.showAllState, state.customBots]
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.error('Error applying filter:', chrome.runtime.lastError);
          this.showStatus('Error applying filter', 'error');
        }
      });
    } catch (error) {
      console.error('Error in applyFilters:', error);
      this.showStatus('Error applying filters', 'error');
    }
  }

  /**
   * Save current settings as global defaults
   */
  async handleSaveAsDefault() {
    const success = await filterState.saveAsDefault();
    if (success) {
      this.showStatus('Saved as default settings', 'success');
    } else {
      this.showStatus('Error saving defaults', 'error');
    }
  }

  /**
   * Save current settings as global defaults
   */
  async handleSaveAsDefault() {
    const success = await filterState.saveAsDefault();
    if (success) {
      this.showStatus('Saved as default settings ✓', 'success');
    } else {
      this.showStatus('Error saving defaults', 'error');
    }
  }

  /**
   * Show status message
   */
  showStatus(message, type) {
    try {
      const status = document.getElementById('status');
      if (!status) return;

      status.textContent = message || '';
      status.className = type || '';

      if (message) {
        setTimeout(() => {
          status.textContent = '';
          status.className = '';
        }, 3000);
      }
    } catch (error) {
      console.error('Error showing status:', error);
    }
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

const ui = new UIController();

document.addEventListener('DOMContentLoaded', () => ui.init());

// CodeRabbit filter buttons
document.getElementById('showAllBtn')?.addEventListener('click', () => ui.handleShowAll());
document.getElementById('hideAllBtn')?.addEventListener('click', () => ui.handleHideAll());

// Custom bot buttons
document.getElementById('addBotBtn')?.addEventListener('click', () => ui.handleAddCustomBots());
document.getElementById('customBotShowAllBtn')?.addEventListener('click', () => ui.handleShowAllCustomBots());
document.getElementById('customBotHideAllBtn')?.addEventListener('click', () => ui.handleHideAllCustomBots());

// Allow Enter key to add bots
document.getElementById('botNameInput')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    ui.handleAddCustomBots();
  }
});

// Save as default button
document.getElementById('saveAsDefaultBtn')?.addEventListener('click', () => ui.handleSaveAsDefault());

// ============================================================================
// INJECTED FUNCTIONS (executed in page context)
// ============================================================================

/**
 * Scan the GitHub page for CodeRabbit comments and count severities
 * This function is injected into the page context to access the DOM
 * 
 * @returns {Object} Object mapping severity names to comment counts
 */
function getAvailableSeverities() {
  try {
    const comments = document.querySelectorAll('turbo-frame[id^="review-thread-or-comment-id-"]');
    const severityCounts = {};

    comments.forEach(comment => {
      try {
        const authorLink = comment.querySelector('a.author, a[data-hovercard-type="user"]');

        if (authorLink && authorLink.textContent.trim().toLowerCase().includes('coderabbit')) {
          const commentBody = comment.querySelector('.comment-body');
          if (!commentBody) return;

          const allEms = commentBody.querySelectorAll('em');

          for (const em of allEms) {
            const text = em.textContent.trim();
            let severity = null;

            if (text.includes('Critical')) severity = 'Critical';
            else if (text.includes('Major')) severity = 'Major';
            else if (text.includes('Minor')) severity = 'Minor';

            if (severity) {
              severityCounts[severity] = (severityCounts[severity] || 0) + 1;
              break;
            }
          }
        }
      } catch (err) {
        console.error('Error processing comment:', err);
      }
    });

    return severityCounts;
  } catch (error) {
    console.error('Error in getAvailableSeverities:', error);
    return {};
  }
}

/**
 * Apply visibility filters to CodeRabbit comments based on severity and show/hide state
 * This function is injected into the page context to manipulate the DOM
 * 
 * @param {Object} coderabbitVisibilityState - Object mapping severity names to boolean visibility
 * @param {boolean} coderabbitShowAllState - Whether "Show All" is active for CodeRabbit
 * @param {Object} customBots - Object mapping bot names to boolean visibility
 */
function applyVisibilityFilter(coderabbitVisibilityState, coderabbitShowAllState, customBots) {
  const SELECTORS = {
    TIMELINE_ITEM: '.js-timeline-item',
    TURBO_FRAME: 'turbo-frame[id^="review-thread-or-comment-id-"]',
    INLINE_CONTAINER: '.js-inline-comments-container',
    COMMENT_BODY: '.comment-body',
    CODERABBIT_AUTHOR_LINK: 'a.author[href="/apps/coderabbitai"]',
    AUTHOR_LINK: 'a.author',
    SEVERITY_EM: 'em'
  };

  try {
    const allTimelineItems = document.querySelectorAll(SELECTORS.TIMELINE_ITEM);

    /**
     * Helper function to detect severity from a turbo-frame element
     */
    function getTurboFrameSeverity(turboFrame) {
      try {
        const inlineContainers = turboFrame.querySelectorAll(SELECTORS.INLINE_CONTAINER);

        for (const inlineContainer of inlineContainers) {
          const authorLink = inlineContainer.querySelector(SELECTORS.CODERABBIT_AUTHOR_LINK);

          if (authorLink) {
            const commentBody = inlineContainer.querySelector(SELECTORS.COMMENT_BODY);
            if (!commentBody) continue;

            const allEms = commentBody.querySelectorAll(SELECTORS.SEVERITY_EM);
            for (const em of allEms) {
              const text = em.textContent.trim();
              if (text.includes('Critical')) return 'Critical';
              if (text.includes('Major')) return 'Major';
              if (text.includes('Minor')) return 'Minor';
            }
          }
        }
        return null;
      } catch (error) {
        console.error('Error detecting turbo-frame severity:', error);
        return null;
      }
    }

    /**
     * Check if timeline item contains a custom bot that should be hidden
     */
    function isCustomBotHidden(timelineItem) {
      if (!customBots || Object.keys(customBots).length === 0) return false;
      
      // Get all author links in this timeline item
      const authorLinks = timelineItem.querySelectorAll(SELECTORS.AUTHOR_LINK);
      
      for (const authorLink of authorLinks) {
        const authorName = authorLink.textContent.trim().toLowerCase();
        
        // Check if this author matches any custom bot
        for (const [botName, showAll] of Object.entries(customBots)) {
          if (authorName.includes(botName.toLowerCase())) {
            return !showAll; // Return true if bot should be hidden (showAll = false)
          }
        }
      }
      
      return false;
    }

    /**
     * Check if author is CodeRabbit
     */
    function isCodeRabbit(container) {
      return !!container.querySelector(SELECTORS.CODERABBIT_AUTHOR_LINK);
    }

    // Process all timeline items
    allTimelineItems.forEach(container => {
      try {
        // Check if this timeline item contains a custom bot that should be hidden
        const shouldHideCustomBot = isCustomBotHidden(container);

        if (shouldHideCustomBot) {
          // Hide entire timeline item for custom bots
          container.style.display = 'none';
          container.setAttribute('data-custom-bot-hidden', 'true');
          return;
        } else {
          // Remove custom bot hiding (might still be hidden by CodeRabbit filters)
          container.removeAttribute('data-custom-bot-hidden');
        }

        // Apply CodeRabbit-specific filtering
        const isCodeRabbitComment = isCodeRabbit(container);
        
        if (isCodeRabbitComment) {
          const turboFrames = container.querySelectorAll(SELECTORS.TURBO_FRAME);

          if (coderabbitShowAllState) {
            // Show all CodeRabbit timeline items, hide turbo-frames with hidden severities
            container.style.display = '';
            container.removeAttribute('data-coderabbit-hidden');

            turboFrames.forEach(turboFrame => {
              try {
                const severity = getTurboFrameSeverity(turboFrame);

                if (severity && coderabbitVisibilityState[severity] === false) {
                  turboFrame.style.display = 'none';
                  turboFrame.setAttribute('data-coderabbit-hidden', 'true');
                } else {
                  turboFrame.style.display = '';
                  turboFrame.removeAttribute('data-coderabbit-hidden');
                }
              } catch (error) {
                console.error('Error processing turbo-frame in show-all mode:', error);
              }
            });
          } else {
            // Show timeline items + turbo-frames only if they contain visible severities
            container.style.display = '';
            container.removeAttribute('data-coderabbit-hidden');

            let hasVisibleTurboFrame = false;

            turboFrames.forEach(turboFrame => {
              try {
                const severity = getTurboFrameSeverity(turboFrame);

                if (severity && coderabbitVisibilityState[severity] === true) {
                  turboFrame.style.display = '';
                  turboFrame.removeAttribute('data-coderabbit-hidden');
                  hasVisibleTurboFrame = true;
                } else {
                  turboFrame.style.display = 'none';
                  turboFrame.setAttribute('data-coderabbit-hidden', 'true');
                }
              } catch (error) {
                console.error('Error processing turbo-frame in hide-all mode:', error);
              }
            });

            if (!hasVisibleTurboFrame) {
              container.style.display = 'none';
              container.setAttribute('data-coderabbit-hidden', 'true');
            }
          }
        } else {
          // Not a CodeRabbit comment and not a custom bot - ensure it's visible
          container.style.display = '';
        }
      } catch (error) {
        console.error('Error processing timeline item:', error);
      }
    });
  } catch (error) {
    console.error('Error in applyVisibilityFilter:', error);
  }
}