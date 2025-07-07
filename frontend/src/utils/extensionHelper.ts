import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export const createExtensionZip = async (): Promise<void> => {
  try {
    const zip = new JSZip();
    
    // Create manifest.json
    zip.file("manifest.json", JSON.stringify({
      "manifest_version": 3,
      "name": "Poloniex Trading Extension",
      "version": "1.0.0",
      "description": "Quick access to Poloniex trading platform and community chat",
      "action": {
        "default_popup": "popup.html",
        "default_icon": {
          "16": "icons/icon16.png",
          "48": "icons/icon48.png",
          "128": "icons/icon128.png"
        }
      },
      "permissions": [
        "storage",
        "tabs",
        "notifications",
        "alarms"
      ],
      "host_permissions": [
        "http://localhost:*/*"
      ],
      "background": {
        "service_worker": "background.js"
      },
      "icons": {
        "16": "icons/icon16.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
      }
    }, null, 2));
    
    // Create popup.html
    zip.file("popup.html", `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Poloniex Trading Extension</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="extension-container">
    <header>
      <div class="logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <h1>TradingBot</h1>
      </div>
      <div class="actions">
        <button id="settings-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
      </div>
    </header>

    <div class="account-summary">
      <div class="balance">
        <span class="label">Balance:</span>
        <span class="value">$12,345.67</span>
      </div>
      <div class="performance">
        <span class="profit">+2.5% today</span>
      </div>
    </div>

    <div class="quick-trade">
      <h2>Quick Trade</h2>
      <div class="trading-pair">
        <select id="pair-select">
          <option value="BTC-USDT">BTC-USDT</option>
          <option value="ETH-USDT">ETH-USDT</option>
          <option value="SOL-USDT">SOL-USDT</option>
        </select>
      </div>
      <div class="trade-buttons">
        <button id="buy-btn" class="buy">Buy</button>
        <button id="sell-btn" class="sell">Sell</button>
      </div>
    </div>

    <div class="chat-section">
      <h2>Community Chat</h2>
      <div class="chat-messages" id="chat-messages">
        <div class="message">
          <span class="username">trading_pro:</span>
          <span class="text">BTC looking bullish today!</span>
        </div>
        <div class="message">
          <span class="username">crypto_newbie:</span>
          <span class="text">What's everyone's thoughts on ETH?</span>
        </div>
      </div>
      <div class="chat-input">
        <input type="text" id="message-input" placeholder="Type your message...">
        <button id="send-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-send"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>
        </button>
      </div>
    </div>

    <div class="footer">
      <button id="open-app-btn" class="open-app">Open Trading Platform</button>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>`);

    // Create popup.css
    zip.file("popup.css", `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
}

body {
  width: 320px;
  overflow: hidden;
}

.extension-container {
  background-color: #f8f9fa;
  color: #333;
  display: flex;
  flex-direction: column;
  max-height: 500px;
}

header {
  background-color: #1e293b;
  color: white;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
}

.logo svg {
  color: #3b82f6;
  margin-right: 8px;
}

.logo h1 {
  font-size: 16px;
  font-weight: 600;
}

.actions button {
  background: none;
  border: none;
  color: #a3a3a3; /* neutral-400 equivalent */
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.actions button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: white;
}

.account-summary {
  background-color: #2d3748;
  color: white;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
}

.balance .label {
  color: #a3a3a3; /* neutral-400 equivalent */
  font-size: 12px;
}

.balance .value {
  font-weight: 600;
  font-size: 14px;
}

.performance .profit {
  color: #10b981;
  font-size: 12px;
  font-weight: 500;
}

.quick-trade, .chat-section {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e5e5; /* neutral-200 equivalent */
}

h2 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #525252; /* neutral-600 equivalent */
}

.trading-pair select {
  width: 100%;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #d4d4d4; /* neutral-300 equivalent */
  margin-bottom: 8px;
  background-color: white;
}

.trade-buttons {
  display: flex;
  gap: 8px;
}

.trade-buttons button {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

button.buy {
  background-color: #10b981;
  color: white;
}

button.buy:hover {
  background-color: #059669;
}

button.sell {
  background-color: #ef4444;
  color: white;
}

button.sell:hover {
  background-color: #dc2626;
}

.chat-messages {
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 8px;
  font-size: 12px;
}

.message {
  padding: 4px 0;
}

.username {
  font-weight: 600;
  color: #525252; /* neutral-600 equivalent */
}

.chat-input {
  display: flex;
  gap: 8px;
}

.chat-input input {
  flex: 1;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #d4d4d4; /* neutral-300 equivalent */
}

.chat-input button {
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 0 8px;
  cursor: pointer;
}

.chat-input button:hover {
  background-color: #2563eb;
}

.footer {
  padding: 12px 16px;
}

.open-app {
  width: 100%;
  padding: 8px 0;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.open-app:hover {
  background-color: #2563eb;
}`);

    // Create popup.js
    zip.file("popup.js", `document.addEventListener('DOMContentLoaded', function() {
  // DOM elements
  const pairSelect = document.getElementById('pair-select');
  const buyBtn = document.getElementById('buy-btn');
  const sellBtn = document.getElementById('sell-btn');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const chatMessages = document.getElementById('chat-messages');
  const openAppBtn = document.getElementById('open-app-btn');
  const settingsBtn = document.getElementById('settings-btn');

  // App URL - change this to your production URL when deployed
  const appURL = 'http://localhost:5173';

  // Mock username
  const username = 'user_' + Math.floor(Math.random() * 1000);

  // Open the main app
  openAppBtn.addEventListener('click', function() {
    chrome.tabs.create({ url: appURL });
  });

  // Settings button click handler
  settingsBtn.addEventListener('click', function() {
    chrome.tabs.create({ url: \`\${appURL}/settings\` });
  });

  // Buy button click handler
  buyBtn.addEventListener('click', function() {
    const pair = pairSelect.value;
    
    // This would typically make an API call to your backend
    console.log(\`Buy order placed for \${pair}\`);
    
    // Show notification to user
    showNotification(\`Buy order placed for \${pair}\`);
  });

  // Sell button click handler
  sellBtn.addEventListener('click', function() {
    const pair = pairSelect.value;
    
    // This would typically make an API call to your backend
    console.log(\`Sell order placed for \${pair}\`);
    
    // Show notification to user
    showNotification(\`Sell order placed for \${pair}\`);
  });

  // Send chat message
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });

  function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
      // For the demo, just add it to the UI
      addMessageToChat(username, message);
      messageInput.value = '';
    }
  }

  function addMessageToChat(username, text) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.innerHTML = \`
      <span class="username">\${username}:</span>
      <span class="text">\${text}</span>
    \`;
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
      document.body.removeChild(notification);
    }, 3000);
  }

  // Mock data for testing
  setTimeout(() => {
    addMessageToChat('system', 'Welcome to the trading chat!');
  }, 1000);

  setTimeout(() => {
    addMessageToChat('market_bot', 'BTC just broke $52,000!');
  }, 3000);
});`);

    // Create background.js
    zip.file("background.js", `// Background script for the trading extension

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Poloniex Trading Extension installed');
  
  // Initialize storage with default settings
  chrome.storage.sync.set({
    notifications: true,
    darkMode: false,
    defaultPair: 'BTC-USDT'
  });
});

// Handle messages from the popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PLACE_ORDER') {
    // This would typically make an API call to your backend
    console.log('Order request received:', request);
    
    // Simulate API call
    setTimeout(() => {
      sendResponse({ success: true, orderId: 'ord_' + Date.now() });
    }, 1000);
    
    // Return true to indicate you want to send a response asynchronously
    return true;
  }
  
  if (request.type === 'GET_MARKET_DATA') {
    // This would typically fetch data from your backend
    fetchMarketData(request.pair)
      .then(data => {
        sendResponse({ success: true, data });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }

  if (request.type === 'CHECK_INSTALLATION') {
    sendResponse({ installed: true });
    return true;
  }
});

// Mock function to fetch market data
function fetchMarketData(pair) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        pair,
        price: 51000 + Math.random() * 1000,
        change: (Math.random() * 5 - 2.5).toFixed(2),
        volume: Math.floor(1000 + Math.random() * 9000)
      });
    }, 500);
  });
}

// Set up alarm to periodically check for important market events
chrome.alarms.create('checkMarket', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkMarket') {
    // Check for significant market movements or alerts
    checkMarketConditions();
  }
});

// Mock function to check market conditions
function checkMarketConditions() {
  // Simulate finding an important market event
  if (Math.random() > 0.7) {
    try {
      // Show notification to user if found
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Market Alert',
        message: 'Significant price movement detected in BTC-USDT!',
        priority: 2
      });
    } catch (error) {
      console.error('Failed to create notification:', error);
    }
  }
}`);

    // Create icons folder
    const icons = zip.folder("icons");
    
    // Create simple SVG icons (as data URLs)
    const icon16 = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>')}`;
    const icon48 = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>')}`;
    const icon128 = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>')}`;
    
    // Fetch SVG data and convert to PNG
    const fetchImage = async (dataURL: string) => {
      const response = await fetch(dataURL);
      return await response.blob();
    };
    
    // Add icons to the zip file
    const icon16Blob = await fetchImage(icon16);
    const icon48Blob = await fetchImage(icon48);
    const icon128Blob = await fetchImage(icon128);
    
    icons?.file("icon16.png", icon16Blob);
    icons?.file("icon48.png", icon48Blob);
    icons?.file("icon128.png", icon128Blob);
    
    // Generate zip file
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "poloniex-trading-extension.zip");
    
    return Promise.resolve();
  } catch (error) {
    console.error("Error creating extension zip:", error);
    return Promise.reject(error);
  }
};