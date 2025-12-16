/**
 * Client-side cache utility with 1-minute TTL
 * Provides in-memory caching for API responses and other data
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// In-memory cache store
const cacheStore = new Map<string, CacheEntry<any>>();

// Cache TTL: 1 minute (60,000 milliseconds)
const CACHE_TTL_MS = 60 * 1000;

/**
 * Check if a cache entry is expired based on its timestamp
 */
function isExpired(timestamp: number): boolean {
  return Date.now() - timestamp > CACHE_TTL_MS;
}

/**
 * Get cached data if it exists and is not expired
 * @param key - Cache key
 * @returns Cached data or null if not found or expired
 */
export function getCached<T>(key: string): T | null {
  const entry = cacheStore.get(key);
  
  if (!entry) {
    return null;
  }
  
  if (isExpired(entry.timestamp)) {
    // Remove expired entry
    cacheStore.delete(key);
    return null;
  }
  
  return entry.data as T;
}

/**
 * Store data in cache with current timestamp
 * @param key - Cache key
 * @param data - Data to cache
 */
export function setCached<T>(key: string, data: T): void {
  cacheStore.set(key, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Remove a specific cache entry
 * @param key - Cache key to remove
 */
export function clearCached(key: string): void {
  cacheStore.delete(key);
}

/**
 * Clear all expired entries from cache
 * Useful for periodic cleanup to prevent memory bloat
 */
export function clearExpiredEntries(): void {
  const now = Date.now();
  const entries = Array.from(cacheStore.entries());
  for (const [key, entry] of entries) {
    if (isExpired(entry.timestamp)) {
      cacheStore.delete(key);
    }
  }
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  cacheStore.clear();
}

/**
 * Generate cache key for Uniswap liquidity data
 */
export function getUniswapLiquidityCacheKey(chainId: number, query: string): string {
  const normalizedQuery = query.trim().toLowerCase();
  return `uniswap-liquidity-${chainId}-${normalizedQuery}`;
}

/**
 * Generate cache key for Solana token data
 */
export function getSolanaTokenDataCacheKey(addresses: string[]): string {
  // Sort addresses to ensure deterministic cache keys
  const sortedAddresses = [...addresses].sort();
  return `solana-token-data-${sortedAddresses.join(',')}`;
}

/**
 * Generate cache key for token price data
 */
export function getTokenPriceCacheKey(chainId: number, address: string): string {
  const normalizedAddress = address.toLowerCase();
  return `token-price-${chainId}-${normalizedAddress}`;
}

// Periodically clean up expired entries (every 5 minutes)
if (typeof window !== 'undefined') {
  setInterval(clearExpiredEntries, 5 * 60 * 1000);
}

