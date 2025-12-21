# Disney Infinity Community Server

A community-maintained server for Disney Infinity 3.0 Gold multiplayer functionality. This server restores the full multiplayer experience for the beloved Disney Infinity game, including UGC toybox sharing, matchmaking, achievements, and social features.

## ✨ Features

- 🏗️ **Toybox Sharing**: Upload, download, and rate user-created toyboxes with screenshots
- 🔐 **User Authentication**: Complete JWT-based authentication with registration and login
- 🎮 **Multiplayer Matchmaking**: Find and join multiplayer games with skill-based matching
- 👥 **Social Features**: Friend system, presence tracking, and social notifications
- 🏆 **Achievements**: Comprehensive achievement system with progress tracking
- 📊 **Statistics**: Detailed player stats, leaderboards, and performance analytics
- 🎯 **Real-time Communication**: WebSocket-based real-time multiplayer sessions
- 🔧 **Steam Integration**: Steam overlay support and Steam networking
- 🌐 **WebRTC**: Peer-to-peer networking with STUN/TURN server support
- 📱 **Presence System**: Real-time online status and friend activity
- ☁️ **Cloud Storage**: Supabase integration with CDN for fast file distribution
- 🛡️ **Security**: Rate limiting, CORS, input validation, and security headers
- 📈 **Monitoring**: Comprehensive health checks and performance metrics

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (Supabase recommended)
- Git

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd infinity-community-server
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Start the server:**
```bash
npm run dev  # Development with auto-reload
npm start    # Production
```

4. **Test the server:**
```bash
curl http://localhost:3000/api/v1/health
```

## 📡 API Endpoints

### Health & Monitoring
- `GET /api/v1/health` - Dynamic server health check with real-time system status
- `GET /api/v1/debug/health` - Debug health endpoint with detailed metrics
- `GET /api/v1/admin/alerts` - Admin-only alert summary and active alerts (requires admin auth)
- `PUT /api/v1/admin/alerts/thresholds` - Configure alert thresholds (requires admin auth)
- `GET /api/v1/info` - Complete server information and endpoint reference
- `GET /api/v1/metrics` - Admin-only performance metrics (requires auth)
- `GET /api/v1/monitoring/performance` - Real-time performance data

### Authentication
- `POST /api/v1/auth/register` - Register new user account
- `POST /api/v1/auth/login` - User login with JWT token
- `POST /api/v1/auth/refresh` - Refresh JWT access token

### Toybox Management
- `GET /api/v1/toybox` - List toyboxes with ratings, performance filters, and advanced search
- `POST /api/v1/toybox` - Upload new toybox with metadata
- `GET /api/v1/toybox/{id}` - Download toybox data
- `GET /api/v1/toybox/{id}/screenshot` - Get toybox screenshot
- `POST /api/v1/toybox/{id}/rate` - Rate and review toybox
- `GET /api/v1/toybox/{id}/stats` - Get toybox statistics

### Matchmaking & Sessions
- `POST /api/v1/matchmaking/join` - Join matchmaking queue
- `POST /api/v1/matchmaking/leave` - Leave matchmaking queue
- `GET /api/v1/matchmaking/status` - Check matchmaking status
- `GET /api/v1/matchmaking/stats` - Matchmaking statistics
- `POST /api/v1/sessions/create` - Create new game session
- `POST /api/v1/sessions/join` - Join existing session
- `GET /api/v1/sessions/{sessionId}` - Get session details
- `GET /api/v1/sessions` - List available sessions

### Social Features
- `POST /api/v1/friends/request` - Send friend request
- `POST /api/v1/friends/accept` - Accept friend request
- `GET /api/v1/friends/list` - Get friends list
- `GET /api/v1/friends/online` - Get online friends
- `POST /api/v1/presence/update` - Update online presence
- `GET /api/v1/presence/friends` - Get friends' presence

### Gaming Features
- `POST /api/v1/stats/match` - Submit match results
- `GET /api/v1/stats/player/{userId}` - Get player statistics
- `GET /api/v1/stats/leaderboard` - Global leaderboards
- `GET /api/v1/achievements` - List all achievements
- `GET /api/v1/achievements/player/{userId}` - Player achievements
- `POST /api/v1/achievements/check` - Trigger achievement checks

### Networking & Steam
- `GET /api/v1/networking/ice-servers` - Get ICE servers for WebRTC
- `GET /api/v1/networking/analytics` - Network performance analytics
- `POST /api/v1/steam/register` - Register Steam integration
- `GET /api/v1/steam/lobby/{sessionId}` - Get Steam lobby info
- `POST /api/v1/steam/overlay` - Trigger Steam overlay

### User Profile
- `GET /api/v1/profile` - Get user profile
- `PUT /api/v1/profile` - Update user profile
- `GET /api/v1/profile/public/{userId}` - Get public profile
- `GET /api/v1/profile/stats/detailed` - Detailed player statistics

