
// Severity levels to show in UI
const uiSeverities = [
  { name: 'Critical' },
  { name: 'Major' },
  { name: 'Minor' }
];

// State to track visibility of each severity level
let visibilityState = {
  'Critical': true,
  'Major': true,
  'Minor': true
};

// Track show_all state separately
let showAllState = true;

// Store button references for each severity
let severityButtons = {};

/**
 * Initialize the popup when DOM is loaded
 * - Validates the current tab is a GitHub page
 * - Scans for CodeRabbit comments and their severities
 * - Builds the severity filter UI
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showStatus('Error: No active tab found', 'error');
      return;
    }
    
    if (!tab.url || !tab.url.includes('github.com')) {
      showStatus('Please open a GitHub PR page', 'error');
      return;
    }
    
    if (!tab.id) {
      showStatus('Error: Invalid tab ID', 'error');
      return;
    }

    // Scan for available severities
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: getAvailableSeverities
    }, (results) => {
      // Check for runtime errors
      if (chrome.runtime.lastError) {
        console.error('Error executing script:', chrome.runtime.lastError);
        showStatus('Error loading severities: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      
      // Validate results structure
      if (!results || !Array.isArray(results) || results.length === 0) {
        console.error('Invalid results structure:', results);
        showStatus('Error: No results returned', 'error');
        return;
      }
      
      // Validate results[0] has a result property
      if (!results[0] || typeof results[0].result === 'undefined') {
        console.error('Invalid result data:', results[0]);
        showStatus('Error: Invalid severity data', 'error');
        return;
      }
      
      const availableSeverities = results[0].result;
      
      // Validate that availableSeverities is an object
      if (typeof availableSeverities !== 'object' || availableSeverities === null) {
        console.error('Invalid availableSeverities:', availableSeverities);
        showStatus('Error: Invalid severity format', 'error');
        return;
      }
      
      buildSeverityControls(availableSeverities, tab.id);
    });
  } catch (error) {
    console.error('Error initializing popup:', error);
    showStatus('Error initializing extension: ' + error.message, 'error');
  }
});

/**
 * Build severity filter controls in the UI
 * Creates toggle buttons for each severity level that has comments
 * 
 * @param {Object} availableSeverities - Object mapping severity names to comment counts
 * @param {number} tabId - Chrome tab ID where filters will be applied
 */
function buildSeverityControls(availableSeverities, tabId) {
  try {
    const container = document.getElementById('severityControls');
    
    if (!container) {
      console.error('Severity controls container not found');
      return;
    }
    
    if (!tabId) {
      console.error('Invalid tab ID provided to buildSeverityControls');
      showStatus('Error: Invalid tab ID', 'error');
      return;
    }
    
    // Only build UI for uiSeverities
    uiSeverities.forEach(severity => {
      if (!severity || !severity.name) {
        console.warn('Invalid severity object:', severity);
        return;
      }
      
      const count = availableSeverities[severity.name] || 0;
      if (count === 0) return; // Don't show if no comments of this severity
      
      const group = document.createElement('div');
      group.className = 'severity-group';
      
      const label = document.createElement('div');
      label.className = 'severity-label';
      label.innerHTML = `
        <span>${severity.name}</span>
        <span style="color: #57606a; font-size: 11px;">(${count})</span>
      `;
      
      const buttons = document.createElement('div');
      buttons.className = 'toggle-buttons';
      
      const showBtn = document.createElement('button');
      showBtn.className = 'toggle-btn active';
      showBtn.textContent = 'Show';
      showBtn.onclick = () => {
        try {
          visibilityState[severity.name] = true;
          showBtn.classList.add('active');
          hideBtn.classList.remove('active');
          applyFilter(tabId);
        } catch (error) {
          console.error('Error in show button click:', error);
          showStatus('Error toggling visibility', 'error');
        }
      };
      
      const hideBtn = document.createElement('button');
      hideBtn.className = 'toggle-btn';
      hideBtn.textContent = 'Hide';
      hideBtn.onclick = () => {
        try {
          visibilityState[severity.name] = false;
          showBtn.classList.remove('active');
          hideBtn.classList.add('active');
          applyFilter(tabId);
        } catch (error) {
          console.error('Error in hide button click:', error);
          showStatus('Error toggling visibility', 'error');
        }
      };
      
      // Store button references
      severityButtons[severity.name] = { showBtn, hideBtn };
      
      buttons.appendChild(showBtn);
      buttons.appendChild(hideBtn);
      
      group.appendChild(label);
      group.appendChild(buttons);
      container.appendChild(group);
    });
  } catch (error) {
    console.error('Error building severity controls:', error);
    showStatus('Error building controls: ' + error.message, 'error');
  }
}

