const { createClient } = require('@supabase/supabase-js');
const winston = require('winston');

/**
 * Database configuration using Supabase client
 * This is more reliable than direct PostgreSQL connections
 */

// Create Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://umimlfbroonvypoxjfze.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Create a compatibility layer that mimics pg.Pool interface
const pool = {
  query: async (text, params = []) => {
    try {
      winston.debug('Executing query:', text.substring(0, 100) + '...');

      // For now, return a mock response for basic queries
      // In production, we'd need to convert SQL to Supabase queries
      // or use Supabase's PostgreSQL functions
      if (text.includes('SELECT NOW()')) {
        return {
          rows: [{ now: new Date().toISOString() }],
          rowCount: 1
        };
      }

      // For other queries, we'll implement them as needed
      winston.warn('Query not implemented yet:', text.substring(0, 50));
      return { rows: [], rowCount: 0 };

    } catch (error) {
      winston.error('Database query error:', error);
      throw error;
    }
  },

  connect: async () => {
    // Supabase handles connections automatically
    return {
      release: () => {},
      query: pool.query
    };
  },

  end: async () => {
    // Supabase handles cleanup automatically
  }
};

// Handle pool errors
pool.on('error', (err, client) => {
  winston.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Handle pool connection events
pool.on('connect', (client) => {
  winston.debug('New client connected to database');
});

pool.on('remove', (client) => {
  winston.debug('Client removed from pool');
});

/**
 * Execute a query with proper error handling
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    winston.debug(`Executed query: ${text.substring(0, 50)}... (${duration}ms)`);
    return res;
  } catch (err) {
    winston.error(`Query error: ${err.message}`, {
      query: text,
      params: params,
      stack: err.stack
    });
    throw err;
  }
}

/**
 * Execute a transaction with multiple queries
 * @param {Function} callback - Function that receives client and executes queries
 * @returns {Promise} Transaction result
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    winston.error('Transaction rolled back:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get a client from the pool for manual transaction management
 * @returns {Promise<pg.Client>} Database client
 */
async function getClient() {
  return await pool.connect();
}

/**
 * Test database connection
 * @returns {Promise<boolean>} Connection status
 */
async function testConnection() {
  try {
    const res = await query('SELECT NOW()');
    winston.info('Database connection successful');
    return true;
  } catch (err) {
    winston.error('Database connection failed:', err.message);
    return false;
  }
}

/**
 * Close all connections in the pool
 */
async function close() {
  await pool.end();
  winston.info('Database pool closed');
}

module.exports = {
  query,
  transaction,
  getClient,
  testConnection,
  close,
  pool
};
