import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Download, TrendingUp, TrendingDown, ArrowUpDown, BarChart3 } from 'lucide-react';

interface TradeHistoryItem {
  id: string;
  timestamp: Date;
  pair: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  amount: number;
  price: number;
  total: number;
  fee: number;
  feeCurrency: string;
  pnl?: number;
  strategy?: string;
  orderId: string;
  status: 'filled' | 'partial' | 'cancelled';
}

interface TradeFilters {
  startDate: string;
  endDate: string;
  pair: string;
  side: string;
  strategy: string;
}

const TradeHistory: React.FC = () => {
  const [trades, setTrades] = useState<TradeHistoryItem[]>([]);
  const [filteredTrades, setFilteredTrades] = useState<TradeHistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<TradeFilters>({
    startDate: '',
    endDate: '',
    pair: '',
    side: '',
    strategy: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState<keyof TradeHistoryItem>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  // Generate mock trade data
  useEffect(() => {
    const generateMockTrades = (): TradeHistoryItem[] => {
      const mockData: TradeHistoryItem[] = [];
      const pairs = ['BTC-USDT', 'ETH-USDT', 'ADA-USDT', 'DOT-USDT', 'SOL-USDT'];
      const strategies = ['MA Crossover', 'RSI Divergence', 'Breakout', 'Mean Reversion', 'Manual'];
      const sides: ('buy' | 'sell')[] = ['buy', 'sell'];
      const types: ('market' | 'limit')[] = ['market', 'limit'];
      const statuses: TradeHistoryItem['status'][] = ['filled', 'partial', 'cancelled'];

      for (let i = 0; i < 200; i++) {
        const pair = pairs[Math.floor(Math.random() * pairs.length)];
        const side = sides[Math.floor(Math.random() * sides.length)];
        const type = types[Math.floor(Math.random() * types.length)];
        const amount = Math.random() * 10;
        const price = getBasePrice(pair) * (0.9 + Math.random() * 0.2);
        const total = amount * price;
        const fee = total * 0.001; // 0.1% fee
        const strategy = strategies[Math.floor(Math.random() * strategies.length)];
        const timestamp = new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000);

        mockData.push({
          id: `trade_${i.toString().padStart(6, '0')}`,
          timestamp,
          pair,
          side,
          type,
          amount,
          price,
          total,
          fee,
          feeCurrency: 'USDT',
          pnl: (Math.random() - 0.5) * total * 0.1, // Random P&L
          strategy,
          orderId: `order_${Math.random().toString(36).substr(2, 9)}`,
          status: statuses[Math.floor(Math.random() * statuses.length)]
        });
      }

      return mockData.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    };

    setTrades(generateMockTrades());
  }, []);

  const getBasePrice = (pair: string): number => {
    const basePrices: { [key: string]: number } = {
      'BTC-USDT': 43000,
      'ETH-USDT': 2500,
      'ADA-USDT': 0.45,
      'DOT-USDT': 6.5,
      'SOL-USDT': 80
    };
    return basePrices[pair] || 100;
  };

  // Apply filters and search
  useEffect(() => {
    const filtered = [...trades];

    // Apply search
    if (searchQuery) {
      filtered = filtered.filter(trade => 
        trade.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        trade.pair.toLowerCase().includes(searchQuery.toLowerCase()) ||
        trade.strategy?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        trade.orderId.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply filters
    if (filters.startDate) {
      filtered = filtered.filter(trade => 
        trade.timestamp >= new Date(filters.startDate)
      );
    }

    if (filters.endDate) {
      filtered = filtered.filter(trade => 
        trade.timestamp <= new Date(filters.endDate + 'T23:59:59')
      );
    }

    if (filters.pair) {
      filtered = filtered.filter(trade => trade.pair === filters.pair);
    }

    if (filters.side) {
      filtered = filtered.filter(trade => trade.side === filters.side);
    }

    if (filters.strategy) {
      filtered = filtered.filter(trade => trade.strategy === filters.strategy);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      if (aValue instanceof Date) aValue = aValue.getTime();
      if (bValue instanceof Date) bValue = bValue.getTime();

      if (sortDirection === 'asc') {
        return (aValue ?? 0) > (bValue ?? 0) ? 1 : -1;
      } else {
        return (aValue ?? 0) < (bValue ?? 0) ? 1 : -1;
      }
    });

    setFilteredTrades(filtered);
    setCurrentPage(1);
  }, [trades, searchQuery, filters, sortField, sortDirection]);

  // Pagination
  const paginatedTrades = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTrades.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTrades, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredTrades.length / itemsPerPage);

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const totalTrades = filteredTrades.length;
    const totalVolume = filteredTrades.reduce((sum, trade) => sum + trade.total, 0);
    const totalPnL = filteredTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    const totalFees = filteredTrades.reduce((sum, trade) => sum + trade.fee, 0);
    const winningTrades = filteredTrades.filter(trade => (trade.pnl || 0) > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    return {
      totalTrades,
      totalVolume,
      totalPnL,
      totalFees,
      winRate
    };
  }, [filteredTrades]);

  const handleSort = (field: keyof TradeHistoryItem) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const exportToCSV = () => {
    const csvData = filteredTrades.map(trade => ({
      ID: trade.id,
      Date: trade.timestamp.toISOString(),
      Pair: trade.pair,
      Side: trade.side,
      Type: trade.type,
      Amount: trade.amount,
      Price: trade.price,
      Total: trade.total,
      Fee: trade.fee,
      PnL: trade.pnl || 0,
      Strategy: trade.strategy || '',
      OrderID: trade.orderId,
      Status: trade.status
    }));

    const csvContent = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trade-history-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (status: TradeHistoryItem['status']) => {
    switch (status) {
      case 'filled':
        return 'bg-green-100 text-green-800';
      case 'partial':
        return 'bg-yellow-100 text-yellow-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <BarChart3 className="w-8 h-8 mr-3 text-blue-600" />
          Trade History
        </h1>
        <p className="mt-2 text-gray-600">
          Complete history of your trading activity and performance
        </p>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-2xl font-bold text-gray-900">{summaryStats.totalTrades}</div>
          <div className="text-sm text-gray-500">Total Trades</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-2xl font-bold text-blue-600">
            ${summaryStats.totalVolume.toFixed(0)}
          </div>
          <div className="text-sm text-gray-500">Total Volume</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className={`text-2xl font-bold ${summaryStats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {summaryStats.totalPnL >= 0 ? '+' : ''}${summaryStats.totalPnL.toFixed(2)}
          </div>
          <div className="text-sm text-gray-500">Total P&L</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-2xl font-bold text-orange-600">
            ${summaryStats.totalFees.toFixed(2)}
          </div>
          <div className="text-sm text-gray-500">Total Fees</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className={`text-2xl font-bold ${summaryStats.winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
            {summaryStats.winRate.toFixed(1)}%
          </div>
          <div className="text-sm text-gray-500">Win Rate</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search trades..."
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
              disabled={filteredTrades.length === 0}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Trading Pair</label>
              <select
                value={filters.pair}
                onChange={(e) => setFilters({...filters, pair: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Pairs</option>
                <option value="BTC-USDT">BTC-USDT</option>
                <option value="ETH-USDT">ETH-USDT</option>
                <option value="ADA-USDT">ADA-USDT</option>
                <option value="DOT-USDT">DOT-USDT</option>
                <option value="SOL-USDT">SOL-USDT</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Side</label>
              <select
                value={filters.side}
                onChange={(e) => setFilters({...filters, side: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Sides</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Strategy</label>
              <select
                value={filters.strategy}
                onChange={(e) => setFilters({...filters, strategy: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Strategies</option>
                <option value="MA Crossover">MA Crossover</option>
                <option value="RSI Divergence">RSI Divergence</option>
                <option value="Breakout">Breakout</option>
                <option value="Mean Reversion">Mean Reversion</option>
                <option value="Manual">Manual</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Trade Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  { key: 'timestamp', label: 'Date/Time' },
                  { key: 'pair', label: 'Pair' },
                  { key: 'side', label: 'Side' },
                  { key: 'type', label: 'Type' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'price', label: 'Price' },
                  { key: 'total', label: 'Total' },
                  { key: 'fee', label: 'Fee' },
                  { key: 'pnl', label: 'P&L' },
                  { key: 'strategy', label: 'Strategy' },
                  { key: 'status', label: 'Status' }
                ].map((header) => (
                  <th
                    key={header.key}
                    onClick={() => handleSort(header.key as keyof TradeHistoryItem)}
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
              {paginatedTrades.map((trade) => (
                <tr key={trade.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {trade.timestamp.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {trade.pair}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center">
                      {trade.side === 'buy' ? (
                        <TrendingUp className="w-4 h-4 text-green-600 mr-1" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-600 mr-1" />
                      )}
                      <span className={`font-medium ${trade.side === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                        {trade.side.toUpperCase()}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 capitalize">
                    {trade.type}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {trade.amount.toFixed(6)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${trade.price.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${trade.total.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-orange-600">
                    ${trade.fee.toFixed(4)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {trade.pnl !== undefined && (
                      <span className={`font-medium ${trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {trade.strategy}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(trade.status)}`}>
                      {trade.status}
                    </span>
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
                    {Math.min(currentPage * itemsPerPage, filteredTrades.length)}
                  </span>
                  {' '}of{' '}
                  <span className="font-medium">{filteredTrades.length}</span>
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
    </div>
  );
};

export default TradeHistory;