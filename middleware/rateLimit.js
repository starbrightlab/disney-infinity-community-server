const winston = require('winston');

// Simple in-memory rate limiter (for production, use Redis)
class RateLimiter {
  constructor() {
    this.requests = new Map(); // userId -> {count, resetTime}
  }

  checkLimit(userId, maxRequests, windowMs) {
    const now = Date.now();
    const key = userId;

    if (!this.requests.has(key)) {
      this.requests.set(key, {
        count: 0,
        resetTime: now + windowMs
      });
    }

    const userData = this.requests.get(key);

    // Reset if window has passed
    if (now > userData.resetTime) {
      userData.count = 0;
      userData.resetTime = now + windowMs;
    }

    // Check if limit exceeded
    if (userData.count >= maxRequests) {
      return {
        allowed: false,
        resetTime: userData.resetTime,
        remaining: 0
      };
    }

    // Increment counter
    userData.count++;

    return {
      allowed: true,
      resetTime: userData.resetTime,
      remaining: maxRequests - userData.count
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.requests.entries()) {
      if (now > data.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter();

// Clean up expired entries every 5 minutes
setInterval(() => {
  rateLimiter.cleanup();
}, 5 * 60 * 1000);

// Rate limiting middleware factory
function createRateLimit(options = {}) {
  const {
    maxRequests = 100,
    windowMs = 15 * 60 * 1000, // 15 minutes
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req) => req.user?.id || req.ip,
    skip = () => false,
    message = 'Too many requests from this IP, please try again later.'
  } = options;

  return (req, res, next) => {
    // Skip if condition met
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    if (!key) {
      return next(); // No key, allow request
    }

    const result = rateLimiter.checkLimit(key, maxRequests, windowMs);

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': Math.max(0, result.remaining - 1), // Subtract 1 for current request
      'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000), // Unix timestamp
      'X-RateLimit-Window': Math.ceil(windowMs / 1000) // Window in seconds
    });

    if (!result.allowed) {
      winston.warn(`Rate limit exceeded for ${key}: ${maxRequests} requests in ${windowMs}ms`);

      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: message,
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        }
      });
    }

    next();
  };
}

// Pre-configured rate limiters for different endpoints
const rateLimiters = {
  // General API rate limiting
  general: createRateLimit({
    maxRequests: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many requests, please try again later.'
  }),

  // Authentication endpoints
  auth: createRateLimit({
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many authentication attempts, please try again later.',
    keyGenerator: (req) => req.body.username || req.body.email || req.ip
  }),

  // Presence updates (frequent but limited)
  presence: createRateLimit({
    maxRequests: 30,
    windowMs: 5 * 60 * 1000, // 5 minutes
    message: 'Too many presence updates, please slow down.',
    skipSuccessfulRequests: false
  }),

  // Friend operations
  friends: createRateLimit({
    maxRequests: 20,
    windowMs: 10 * 60 * 1000, // 10 minutes
    message: 'Too many friend operations, please try again later.'
  }),

  // Statistics queries
  stats: createRateLimit({
    maxRequests: 50,
    windowMs: 10 * 60 * 1000, // 10 minutes
    message: 'Too many statistics requests, please try again later.'
  }),

  // Match submissions
  matches: createRateLimit({
    maxRequests: 10,
    windowMs: 5 * 60 * 1000, // 5 minutes
    message: 'Too many match submissions, please try again later.'
  }),

  // Network reports
  network: createRateLimit({
    maxRequests: 30,
    windowMs: 5 * 60 * 1000, // 5 minutes
    message: 'Too many network reports, please try again later.'
  }),

  // Admin operations
  admin: createRateLimit({
    maxRequests: 50,
    windowMs: 5 * 60 * 1000, // 5 minutes
    message: 'Too many admin operations.',
    skip: (req) => !req.user?.is_admin && !req.user?.is_moderator
  }),

  // WebSocket events (more lenient)
  websocket: createRateLimit({
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
    message: 'Too many WebSocket events.',
    skipFailedRequests: true
  })
};

module.exports = {
  createRateLimit,
  rateLimiters,
  general: rateLimiters.general,
  auth: rateLimiters.auth,
  presence: rateLimiters.presence,
  friends: rateLimiters.friends,
  stats: rateLimiters.stats,
  matches: rateLimiters.matches,
  network: rateLimiters.network,
  admin: rateLimiters.admin,
  websocket: rateLimiters.websocket
};
