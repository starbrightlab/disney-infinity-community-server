const winston = require('winston');

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
        status: errorRate < 5 ? 'healthy' : errorRate < 15 ? 'warning' : 'critical',
        database: this.metrics.database.errors < 10,
        memory: this.recordMemoryUsage() < 500 // Less than 500MB
      }
    };
  }

  // Health check
  getHealthStatus() {
    const metrics = this.getMetrics();

    return {
      status: metrics.health.status,
      timestamp: metrics.timestamp,
      uptime: Math.round(metrics.uptime / 1000), // seconds
      checks: {
        database: {
          status: metrics.health.database ? 'ok' : 'error',
          query_count: metrics.database.queryCount,
          error_count: metrics.database.errors
        },
        memory: {
          status: metrics.health.memory ? 'ok' : 'warning',
          current_mb: metrics.memory.currentUsage,
          peak_mb: metrics.memory.peakUsage
        },
        requests: {
          status: metrics.requests.errorRate < 10 ? 'ok' : 'warning',
          total: metrics.requests.total,
          error_rate: metrics.requests.errorRate
        },
        websocket: {
          status: 'ok', // WebSocket is always "ok" if server is running
          active_connections: metrics.websocket.activeConnections
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

  // Performance alert thresholds
  checkThresholds() {
    const metrics = this.getMetrics();
    const alerts = [];

    if (metrics.requests.averageResponseTime > 1000) { // 1 second
      alerts.push({
        type: 'warning',
        message: `High average response time: ${metrics.requests.averageResponseTime}ms`,
        metric: 'response_time'
      });
    }

    if (metrics.requests.errorRate > 10) {
      alerts.push({
        type: 'error',
        message: `High error rate: ${metrics.requests.errorRate}%`,
        metric: 'error_rate'
      });
    }

    if (metrics.database.averageQueryTime > 50) { // 50ms
      alerts.push({
        type: 'warning',
        message: `Slow database queries: ${metrics.database.averageQueryTime}ms average`,
        metric: 'db_query_time'
      });
    }

    if (metrics.memory.currentUsage > 400) { // 400MB
      alerts.push({
        type: 'warning',
        message: `High memory usage: ${metrics.memory.currentUsage}MB`,
        metric: 'memory_usage'
      });
    }

    return alerts;
  }
}

// Singleton instance
const monitoring = new MonitoringService();

module.exports = monitoring;
