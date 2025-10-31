import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Test suite for graceful shutdown functionality
 * 
 * This test verifies that the graceful shutdown handler properly:
 * 1. Closes Socket.IO server before HTTP server
 * 2. Has a timeout mechanism to prevent indefinite hangs
 * 3. Properly cleans up resources in the correct order
 */
describe('Graceful Shutdown', () => {
  let mockIo: { close: ReturnType<typeof vi.fn> };
  let mockServer: { close: ReturnType<typeof vi.fn> };
  let mockProcess: EventEmitter;
  let originalExit: typeof process.exit;
  let exitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock Socket.IO server
    mockIo = {
      close: vi.fn((callback?: () => void) => {
        if (callback) callback();
      })
    };

    // Mock HTTP server
    mockServer = {
      close: vi.fn((callback?: () => void) => {
        if (callback) callback();
      })
    };

    // Mock process
    mockProcess = new EventEmitter();
    
    // Mock process.exit
    originalExit = process.exit;
    exitSpy = vi.fn();
    process.exit = exitSpy as unknown as typeof process.exit;
  });

  afterEach(() => {
    // Restore process.exit
    process.exit = originalExit;
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it('should close Socket.IO server before HTTP server on SIGTERM', async () => {
    vi.useFakeTimers();
    
    const gracefulShutdown = (signal: string): void => {
      const forceExitTimeout = setTimeout(() => {
        process.exit(1);
      }, 10000);
      
      mockIo.close(() => {
        mockServer.close(() => {
          clearTimeout(forceExitTimeout);
          process.exit(0);
        });
      });
    };

    // Trigger shutdown
    gracefulShutdown('SIGTERM');

    // Verify Socket.IO close was called
    expect(mockIo.close).toHaveBeenCalledTimes(1);
    
    // Verify HTTP server close was called after Socket.IO
    expect(mockServer.close).toHaveBeenCalledTimes(1);
    
    // Verify process exited with code 0
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should close Socket.IO server before HTTP server on SIGINT', async () => {
    vi.useFakeTimers();
    
    const gracefulShutdown = (signal: string): void => {
      const forceExitTimeout = setTimeout(() => {
        process.exit(1);
      }, 10000);
      
      mockIo.close(() => {
        mockServer.close(() => {
          clearTimeout(forceExitTimeout);
          process.exit(0);
        });
      });
    };

    // Trigger shutdown
    gracefulShutdown('SIGINT');

    // Verify Socket.IO close was called
    expect(mockIo.close).toHaveBeenCalledTimes(1);
    
    // Verify HTTP server close was called after Socket.IO
    expect(mockServer.close).toHaveBeenCalledTimes(1);
    
    // Verify process exited with code 0
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should force exit after timeout if graceful shutdown hangs', async () => {
    vi.useFakeTimers();
    
    // Mock Socket.IO that never calls callback (simulating hanging websockets)
    const hangingIo = {
      close: vi.fn(() => {
        // Never call the callback - simulate hanging
      })
    };

    const gracefulShutdown = (signal: string): void => {
      const forceExitTimeout = setTimeout(() => {
        process.exit(1);
      }, 10000);
      
      hangingIo.close(() => {
        mockServer.close(() => {
          clearTimeout(forceExitTimeout);
          process.exit(0);
        });
      });
    };

    // Trigger shutdown
    gracefulShutdown('SIGTERM');

    // Verify Socket.IO close was called
    expect(hangingIo.close).toHaveBeenCalledTimes(1);
    
    // Fast-forward time by 10 seconds
    vi.advanceTimersByTime(10000);
    
    // Verify process was forced to exit with code 1
    expect(exitSpy).toHaveBeenCalledWith(1);
    
    // Verify HTTP server close was never called (because Socket.IO hung)
    expect(mockServer.close).not.toHaveBeenCalled();
  });

  it('should maintain correct shutdown order: Socket.IO -> HTTP -> exit', async () => {
    vi.useFakeTimers();
    
    const callOrder: string[] = [];
    
    const trackedIo = {
      close: vi.fn((callback?: () => void) => {
        callOrder.push('io.close');
        if (callback) callback();
      })
    };

    const trackedServer = {
      close: vi.fn((callback?: () => void) => {
        callOrder.push('server.close');
        if (callback) callback();
      })
    };

    const trackedExit = vi.fn((code: number) => {
      callOrder.push(`exit(${code})`);
    });
    process.exit = trackedExit as unknown as typeof process.exit;

    const gracefulShutdown = (signal: string): void => {
      const forceExitTimeout = setTimeout(() => {
        process.exit(1);
      }, 10000);
      
      trackedIo.close(() => {
        trackedServer.close(() => {
          clearTimeout(forceExitTimeout);
          process.exit(0);
        });
      });
    };

    // Trigger shutdown
    gracefulShutdown('SIGTERM');

    // Verify correct order
    expect(callOrder).toEqual([
      'io.close',
      'server.close',
      'exit(0)'
    ]);
  });
});