### Admin (Admin Only)
- `GET /api/v1/admin/stats` - Server statistics
- `PUT /api/v1/admin/toybox/{id}/status` - Moderate toybox
- `GET /api/v1/admin/cleanup/stats` - Cleanup statistics
- `POST /api/v1/admin/cleanup/run` - Run maintenance cleanup

## 🔧 API Specifications

### Health Monitoring API

#### GET /api/v1/health
Returns real-time server health status with dynamic checks.

**Response:**
```json
{
  "status": "healthy|warning|critical",
  "message": "System status description",
  "version": "1.0.0",
  "timestamp": "2024-12-21T10:30:00.000Z",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "ok",
      "response_time": 15,
      "query_count": 1500,
      "error_count": 0
    },
    "memory": {
      "status": "ok",
      "current_mb": 120,
      "peak_mb": 180,
      "average_mb": 95
    },
    "requests": {
      "status": "ok",
      "total": 1500,
      "error_rate": 0.5,
      "average_response_time": 45
    },
    "websocket": {
      "status": "ok",
      "active_connections": 25,
      "total_messages": 500,
      "errors": 0
    }
  }
}
```

#### GET /api/v1/admin/alerts (Admin Only)
Returns current alert status and history.

**Response:**
```json
{
  "alerts": {
    "active_count": 2,
    "new_count": 0,
    "resolved_count": 1,
    "active_alerts": [
      {
        "type": "warning",
        "message": "High memory usage: 650MB",
        "metric": "memory_usage",
        "value": 650,
        "threshold": 500
      }
    ],
    "recent_alerts": [...]
  },
  "timestamp": "2024-12-21T10:30:00.000Z"
}
```

#### PUT /api/v1/admin/alerts/thresholds (Admin Only)
Configure alert thresholds.

**Request Body:**
```json
{
  "error_rate_warning": 15,
  "error_rate_critical": 50,
  "response_time_warning": 1000,
  "response_time_critical": 5000,
  "memory_warning": 600,
  "memory_critical": 800
}
```

### Performance Filtering API

#### GET /api/v1/toybox
List toyboxes with advanced filtering including platform-specific performance metrics.

**Query Parameters:**
- `minimum_performance` (0-100) - Filter by default platform performance (legacy)
- `platform` (default|pc|playstation|xbox|switch) - Specify platform for performance filtering
- `performance_threshold` (0-100) - Filter toyboxes where ANY platform meets the threshold
- `creators` - Comma-separated list of creator usernames
- `igps` - Comma-separated list of Infinity Game Piece IDs
- `abilities` - Comma-separated list of ability IDs
- `genres` - Comma-separated list of genre IDs
- `versions` - Comma-separated list of game versions
- `featured` (true) - Show only featured toyboxes
- `search` - Full-text search query
- `page` (default: 1) - Page number
- `page_size` (default: 20, max: 100) - Results per page
- `sort_field` (created_at|updated_at|download_count|title) - Sort field
- `sort_direction` (asc|desc) - Sort direction

**Examples:**
```
GET /api/v1/toybox?platform=pc&minimum_performance=85
GET /api/v1/toybox?performance_threshold=90
GET /api/v1/toybox?creators=user1,user2&featured=true
GET /api/v1/toybox?search=castle&sort_field=download_count&sort_direction=desc
```

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "Epic Castle",
      "description": "A magnificent castle toybox",
      "platform_performance": {
        "default": 85,
        "pc": 90,
        "playstation": 82,
        "xbox": 87,
        "switch": 75
      },
      "creator_username": "user1",
      "average_rating": 4.5,
      "download_count": 1250,
      "created_at": "2024-12-21T08:00:00.000Z"
    }
  ],
  "total": 150,
  "page": 1,
  "page_size": 20,
  "has_more": true
}
```

## Development

### Project Structure
```
infinity-community-server/
├── server.js          # Main Express server
├── package.json       # Dependencies and scripts
├── middleware/        # Custom middleware
├── routes/           # API route handlers
├── models/           # Database models
├── services/         # Business logic
├── utils/            # Utility functions
├── tests/            # Test files
└── README.md         # This file
```

### Available Scripts
```bash
npm start      # Start production server
npm run dev    # Start development server with nodemon
npm test       # Run tests
npm run format # Format code with Prettier
```

### Testing
```bash
# Run all tests
npm test

# Run specific test
npm test -- tests/auth.test.js
```

## 🚀 Deployment

### Production Deployment (Phase 5 Complete)
This server is production-ready and includes comprehensive deployment configurations.

#### Quick Production Deploy
```bash
# 1. Run database migration to production
node production-deploy.js

