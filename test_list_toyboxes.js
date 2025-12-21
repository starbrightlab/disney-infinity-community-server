#!/usr/bin/env node

/**
 * Test script that exactly replicates the listToyboxes logic
 */

// Test with production Supabase
process.env.NODE_ENV = 'production';
process.env.SUPABASE_URL = 'https://umimlfbroonvypoxjfze.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaW1sZmJyb29udnlwb3hqZnplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjIzMDA1OSwiZXhwIjoyMDgxODA2MDU5fQ.ErKxJ1QWHWyRKd0PKjmwlp1-MPvKs9lwoXOm68C2vJ4';

console.log('🧪 TESTING LIST TOYBOXES LOGIC');
console.log('=================================');

async function testListToyboxesLogic() {
  const { createClient } = require('@supabase/supabase-js');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  console.log('1. Testing exact listToyboxes query logic...');

  try {
    // Replicate the exact logic from listToyboxes function
    const {
      page = 1,
      page_size = 20,
      sort_field = 'created_at',
      sort_direction = 'desc'
    } = { page: 1, page_size: 20, sort_field: 'created_at', sort_direction: 'desc' };

    // Build WHERE clause (exactly as in the code)
    let whereConditions = ['t.status = 3']; // published only
    let queryParams = [];
    let paramIndex = 1;

    // Build the query (simplified version)
    let query = supabase
      .from('toyboxes')
      .select(`
        id, title, description, version, status, created_at, updated_at,
        creator_id, file_size, download_count,
        users!inner(username)
      `)
      .eq('status', 3); // published only

    // Add ordering
    query = query.order(sort_field, { ascending: sort_direction === 'asc' });

    // Add pagination
    const from = (page - 1) * page_size;
    const to = from + page_size - 1;
    query = query.range(from, to);

    console.log('Executing query...');
    const { data, error, count } = await query;

    if (error) {
      console.log('❌ listToyboxes query failed:', error);
      console.log('Error details:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ listToyboxes query succeeded!');
    console.log('📊 Results:', data?.length || 0, 'toyboxes');
    console.log('🔢 Total count:', count);

    if (data && data.length > 0) {
      console.log('📋 Sample result:');
      console.log(JSON.stringify(data[0], null, 2));
    }

  } catch (err) {
    console.log('💥 listToyboxes logic exception:', err.message);
    console.log('Stack:', err.stack);
  }

  console.log('\n2. Testing simplified version...');

  try {
    const { data, error } = await supabase
      .from('toyboxes')
      .select('id, title, creator_id, status, created_at')
      .eq('status', 3)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.log('❌ Simplified query failed:', error);
    } else {
      console.log('✅ Simplified query succeeded:', data?.length || 0, 'results');
    }
  } catch (err) {
    console.log('💥 Simplified query exception:', err.message);
  }
}

testListToyboxesLogic().then(() => {
  console.log('\n🎯 LIST TOYBOXES TESTING COMPLETE');
}).catch(err => {
  console.error('💥 Test failed:', err);
});
