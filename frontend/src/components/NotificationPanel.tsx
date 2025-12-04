import React, { useEffect, useRef } from 'react';
import { Bell, CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';

interface Notification {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onClearAll: () => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAsRead,
  onClearAll
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'info':
      default:
        return <Info className="h-5 w-5 text-blue-500" />;
    }
  };

  const getBgColor = (notification: Notification) => {
    const base = notification.read ? 'bg-neutral-50' : 'bg-white';
    return base;
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-lg shadow-xl border border-neutral-200 z-50"
      role="dialog"
      aria-label="Notifications"
      aria-modal="false"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-200">
        <div className="flex items-center space-x-2">
          <Bell className="h-5 w-5 text-neutral-600" />
          <h3 className="text-lg font-semibold text-neutral-900">Notifications</h3>
          {unreadCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
              {unreadCount} new
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 transition-colors"
          aria-label="Close notifications"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Notifications List */}
      <div className="max-h-96 overflow-y-auto">
        {notifications.length > 0 ? (
          <div className="divide-y divide-neutral-200">
            {notifications.map(notification => (
              <div
                key={notification.id}
                className={`p-4 hover:bg-neutral-50 transition-colors cursor-pointer ${getBgColor(notification)}`}
                onClick={() => onMarkAsRead(notification.id)}
              >
                <div className="flex items-start space-x-3">
                  {getIcon(notification.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-medium ${notification.read ? 'text-neutral-700' : 'text-neutral-900'}`}>
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <span className="ml-2 h-2 w-2 bg-blue-600 rounded-full" aria-label="Unread"></span>
                      )}
                    </div>
                    <p className={`text-sm mt-1 ${notification.read ? 'text-neutral-500' : 'text-neutral-600'}`}>
                      {notification.message}
                    </p>
                    <p className="text-xs text-neutral-400 mt-1">
                      {new Date(notification.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <Bell className="h-12 w-12 text-neutral-300 mb-3" />
            <p className="text-neutral-600 text-sm font-medium">No notifications</p>
            <p className="text-neutral-400 text-xs mt-1">You're all caught up!</p>
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="p-3 border-t border-neutral-200 bg-neutral-50">
          <button
            onClick={onClearAll}
            className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            Clear all notifications
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationPanel;
