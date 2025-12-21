#!/usr/bin/env node

/**
 * Production Deployment Script for Disney Infinity Community Server
 * This script handles the complete production deployment process
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const winston = require('winston');

// Configure logging for production deployment
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'production-deploy.log' })
  ]
});

class ProductionDeployer {
  constructor() {
    this.config = require('./production-config');
    this.client = null;
  }

  async connectToProductionDB() {
    logger.info('Connecting to production database...');

    // Use environment variables or config for production connection
    const dbConfig = {
      connectionString: process.env.DATABASE_URL || this.config.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Required for Supabase
    };

    this.client = new Client(dbConfig);

    try {
      await this.client.connect();
      logger.info('✅ Connected to production database successfully');
      return true;
    } catch (err) {
      logger.error('❌ Failed to connect to production database:', err.message);
      return false;
    }
  }

  async runMigration() {
    logger.info('🚀 Starting database migration to production...');

    try {
      // Read the production migration SQL file
      const migrationPath = path.join(__dirname, '..', 'production_migration.sql');
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Split into statements (handle PostgreSQL-specific syntax)
      const statements = this.splitSQLStatements(migrationSQL);

      logger.info(`📋 Found ${statements.length} SQL statements to execute`);

      // Execute each statement
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i].trim();
        if (statement) {
          try {
            logger.debug(`Executing statement ${i + 1}/${statements.length}...`);
            await this.client.query(statement);
          } catch (err) {
            // Check if it's an "already exists" error (acceptable)
            if (err.code === '42P07' || err.message.includes('already exists')) {
              logger.warn(`⚠️  Statement ${i + 1} skipped (already exists): ${statement.substring(0, 50)}...`);
            } else {
              logger.error(`❌ Statement ${i + 1} failed: ${err.message}`);
              logger.debug(`Failed statement: ${statement}`);
              throw err;
            }
          }
        }
      }

      logger.info('✅ Database migration completed successfully');

    } catch (err) {
      logger.error('❌ Migration failed:', err);
      throw err;
    }
  }

  splitSQLStatements(sql) {
    // Split on semicolons but be careful with function definitions and comments
    const statements = [];
    let currentStatement = '';
    let inFunction = false;
    let inComment = false;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1] || '';

      // Handle comments
      if (!inString && !inFunction) {
        if (char === '-' && nextChar === '-') {
          inComment = true;
          currentStatement += char;
          continue;
        }
        if (inComment && char === '\n') {
          inComment = false;
        }
      }

      if (inComment) {
        currentStatement += char;
        continue;
      }

      // Handle strings
      if (!inComment && !inFunction) {
        if ((char === '"' || char === "'") && !inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar && inString) {
          inString = false;
          stringChar = '';
        }
      }

      // Handle function definitions
      if (!inString && !inComment) {
        if (char === '$' && nextChar === '$') {
          inFunction = !inFunction;
        }
      }

      // Add character to current statement
      currentStatement += char;

      // Check for statement end
      if (!inString && !inFunction && !inComment && char === ';') {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }

    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    return statements.filter(stmt => stmt.length > 0);
  }

  async seedInitialData() {
    logger.info('🌱 Seeding initial production data...');

    try {
      // Insert initial achievements
      await this.client.query(`
        INSERT INTO achievements (id, name, description, icon, category, points, requirements, rarity)
        VALUES
          (gen_random_uuid(), 'Welcome to Disney Infinity', 'Complete your first login', 'welcome.png', 'general', 10, '{"login": true}', 'common'),
          (gen_random_uuid(), 'Toybox Creator', 'Upload your first toybox', 'creator.png', 'toybox', 25, '{"toybox_uploads": 1}', 'common'),
          (gen_random_uuid(), 'Multiplayer Pioneer', 'Join your first multiplayer game', 'pioneer.png', 'multiplayer', 50, '{"games_played": 1}', 'uncommon'),
          (gen_random_uuid(), 'Social Butterfly', 'Add your first friend', 'butterfly.png', 'social', 15, '{"friends_added": 1}', 'common'),
          (gen_random_uuid(), 'Champion', 'Win your first multiplayer match', 'champion.png', 'multiplayer', 100, '{"games_won": 1}', 'rare')
        ON CONFLICT DO NOTHING
      `);

      // Insert admin user (password should be changed after first login)
      const bcrypt = require('bcryptjs');
      const adminPassword = await bcrypt.hash('ChangeMe123!', 10);

      await this.client.query(`
        INSERT INTO users (username, email, password_hash, is_admin, profile_data, created_at)
        VALUES (
          'admin',
          'admin@dibeyond.com',
          $1,
          true,
          '{"display_name": "Administrator", "bio": "System Administrator", "avatar": null}',
          NOW()
        )
        ON CONFLICT (username) DO NOTHING
      `, [adminPassword]);

      logger.info('✅ Initial data seeded successfully');

    } catch (err) {
      logger.error('❌ Failed to seed initial data:', err);
      throw err;
    }
  }

  async verifyDeployment() {
    logger.info('🔍 Verifying production deployment...');

    try {
      // Check table counts
      const tables = [
        'users', 'toyboxes', 'toybox_ratings', 'toybox_downloads', 'toybox_likes',
        'matchmaking_queue', 'game_sessions', 'session_players', 'player_presence',
        'friend_requests', 'friends', 'game_stats', 'player_stats', 'network_quality',
        'achievements'
      ];

      for (const table of tables) {
        const result = await this.client.query(`SELECT COUNT(*) as count FROM ${table}`);
        logger.info(`📊 ${table}: ${result.rows[0].count} records`);
      }

      // Check admin user
      const adminCheck = await this.client.query('SELECT username, is_admin FROM users WHERE username = $1', ['admin']);
      if (adminCheck.rows.length > 0) {
        logger.info('👤 Admin user created:', adminCheck.rows[0]);
      }

      // Test a complex query
      const complexQuery = await this.client.query(`
        SELECT
          u.username,
          COUNT(t.id) as toyboxes_created,
          COUNT(DISTINCT r.user_id) as ratings_received,
          AVG(r.rating) as average_rating
        FROM users u
        LEFT JOIN toyboxes t ON u.id = t.creator_id
        LEFT JOIN toybox_ratings r ON t.id = r.toybox_id
        GROUP BY u.id, u.username
        LIMIT 5
      `);

      logger.info('🧪 Complex query test passed');

      logger.info('✅ Production deployment verification completed');

    } catch (err) {
      logger.error('❌ Deployment verification failed:', err);
      throw err;
    }
  }

  async runPerformanceTests() {
    logger.info('⚡ Running performance tests...');

    try {
      const startTime = Date.now();

      // Test basic queries
      for (let i = 0; i < 10; i++) {
        await this.client.query('SELECT COUNT(*) FROM users');
        await this.client.query('SELECT COUNT(*) FROM toyboxes');
        await this.client.query('SELECT COUNT(*) FROM matchmaking_queue');
      }

      const endTime = Date.now();
      const avgResponseTime = (endTime - startTime) / 30;

      logger.info(`⏱️  Average query response time: ${avgResponseTime.toFixed(2)}ms`);

      if (avgResponseTime < 50) {
        logger.info('✅ Performance test passed');
      } else {
        logger.warn('⚠️  Performance test completed (response time above 50ms)');
      }

    } catch (err) {
      logger.error('❌ Performance test failed:', err);
      throw err;
    }
  }

  async cleanup() {
    if (this.client) {
      await this.client.end();
      logger.info('🔌 Database connection closed');
    }
  }

  async deploy() {
    try {
      logger.info('🚀 Starting Disney Infinity Community Server Production Deployment');
      logger.info('=' .repeat(70));

      // Step 1: Connect to production database
      const connected = await this.connectToProductionDB();
      if (!connected) {
        throw new Error('Failed to connect to production database');
      }

      // Step 2: Run database migration
      await this.runMigration();

      // Step 3: Seed initial data
      await this.seedInitialData();

      // Step 4: Verify deployment
      await this.verifyDeployment();

      // Step 5: Run performance tests
      await this.runPerformanceTests();

      logger.info('=' .repeat(70));
      logger.info('🎉 Disney Infinity Community Server Production Deployment Completed Successfully!');
      logger.info('');
      logger.info('📋 Next Steps:');
      logger.info('1. Update production-config.js with actual production values');
      logger.info('2. Deploy application server to Render');
      logger.info('3. Configure domain (api.dibeyond.com)');
      logger.info('4. Set up monitoring and alerting');
      logger.info('5. Configure backup systems');
      logger.info('6. Run beta testing program');

    } catch (err) {
      logger.error('💥 Production deployment failed:', err);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }
}

// Run deployment if executed directly
if (require.main === module) {
  const deployer = new ProductionDeployer();
  deployer.deploy();
}

module.exports = ProductionDeployer;
