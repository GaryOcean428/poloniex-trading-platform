import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  BarElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
  ChartOptions
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { MarketData } from '../../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  BarElement,
  Filler,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

interface PriceChartProps {
  data: MarketData[];
  pair: string;
  type?: 'line' | 'candlestick';
  timeframe?: '1h' | '4h' | '1d';
}

const PriceChart: React.FC<PriceChartProps> = ({ data, pair }) => {
  const filteredData = data.filter(item => item.pair === pair);
  
  const labels = filteredData.map(item => {
    const date = new Date(item.timestamp);
    return date.toLocaleTimeString();
  });
  
  const chartData = {
    labels,
    datasets: [
      {
        label: `${pair} Price`,
        data: filteredData.map(item => item.close),
        fill: true,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        tension: 0.2,
      },
      {
        label: 'Volume',
        data: filteredData.map(item => item.volume),
        type: 'bar',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderColor: 'rgba(59, 130, 246, 0.2)',
        yAxisID: 'volume'
      },
    ],
  };
  
  const options: ChartOptions<'line'> = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const dataIndex = context.dataIndex;
            const dataPoint = filteredData[dataIndex];
            return [
              `Price: $${dataPoint.close.toFixed(2)}`,
              `High: $${dataPoint.high.toFixed(2)}`,
              `Low: $${dataPoint.low.toFixed(2)}`,
              `Volume: ${dataPoint.volume.toFixed(2)}`
            ];
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: false,
        position: 'left',
        grid: {
          display: true
        }
      },
      volume: {
        position: 'right',
        grid: {
          display: false
        }
      }
    },
  };
  
  return <Line options={options} data={chartData} height={80} />;
};

export default PriceChart;