/**
 * Apply visibility filters to CodeRabbit comments on the GitHub page
 * Executes the filter logic in the page context
 * 
 * @param {number} tabId - Chrome tab ID where filters will be applied
 */
function applyFilter(tabId) {
  try {
    if (!tabId) {
      console.error('applyFilter called with invalid tabId');
      showStatus('Error: Invalid tab', 'error');
      return;
    }
    
    chrome.scripting.executeScript({
      target: { tabId },
      function: applyVisibilityFilter,
      args: [visibilityState, showAllState]
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.error('Error applying filter:', chrome.runtime.lastError);
        showStatus('Error applying filter: ' + chrome.runtime.lastError.message, 'error');
      }
    });
  } catch (error) {
    console.error('Error in applyFilter:', error);
    showStatus('Error: ' + error.message, 'error');
  }
}

/**
 * Show All button click handler
 * Sets all severities to visible and applies filters
 */
document.getElementById('showAllBtn').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      showStatus('Error: No active tab', 'error');
      return;
    }
    
    // Set show_all to true and all severities to true
    showAllState = true;
    Object.keys(visibilityState).forEach(key => {
      visibilityState[key] = true;
    });
    
    // Update button states
    document.getElementById('showAllBtn').classList.add('active');
    document.getElementById('hideAllBtn').classList.remove('active');
    
    Object.values(severityButtons).forEach(({ showBtn, hideBtn }) => {
      if (showBtn && hideBtn) {
        showBtn.classList.add('active');
        hideBtn.classList.remove('active');
      }
    });
    
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: applyVisibilityFilter,
      args: [visibilityState, showAllState]
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.error('Error showing all:', chrome.runtime.lastError);
        showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
      }
    });
  } catch (error) {
    console.error('Error in showAllBtn click:', error);
    showStatus('Error: ' + error.message, 'error');
  }
});

/**
 * Hide All button click handler
 * Sets all severities to hidden and applies filters
 */
document.getElementById('hideAllBtn').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      showStatus('Error: No active tab', 'error');
      return;
    }
    
    // Set show_all to false and all severities to false
    showAllState = false;
    Object.keys(visibilityState).forEach(key => {
      visibilityState[key] = false;
    });
    
    // Update button states
    document.getElementById('showAllBtn').classList.remove('active');
    document.getElementById('hideAllBtn').classList.add('active');
    
    Object.values(severityButtons).forEach(({ showBtn, hideBtn }) => {
      if (showBtn && hideBtn) {
        showBtn.classList.remove('active');
        hideBtn.classList.add('active');
      }
    });
    
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: applyVisibilityFilter,
      args: [visibilityState, showAllState]
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.error('Error hiding all:', chrome.runtime.lastError);
        showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
      }
    });
  } catch (error) {
    console.error('Error in hideAllBtn click:', error);
    showStatus('Error: ' + error.message, 'error');
  }
});

/**
 * Display a status message to the user
 * Message automatically clears after 3 seconds
 * 
 * @param {string} message - Message to display
 * @param {string} type - Message type ('success', 'error', 'info')
 */
