import { lazy, type ComponentType } from 'react';

type ModuleDefault = { default: ComponentType<any> };

function retryImport(
  importFn: () => Promise<ModuleDefault>,
  retries: number,
  delay: number
): Promise<ModuleDefault> {
  return importFn().catch((error: Error) => {
    if (retries > 0) {
      return new Promise<void>((resolve) => setTimeout(resolve, delay)).then(
        () => retryImport(importFn, retries - 1, delay)
      );
    }
    // All retries exhausted — do a one-time hard reload so the browser
    // fetches the latest index.html (and therefore the correct chunk URLs).
    const reloadKey = 'chunk-reload-' + location.pathname;
    if (!sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
    }
    throw error;
  });
}

/**
 * Drop-in replacement for React.lazy that retries failed dynamic imports
 * and triggers a page reload on persistent failure (e.g. after a deploy
 * changed chunk hashes).
 */
export function lazyWithRetry(
  importFn: () => Promise<ModuleDefault>,
  retries = 2,
  delay = 1000
) {
  return lazy(() => retryImport(importFn, retries, delay));
}
