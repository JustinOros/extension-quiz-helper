// Background service worker for the extension
// Handles installation and updates

chrome.runtime.onInstalled.addListener(() => {
  console.log('Quiz Helper extension installed');
  
  // Set default state
  chrome.storage.sync.set({ enabled: false });
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getState') {
    chrome.storage.sync.get(['enabled'], (result) => {
      sendResponse({ enabled: result.enabled || false });
    });
    return true; // Indicates async response
  }
});
