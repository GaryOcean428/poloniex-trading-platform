import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';

export interface PaperTradingConfig {
  initialBalance: number;
  maxLeverage: number;
  maintenanceMargin: number;
  minOrderSize: number;
  maxPositions: number;
  fees: {
    maker: number;
    taker: number;
    liquidation: number;
  };
}

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  margin: number;
  leverage: number;
  entryPrice: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  timestamp: Date;
}

export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'takeProfit';
  size: number;
  price?: number;
  stopPrice?: number;
  leverage: number;
  status: 'created' | 'filled' | 'cancelled' | 'rejected';
  timestamp: Date;
  fee?: number;
}

export class PaperBalanceManager {
  private balance: number = 10000;
  private lockedMargin: number = 0;

  constructor(initialBalance?: number) {
    if (initialBalance && initialBalance > 0) {
      this.balance = initialBalance;
    }
  }

  getBalance(): number {
    return this.balance;
  }

  getAvailableBalance(): number {
    return this.balance - this.lockedMargin;
  }

  lockMargin(amount: number): boolean {
    if (amount <= 0) {
      throw new Error('Margin amount must be positive');
    }
    
    if (amount > this.getAvailableBalance()) {
      return false;
    }
    
    this.lockedMargin += amount;
    return true;
  }

  releaseMargin(amount: number): void {
    if (amount <= 0) {
      throw new Error('Margin amount must be positive');
    }
    
    if (amount > this.lockedMargin) {
      throw new Error('Cannot release more margin than locked');
    }
    
    this.lockedMargin -= amount;
  }

  addPnL(amount: number): void {
    this.balance += amount;
  }

  deductFee(amount: number): void {
    if (amount <= 0) {
      throw new Error('Fee amount must be positive');
    }
    
    this.balance -= amount;
  }

  async reset(initialBalance?: number): Promise<void> {
    this.balance = initialBalance || 10000;
    this.lockedMargin = 0;
  }
}

export class PaperPositionManager extends EventEmitter {
  private positions: Map<string, Position> = new Map();

  constructor() {
    super();
  }

  openPosition(position: Position): void {
    if (this.positions.has(position.symbol)) {
      throw new Error(`Position already exists for ${position.symbol}`);
    }
    
    // Calculate liquidation price
    const liquidationPrice = this.calculateLiquidationPrice(position);
    
    const newPosition = {
      ...position,
      liquidationPrice
    };
    
    this.positions.set(position.symbol, newPosition);
    this.emit('positionOpened', newPosition);
  }

  updatePosition(symbol: string, currentPrice: number): void {
    const position = this.positions.get(symbol);
    if (!position) return;
    
    // Calculate unrealized PnL
    const unrealizedPnl = this.calculateUnrealizedPnl(position, currentPrice);
    const unrealizedPnlPercent = (unrealizedPnl / (position.size * position.entryPrice)) * 100;
    
    const updatedPosition = {
      ...position,
      unrealizedPnl,
      unrealizedPnlPercent
    };
    
    this.positions.set(symbol, updatedPosition);
    this.emit('positionUpdated', updatedPosition);
    
    // Check for liquidation
    if (this.shouldLiquidate(updatedPosition, currentPrice)) {
      this.liquidatePosition(symbol, currentPrice);
    }
  }

  closePosition(symbol: string, closePrice: number): void {
    const position = this.positions.get(symbol);
    if (!position) {
      throw new Error(`No position found for ${symbol}`);
    }
    
    const pnl = this.calculatePnl(position, closePrice);
    
    this.positions.delete(symbol);
    this.emit('positionClosed', { symbol, pnl });
  }

  liquidatePosition(symbol: string, liquidationPrice: number): void {
    const position = this.positions.get(symbol);
    if (!position) return;
    
    this.positions.delete(symbol);
    this.emit('positionLiquidated', { ...position, liquidationPrice });
  }

  getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  reset(): void {
    this.positions.clear();
  }

  private calculateLiquidationPrice(position: Position): number {
    const { side, entryPrice, leverage } = position;
    const maintenanceMargin = 0.005; // 0.5%
    
    if (side === 'long') {
      return entryPrice * (1 - (1 / leverage) + maintenanceMargin);
    } else {
      return entryPrice * (1 + (1 / leverage) - maintenanceMargin);
    }
  }

