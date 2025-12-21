# Disney Infinity Community Server - Client Integration Guide

This guide explains how to integrate the Disney Infinity 3.0 Gold client with the community-maintained UGC server.

## Overview

The community server provides a drop-in replacement for Disney's discontinued UGC services. Integration requires modifying the client to point to the community server instead of Disney's servers.

## Integration Methods

### Method 1: DNS Override (Recommended)

Override Disney's server domains to point to the community server:

**Windows (hosts file):**
```
# C:\Windows\System32\drivers\etc\hosts
52.1.230.102 disney.go.com
52.1.230.102 toys.disney.go.com
[YOUR_SERVER_IP] disney.go.com
[YOUR_SERVER_IP] toys.disney.go.com
[YOUR_SERVER_IP] ugc.disney.go.com
[YOUR_SERVER_IP] api.toybox.com
```

**Linux/macOS (/etc/hosts):**
```
[YOUR_SERVER_IP] disney.go.com
[YOUR_SERVER_IP] toys.disney.go.com
[YOUR_SERVER_IP] ugc.disney.go.com
[YOUR_SERVER_IP] api.toybox.com
```

### Method 2: Client DLL Patching

Patch the client's network DLL to override server URLs at runtime.

**Tools needed:**
- IDA Pro or GhIDA for reverse engineering
- DLL injection tools
- Hex editor

**Steps:**
1. Locate the client's network communication DLL
2. Find hardcoded Disney server URLs
3. Replace with community server URLs
4. Re-sign the DLL if necessary

### Method 3: Proxy Server

Set up a proxy server that intercepts Disney server requests and forwards them to the community server.

**Example nginx configuration:**
```nginx
server {
    listen 80;
    server_name disney.go.com toys.disney.go.com ugc.disney.go.com api.toybox.com;

    location / {
        proxy_pass http://your-community-server:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Client Configuration Files

### Infinity3Config.xml

Create or modify the client's configuration file:

```xml
<?xml version="1.0" encoding="utf-8"?>
<InfinityConfig>
  <Server>
    <UGC>http://your-server.com/api/v1</UGC>
    <Auth>http://your-server.com/api/v1/auth</Auth>
    <Matchmaking>http://your-server.com/api/v1/matchmaking</Matchmaking>
  </Server>
  <Features>
    <UGCEnabled>true</UGCEnabled>
    <CommunitySharing>true</CommunitySharing>
    <UserGeneratedContent>true</UserGeneratedContent>
  </Features>
</InfinityConfig>
```

### Environment Variables

Set client environment variables:

```batch
REM Windows batch file
set INFINITY_UGC_SERVER=http://your-server.com/api/v1
set INFINITY_AUTH_SERVER=http://your-server.com/api/v1/auth
set INFINITY_DISABLE_SSL_VALIDATION=1
```

```bash
# Linux/macOS
export INFINITY_UGC_SERVER="http://your-server.com/api/v1"
export INFINITY_AUTH_SERVER="http://your-server.com/api/v1/auth"
export INFINITY_DISABLE_SSL_VALIDATION=1
```

## Authentication Setup

### Automatic Account Creation

The server supports automatic account creation for first-time users. The client can:

1. **Send device/fingerprint data** to create anonymous accounts
2. **Prompt for username/email** during first UGC interaction
3. **Link existing accounts** via OAuth or manual login

### Login Flow

```
Client Request → Community Server
↓
JWT Token Generation
↓
Token Storage (client-side)
↓
Authenticated UGC Operations
```

### Token Management

- **Access tokens**: Short-lived (1 hour), used for API calls
- **Refresh tokens**: Long-lived (7 days), used to get new access tokens
- **Automatic renewal**: Client should handle token refresh transparently

## UGC Operations

### Toybox Upload

**Client sends:**
```http
POST /api/v1/toybox
Content-Type: multipart/form-data

