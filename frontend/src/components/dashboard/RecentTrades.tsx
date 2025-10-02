import React from 'react';
import { Trade } from '../../types';

interface RecentTradesProps {
  trades: Trade[];
}

const RecentTrades: React.FC<RecentTradesProps> = ({ trades }) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border-subtle">
        <thead className="bg-bg-secondary">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
              Pair
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
              Type
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
              Price
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
              Amount
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
              Total
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
              Time
            </th>
          </tr>
        </thead>
        <tbody className="bg-bg-tertiary divide-y divide-border-subtle">
          {trades.map(trade => (
            <tr key={trade.id} className="hover:bg-bg-secondary transition-colors">
              <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-text-primary">
                {trade.pair}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  trade.type === 'BUY' ? 'bg-success/10 text-success border border-success/20' : 'bg-error/10 text-error border border-error/20'
                }`}>
                  {trade.type}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-text-primary">
                ${trade.price.toFixed(2)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-text-primary">
                {trade.amount}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-text-primary">
                ${trade.total.toFixed(2)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  trade.status === 'COMPLETED' ? 'bg-success/10 text-success border border-success/20' : 
                  trade.status === 'PENDING' ? 'bg-warning/10 text-warning border border-warning/20' : 'bg-error/10 text-error border border-error/20'
                }`}>
                  {trade.status}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-text-secondary">
                {new Date(trade.timestamp).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {trades.length === 0 && (
        <div className="py-8 text-center text-text-muted">
          No recent trades
        </div>
      )}
    </div>
  );
};

export default RecentTrades;
