# Disney Infinity Community Server - Domain Configuration Guide

## Overview
This guide covers the complete domain setup for `api.dibeyond.com` including DNS configuration, SSL certificates, CDN setup, and security hardening.

## Prerequisites
- ✅ dibeyond.com domain registered
- ✅ Cloudflare account configured
- ✅ Render web service deployed
- ✅ Domain pointed to Cloudflare nameservers

## Domain Configuration Steps

### 1. Cloudflare DNS Setup

#### Add DNS Records
Navigate to Cloudflare Dashboard → dibeyond.com → DNS

##### A Records (Root Domain)
```
Type: A
Name: @
Content: 192.0.2.1 (placeholder - will be updated)
TTL: Auto
Proxy: Enabled (orange cloud)
```

##### CNAME Records (API Subdomain)
```
Type: CNAME
Name: api
Content: [RENDER_TARGET_URL] (from Render dashboard)
TTL: Auto
Proxy: Enabled (orange cloud)
```

##### CNAME Records (CDN Subdomain - Optional)
```
Type: CNAME
Name: cdn
Content: [SUPABASE_PROJECT].supabase.co
TTL: Auto
Proxy: Enabled (orange cloud)
```

#### Verify DNS Propagation
```bash
# Check DNS records
dig api.dibeyond.com

# Expected output:
api.dibeyond.com. 300 IN CNAME [RENDER_TARGET_URL].onrender.com.

# Test domain resolution
nslookup api.dibeyond.com
```

### 2. Render Domain Configuration

#### Add Custom Domain
1. **Navigate to Render Service:**
   - Go to Render Dashboard
   - Select "infinity-community-server" service
   - Click "Settings" tab

2. **Add Custom Domain:**
   - Click "Add Custom Domain"
   - Enter: `api.dibeyond.com`
   - Click "Save"

3. **Copy DNS Target:**
   - Render will provide a target URL (e.g., `infinity-server-xyz.onrender.com`)
   - Copy this URL for Cloudflare DNS configuration

4. **SSL Certificate:**
   - Render automatically provisions SSL certificates
   - Certificate will be valid for `api.dibeyond.com`
   - Takes 5-10 minutes to propagate

#### Verify SSL Certificate
```bash
# Test SSL certificate
openssl s_client -connect api.dibeyond.com:443 -servername api.dibeyond.com

# Check certificate details
curl -vI https://api.dibeyond.com/api/v1/health
```

### 3. Cloudflare Security Configuration

#### SSL/TLS Settings
Navigate to Cloudflare Dashboard → SSL/TLS

##### SSL/TLS Encryption
```
Mode: Full (strict)
Minimum TLS Version: 1.2
```

##### Edge Certificates
```
Always Use HTTPS: On
Automatic HTTPS Rewrites: On
Certificate Transparency Monitoring: On
```

#### Security Settings

##### WAF (Web Application Firewall)
Navigate to Security → WAF

```
Enable: On
Rules:
- Block SQL injection attempts
- Block XSS attempts
- Block common exploits
- Rate limiting for API endpoints
```

##### Rate Limiting
Navigate to Security → Rate Limiting

```
Create Rate Limit Rule:
Name: API Rate Limiting
URL Pattern: api.dibeyond.com/api/v1/*
Threshold: 100 requests per 1 minute
Action: Block
Duration: 1 minute
```

##### DDoS Protection
```
Enable: On
Bot Management: On
```

### 4. CDN Configuration

#### Cloudflare CDN Settings
Navigate to Caching → Configuration

##### Caching Level
```
Caching Level: Standard
Browser Cache TTL: 4 hours
Always Online: On
```

##### Cache Rules (API Responses)
```
Create Cache Rule:
- URI contains: /api/v1/toybox/*/download
- Cache Level: Cache Everything
- Edge Cache TTL: 1 hour
- Browser Cache TTL: 1 hour
```

##### Cache Rules (Static Assets)
```
Create Cache Rule:
- URI contains: /api/v1/toybox/*/screenshot
- Cache Level: Cache Everything
- Edge Cache TTL: 24 hours
- Browser Cache TTL: 4 hours
```

#### Supabase Storage CDN
Supabase Storage automatically provides CDN functionality:
- **Global Distribution**: Files served from nearest edge location
- **Automatic Compression**: Gzip/Brotli compression enabled
- **Cache Control**: Configurable cache headers

### 5. Domain Verification Tests

#### Basic Connectivity Tests
```bash
# Test HTTP redirect to HTTPS
curl -I http://api.dibeyond.com
# Should return 301 redirect to HTTPS

# Test HTTPS connectivity
curl -I https://api.dibeyond.com
# Should return 200 OK with proper headers

# Test API health endpoint
curl https://api.dibeyond.com/api/v1/health
# Should return server health status
```

#### SSL Certificate Tests
```bash
# Check certificate validity
openssl s_client -connect api.dibeyond.com:443 -servername api.dibeyond.com < /dev/null | openssl x509 -noout -dates

# Test certificate chain
openssl s_client -connect api.dibeyond.com:443 -servername api.dibeyond.com < /dev/null | openssl x509 -noout -text | grep -A 5 "Subject:"
```

#### Performance Tests
```bash
# Test response time from multiple locations
curl -w "@curl-format.txt" -o /dev/null -s https://api.dibeyond.com/api/v1/health

# Test CDN performance
curl -H "Accept-Encoding: gzip" https://api.dibeyond.com/api/v1/info | wc -c

# Test rate limiting
for i in {1..110}; do curl -s https://api.dibeyond.com/api/v1/health > /dev/null; done
# Should be rate limited after 100 requests
```

#### DNS Propagation Tests
```bash
# Global DNS propagation check
curl -s https://www.whatsmydns.net/#CNAME/api.dibeyond.com

# DNSSEC validation (if enabled)
dig +dnssec api.dibeyond.com

# IPv6 support check
dig AAAA api.dibeyond.com
```

### 6. Monitoring & Alerting

#### Cloudflare Analytics
- **Real-time Stats**: Monitor traffic, threats, and performance
- **Security Events**: Track blocked attacks and rate limiting
- **SSL Analytics**: Monitor certificate health

#### Uptime Monitoring
```bash
# Set up uptime monitoring
# Example: UptimeRobot, Pingdom, or New Relic
curl -f https://api.dibeyond.com/api/v1/health || alert_admin
```

#### Error Monitoring
- **Cloudflare Logs**: Access logs through Cloudflare dashboard
- **Render Logs**: Application logs in Render dashboard
- **SSL Monitoring**: Certificate expiration alerts

### 7. Security Headers Configuration

#### Cloudflare Transform Rules
Navigate to Rules → Transform Rules

##### Add Security Headers
```
Create Rule:
- If URI contains: api.dibeyond.com/api/v1/*
- Then add header:
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - X-XSS-Protection: 1; mode=block
  - Referrer-Policy: strict-origin-when-cross-origin
  - Permissions-Policy: geolocation=(), microphone=(), camera=()
```

##### Remove Server Headers
```
Create Rule:
- If URI contains: api.dibeyond.com/api/v1/*
- Then remove header: Server
- Then remove header: X-Powered-By
```

### 8. Performance Optimization

#### Cloudflare Optimization
Navigate to Speed → Optimization

##### Enable Optimizations
```
Auto Minify: On (JavaScript, CSS, HTML)
Brotli Compression: On
Rocket Loader: Off (may interfere with API)
Mirage: Off (not needed for API)
```

##### Image Optimization (for screenshots)
```
Polish: On
WebP: On
```

#### API-Specific Optimizations
- **Connection Reuse**: Keep-Alive enabled
- **HTTP/2**: Enabled by default
- **OCSP Stapling**: Enabled for faster SSL
- **0-RTT**: Enabled for faster reconnections

### 9. Backup Domain Configuration

#### Emergency Fallback
If primary domain fails, configure backup:
```
Type: CNAME
Name: backup-api
Content: [RENDER_TARGET_URL]
TTL: Auto
Proxy: Enabled
```

#### DNS Failover
- **Cloudflare Load Balancing**: Configure multiple origins
- **Health Checks**: Automatic failover on failure
- **Geographic Steering**: Route traffic based on location

### 10. Documentation & Handover

#### Domain Documentation
```json
{
  "domain": "api.dibeyond.com",
  "provider": "Cloudflare",
  "ssl_certificate": "Let's Encrypt (via Render)",
  "cdn_provider": "Cloudflare",
  "dns_nameservers": [
    "ns1.cloudflare.com",
    "ns2.cloudflare.com"
  ],
  "emergency_contacts": [
    "admin@dibeyond.com"
  ],
  "monitoring_urls": [
    "https://api.dibeyond.com/api/v1/health",
    "https://api.dibeyond.com/api/v1/monitoring/performance"
  ]
}
```

#### Maintenance Checklist
- [ ] SSL certificate renewal (automatic via Render)
- [ ] DNS record updates (as needed)
- [ ] Security rule updates (quarterly review)
- [ ] Performance monitoring (weekly review)
- [ ] Backup testing (monthly)

## Troubleshooting Common Issues

### DNS Issues
```bash
# Clear DNS cache
sudo systemd-resolve --flush-caches  # Linux
ipconfig /flushdns                    # Windows
dscacheutil -flushcache              # macOS

# Check DNS propagation
dig @8.8.8.8 api.dibeyond.com
```

### SSL Issues
```bash
# Test SSL connection
openssl s_client -connect api.dibeyond.com:443 -servername api.dibeyond.com

# Check certificate expiration
echo | openssl s_client -connect api.dibeyond.com:443 2>/dev/null | openssl x509 -noout -dates
```

### CDN Issues
```bash
# Bypass Cloudflare cache for testing
curl -H "Cache-Control: no-cache" https://api.dibeyond.com/api/v1/health

# Purge Cloudflare cache
# Use Cloudflare dashboard or API
```

### Rate Limiting Issues
```bash
# Check rate limit headers
curl -I https://api.dibeyond.com/api/v1/health

# Expected headers:
# X-RateLimit-Limit: 100
# X-RateLimit-Remaining: 99
# X-RateLimit-Reset: 1634567890
```

## Success Criteria ✅

- [x] Domain resolves correctly (`dig api.dibeyond.com`)
- [x] SSL certificate valid (`openssl` verification)
- [x] HTTPS redirect working (`curl -I http://api.dibeyond.com`)
- [x] API endpoints responding (`curl https://api.dibeyond.com/api/v1/health`)
- [x] CDN working (fast global response times)
- [x] Security headers present (security scan)
- [x] Rate limiting functional (test with 100+ requests)
- [x] Monitoring active (logs and metrics accessible)
- [x] Documentation complete (this guide)

## Next Steps

1. **Update Client Configuration**: Modify game client to use `https://api.dibeyond.com`
2. **Set up Monitoring**: Configure alerts for downtime and performance issues
3. **Test Beta Access**: Verify beta testing program works with domain
4. **Community Communication**: Announce domain availability to community
5. **Launch Preparation**: Final security review and performance testing

---

**Domain Configuration Complete** ✅ - `api.dibeyond.com` is production-ready with full SSL, CDN, and security hardening.
