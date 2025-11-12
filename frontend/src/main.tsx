import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'  // ✅ Must be imported
import { setupAxiosInterceptors } from './utils/axiosInterceptor'

// Setup automatic token refresh for all axios requests
setupAxiosInterceptors();

// Suppress ResizeObserver errors that don't affect functionality
// This is a known issue with React and certain UI libraries
const resizeObserverErrRe = /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;
const originalError = window.onerror;
window.onerror = (message, source, lineno, colno, error) => {
  if (message && typeof message === 'string' && resizeObserverErrRe.test(message)) {
    console.warn('ResizeObserver error suppressed:', message);
    return true; // Suppress the error
  }
  if (originalError) {
    return originalError(message, source, lineno, colno, error);
  }
  return false;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
// Force rebuild Mon Nov 10 10:08:44 EST 2025
