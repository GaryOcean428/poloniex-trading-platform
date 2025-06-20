import React, { useState, useEffect } from 'react';
import { poloniexApi, PoloniexAPIError, PoloniexConnectionError, PoloniexAuthenticationError } from '@/services/poloniexAPI';
import APIErrorBoundary from '@/components/APIErrorBoundary';
import useAPICall from '@/hooks/useAPICall';

interface AccountBalanceDisplayProps {
  pair?: string;
}

/**
 * Example component showing proper error handling for API calls
 * This replaces the old pattern of silent fallbacks to mock data
 */
export const AccountBalanceDisplay: React.FC<AccountBalanceDisplayProps> = ({ pair = 'BTC-USDT' }) => {
  const [accountBalance, setAccountBalance] = useState<any>(null);

  // Use the new useAPICall hook for proper error handling
  const {
    data: balance,
    loading,
    error,
    execute: fetchBalance,
    retry
  } = useAPICall(
    () => poloniexApi.getAccountBalance(),
    {
      onError: (error) => {
        console.error('Account balance fetch failed:', error.message);
      },
      retryCount: 3,
      retryDelay: 1000
    }
  );

  // Initial load
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Update state when data is available
  useEffect(() => {
    if (balance) {
      setAccountBalance(balance);
    }
  }, [balance]);

  // Loading state
  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Account Balance</h3>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  // Error state - show error boundary instead of mock data
  if (error) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Account Balance</h3>
        <APIErrorBoundary 
          error={error} 
          onRetry={retry}
          context="Account Balance"
        />
      </div>
    );
  }

  // Success state
  if (accountBalance) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Account Balance</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500">Total Amount</p>
            <p className="text-lg font-semibold text-gray-900">${accountBalance.totalAmount}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Available</p>
            <p className="text-lg font-semibold text-gray-900">${accountBalance.availableAmount}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Account Equity</p>
            <p className="text-lg font-semibold text-gray-900">${accountBalance.accountEquity}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Unrealized PnL</p>
            <p className={`text-lg font-semibold ${
              parseFloat(accountBalance.unrealizedPnL) >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              ${accountBalance.unrealizedPnL}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No data state (shouldn't happen with proper error handling)
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Account Balance</h3>
      <p className="text-gray-500">No account data available</p>
    </div>
  );
};

export default AccountBalanceDisplay;