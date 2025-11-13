import React, { useEffect, useMemo, useState } from 'react';
import { Download, Upload, RefreshCw, Search, Filter, Download as DownloadIcon } from 'lucide-react';
import { formatTransactionDate, getUserDateFormat } from '../../utils/dateFormatter';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';

const TransactionHistory: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'deposit' | 'withdrawal' | 'trade'>('all');
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month' | 'quarter' | 'year'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
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

  // Format date for display - now uses AU/US format based on user preference
  const formatDate = (timestamp: number | string) => {
    try {
      const date = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
      const userFormat = getUserDateFormat();
      return formatTransactionDate(date, userFormat);
    } catch (error) {
      // console.error('Error formatting date:', error);
      return 'Invalid Date';
    }
  };
  
  // Local state for transactions from API
  const [rows, setRows] = useState<Array<{
    id: string;
    type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE';
    description: string;
    amount: number;
    status: 'COMPLETED' | 'PENDING' | 'FAILED';
    timestamp: number;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map backend bill to UI row
  const mapBillToRow = (b: any) => {
    const typeMap: Record<string, 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE'> = {
      deposit: 'DEPOSIT',
      withdrawal: 'WITHDRAWAL',
      trade: 'TRADE',
      fee: 'TRADE',
      funding: 'TRADE',
      transfer: 'TRADE',
    };
    const t = typeMap[b.type?.toLowerCase?.() || 'trade'] || 'TRADE';
    return {
      id: b.id || b.billId || String(Math.random()),
      type: t,
      description: `${b.symbol || b.currency || ''} ${b.type || 'Transaction'}`.trim(),
      amount: parseFloat(b.amount || b.amt || '0'),
      status: 'COMPLETED' as const,
      timestamp: b.timestamp || b.ts || Date.now(),
    };
  };

  // Load transactions from API on mount and when dateRange changes (to reduce payload)
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params: { startTime?: number; endTime?: number; limit?: number } = { limit: 200 };
        const now = Date.now();
        if (dateRange !== 'all') {
          let start = 0;
          if (dateRange === 'week') start = now - 7 * 24 * 60 * 60 * 1000;
          else if (dateRange === 'month') start = new Date(new Date().getFullYear(), new Date().getMonth() - 1, new Date().getDate()).getTime();
          else if (dateRange === 'quarter') start = new Date(new Date().getFullYear(), new Date().getMonth() - 3, new Date().getDate()).getTime();
          else if (dateRange === 'year') start = new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate()).getTime();
          params.startTime = start;
          params.endTime = now;
        }
        const token = getAccessToken();
        if (!token) {
          if (mounted) {
            setError('Please log in to view transactions');
            setLoading(false);
          }
          return;
        }

        const backendUrl = getBackendUrl();
        const queryParams = new URLSearchParams({ limit: params.limit?.toString() || '200' });
        
        if (params.startTime) queryParams.append('startTime', params.startTime.toString());
        if (params.endTime) queryParams.append('endTime', params.endTime.toString());

        const response = await fetch(`${backendUrl}/api/dashboard/bills?${queryParams}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch transactions: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && Array.isArray(result.data)) {
          const mapped = result.data.map(mapBillToRow);
          if (mounted) setRows(mapped);
        } else if (result.mock) {
          // No API credentials - show empty state
          if (mounted) {
            setRows([]);
            setError('Add your Poloniex API keys in Account → API Keys to view transaction history');
          }
        } else {
          throw new Error(result.error || 'Failed to load transactions');
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load transactions');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [dateRange]);

  // Filter transactions
  const filteredTransactions = useMemo(() => rows.filter(transaction => {
    // Filter by type
    if (filter !== 'all' && transaction.type.toLowerCase() !== filter.toLowerCase()) {
      return false;
    }
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        transaction.id.toLowerCase().includes(query) ||
        transaction.description.toLowerCase().includes(query) ||
        transaction.type.toLowerCase().includes(query) ||
        transaction.status.toLowerCase().includes(query)
      );
    }
    
    return true;
  }), [rows, filter, searchQuery]);
  
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center space-y-4 md:space-y-0">
        <div className="flex space-x-2">
          <button 
            onClick={() => setFilter('all')} 
            className={`px-3 py-1.5 text-sm rounded-md ${
              filter === 'all' 
                ? 'bg-blue-600 text-white' 
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            All
          </button>
          <button 
            onClick={() => setFilter('deposit')} 
            className={`px-3 py-1.5 text-sm rounded-md flex items-center ${
              filter === 'deposit' 
                ? 'bg-green-600 text-white' 
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            Deposits
          </button>
          <button 
            onClick={() => setFilter('withdrawal')} 
            className={`px-3 py-1.5 text-sm rounded-md flex items-center ${
              filter === 'withdrawal' 
                ? 'bg-red-600 text-white' 
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Withdrawals
          </button>
          <button 
            onClick={() => setFilter('trade')} 
            className={`px-3 py-1.5 text-sm rounded-md flex items-center ${
              filter === 'trade' 
                ? 'bg-blue-600 text-white' 
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Trades
          </button>
        </div>
        
        <div className="flex space-x-2">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search transactions..."
              className="pl-9 pr-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
          </div>
          
          <div className="relative">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as 'all' | 'week' | 'month' | 'year')}
              className="pl-9 pr-8 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
              aria-label="Filter transactions by date range"
              title="Filter transactions by date range"
            >
              <option value="all">All Time</option>
              <option value="week">Last Week</option>
              <option value="month">Last Month</option>
              <option value="quarter">Last Quarter</option>
              <option value="year">Last Year</option>
            </select>
            <Filter className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
          </div>
          
          <button className="flex items-center px-3 py-2 bg-neutral-100 text-neutral-700 rounded-md hover:bg-neutral-200">
            <DownloadIcon className="h-4 w-4 mr-1" />
            Export
          </button>
        </div>
      </div>
      
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Transaction ID
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Description
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
            <tbody className="bg-white divide-y divide-neutral-200">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-neutral-500">Loading transactions...</td>
                </tr>
              )}
              {error && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-red-600">{error}</td>
                </tr>
              )}
              {!loading && !error && filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-neutral-500">No transactions found</td>
                </tr>
              )}
              {!loading && !error && filteredTransactions.map((transaction) => (
                <tr key={transaction.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    {transaction.id}
                  </td>
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
      
      <div className="flex justify-between items-center">
        <div className="text-sm text-neutral-500">
          Showing {filteredTransactions.length} of {rows.length} transactions
        </div>
        <div className="flex">
          <button className="px-3 py-1 border border-neutral-300 rounded-l-md bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed">
            Previous
          </button>
          <button className="px-3 py-1 border border-neutral-300 border-l-0 rounded-r-md bg-white text-neutral-700 hover:bg-neutral-50">
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionHistory;