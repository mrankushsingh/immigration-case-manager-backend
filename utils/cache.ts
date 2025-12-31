/**
 * Redis-based cache utility with in-memory fallback
 * Uses Redis if available, falls back to in-memory cache if Redis is unavailable
 */

import Redis from 'ioredis';

interface CacheEntry<T> {
  data: T;
  expires: number;
}

class RedisCache {
  private redis: Redis | null = null;
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTL: number = 5 * 60 * 1000; // 5 minutes default
  private useRedis: boolean = false;
  private connectionAttempted: boolean = false;

  constructor() {
    this.initRedis();
  }

  /**
   * Initialize Redis connection
   */
  private async initRedis() {
    if (this.connectionAttempted) return;
    this.connectionAttempted = true;

    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      console.log('⚠️  REDIS_URL not set, using in-memory cache');
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true; // Reconnect on READONLY error
          }
          return false;
        },
        enableOfflineQueue: false, // Don't queue commands when disconnected
      });

      // Test connection
      await this.redis.ping();
      this.useRedis = true;
      console.log('✅ Redis connected successfully');

      // Handle connection errors
      this.redis.on('error', (err) => {
        console.error('❌ Redis error:', err.message);
        // Fall back to memory cache on error
        if (this.useRedis) {
          console.log('⚠️  Falling back to in-memory cache');
          this.useRedis = false;
        }
      });

      // Handle reconnection
      this.redis.on('connect', () => {
        if (!this.useRedis) {
          console.log('✅ Redis reconnected, switching back to Redis');
          this.useRedis = true;
        }
      });

    } catch (error: any) {
      console.error('❌ Failed to connect to Redis:', error.message);
      console.log('⚠️  Using in-memory cache as fallback');
      this.useRedis = false;
      this.redis = null;
    }
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (this.useRedis && this.redis) {
      try {
        const value = await this.redis.get(key);
        if (!value) return null;
        
        const entry: CacheEntry<T> = JSON.parse(value);
        
        // Check expiration
        if (entry.expires < Date.now()) {
          await this.redis.del(key);
          return null;
        }
        
        return entry.data as T;
      } catch (error: any) {
        console.error('Redis get error:', error.message);
        // Fall back to memory cache
        this.useRedis = false;
        return this.getFromMemory<T>(key);
      }
    }
    
    return this.getFromMemory<T>(key);
  }

  /**
   * Get from memory cache
   */
  private getFromMemory<T>(key: string): T | null {
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

    if (this.useRedis && this.redis) {
      try {
        // Convert TTL to seconds for Redis
        const ttlSeconds = Math.ceil((ttl || this.defaultTTL) / 1000);
        await this.redis.setex(key, ttlSeconds, JSON.stringify(entry));
        return;
      } catch (error: any) {
        console.error('Redis set error:', error.message);
        // Fall back to memory cache
        this.useRedis = false;
      }
    }
    
    // Use memory cache
    this.memoryCache.set(key, entry);
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch (error: any) {
        console.error('Redis delete error:', error.message);
        // Fall back to memory cache
        this.useRedis = false;
      }
    }
    
    this.memoryCache.delete(key);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.flushdb();
        return;
      } catch (error: any) {
        console.error('Redis clear error:', error.message);
        // Fall back to memory cache
        this.useRedis = false;
      }
    }
    
    this.memoryCache.clear();
  }

  /**
   * Clear expired entries (memory cache only, Redis handles expiration automatically)
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
    if (this.useRedis && this.redis) {
      try {
        const info = await this.redis.info('keyspace');
        const keys = await this.redis.keys('*');
        return {
          type: 'redis',
          size: keys.length,
          keys: keys.slice(0, 100), // Limit to first 100 keys
          info: info,
        };
      } catch (error: any) {
        console.error('Redis stats error:', error.message);
      }
    }
    
    return {
      type: 'memory',
      size: this.memoryCache.size,
      keys: Array.from(this.memoryCache.keys()),
    };
  }

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean {
    return this.useRedis && this.redis !== null;
  }

  /**
   * Gracefully close Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.useRedis = false;
    }
  }
}

// Singleton instance
export const cache = new RedisCache();

// Cleanup expired entries every 5 minutes (memory cache only)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    cache.cleanup();
  }, 5 * 60 * 1000);
}

// Graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGTERM', async () => {
    await cache.disconnect();
  });
  
  process.on('SIGINT', async () => {
    await cache.disconnect();
    process.exit(0);
  });
}
