import React, { useEffect, useState } from 'react';
import { 
  isChromeExtension, 
  initExtensionSecurity, 
  getExtensionStatus,
  ExtensionMessageType
} from '@/utils/chromeExtension';

/**
 * Component that initializes and monitors extension security
 */
const ExtensionSecurityManager: React.FC = () => {
  const [initialized, setInitialized] = useState(false);
  const [status, setStatus] = useState<'disconnected' | 'connected' | 'secure'>('disconnected');

  useEffect(() => {
    // Initialize extension security on component mount
    if (isChromeExtension()) {
      // Generate a unique security token for this session
      const securityToken = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Initialize extension security with the token
      initExtensionSecurity(securityToken);
      
      // Store token in session storage for extension verification
      sessionStorage.setItem('extension_security_token', securityToken);
      
      setInitialized(true);
      
      // Set up periodic status check
      const checkStatus = async () => {
        try {
          const statusData = await getExtensionStatus();
          setStatus(statusData.securityLevel || 'connected');
        } catch (error) {
          console.error('Extension status check failed:', error);
          setStatus('disconnected');
        }
      };
      
      // Check status immediately
      checkStatus();
      
      // Set up interval for periodic checks
      const statusInterval = setInterval(checkStatus, 30000);
      
      // Clean up on unmount
      return () => {
        clearInterval(statusInterval);
      };
    }
  }, []);

  // This component doesn't render anything visible
  return null;
};

export default ExtensionSecurityManager;
