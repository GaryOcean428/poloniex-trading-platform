// Content script for Poloniex pages
console.log('Poloniex content script loaded');

// Initialize variables
let isExtractingData = false;
let accountData = {};
let openPositions = [];
let orderHistory = [];
let interval = null;

// Function to start data extraction
function startDataExtraction() {
  console.log('Starting Poloniex data extraction');
  
  if (interval) {
    clearInterval(interval);
  }
  
  // Extract data every 5 seconds
  interval = setInterval(extractPoloniexData, 5000);
  isExtractingData = true;
}

// Function to stop data extraction
function stopDataExtraction() {
  console.log('Stopping Poloniex data extraction');
  
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  
  isExtractingData = false;
}

// Function to extract data from Poloniex
function extractPoloniexData() {
  try {
    // Extract account data
    const accountDataElement = document.querySelector('.account-summary');
    if (accountDataElement) {
      accountData = extractAccountInfo();
    }
    
    // Extract positions data
    const positionsElement = document.querySelector('.positions-table');
    if (positionsElement) {
      openPositions = extractPositionsInfo();
    }
    
    // Extract order history
    const orderHistoryElement = document.querySelector('.order-history-table');
    if (orderHistoryElement) {
      orderHistory = extractOrderHistory();
    }
    
    // Send data to background script
    chrome.runtime.sendMessage({
      type: 'UPDATE_POLONIEX_DATA',
      data: {
        accountData,
        positions: openPositions,
        orders: orderHistory,
        timestamp: Date.now()
      }
    });
    
    // Also add a visible indicator that data is being extracted
    showExtractorStatus();
  } catch (error) {
    console.error('Error extracting Poloniex data:', error);
  }
}

