#!/usr/bin/env node

/**
 * Local test script for toybox queries and health check debugging
 */

// Set up environment to use local Supabase
process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
process.env.SUPABASE_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

console.log('🧪 TESTING TOYBOX QUERIES LOCALLY');
console.log('=====================================');

// Test basic toybox query
async function testToyboxQueries() {
  const { createClient } = require('@supabase/supabase-js');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('1. Testing basic toybox query...');
  try {
    const { data, error } = await supabase
      .from('toyboxes')
      .select('id,title,created_at,creator_id')
      .limit(5);

    if (error) {
      console.log('❌ Basic toybox query failed:', error);
      return;
    }

    console.log('✅ Basic toybox query passed:', data?.length || 0, 'results');
    if (data && data.length > 0) {
      console.log('📊 Sample:', data[0]);
    }
  } catch (err) {
    console.log('💥 Basic toybox query exception:', err.message);
  }

  console.log('\n2. Testing toybox with status filter...');
  try {
    const { data, error } = await supabase
      .from('toyboxes')
      .select('id,title,created_at,creator_id,status')
      .eq('status', 3)
      .limit(5);

    if (error) {
      console.log('❌ Status filter query failed:', error);
      return;
    }

    console.log('✅ Status filter query passed:', data?.length || 0, 'results');
  } catch (err) {
    console.log('💥 Status filter query exception:', err.message);
  }

  console.log('\n3. Testing complex toybox query with JOIN...');
  try {
    // Simulate the complex query from listToyboxes
    const { data, error } = await supabase
      .from('toyboxes')
      .select(`
        id,title,created_at,creator_id,status,
        users!inner(username)
      `)
      .eq('status', 3)
      .limit(5);

    if (error) {
      console.log('❌ Complex JOIN query failed:', error);
      console.log('Error details:', error.message);
      return;
    }

    console.log('✅ Complex JOIN query passed:', data?.length || 0, 'results');
    if (data && data.length > 0) {
      console.log('📊 Sample with JOIN:', JSON.stringify(data[0], null, 2));
    }
  } catch (err) {
    console.log('💥 Complex JOIN query exception:', err.message);
  }

  console.log('\n4. Testing direct SQL query simulation...');
  try {
    // Test the raw query logic
    const { data, error } = await supabase.rpc('exec_sql', {
      query: 'SELECT t.id, t.title, u.username FROM toyboxes t LEFT JOIN users u ON t.creator_id = u.id WHERE t.status = 3 LIMIT 5'
    });

    if (error) {
      console.log('❌ Raw SQL query failed:', error);
    } else {
      console.log('✅ Raw SQL query passed:', data?.length || 0, 'results');
    }
  } catch (err) {
    console.log('💥 Raw SQL query exception:', err.message);
  }
}

// Test health check logic
async function testHealthCheck() {
  console.log('\n5. Testing health check logic...');

  const monitoring = require('./services/monitoring');

  // Simulate some metrics
  monitoring.metrics.requests.total = 10;
  monitoring.metrics.database.errors = 0;

  try {
    const health = monitoring.getHealthStatus();
    console.log('✅ Health check passed:', health);
  } catch (err) {
    console.log('❌ Health check failed:', err.message);
    console.log('Stack:', err.stack);
  }
}

async function main() {
  await testToyboxQueries();
  await testHealthCheck();
  console.log('\n🎯 LOCAL TESTING COMPLETE');
}

main().catch(err => {
  console.error('💥 Test script failed:', err);
  process.exit(1);
});
