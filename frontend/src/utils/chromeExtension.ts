// Enhanced Chrome extension utilities with improved security features

/**
 * Extension message types for type safety
 */
export enum ExtensionMessageType {
  GET_DATA = 'GET_DATA',
  SET_DATA = 'SET_DATA',
  EXECUTE_TRADE = 'EXECUTE_TRADE',
  GET_ACCOUNT = 'GET_ACCOUNT',
  AUTHENTICATE = 'AUTHENTICATE',
  LOGOUT = 'LOGOUT',
  ERROR = 'ERROR',
  STATUS = 'STATUS'
}

/**
 * Extension message interface for type safety
 */
export interface ExtensionMessage {
  type: ExtensionMessageType;
  payload?: any;
  timestamp: number;
  requestId: string;
  origin: string;
}

/**
 * Extension response interface for type safety
 */
export interface ExtensionResponse {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
  requestId: string;
}

// Allowed origins for extension communication
const ALLOWED_ORIGINS = [
  'chrome-extension://[extension-id]',
  window.location.origin
];

// Extension security token stored in memory
let securityToken: string | null = null;

/**
 * Generate a random request ID
 */
const generateRequestId = (): string => {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
};

/**
 * Safely checks if Chrome extension API is available
 */
export const isChromeExtension = (): boolean => {
  return typeof window !== 'undefined' && 
         typeof window.chrome !== 'undefined' && 
         typeof window.chrome.runtime !== 'undefined';
};

/**
 * Validate extension message origin
 * @param origin Message origin
 */
const validateOrigin = (origin: string): boolean => {
  return ALLOWED_ORIGINS.includes(origin);
};

/**
 * Validate extension message structure
 * @param message Message to validate
 */
const validateMessage = (message: any): boolean => {
  if (!message || typeof message !== 'object') return false;
  if (!Object.values(ExtensionMessageType).includes(message.type)) return false;
  if (!message.timestamp || typeof message.timestamp !== 'number') return false;
  if (!message.requestId || typeof message.requestId !== 'string') return false;
  if (!message.origin || typeof message.origin !== 'string') return false;
  
  return true;
};

/**
 * Initialize extension security
 * @param token Optional security token
 */
export const initExtensionSecurity = (token?: string): void => {
  // Generate or use provided security token
  securityToken = token || Math.random().toString(36).substring(2, 15);
  
  // Set up message listener with security checks
  if (isChromeExtension()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Validate message origin
      if (sender.origin && !validateOrigin(sender.origin)) {
        console.error(`Invalid message origin: ${sender.origin}`);
        sendResponse({
          success: false,
          error: 'Invalid message origin',
          timestamp: Date.now(),
          requestId: message.requestId || 'unknown'
        });
        return;
      }
      
      // Validate message structure
      if (!validateMessage(message)) {
        console.error('Invalid message structure', message);
        sendResponse({
          success: false,
          error: 'Invalid message structure',
          timestamp: Date.now(),
          requestId: message.requestId || 'unknown'
        });
        return;
      }
      
      // Process message
      console.log('Valid message received', message);
      
      // Return true to indicate async response
      return true;
    });
  }
};

/**
 * Safely sends a message to Chrome extension with security features
 * @param type Message type
 * @param payload Message payload
 * @returns Promise that resolves with the response
 */
export const sendSecureMessage = (
  type: ExtensionMessageType,
  payload?: any
): Promise<ExtensionResponse> => {
  return new Promise((resolve, reject) => {
    if (!isChromeExtension()) {
      reject(new Error('Chrome extension API not available'));
      return;
    }
    
    // Create secure message
    const requestId = generateRequestId();
    const message: ExtensionMessage = {
      type,
      payload,
      timestamp: Date.now(),
      requestId,
      origin: window.location.origin
    };
    
    // Add security token if available
    if (securityToken) {
      message.payload = {
        ...message.payload,
        _securityToken: securityToken
      };
    }
    
    // Send message with timeout
    const timeout = setTimeout(() => {
      reject(new Error('Extension communication timeout'));
    }, 10000);
    
    chrome.runtime.sendMessage(message, (response: ExtensionResponse) => {
      clearTimeout(timeout);
      
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      
      if (!response || !response.success) {
        reject(new Error(response?.error || 'Unknown extension error'));
        return;
      }
      
      resolve(response);
    });
  });
};

/**
 * Get data from extension securely
 * @param key Data key
 * @returns Promise that resolves with the data
 */
export const getExtensionData = (key: string): Promise<any> => {
  return sendSecureMessage(ExtensionMessageType.GET_DATA, { key })
    .then(response => response.data);
};

/**
 * Set data in extension securely
 * @param key Data key
 * @param value Data value
 * @returns Promise that resolves when data is set
 */
export const setExtensionData = (key: string, value: any): Promise<void> => {
  return sendSecureMessage(ExtensionMessageType.SET_DATA, { key, value })
    .then(() => undefined);
};

/**
 * Execute trade through extension securely
 * @param tradeParams Trade parameters
 * @returns Promise that resolves with trade result
 */
export const executeExtensionTrade = (tradeParams: any): Promise<any> => {
  return sendSecureMessage(ExtensionMessageType.EXECUTE_TRADE, tradeParams)
    .then(response => response.data);
};

/**
 * Get account information from extension securely
 * @returns Promise that resolves with account information
 */
export const getExtensionAccount = (): Promise<any> => {
  return sendSecureMessage(ExtensionMessageType.GET_ACCOUNT)
    .then(response => response.data);
};

/**
 * Authenticate with extension securely
 * @param credentials Authentication credentials
 * @returns Promise that resolves with authentication result
 */
export const authenticateExtension = (credentials: any): Promise<any> => {
  return sendSecureMessage(ExtensionMessageType.AUTHENTICATE, credentials)
    .then(response => response.data);
};

/**
 * Logout from extension securely
 * @returns Promise that resolves when logout is complete
 */
export const logoutExtension = (): Promise<void> => {
  return sendSecureMessage(ExtensionMessageType.LOGOUT)
    .then(() => undefined);
};

/**
 * Get extension status securely
 * @returns Promise that resolves with extension status
 */
export const getExtensionStatus = (): Promise<any> => {
  return sendSecureMessage(ExtensionMessageType.STATUS)
    .then(response => response.data);
};

export default {
  isChromeExtension,
  initExtensionSecurity,
  sendSecureMessage,
  getExtensionData,
  setExtensionData,
  executeExtensionTrade,
  getExtensionAccount,
  authenticateExtension,
  logoutExtension,
  getExtensionStatus,
  ExtensionMessageType
};
