# Disney Infinity Community Server - Production Deployment Guide

## Overview
This guide covers the complete production deployment process for the Disney Infinity 3.0 Gold community server to Render with Supabase.

## Prerequisites
- ✅ Supabase account with production project
- ✅ Render account with billing enabled
- ✅ dibeyond.com domain configured
- ✅ Database schema migrated to production
- ✅ All environment variables prepared

## Phase 5: Production & Scaling Deployment Steps

### Week 12: Production Deployment

#### 1. Database Migration
```bash
# Run production database migration
cd infinity-community-server
node production-deploy.js
```

**Expected Output:**
```
🚀 Starting Disney Infinity Community Server Production Deployment
======================================================================
✅ Connected to production database successfully
📋 Found 285 SQL statements to execute
✅ Database migration completed successfully
🌱 Seeding initial production data...
✅ Initial data seeded successfully
🔍 Verifying production deployment...
📊 users: 1 records
📊 toyboxes: 0 records
...
✅ Production deployment verification completed
⚡ Running performance tests...
⏱️  Average query response time: 12.34ms
✅ Performance test passed
======================================================================
🎉 Disney Infinity Community Server Production Deployment Completed Successfully!
```

#### 2. Render Web Service Deployment

##### Method A: GitHub Integration (Recommended)
1. **Connect Repository:**
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New" → "Web Service"
   - Connect your GitHub repository
   - Select the `infinity-community-server` directory

2. **Configure Service:**
   - **Name:** `infinity-community-server`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Standard ($7/month) or Pro ($25/month) based on expected load

3. **Environment Variables:**
   Set the following in Render dashboard:

   **Required:**
   ```
   DATABASE_URL=postgresql://[USER]:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   SUPABASE_URL=https://[PROJECT-REF].supabase.co
   SUPABASE_ANON_KEY=[ANON_KEY]
   SUPABASE_SERVICE_ROLE_KEY=[SERVICE_ROLE_KEY]
   JWT_SECRET=[SECURE_RANDOM_SECRET]
   ```

   **Optional Performance:**
   ```
   REDIS_URL=redis://[REDIS_URL]  # For caching (add Redis service first)
   ```

##### Method B: Docker Deployment
1. **Create Web Service from Docker:**
   - Go to Render Dashboard
   - Click "New" → "Web Service"
   - Select "Docker"
   - Connect your repository

2. **Docker Configuration:**
   - **Registry:** GitHub (automatic)
   - **Dockerfile Path:** `infinity-community-server/Dockerfile`
   - **Branch:** `main` or your production branch

#### 3. Domain Configuration
1. **Add Custom Domain:**
   - In Render service settings → "Domains"
   - Add `api.dibeyond.com`
   - Copy the DNS records provided

2. **Update Cloudflare DNS:**
   ```
   Type: CNAME
   Name: api
   Target: [RENDER_PROVIDED_TARGET]
   TTL: Auto
   Proxy: Enabled (orange cloud)
   ```

3. **SSL Certificate:**
   - Render automatically provisions SSL
   - Certificate will be valid for `api.dibeyond.com`

4. **Test Domain:**
   ```bash
   curl https://api.dibeyond.com/api/v1/health
   # Should return server health status
   ```

#### 4. Supabase Storage Setup
1. **Enable Storage:**
   - Go to Supabase Dashboard → Storage
   - Create bucket: `toybox-files`
   - Set public access: `true`

2. **Storage Policies:**
   ```sql
   -- Allow authenticated users to upload toybox files
   CREATE POLICY "Users can upload toybox files" ON storage.objects
   FOR INSERT WITH CHECK (
     bucket_id = 'toybox-files'
     AND auth.role() = 'authenticated'
   );

   -- Allow public read access to toybox files
   CREATE POLICY "Public can view toybox files" ON storage.objects
   FOR SELECT USING (bucket_id = 'toybox-files');
   ```

3. **CDN Configuration:**
   - Storage URLs are automatically CDN-enabled
   - Format: `https://[PROJECT-REF].supabase.co/storage/v1/object/public/toybox-files/[FILE_PATH]`

