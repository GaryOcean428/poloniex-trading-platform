import React, { useState } from 'react';
import { Download, Upload, RefreshCw, Search, Filter, Download as DownloadIcon } from 'lucide-react';
import { mockTransactions } from '../../data/mockData';

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
  
  // Filter transactions
  const filteredTransactions = mockTransactions.filter(transaction => {
    // Filter by type
    if (filter !== 'all' && transaction.type.toLowerCase() !== filter.toLowerCase()) {
      return false;
    }
    
    // Filter by date range
    if (dateRange !== 'all') {
      const now = new Date();
      const transactionDate = new Date(transaction.timestamp);
      
      if (dateRange === 'week') {
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (transactionDate < oneWeekAgo) return false;
      } else if (dateRange === 'month') {
        const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        if (transactionDate < oneMonthAgo) return false;
      } else if (dateRange === 'quarter') {
        const oneQuarterAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        if (transactionDate < oneQuarterAgo) return false;
      } else if (dateRange === 'year') {
        const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        if (transactionDate < oneYearAgo) return false;
      }
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
  });
  
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
              onChange={(e) => setDateRange(e.target.value as any)}
              className="pl-9 pr-8 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
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
              {filteredTransactions.map((transaction) => (
                <tr key={transaction.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    <span className="font-mono">{transaction.id}</span>
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
                      <div className="text-sm font-medium text-neutral-900">
                        {transaction.type}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    {transaction.description}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className={`text-sm font-medium ${
                      transaction.type === 'WITHDRAWAL' 
                        ? 'text-red-600' 
                        : transaction.type === 'DEPOSIT'
                          ? 'text-green-600'
                          : 'text-neutral-900'
                    }`}>
                      {transaction.type === 'WITHDRAWAL' ? '-' : transaction.type === 'DEPOSIT' ? '+' : ''}
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
                    {new Date(transaction.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
              
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    No transactions found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="flex justify-between items-center">
        <div className="text-sm text-neutral-500">
          Showing {filteredTransactions.length} of {mockTransactions.length} transactions
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