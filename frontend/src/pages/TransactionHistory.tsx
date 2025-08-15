import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Download, ArrowUpDown, FileText } from 'lucide-react';

interface Transaction {
  id: string;
  timestamp: Date;
  type: 'deposit' | 'withdrawal' | 'trade' | 'fee' | 'interest';
  currency: string;
  amount: number;
  status: 'completed' | 'pending' | 'failed';
  txHash?: string;
  description: string;
  balance: number;
}

interface TransactionFilters {
  startDate: string;
  endDate: string;
  currency: string;
  type: string;
  status: string;
}

const TransactionHistory: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>({
    startDate: '',
    endDate: '',
    currency: '',
    type: '',
    status: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState<keyof Transaction>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  // Generate mock transaction data
  useEffect(() => {
    const generateMockTransactions = (): Transaction[] => {
      const mockData: Transaction[] = [];
      const types: Transaction['type'][] = ['deposit', 'withdrawal', 'trade', 'fee', 'interest'];
      const currencies = ['USDT', 'BTC', 'ETH', 'ADA', 'DOT'];
      const statuses: Transaction['status'][] = ['completed', 'pending', 'failed'];

      for (let i = 0; i < 150; i++) {
        const type = types[Math.floor(Math.random() * types.length)];
        const currency = currencies[Math.floor(Math.random() * currencies.length)];
        const amount = type === 'fee' ? -Math.random() * 10 : (Math.random() - 0.5) * 1000;
        const timestamp = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);

        mockData.push({
          id: `txn_${i.toString().padStart(6, '0')}`,
          timestamp,
          type,
          currency,
          amount,
          status: statuses[Math.floor(Math.random() * statuses.length)],
          txHash: type === 'deposit' || type === 'withdrawal' ? 
            `0x${Math.random().toString(16).slice(2, 42)}` : undefined,
          description: getTransactionDescription(type, currency, amount),
          balance: 10000 + Math.random() * 50000
        });
      }

      return mockData.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    };

    setTransactions(generateMockTransactions());
  }, []);

  // Helper function to generate transaction descriptions
  const getTransactionDescription = (type: Transaction['type'], currency: string, amount: number): string => {
    switch (type) {
      case 'deposit':
        return `Deposit ${currency} to account`;
      case 'withdrawal':
        return `Withdraw ${currency} from account`;
      case 'trade':
        return `${amount > 0 ? 'Buy' : 'Sell'} ${currency}`;
      case 'fee':
        return `Trading fee for ${currency}`;
      case 'interest':
        return `Interest earned on ${currency}`;
      default:
        return `${type} transaction`;
    }
  };

  // Apply filters and search
  useEffect(() => {
    let filtered = [...transactions];

    // Apply search
    if (searchQuery) {
      filtered = filtered.filter(transaction => 
        transaction.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        transaction.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        transaction.currency.toLowerCase().includes(searchQuery.toLowerCase()) ||
        transaction.txHash?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply filters
    if (filters.startDate) {
      filtered = filtered.filter(transaction => 
        transaction.timestamp >= new Date(filters.startDate)
      );
    }

    if (filters.endDate) {
      filtered = filtered.filter(transaction => 
        transaction.timestamp <= new Date(filters.endDate + 'T23:59:59')
      );
    }

    if (filters.currency) {
      filtered = filtered.filter(transaction => 
        transaction.currency === filters.currency
      );
    }

    if (filters.type) {
      filtered = filtered.filter(transaction => 
        transaction.type === filters.type
      );
    }

    if (filters.status) {
      filtered = filtered.filter(transaction => 
        transaction.status === filters.status
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];

      if (aValue instanceof Date) aValue = aValue.getTime();
      if (bValue instanceof Date) bValue = bValue.getTime();

      if (sortDirection === 'asc') {
        return (aValue ?? 0) > (bValue ?? 0) ? 1 : -1;
      } else {
        return (aValue ?? 0) < (bValue ?? 0) ? 1 : -1;
      }
    });

    setFilteredTransactions(filtered);
    setCurrentPage(1);
  }, [transactions, searchQuery, filters, sortField, sortDirection]);

  // Pagination
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTransactions, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);

  const handleSort = (field: keyof Transaction) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const exportToCSV = () => {
    const csvData = filteredTransactions.map(transaction => ({
      ID: transaction.id,
      Date: transaction.timestamp.toISOString(),
      Type: transaction.type,
      Currency: transaction.currency,
      Amount: transaction.amount,
      Status: transaction.status,
      Description: transaction.description,
      Balance: transaction.balance,
      TxHash: transaction.txHash || ''
    }));

    const csvContent = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transaction-history-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeColor = (type: Transaction['type']) => {
    switch (type) {
      case 'deposit':
        return 'text-green-600';
      case 'withdrawal':
        return 'text-red-600';
      case 'trade':
        return 'text-blue-600';
      case 'fee':
        return 'text-orange-600';
      case 'interest':
        return 'text-purple-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <FileText className="w-8 h-8 mr-3 text-blue-600" />
          Transaction History
        </h1>
        <p className="mt-2 text-gray-600">
          View and manage your complete transaction history
        </p>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <Filter className="w-4 h-4 mr-2" />
              Filters
            </button>
            <button
              onClick={exportToCSV}
              disabled={filteredTransactions.length === 0}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        {showFilters && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 pt-4 border-t">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({...filters, startDate: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({...filters, endDate: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                value={filters.currency}
                onChange={(e) => setFilters({...filters, currency: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Currencies</option>
                <option value="USDT">USDT</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
                <option value="ADA">ADA</option>
                <option value="DOT">DOT</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({...filters, type: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Types</option>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="trade">Trade</option>
                <option value="fee">Fee</option>
                <option value="interest">Interest</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({...filters, status: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Transaction Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  { key: 'timestamp', label: 'Date/Time' },
                  { key: 'id', label: 'Transaction ID' },
                  { key: 'type', label: 'Type' },
                  { key: 'currency', label: 'Currency' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'status', label: 'Status' },
                  { key: 'description', label: 'Description' }
                ].map((header) => (
                  <th
                    key={header.key}
                    onClick={() => handleSort(header.key as keyof Transaction)}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  >
                    <div className="flex items-center">
                      {header.label}
                      <ArrowUpDown className="w-3 h-3 ml-1" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedTransactions.map((transaction) => (
                <tr key={transaction.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {transaction.timestamp.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                    {transaction.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`font-medium capitalize ${getTypeColor(transaction.type)}`}>
                      {transaction.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {transaction.currency}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`font-medium ${transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {transaction.amount >= 0 ? '+' : ''}{transaction.amount.toFixed(6)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(transaction.status)}`}>
                      {transaction.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {transaction.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-6 py-3 border-t border-gray-200 flex items-center justify-between">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing{' '}
                  <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span>
                  {' '}to{' '}
                  <span className="font-medium">
                    {Math.min(currentPage * itemsPerPage, filteredTransactions.length)}
                  </span>
                  {' '}of{' '}
                  <span className="font-medium">{filteredTransactions.length}</span>
                  {' '}results
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    const page = i + 1;
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                          currentPage === page
                            ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                            : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="mt-6 bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{filteredTransactions.length}</div>
            <div className="text-sm text-gray-500">Total Transactions</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {filteredTransactions.filter(t => t.amount > 0).length}
            </div>
            <div className="text-sm text-gray-500">Credits</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {filteredTransactions.filter(t => t.amount < 0).length}
            </div>
            <div className="text-sm text-gray-500">Debits</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {new Set(filteredTransactions.map(t => t.currency)).size}
            </div>
            <div className="text-sm text-gray-500">Currencies</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionHistory;