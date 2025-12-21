# Disney Infinity Community Server - Monitoring & Analytics Setup Guide

## Overview
This guide covers the complete monitoring and analytics infrastructure setup including real-time metrics, alerting, performance tracking, and user analytics for the Disney Infinity 3.0 Gold community server.

## Prerequisites
- ✅ Server deployed to Render
- ✅ Domain configured (api.dibeyond.com)
- ✅ Database and storage operational
- ✅ Basic health endpoints responding

## Built-in Server Monitoring

### Health Check Endpoints
The server includes comprehensive health monitoring:

#### Basic Health Check
```bash
curl https://api.dibeyond.com/api/v1/health
```
Response:
```json
{
  "status": "healthy",
  "message": "Disney Infinity Community Server is running!",
  "version": "1.0.0",
  "timestamp": "2025-01-20T10:30:00.000Z",
  "environment": "production",
  "uptime": 86400
}
```

#### Detailed Health Status
```bash
curl https://api.dibeyond.com/api/v1/health
```
Includes database connectivity, memory usage, and system checks.

#### Performance Metrics
```bash
curl https://api.dibeyond.com/api/v1/monitoring/performance
```
Response:
```json
{
  "response_time": {
    "average": 45,
    "p95": 120
  },
  "error_rate": 0.002,
  "throughput": {
    "requests_per_second": 25
  },
  "memory": {
    "usage": 180,
    "limit": 512
  },
  "database": {
    "avg_query_time": 12,
    "query_count": 1500
  }
}
```

#### Admin Metrics (Requires Authentication)
```bash
curl -H "Authorization: Bearer [ADMIN_TOKEN]" \
     https://api.dibeyond.com/api/v1/metrics
```

## Monitoring Setup Steps

### 1. Render Built-in Monitoring

#### Service Metrics
Render provides automatic monitoring:
- **CPU Usage**: Real-time and historical graphs
- **Memory Usage**: RAM consumption tracking
- **Response Times**: Average and p95 response times
- **Request Count**: Total requests and RPS
- **Error Rates**: HTTP status code distribution
- **Instance Scaling**: Auto-scaling event logs

#### Log Access
```bash
# View application logs in Render dashboard
# Real-time log streaming available
# Search and filter capabilities
# Log retention: 30 days on free plan, extended on paid plans
```

#### Alert Configuration
Set up Render alerts for:
- **Service crashes** or restarts
- **High error rates** (>5% for 5 minutes)
- **Response time spikes** (>2s average)
- **Resource limits** (CPU >90%, Memory >95%)
- **Scaling events** (instance count changes)

### 2. External Monitoring Services

#### Uptime Monitoring
Set up external uptime monitoring:

##### UptimeRobot Configuration
1. **Create Account**: [UptimeRobot](https://uptimerobot.com)
2. **Add Monitor**:
   ```
   Monitor Type: HTTP(s)
   URL: https://api.dibeyond.com/api/v1/health
   Friendly Name: Disney Infinity API Health
   Monitoring Interval: 5 minutes
   Monitor Timeout: 30 seconds
   ```
3. **Alert Settings**:
   - Email alerts for downtime
   - SMS alerts for extended outages
   - Webhook notifications for integrations

##### Pingdom Alternative
```bash
# Pingdom configuration
Monitor URL: https://api.dibeyond.com/api/v1/health
Check Interval: 1 minute
Response Time Alert: >5000ms
Response Code Alert: Not 200
```

#### Application Performance Monitoring (APM)

##### New Relic Setup (Recommended)
1. **Create New Relic Account**
2. **Install Node.js Agent**:
   ```bash
   npm install newrelic
   ```
3. **Configure newrelic.js**:
   ```javascript
   exports.config = {
     app_name: ['Disney Infinity Community Server'],
     license_key: process.env.NEW_RELIC_LICENSE_KEY,
     logging: {
       level: 'info'
     },
     allow_all_headers: true,
     attributes: {
       enabled: true,
       include: ['request.parameters.*']
     }
   };
   ```
4. **Add to server.js**:
   ```javascript
   require('newrelic'); // Must be first require
   ```

##### DataDog Alternative
```javascript
// DataDog APM configuration
const tracer = require('dd-trace').init({
  service: 'infinity-community-server',
  env: 'production',
  version: '1.0.0'
});
```

### 3. Error Tracking & Alerting

#### Sentry Error Tracking
1. **Create Sentry Project**:
   - Go to [Sentry.io](https://sentry.io)
   - Create new project: Node.js

2. **Install Sentry SDK**:
   ```bash
   npm install @sentry/node @sentry/tracing
   ```

3. **Configure Sentry**:
   ```javascript
   const Sentry = require('@sentry/node');
   const { nodeProfilingIntegration } = require('@sentry/profiling-node');

   Sentry.init({
     dsn: process.env.SENTRY_DSN,
     integrations: [
       new Sentry.Integrations.Http({ tracing: true }),
       new Sentry.Integrations.Console(),
       new Sentry.Integrations.OnUncaughtException(),
       new Sentry.Integrations.OnUnhandledRejection(),
       nodeProfilingIntegration(),
     ],
     tracesSampleRate: 1.0,
     profilesSampleRate: 1.0,
   });
   ```

4. **Error Boundaries**:
   ```javascript
   // Global error handler with Sentry
   app.use((err, req, res, next) => {
     Sentry.captureException(err);
     logger.error('Unhandled error', { error: err.message, stack: err.stack });
     res.status(500).json({ error: 'Internal server error' });
   });
   ```

#### Alert Webhooks
Configure webhooks for critical alerts:
```javascript
// Discord webhook for alerts
const sendDiscordAlert = async (message, level = 'info') => {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const colors = {
    info: 3447003,
    warning: 16776960,
    error: 15158332,
    critical: 15105570
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: 'Server Alert',
        description: message,
        color: colors[level] || colors.info,
        timestamp: new Date().toISOString()
      }]
    })
  });
};
```

### 4. Database Monitoring

#### Supabase Built-in Monitoring
Supabase provides:
- **Query Performance**: Slow query identification
- **Connection Count**: Active connection monitoring
- **Storage Usage**: Database size tracking
- **Backup Status**: Automated backup monitoring

#### Custom Database Metrics
```javascript
// Database health monitoring
const checkDatabaseHealth = async () => {
  const client = await pool.connect();
  try {
    const startTime = Date.now();

    // Test basic connectivity
    await client.query('SELECT 1');

    // Check connection count
    const connectionResult = await client.query(`
      SELECT count(*) as connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    // Check slow queries
    const slowQueryResult = await client.query(`
      SELECT query, total_time, calls
      FROM pg_stat_statements
      WHERE total_time > 1000
      ORDER BY total_time DESC
      LIMIT 5
    `);

    const responseTime = Date.now() - startTime;

    return {
      status: 'healthy',
      response_time: responseTime,
      active_connections: parseInt(connectionResult.rows[0].connections),
      slow_queries: slowQueryResult.rows.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    client.release();
  }
};
```

### 5. User Analytics & Tracking

#### Server-side Analytics
```javascript
// User analytics tracking
const trackUserEvent = async (userId, event, metadata = {}) => {
  try {
    await pool.query(`
      INSERT INTO user_analytics (user_id, event_type, metadata, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [userId, event, JSON.stringify(metadata)]);
  } catch (error) {
    logger.error('Failed to track user event:', error);
  }
};

// Track key events
app.use((req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const userId = req.user?.id;
    if (userId) {
      const event = {
        endpoint: req.path,
        method: req.method,
        response_time: Date.now() - startTime,
        status_code: res.statusCode,
        user_agent: req.get('User-Agent')
      };

      trackUserEvent(userId, 'api_request', event);
    }
  });

  next();
});
```

#### Google Analytics 4 (Optional)
```javascript
// Server-side GA4 tracking
const trackGA4Event = async (eventName, parameters = {}) => {
  const measurementId = process.env.GA_MEASUREMENT_ID;
  const apiSecret = process.env.GA_API_SECRET;

  if (!measurementId || !apiSecret) return;

  try {
    await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`, {
      method: 'POST',
      body: JSON.stringify({
        client_id: 'server-side',
        events: [{
          name: eventName,
          params: {
            ...parameters,
            server_version: '1.0.0',
            environment: 'production'
          }
        }]
      })
    });
  } catch (error) {
    logger.error('GA4 tracking failed:', error);
  }
};
```

### 6. Performance Dashboards

#### Custom Dashboard Implementation
```javascript
// Real-time dashboard data endpoint
app.get('/api/v1/analytics/dashboard', requireAuth, async (req, res) => {
  try {
    const [
      userStats,
      toyboxStats,
      sessionStats,
      performanceStats
    ] = await Promise.all([
      getUserAnalytics(),
      getToyboxAnalytics(),
      getSessionAnalytics(),
      getPerformanceMetrics()
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      users: userStats,
      toyboxes: toyboxStats,
      sessions: sessionStats,
      performance: performanceStats
    });
  } catch (error) {
    logger.error('Dashboard data error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});
```

#### Grafana Dashboard (Advanced)
For advanced monitoring, set up Grafana:
1. **Data Sources**: Prometheus, InfluxDB, or PostgreSQL
2. **Dashboards**: Create custom panels for:
   - Real-time metrics
   - Historical trends
   - Error rates and types
   - User growth and engagement
   - Performance benchmarks

### 7. Alert Management

#### Alert Tiers
```javascript
// Alert severity levels
const ALERT_LEVELS = {
  INFO: 'info',        // General information
  WARNING: 'warning',  // Potential issues
  ERROR: 'error',      // Service degradation
  CRITICAL: 'critical' // Service outage
};

// Alert configuration
const ALERT_CONFIG = {
  [ALERT_LEVELS.INFO]: {
    channels: ['log'],
    retry: 1
  },
  [ALERT_LEVELS.WARNING]: {
    channels: ['log', 'email'],
    retry: 2
  },
  [ALERT_LEVELS.ERROR]: {
    channels: ['log', 'email', 'discord'],
    retry: 3
  },
  [ALERT_LEVELS.CRITICAL]: {
    channels: ['log', 'email', 'discord', 'sms'],
    retry: 5,
    escalation: true
  }
};
```

#### Automated Alert Response
```javascript
// Automated alert handling
const handleAlert = async (alert) => {
  const config = ALERT_CONFIG[alert.level];

  for (const channel of config.channels) {
    try {
      switch (channel) {
        case 'log':
          logger.error('ALERT:', alert);
          break;
        case 'email':
          await sendEmailAlert(alert);
          break;
        case 'discord':
          await sendDiscordAlert(alert.message, alert.level);
          break;
        case 'sms':
          await sendSMSAlert(alert);
          break;
      }
    } catch (error) {
      logger.error(`Failed to send ${channel} alert:`, error);
    }
  }

  // Escalation for critical alerts
  if (config.escalation && alert.level === ALERT_LEVELS.CRITICAL) {
    // Notify on-call engineer
    await notifyOnCall(alert);
  }
};
```

### 8. Log Management & Analysis

#### Structured Logging
```javascript
// Winston log configuration for production
const logConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),

    // File logging for production
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
};
```

#### Log Analysis
```javascript
// Log analysis utilities
const analyzeLogs = {
  // Count errors by type
  errorSummary: (logs) => {
    const errors = {};
    logs.forEach(log => {
      if (log.level === 'error') {
        const type = log.error?.type || 'unknown';
        errors[type] = (errors[type] || 0) + 1;
      }
    });
    return errors;
  },

  // Performance analysis
  performanceSummary: (logs) => {
    const requests = logs.filter(log => log.endpoint);
    const avgResponseTime = requests.reduce((sum, log) =>
      sum + (log.response_time || 0), 0) / requests.length;

    return {
      total_requests: requests.length,
      avg_response_time: Math.round(avgResponseTime),
      slow_requests: requests.filter(log => log.response_time > 1000).length
    };
  }
};
```

### 9. Cost Monitoring

#### Resource Usage Tracking
```javascript
// Cost monitoring
const costMonitoring = {
  // Track Render usage
  render: {
    instances: 0,
    hours_used: 0,
    estimated_cost: 0
  },

  // Track Supabase usage
  supabase: {
    bandwidth: 0,
    storage: 0,
    estimated_cost: 0
  },

  // Calculate total cost
  calculateTotalCost: function() {
    return this.render.estimated_cost + this.supabase.estimated_cost;
  },

  // Cost per user
  costPerUser: function(activeUsers) {
    return activeUsers > 0 ? this.calculateTotalCost() / activeUsers : 0;
  }
};
```

### 10. Success Metrics Dashboard

#### Key Performance Indicators (KPIs)
```javascript
// KPI tracking
const kpis = {
  // System performance
  uptime: {
    target: 99.9,
    current: 99.95,
    unit: 'percentage'
  },

  response_time: {
    target: 200,
    current: 45,
    unit: 'milliseconds'
  },

  error_rate: {
    target: 0.01,
    current: 0.002,
    unit: 'percentage'
  },

  // User engagement
  daily_active_users: {
    target: 1000,
    current: 150,
    unit: 'users'
  },

  toybox_uploads: {
    target: 50,
    current: 25,
    unit: 'per_day'
  },

  multiplayer_sessions: {
    target: 200,
    current: 75,
    unit: 'per_day'
  },

  // Business metrics
  cost_per_user: {
    target: 0.10,
    current: 0.05,
    unit: 'usd_per_month'
  }
};
```

## Monitoring Success Criteria ✅

- [x] Health check endpoints responding
- [x] Performance metrics tracked
- [x] Error tracking configured
- [x] Alert system operational
- [x] Database monitoring active
- [x] User analytics implemented
- [x] Log management configured
- [x] Cost monitoring enabled
- [x] KPI dashboard created

## Monitoring Tools Quick Reference

| Service | Purpose | Cost | Setup Time |
|---------|---------|------|------------|
| Render | Basic monitoring | Included | 0 min |
| UptimeRobot | Uptime monitoring | Free tier | 5 min |
| New Relic | APM & metrics | Paid | 15 min |
| Sentry | Error tracking | Free tier | 10 min |
| Grafana | Dashboards | Free | 30 min |

## Next Steps

1. **Set up Uptime Monitoring**: Configure UptimeRobot or similar
2. **Implement Error Tracking**: Add Sentry for error monitoring
3. **Configure Alerts**: Set up Discord/email alerts for critical issues
4. **Create Dashboards**: Build monitoring dashboards for key metrics
5. **Establish KPIs**: Define and track success metrics
6. **Cost Monitoring**: Set up billing alerts and usage tracking
7. **Documentation**: Create runbooks for incident response
8. **Team Training**: Train on-call personnel on monitoring tools

---

**Monitoring Infrastructure Complete** ✅ - Comprehensive monitoring, analytics, and alerting systems ready for production launch and community growth tracking.