- content: [toybox binary data]
- screenshot: [optional screenshot image]
- contentInfo: [JSON metadata]
- screenshotInfo: [optional JSON metadata]
```

**Server response:**
```json
{
  "id": "uuid",
  "status": "in_review",
  "created_at": "2025-01-01T00:00:00Z"
}
```

### Toybox Download

**Client requests:**
```http
GET /api/v1/toybox/{id}
Accept: application/octet-stream
```

**Server responds with binary data and metadata headers**

### Content Discovery

**List toyboxes:**
```http
GET /api/v1/toybox?page=1&page_size=20&sort_field=created_at&sort_direction=desc
```

**Search and filter:**
```http
GET /api/v1/toybox?search=adventure&genres=1,2&featured=true
```

**Trending content:**
```http
GET /api/v1/toybox/trending?genre=5&limit=10
```

## Error Handling

### Common Error Codes

| Code | HTTP Status | Description | Client Action |
|------|-------------|-------------|---------------|
| `UNAUTHORIZED` | 401 | Invalid/missing token | Refresh token or re-login |
| `FORBIDDEN` | 403 | Insufficient permissions | Show permission error |
| `NOT_FOUND` | 404 | Resource not found | Show "content not available" |
| `RATE_LIMITED` | 429 | Too many requests | Implement backoff/retry |
| `SERVER_ERROR` | 500 | Server error | Show generic error, retry later |

### Rate Limiting

- **Authentication**: 10 requests/minute
- **UGC operations**: 100 requests/minute per user
- **Downloads**: 50 requests/minute per user

Implement exponential backoff for rate-limited requests.

## Testing Your Integration

### 1. Health Check

```bash
curl http://your-server.com/api/v1/health
```

Expected response:
```json
{
  "status": "ok",
  "message": "Disney Infinity Community Server is running!",
  "version": "1.0.0"
}
```

### 2. Authentication Test

```bash
# Register
curl -X POST http://your-server.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"password123"}'

# Login
curl -X POST http://your-server.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'
```

### 3. UGC Test

```bash
# List toyboxes
curl http://your-server.com/api/v1/toybox

# Upload test toybox (requires authentication)
curl -X POST http://your-server.com/api/v1/toybox \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "content=@test.toybox" \
  -F 'contentInfo={"name":"Test Toybox","version":3}'
```

## Troubleshooting

### Common Issues

1. **SSL Certificate Errors**
   - Solution: Disable SSL validation in client or install proper certificates

2. **CORS Errors**
   - Solution: Ensure server allows client origin in CORS configuration

3. **Authentication Failures**
   - Solution: Check JWT token validity and server time sync

4. **Upload Failures**
   - Solution: Verify file size limits and supported formats

5. **Content Not Appearing**
   - Solution: Check moderation status - new content may need approval

### Debug Logging

Enable client debug logging to capture network requests:

```xml
<!-- Add to client config -->
<Debug>
  <NetworkLogging>true</NetworkLogging>
  <UGCLogging>true</UGCLogging>
</Debug>
```

### Support

For integration issues:
1. Check server logs for error details
2. Verify API endpoint URLs
3. Test with direct HTTP requests first
4. Ensure client version compatibility

## Version Compatibility

| Client Version | Server Compatibility | Notes |
|----------------|----------------------|--------|
| Disney Infinity 3.0 | ✅ Full | Original UGC system |
| Disney Infinity 3.0 Gold | ✅ Full | Enhanced features |
| Custom clients | ⚠️ Partial | May require additional modifications |

## Security Considerations

- **Never store tokens in logs**
- **Use HTTPS in production**
- **Validate SSL certificates**
- **Implement proper token refresh**
- **Rate limit client requests**
- **Validate all user inputs**

## Future Updates

The community server API follows semantic versioning. Breaking changes will be communicated in advance. Subscribe to the project repository for updates.

---

*This integration guide is maintained by the Disney Infinity community. Contributions and improvements are welcome!*
