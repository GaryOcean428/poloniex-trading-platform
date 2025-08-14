import React, { useEffect } from 'react';
import {
  isChromeExtensionAvailable,
  initExtensionSecurity,
  getExtensionStatus
} from '@/utils/chromeExtension';

/* eslint-disable no-console */

/**
 * Component that initializes and monitors extension security
 */
const ExtensionSecurityManager: React.FC = () => {
  useEffect(() => {
    // Initialize extension security on component mount
    if (isChromeExtensionAvailable()) {
      // Generate a unique security token for this session
      const securityToken = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

      // Initialize extension security with the token
      initExtensionSecurity(securityToken);

      // Store token in session storage for extension verification
      sessionStorage.setItem('extension_security_token', securityToken);

      // Set up periodic status check
      const checkStatus = async () => {
        try {
          await getExtensionStatus();
        } catch (error: unknown) {
          // console.error('Extension status check failed:', error);
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
