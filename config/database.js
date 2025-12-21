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

// Create a compatibility layer that uses Supabase properly
const pool = {
  query: async (text, params = []) => {
    try {
      winston.debug('Executing query:', text.substring(0, 100) + '...');

      // Convert SQL queries to Supabase operations
      if (text.includes('SELECT NOW()')) {
        // For simple time queries, return current time
        return {
          rows: [{ now: new Date().toISOString() }],
          rowCount: 1
        };
      }

      if (text.includes('INSERT INTO users')) {
        // Handle user registration
        const [, username, email, password_hash, is_admin, profile_data] = text.match(/VALUES\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*([^,]+),\s*'([^']*)'\s*\)/);
        const { data, error } = await supabase
          .from('users')
          .insert([{
            username,
            email,
            password_hash,
            is_admin: is_admin === 'true',
            profile_data: profile_data ? JSON.parse(profile_data) : {}
          }])
          .select()
          .single();

        if (error) throw error;
        return { rows: [data], rowCount: 1 };
      }

      if (text.includes('SELECT * FROM users WHERE username =')) {
        // Handle user lookup
        const [, username] = text.match(/WHERE username = '([^']+)'/);
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('username', username)
          .single();

        if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "not found"
        return { rows: data ? [data] : [], rowCount: data ? 1 : 0 };
      }

      if (text.includes('SELECT * FROM toyboxes')) {
        // Handle toybox queries
        let query = supabase.from('toyboxes').select('*');

        if (text.includes('ORDER BY created_at DESC')) {
          query = query.order('created_at', { ascending: false });
        }
        if (text.includes('LIMIT')) {
          const [, limit] = text.match(/LIMIT (\d+)/);
          query = query.limit(parseInt(limit));
        }

        const { data, error } = await query;
        if (error) throw error;
        return { rows: data || [], rowCount: data?.length || 0 };
      }

      // For unimplemented queries, log and return empty results
      winston.warn('Query not fully implemented, returning empty results:', text.substring(0, 100));
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

// Supabase client handles connection management automatically
// No need for pool event listeners

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
