const winston = require('winston');

/**
 * Caching middleware for performance optimization
 */

// Simple in-memory cache for development/fallback
class MemoryCache {
  constructor() {
    this.cache = new Map();
  }

  async get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  async set(key, value, ttlSeconds = 300) {
    this.cache.set(key, {
      value,
      expires: Date.now() + (ttlSeconds * 1000)
    });
  }

  async del(key) {
    this.cache.delete(key);
  }

  async clear() {
    this.cache.clear();
  }
}

// Redis cache implementation (if Redis is available)
class RedisCache {
  constructor() {
    try {
      const Redis = require('ioredis');
      this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      this.enabled = true;

      this.client.on('error', (err) => {
        winston.warn('Redis connection error:', err.message);
        this.enabled = false;
      });
    } catch (err) {
      winston.warn('Redis not available, using memory cache');
      this.enabled = false;
    }
  }

  async get(key) {
    if (!this.enabled) return null;
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      winston.error('Redis get error:', err);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 300) {
    if (!this.enabled) return;
    try {
      await this.client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      winston.error('Redis set error:', err);
    }
  }

  async del(key) {
    if (!this.enabled) return;
    try {
      await this.client.del(key);
    } catch (err) {
      winston.error('Redis del error:', err);
    }
  }

  async clear() {
    if (!this.enabled) return;
    try {
      await this.client.flushall();
    } catch (err) {
      winston.error('Redis clear error:', err);
    }
  }
}

// Initialize cache
let cache;
if (process.env.REDIS_URL || process.env.NODE_ENV === 'production') {
  cache = new RedisCache();
} else {
  cache = new MemoryCache();
}

/**
 * Cache middleware for routes
 */
const cacheMiddleware = (ttlSeconds = 300, keyGenerator = null) => {
  return async (req, res, next) => {
    // Skip caching for authenticated requests
    if (req.user) {
      return next();
    }

    // Generate cache key
    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : `${req.method}:${req.originalUrl}`;

    try {
      // Try to get from cache
      const cached = await cache.get(cacheKey);
      if (cached) {
        winston.debug(`Cache hit: ${cacheKey}`);
        return res.json(cached);
      }

      // Store original json method
      const originalJson = res.json;

      // Override json method to cache response
      res.json = function(data) {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          cache.set(cacheKey, data, ttlSeconds).catch(err => {
            winston.error('Cache set error:', err);
          });
        }

        // Call original method
        return originalJson.call(this, data);
      };

      next();
    } catch (err) {
      winston.error('Cache middleware error:', err);
      next();
    }
  };
};

/**
 * Cache invalidation helpers
 */
const cacheHelpers = {
  // Clear toybox-related cache
  clearToyboxCache: async (toyboxId = null) => {
    try {
      if (toyboxId) {
        // Clear specific toybox cache
        await cache.del(`GET:/api/v1/toybox/${toyboxId}`);
        await cache.del(`GET:/api/v1/toybox/${toyboxId}/screenshot`);
      }

      // Clear list caches (they may be affected)
      await cache.del('GET:/api/v1/toybox');
      await cache.del('GET:/api/v1/toybox/trending');

      winston.debug(`Cleared toybox cache${toyboxId ? ` for ${toyboxId}` : ''}`);
    } catch (err) {
      winston.error('Cache clear error:', err);
    }
  },

  // Clear user-related cache
  clearUserCache: async (userId) => {
    try {
      await cache.del(`GET:/api/v1/profile:${userId}`);
      winston.debug(`Cleared user cache for ${userId}`);
    } catch (err) {
      winston.error('User cache clear error:', err);
    }
  },

  // Clear all cache
  clearAllCache: async () => {
    try {
      await cache.clear();
      winston.info('Cleared all cache');
    } catch (err) {
      winston.error('Cache clear all error:', err);
    }
  }
};

module.exports = {
  cacheMiddleware,
  cacheHelpers,
  cache
};
