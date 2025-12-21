#!/usr/bin/env node

/**
 * Disney Infinity Community Server
 * A community-maintained server for Disney Infinity 3.0 Gold multiplayer
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Load environment variables
require('dotenv').config();

// Create Express app
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize Socket.io server
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Configure logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'infinity-community-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API server
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Compression
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request monitoring middleware
app.use((req, res, next) => {
  const startTime = Date.now();

  // Enhanced request logging for debugging
  console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  if (req.path.startsWith('/api/v1/') && req.path !== '/api/v1/health') {
    console.log(`🔍 REQUEST DEBUG: ${req.method} ${req.path}`, {
      headers: req.headers.authorization ? { ...req.headers, authorization: '[REDACTED]' } : req.headers,
      query: req.query,
      body: req.method !== 'GET' ? req.body : undefined,
      ip: req.ip
    });
  }

  // Log request
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    query: req.query,
    body: req.method !== 'GET' ? req.body : undefined
  });

  // Monitor response with enhanced error logging
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    monitoring.recordRequest(req, res, responseTime);

    // Enhanced response logging for debugging
    if (req.path.startsWith('/api/v1/') && req.path !== '/api/v1/health') {
      console.log(`📤 RESPONSE: ${req.method} ${req.path} - ${res.statusCode} (${responseTime}ms)`);
      if (res.statusCode >= 400) {
        console.log(`❌ ERROR RESPONSE: ${req.method} ${req.path} - Status: ${res.statusCode}`);
      }
    }

    // Log slow requests
    if (responseTime > 1000) {
      logger.warn(`Slow request: ${req.method} ${req.path} took ${responseTime}ms`, {
        ip: req.ip,
        statusCode: res.statusCode,
        responseTime
      });
    }
  });

  next();
});

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  const health = monitoring.getHealthStatus();

  res.status(health.status === 'critical' ? 503 : 200).json({
    status: health.status,
    message: health.status === 'healthy' ? 'Disney Infinity Community Server is running!' : 'Server experiencing issues',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: health.uptime,
    checks: health.checks
  });
});

// Detailed metrics endpoint (admin only)
app.get('/api/v1/metrics', require('./middleware/auth').requireAdmin, (req, res) => {
  const metrics = monitoring.getMetrics();
  const alerts = monitoring.checkThresholds();

  res.json({
    ...metrics,
    alerts,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint for testing Supabase connectivity (temporary)
app.get('/api/v1/debug/supabase', async (req, res) => {
  try {
    console.log('🔧 DEBUG ENDPOINT: Testing Supabase connection');
    const { supabase } = require('./config/database');

    // Test basic select
    const { data, error, count } = await supabase
      .from('users')
      .select('id,username', { count: 'exact' })
      .limit(1);

    if (error) {
      console.log('❌ DEBUG ENDPOINT: Supabase error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Supabase query failed',
        error: error.message,
        code: error.code,
        details: error.details
      });
    }

    console.log('✅ DEBUG ENDPOINT: Supabase query successful');
    res.json({
      status: 'success',
      message: 'Supabase connection working',
      data: data,
      count: count,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.log('💥 DEBUG ENDPOINT: Unexpected error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Unexpected error in debug endpoint',
      error: err.message,
      stack: err.stack
    });
  }
});

// Simple test endpoint (temporary)
app.get('/api/v1/debug/test', (req, res) => {
  console.log('🧪 TEST ENDPOINT: Basic routing works');
  res.json({
    status: 'success',
    message: 'Basic routing is working',
    timestamp: new Date().toISOString()
  });
});

// Health debug endpoint (temporary)
app.get('/api/v1/debug/health', (req, res) => {
  try {
    console.log('🔍 HEALTH DEBUG: Testing monitoring service...');
    const monitoring = require('./services/monitoring');

    const health = monitoring.getHealthStatus();
    console.log('✅ HEALTH DEBUG: Health check result:', health);

    res.json({
      status: 'debug_success',
      health,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.log('❌ HEALTH DEBUG: Error:', err);
    res.status(500).json({
      status: 'debug_error',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Performance monitoring endpoint
app.get('/api/v1/monitoring/performance', (req, res) => {
  const metrics = monitoring.getMetrics();

  res.json({
    response_time: {
      average: metrics.requests.averageResponseTime,
      p95: metrics.requests.responseTimes.length > 0
        ? metrics.requests.responseTimes.sort((a, b) => a - b)[Math.floor(metrics.requests.responseTimes.length * 0.95)]
        : null
    },
    error_rate: metrics.requests.errorRate,
    throughput: {
      requests_per_second: metrics.requests.total / Math.max(1, (Date.now() - monitoring.startTime) / 1000)
    },
    memory: metrics.memory,
    database: {
      avg_query_time: metrics.database.averageQueryTime,
      query_count: metrics.database.queryCount
    },
    timestamp: new Date().toISOString()
  });
});

// Server info endpoint
app.get('/api/v1/info', (req, res) => {
  res.json({
    name: 'Disney Infinity Community Server',
    description: 'Community-maintained server for Disney Infinity 3.0 Gold multiplayer',
    version: '1.0.0',
    endpoints: {
      health: '/api/v1/health',
      auth: {
        register: 'POST /api/v1/auth/register',
        login: 'POST /api/v1/auth/login',
        refresh: 'POST /api/v1/auth/refresh'
      },
      toybox: {
        list: 'GET /api/v1/toybox',
        upload: 'POST /api/v1/toybox',
        download: 'GET /api/v1/toybox/{id}',
        screenshot: 'GET /api/v1/toybox/{id}/screenshot',
        rate: 'POST /api/v1/toybox/{id}/rate'
      },
      health: {
        status: 'GET /api/v1/health',
        metrics: 'GET /api/v1/metrics',
        performance: 'GET /api/v1/monitoring/performance'
      },
      matchmaking: {
        join: 'POST /api/v1/matchmaking/join',
        leave: 'POST /api/v1/matchmaking/leave',
        status: 'GET /api/v1/matchmaking/status',
        stats: 'GET /api/v1/matchmaking/stats'
      },
      sessions: {
        create: 'POST /api/v1/sessions/create',
        join: 'POST /api/v1/sessions/join',
        leave: 'POST /api/v1/sessions/{sessionId}/leave',
        get: 'GET /api/v1/sessions/{sessionId}',
        list: 'GET /api/v1/sessions',
        updateStatus: 'PUT /api/v1/sessions/{sessionId}/status'
      },
      networking: {
        iceServers: 'GET /api/v1/networking/ice-servers',
        iceCandidates: 'POST /api/v1/networking/ice-candidates',
        natType: 'POST /api/v1/networking/nat-type',
        diagnostics: 'GET /api/v1/networking/diagnostics/{sessionId}',
        sessionDiagnostics: 'GET /api/v1/networking/diagnostics/session/{sessionId}',
        connectivityTest: 'POST /api/v1/networking/connectivity-test',
        connectionResult: 'POST /api/v1/networking/connection-result',
        analytics: 'GET /api/v1/networking/analytics',
        recommendations: 'GET /api/v1/networking/recommendations'
      },
      steam: {
        register: 'POST /api/v1/steam/register',
        lobby: 'GET /api/v1/steam/lobby/{sessionId}',
        createLobby: 'POST /api/v1/steam/lobby/{sessionId}/create',
        updateLobby: 'PUT /api/v1/steam/lobby/{sessionId}/metadata',
        friends: 'GET /api/v1/steam/friends',
        overlay: 'POST /api/v1/steam/overlay',
        achievements: 'GET /api/v1/steam/achievements'
      },
      presence: {
        update: 'POST /api/v1/presence/update',
        friends: 'GET /api/v1/presence/friends',
        onlineFriends: 'GET /api/v1/presence/friends/online',
        me: 'GET /api/v1/presence/me',
        bulk: 'POST /api/v1/presence/bulk'
      },
      friends: {
        sendRequest: 'POST /api/v1/friends/request',
        acceptRequest: 'POST /api/v1/friends/accept',
        declineRequest: 'POST /api/v1/friends/decline',
        removeFriend: 'DELETE /api/v1/friends/remove/{friendId}',
        pendingRequests: 'GET /api/v1/friends/requests/pending',
        sentRequests: 'GET /api/v1/friends/requests/sent',
        list: 'GET /api/v1/friends/list',
        online: 'GET /api/v1/friends/online',
        invite: 'POST /api/v1/friends/invite'
      },
      stats: {
        submitMatch: 'POST /api/v1/stats/match',
        getPlayer: 'GET /api/v1/stats/player/{userId}',
        leaderboard: 'GET /api/v1/stats/leaderboard',
        recentMatches: 'GET /api/v1/stats/recent'
      },
      profile: {
        getProfile: 'GET /api/v1/profile',
        updateProfile: 'PUT /api/v1/profile',
        updateAvatar: 'PUT /api/v1/profile/avatar',
        detailedStats: 'GET /api/v1/profile/stats/detailed',
        publicProfile: 'GET /api/v1/profile/public/{userId}'
      },
      achievements: {
        getAchievements: 'GET /api/v1/achievements',
        getPlayerAchievements: 'GET /api/v1/achievements/player/{userId}',
        getNotifications: 'GET /api/v1/achievements/notifications',
        markNotificationsRead: 'PUT /api/v1/achievements/notifications/read',
        leaderboard: 'GET /api/v1/achievements/leaderboard',
        triggerCheck: 'POST /api/v1/achievements/check'
      },
      sync: {
        syncDevice: 'POST /api/v1/sync',
        getSyncStatus: 'GET /api/v1/sync/status',
        removeDevice: 'DELETE /api/v1/sync/device/{deviceId}',
        getConflicts: 'GET /api/v1/sync/conflicts',
        resolveConflicts: 'POST /api/v1/sync/conflicts/resolve',
        forceFullSync: 'POST /api/v1/sync/force'
      },
      analytics: {
        getPlayerAnalytics: 'GET /api/v1/analytics/player/{userId}',
        getServerAnalytics: 'GET /api/v1/analytics/server',
        getPerformanceTrends: 'GET /api/v1/analytics/trends'
      },
      admin: {
        stats: 'GET /api/v1/admin/stats',
        moderateToybox: 'PUT /api/v1/admin/toybox/{id}/status',
        deleteToybox: 'DELETE /api/v1/admin/toybox/{id}',
        pendingReviews: 'GET /api/v1/admin/reviews/pending',
        featureToybox: 'PUT /api/v1/admin/toybox/{id}/feature',
        cleanupStats: 'GET /api/v1/admin/cleanup/stats',
        runCleanup: 'POST /api/v1/admin/cleanup/run',
        databaseHealth: 'GET /api/v1/admin/database/health',
        optimizeDatabase: 'POST /api/v1/admin/database/optimize'
      }
    },
    features: [
      'Toybox sharing',
      'User authentication',
      'Matchmaking queue',
      'Session management',
      'Multiplayer games',
      'P2P networking',
      'NAT traversal',
      'ICE candidate exchange',
      'Network diagnostics',
      'Network analytics',
      'Connection monitoring',
      'Steam integration',
      'Steam networking',
      'Steam overlay support',
      'Real-time presence',
      'WebSocket communication',
      'Friend system',
      'Friend requests',
      'Friend lists',
      'Game invitations',
      'Social notifications',
      'Game statistics',
      'Leaderboards',
      'Performance tracking',
      'Performance monitoring',
      'API rate limiting',
      'Request monitoring',
      'Health checks',
      'Performance metrics',
      'Automated testing',
      'Quality assurance'
    ]
  });
});

// Import routes
const authRoutes = require('./routes/auth');
const toyboxRoutes = require('./routes/toybox');
const adminRoutes = require('./routes/admin');
const matchmakingRoutes = require('./routes/matchmaking');
const sessionsRoutes = require('./routes/sessions');
const networkingRoutes = require('./routes/networking');
const steamRoutes = require('./routes/steam');
const presenceRoutes = require('./routes/presence');
const friendsRoutes = require('./routes/friends');
const statsRoutes = require('./routes/stats');
const profileRoutes = require('./routes/profile');
const achievementsRoutes = require('./routes/achievements');
const syncRoutes = require('./routes/sync');
const analyticsRoutes = require('./routes/analytics');

// Import middleware
const { rateLimiters } = require('./middleware/rateLimit');
const monitoring = require('./services/monitoring');

// Import Socket.io handlers
const { initializeSocketServer } = require('./socket');

// Enhanced environment variable logging for debugging
console.log('🔍 PRODUCTION DEBUG: Environment Variables Check');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('SUPABASE_URL present:', !!process.env.SUPABASE_URL);
console.log('SUPABASE_URL value:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET');
console.log('SUPABASE_SERVICE_ROLE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('SUPABASE_SERVICE_ROLE_KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0);
console.log('SUPABASE_SERVICE_KEY present:', !!process.env.SUPABASE_SERVICE_KEY);
console.log('SUPABASE_SERVICE_KEY length:', process.env.SUPABASE_SERVICE_KEY?.length || 0);
console.log('SUPABASE_ANON_KEY present:', !!process.env.SUPABASE_ANON_KEY);
console.log('JWT_SECRET present:', !!process.env.JWT_SECRET);
console.log('ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS);
console.log('PORT:', process.env.PORT);

// Test Supabase client initialization directly
console.log('🔧 SUPABASE CLIENT DEBUG:');
try {
  const { createClient } = require('@supabase/supabase-js');
  const testClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  console.log('✅ Supabase client created successfully');

  // Test basic connection
  testClient.from('users').select('count', { count: 'exact', head: true })
    .then(result => {
      console.log('✅ Supabase connection test result:', result);
      if (result.error) {
        console.log('❌ Supabase connection error:', result.error);
      } else {
        console.log('🎉 Supabase connection successful! Count:', result.count);
      }
    })
    .catch(err => {
      console.log('❌ Supabase connection test failed:', err.message);
      console.log('Full error:', err);
    });
} catch (initError) {
  console.log('❌ Failed to create Supabase client:', initError.message);
}

// Test database connection on startup
const { testConnection } = require('./config/database');
testConnection().then(connected => {
  if (connected) {
    logger.info('Database connection established');

    // Initialize Socket.io server
    initializeSocketServer(io);
    logger.info('Socket.io server initialized');

    // Initialize achievement service
    const achievementService = require('./services/achievementService');
    achievementService.initialize().then(() => {
      logger.info('Achievement service initialized');
    }).catch(err => {
      logger.error('Failed to initialize achievement service:', err);
    });

    // Start periodic cleanup scheduler
    const { schedulePeriodicCleanup } = require('./services/cleanup');
    schedulePeriodicCleanup();
    logger.info('Periodic cleanup scheduler started');

    // Start memory monitoring
    setInterval(() => {
      const memUsage = monitoring.recordMemoryUsage();
      if (memUsage > 400) { // Log if memory usage is high
        logger.warn(`High memory usage detected: ${memUsage}MB`);
      }
    }, 30000); // Check every 30 seconds
    logger.info('Memory monitoring started');
  } else {
    logger.error('Failed to connect to database');
    console.log('💥 DATABASE CONNECTION FAILED - CHECK SUPABASE CONFIGURATION');
    process.exit(1);
  }
});

// Mount routes with rate limiting
app.use('/api/v1/auth', rateLimiters.auth, authRoutes);
app.use('/api/v1/toybox', rateLimiters.general, toyboxRoutes);
app.use('/api/v1/admin', rateLimiters.admin, adminRoutes);
app.use('/api/v1/matchmaking', rateLimiters.general, matchmakingRoutes);
app.use('/api/v1/sessions', rateLimiters.general, sessionsRoutes);
app.use('/api/v1/networking', rateLimiters.network, networkingRoutes);
app.use('/api/v1/steam', rateLimiters.general, steamRoutes);
app.use('/api/v1/presence', rateLimiters.presence, presenceRoutes);
app.use('/api/v1/friends', rateLimiters.friends, friendsRoutes);
app.use('/api/v1/stats', rateLimiters.stats, statsRoutes);
app.use('/api/v1/profile', rateLimiters.general, profileRoutes);
app.use('/api/v1/achievements', rateLimiters.general, achievementsRoutes);
app.use('/api/v1/sync', rateLimiters.general, syncRoutes);
app.use('/api/v1/analytics', rateLimiters.general, analyticsRoutes);


// 404 handler for unknown endpoints
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `API endpoint ${req.method} ${req.path} not found`
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred'
    }
  });
});

// Start server
server.listen(PORT, () => {
  logger.info(`🚀 Disney Infinity Community Server started`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    cors_origins: corsOptions.origin
  });

  console.log(`🎮 Disney Infinity Community Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`ℹ️  Server info: http://localhost:${PORT}/api/v1/info`);
  console.log(`🔌 WebSocket server: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
