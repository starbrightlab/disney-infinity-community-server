#!/usr/bin/env node

// Temporary script to test database connection
require('dotenv').config();

async function testConnection() {
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  try {
    console.log('Testing database connection...');
    const client = await pool.connect();
    console.log('✅ Connected to database successfully!');

    // Test a simple query
    const result = await client.query('SELECT NOW() as current_time, version() as postgres_version');
    console.log('📅 Current time:', result.rows[0].current_time);
    console.log('🐘 PostgreSQL version:', result.rows[0].postgres_version.substring(0, 50) + '...');

    // Check if our tables exist
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'game_sessions', 'matchmaking_queue', 'session_players')
      ORDER BY table_name
    `);

    console.log('\n📋 Tables found:');
    tablesResult.rows.forEach(row => {
      console.log(`  ✅ ${row.table_name}`);
    });

    if (tablesResult.rows.length < 4) {
      console.log('\n⚠️  Some expected tables are missing. You may need to run the migration.');
    }

    client.release();
    console.log('\n🎉 Database test completed successfully!');
    process.exit(0);

  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    if (err.code) {
      console.error('   Error code:', err.code);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
