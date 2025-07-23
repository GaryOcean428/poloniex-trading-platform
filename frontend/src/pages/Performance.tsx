import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

interface PerformanceMetrics {
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgTradeReturn: number;
}

interface TradePerformanceData {
  date: string;
  pnl: number;
  cumulativePnL: number;
  trades: number;
}

const Performance: React.FC = () => {
  const [metrics, _setMetrics] = useState<PerformanceMetrics>({
    totalPnL: 1247.89,
    winRate: 68.5,
    totalTrades: 127,
    sharpeRatio: 1.42,
    maxDrawdown: -8.3,
    avgTradeReturn: 0.85
  });

  const [performanceData, _setPerformanceData] = useState<TradePerformanceData[]>([
    { date: '2024-01-01', pnl: 45.23, cumulativePnL: 45.23, trades: 3 },
    { date: '2024-01-02', pnl: -12.45, cumulativePnL: 32.78, trades: 2 },
    { date: '2024-01-03', pnl: 78.92, cumulativePnL: 111.70, trades: 4 },
    { date: '2024-01-04', pnl: 23.15, cumulativePnL: 134.85, trades: 3 },
    { date: '2024-01-05', pnl: -34.67, cumulativePnL: 100.18, trades: 2 },
    { date: '2024-01-06', pnl: 156.43, cumulativePnL: 256.61, trades: 5 },
    { date: '2024-01-07', pnl: 89.76, cumulativePnL: 346.37, trades: 4 }
  ]);

  const strategyBreakdown = [
    { name: 'Moving Average', value: 45.2, trades: 58 },
    { name: 'RSI Divergence', value: 28.7, trades: 34 },
    { name: 'Breakout', value: 18.3, trades: 22 },
    { name: 'Mean Reversion', value: 7.8, trades: 13 }
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

  return (
    <div className="min-h-screen bg-neutral-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 mb-2">Performance Analytics</h1>
          <p className="text-neutral-600">Comprehensive trading performance analysis and metrics</p>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <div className="bg-white rounded-lg p-4 border border-neutral-200">
            <h3 className="text-sm font-medium text-neutral-500 mb-1">Total P&L</h3>
            <p className="text-2xl font-bold text-green-600">
              ${metrics.totalPnL.toFixed(2)}
            </p>
          </div>
          
          <div className="bg-white rounded-lg p-4 border border-neutral-200">
            <h3 className="text-sm font-medium text-neutral-500 mb-1">Win Rate</h3>
            <p className="text-2xl font-bold text-blue-600">
              {metrics.winRate.toFixed(1)}%
            </p>
          </div>
          
          <div className="bg-white rounded-lg p-4 border border-neutral-200">
            <h3 className="text-sm font-medium text-neutral-500 mb-1">Total Trades</h3>
            <p className="text-2xl font-bold text-neutral-700">
              {metrics.totalTrades}
            </p>
          </div>
          
          <div className="bg-white rounded-lg p-4 border border-neutral-200">
            <h3 className="text-sm font-medium text-neutral-500 mb-1">Sharpe Ratio</h3>
            <p className="text-2xl font-bold text-purple-600">
              {metrics.sharpeRatio.toFixed(2)}
            </p>
          </div>
          
          <div className="bg-white rounded-lg p-4 border border-neutral-200">
            <h3 className="text-sm font-medium text-neutral-500 mb-1">Max Drawdown</h3>
            <p className="text-2xl font-bold text-red-600">
              {metrics.maxDrawdown.toFixed(1)}%
            </p>
          </div>
          
          <div className="bg-white rounded-lg p-4 border border-neutral-200">
            <h3 className="text-sm font-medium text-neutral-500 mb-1">Avg Trade Return</h3>
            <p className="text-2xl font-bold text-emerald-600">
              {metrics.avgTradeReturn.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* P&L Chart */}
          <div className="bg-white rounded-lg p-6 border border-neutral-200">
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Cumulative P&L</h2>
            <div className="h-64">
              <LineChart
                width={500}
                height={250}
                data={performanceData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="cumulativePnL" 
                  stroke="#10B981" 
                  strokeWidth={2}
                  name="Cumulative P&L"
                />
              </LineChart>
            </div>
          </div>

          {/* Daily P&L Chart */}
          <div className="bg-white rounded-lg p-6 border border-neutral-200">
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Daily P&L</h2>
            <div className="h-64">
              <BarChart
                width={500}
                height={250}
                data={performanceData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar 
                  dataKey="pnl" 
                  fill="#3B82F6"
                  name="Daily P&L"
                />
              </BarChart>
            </div>
          </div>
        </div>

        {/* Strategy Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Strategy Performance Pie Chart */}
          <div className="bg-white rounded-lg p-6 border border-neutral-200">
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Strategy Breakdown</h2>
            <div className="h-64 flex justify-center">
              <PieChart width={400} height={250}>
                <Pie
                  data={strategyBreakdown}
                  cx={200}
                  cy={125}
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {strategyBreakdown.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </div>
          </div>

          {/* Strategy Details Table */}
          <div className="bg-white rounded-lg p-6 border border-neutral-200">
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Strategy Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <th className="text-left py-2 text-neutral-700">Strategy</th>
                    <th className="text-right py-2 text-neutral-700">P&L</th>
                    <th className="text-right py-2 text-neutral-700">Trades</th>
                    <th className="text-right py-2 text-neutral-700">Avg Return</th>
                  </tr>
                </thead>
                <tbody>
                  {strategyBreakdown.map((strategy, index) => (
                    <tr key={strategy.name} className="border-b border-neutral-100">
                      <td className="py-2 flex items-center">
                        <div 
                          className="w-3 h-3 rounded-full mr-2"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        ></div>
                        {strategy.name}
                      </td>
                      <td className="text-right py-2 text-green-600 font-medium">
                        ${strategy.value.toFixed(2)}
                      </td>
                      <td className="text-right py-2 text-neutral-700">
                        {strategy.trades}
                      </td>
                      <td className="text-right py-2 text-blue-600">
                        {(strategy.value / strategy.trades).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Performance;