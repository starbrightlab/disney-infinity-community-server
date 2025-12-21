# Troubleshooting Guide

## Common Issues and Solutions

### 1. "Cannot connect to Disney servers"

**Symptoms:**
- Game shows "connection failed" errors
- UGC features are unavailable
- Login doesn't work

**Solutions:**
1. **Check hosts file configuration:**
   ```bash
   # Windows
   type %windir%\System32\drivers\etc\hosts

   # Linux/macOS
   cat /etc/hosts
   ```

2. **Verify server is running:**
   ```bash
   curl http://your-server.com/api/v1/health
   ```

3. **Check firewall settings:**
   - Ensure port 80/443 is open
   - Disable VPN if interfering

4. **Flush DNS cache:**
   ```bash
   # Windows
   ipconfig /flushdns

   # Linux
   sudo systemctl restart nscd || sudo service dns-cleanup start

   # macOS
   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
   ```

### 2. "Authentication failed"

**Symptoms:**
- Cannot log in to community account
- UGC upload/download fails with auth errors

**Solutions:**
1. **Check JWT token validity:**
   - Tokens expire after 1 hour
   - Use refresh token to get new access token

2. **Verify account status:**
   - Account may be deactivated
   - Check server logs for auth failures

3. **Clear client cache:**
   - Delete game cache files
   - Restart game client

### 3. "Toybox upload failed"

**Symptoms:**
- Cannot upload toyboxes
- "File too large" errors
- "Invalid file format" errors

**Solutions:**
1. **Check file size limits:**
   - Maximum: 100MB per toybox
   - Screenshots: 5MB maximum

2. **Verify file format:**
   - Toybox: Binary data only
   - Screenshot: PNG/JPG/GIF only

3. **Check server storage:**
   - Supabase storage may be full
   - Check server logs for upload errors

### 4. "Content not appearing"

**Symptoms:**
- Uploaded toyboxes don't show in listings
- Downloaded content is corrupted

**Solutions:**
1. **Check moderation status:**
   - New content requires approval
   - Check `/api/v1/admin/reviews/pending`

2. **Verify content filters:**
   - Content may be filtered out
   - Check search parameters

3. **Test direct API access:**
   ```bash
   # List all toyboxes
   curl http://your-server.com/api/v1/toybox

   # Get specific toybox
   curl http://your-server.com/api/v1/toybox/{id}
   ```

### 5. "Slow performance"

**Symptoms:**
- Slow loading times
- Lag when browsing UGC

**Solutions:**
1. **Check server resources:**
   - Monitor CPU/memory usage
   - Scale server if needed

2. **Optimize database:**
   ```bash
   # Run optimization script
   psql $DATABASE_URL -f scripts/optimize_database.sql
   ```

3. **Enable caching:**
   - Redis cache should be enabled
   - Check cache hit rates

4. **CDN configuration:**
   - Use CDN for file downloads
   - Configure proper cache headers

### 6. SSL/Certificate Errors

**Symptoms:**
- "Certificate invalid" errors
- Cannot establish secure connection

**Solutions:**
1. **Install proper SSL certificate:**
   ```bash
   # Use Let's Encrypt
   certbot certonly --webroot -w /var/www -d your-domain.com
   ```

2. **Disable SSL validation (temporary):**
   ```bash
   # Client configuration
   INFINITY_DISABLE_SSL_VALIDATION=1
   ```

3. **Update client certificates:**
   - Import server certificate into client trust store

### 7. Rate Limiting Issues

**Symptoms:**
- "Too many requests" errors
- Temporary blocks

**Solutions:**
1. **Check rate limits:**
   - Auth: 10/minute
   - UGC: 100/minute
   - Downloads: 50/minute

2. **Implement backoff:**
   ```javascript
   // Exponential backoff example
   function retryWithBackoff(fn, maxRetries = 3) {
     let attempt = 0;
     const execute = () => {
       fn().catch(err => {
         if (attempt < maxRetries) {
           attempt++;
           const delay = Math.pow(2, attempt) * 1000;
           setTimeout(execute, delay);
         }
       });
     };
     execute();
   }
   ```

3. **Contact server admin:**
   - Request rate limit increase if needed

## Debug Tools

### Client Debug Logging

Enable detailed logging in the client:

```xml
<!-- Infinity3Config.xml -->
<Debug>
  <Enabled>true</Enabled>
  <LogLevel>debug</LogLevel>
  <Logging>
    <NetworkRequests>true</NetworkRequests>
    <UGCOperations>true</UGCOperations>
    <Authentication>true</Authentication>
  </Logging>
</Debug>
```

### Server Log Analysis

Check server logs for errors:

```bash
# View recent errors
tail -f infinity-community-server/error.log

# Search for specific errors
grep "ERROR" infinity-community-server/combined.log
```

### Network Analysis

Use tools to inspect network traffic:

```bash
# tcpdump for network analysis
sudo tcpdump -i eth0 host your-server.com

# Wireshark for GUI analysis
# Capture traffic on game port
```

## Getting Help

### Community Support

1. **Check existing issues:**
   - GitHub issues
   - Community forums

2. **Gather diagnostic info:**
   ```bash
   # System info
   uname -a
   # Server status
   curl http://your-server.com/api/v1/health
   # Client logs
   # Game version info
   ```

3. **Create detailed bug report:**
   - Steps to reproduce
   - Expected vs actual behavior
   - Client and server logs
   - System information

### Emergency Contacts

- **Server down:** Check server status and restart if needed
- **Data loss:** Restore from backups
- **Security issue:** Immediately disable affected features

## Prevention

### Regular Maintenance

1. **Monitor server health:**
   ```bash
   # Health check script
   #!/bin/bash
   if ! curl -f http://localhost/api/v1/health; then
     echo "Server unhealthy, restarting..."
     systemctl restart infinity-server
   fi
   ```

2. **Backup regularly:**
   - Database daily backups
   - File storage backups
   - Configuration backups

3. **Update dependencies:**
   - Keep Node.js and packages updated
   - Monitor security advisories

4. **Performance monitoring:**
   - Track response times
   - Monitor resource usage
   - Set up alerts for issues
