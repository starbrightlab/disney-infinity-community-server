#!/usr/bin/env node

// Check users in database
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function checkUsers() {
  const { query } = require('./config/database');

  try {
    const result = await query('SELECT id, username FROM users LIMIT 5');
    console.log('Users in database:');
    result.rows.forEach(user => console.log('  -', user.id, user.username));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkUsers();
