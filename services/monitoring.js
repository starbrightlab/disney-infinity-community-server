const winston = require('winston');
const { testConnection } = require('../config/database');

// Performance monitoring service
class MonitoringService {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        byEndpoint: new Map(),
        byMethod: new Map(),
        responseTimes: [],
        errors: {
          total: 0,
          byEndpoint: new Map(),
          byCode: new Map()
        }
      },
      database: {
        queryCount: 0,
        totalQueryTime: 0,
        slowQueries: [],
        errors: 0
      },
      websocket: {
        connections: 0,
        messages: 0,
        errors: 0
      },
      memory: {
        usage: [],
        peaks: []
      }
    };

    this.startTime = Date.now();
    this.lastReset = Date.now();

    // Configurable alert thresholds
    this.thresholds = {
      error_rate_critical: 50,     // 50% error rate = critical
      error_rate_warning: 10,      // 10% error rate = warning
      response_time_critical: 5000, // 5 seconds = critical
      response_time_warning: 1000,  // 1 second = warning
      db_query_time_warning: 50,    // 50ms average = warning
      memory_critical: 800,         // 800MB = critical
      memory_warning: 500,          // 500MB = warning
      db_errors_critical: 10         // 10+ DB errors = critical
    };

    // Alert state tracking
    this.alerts = {
      active: new Map(), // Current active alerts
      history: [],       // Alert history
      lastChecked: Date.now()
    };
  }

  // Request monitoring
  recordRequest(req, res, responseTime) {
    this.metrics.requests.total++;

    const endpoint = `${req.method} ${req.route?.path || req.path}`;
    const method = req.method;

    // Track by endpoint
    if (!this.metrics.requests.byEndpoint.has(endpoint)) {
      this.metrics.requests.byEndpoint.set(endpoint, 0);
    }
    this.metrics.requests.byEndpoint.set(endpoint, this.metrics.requests.byEndpoint.get(endpoint) + 1);

    // Track by method
    if (!this.metrics.requests.byMethod.has(method)) {
      this.metrics.requests.byMethod.set(method, 0);
    }
    this.metrics.requests.byMethod.set(method, this.metrics.requests.byMethod.get(method) + 1);

    // Track response times (keep last 1000)
    this.metrics.requests.responseTimes.push(responseTime);
    if (this.metrics.requests.responseTimes.length > 1000) {
      this.metrics.requests.responseTimes.shift();
    }

    // Track errors
    if (res.statusCode >= 400) {
      this.metrics.requests.errors.total++;

      if (!this.metrics.requests.errors.byEndpoint.has(endpoint)) {
        this.metrics.requests.errors.byEndpoint.set(endpoint, 0);
      }
      this.metrics.requests.errors.byEndpoint.set(endpoint,
        this.metrics.requests.errors.byEndpoint.get(endpoint) + 1);

      const statusCode = res.statusCode.toString();
      if (!this.metrics.requests.errors.byCode.has(statusCode)) {
        this.metrics.requests.errors.byCode.set(statusCode, 0);
      }
      this.metrics.requests.errors.byCode.set(statusCode,
        this.metrics.requests.errors.byCode.get(statusCode) + 1);
    }
  }

  // Database monitoring
  recordDatabaseQuery(query, duration) {
    this.metrics.database.queryCount++;
    this.metrics.database.totalQueryTime += duration;

    // Track slow queries (>100ms)
    if (duration > 100) {
      this.metrics.database.slowQueries.push({
        query: query.substring(0, 200),
        duration,
        timestamp: Date.now()
      });

      // Keep only last 100 slow queries
      if (this.metrics.database.slowQueries.length > 100) {
        this.metrics.database.slowQueries.shift();
      }
    }
  }

  recordDatabaseError() {
    this.metrics.database.errors++;
  }

  // WebSocket monitoring
  recordWebSocketConnection(change) {
    this.metrics.websocket.connections += change;
  }

  recordWebSocketMessage() {
    this.metrics.websocket.messages++;
  }

  recordWebSocketError() {
    this.metrics.websocket.errors++;
  }

  // Memory monitoring
  recordMemoryUsage() {
    const usage = process.memoryUsage();
    const heapUsed = Math.round(usage.heapUsed / 1024 / 1024); // MB

    this.metrics.memory.usage.push({
      heapUsed,
      timestamp: Date.now()
    });

    // Keep last 100 measurements
    if (this.metrics.memory.usage.length > 100) {
      this.metrics.memory.usage.shift();
    }

    // Track peaks
    if (this.metrics.memory.peaks.length === 0 ||
        heapUsed > this.metrics.memory.peaks[this.metrics.memory.peaks.length - 1]) {
      this.metrics.memory.peaks.push(heapUsed);
      if (this.metrics.memory.peaks.length > 10) {
        this.metrics.memory.peaks.shift();
      }
    }

    return heapUsed;
  }

  // Get comprehensive metrics
  getMetrics() {
    const uptime = Date.now() - this.startTime;
    const avgResponseTime = this.metrics.requests.responseTimes.length > 0
      ? this.metrics.requests.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.requests.responseTimes.length
      : 0;

    const avgQueryTime = this.metrics.database.queryCount > 0
      ? this.metrics.database.totalQueryTime / this.metrics.database.queryCount
      : 0;

    const errorRate = this.metrics.requests.total > 0
      ? (this.metrics.requests.errors.total / this.metrics.requests.total) * 100
      : 0;

    return {
      uptime,
      timestamp: Date.now(),
      requests: {
        total: this.metrics.requests.total,
        averageResponseTime: Math.round(avgResponseTime * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        errors: {
          total: this.metrics.requests.errors.total,
          byCode: Object.fromEntries(this.metrics.requests.errors.byCode),
          topEndpoints: Array.from(this.metrics.requests.errors.byEndpoint.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
        },
        topEndpoints: Array.from(this.metrics.requests.byEndpoint.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        byMethod: Object.fromEntries(this.metrics.requests.byMethod)
      },
      database: {
        queryCount: this.metrics.database.queryCount,
        averageQueryTime: Math.round(avgQueryTime * 100) / 100,
        errors: this.metrics.database.errors,
        slowQueries: this.metrics.database.slowQueries.slice(-5) // Last 5 slow queries
      },
      websocket: {
        activeConnections: this.metrics.websocket.connections,
        totalMessages: this.metrics.websocket.messages,
        errors: this.metrics.websocket.errors
      },
      memory: {
        currentUsage: this.recordMemoryUsage(),
        peakUsage: Math.max(...this.metrics.memory.peaks),
        averageUsage: this.metrics.memory.usage.length > 0
          ? Math.round(this.metrics.memory.usage.reduce((sum, m) => sum + m.heapUsed, 0) / this.metrics.memory.usage.length)
          : 0
      },
      health: {
        status: errorRate < 20 ? 'healthy' : errorRate < 50 ? 'warning' : 'critical',
        database: this.metrics.database.errors < 50, // Keep for backward compatibility
        memory: this.recordMemoryUsage() < 800 // Less than 800MB
      }
    };
  }

  // Database health check
  async checkDatabaseHealth() {
    try {
      const startTime = Date.now();
      const isConnected = await testConnection();
      const responseTime = Date.now() - startTime;

      if (isConnected) {
        return {
          status: 'ok',
          response_time: responseTime,
          query_count: this.metrics.database.queryCount,
          error_count: this.metrics.database.errors
        };
      } else {
        return {
          status: 'error',
          response_time: responseTime,
          query_count: this.metrics.database.queryCount,
          error_count: this.metrics.database.errors,
          message: 'Database connection failed'
        };
      }
    } catch (err) {
      winston.error('Database health check failed:', err);
      return {
        status: 'error',
        response_time: 0,
        query_count: this.metrics.database.queryCount,
        error_count: this.metrics.database.errors + 1,
        message: err.message
      };
    }
  }

  // Health check
  async getHealthStatus() {
    const metrics = this.getMetrics();
    const dbHealth = await this.checkDatabaseHealth();

    // Determine overall status based on checks
    let overallStatus = 'healthy';
    let statusMessage = 'All systems operational';

    // Critical failures
    if (dbHealth.status !== 'ok') {
      overallStatus = 'critical';
      statusMessage = 'Database connection failed';
    } else if (metrics.memory.currentUsage > 800) {
      overallStatus = 'critical';
      statusMessage = 'Memory usage critically high';
    } else if (metrics.requests.errorRate > 50) {
      overallStatus = 'critical';
      statusMessage = 'Error rate critically high';
    } else if (metrics.requests.averageResponseTime > 5000) {
      overallStatus = 'critical';
      statusMessage = 'Response times critically slow';
    }
    // Warnings
    else if (metrics.memory.currentUsage > 500 ||
             metrics.requests.errorRate > 10 ||
             metrics.requests.averageResponseTime > 1000) {
      overallStatus = 'warning';
      statusMessage = 'Some systems showing warnings';
    }

    return {
      status: overallStatus,
      message: statusMessage,
      timestamp: metrics.timestamp,
      uptime: Math.round(metrics.uptime / 1000), // seconds
      checks: {
        database: dbHealth,
        memory: {
          status: metrics.memory.currentUsage > 500 ? 'warning' : 'ok',
          current_mb: metrics.memory.currentUsage,
          peak_mb: metrics.memory.peakUsage,
          average_mb: metrics.memory.averageUsage
        },
        requests: {
          status: metrics.requests.errorRate < 10 ? 'ok' : (metrics.requests.errorRate < 50 ? 'warning' : 'error'),
          total: metrics.requests.total,
          error_rate: metrics.requests.errorRate,
          average_response_time: metrics.requests.averageResponseTime
        },
        websocket: {
          status: 'ok', // WebSocket is always "ok" if server is running
          active_connections: metrics.websocket.activeConnections,
          total_messages: metrics.websocket.messages,
          errors: metrics.websocket.errors
        }
      }
    };
  }

  // Reset metrics (for testing or periodic resets)
  reset() {
    this.metrics = {
      requests: {
        total: 0,
        byEndpoint: new Map(),
        byMethod: new Map(),
        responseTimes: [],
        errors: {
          total: 0,
          byEndpoint: new Map(),
          byCode: new Map()
        }
      },
      database: {
        queryCount: 0,
        totalQueryTime: 0,
        slowQueries: [],
        errors: 0
      },
      websocket: {
        connections: 0,
        messages: 0,
        errors: 0
      },
      memory: {
        usage: [],
        peaks: []
      }
    };
    this.lastReset = Date.now();
  }

  // Configure alert thresholds
  setThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    winston.info('Alert thresholds updated:', this.thresholds);
  }

  // Performance alert thresholds with state management
  checkThresholds() {
    const metrics = this.getMetrics();
    const currentTime = Date.now();
    const newAlerts = [];
    const activeAlerts = new Map(this.alerts.active);

    // Check response time
    const responseTimeAlert = this.checkMetricThreshold(
      'response_time',
      metrics.requests.averageResponseTime,
      this.thresholds.response_time_warning,
      this.thresholds.response_time_critical,
      `High average response time: ${metrics.requests.averageResponseTime}ms`
    );

    // Check error rate
    const errorRateAlert = this.checkMetricThreshold(
      'error_rate',
      metrics.requests.errorRate,
      this.thresholds.error_rate_warning,
      this.thresholds.error_rate_critical,
      `High error rate: ${metrics.requests.errorRate}%`
    );

    // Check database query time
    const dbQueryAlert = this.checkMetricThreshold(
      'db_query_time',
      metrics.database.averageQueryTime,
      this.thresholds.db_query_time_warning,
      null, // No critical threshold for DB query time
      `Slow database queries: ${metrics.database.averageQueryTime}ms average`
    );

    // Check memory usage
    const memoryAlert = this.checkMetricThreshold(
      'memory_usage',
      metrics.memory.currentUsage,
      this.thresholds.memory_warning,
      this.thresholds.memory_critical,
      `High memory usage: ${metrics.memory.currentUsage}MB`
    );

    // Check database errors
    const dbErrorAlert = this.checkMetricThreshold(
      'db_errors',
      metrics.database.errors,
      null,
      this.thresholds.db_errors_critical,
      `High database error count: ${metrics.database.errors} errors`
    );

    // Process alerts
    [responseTimeAlert, errorRateAlert, dbQueryAlert, memoryAlert, dbErrorAlert]
      .filter(alert => alert)
      .forEach(alert => {
        const alertKey = `${alert.metric}_${alert.type}`;

        // If alert is new or escalated, add to new alerts
        const existingAlert = activeAlerts.get(alertKey);
        if (!existingAlert || existingAlert.type !== alert.type) {
          newAlerts.push(alert);
          activeAlerts.set(alertKey, { ...alert, firstSeen: currentTime });
        }
      });

    // Check for resolved alerts
    const resolvedAlerts = [];
    for (const [key, alert] of activeAlerts.entries()) {
      if (!this.isAlertStillActive(key, metrics)) {
        resolvedAlerts.push({
          ...alert,
          resolved: true,
          resolvedAt: currentTime,
          duration: currentTime - alert.firstSeen
        });
        activeAlerts.delete(key);
      }
    }

    // Update alert state
    this.alerts.active = activeAlerts;
    this.alerts.lastChecked = currentTime;

    // Add to history
    newAlerts.forEach(alert => {
      this.alerts.history.push({
        ...alert,
        timestamp: currentTime
      });
    });

    resolvedAlerts.forEach(alert => {
      this.alerts.history.push({
        ...alert,
        timestamp: currentTime
      });
    });

    // Keep history manageable (last 1000 alerts)
    if (this.alerts.history.length > 1000) {
      this.alerts.history = this.alerts.history.slice(-1000);
    }

    return {
      new: newAlerts,
      resolved: resolvedAlerts,
      active: Array.from(activeAlerts.values())
    };
  }

  // Helper method to check if a metric exceeds thresholds
  checkMetricThreshold(metricName, value, warningThreshold, criticalThreshold, message) {
    if (criticalThreshold !== null && value >= criticalThreshold) {
      return {
        type: 'critical',
        message: `${message} (CRITICAL)`,
        metric: metricName,
        value: value,
        threshold: criticalThreshold
      };
    } else if (warningThreshold !== null && value >= warningThreshold) {
      return {
        type: 'warning',
        message: `${message} (WARNING)`,
        metric: metricName,
        value: value,
        threshold: warningThreshold
      };
    }
    return null;
  }

  // Helper method to check if an alert is still active
  isAlertStillActive(alertKey, metrics) {
    const parts = alertKey.split('_');
    const metric = parts[0];
    const type = parts[1];

    switch (metric) {
      case 'response_time':
        return (type === 'critical' && metrics.requests.averageResponseTime >= this.thresholds.response_time_critical) ||
               (type === 'warning' && metrics.requests.averageResponseTime >= this.thresholds.response_time_warning);
      case 'error_rate':
        return (type === 'critical' && metrics.requests.errorRate >= this.thresholds.error_rate_critical) ||
               (type === 'warning' && metrics.requests.errorRate >= this.thresholds.error_rate_warning);
      case 'db_query_time':
        return metrics.database.averageQueryTime >= this.thresholds.db_query_time_warning;
      case 'memory_usage':
        return (type === 'critical' && metrics.memory.currentUsage >= this.thresholds.memory_critical) ||
               (type === 'warning' && metrics.memory.currentUsage >= this.thresholds.memory_warning);
      case 'db_errors':
        return metrics.database.errors >= this.thresholds.db_errors_critical;
      default:
        return false;
    }
  }

  // Get alert summary
  getAlertSummary() {
    const alerts = this.checkThresholds();
    return {
      active_count: alerts.active.length,
      new_count: alerts.new.length,
      resolved_count: alerts.resolved.length,
      active_alerts: alerts.active,
      recent_alerts: this.alerts.history.slice(-10) // Last 10 alerts
    };
  }
}

// Singleton instance
const monitoring = new MonitoringService();

module.exports = monitoring;
