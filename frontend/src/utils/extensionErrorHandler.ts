/**
 * Handles browser extension communication errors
 * These errors occur when extensions try to communicate but channels close prematurely
 */
export class ExtensionErrorHandler {
  private static instance: ExtensionErrorHandler;
  private errorCount = 0;
  private maxErrors = 10;
  private suppressErrors = false;
  
  private constructor() {
    this.setupErrorInterceptor();
  }
  
  static getInstance(): ExtensionErrorHandler {
    if (!ExtensionErrorHandler.instance) {
      ExtensionErrorHandler.instance = new ExtensionErrorHandler();
    }
    return ExtensionErrorHandler.instance;
  }
  
  private setupErrorInterceptor(): void {
    // Override console.error to filter extension errors
    const originalError = console.error;
    
    console.error = (...args: unknown[]) => {
      const errorMessage = args[0]?.toString() || '';
      
      // Check if this is an extension communication error
      if (this.isExtensionError(errorMessage)) {
        this.handleExtensionError(errorMessage);
        
        // Suppress the error if we've seen too many
        if (this.suppressErrors || this.errorCount > this.maxErrors) {
          return;
        }
      }

      // Check if this is a React production error
      if (this.isReactProductionError(errorMessage)) {
        this.handleExtensionError(errorMessage);
        return; // Don't call original console.error for React production errors
      }
      
      // Call original console.error for other errors
      originalError.apply(console, args);
    };
    
    // Also handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      if (this.isExtensionError(event.reason?.toString() || '')) {
        event.preventDefault();
        this.handleExtensionError(event.reason);
      }
    });
  }
  
  private isExtensionError(message: string): boolean {
    const extensionErrorPatterns = [
      'listener indicated an asynchronous response',
      'message channel closed',
      'Extension context invalidated',
      'Receiving end does not exist',
      'Could not establish connection',
      'chrome-extension'
    ];
    
    return extensionErrorPatterns.some(pattern => 
      message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  private isReactProductionError(message: string): boolean {
    // Detect minified React errors that should be handled differently
    const reactErrorPatterns = [
      'Minified React error #185',
      'visit https://react.dev/errors/185',
      'use the non-minified dev environment for full errors'
    ];
    
    return reactErrorPatterns.some(pattern => 
      message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  private handleExtensionError(error: Error | string): void {
    this.errorCount++;
    
    const errorMessage = typeof error === 'string' ? error : error.message || error.toString();
    
    // Handle React production errors differently
    if (this.isReactProductionError(errorMessage)) {
      console.warn(
        'React Error #185 detected: This is likely caused by maximum update depth exceeded. ' +
        'Check for infinite re-renders in component state updates or useEffect dependencies.'
      );
      console.warn('Initialization error detected - this may require a page refresh');
      return;
    }
    
    // Log once every 10 errors to avoid spam
    if (this.errorCount === 1 || this.errorCount % 10 === 0) {
      console.warn(
        `Browser extension communication error (${this.errorCount} occurrences). ` +
        'This is likely caused by a browser extension and can be safely ignored.'
      );
    }
    
    // Start suppressing after too many errors
    if (this.errorCount > this.maxErrors * 2) {
      this.suppressErrors = true;
      console.warn('Suppressing further extension errors to reduce console noise.');
    }
  }
  
  reset(): void {
    this.errorCount = 0;
    this.suppressErrors = false;
  }
}

/**
 * Browser compatibility and extension detection utilities
 */
export class BrowserCompatibility {
  static isExtensionInstalled(extensionId?: string): boolean {
    // Check for common extension indicators
    if (extensionId && chrome?.runtime) {
      try {
        chrome.runtime.sendMessage(extensionId, { ping: true }, () => {
          if (chrome.runtime.lastError) {
            return false;
          }
          return true;
        });
      } catch {
        return false;
      }
    }
    
    // Check for generic extension artifacts
    return !!(
      window.chrome?.runtime ||
      (window as unknown as { browser?: { runtime?: unknown } }).browser?.runtime
    );
  }
  
  static detectConflictingExtensions(): string[] {
    const conflicts: string[] = [];
    
    // Check for known conflicting extensions
    const conflictingExtensions = [
      { name: 'MetaMask', check: () => !!(window as unknown as { ethereum?: unknown }).ethereum },
      { name: 'AdBlock', check: () => !!(window as unknown as { adblockDetected?: unknown }).adblockDetected },
      { name: 'React DevTools', check: () => !!(window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ },
    ];
    
    conflictingExtensions.forEach(ext => {
      if (ext.check()) {
        conflicts.push(ext.name);
      }
    });
    
    return conflicts;
  }
  
  static setupExtensionCompatibility(): void {
    // Initialize error handler
    ExtensionErrorHandler.getInstance();
    
    // Detect and warn about conflicts
    const conflicts = this.detectConflictingExtensions();
    if (conflicts.length > 0) {
      console.info(
        `Detected browser extensions: ${conflicts.join(', ')}. ` +
        'Some console errors may appear due to extension communication.'
      );
    }
    
    // Set up message channel protection
    this.protectMessageChannels();
  }
  
  private static protectMessageChannels(): void {
    // Wrap postMessage to handle closed channels gracefully
    const originalPostMessage = window.postMessage;
    
    window.postMessage = function(...args: Parameters<typeof originalPostMessage>) {
      try {
        return originalPostMessage.apply(window, args);
      } catch (error) {
        if (error?.toString().includes('message channel closed')) {
          // Silently ignore
          return;
        }
        throw error;
      }
    };
  }
}