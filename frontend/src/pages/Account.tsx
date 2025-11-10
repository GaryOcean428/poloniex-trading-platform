import { useEffect, useState } from 'react';
import {
  Clock,
  CreditCard,
  Download,
  Upload,
  User,
  Shield,
  Key,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  BarChart4
} from 'lucide-react';
import { useTradingContext } from '../hooks/useTradingContext';
import { poloniexApi } from '../services/poloniexAPI';
import TransactionHistory from '../components/account/TransactionHistory';
import ApiKeyManagement from '../components/account/ApiKeyManagement';

// Type definition for account bills from Poloniex API
interface AccountBill {
  billId: string;
  type: string;
  symbol?: string;
  currency?: string;
  amount: number;
  fee?: number;
  ts: number;
}

// Remove mock data usage

const Account: React.FC = () => {
  const { accountBalance } = useTradingContext();
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'api' | 'settings'>('overview');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recent, setRecent] = useState<Array<{
    id: string;
    type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE';
    description: string;
    amount: number;
    status: 'COMPLETED' | 'PENDING' | 'FAILED';
    timestamp: number;
  }>>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  // instantiate inside effect to avoid extra deps

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Force API credentials reload
      poloniexApi.loadCredentials();
      // Refresh all data - using getAccountBalance instead of loadData
      await poloniexApi.getAccountBalance();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Format numbers for display
  const formatCurrency = (value: number | string) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numValue);
  };

  // Format date for display
  const formatDate = (timestamp: number | string) => {
    try {
      const date = new Date(typeof timestamp === 'string' ? parseInt(timestamp) : timestamp);

      // Validate date
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      // Return formatted date-time string
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'Invalid Date';
    }
  };

  // Map AccountBill to UI transaction row
  const mapBillToTx = (b: AccountBill) => {
    const typeMap: Record<string, 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE'> = {
      deposit: 'DEPOSIT',
      withdrawal: 'WITHDRAWAL',
      trade: 'TRADE',
      fee: 'TRADE',
      funding: 'TRADE',
    };
    const t = typeMap[b.type?.toLowerCase?.() || 'trade'] || 'TRADE';
    return {
      id: b.billId,
      type: t,
      description: `${b.symbol || b.currency || ''} ${b.type}`.trim(),
      amount: parseFloat(b.amount || '0'),
      status: 'COMPLETED' as const,
      timestamp: typeof b.ts === 'number' && b.ts < 1e12 ? b.ts * 1000 : b.ts,
    };
  };

  // Load recent 5 transactions from backend API
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setRecentLoading(true);
      setRecentError(null);
      try {
        // Get JWT token from localStorage
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Not authenticated');
        }

        // Call backend API endpoint
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
          (window.location.hostname.includes('railway.app') 
            ? 'https://polytrade-be.up.railway.app'
            : 'http://localhost:3000');
        
        const response = await fetch(`${API_BASE_URL}/api/dashboard/bills?limit=5`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to load transactions');
        }

        const result = await response.json();
        const bills = result.data;
        const rows = bills.map(mapBillToTx);
        if (mounted) setRecent(rows);
      } catch (e) {
        if (mounted) setRecentError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (mounted) setRecentLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Parse account data
  const accountData = {
    totalBalance: parseFloat(accountBalance?.total?.toString() || '0'),
    availableBalance: parseFloat(accountBalance?.available?.toString() || '0'),
    equity: parseFloat(accountBalance?.total?.toString() || '0'), // Use total as fallback for equity
    unrealizedPnL: 0, // Placeholder until backend endpoint provided
    todayPnL: 0, // Placeholder
    weeklyPnL: undefined as number | undefined, // Remove hardcoded values
    monthlyPnL: undefined as number | undefined,
    lifetimePnL: undefined as number | undefined,
    depositsPending: 0,
    withdrawalsPending: 0,
    verificationStatus: 'Verified',
    tradingLevel: 'Advanced',
    feeRate: '0.1%',
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Account Overview</h1>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center px-3 py-2 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      <div className="bg-bg-tertiary rounded-lg shadow-md">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 font-medium text-sm flex items-center ${
              activeTab === 'overview' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <User className="h-4 w-4 mr-2" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`px-4 py-3 font-medium text-sm flex items-center ${
              activeTab === 'transactions' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <CreditCard className="h-4 w-4 mr-2" />
            Transactions
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={`px-4 py-3 font-medium text-sm flex items-center ${
              activeTab === 'api' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Key className="h-4 w-4 mr-2" />
            API Keys
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-3 font-medium text-sm flex items-center ${
              activeTab === 'settings' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Shield className="h-4 w-4 mr-2" />
            Security
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Account Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="gradient-primary text-white rounded-lg shadow-elev-2 p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-white/80 text-sm">Total Balance</p>
                      <p className="text-2xl font-bold mt-1">{formatCurrency(accountData.totalBalance)}</p>
                    </div>
                    <div className="bg-blue-400/30 p-2 rounded-full">
                      <DollarSign className="h-6 w-6" />
                    </div>
                  </div>
                  <div className="mt-4 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-blue-100">Available</span>
                      <span className="font-medium">{formatCurrency(accountData.availableBalance)}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-blue-100">Equity</span>
                      <span className="font-medium">{formatCurrency(accountData.equity)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-bg-tertiary rounded-lg shadow-md p-4 border border-border-subtle">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-neutral-500 text-sm">Profit & Loss</p>
                      <p className={`text-2xl font-bold mt-1 ${accountData.todayPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {accountData.todayPnL >= 0 ? '+' : ''}{formatCurrency(accountData.todayPnL)}
                      </p>
                    </div>
                    <div className="bg-neutral-100 p-2 rounded-full">
                      <BarChart4 className="h-6 w-6 text-neutral-600" />
                    </div>
                  </div>
                  <div className="mt-4 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-500">Weekly</span>
                      <span className="font-medium text-neutral-600">
                        {accountData.weeklyPnL === undefined ? '—' : `${accountData.weeklyPnL >= 0 ? '+' : ''}${formatCurrency(accountData.weeklyPnL)}`}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-neutral-500">Monthly</span>
                      <span className="font-medium text-neutral-600">
                        {accountData.monthlyPnL === undefined ? '—' : `${accountData.monthlyPnL >= 0 ? '+' : ''}${formatCurrency(accountData.monthlyPnL)}`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-bg-tertiary rounded-lg shadow-md p-4 border border-border-subtle">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-neutral-500 text-sm">Recent Activity</p>
                      <p className="text-2xl font-bold mt-1">12 Trades</p>
                    </div>
                    <div className="bg-neutral-100 p-2 rounded-full">
                      <Clock className="h-6 w-6 text-neutral-600" />
                    </div>
                  </div>
                  <div className="mt-4 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="flex items-center text-neutral-500">
                        <ArrowUpRight className="h-4 w-4 mr-1 text-green-500" />
                        Buys
                      </span>
                      <span className="font-medium">7 orders</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="flex items-center text-neutral-500">
                        <ArrowDownRight className="h-4 w-4 mr-1 text-red-500" />
                        Sells
                      </span>
                      <span className="font-medium">5 orders</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deposit/Withdraw Buttons */}
              <div className="flex space-x-4">
                <button className="flex items-center justify-center w-full bg-green-600 text-white py-2 rounded-md hover:bg-green-700">
                  <Upload className="h-4 w-4 mr-2" />
                  Deposit
                </button>
                <button className="flex items-center justify-center w-full bg-neutral-600 text-white py-2 rounded-md hover:bg-neutral-700">
                  <Download className="h-4 w-4 mr-2" />
                  Withdraw
                </button>
              </div>

              {/* Account Status */}
              <div className="bg-bg-tertiary rounded-lg border border-border-subtle overflow-hidden">
                <div className="px-4 py-3 bg-neutral-50 border-b border-border-subtle">
                  <h3 className="font-medium">Account Status</h3>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-sm font-medium text-neutral-500">Verification Status</h4>
                      <div className="flex items-center mt-1">
                        <div className="h-3 w-3 rounded-full bg-green-500 mr-2"></div>
                        <span className="font-medium">{accountData.verificationStatus}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-neutral-500">Trading Level</h4>
                      <div className="flex items-center mt-1">
                        <span className="font-medium">{accountData.tradingLevel}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-neutral-500">Fee Rate</h4>
                      <div className="flex items-center mt-1">
                        <span className="font-medium">{accountData.feeRate}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-neutral-500">Account Age</h4>
                      <div className="flex items-center mt-1">
                        <span className="font-medium">147 days</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Transactions Summary */}
              <div className="bg-bg-tertiary rounded-lg border border-border-subtle overflow-hidden">
                <div className="px-4 py-3 bg-neutral-50 border-b border-border-subtle flex justify-between items-center">
                  <h3 className="font-medium">Recent Transactions</h3>
                  <button
                    onClick={() => setActiveTab('transactions')}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    View All
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border-subtle">
                    <thead className="bg-neutral-50">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          Type
                        </th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          Amount
                        </th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-bg-tertiary divide-y divide-border-subtle">
                      {recentLoading && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-neutral-500">Loading recent transactions...</td>
                        </tr>
                      )}
                      {recentError && !recentLoading && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-red-600">{recentError}</td>
                        </tr>
                      )}
                      {!recentLoading && !recentError && recent.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-neutral-500">No recent transactions</td>
                        </tr>
                      )}
                      {!recentLoading && !recentError && recent.slice(0, 5).map((transaction) => (
                        <tr key={transaction.id}>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className={`mr-2 flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                                transaction.type === 'DEPOSIT' 
                                  ? 'bg-green-100' 
                                  : transaction.type === 'WITHDRAWAL' 
                                    ? 'bg-red-100' 
                                    : 'bg-blue-100'
                              }`}>
                                {transaction.type === 'DEPOSIT' && (
                                  <Upload className={`h-4 w-4 text-green-600`} />
                                )}
                                {transaction.type === 'WITHDRAWAL' && (
                                  <Download className={`h-4 w-4 text-red-600`} />
                                )}
                                {transaction.type === 'TRADE' && (
                                  <RefreshCw className={`h-4 w-4 text-blue-600`} />
                                )}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-neutral-900">{transaction.type}</div>
                                <div className="text-xs text-neutral-500">{transaction.description}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm font-medium text-neutral-900">
                              {transaction.type === 'WITHDRAWAL' ? '-' : ''}
                              {formatCurrency(transaction.amount)}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              transaction.status === 'COMPLETED' 
                                ? 'bg-green-100 text-green-800' 
                                : transaction.status === 'PENDING' 
                                  ? 'bg-yellow-100 text-yellow-800' 
                                  : 'bg-red-100 text-red-800'
                            }`}>
                              {transaction.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                            {formatDate(transaction.timestamp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <TransactionHistory />
          )}

          {activeTab === 'api' && (
            <ApiKeyManagement />
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="bg-bg-tertiary rounded-lg border border-border-subtle overflow-hidden shadow-elev-1">
                <div className="px-4 py-3 bg-bg-secondary border-b border-border-subtle">
                  <h3 className="font-semibold text-text-primary">Security Settings</h3>
                </div>
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <h4 className="font-medium">Two-Factor Authentication</h4>
                      <p className="text-sm text-neutral-500 mt-1">Secure your account with 2FA</p>
                    </div>
                    <button className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                      Enable
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <h4 className="font-medium">Change Password</h4>
                      <p className="text-sm text-neutral-500 mt-1">Update your account password</p>
                    </div>
                    <button className="px-3 py-1 bg-neutral-200 text-neutral-800 rounded-md hover:bg-neutral-300">
                      Update
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <h4 className="font-medium">Login History</h4>
                      <p className="text-sm text-neutral-500 mt-1">View your recent login activity</p>
                    </div>
                    <button className="px-3 py-1 bg-neutral-200 text-neutral-800 rounded-md hover:bg-neutral-300">
                      View
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Account;