function showStatus(message, type) {
  try {
    const status = document.getElementById('status');
    if (!status) {
      console.error('Status element not found');
      return;
    }
    
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

// Functions injected into page context

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
          // Detect severity inline
          const commentBody = comment.querySelector('.comment-body');
          let commentSeverity = null;
          
          if (commentBody) {
            const allEms = commentBody.querySelectorAll('em');
            
            for (const em of allEms) {
              const text = em.textContent.trim();
              if (text.includes('Critical')) {
                commentSeverity = 'Critical';
                break;
              } else if (text.includes('Major')) {
                commentSeverity = 'Major';
                break;
              } else if (text.includes('Minor')) {
                commentSeverity = 'Minor';
                break;
              }
            }
          }
          
          // Only count if we found a recognized severity
          if (commentSeverity) {
            severityCounts[commentSeverity] = (severityCounts[commentSeverity] || 0) + 1;
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
 * Only operates on .js-timeline-item elements (inline review comments with turbo-frames)
 * Does NOT touch .timeline-comment-group elements (regular review comments)
 * 
 * Logic:
 * - When showAllState = true: Show all CodeRabbit timeline items, hide turbo-frames with hidden severities
 * - When showAllState = false: Show timeline items + turbo-frames only if they contain visible severities
 * 
 * @param {Object} visibilityState - Object mapping severity names to boolean visibility
 * @param {boolean} showAllState - Whether "Show All" is active
 */
function applyVisibilityFilter(visibilityState, showAllState) {
  // DOM Selectors (redefined in injected context)
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
    
    /**
     * Helper function to detect severity from a turbo-frame element
     * Looks inside for CodeRabbit inline comments and extracts severity
     * 
     * @param {Element} turboFrame - The turbo-frame element to check
     * @returns {string|null} Severity name or null if none found
     */
    function getTurboFrameSeverity(turboFrame) {
      try {
        const inlineContainers = turboFrame.querySelectorAll(SELECTORS.INLINE_CONTAINER);
        
        for (const inlineContainer of inlineContainers) {
          const authorLink = inlineContainer.querySelector(SELECTORS.CODERABBIT_AUTHOR_LINK);
          
          if (authorLink) {
            // This is a CodeRabbit comment, get its severity
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
      // Show All = True: Show all CodeRabbit timeline items, hide turbo-frames with hidden severities
      
      allTimelineItems.forEach(container => {
        try {
          const timelineAuthorLink = container.querySelector(SELECTORS.CODERABBIT_AUTHOR_LINK);
          
          if (timelineAuthorLink) {
            // This is a CodeRabbit timeline item - always show it
            container.style.display = '';
            container.removeAttribute('data-coderabbit-hidden');
            
            // Now check each turbo-frame inside
            const turboFrames = container.querySelectorAll(SELECTORS.TURBO_FRAME);
            
            turboFrames.forEach(turboFrame => {
              try {
                const severity = getTurboFrameSeverity(turboFrame);
                
                if (severity && visibilityState[severity] === false) {
                  // Hide this turbo-frame (CodeRabbit comment with hidden severity)
                  turboFrame.style.display = 'none';
                  turboFrame.setAttribute('data-coderabbit-hidden', 'true');
                } else {
                  // Show this turbo-frame (no CodeRabbit comment or visible severity)
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
      // Show All = False: Show timeline items + turbo-frames only if they contain visible severities
      
      allTimelineItems.forEach(container => {
        try {
          const timelineAuthorLink = container.querySelector(SELECTORS.CODERABBIT_AUTHOR_LINK);
          
          if (timelineAuthorLink) {
            const turboFrames = container.querySelectorAll(SELECTORS.TURBO_FRAME);
            
            // If no turbo-frames, skip this timeline item
            // if (turboFrames.length === 0) {
            //  return;
            // }
            
            // First show the timeline item
            container.style.display = '';
            container.removeAttribute('data-coderabbit-hidden');
            
            let hasVisibleTurboFrame = false;
            
            turboFrames.forEach(turboFrame => {
              try {
                const severity = getTurboFrameSeverity(turboFrame);
                
                if (severity && visibilityState[severity] === true) {
                  // Show this turbo-frame (CodeRabbit comment with visible severity)
                  turboFrame.style.display = '';
                  turboFrame.removeAttribute('data-coderabbit-hidden');
                  hasVisibleTurboFrame = true;
                } else {
                  // Hide this turbo-frame (no CodeRabbit comment or hidden severity)
                  turboFrame.style.display = 'none';
                  turboFrame.setAttribute('data-coderabbit-hidden', 'true');
                }
              } catch (error) {
                console.error('Error processing turbo-frame in hide-all mode:', error);
              }
            });
            
            // Hide timeline item if no turbo-frames are visible
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