// Function to extract account information
function extractAccountInfo() {
  try {
    // This is a simplistic implementation - in a real extension
    // you would need to identify and target the exact elements on the Poloniex page
    // that contain the account information
    
    // Look for balance elements
    const balanceElements = document.querySelectorAll('.account-balance, .balance-display');
    const futuresBalanceElements = document.querySelectorAll('.futures-balance, .futures-equity');
    let totalBalance = null;
    let availableBalance = null;
    
    balanceElements.forEach(element => {
      const label = element.querySelector('.label');
      const value = element.querySelector('.value');
      
      if (label && value) {
        const labelText = label.textContent.trim().toLowerCase();
        const valueText = value.textContent.trim().replace(/[^0-9.]/g, '');
        
        if (labelText.includes('total') || labelText.includes('equity')) {
          totalBalance = parseFloat(valueText);
        } else if (labelText.includes('available')) {
          availableBalance = parseFloat(valueText);
        }
      }
    });
    
    // Look for futures-specific balance elements
    futuresBalanceElements.forEach(element => {
      const label = element.querySelector('.label');
      const value = element.querySelector('.value');
      
      if (label && value) {
        const labelText = label.textContent.trim().toLowerCase();
        const valueText = value.textContent.trim().replace(/[^0-9.]/g, '');
        
        if (labelText.includes('futures') || labelText.includes('equity')) {
          totalBalance = parseFloat(valueText);
        }
      }
    });
    
    // Look for PNL elements
    const pnlElements = document.querySelectorAll('.pnl-display, .profit-loss');
    let dailyPnl = null;
    
    pnlElements.forEach(element => {
      const text = element.textContent.trim();
      if (text.includes('Day') || text.includes('Today')) {
        const pnlValue = text.replace(/[^0-9.-]/g, '');
        dailyPnl = parseFloat(pnlValue);
      }
    });
    
    return {
      totalBalance,
      availableBalance,
      dailyPnl,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error extracting account info:', error);
    return {};
  }
}

// Function to extract positions information
function extractPositionsInfo() {
  try {
    const positions = [];
    const positionRows = document.querySelectorAll('.positions-row, .position-item');
    
    positionRows.forEach(row => {
      // Extract position data from each row
      // This is a simplified example - adapt to match Poloniex's actual DOM structure
      
      const symbol = row.querySelector('.symbol')?.textContent.trim();
      const size = row.querySelector('.size')?.textContent.trim();
      const entryPrice = row.querySelector('.entry-price')?.textContent.trim();
      const markPrice = row.querySelector('.mark-price')?.textContent.trim();
      const pnl = row.querySelector('.pnl')?.textContent.trim();
      
      if (symbol) {
        positions.push({
          symbol,
          size: parseFloat(size.replace(/[^0-9.-]/g, '')),
          entryPrice: parseFloat(entryPrice.replace(/[^0-9.-]/g, '')),
          markPrice: parseFloat(markPrice.replace(/[^0-9.-]/g, '')),
          pnl: parseFloat(pnl.replace(/[^0-9.-]/g, '')),
          timestamp: Date.now()
        });
      }
    });
    
    return positions;
  } catch (error) {
    console.error('Error extracting positions info:', error);
    return [];
  }
}

// Function to extract order history
function extractOrderHistory() {
  try {
    const orders = [];
    const orderRows = document.querySelectorAll('.order-row, .order-item');
    
    orderRows.forEach(row => {
      // Extract order data from each row
      // This is a simplified example - adapt to match Poloniex's actual DOM structure
      
      const orderId = row.querySelector('.order-id')?.textContent.trim();
      const symbol = row.querySelector('.symbol')?.textContent.trim();
      const type = row.querySelector('.type')?.textContent.trim();
      const side = row.querySelector('.side')?.textContent.trim();
      const price = row.querySelector('.price')?.textContent.trim();
      const amount = row.querySelector('.amount')?.textContent.trim();
      const status = row.querySelector('.status')?.textContent.trim();
      
      if (orderId && symbol) {
        orders.push({
          orderId,
          symbol,
          type,
          side,
          price: parseFloat(price.replace(/[^0-9.-]/g, '')),
          amount: parseFloat(amount.replace(/[^0-9.-]/g, '')),
          status,
          timestamp: Date.now()
        });
      }
    });
    
    return orders;
  } catch (error) {
    console.error('Error extracting order history:', error);
    return [];
  }
}

// Function to show the status of the data extractor
function showExtractorStatus() {
  let statusBar = document.getElementById('poloniex-extension-status');
  
  if (!statusBar) {
    statusBar = document.createElement('div');
    statusBar.id = 'poloniex-extension-status';
    statusBar.style.position = 'fixed';
    statusBar.style.bottom = '10px';
    statusBar.style.right = '10px';
    statusBar.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    statusBar.style.color = 'white';
    statusBar.style.padding = '5px 10px';
    statusBar.style.borderRadius = '3px';
    statusBar.style.fontSize = '12px';
    statusBar.style.zIndex = '9999';
    document.body.appendChild(statusBar);
  }
  
  statusBar.innerHTML = `
    <div>Trading Extension Active</div>
    <div>Data synced: ${new Date().toLocaleTimeString()}</div>
  `;
}

// Function to execute a trade directly from extension
function executeTrade(tradeData) {
  try {
    console.log('Executing trade on Poloniex UI:', tradeData);
    
    // Find and interact with the trading form on Poloniex
    // This is a simplified example - adapt to match Poloniex's actual DOM structure
    
    // Select pair in dropdown
    const pairSelector = document.querySelector('select.pair-select, .symbol-selector');
    if (pairSelector) {
      // Convert from BTC-USDT format to Poloniex format
      const poloniexPair = tradeData.pair.replace('-', '_');
      
      // Try to find and select the option
      const options = Array.from(pairSelector.options);
      const option = options.find(opt => opt.value === poloniexPair || opt.textContent.includes(poloniexPair));
      
      if (option) {
        option.selected = true;
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        pairSelector.dispatchEvent(event);
      }
    }
    
    // Select trade type (limit/market)
    const typeSelector = document.querySelector('select.order-type, .type-selector');
    if (typeSelector) {
      const options = Array.from(typeSelector.options);
      const option = options.find(opt => opt.value.toLowerCase() === tradeData.type.toLowerCase());
      
      if (option) {
        option.selected = true;
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        typeSelector.dispatchEvent(event);
      }
    }
    
    // Fill in amount
    const amountInput = document.querySelector('input.amount-input, .quantity-input');
    if (amountInput) {
      amountInput.value = tradeData.amount;
      // Trigger input event
      const event = new Event('input', { bubbles: true });
      amountInput.dispatchEvent(event);
    }
    
    // Fill in price for limit orders
    if (tradeData.type.toLowerCase() === 'limit' && tradeData.price) {
      const priceInput = document.querySelector('input.price-input, .limit-price-input');
      if (priceInput) {
        priceInput.value = tradeData.price;
        // Trigger input event
        const event = new Event('input', { bubbles: true });
        priceInput.dispatchEvent(event);
      }
    }
    
    // Click buy or sell button
    let actionButton;
    if (tradeData.side.toLowerCase() === 'buy') {
      actionButton = document.querySelector('button.buy-button, .buy-action');
    } else {
      actionButton = document.querySelector('button.sell-button, .sell-action');
    }
    
    if (actionButton) {
      // Click the button
      actionButton.click();
      
      // Check for confirmation dialog
      setTimeout(() => {
        const confirmButton = document.querySelector('.confirm-button, .modal-confirm');
        if (confirmButton) {
          confirmButton.click();
        }
      }, 500);
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error executing trade on Poloniex UI:', error);
    return false;
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_DATA_EXTRACTION') {
    startDataExtraction();
    sendResponse({ success: true });
  } else if (request.type === 'STOP_DATA_EXTRACTION') {
    stopDataExtraction();
    sendResponse({ success: true });
  } else if (request.type === 'GET_POLONIEX_DATA') {
    sendResponse({ 
      success: true, 
      data: {
        accountData,
        positions: openPositions,
        orders: orderHistory
      } 
    });
  } else if (request.type === 'EXECUTE_TRADE') {
    const success = executeTrade(request.data);
    sendResponse({ success });
  }
  return true;
});

// Start data extraction when the script loads
startDataExtraction();

// Inject trading buttons if needed
function injectTradingButtons() {
  // This function would add quick trading buttons to the Poloniex interface
  // Implementation would depend on the specific Poloniex UI structure
}

// Wait for page to be fully loaded before injecting UI controls
window.addEventListener('load', () => {
  injectTradingButtons();
});