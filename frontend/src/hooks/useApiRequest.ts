import { useCallback } from 'react';
import { useErrorHandler } from './useErrorHandler';

/**
 * Custom hook for handling API requests with proper error handling
 */
export const useApiRequest = () => {
  const { error, hasError, handleError, resetError, withErrorHandling } = useErrorHandler();

  /**
   * Make a GET request with error handling
   * @param url URL to fetch
   * @param options Fetch options
   * @returns Response data or null on error
   */
  const get = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T | null> => {
    const wrappedFn = withErrorHandling(async () => {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        ...options,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }
      
      return response.json();
    });
    
    return await wrappedFn();
  }, [withErrorHandling]);

  /**
   * Make a POST request with error handling
   * @param url URL to fetch
   * @param data Data to send
   * @param options Fetch options
   * @returns Response data or null on error
   */
  const post = useCallback(async <T,>(url: string, data: any, options?: RequestInit): Promise<T | null> => {
    const wrappedFn = withErrorHandling(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        ...options,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }
      
      return response.json();
    });
    
    return await wrappedFn();
  }, [withErrorHandling]);

  /**
   * Send a message to Chrome extension (placeholder)
   * @param message Message to send
   * @returns Response data or null on error
   */
  const sendExtensionMessage = useCallback(async <T,>(_message: any): Promise<T | null> => {
    console.log('Extension messaging not implemented');
    return null;
  }, []);

  /**
   * Get data from Chrome storage (placeholder)
   * @param key Storage key
   * @returns Storage data or null on error
   */
  const getExtensionStorage = useCallback(async <T,>(_key: string): Promise<T | null> => {
    console.log('Extension storage not implemented');
    return null;
  }, []);

  return {
    get,
    post,
    sendExtensionMessage,
    getExtensionStorage,
    error,
    hasError,
    handleError,
    resetError
  };
};

export default useApiRequest;