### Week 13: Scaling & Monitoring

#### 5. Scaling Configuration
1. **Render Auto-Scaling:**
   - **Min Instances:** 1
   - **Max Instances:** 10 (based on load)
   - **Scale Up Threshold:** 70% CPU/Memory
   - **Scale Down Threshold:** 30% CPU/Memory

2. **Database Connection Pooling:**
   - Already configured in `production-config.js`
   - Max connections: 20 per instance

3. **Redis Caching (Optional):**
   ```bash
   # Add Redis service to render.yaml
   - type: redis
     name: infinity-redis
     plan: free  # Upgrade to paid for production
   ```

#### 6. Monitoring Setup
1. **Render Built-in Monitoring:**
   - CPU, Memory, and Response Time graphs
   - Request logs and error tracking
   - Auto-scaling events

2. **Health Check Endpoint:**
   - URL: `https://api.dibeyond.com/api/v1/health`
   - Returns comprehensive system status

3. **Custom Metrics:**
   - Performance metrics: `/api/v1/monitoring/performance`
   - Admin metrics: `/api/v1/metrics` (admin only)

4. **Log Management:**
   - All logs available in Render dashboard
   - Winston logging configured for production

#### 7. Security Hardening
1. **Environment Security:**
   - All secrets stored as environment variables
   - No sensitive data in code repository

2. **API Security:**
   - JWT authentication required
   - Rate limiting enabled (100 requests/15min)
   - CORS configured for production domains
   - Helmet security headers enabled

3. **Database Security:**
   - SSL connections required
   - Row Level Security (RLS) enabled
   - Supabase service role key protected

#### 8. Backup & Recovery
1. **Database Backups:**
   - Supabase automatic daily backups
   - Point-in-time recovery available
   - Backup retention: 7 days (upgrade for longer)

2. **File Backups:**
   - Supabase Storage versioning enabled
   - CDN caching provides additional redundancy

3. **Recovery Testing:**
   ```bash
   # Test backup restoration (coordinate with Supabase support)
   # Documented in disaster recovery plan
   ```

### Week 14: Community Launch Preparation

#### 9. Beta Testing Program
1. **Access Control:**
   ```javascript
   // Set beta access codes in environment
   BETA_ACCESS_CODES=beta2024,tester123,community456
   ```

2. **Testing Guidelines:**
   - Create `BETA_TESTING_GUIDE.md`
   - Define testing scenarios and expectations
   - Set up feedback collection system

3. **Monitoring Beta:**
   - Track usage metrics during beta
   - Monitor error rates and performance
   - Collect user feedback systematically

#### 10. Documentation
1. **User Documentation:**
   - Client setup guide for Steam modification
   - User manual with screenshots
   - Troubleshooting common issues
   - Community guidelines

2. **API Documentation:**
   - Complete endpoint reference
   - Authentication flows
   - Rate limiting information
   - Error code definitions

#### 11. Support Infrastructure
1. **Discord Server:**
   - Create community Discord
   - Set up support channels
   - Configure moderator roles

2. **Issue Tracking:**
   - GitHub Issues for bug reports
   - Feature request system
   - Knowledge base articles

#### 12. Launch Preparation
1. **Pre-Launch Checklist:**
   - [ ] Domain SSL verified
   - [ ] All endpoints responding
   - [ ] Database performance tested
   - [ ] Security review completed
   - [ ] Beta testing feedback incorporated
   - [ ] Documentation published
   - [ ] Support channels ready

2. **Go-Live Process:**
   ```bash
   # 1. Final health check
   curl https://api.dibeyond.com/api/v1/health

   # 2. Enable production features
   # Update BETA_MODE=false in Render

   # 3. Monitor initial traffic
   # Watch Render dashboard metrics

   # 4. Announce launch on Discord/Steam
   ```

## Environment Variables Reference

