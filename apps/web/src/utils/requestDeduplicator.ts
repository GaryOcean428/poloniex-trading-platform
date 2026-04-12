/**
 * Request deduplicator for the frontend API client.
 *
 * When multiple concurrent callers issue an identical GET request (same URL)
 * before the first response has arrived, they all share a single in-flight
 * Promise rather than each firing an independent network request.
 *
 * Only GET semantics are deduplicated — mutation requests (POST/PUT/PATCH/DELETE)
 * are always forwarded individually.
 */
const pendingRequests = new Map<string, Promise<unknown>>();

/**
 * Deduplicate concurrent GET requests by sharing a single in-flight Promise.
 *
 * @param key      - Deduplication key (typically the full request URL).
 * @param fetcher  - Async function that performs the actual request.
 * @returns        A Promise that resolves to the result of `fetcher`.
 */
export function deduplicatedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key) as Promise<T>;
  }

  // Register the promise before the async operation starts to prevent
  // race conditions where concurrent callers miss the in-flight request.
  const promise = new Promise<T>((resolve, reject) => {
    fetcher().then(resolve, reject);
  }).finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}
