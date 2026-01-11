// ============================================================================
// CONSTANTS & DEFAULTS
// ============================================================================

const SEVERITIES = ['Critical', 'Major', 'Minor'];

const DEFAULT_STATE = {
  visibilityState: {
    'Critical': true,
    'Major': true,
    'Minor': true
  },
  showAllState: true
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
      visibilityState: { ...DEFAULT_STATE.visibilityState },
      showAllState: DEFAULT_STATE.showAllState
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
      visibilityState: {},
      showAllState: state.showAllState ?? true
    };

    // Ensure all severities exist with boolean values
    SEVERITIES.forEach(severity => {
      validated.visibilityState[severity] = 
        state.visibilityState?.[severity] ?? true;
    });

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
      const result = await chrome.storage.sync.get(['visibilityState', 'showAllState']);
      console.log('Loading from global storage');
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
          visibilityState: { ...this.currentState.visibilityState },
          showAllState: this.currentState.showAllState
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
        visibilityState: this.currentState.visibilityState,
        showAllState: this.currentState.showAllState
      });
      console.log('Saved as global defaults');
      return true;
    } catch (error) {
      console.error('Error saving defaults:', error);
      return false;
    }
  }

  /**
   * Update visibility for a specific severity
   */
  setSeverityVisibility(severity, isVisible) {
    if (SEVERITIES.includes(severity)) {
      this.currentState.visibilityState[severity] = Boolean(isVisible);
    }
  }

  /**
   * Set show all state
   */
  setShowAll(showAll) {
    this.currentState.showAllState = Boolean(showAll);
    
    // Update all severities when show/hide all is toggled
    SEVERITIES.forEach(severity => {
      this.currentState.visibilityState[severity] = showAll;
    });
  }

  /**
   * Get current state (read-only copy)
   */
  get() {
    return {
      visibilityState: { ...this.currentState.visibilityState },
      showAllState: this.currentState.showAllState
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

      const group = this.createSeverityGroup(severity, count, state.visibilityState[severity]);
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

    if (state.showAllState) {
      showAllBtn?.classList.add('active');
      hideAllBtn?.classList.remove('active');
    } else {
      showAllBtn?.classList.remove('active');
      hideAllBtn?.classList.add('active');
    }
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
        args: [state.visibilityState, state.showAllState]
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

document.getElementById('showAllBtn')?.addEventListener('click', () => ui.handleShowAll());
document.getElementById('hideAllBtn')?.addEventListener('click', () => ui.handleHideAll());
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
 * @param {Object} visibilityState - Object mapping severity names to boolean visibility
 * @param {boolean} showAllState - Whether "Show All" is active
 */
function applyVisibilityFilter(visibilityState, showAllState) {
  const SELECTORS = {
    TIMELINE_ITEM: '.js-timeline-item',
    TURBO_FRAME: 'turbo-frame[id^="review-thread-or-comment-id-"]',
    INLINE_CONTAINER: '.js-inline-comments-container',
    COMMENT_BODY: '.comment-body',
    CODERABBIT_AUTHOR_LINK: 'a.author[href="/apps/coderabbitai"]',
    SEVERITY_EM: 'em'
  };

  try {
    const allTimelineItems = document.querySelectorAll(SELECTORS.TIMELINE_ITEM);

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

    if (showAllState) {
      // Show all CodeRabbit timeline items, hide turbo-frames with hidden severities
      allTimelineItems.forEach(container => {
        try {
          const timelineAuthorLink = container.querySelector(SELECTORS.CODERABBIT_AUTHOR_LINK);

          if (timelineAuthorLink) {
            container.style.display = '';
            container.removeAttribute('data-coderabbit-hidden');

            const turboFrames = container.querySelectorAll(SELECTORS.TURBO_FRAME);

            turboFrames.forEach(turboFrame => {
              try {
                const severity = getTurboFrameSeverity(turboFrame);

                if (severity && visibilityState[severity] === false) {
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
          }
        } catch (error) {
          console.error('Error processing timeline item in show-all mode:', error);
        }
      });
    } else {
      // Show timeline items + turbo-frames only if they contain visible severities
      allTimelineItems.forEach(container => {
        try {
          const timelineAuthorLink = container.querySelector(SELECTORS.CODERABBIT_AUTHOR_LINK);

          if (timelineAuthorLink) {
            const turboFrames = container.querySelectorAll(SELECTORS.TURBO_FRAME);

            container.style.display = '';
            container.removeAttribute('data-coderabbit-hidden');

            let hasVisibleTurboFrame = false;

            turboFrames.forEach(turboFrame => {
              try {
                const severity = getTurboFrameSeverity(turboFrame);

                if (severity && visibilityState[severity] === true) {
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
        } catch (error) {
          console.error('Error processing timeline item in hide-all mode:', error);
        }
      });
    }
  } catch (error) {
    console.error('Error in applyVisibilityFilter:', error);
  }
}