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
  logger.error('Unhandled Promise Rejection:', {
    reason: event.reason,
    promise: event.promise
  });
  
  // Show user-friendly error message
  const errorMessage = event.reason?.message || 'An unexpected error occurred';
  console.error('Unhandled Promise Rejection:', errorMessage);
  
  // Prevent default browser error handling
  event.preventDefault();
});

// 2. Handle global JavaScript errors
const resizeObserverErrRe = /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;
const originalError = window.onerror;
window.onerror = (message, source, lineno, colno, error) => {
  // Suppress ResizeObserver errors (known React issue, non-critical)
  if (message && typeof message === 'string' && resizeObserverErrRe.test(message)) {
    console.warn('ResizeObserver error suppressed:', message);
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