# 2. Deploy to Render (see PRODUCTION_DEPLOYMENT.md)
# 3. Configure domain (api.dibeyond.com)
# 4. Set up monitoring and scaling
```

#### Deployment Options

##### Render (Recommended)
- **Auto-scaling** web service
- **Built-in SSL** certificates
- **Custom domain** support (api.dibeyond.com)
- **Comprehensive monitoring**

##### Docker
- **Containerized** deployment
- **Multi-platform** support
- **Custom orchestration**

See `PRODUCTION_DEPLOYMENT.md` for complete deployment guide.

### Environment Variables

#### Required (Development)
```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=your-development-secret-key
ALLOWED_ORIGINS=http://localhost:3000
```

#### Required (Production)
```bash
NODE_ENV=production
DATABASE_URL=postgresql://[USER]:[PASS]@db.[PROJECT].supabase.co:5432/postgres
SUPABASE_URL=https://[PROJECT].supabase.co
SUPABASE_ANON_KEY=[ANON_KEY]
SUPABASE_SERVICE_ROLE_KEY=[SERVICE_ROLE_KEY]
JWT_SECRET=[SECURE_64_CHAR_RANDOM_STRING]
ALLOWED_ORIGINS=https://api.dibeyond.com,https://dibeyond.com
```

#### Optional Performance
```bash
REDIS_URL=redis://[REDIS_URL]  # For caching
STEAM_API_KEY=[STEAM_API_KEY]  # Steam integration
SMTP_HOST=smtp.gmail.com       # Email notifications
```

## 🏗️ Architecture

### Technology Stack
- **Runtime**: Node.js 18+ with production optimizations
- **Framework**: Express.js with 60+ API endpoints
- **Database**: PostgreSQL with 14 tables and 35+ indexes
- **Real-time**: Socket.io for WebSocket communication
- **Authentication**: JWT with secure token management
- **File Storage**: Supabase Storage with CDN
- **Caching**: Redis support for performance optimization
- **Logging**: Winston with structured logging
- **Security**: Helmet, CORS, rate limiting, input validation
- **Monitoring**: Health checks, performance metrics, alerting
- **Testing**: Jest test suite with comprehensive coverage

### Database Schema (14 Tables)
- **Core**: users, toyboxes, toybox_ratings, toybox_downloads, toybox_likes
- **Multiplayer**: matchmaking_queue, game_sessions, session_players, player_presence
- **Social**: friend_requests, friends, game_stats, player_stats, network_quality
- **Admin**: achievements (with automatic triggers)

### Performance Optimizations
- **35+ Database Indexes** for fast queries
- **Connection Pooling** (20 connections per instance)
- **Query Optimization** with EXPLAIN plans
- **Caching Strategy** with Redis support
- **Rate Limiting** by endpoint and user tier
- **Auto-scaling** support (1-10 instances)

## 🧪 Development

### Project Structure
```
infinity-community-server/
├── server.js              # Main Express server (450+ lines)
├── config/
│   └── database.js        # PostgreSQL connection & pooling
├── controllers/           # Business logic (14 controllers)
├── routes/               # API endpoints (14 route files)
├── middleware/           # Auth, rate limiting, caching
├── services/             # Achievement, monitoring, cleanup
├── socket.js             # WebSocket server for real-time
├── scripts/              # Migration and optimization scripts
├── tests/                # Jest test suite
├── production-config.js  # Production environment config
├── production-deploy.js  # Production deployment script
├── Dockerfile           # Container deployment
├── render.yaml         # Render deployment config
└── PRODUCTION_DEPLOYMENT.md # Complete deployment guide
```

### Available Scripts
```bash
npm start         # Production server
npm run dev       # Development with nodemon
npm test          # Run test suite
npm run test:auth # Test authentication
npm run test:toybox # Test toybox features
npm run format    # Format with Prettier
npm run lint      # Lint with ESLint
```

### Testing
```bash
# Run full test suite
npm test

# Run specific tests
npm run test:auth
npm run test:toybox

# Test with coverage
npm run test:coverage

# Test production deployment
npm run test:phase4
```

## 🤝 Contributing

### Development Workflow
1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Develop** with tests (`npm test`)
4. **Format** code (`npm run format`)
5. **Test** thoroughly (`npm run test:coverage`)
6. **Submit** a pull request

### Code Standards
- **ESLint** for code quality
- **Prettier** for consistent formatting
- **Jest** for comprehensive testing
- **Winston** for structured logging
- **JSDoc** for API documentation

### Testing Requirements
- **Unit Tests** for all new functions
- **Integration Tests** for API endpoints
- **Performance Tests** for database queries
- **Security Tests** for authentication flows

## 📄 License

**MIT License** - This project restores Disney Infinity multiplayer functionality for the community. See LICENSE file for details.

## 🌐 Community

- **🎮 Production Server**: https://api.dibeyond.com
- **📚 Documentation**: See PRODUCTION_DEPLOYMENT.md
- **🐛 Issues**: GitHub Issues for bug reports
- **💡 Features**: GitHub Discussions for feature requests
- **🤝 Discord**: Community support and discussion

## ⚠️ Disclaimer

This is a **community project** and is not affiliated with Disney or Avalanche Software. It aims to restore multiplayer functionality for Disney Infinity 3.0 Gold players through reverse engineering and community-driven development.

**Phase 5 Complete** ✅ - Production deployment ready with full scaling, monitoring, and community launch preparation.




