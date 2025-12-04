import axios from 'axios';
import { getAccessToken, getRefreshToken } from '@/utils/auth';

// Auto-detect API base URL based on environment
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app'
    : 'http://localhost:3000');

export interface Balance {
  totalBalance: number;
  availableBalance: number;
  marginBalance: number;
  unrealizedPnL: number;
  currency: string;
}

export interface Position {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  notionalValue: string;
  leverage: number;
  marginType: string;
  isolatedMargin: string;
  positionSide: string;
}

export interface Trade {
  id: string;
  symbol: string;
  orderId: string;
  side: 'BUY' | 'SELL';
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
}

export interface Order {
  orderId: string;
  symbol: string;
  status: string;
  type: string;
  side: 'BUY' | 'SELL';
  price: string;
  origQty: string;
  executedQty: string;
  time: number;
}

export interface DashboardOverview {
  balance: Balance | null;
  positions: Position[];
  positionsSummary: {
    totalPositions: number;
    totalValue: number;
    totalPnL: number;
  };
  recentTrades: Trade[];
  tradesSummary: {
    count: number;
    last24h: number;
  };
  openOrders: Order[];
  ordersSummary: {
    count: number;
  };
}

export interface DashboardResponse {
  success: boolean;
  timestamp: string;
  data: DashboardOverview;
  errors?: {
    balance?: string | null;
    positions?: string | null;
    trades?: string | null;
    orders?: string | null;
  };
}

class DashboardService {
  private async getAuthHeaders(): Promise<Record<string, string>> {
    let token = getAccessToken();

    // Check if token is expired (basic check - decode JWT and check exp)
    if (token) {
      try {
        const tokenParts = token.split('.');
        if (tokenParts.length === 3 && tokenParts[1]) {
          const payload = JSON.parse(atob(tokenParts[1]));
          const isExpired = payload.exp * 1000 < Date.now();

          if (isExpired) {
            // console.log('Token expired, attempting refresh...');
            // Try to refresh token
            const refreshToken = getRefreshToken();
            if (refreshToken) {
              try {
                const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
                  refreshToken
                });

                // Handle refresh response - supports both formats
                const { token: newToken, accessToken, refreshToken: newRefreshToken } = response.data;
                const actualNewToken = newToken || accessToken;

                if (actualNewToken) {
                  token = actualNewToken;
                  // Store new tokens
                  localStorage.setItem('access_token', actualNewToken);
                  // Clean up legacy token key
                  localStorage.removeItem('auth_token');
                  // Update refresh token if provided
                  if (newRefreshToken) {
                    localStorage.setItem('refresh_token', newRefreshToken);
                  }
                } else {
                  // console.error('Token refresh failed: no token in response');
                  token = null;
                }
              } catch (_refreshError) {
                // console.error('Token refresh request failed:', refreshError);
                token = null;
              }
            } else {
              // No refresh token, clear expired token
              // console.warn('No refresh token available, user needs to re-login');
              localStorage.removeItem('access_token');
              localStorage.removeItem('auth_token');
              token = null;
            }
          }
        }
      } catch (_error) {
        // console.error('Error checking token expiration:', error);
      }
    }
    
    return {
      'Authorization': `Bearer ${token || ''}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get complete dashboard overview
   */
  async getOverview(): Promise<DashboardResponse> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.get<DashboardResponse>(
        `${API_BASE_URL}/api/dashboard/overview`,
        { headers }
      );
      return response.data;
    } catch (error: any) {
      // console.error('Error fetching dashboard overview:', error);
      throw new Error(error.response?.data?.error || 'Failed to fetch dashboard data');
    }
  }

  /**
   * Get just account balance (lightweight)
   */
  async getBalance(): Promise<Balance> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.get(
        `${API_BASE_URL}/api/dashboard/balance`,
        { headers }
      );
      return response.data.data;
    } catch (error: any) {
      // console.error('Error fetching balance:', error);
      throw new Error(error.response?.data?.error || 'Failed to fetch balance');
    }
  }

  /**
   * Get active positions with summary
   */
  async getPositions(): Promise<{ positions: Position[]; summary: any }> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.get(
        `${API_BASE_URL}/api/dashboard/positions`,
        { headers }
      );
      return response.data.data;
    } catch (error: any) {
      // console.error('Error fetching positions:', error);
      throw new Error(error.response?.data?.error || 'Failed to fetch positions');
    }
  }

  /**
   * Get trade history
   */
  async getTrades(params?: { symbol?: string; limit?: number }): Promise<Trade[]> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.get(
        `${API_BASE_URL}/api/futures/trades`,
        { 
          headers,
          params
        }
      );
      return response.data;
    } catch (error: any) {
      // console.error('Error fetching trades:', error);
      throw new Error(error.response?.data?.error || 'Failed to fetch trades');
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(symbol?: string): Promise<Order[]> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.get(
        `${API_BASE_URL}/api/futures/orders`,
        { 
          headers,
          params: { status: 'NEW', symbol }
        }
      );
      return response.data;
    } catch (error: any) {
      // console.error('Error fetching open orders:', error);
      throw new Error(error.response?.data?.error || 'Failed to fetch open orders');
    }
  }
}

export const dashboardService = new DashboardService();
export default dashboardService;
