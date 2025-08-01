/**
 * Performance Optimization Utilities for High-Frequency Trading
 * Implements caching, batching, and optimization strategies
 */

export interface PerformanceConfig {
  // Caching settings
  enableCaching: boolean;
  cacheMaxSize: number;
  cacheExpiryMs: number;
  
  // Batching settings
  enableBatching: boolean;
  batchSize: number;
  batchDelayMs: number;
  
  // Rate limiting settings
  maxRequestsPerSecond: number;
  maxConcurrentRequests: number;
  
  // Memory management
  maxMemoryUsageMB: number;
  gcThresholdMB: number;
  
  // WebSocket optimization
  wsHeartbeatInterval: number;
  wsReconnectDelay: number;
  wsMaxReconnectAttempts: number;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

export interface BatchRequest {
  id: string;
  type: string;
  params: Record<string, unknown>;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export interface PerformanceMetrics {
  cacheHitRate: number;
  avgResponseTime: number;
  requestsPerSecond: number;
  memoryUsage: number;
  batchEfficiency: number;
  errorRate: number;
}

export class PerformanceOptimizer {
  private config: PerformanceConfig;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private requestQueue: BatchRequest[] = [];
  private batchProcessor: NodeJS.Timeout | null = null;
  private rateLimiter: Map<string, number[]> = new Map();
  private activeRequests = 0;
  private metrics: PerformanceMetrics = {
    cacheHitRate: 0,
    avgResponseTime: 0,
    requestsPerSecond: 0,
    memoryUsage: 0,
    batchEfficiency: 0,
    errorRate: 0
  };
  private metricsHistory: PerformanceMetrics[] = [];

  constructor(config?: Partial<PerformanceConfig>) {
    this.config = {
      enableCaching: true,
      cacheMaxSize: 1000,
      cacheExpiryMs: 300000, // 5 minutes
      
      enableBatching: true,
      batchSize: 10,
      batchDelayMs: 100,
      
      maxRequestsPerSecond: 10,
      maxConcurrentRequests: 5,
      
      maxMemoryUsageMB: 512,
      gcThresholdMB: 256,
      
      wsHeartbeatInterval: 30000,
      wsReconnectDelay: 5000,
      wsMaxReconnectAttempts: 5,
      
      ...config
    };
    
    this.startCacheCleanup();
    this.startMetricsCollection();
  }

  /**
   * Cached API request wrapper
   */
  async cachedRequest<T>(
    key: string,
    requestFn: () => Promise<T>,
    forceRefresh: boolean = false
  ): Promise<T> {
    const startTime = performance.now();
    
    try {
      // Check cache first
      if (!forceRefresh && this.config.enableCaching) {
        const cached = this.getCached<T>(key);
        if (cached) {
          this.updateMetrics('cacheHit', performance.now() - startTime);
          return cached;
        }
      }
      
      // Apply rate limiting
      if (!this.checkRateLimit('api')) {
        throw new Error('Rate limit exceeded');
      }
      
      // Check concurrent request limit
      if (this.activeRequests >= this.config.maxConcurrentRequests) {
        await this.waitForSlot();
      }
      
      this.activeRequests++;
      
      try {
        const result = await requestFn();
        
        // Cache the result
        if (this.config.enableCaching) {
          this.setCached(key, result);
        }
        
        this.updateMetrics('cacheMiss', performance.now() - startTime, true);
        return result;
      } finally {
        this.activeRequests--;
      }
    } catch (error) {
      this.updateMetrics('error', performance.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Batched request processing
   */
  async batchRequest<T>(
    type: string,
    params: unknown
  ): Promise<T> {
    if (!this.config.enableBatching) {
      throw new Error('Batching is disabled');
    }
    
    return new Promise<T>((resolve, reject) => {
      const request: BatchRequest = {
        id: `${type}_${Date.now()}_${Math.random()}`,
        type,
        params,
        resolve,
        reject,
        timestamp: Date.now()
      };
      
      this.requestQueue.push(request);
      
      // Start batch processor if not running
      if (!this.batchProcessor) {
        this.batchProcessor = setTimeout(() => {
          this.processBatch();
        }, this.config.batchDelayMs);
      }
      
      // Process immediately if batch is full
      if (this.requestQueue.length >= this.config.batchSize) {
        if (this.batchProcessor) {
          clearTimeout(this.batchProcessor);
          this.batchProcessor = null;
        }
        this.processBatch();
      }
    });
  }

  /**
   * Optimized WebSocket connection manager
   */
  createOptimizedWebSocket(url: string, protocols?: string[]): OptimizedWebSocket {
    return new OptimizedWebSocket(url, protocols, this.config);
  }

  /**
   * Memory usage monitoring and cleanup
   */
  monitorMemory(): void {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in (window.performance as any)) {
      const memory = (window.performance as any).memory;
      const usedMB = memory.usedJSHeapSize / 1024 / 1024;
      
      this.metrics.memoryUsage = usedMB;
      
      if (usedMB > this.config.gcThresholdMB) {
        this.performGarbageCollection();
      }
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Get performance history
   */
  getMetricsHistory(): PerformanceMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Debounced function executor
   */
  debounce<T extends (...args: unknown[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      
      timeout = setTimeout(() => {
        func(...args);
      }, wait);
    };
  }

  /**
   * Throttled function executor
   */
  throttle<T extends (...args: unknown[]) => any>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    const inThrottle = false;
    
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Memoization for expensive calculations
   */
  memoize<T extends (...args: unknown[]) => any>(
    func: T,
    maxCacheSize: number = 100
  ): T {
    const cache = new Map<string, { result: ReturnType<T>; timestamp: number }>();
    
    return ((...args: Parameters<T>): ReturnType<T> => {
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      
      if (cached && Date.now() - cached.timestamp < this.config.cacheExpiryMs) {
        return cached.result;
      }
      
      const result = func(...args);
      
      // Manage cache size
      if (cache.size >= maxCacheSize) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
          cache.delete(oldestKey);
        }
      }
      
      cache.set(key, { result, timestamp: Date.now() });
      return result;
    }) as T;
  }

  /**
   * Batch array processing with yielding
   */
  async *batchProcess<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = this.config.batchSize
  ): AsyncGenerator<R[], void, unknown> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(processor));
      yield results;
      
      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /**
   * Get cached value
   */
  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    return entry.data;
  }

