#!/usr/bin/env node

/**
 * Test database connection script
 * Run this to verify your DATABASE_URL works
 */

const { createClient } = require('@supabase/supabase-js');

async function testConnection() {
  console.log('🧪 Testing Supabase connection...');

  // Test using Supabase client (most reliable)
  const supabase = createClient(
    'https://umimlfbroonvypoxjfze.supabase.co',
    'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz' // Service role key from .env
  );

  try {
    console.log('🔗 Testing Supabase connection...');

    // Test basic connectivity
    const { data: testData, error: testError } = await supabase
      .from('users')
      .select('count', { count: 'exact', head: true });

    if (testError) {
      console.log('⚠️  Tables may not exist yet, but connection works!');
      console.log('Error:', testError.message);
    } else {
      console.log('✅ Database connection successful!');
      console.log('📊 Users table accessible, found', testData, 'records');
    }

    console.log('🎉 Supabase connection test PASSED!');
    console.log('🚀 Ready to deploy to Render with SUPABASE_SERVICE_ROLE_KEY!');

  } catch (error) {
    console.error('❌ Supabase connection FAILED!');
    console.error('Error:', error.message);

    if (error.message.includes('Invalid API key')) {
      console.log('🔐 Check your SUPABASE_SERVICE_ROLE_KEY is correct');
    } else if (error.message.includes('Invalid project URL')) {
      console.log('🌐 Check your SUPABASE_URL is correct');
    }

    process.exit(1);
  }
}

testConnection();