  private calculateUnrealizedPnl(position: Position, currentPrice: number): number {
    const { side, size, entryPrice } = position;
    
    if (side === 'long') {
      return size * (currentPrice - entryPrice);
    } else {
      return size * (entryPrice - currentPrice);
    }
  }

  private calculatePnl(position: Position, closePrice: number): number {
    const { side, size, entryPrice } = position;
    
    if (side === 'long') {
      return size * (closePrice - entryPrice);
    } else {
      return size * (entryPrice - closePrice);
    }
  }

  private shouldLiquidate(position: Position, currentPrice: number): boolean {
    const { side, liquidationPrice } = position;
    
    if (!liquidationPrice) return false;
    
    if (side === 'long') {
      return currentPrice <= liquidationPrice;
    } else {
      return currentPrice >= liquidationPrice;
    }
  }
}

export class PaperOrderManager extends EventEmitter {
  private orders: Map<string, Order> = new Map();
  private nextOrderId: number = 1;

  constructor() {
    super();
  }

  createOrder(params: Omit<Order, 'id' | 'status' | 'timestamp'>): Order {
    const id = `order_${this.nextOrderId++}`;
    const order: Order = {
      ...params,
      id,
      status: 'created',
      timestamp: new Date()
    };
    
    this.orders.set(id, order);
    this.emit('orderCreated', order);
    
    return order;
  }

  fillOrder(orderId: string, executionPrice: number, fee: number): void {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    const filledOrder: Order = {
      ...order,
      status: 'filled',
      price: executionPrice,
      fee
    };
    
    this.orders.set(orderId, filledOrder);
    this.emit('orderFilled', filledOrder);
  }

  cancelOrder(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    if (order.status === 'filled') {
      throw new Error('Cannot cancel filled order');
    }
    
    const cancelledOrder: Order = {
      ...order,
      status: 'cancelled'
    };
    
    this.orders.set(orderId, cancelledOrder);
    this.emit('orderCancelled', cancelledOrder);
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  reset(): void {
    this.orders.clear();
    this.nextOrderId = 1;
  }
}

export const DEFAULT_CONFIG: PaperTradingConfig = {
  initialBalance: 10000,
  maxLeverage: 100,
  maintenanceMargin: 0.005,
  minOrderSize: 0.001,
  maxPositions: 10,
  fees: {
    maker: 0.0002,
    taker: 0.0005,
    liquidation: 0.001
  }
};

export class PaperTradingEngine extends EventEmitter {
  private balanceManager: PaperBalanceManager;
  private positionManager: PaperPositionManager;
  private orderManager: PaperOrderManager;
  private lastPrices = new Map<string, number>();
  private config: PaperTradingConfig;

  constructor(config: Partial<PaperTradingConfig> = {}) {
    super();
    if (config.initialBalance !== undefined && config.initialBalance <= 0) {
      throw new Error('Initial balance must be greater than 0');
    }
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.balanceManager = new PaperBalanceManager(this.config.initialBalance);
    this.positionManager = new PaperPositionManager();
    this.orderManager = new PaperOrderManager();

    this.setupEventListeners();
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Paper trading engine initialized');
    } catch (error) {
      logger.error('Failed to initialize paper trading engine:', error);
      throw error;
    }
  }

  private setupEventListeners(): void {
    // Position events
    this.positionManager.on('positionOpened', (position) => {
      this.emit('position', { type: 'opened', position });
    });

    this.positionManager.on('positionUpdated', (position) => {
      this.emit('position', { type: 'updated', position });
    });

    this.positionManager.on('positionClosed', ({ symbol, pnl }) => {
      this.balanceManager.addPnL(pnl);
      this.emit('position', { type: 'closed', symbol, pnl });
    });

    this.positionManager.on('positionLiquidated', (position) => {
      const liquidationFee = position.size * position.entryPrice * this.config.fees.liquidation;
      this.balanceManager.deductFee(liquidationFee);
      this.emit('position', { type: 'liquidated', position });
    });

    // Order events
    this.orderManager.on('orderCreated', (order) => {
      this.emit('order', { type: 'created', order });
    });

    this.orderManager.on('orderFilled', (order) => {
      this.emit('order', { type: 'filled', order });
    });

    this.orderManager.on('orderCancelled', (order) => {
      this.emit('order', { type: 'cancelled', order });
    });
  }

