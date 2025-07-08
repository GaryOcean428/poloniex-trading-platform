import React from 'react';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { useTradingContext } from '../../hooks/useTradingContext';

const AccountSummary: React.FC = () => {
  const { accountBalance, isLoading } = useTradingContext();
  
  // Default values if data is not available
  const defaultAccountData = {
    balance: 15478.23,
    availableBalance: 12345.67,
    equity: 15820.45,
    unrealizedPnL: 342.22,
    todayPnL: 156.78,
    todayPnLPercentage: 1.02
  };
  
  // Process account data from API if available
  const processAccountData = () => {
    if (!accountBalance || isLoading) return defaultAccountData;
    
    try {
      // This mapping will depend on the exact format of your Poloniex API response
      // Adjust as needed based on the actual response structure
      return {
        balance: parseFloat(accountBalance.totalAmount || "0"),
        availableBalance: parseFloat(accountBalance.availableAmount || "0"),
        equity: parseFloat(accountBalance.accountEquity || "0"),
        unrealizedPnL: parseFloat(accountBalance.unrealizedPnL || "0"),
        todayPnL: parseFloat(accountBalance.todayPnL || "0"),
        todayPnLPercentage: parseFloat(accountBalance.todayPnLPercentage || "0")
      };
    } catch (error) {
      console.error('Error processing account data:', error);
      return defaultAccountData;
    }
  };
  
  const accountData = processAccountData();
  
  return (
    <div>
      <h2 className="text-xl font-bold mb-4 flex items-center justify-between">Account Summary {isLoading && <span className="text-sm text-neutral-500">Loading...</span>}</h2>
      
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-neutral-50 p-3 rounded-md">
            <div className="text-sm text-neutral-500">Total Balance</div>
            <div className="text-xl font-bold flex items-center">
              <DollarSign className="h-4 w-4 mr-1 text-neutral-500" />
              {accountData.balance?.toFixed(2)}
            </div>
          </div>
          
          <div className="bg-neutral-50 p-3 rounded-md">
            <div className="text-sm text-neutral-500">Available</div>
            <div className="text-xl font-bold flex items-center">
              <DollarSign className="h-4 w-4 mr-1 text-neutral-500" />
              {accountData.availableBalance?.toFixed(2)}
            </div>
          </div>
        </div>
        
        <div className="bg-neutral-50 p-3 rounded-md">
          <div className="text-sm text-neutral-500">Equity</div>
          <div className="text-xl font-bold">${accountData.equity.toFixed(2)}</div>
          <div className="text-sm mt-1">
            Unrealized P&L: 
            <span className={`font-medium ml-1 ${(accountData.unrealizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {(accountData.unrealizedPnL || 0) >= 0 ? '+' : ''}{accountData.unrealizedPnL?.toFixed(2)}
            </span>
          </div>
        </div>
        
        <div className="bg-neutral-50 p-3 rounded-md">
          <div className="text-sm text-neutral-500">Today's P&L</div>
          <div className="flex items-center">
            <span className={`text-xl font-bold ${(accountData.todayPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {(accountData.todayPnL || 0) >= 0 ? '+' : ''}{accountData.todayPnL?.toFixed(2)}
            </span>
            <span className={`ml-2 flex items-center text-sm ${(accountData.todayPnLPercentage || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {(accountData.todayPnLPercentage || 0) >= 0 ? (
                <TrendingUp className="h-4 w-4 mr-1" />
              ) : (
                <TrendingDown className="h-4 w-4 mr-1" />
              )}
              {accountData.todayPnLPercentage?.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountSummary;