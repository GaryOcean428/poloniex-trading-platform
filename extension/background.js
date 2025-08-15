// Background script for the trading extension
let isInitialized = false;
let storedCookies = {};
let lastTradingViewData = null;

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Poloniex Trading Extension installed');
  
  // Initialize storage with default settings
  chrome.storage.sync.set({
    notifications: true,
    darkMode: false,
    defaultPair: 'BTC-USDT',
    autoSync: true,
    tradingViewEnabled: true,
    poloniexEnabled: true
  });
  
  isInitialized = true;
});

// Handle messages from the popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isInitialized) {
    sendResponse({ success: false, error: 'Extension not initialized' });
    return true;
  }

  switch (request.type) {
    case 'PLACE_ORDER':
      // Simulate API call
      setTimeout(() => {
        sendResponse({ success: true, orderId: 'ord_' + Date.now() });
      }, 1000);
      return true;
    
    case 'GET_MARKET_DATA':
      fetchMarketData(request.pair)
        .then(data => {
          sendResponse({ success: true, data });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'CHECK_INSTALLATION':
      sendResponse({ installed: true });
      return true;

    case 'SAVE_COOKIES':
      storedCookies[request.data.site] = request.data.cookies;
      chrome.storage.local.set({ cookies: storedCookies });
      sendResponse({ success: true });
      return true;

    case 'GET_COOKIES':
      sendResponse({ cookies: storedCookies[request.data.site] });
      return true;

    case 'UPDATE_TRADINGVIEW_DATA':
      lastTradingViewData = request.data;
      // Forward data to Poloniex tab if open
      chrome.tabs.query({ url: '*://*.poloniex.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SYNC_TRADINGVIEW_DATA',
            data: lastTradingViewData
          });
        });
      });
      sendResponse({ success: true });
      return true;
      
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      return true;
  }
});

// Load stored cookies on startup
chrome.storage.local.get(['cookies'], (result) => {
  if (result.cookies) {
    storedCookies = result.cookies;
    
    // Restore cookies when tabs are loaded
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        if (tab.url?.includes('tradingview.com') && storedCookies.tradingview) {
          chrome.tabs.sendMessage(tabId, {
            type: 'RESTORE_COOKIES',
            data: { site: 'tradingview', cookies: storedCookies.tradingview }
          });
        } else if (tab.url?.includes('poloniex.com') && storedCookies.poloniex) {
          chrome.tabs.sendMessage(tabId, {
            type: 'RESTORE_COOKIES',
            data: { site: 'poloniex', cookies: storedCookies.poloniex }
          });
        }
      }
    });
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
  if (alarm.name === 'checkMarket' && isInitialized) {
    checkMarketConditions();
  }
});

// Mock function to check market conditions
function checkMarketConditions() {
  try {
    // Simulate finding an important market event
    if (Math.random() > 0.7) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Market Alert',
        message: 'Significant price movement detected in BTC-USDT!',
        priority: 2
      });
    }
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
}