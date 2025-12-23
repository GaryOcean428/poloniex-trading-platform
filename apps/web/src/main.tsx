import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'  // ✅ Must be imported
import { setupAxiosInterceptors } from './utils/axiosInterceptor'
import { logger } from './utils/logger'

// Setup automatic token refresh for all axios requests
setupAxiosInterceptors();

// Global error handlers
// 1. Handle unhandled Promise rejections
window.addEventListener('unhandledrejection', (event) => {
  const errorMessage = event.reason?.message || String(event.reason) || 'An unexpected error occurred';
  
  // Suppress browser extension errors (message channel, chrome runtime, etc.)
  // These are common when browser extensions try to communicate with the page
  if (
    errorMessage.includes('message channel closed') ||
    errorMessage.includes('Extension context invalidated') ||
    errorMessage.includes('chrome.runtime') ||
    errorMessage.includes('asynchronous response') ||
    errorMessage.includes('A listener indicated an asynchronous response')
  ) {
    // These are browser extension errors, not our app errors
    // Prevent them from appearing in the console
    event.preventDefault();
    return;
  }
  
  logger.error('Unhandled Promise Rejection:', {
    reason: event.reason,
    promise: event.promise
  });
  
  // console.error('Unhandled Promise Rejection:', errorMessage);
  
  // Prevent default browser error handling
  event.preventDefault();
});

// 2. Handle global JavaScript errors
const resizeObserverErrRe = /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;
const originalError = window.onerror;
window.onerror = (message, source, lineno, colno, error) => {
  // Suppress ResizeObserver errors (known React issue, non-critical)
  if (message && typeof message === 'string' && resizeObserverErrRe.test(message)) {
    // console.warn('ResizeObserver error suppressed:', message);
    return true;
  }
  
  // Log all other errors
  logger.error('Global Error:', {
    message,
    source,
    lineno,
    colno,
    error: error?.stack || error
  });
  
  if (originalError) {
    return originalError(message, source, lineno, colno, error);
  }
  return false;
};

// 3. Handle resource loading errors
window.addEventListener('error', (event) => {
  // Suppress browser extension errors
  const errorMessage = event.message || (event.error && event.error.message) || '';
  if (
    errorMessage.includes('message channel closed') ||
    errorMessage.includes('Extension context invalidated') ||
    errorMessage.includes('chrome.runtime') ||
    errorMessage.includes('asynchronous response') ||
    errorMessage.includes('A listener indicated an asynchronous response')
  ) {
    event.preventDefault();
    return;
  }
  
  if (event.target !== window) {
    logger.error('Resource Loading Error:', {
      target: event.target,
      type: event.type
    });
  }
}, true);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
// Force rebuild Mon Nov 10 10:08:44 EST 2025
