/**
 * Mock Trading Service
 * Simulates trading operations without real API calls
 * Used for testing and development
 */
export class MockTradingService {
    constructor() {
        this.mockPrices = new Map();
        this.mockOrders = new Map();
        this.orderIdCounter = 1;
        // Initialize mock prices
        this.mockPrices.set('BTC-USDT', 45000);
        this.mockPrices.set('ETH-USDT', 2500);
        this.mockPrices.set('SOL-USDT', 100);
        this.mockPrices.set('MATIC-USDT', 0.85);
    }
    /**
     * Get current price for a trading pair
     */
    async getCurrentPrice(symbol) {
        // Simulate API delay
        await this.delay(100);
        const basePrice = this.mockPrices.get(symbol) || 1000;
        // Add random price fluctuation (±2%)
        const fluctuation = (Math.random() - 0.5) * 0.04;
        return basePrice * (1 + fluctuation);
    }
    /**
     * Place a market order
     */
    async placeMarketOrder(params) {
        await this.delay(200);
        const orderId = `MOCK_${this.orderIdCounter++}`;
        const price = await this.getCurrentPrice(params.symbol);
        const total = price * params.amount;
        const order = {
            id: orderId,
            symbol: params.symbol,
            side: params.side,
            type: 'market',
            amount: params.amount,
            price,
            total,
            status: 'filled',
            timestamp: new Date().toISOString()
        };
        this.mockOrders.set(orderId, order);
        return order;
    }
    /**
     * Place a limit order
     */
    async placeLimitOrder(params) {
        await this.delay(200);
        const orderId = `MOCK_${this.orderIdCounter++}`;
        const total = params.price * params.amount;
        const order = {
            id: orderId,
            symbol: params.symbol,
            side: params.side,
            type: 'limit',
            amount: params.amount,
            price: params.price,
            total,
            status: 'open',
            timestamp: new Date().toISOString()
        };
        this.mockOrders.set(orderId, order);
        // Simulate order fill after random delay (50% chance)
        setTimeout(() => {
            if (Math.random() > 0.5) {
                order.status = 'filled';
            }
        }, Math.random() * 5000 + 1000);
        return order;
    }
    /**
     * Cancel an order
     */
    async cancelOrder(orderId) {
        await this.delay(100);
        const order = this.mockOrders.get(orderId);
        if (order && order.status === 'open') {
            order.status = 'cancelled';
            return true;
        }
        return false;
    }
    /**
     * Get order status
     */
    async getOrderStatus(orderId) {
        await this.delay(50);
        return this.mockOrders.get(orderId) || null;
    }
    /**
     * Get account balance
     */
    async getBalance() {
        await this.delay(100);
        return {
            USDT: {
                free: 10000,
                used: 0,
                total: 10000
            },
            BTC: {
                free: 0.5,
                used: 0,
                total: 0.5
            },
            ETH: {
                free: 5,
                used: 0,
                total: 5
            }
        };
    }
    /**
     * Get historical candles
     */
    async getCandles(params) {
        await this.delay(300);
        const limit = params.limit || 100;
        const basePrice = this.mockPrices.get(params.symbol) || 1000;
        const candles = [];
        for (let i = 0; i < limit; i++) {
            const timestamp = Date.now() - (limit - i) * 60000; // 1 minute intervals
            const open = basePrice * (1 + (Math.random() - 0.5) * 0.05);
            const close = open * (1 + (Math.random() - 0.5) * 0.03);
            const high = Math.max(open, close) * (1 + Math.random() * 0.02);
            const low = Math.min(open, close) * (1 - Math.random() * 0.02);
            const volume = Math.random() * 1000;
            candles.push({
                timestamp,
                open,
                high,
                low,
                close,
                volume
            });
        }
        return candles;
    }
    /**
     * Get ticker information
     */
    async getTicker(symbol) {
        await this.delay(50);
        const price = await this.getCurrentPrice(symbol);
        const change24h = (Math.random() - 0.5) * 0.1; // ±10%
        return {
            symbol,
            last: price,
            bid: price * 0.9995,
            ask: price * 1.0005,
            high24h: price * (1 + Math.abs(change24h)),
            low24h: price * (1 - Math.abs(change24h)),
            volume24h: Math.random() * 1000000,
            change24h: change24h * 100,
            timestamp: Date.now()
        };
    }
    /**
     * Simulate API delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Reset mock data
     */
    reset() {
        this.mockOrders.clear();
        this.orderIdCounter = 1;
    }
}
// Singleton instance
export const mockTradingService = new MockTradingService();
