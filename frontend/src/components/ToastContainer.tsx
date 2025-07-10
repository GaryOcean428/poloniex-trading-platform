import React, { useEffect, useRef, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useAppStore } from '@/store';
import { clsx } from 'clsx';

const ToastContainer: React.FC = () => {
  const toasts = useAppStore(state => state.toasts);
  const removeToast = useAppStore(state => state.removeToast);
  const autoRemovalTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const scheduleAutoRemoval = useCallback((toastId: string) => {
    // Clear existing timer if any
    const existingTimer = autoRemovalTimers.current.get(toastId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new removal
    const timer = setTimeout(() => {
      removeToast(toastId);
      autoRemovalTimers.current.delete(toastId);
    }, 5000);

    autoRemovalTimers.current.set(toastId, timer);
  }, [removeToast]);

  // Handle auto-removal for new toasts
  useEffect(() => {
    toasts.forEach(toast => {
      if (toast.dismissible !== false && !autoRemovalTimers.current.has(toast.id)) {
        scheduleAutoRemoval(toast.id);
      }
    });

    // Clean up timers for removed toasts
    const currentToastIds = new Set(toasts.map(t => t.id));
    autoRemovalTimers.current.forEach((timer, toastId) => {
      if (!currentToastIds.has(toastId)) {
        clearTimeout(timer);
        autoRemovalTimers.current.delete(toastId);
      }
    });
  }, [toasts.length, scheduleAutoRemoval]); // Only depend on toasts.length to avoid infinite loops

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      autoRemovalTimers.current.forEach(timer => clearTimeout(timer));
      autoRemovalTimers.current.clear();
    };
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'info':
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getToastStyles = (type: string) => {
    const baseStyles = "relative flex items-center p-4 mb-3 rounded-lg shadow-lg border transition-all duration-300 max-w-md";
    
    switch (type) {
      case 'success':
        return clsx(baseStyles, "bg-green-50 border-green-200 text-green-800");
      case 'error':
        return clsx(baseStyles, "bg-red-50 border-red-200 text-red-800");
      case 'warning':
        return clsx(baseStyles, "bg-yellow-50 border-yellow-200 text-yellow-800");
      case 'info':
      default:
        return clsx(baseStyles, "bg-blue-50 border-blue-200 text-blue-800");
    }
  };

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={getToastStyles(toast.type)}
        >
          <div className="flex items-start space-x-3 flex-1">
            {getIcon(toast.type)}
            <div className="flex-1">
              <p className="text-sm font-medium">{toast.message}</p>
            </div>
          </div>
          
          {toast.dismissible !== false && (
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-3 flex-shrink-0 p-1 rounded-full hover:bg-gray-200 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;