  /**
   * Set cached value
   */
  private setCached<T>(key: string, data: T): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.config.cacheMaxSize) {
      this.evictOldestEntry();
    }
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.cacheExpiryMs,
      accessCount: 0,
      lastAccessed: Date.now()
    };
    
    this.cache.set(key, entry);
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(type: string): boolean {
    const now = Date.now();
    const windowStart = now - 1000; // 1 second window
    
    if (!this.rateLimiter.has(type)) {
      this.rateLimiter.set(type, []);
    }
    
    const timestamps = this.rateLimiter.get(type)!;
    
    // Remove old timestamps
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }
    
    if (timestamps.length >= this.config.maxRequestsPerSecond) {
      return false;
    }
    
    timestamps.push(now);
    return true;
  }

  /**
   * Wait for available request slot
   */
  private async waitForSlot(): Promise<void> {
    return new Promise(resolve => {
      const checkSlot = () => {
        if (this.activeRequests < this.config.maxConcurrentRequests) {
          resolve();
        } else {
          setTimeout(checkSlot, 50);
        }
      };
      checkSlot();
    });
  }

  /**
   * Process batched requests
   */
  private async processBatch(): Promise<void> {
    if (this.requestQueue.length === 0) return;
    
    const batch = this.requestQueue.splice(0, this.config.batchSize);
    this.batchProcessor = null;
    
    // Group requests by type
    const grouped = batch.reduce((acc, req) => {
      if (!acc[req.type]) {
        acc[req.type] = [];
      }
      acc[req.type].push(req);
      return acc;
    }, {} as Record<string, BatchRequest[]>);
    
    // Process each group
    for (const [type, requests] of Object.entries(grouped)) {
      try {
        const results = await this.executeBatch(type, requests);
        requests.forEach((req, index) => {
          req.resolve(results[index]);
        });
      } catch (error) {
        requests.forEach(req => {
          req.reject(error);
        });
      }
    }
    
    // Update batch efficiency metric
    const efficiency = batch.length / this.config.batchSize;
    this.metrics.batchEfficiency = (this.metrics.batchEfficiency + efficiency) / 2;
    
    // Process remaining requests if any
    if (this.requestQueue.length > 0) {
      this.batchProcessor = setTimeout(() => {
        this.processBatch();
      }, this.config.batchDelayMs);
    }
  }

  /**
   * Execute batch of requests
   */
  private async executeBatch(_type: string, requests: BatchRequest[]): Promise<unknown[]> {
    // This would be implemented based on specific API requirements
    // For now, execute requests individually
    const results = [];
    for (const request of requests) {
      // Placeholder - implement actual batch API calls
      results.push(await this.executeRequest(request));
    }
    return results;
  }

  /**
   * Execute individual request (placeholder)
   */
  private async executeRequest(request: BatchRequest): Promise<any> {
    // Placeholder implementation
    return { type: request.type, params: request.params, timestamp: Date.now() };
  }

  /**
   * Evict oldest cache entry
   */
  private evictOldestEntry(): void {
    const oldestKey = '';
    const oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(type: 'cacheHit' | 'cacheMiss' | 'error', duration: number, success: boolean = true): void {
    const requestsInLastSecond = this.getRequestsInLastSecond();
    
    // Update cache hit rate
    if (type === 'cacheHit' || type === 'cacheMiss') {
      const totalRequests = this.metricsHistory.length + 1;
      const hitRate = type === 'cacheHit' ? 1 : 0;
      this.metrics.cacheHitRate = (this.metrics.cacheHitRate * (totalRequests - 1) + hitRate) / totalRequests;
    }
    
    // Update response time
    this.metrics.avgResponseTime = (this.metrics.avgResponseTime + duration) / 2;
    
    // Update RPS
    this.metrics.requestsPerSecond = requestsInLastSecond;
    
    // Update error rate
    const errorRate = success ? 0 : 1;
    this.metrics.errorRate = (this.metrics.errorRate + errorRate) / 2;
  }

  /**
   * Get requests in last second
   */
  private getRequestsInLastSecond(): number {
    const cutoff = Date.now() - 1000;
    return this.metricsHistory.filter(m => m.requestsPerSecond > cutoff).length;
  }

  /**
   * Start cache cleanup routine
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
        }
      }
    }, 60000); // Clean every minute
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.monitorMemory();
      this.metricsHistory.push({ ...this.metrics });
      
      // Keep only last 100 metrics
      if (this.metricsHistory.length > 100) {
        this.metricsHistory.shift();
      }
    }, 10000); // Collect every 10 seconds
  }

  /**
   * Perform garbage collection hints
   */
  private performGarbageCollection(): void {
    // Clear old cache entries
    const cutoff = Date.now() - this.config.cacheExpiryMs / 2;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < cutoff) {
        this.cache.delete(key);
      }
    }
    
    // Clear old metrics
    this.metricsHistory = this.metricsHistory.slice(-50);
    
    // Clear old rate limit data
    const windowStart = Date.now() - 60000; // 1 minute
    for (const [type, timestamps] of this.rateLimiter.entries()) {
      this.rateLimiter.set(type, timestamps.filter(ts => ts > windowStart));
    }
  }
}