  public async placeOrder(params: Omit<Order, 'id' | 'status' | 'timestamp' | 'fee'>): Promise<Order> {
    try {
      // Validate order parameters
      this.validateOrderParams(params);

      // Check position limits
      if (this.positionManager.getAllPositions().length >= this.config.maxPositions) {
        throw new Error('Maximum positions reached');
      }

      // Calculate required margin
      const requiredMargin = (params.size * (params.price || this.lastPrices.get(params.symbol)!)) / params.leverage;
      
      // Lock margin
      if (!this.balanceManager.lockMargin(requiredMargin)) {
        throw new Error('Insufficient margin');
      }

      // Create order
      const order = this.orderManager.createOrder(params);

      // Simulate network latency
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));

      // Calculate execution price with slippage
      const executionPrice = this.calculateExecutionPrice(params);
      
      // Calculate fees
      const fee = this.calculateFee(order, executionPrice);
      this.balanceManager.deductFee(fee);

      // Fill order
      this.orderManager.fillOrder(order.id, executionPrice, fee);

      // Open position
      this.positionManager.openPosition({
        symbol: order.symbol,
        side: order.side === 'buy' ? 'long' : 'short',
        size: order.size,
        margin: requiredMargin,
        leverage: order.leverage,
        entryPrice: executionPrice,
        timestamp: new Date()
      });

      return { ...order, price: executionPrice, status: 'filled', fee };
    } catch (error) {
      logger.error('Failed to place order:', error);
      throw error;
    }
  }

  public updatePrice(symbol: string, price: number): void {
    this.lastPrices.set(symbol, price);
    this.positionManager.updatePosition(symbol, price);
  }

  public getBalance() {
    return this.balanceManager.getBalance();
  }

  public getAvailableBalance() {
    return this.balanceManager.getAvailableBalance();
  }

  public getPosition(symbol: string): Position | undefined {
    return this.positionManager.getPosition(symbol);
  }

  public getPositions(): Position[] {
    return this.positionManager.getAllPositions();
  }

  private validateOrderParams(params: Omit<Order, 'id' | 'status' | 'timestamp' | 'fee'>): void {
    if (!params.symbol) {
      throw new Error('Symbol is required');
    }
    
    if (!params.side || !['buy', 'sell'].includes(params.side)) {
      throw new Error('Invalid order side');
    }
    
    if (!params.type || !['market', 'limit', 'stop', 'takeProfit'].includes(params.type)) {
      throw new Error('Invalid order type');
    }
    
    if (params.size <= 0) {
      throw new Error('Order size must be positive');
    }
    
    if (params.size < this.config.minOrderSize) {
      throw new Error(`Order size must be at least ${this.config.minOrderSize}`);
    }
    
    if (params.leverage <= 0 || params.leverage > this.config.maxLeverage) {
      throw new Error(`Leverage must be between 1 and ${this.config.maxLeverage}`);
    }
    
    if (params.type !== 'market' && !params.price) {
      throw new Error('Price is required for non-market orders');
    }
    
    if (['stop', 'takeProfit'].includes(params.type) && !params.stopPrice) {
      throw new Error('Stop price is required for stop and take profit orders');
    }
    
    if (!this.lastPrices.has(params.symbol)) {
      throw new Error('No price data available for this symbol');
    }
  }

  private calculateExecutionPrice(params: Omit<Order, 'id' | 'status' | 'timestamp' | 'fee'>): number {
    const lastPrice = this.lastPrices.get(params.symbol);
    if (!lastPrice) {
      throw new Error('No price data available');
    }

    // Add random slippage (0.1% max)
    const slippage = (Math.random() * 0.001) * (params.side === 'buy' ? 1 : -1);
    return lastPrice * (1 + slippage);
  }

  private calculateFee(order: Order, executionPrice: number): number {
    const value = order.size * executionPrice;
    return value * (order.type === 'market' ? this.config.fees.taker : this.config.fees.maker);
  }

  public async reset(): Promise<void> {
    await this.balanceManager.reset(this.config.initialBalance);
    this.positionManager.reset();
    this.orderManager.reset();
    this.lastPrices.clear();
    this.emit('reset');
  }
}
