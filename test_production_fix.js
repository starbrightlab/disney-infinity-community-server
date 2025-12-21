#!/usr/bin/env node

/**
 * Test script to verify the production Supabase connectivity fix
 * Simulates the production environment with correct variable names
 */

// Set up environment variables like Render
process.env.NODE_ENV = 'production';
process.env.SUPABASE_URL = 'https://umimlfbroonvypoxjfze.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaW1sZmJyb29udnlwb3hqZnplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjIzMDA1OSwiZXhwIjoyMDgxODA2MDU5fQ.ErKxJ1QWHWyRKd0PKjmwlp1-MPvKs9lwoXOm68C2vJ4';
process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaW1sZmJyb29udnlwb3hqZnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzAwNTksImV4cCI6MjA4MTgwNjA1OX0.jiGUYbTd_SG0ByS3wsnP8-BPqNRxQcHLshwV1jzX9Kc';
process.env.JWT_SECRET = 'test_jwt_secret';

console.log('🧪 TESTING PRODUCTION SUPABASE CONNECTIVITY FIX');
console.log('================================================');

// Test the database connection
const { testConnection } = require('./config/database');

testConnection().then(success => {
  if (success) {
    console.log('✅ Database connection test PASSED');

    // Test a simple query
    const { supabase } = require('./config/database');
    supabase.from('users').select('id,username').limit(1).then(result => {
      if (result.error) {
        console.log('❌ Query test FAILED:', result.error);
        process.exit(1);
      } else {
        console.log('✅ Query test PASSED');
        console.log('📊 Sample data:', result.data);
        console.log('🎉 ALL TESTS PASSED - PRODUCTION FIX VERIFIED!');
        process.exit(0);
      }
    });
  } else {
    console.log('❌ Database connection test FAILED');
    process.exit(1);
  }
}).catch(err => {
  console.log('💥 Unexpected error:', err);
  process.exit(1);
});
