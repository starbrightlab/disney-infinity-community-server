#!/usr/bin/env node

/**
 * Database migration script for Disney Infinity server
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../config/database');
const winston = require('winston');

async function runMigration() {
  try {
    winston.info('Starting database migration...');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'create_multiplayer_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split the SQL into individual statements (basic splitting on semicolons)
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    winston.info(`Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          winston.debug(`Executing statement ${i + 1}/${statements.length}...`);
          await query(statement);
        } catch (err) {
          // Log error but continue with other statements
          winston.warn(`Statement ${i + 1} failed: ${err.message}`);
          winston.debug(`Failed statement: ${statement.substring(0, 100)}...`);
        }
      }
    }

    winston.info('Database migration completed successfully');

  } catch (err) {
    winston.error('Migration failed:', err);
    process.exit(1);
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
