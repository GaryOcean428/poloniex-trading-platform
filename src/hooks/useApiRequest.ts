import { useCallback } from 'react';
import { useErrorHandler } from './useErrorHandler';
import { sendSecureMessage, getExtensionData } from '@/utils/chromeExtension';

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
    return withErrorHandling(async () => {
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
    }, `Failed to fetch data from ${url}`);
  }, [withErrorHandling]);

  /**
   * Make a POST request with error handling
   * @param url URL to fetch
   * @param data Data to send
   * @param options Fetch options
   * @returns Response data or null on error
   */
  const post = useCallback(async <T,>(url: string, data: any, options?: RequestInit): Promise<T | null> => {
    return withErrorHandling(async () => {
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
    }, `Failed to post data to ${url}`);
  }, [withErrorHandling]);

  /**
   * Send a message to Chrome extension with error handling
   * @param message Message to send
   * @returns Response data or null on error
   */
  const sendExtensionMessage = useCallback(async <T,>(message: any): Promise<T | null> => {
    return withErrorHandling(async () => {
      return new Promise((resolve, reject) => {
        sendChromeMessage(message, (response) => {
          if (response && response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response as T);
          }
        });
      });
    }, 'Failed to communicate with extension');
  }, [withErrorHandling]);

  /**
   * Get data from Chrome storage with error handling
   * @param key Storage key
   * @returns Storage data or null on error
   */
  const getExtensionStorage = useCallback(async <T,>(key: string): Promise<T | null> => {
    return withErrorHandling(async () => {
      return new Promise((resolve, reject) => {
        getChromeStorage(key, (data) => {
          if (data && data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data[key] as T);
          }
        });
      });
    }, 'Failed to get data from extension storage');
  }, [withErrorHandling]);

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
