const { Pool } = require('pg');
const winston = require('winston');

/**
 * Database configuration and connection management
 */

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
});

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
