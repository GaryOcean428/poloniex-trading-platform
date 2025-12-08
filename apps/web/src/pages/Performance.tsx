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
  // Initialize with null to indicate no data available
  // In production, this should fetch from API
  const [metrics, _setMetrics] = useState<PerformanceMetrics | null>(null);
  const [performanceData, _setPerformanceData] = useState<TradePerformanceData[]>([]);
  const [strategyBreakdown] = useState<{ name: string; value: number; trades: number }[]>([]);

  const CHART_COLORS = {
    primary: '#06b6d4',
    secondary: '#8b5cf6', 
    warning: '#f59e0b',
    error: '#ef4444',
    success: '#10b981',
    info: '#3b82f6'
  };

  // Show message if no data available
  if (!metrics || performanceData.length === 0) {
    return (
      <div className="min-h-screen bg-bg-primary p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-text-primary mb-2">Performance Analytics</h1>
            <p className="text-text-secondary">Comprehensive trading performance analysis and metrics</p>
          </div>

          {/* No Data Message */}
          <div className="bg-bg-tertiary rounded-lg p-12 border border-border-subtle shadow-elev-1 text-center">
            <h2 className="text-2xl font-semibold text-text-primary mb-4">No Performance Data Available</h2>
            <p className="text-text-secondary mb-6">
              Performance metrics will appear here once you have completed trades with real or paper trading accounts.
            </p>
            <p className="text-sm text-text-muted">
              Configure your API credentials in Settings to enable live or paper trading.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">Performance Analytics</h1>
          <p className="text-text-secondary">Comprehensive trading performance analysis and metrics</p>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <div className="bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
            <h3 className="text-sm font-medium text-text-muted mb-1">Total P&L</h3>
            <p className="text-2xl font-bold text-green-600">
              ${metrics.totalPnL.toFixed(2)}
            </p>
          </div>
          
          <div className="bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
            <h3 className="text-sm font-medium text-text-muted mb-1">Win Rate</h3>
            <p className="text-2xl font-bold text-brand-cyan">
              {metrics.winRate.toFixed(1)}%
            </p>
          </div>
          
          <div className="bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
            <h3 className="text-sm font-medium text-text-muted mb-1">Total Trades</h3>
            <p className="text-2xl font-bold text-text-primary">
              {metrics.totalTrades}
            </p>
          </div>
          
          <div className="bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
            <h3 className="text-sm font-medium text-text-muted mb-1">Sharpe Ratio</h3>
            <p className="text-2xl font-bold text-purple-600">
              {metrics.sharpeRatio.toFixed(2)}
            </p>
          </div>
          
          <div className="bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
            <h3 className="text-sm font-medium text-text-muted mb-1">Max Drawdown</h3>
            <p className="text-2xl font-bold text-red-600">
              {metrics.maxDrawdown.toFixed(1)}%
            </p>
          </div>
          
          <div className="bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
            <h3 className="text-sm font-medium text-text-muted mb-1">Avg Trade Return</h3>
            <p className="text-2xl font-bold text-green-600">
              {metrics.avgTradeReturn.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* P&L Chart */}
          <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
            <h2 className="text-xl font-semibold text-text-primary mb-4">Cumulative P&L</h2>
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
                  stroke={CHART_COLORS.success}
                  strokeWidth={2}
                  name="Cumulative P&L"
                />
              </LineChart>
            </div>
          </div>

          {/* Daily P&L Chart */}
          <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
            <h2 className="text-xl font-semibold text-text-primary mb-4">Daily P&L</h2>
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
                  fill={CHART_COLORS.info}
                  name="Daily P&L"
                />
              </BarChart>
            </div>
          </div>
        </div>

        {/* Strategy Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Strategy Performance Pie Chart */}
          <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
            <h2 className="text-xl font-semibold text-text-primary mb-4">Strategy Breakdown</h2>
            <div className="h-64 flex justify-center">
              <PieChart width={400} height={250}>
                <Pie
                  data={strategyBreakdown}
                  cx={200}
                  cy={125}
                  labelLine={false}
                  label={({ name, percent }) => {
                    const p = (percent as number) ?? 0;
                    return `${name} ${(p * 100).toFixed(0)}%`;
                  }}
                  outerRadius={80}
                  fill={CHART_COLORS.info}
                  dataKey="value"
                >
                  {strategyBreakdown.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={Object.values(CHART_COLORS)[index % Object.values(CHART_COLORS).length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </div>
          </div>

          {/* Strategy Details Table */}
          <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
            <h2 className="text-xl font-semibold text-text-primary mb-4">Strategy Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-moderate">
                    <th className="text-left py-2 text-text-secondary">Strategy</th>
                    <th className="text-right py-2 text-text-secondary">P&L</th>
                    <th className="text-right py-2 text-text-secondary">Trades</th>
                    <th className="text-right py-2 text-text-secondary">Avg Return</th>
                  </tr>
                </thead>
                <tbody>
                  {strategyBreakdown.map((strategy, index) => (
                    <tr key={strategy.name} className="border-b border-border-subtle">
                      <td className="py-2 flex items-center">
                        <div 
                          className="w-3 h-3 rounded-full mr-2"
                          style={{ backgroundColor: Object.values(CHART_COLORS)[index % Object.values(CHART_COLORS).length] }}
                        ></div>
                        {strategy.name}
                      </td>
                      <td className="text-right py-2 text-green-600 font-medium">
                        ${strategy.value.toFixed(2)}
                      </td>
                      <td className="text-right py-2 text-text-primary">
                        {strategy.trades}
                      </td>
                      <td className="text-right py-2 text-brand-cyan">
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
