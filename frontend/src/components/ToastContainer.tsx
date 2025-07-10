import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useToasts, useToastActions } from '@/store';
import { clsx } from 'clsx';

const ToastContainer: React.FC = () => {
  const toasts = useToasts();
  const { removeToast } = useToastActions();

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