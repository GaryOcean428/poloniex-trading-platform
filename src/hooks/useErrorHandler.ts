import { useState, useEffect } from 'react';

/**
 * Custom hook for handling API errors
 * @param initialErrors Initial error messages
 * @returns Error handling utilities
 */
export const useErrorHandler = (initialErrors: string[] = []) => {
  const [errors, setErrors] = useState<string[]>(initialErrors);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Clear errors after 5 seconds
  useEffect(() => {
    if (errors.length > 0) {
      const timer = setTimeout(() => {
        setErrors([]);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [errors]);

  /**
   * Add a new error message
   * @param error Error message to add
   */
  const addError = (error: string) => {
    setErrors(prev => [...prev, error]);
  };

  /**
   * Clear all error messages
   */
  const clearErrors = () => {
    setErrors([]);
  };

  /**
   * Execute an async function with error handling
   * @param asyncFn Async function to execute
   * @param errorMessage Error message to display on failure
   * @returns Result of the async function
   */
  const executeWithErrorHandling = async <T,>(
    asyncFn: () => Promise<T>,
    errorMessage: string = 'An error occurred'
  ): Promise<T | null> => {
    setIsLoading(true);
    try {
      const result = await asyncFn();
      setIsLoading(false);
      return result;
    } catch (error) {
      setIsLoading(false);
      const message = error instanceof Error ? error.message : errorMessage;
      addError(message);
      console.error(message, error);
      return null;
    }
  };

  return {
    errors,
    isLoading,
    addError,
    clearErrors,
    executeWithErrorHandling
  };
};

export default useErrorHandler;
