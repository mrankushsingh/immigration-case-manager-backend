/**
 * In-memory cache utility
 * Simple, fast caching for API responses
 */

interface CacheEntry<T> {
  data: T;
  expires: number;
}

class MemoryCache {
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTL: number = 5 * 60 * 1000; // 5 minutes default

  constructor() {
    console.log('✅ Using in-memory cache');
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    
    if (entry.expires < Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  /**
   * Set cached value
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const expires = Date.now() + (ttl || this.defaultTTL);
    const entry: CacheEntry<T> = { data, expires };
    this.memoryCache.set(key, entry);
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expires < now) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    return {
      type: 'memory',
      size: this.memoryCache.size,
      keys: Array.from(this.memoryCache.keys()),
    };
  }

  /**
   * Check if cache is available (always true for memory cache)
   */
  isRedisAvailable(): boolean {
    return false; // No Redis, always false
  }
}

// Singleton instance
export const cache = new MemoryCache();

// Cleanup expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    cache.cleanup();
  }, 5 * 60 * 1000);
}
