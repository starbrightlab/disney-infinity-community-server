-- Disney Infinity Multiplayer Tables Migration
-- Adds matchmaking and session management tables

-- Matchmaking queue table
CREATE TABLE IF NOT EXISTS matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_mode VARCHAR(50) NOT NULL,
    region VARCHAR(20) DEFAULT 'global',
    skill_level INTEGER DEFAULT 5 CHECK (skill_level >= 1 AND skill_level <= 10),
    max_players INTEGER DEFAULT 4 CHECK (max_players >= 2 AND max_players <= 4),
    preferences JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'matched', 'cancelled', 'timed_out')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Handle existing sessions table properly
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sessions' AND table_schema = 'public') THEN
        -- Drop the old sessions table since it has different structure
        DROP TABLE sessions CASCADE;
    END IF;
END $$;

-- Create game_sessions table
CREATE TABLE IF NOT EXISTS game_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_mode VARCHAR(100) NOT NULL,
    region VARCHAR(20) DEFAULT 'global',
    status VARCHAR(50) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'cancelled', 'abandoned')),
    max_players INTEGER DEFAULT 4 CHECK (max_players >= 2 AND max_players <= 4),
    current_players INTEGER DEFAULT 1,
    player_ids UUID[] DEFAULT '{}',
    session_data JSONB DEFAULT '{}',
    steam_lobby_id VARCHAR(50), -- Steam lobby ID for P2P connections
    stun_server VARCHAR(100), -- STUN server for NAT traversal
    turn_server VARCHAR(100), -- TURN server for relay connections
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Session players table for detailed player tracking
CREATE TABLE IF NOT EXISTS session_players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_status VARCHAR(20) DEFAULT 'joined' CHECK (player_status IN ('joined', 'ready', 'playing', 'disconnected', 'left')),
    steam_id VARCHAR(20), -- Steam ID for P2P connections
    network_info JSONB DEFAULT '{}', -- IP, port, NAT type, connection quality
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    disconnected_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(session_id, user_id)
);

-- Player presence table for online status
CREATE TABLE IF NOT EXISTS player_presence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'away', 'in_game', 'in_menu')),
    current_session_id UUID REFERENCES game_sessions(id) ON DELETE SET NULL,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    current_game_mode VARCHAR(100),
    steam_status JSONB DEFAULT '{}',
    UNIQUE(user_id)
);

-- Friends system tables
CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sender_id, receiver_id)
);

CREATE TABLE IF NOT EXISTS friends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friendship_status VARCHAR(20) DEFAULT 'active' CHECK (friendship_status IN ('active', 'blocked')),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, friend_id)
);

-- Game statistics tables
CREATE TABLE IF NOT EXISTS game_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER DEFAULT 0,
    completion_time INTEGER, -- in seconds
    achievements JSONB DEFAULT '[]',
    performance_metrics JSONB DEFAULT '{}',
    game_events JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    games_played INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    games_lost INTEGER DEFAULT 0,
    total_score BIGINT DEFAULT 0,
    total_play_time INTEGER DEFAULT 0, -- in seconds
    best_score INTEGER DEFAULT 0,
    average_completion_time INTEGER, -- in seconds
    skill_rating INTEGER DEFAULT 1000,
    win_streak INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    last_played TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Network quality monitoring table
CREATE TABLE IF NOT EXISTS network_quality (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    ping_ms INTEGER,
    packet_loss_percent DECIMAL(5,2),
    jitter_ms INTEGER,
    connection_type VARCHAR(20),
    nat_type VARCHAR(20),
    public_ip INET,
    local_ip INET,
    stun_server VARCHAR(100),
    turn_used BOOLEAN DEFAULT FALSE,
    connection_quality VARCHAR(20) CHECK (connection_quality IN ('excellent', 'good', 'fair', 'poor', 'unusable')),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user ON matchmaking_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_status ON matchmaking_queue(status);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_game_mode ON matchmaking_queue(game_mode);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_region ON matchmaking_queue(region);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_created ON matchmaking_queue(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_sessions_host ON game_sessions(host_user_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON game_sessions(status);
CREATE INDEX IF NOT EXISTS idx_game_sessions_game_mode ON game_sessions(game_mode);
CREATE INDEX IF NOT EXISTS idx_game_sessions_region ON game_sessions(region);
CREATE INDEX IF NOT EXISTS idx_game_sessions_created ON game_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_updated ON game_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_players_session ON session_players(session_id);
CREATE INDEX IF NOT EXISTS idx_session_players_user ON session_players(user_id);
CREATE INDEX IF NOT EXISTS idx_session_players_status ON session_players(player_status);

CREATE INDEX IF NOT EXISTS idx_player_presence_user ON player_presence(user_id);
CREATE INDEX IF NOT EXISTS idx_player_presence_status ON player_presence(status);

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status);

CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);

CREATE INDEX IF NOT EXISTS idx_game_stats_session ON game_stats(session_id);
CREATE INDEX IF NOT EXISTS idx_game_stats_player ON game_stats(player_id);

CREATE INDEX IF NOT EXISTS idx_player_stats_user ON player_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_rating ON player_stats(skill_rating);

CREATE INDEX IF NOT EXISTS idx_network_quality_user ON network_quality(user_id);
CREATE INDEX IF NOT EXISTS idx_network_quality_session ON network_quality(session_id);
CREATE INDEX IF NOT EXISTS idx_network_quality_recorded ON network_quality(recorded_at DESC);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers (with safety check)
DO $$
BEGIN
    -- Create triggers only if they don't exist
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_matchmaking_queue_updated') THEN
        CREATE TRIGGER trigger_matchmaking_queue_updated
            BEFORE UPDATE ON matchmaking_queue
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_game_sessions_updated') THEN
        CREATE TRIGGER trigger_game_sessions_updated
            BEFORE UPDATE ON game_sessions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_friend_requests_updated') THEN
        CREATE TRIGGER trigger_friend_requests_updated
            BEFORE UPDATE ON friend_requests
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_player_stats_updated') THEN
        CREATE TRIGGER trigger_player_stats_updated
            BEFORE UPDATE ON player_stats
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Function to update player stats when game ends
CREATE OR REPLACE FUNCTION update_player_stats_on_game_end()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process when a game session is marked as completed
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        -- Update stats for all players in the session
        UPDATE player_stats
        SET
            games_played = games_played + 1,
            total_play_time = total_play_time + EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at))::INTEGER,
            last_played = NEW.ended_at,
            updated_at = NOW()
        WHERE user_id IN (
            SELECT user_id FROM session_players WHERE session_id = NEW.id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_player_stats_on_game_end') THEN
        CREATE TRIGGER trigger_update_player_stats_on_game_end
            AFTER UPDATE ON game_sessions
            FOR EACH ROW EXECUTE FUNCTION update_player_stats_on_game_end();
    END IF;
END $$;

-- Function to clean up old matchmaking queue entries
CREATE OR REPLACE FUNCTION cleanup_old_matchmaking_entries()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Remove entries older than 30 minutes that are still active (probably stale)
    DELETE FROM matchmaking_queue
    WHERE status = 'active' AND created_at < NOW() - INTERVAL '30 minutes';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up abandoned sessions
CREATE OR REPLACE FUNCTION cleanup_abandoned_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Mark sessions as abandoned if they've been waiting too long or active sessions with no recent activity
    UPDATE game_sessions
    SET status = 'abandoned', ended_at = NOW(), updated_at = NOW()
    WHERE (status = 'waiting' AND created_at < NOW() - INTERVAL '1 hour')
       OR (status = 'active' AND updated_at < NOW() - INTERVAL '2 hours');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
