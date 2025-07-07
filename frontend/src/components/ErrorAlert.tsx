import React from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import useErrorHandler from '../hooks/useErrorHandler';

interface ErrorAlertProps {
  message?: string;
  onClose?: () => void;
  autoClose?: boolean;
  autoCloseDelay?: number;
  severity?: 'error' | 'warning' | 'info';
  details?: string;
}

const ErrorAlert: React.FC<ErrorAlertProps> = ({
  message = 'An error occurred',
  onClose,
  autoClose = true,
  autoCloseDelay = 5000,
  severity = 'error',
  details
}) => {
  const [showDetails, setShowDetails] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  
  // Auto-close functionality
  React.useEffect(() => {
    if (autoClose && visible) {
      const timer = setTimeout(() => {
        setVisible(false);
        if (onClose) onClose();
      }, autoCloseDelay);
      
      return () => clearTimeout(timer);
    }
  }, [autoClose, autoCloseDelay, onClose, visible]);
  
  // Handle manual close
  const handleClose = () => {
    setVisible(false);
    if (onClose) onClose();
  };
  
  // Don't render if not visible
  if (!visible) return null;
  
  // Determine styles based on severity
  const getStyles = () => {
    switch (severity) {
      case 'error':
        return {
          container: 'bg-red-50 border-red-500',
          icon: <AlertCircle className="h-5 w-5 text-red-500" />,
          text: 'text-red-700'
        };
      case 'warning':
        return {
          container: 'bg-yellow-50 border-yellow-500',
          icon: <AlertTriangle className="h-5 w-5 text-yellow-500" />,
          text: 'text-yellow-700'
        };
      case 'info':
        return {
          container: 'bg-blue-50 border-blue-500',
          icon: <Info className="h-5 w-5 text-blue-500" />,
          text: 'text-blue-700'
        };
      default:
        return {
          container: 'bg-red-50 border-red-500',
          icon: <AlertCircle className="h-5 w-5 text-red-500" />,
          text: 'text-red-700'
        };
    }
  };
  
  const styles = getStyles();
  
  return (
    <div className={`border-l-4 p-4 rounded-md shadow-sm mb-4 ${styles.container}`}>
      <div className="flex justify-between items-start">
        <div className="flex items-start">
          <div className="flex-shrink-0 mr-3">
            {styles.icon}
          </div>
          <div>
            <p className={`font-medium ${styles.text}`}>{message}</p>
            
            {details && (
              <div className="mt-1">
                <button 
                  onClick={() => setShowDetails(!showDetails)}
                  className={`text-sm underline ${styles.text} opacity-80 hover:opacity-100`}
                >
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
                
                {showDetails && (
                  <div className="mt-2 text-sm bg-white bg-opacity-50 p-2 rounded max-h-32 overflow-auto">
                    <pre className="whitespace-pre-wrap">{details}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        <button 
          onClick={handleClose}
          className={`${styles.text} opacity-70 hover:opacity-100`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

interface ErrorNotifierProps {
  children: React.ReactNode;
}

export const ErrorNotifier: React.FC<ErrorNotifierProps> = ({ children }) => {
  const { error, hasError, severity, resetError } = useErrorHandler();
  
  // Map severity to alert severity
  const mapSeverity = (): 'error' | 'warning' | 'info' => {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'info';
      default:
        return 'error';
    }
  };
  
  return (
    <>
      {hasError && error && (
        <ErrorAlert 
          message={error.message}
          severity={mapSeverity()}
          onClose={resetError}
          details={error.stack}
          autoClose={severity === 'low'}
          autoCloseDelay={severity === 'low' ? 5000 : 10000}
        />
      )}
      {children}
    </>
  );
};

export default ErrorAlert;
