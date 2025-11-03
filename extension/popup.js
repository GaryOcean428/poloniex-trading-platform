document.addEventListener('DOMContentLoaded', function() {
  // DOM elements - check for existence before using
  const pairSelect = document.getElementById('pair-select');
  const buyBtn = document.getElementById('buy-btn');
  const sellBtn = document.getElementById('sell-btn');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const chatMessages = document.getElementById('chat-messages');
  const openAppBtn = document.getElementById('open-app-btn');
  const settingsBtn = document.getElementById('settings-btn');

  // Get base URL from storage or default to production URL
  let appURL = 'https://poloniex-trading-platform-production.up.railway.app'; // Production Railway URL

  // Retrieve appURL from storage
  chrome.storage.sync.get(['frontendUrl'], (result) => {
    if (result.frontendUrl) {
      appURL = result.frontendUrl;
    } else {
      // If not set in storage, try to derive from current tab if on Poloniex
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          try {
            const url = new URL(tabs[0].url);
            if (url.hostname.includes('poloniex.com')) {
              appURL = url.origin;
            }
          } catch (e) {
            console.error('Error parsing URL:', e);
          }
        }
      });
    }
  });

  // Mock username
  const username = 'user_' + Math.floor(Math.random() * 1000);

  // Only add event listeners if elements exist
  if (openAppBtn) {
    openAppBtn.addEventListener('click', function() {
      // If we're on Poloniex, just focus the tab
      chrome.tabs.query({ url: '*://*.poloniex.com/*' }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { active: true });
        } else {
          // Otherwise open the dashboard in a new tab
          chrome.tabs.create({ url: appURL });
        }
      });
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', async function() {
      // Open settings in extension popup
      const popup = document.querySelector('.extension-container');
      if (popup) {
        // Save current content
        const originalContent = popup.innerHTML;
        
        // Load settings UI
        popup.innerHTML = `
          <div class="settings-page">
            <header>
              <div class="logo">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <h1>Settings</h1>
              </div>
              <button id="back-btn">←</button>
            </header>
            
            <div class="settings-content">
              <div class="setting-group">
                <h3>API Configuration</h3>
                <div class="setting-item">
                  <label for="api-key">API Key</label>
                  <input type="password" id="api-key" placeholder="Enter API Key">
                </div>
                <div class="setting-item">
                  <label for="api-secret">API Secret</label>
                  <input type="password" id="api-secret" placeholder="Enter API Secret">
                </div>
                <div class="setting-item">
                  <label>
                    <input type="checkbox" id="live-trading">
                    Enable Live Trading
                  </label>
                </div>
              </div>
              
              <div class="setting-group">
                <h3>Notifications</h3>
                <div class="setting-item">
                  <label>
                    <input type="checkbox" id="trade-notifications" checked>
                    Trade Notifications
                  </label>
                </div>
                <div class="setting-item">
                  <label>
                    <input type="checkbox" id="price-alerts">
                    Price Alerts
                  </label>
                </div>
              </div>
              
              <button id="save-settings" class="btn-primary">Save Settings</button>
            </div>
          </div>
        `;
        
        // Add back button handler
        document.getElementById('back-btn').addEventListener('click', () => {
          popup.innerHTML = originalContent;
          initializeEventListeners(); // Re-initialize main popup listeners
        });
        
        // Load current settings
        chrome.storage.sync.get([
          'apiKey',
          'apiSecret',
          'liveTrading',
          'tradeNotifications',
          'priceAlerts'
        ], (settings) => {
          if (settings.apiKey) document.getElementById('api-key').value = settings.apiKey;
          if (settings.apiSecret) document.getElementById('api-secret').value = settings.apiSecret;
          if (settings.liveTrading) document.getElementById('live-trading').checked = settings.liveTrading;
          if (settings.tradeNotifications) document.getElementById('trade-notifications').checked = settings.tradeNotifications;
          if (settings.priceAlerts) document.getElementById('price-alerts').checked = settings.priceAlerts;
        });
        
        // Add save handler
        document.getElementById('save-settings').addEventListener('click', () => {
          const settings = {
            apiKey: document.getElementById('api-key').value,
            apiSecret: document.getElementById('api-secret').value,
            liveTrading: document.getElementById('live-trading').checked,
            tradeNotifications: document.getElementById('trade-notifications').checked,
            priceAlerts: document.getElementById('price-alerts').checked
          };
          
          chrome.storage.sync.set(settings, () => {
            showNotification('Settings saved successfully');
            // Return to main view after saving
            popup.innerHTML = originalContent;
            initializeEventListeners();
          });
        });
      }
    });
  }

  if (buyBtn) {
    buyBtn.addEventListener('click', function() {
      const pair = pairSelect?.value || 'BTC-USDT';
      showNotification(`Buy order placed for ${pair}`);
    });
  }

  if (sellBtn) {
    sellBtn.addEventListener('click', function() {
      const pair = pairSelect?.value || 'BTC-USDT';
      showNotification(`Sell order placed for ${pair}`);
    });
  }

  // Send chat message
  if (sendBtn && messageInput) {
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });
  }

  function sendMessage() {
    if (!messageInput || !chatMessages) return;
    
    const message = messageInput.value.trim();
    if (message) {
      addMessageToChat(username, message);
      messageInput.value = '';
    }
  }

  function addMessageToChat(username, text) {
    if (!chatMessages) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.innerHTML = `
      <span class="username">${username}:</span>
      <span class="text">${text}</span>
    `;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showNotification(message) {
    // Create a temporary notification element
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.position = 'absolute';
    notification.style.bottom = '10px';
    notification.style.right = '10px';
    notification.style.backgroundColor = '#4caf50';
    notification.style.color = 'white';
    notification.style.padding = '8px 12px';
    notification.style.borderRadius = '4px';
    notification.style.zIndex = '1000';
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  // Mock data for testing - only add if chat exists
  if (chatMessages) {
    setTimeout(() => {
      addMessageToChat('system', 'Welcome to the trading chat!');
    }, 1000);

    setTimeout(() => {
      addMessageToChat('market_bot', 'BTC just broke $52,000!');
    }, 3000);
  }
});