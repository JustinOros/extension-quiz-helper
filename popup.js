// Load saved state
chrome.storage.sync.get(['enabled', 'openaiApiKey'], function(result) {
  const enabled = result.enabled || false;
  document.getElementById('toggleSwitch').checked = enabled;
  document.getElementById('toggleLabel').textContent = enabled ? 'On' : 'Off';
  
  // Load API key if saved
  if (result.openaiApiKey) {
    document.getElementById('apiKey').value = result.openaiApiKey;
    showApiStatus('API key loaded', 'success');
  }
});

// Handle toggle change
document.getElementById('toggleSwitch').addEventListener('change', function(e) {
  const enabled = e.target.checked;
  
  // Save state
  chrome.storage.sync.set({ enabled: enabled });
  
  // Update label
  document.getElementById('toggleLabel').textContent = enabled ? 'On' : 'Off';
  
  // Update status
  document.getElementById('status').textContent = enabled ? 
    'Extension is now active' : 'Extension is now disabled';
  
  // Send message to content script (with error handling)
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs[0]) {
      // Check if we can send messages to this tab
      const url = tabs[0].url;
      
      // Can't inject content scripts into chrome:// pages or other special URLs
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
        document.getElementById('status').textContent = 'Extension cannot run on this page';
        document.getElementById('status').style.color = '#d13438';
        setTimeout(() => {
          document.getElementById('status').textContent = '';
          document.getElementById('status').style.color = '';
        }, 3000);
        return;
      }
      
      // Try to send message
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'toggleExtension',
        enabled: enabled
      }).catch(error => {
        console.log('Could not send message to content script:', error);
        // This is okay - the content script will pick up the state from storage when it loads
      });
    }
  });
  
  // Clear status after 2 seconds
  setTimeout(() => {
    document.getElementById('status').textContent = '';
    document.getElementById('status').style.color = '';
  }, 2000);
});

// Handle API key save
document.getElementById('saveApiKey').addEventListener('click', function() {
  const apiKey = document.getElementById('apiKey').value.trim();
  
  if (!apiKey) {
    showApiStatus('Please enter an API key', 'error');
    return;
  }
  
  if (!apiKey.startsWith('sk-')) {
    showApiStatus('Invalid API key format', 'error');
    return;
  }
  
  // Save API key
  chrome.storage.sync.set({ openaiApiKey: apiKey }, function() {
    showApiStatus('API key saved successfully!', 'success');
    
    // Notify content script to reload
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'apiKeyUpdated',
          apiKey: apiKey
        }).catch(() => {});
      }
    });
  });
});

function showApiStatus(message, type) {
  const statusEl = document.getElementById('apiStatus');
  statusEl.textContent = message;
  statusEl.className = `api-status ${type}`;
  statusEl.style.display = 'block';
  
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}
