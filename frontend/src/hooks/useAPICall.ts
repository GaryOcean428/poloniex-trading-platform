import { useState, useCallback } from 'react';
import { PoloniexAPIError, PoloniexConnectionError, PoloniexAuthenticationError } from '@/services/poloniexAPI';

interface UseAPICallState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface UseAPICallOptions {
  onError?: (error: Error) => void;
  retryCount?: number;
  retryDelay?: number;
}

export function useAPICall<T>(
  apiCall: () => Promise<T>,
  options: UseAPICallOptions = {}
) {
  const { onError, retryCount = 2, retryDelay = 1000 } = options;
  
  const [state, setState] = useState<UseAPICallState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(async (attempt = 0): Promise<T | null> => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await apiCall();
      setState({ data: result, loading: false, error: null });
      return result;
    } catch (error) {
      const apiError = error as Error;
      
      // Don't retry authentication errors or certain API errors
      const shouldRetry = 
        attempt < retryCount &&
        !(apiError instanceof PoloniexAuthenticationError) &&
        !(apiError instanceof PoloniexAPIError && (apiError as PoloniexAPIError).statusCode === 404);

      if (shouldRetry && apiError instanceof PoloniexConnectionError) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
        return execute(attempt + 1);
      }

      setState({ data: null, loading: false, error: apiError });
      
      if (onError) {
        onError(apiError);
      }
      
      return null;
    }
  }, [apiCall, onError, retryCount, retryDelay]);

  const retry = useCallback(() => {
    return execute(0);
  }, [execute]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    execute,
    retry,
    reset,
  };
}

export default useAPICall;