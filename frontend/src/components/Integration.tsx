import React, { useEffect, useState, useCallback } from 'react';
import { useTradingContext } from '../context/TradingContext';
import { useSettings } from '../context/SettingsContext';

interface ExtensionMessage {
  type: string;
  data: any;
}

const Integration: React.FC = () => {
  const { addError } = useTradingContext();
  const { apiKey, apiSecret } = useSettings();
  const [isExtensionInstalled, setIsExtensionInstalled] = useState(false);
  
  const handleExtensionMessage = useCallback((event: MessageEvent) => {
    // Ensure message is from our extension
    if (event.source !== window || !event.data || event.data.source !== 'POLONIEX_EXTENSION') {
      return;
    }
    
    const message = event.data as ExtensionMessage;
    console.log('Received message from extension:', message);
    
    switch (message.type) {
      case 'PLACE_ORDER':
        // Handle order placement
        console.log('Order received from extension:', message.data);
        // In a real app, this would call your order placement logic
        break;
        
      case 'GET_ACCOUNT_DATA':
        // Handle account data request
        console.log('Account data requested from extension');
        // In a real app, this would send account data to extension
        break;
        
      default:
        console.log('Unknown message type:', message.type);
    }
  }, []);
  
  useEffect(() => {
    // Check if extension is installed
    try {
      // This is a typical pattern to detect if your extension is installed
      // by attempting to communicate with it
      if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
        // Use the actual extension ID
        const extensionId = 'jcdmopolmojdhpclfbemdpcdneobmnje'; 
        
        chrome.runtime.sendMessage(
          extensionId,
          { type: 'CHECK_INSTALLATION' },
          (response: any) => {
            if (response && response.installed) {
              setIsExtensionInstalled(true);
              console.log('Extension is installed and connected!');
            } else {
              setIsExtensionInstalled(false);
              console.log('Extension is not installed or not responding');
            }
          }
        );
      }
    } catch (error) {
      console.log('Error checking extension installation:', error);
      setIsExtensionInstalled(false);
    }
    
    // Set up listener for messages from the extension
    window.addEventListener('message', handleExtensionMessage);
    
    return () => {
      window.removeEventListener('message', handleExtensionMessage);
    };
  }, [handleExtensionMessage]);
  
  // Update extension with credentials if available
  useEffect(() => {
    if (isExtensionInstalled && apiKey && apiSecret && window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      const extensionId = 'jcdmopolmojdhpclfbemdpcdneobmnje';
      
      // Send credentials to extension
      chrome.runtime.sendMessage(
        extensionId,
        { 
          type: 'UPDATE_CREDENTIALS', 
          data: { 
            apiKey,
            apiSecret
          }
        },
        (response: any) => {
          if (response && response.success) {
            console.log('API credentials updated in extension');
          }
        }
      );
    }
  }, [isExtensionInstalled, apiKey, apiSecret]);
  
  // This component doesn't render anything visible, it just handles extension communication
  return null;
};

export default Integration;
