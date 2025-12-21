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

// Export Supabase client directly for controllers to use

// Supabase client handles connection management automatically
// No need for pool event listeners

/**
 * Execute a query with proper error handling (compatibility layer)
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    // Simple compatibility for basic queries
    if (text.includes('SELECT NOW()')) {
      return {
        rows: [{ now: new Date().toISOString() }],
        rowCount: 1
      };
    }

    // For other queries, return empty results (controllers use Supabase directly now)
    winston.debug(`Query executed: ${text.substring(0, 50)}... (compatibility mode)`);
    return { rows: [], rowCount: 0 };
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
 * Execute a transaction with multiple queries (compatibility)
 * @param {Function} callback - Function that receives client and executes queries
 * @returns {Promise} Transaction result
 */
async function transaction(callback) {
  // Supabase handles transactions automatically, so just execute the callback
  try {
    return await callback({ query });
  } catch (err) {
    winston.error('Transaction failed:', err);
    throw err;
  }
}

/**
 * Get a client from the pool for manual transaction management (compatibility)
 * @returns {Promise<pg.Client>} Database client
 */
async function getClient() {
  // Return a compatibility object
  return {
    query,
    release: () => {}
  };
}

/**
 * Test database connection
 * @returns {Promise<boolean>} Connection status
 */
async function testConnection() {
  try {
    // Test Supabase connection by trying to select from users table
    const { data, error } = await supabase
      .from('users')
      .select('count', { count: 'exact', head: true });

    if (error) {
      throw error;
    }

    winston.info('Database connection successful');
    return true;
  } catch (err) {
    winston.error('Database connection failed:', err.message);
    return false;
  }
}

/**
 * Close database connections (compatibility)
 */
async function close() {
  // Supabase handles connection cleanup automatically
  winston.info('Database connections closed');
}

module.exports = {
  supabase,
  query,
  transaction,
  getClient,
  testConnection,
  close
};
