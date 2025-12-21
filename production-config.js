/**
 * Disney Infinity Community Server - Production Configuration
 * This file contains production environment variables and configuration
 * Copy this to your production environment and fill in the required values
 */

module.exports = {
  // Environment
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',

  // Server Configuration
  PORT: 10000,
  ALLOWED_ORIGINS: ['https://api.dibeyond.com', 'https://dibeyond.com'],

  // Database Configuration - REPLACE WITH PRODUCTION VALUES
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:[PRODUCTION_PASSWORD]@db.[PRODUCTION_PROJECT_REF].supabase.co:5432/postgres',

  // Supabase Configuration - REPLACE WITH PRODUCTION VALUES
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://[PRODUCTION_PROJECT_REF].supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '[PRODUCTION_ANON_KEY]',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '[PRODUCTION_SERVICE_ROLE_KEY]',

  // JWT Configuration - GENERATE SECURE RANDOM SECRET
  JWT_SECRET: process.env.JWT_SECRET || '[SECURE_RANDOM_JWT_SECRET_64_CHARS]',

  // Redis Configuration (for caching and sessions) - OPTIONAL FOR INITIAL DEPLOYMENT
  REDIS_URL: process.env.REDIS_URL || null,

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 100,

  // File Upload Configuration
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  UPLOAD_PATH: '/tmp/uploads',

  // Security Headers
  SECURITY_HEADERS: true,
  HSTS_MAX_AGE: 31536000,

  // Monitoring
  ENABLE_METRICS: true,
  METRICS_INTERVAL: 30000,

  // Steam Integration
  STEAM_API_KEY: process.env.STEAM_API_KEY || null,
  STEAM_APP_ID: 226400,

  // Email Configuration (for notifications)
  SMTP_HOST: process.env.SMTP_HOST || null,
  SMTP_PORT: process.env.SMTP_PORT || 587,
  SMTP_USER: process.env.SMTP_USER || null,
  SMTP_PASS: process.env.SMTP_PASS || null,

  // Admin Configuration
  ADMIN_EMAIL: 'admin@dibeyond.com',
  SUPPORT_EMAIL: 'support@dibeyond.com',

  // Backup Configuration
  BACKUP_ENABLED: true,
  BACKUP_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
  BACKUP_RETENTION_DAYS: 30,

  // CDN Configuration
  CDN_URL: 'https://cdn.dibeyond.com',
  CDN_ENABLED: true,

  // Health Check Configuration
  HEALTH_CHECK_ENABLED: true,
  HEALTH_CHECK_INTERVAL: 60000,

  // Memory Management
  MEMORY_WARNING_THRESHOLD: 400,
  MEMORY_CRITICAL_THRESHOLD: 500,

  // Connection Pool Configuration
  DB_POOL_MAX: 20,
  DB_POOL_IDLE_TIMEOUT: 30000,
  DB_POOL_CONNECTION_TIMEOUT: 2000,

  // Socket.io Configuration
  SOCKET_PING_TIMEOUT: 60000,
  SOCKET_PING_INTERVAL: 25000,

  // WebRTC Configuration
  WEBRTC_ENABLED: true,
  STUN_SERVERS: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  TURN_SERVERS: process.env.TURN_SERVERS || null,

  // Feature Flags
  ENABLE_MULTIPLAYER: true,
  ENABLE_TOYBOX_SHARING: true,
  ENABLE_ACHIEVEMENTS: true,
  ENABLE_FRIENDS: true,
  ENABLE_LEADERBOARDS: true,
  ENABLE_ANALYTICS: true,
  ENABLE_BACKUPS: true,

  // Performance Tuning
  QUERY_TIMEOUT: 30000,
  MAX_CONNECTIONS_PER_IP: 10,
  CACHE_TTL: 3600000,

  // Session Configuration
  SESSION_TIMEOUT: 3600000,
  SESSION_SECURE: true,

  // Cookie Configuration
  COOKIE_SECURE: true,
  COOKIE_HTTP_ONLY: true,
  COOKIE_SAME_SITE: 'strict',

  // Maintenance Mode
  MAINTENANCE_MODE: false,
  MAINTENANCE_MESSAGE: 'Server is currently under maintenance. Please check back later.',

  // Beta Testing
  BETA_MODE: true,
  BETA_ACCESS_CODES: process.env.BETA_ACCESS_CODES ? process.env.BETA_ACCESS_CODES.split(',') : ['BETA2024'],

  // Legal Compliance
  PRIVACY_POLICY_URL: 'https://dibeyond.com/privacy',
  TERMS_OF_SERVICE_URL: 'https://dibeyond.com/terms',
  COOKIE_POLICY_URL: 'https://dibeyond.com/cookies',

  // Regional Settings
  DEFAULT_TIMEZONE: 'UTC',
  SUPPORTED_LOCALES: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],

  // Database Optimization
  DB_OPTIMIZATION_ENABLED: true,
  DB_QUERY_LOGGING: true,
  DB_SLOW_QUERY_THRESHOLD: 1000,

  // Cache Configuration
  CACHE_ENABLED: !!process.env.REDIS_URL,
  CACHE_STRATEGY: 'lru',
  CACHE_MAX_SIZE: 1000,
  CACHE_TTL_DEFAULT: 3600000,

  // Queue Configuration
  QUEUE_ENABLED: true,
  QUEUE_MAX_SIZE: 10000,
  QUEUE_PROCESS_INTERVAL: 1000,

  // Notification Settings
  EMAIL_NOTIFICATIONS_ENABLED: !!process.env.SMTP_HOST,
  PUSH_NOTIFICATIONS_ENABLED: false,
  IN_GAME_NOTIFICATIONS_ENABLED: true,

  // Security
  BRUTE_FORCE_PROTECTION_ENABLED: true,
  BRUTE_FORCE_MAX_ATTEMPTS: 5,
  BRUTE_FORCE_WINDOW_MS: 15 * 60 * 1000,

  // Data Retention
  USER_DATA_RETENTION_DAYS: 365,
  GAME_DATA_RETENTION_DAYS: 90,
  LOG_RETENTION_DAYS: 30,

  // Monitoring Thresholds
  CPU_WARNING_THRESHOLD: 70,
  CPU_CRITICAL_THRESHOLD: 90,
  MEMORY_WARNING_THRESHOLD: 80,
  MEMORY_CRITICAL_THRESHOLD: 95,
  DISK_WARNING_THRESHOLD: 80,
  DISK_CRITICAL_THRESHOLD: 95,

  // Alert Configuration
  ALERT_EMAIL_ENABLED: !!process.env.SMTP_HOST,
  ALERT_SMS_ENABLED: false,
  ALERT_WEBHOOK_ENABLED: false,

  // Scaling Configuration
  AUTO_SCALING_ENABLED: true,
  MIN_INSTANCES: 1,
  MAX_INSTANCES: 10,
  SCALE_UP_THRESHOLD: 70,
  SCALE_DOWN_THRESHOLD: 30,

  // API Rate Limits by Endpoint
  AUTH_RATE_LIMIT: 10,
  TOYBOX_RATE_LIMIT: 50,
  MATCHMAKING_RATE_LIMIT: 30,
  SESSIONS_RATE_LIMIT: 20,
  PRESENCE_RATE_LIMIT: 100,
  FRIENDS_RATE_LIMIT: 30,
  STATS_RATE_LIMIT: 50,
  PROFILE_RATE_LIMIT: 30,
  ACHIEVEMENTS_RATE_LIMIT: 50,
  ANALYTICS_RATE_LIMIT: 20,
  ADMIN_RATE_LIMIT: 10,
  NETWORKING_RATE_LIMIT: 100,
  STEAM_RATE_LIMIT: 30,
  SYNC_RATE_LIMIT: 20,

  // Database Connection Limits
  DB_MAX_CONNECTIONS: 100,
  DB_IDLE_TIMEOUT: 60000,
  DB_CONNECTION_TIMEOUT: 10000,

  // External Service Timeouts
  SUPABASE_TIMEOUT: 30000,
  REDIS_TIMEOUT: 5000,
  STEAM_API_TIMEOUT: 10000,
  EMAIL_TIMEOUT: 30000,

  // Geographic Restrictions (if needed)
  ALLOWED_COUNTRIES: 'all',
  BLOCKED_COUNTRIES: 'none',

  // Content Moderation
  CONTENT_MODERATION_ENABLED: true,
  AUTO_MODERATION_ENABLED: true,
  MODERATION_THRESHOLD: 0.8,

  // Performance Benchmarks
  TARGET_RESPONSE_TIME: 200,
  TARGET_ERROR_RATE: 0.01,
  TARGET_UPTIME: 99.9,

  // Cost Optimization
  COST_OPTIMIZATION_ENABLED: true,
  IDLE_TIMEOUT: 300000,
  CONNECTION_POOL_OPTIMIZATION: true
};