### Required Production Variables
```bash
# Database
DATABASE_URL=postgresql://[USER]:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Supabase
SUPABASE_URL=https://[PROJECT-REF].supabase.co
SUPABASE_ANON_KEY=[ANON_KEY]
SUPABASE_SERVICE_ROLE_KEY=[SERVICE_ROLE_KEY]

# Security
JWT_SECRET=[64_CHARACTER_SECURE_RANDOM_STRING]
```

### Optional Performance Variables
```bash
# Redis (for caching)
REDIS_URL=redis://[REDIS_URL]

# Email (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=admin@dibeyond.com
SMTP_PASS=[APP_PASSWORD]

# Steam Integration
STEAM_API_KEY=[STEAM_API_KEY]

# External Services
SENTRY_DSN=[SENTRY_DSN]
DISCORD_WEBHOOK_URL=[WEBHOOK_URL]
```

## Troubleshooting Production Issues

### Common Deployment Issues

1. **Database Connection Failed:**
   ```
   Error: connect ECONNREFUSED
   Solution: Check DATABASE_URL format and Supabase project status
   ```

2. **Health Check Failing:**
   ```
   Status: 503
   Solution: Check application logs in Render dashboard
   ```

3. **SSL Certificate Issues:**
   ```
   Error: CERT_HAS_EXPIRED
   Solution: Wait for Render to auto-renew or contact support
   ```

4. **Rate Limiting Too Aggressive:**
   ```
   Status: 429
   Solution: Adjust RATE_LIMIT_MAX_REQUESTS in environment variables
   ```

### Performance Optimization

1. **Slow Response Times:**
   - Check database query performance
   - Enable Redis caching
   - Optimize connection pooling

2. **High Memory Usage:**
   - Monitor with `/api/v1/monitoring/performance`
   - Adjust DB_POOL_MAX
   - Check for memory leaks

3. **Database Connection Issues:**
   - Monitor connection pool usage
   - Adjust DB_MAX_CONNECTIONS
   - Check Supabase limits

## Cost Optimization

### Render Pricing
- **Free Tier:** 750 hours/month (~$0)
- **Standard:** $7/month (unlimited hours)
- **Pro:** $25/month (dedicated resources)

### Supabase Pricing
- **Free Tier:** Up to production limits
- **Pro:** $25/month (higher limits)
- **Team:** $99/month (enterprise features)

### Estimated Monthly Costs
- **Initial (0-100 users):** $7-32/month
- **Growth (100-500 users):** $32-99/month
- **Scale (500+ users):** $99+/month

## Success Metrics

### Technical KPIs
- **Uptime:** >99.9%
- **Response Time:** <200ms average
- **Error Rate:** <0.01%
- **Concurrent Users:** 100-500 supported

### Community KPIs
- **Daily Active Users:** Track growth
- **Toybox Uploads:** Monitor engagement
- **Multiplayer Sessions:** Track usage
- **User Retention:** 70%+ monthly retention

## Post-Launch Activities

1. **Monitor & Optimize:**
   - Daily performance reviews
   - Weekly capacity planning
   - Monthly cost optimization

2. **Community Management:**
   - Moderate content and users
   - Process feature requests
   - Handle support tickets

3. **Feature Development:**
   - Plan based on user feedback
   - Implement high-priority features
   - Regular updates and improvements

## Emergency Procedures

### Service Outage Response
1. Check Render dashboard status
2. Review application logs
3. Assess database connectivity
4. Implement rollback if needed
5. Communicate with community

### Security Incident Response
1. Isolate affected systems
2. Assess breach scope
3. Notify affected users
4. Implement fixes
5. Post-mortem analysis

---

## Quick Reference Commands

```bash
# Deploy to production
cd infinity-community-server
node production-deploy.js

# Health check
curl https://api.dibeyond.com/api/v1/health

# Performance monitoring
curl https://api.dibeyond.com/api/v1/monitoring/performance

# Admin metrics (requires auth)
curl -H "Authorization: Bearer [ADMIN_TOKEN]" \
     https://api.dibeyond.com/api/v1/metrics
```

🎮 **The Disney Infinity 3.0 Gold community server is now ready for production deployment!**