/**
 * Optimized WebSocket implementation
 */
export class OptimizedWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private protocols?: string[];
  private config: PerformanceConfig;
  private reconnectAttempts = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageQueue: unknown[] = [];
  private connectionState: 'connecting' | 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  
  constructor(url: string, protocols?: string[], config?: PerformanceConfig) {
    this.url = url;
    this.protocols = protocols;
    this.config = config || {
      wsHeartbeatInterval: 30000,
      wsReconnectDelay: 5000,
      wsMaxReconnectAttempts: 5
    } as PerformanceConfig;
    
    this.connect();
  }

  /**
   * Send message with queuing
   */
  send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    } else {
      this.messageQueue.push(data);
    }
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.ws) {
      this.ws.close();
    }
    
    this.connectionState = 'disconnected';
  }

  /**
   * Get connection state
   */
  getState(): string {
    return this.connectionState;
  }

  /**
   * Connect to WebSocket
   */
  private connect(): void {
    this.connectionState = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    
    try {
      this.ws = new WebSocket(this.url, this.protocols);
      
      this.ws.onopen = () => {
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        
        // Send queued messages
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift();
          this.send(message);
        }
        
        // Start heartbeat
        this.startHeartbeat();
      };
      
      this.ws.onclose = () => {
        this.connectionState = 'disconnected';
        
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
        }
        
        this.attemptReconnect();
      };
      
      this.ws.onerror = (error) => {
        // console.error('WebSocket error:', error);
        this.attemptReconnect();
      };
      
    } catch (error) {
      // console.error('Failed to create WebSocket:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Attempt reconnection
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.config.wsMaxReconnectAttempts) {
      // console.error('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    
    setTimeout(() => {
      this.connect();
    }, this.config.wsReconnectDelay * Math.pow(2, this.reconnectAttempts - 1)); // Exponential backoff
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, this.config.wsHeartbeatInterval);
  }
}

/**
 * Global performance optimizer instance
 */
export const performanceOptimizer = new PerformanceOptimizer();

/**
 * Utility functions for common optimizations
 */
export const optimizationUtils = {
  /**
   * Lazy load component
   */
  lazyLoad: <T>(factory: () => Promise<{ default: T }>): Promise<T> => {
    return factory().then(module => module.default);
  },

  /**
   * Virtual scrolling helper
   */
  createVirtualScroller: (
    itemHeight: number,
    containerHeight: number,
    totalItems: number
  ) => {
    return {
      getVisibleRange: (scrollTop: number) => {
        const start = Math.floor(scrollTop / itemHeight);
        const end = Math.min(
          start + Math.ceil(containerHeight / itemHeight) + 1,
          totalItems
        );
        return { start: Math.max(0, start), end };
      },
      
      getTotalHeight: () => totalItems * itemHeight,
      
      getItemStyle: (index: number) => ({
        position: 'absolute' as const,
        top: index * itemHeight,
        height: itemHeight,
        width: '100%'
      })
    };
  },

  /**
   * Image lazy loading
   */
  setupLazyImages: (selector: string = 'img[data-src]') => {
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target as HTMLImageElement;
            img.src = img.dataset.src!;
            img.removeAttribute('data-src');
            imageObserver.unobserve(img);
          }
        });
      });

      document.querySelectorAll(selector).forEach(img => {
        imageObserver.observe(img);
      });
    }
  }
};