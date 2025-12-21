-- Performance optimization script for Disney Infinity UGC database
-- Run these queries to improve performance

-- Additional indexes for better query performance

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_toyboxes_status_created ON toyboxes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_toyboxes_status_featured ON toyboxes(status, featured DESC);
CREATE INDEX IF NOT EXISTS idx_toyboxes_creator_status ON toyboxes(creator_id, status);

-- Download analytics indexes
CREATE INDEX IF NOT EXISTS idx_downloads_toybox_date ON toybox_downloads(toybox_id, downloaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_downloads_date_toybox ON toybox_downloads(downloaded_at DESC, toybox_id);

-- Rating performance indexes
CREATE INDEX IF NOT EXISTS idx_ratings_toybox_rating ON toybox_ratings(toybox_id, rating);
CREATE INDEX IF NOT EXISTS idx_ratings_user_created ON toybox_ratings(user_id, created_at DESC);

-- Full-text search optimization
CREATE INDEX IF NOT EXISTS idx_toyboxes_title_gin ON toyboxes USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_toyboxes_description_gin ON toyboxes USING gin(to_tsvector('english', description));

-- Partial indexes for active content
CREATE INDEX IF NOT EXISTS idx_toyboxes_active ON toyboxes(created_at DESC) WHERE status = 3;
CREATE INDEX IF NOT EXISTS idx_toyboxes_featured_only ON toyboxes(created_at DESC) WHERE featured = true;

-- User activity indexes
CREATE INDEX IF NOT EXISTS idx_users_active ON users(last_login DESC) WHERE is_active = true;

-- Materialized view for trending calculations (refreshed periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS trending_toyboxes AS
SELECT
  t.id,
  t.title,
  t.created_at,
  t.download_count,
  COALESCE(AVG(r.rating), 0) as average_rating,
  COUNT(DISTINCT r.id) as rating_count,
  COUNT(DISTINCT l.id) as like_count,
  -- Trending score calculation
  (t.download_count +
   (COALESCE(AVG(r.rating), 0) * 10) +
   GREATEST(0, 30 - EXTRACT(EPOCH FROM (NOW() - t.created_at))/86400) * 2) as trending_score
FROM toyboxes t
LEFT JOIN toybox_ratings r ON t.id = r.toybox_id
LEFT JOIN toybox_likes l ON t.id = l.toybox_id
WHERE t.status = 3 AND t.created_at > NOW() - INTERVAL '90 days'
GROUP BY t.id, t.title, t.created_at, t.download_count
HAVING COUNT(DISTINCT r.id) > 0 OR t.download_count > 0
ORDER BY trending_score DESC;

-- Index on materialized view
CREATE INDEX IF NOT EXISTS idx_trending_score ON trending_toyboxes(trending_score DESC);

-- Function to refresh trending view
CREATE OR REPLACE FUNCTION refresh_trending_toyboxes()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY trending_toyboxes;
END;
$$ LANGUAGE plpgsql;

-- Create a function for efficient trending queries
CREATE OR REPLACE FUNCTION get_trending_toyboxes(limit_count INTEGER DEFAULT 20, genre_filter INTEGER DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  title VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE,
  download_count INTEGER,
  average_rating NUMERIC,
  rating_count BIGINT,
  like_count BIGINT,
  trending_score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    tt.id,
    tt.title,
    tt.created_at,
    tt.download_count,
    tt.average_rating,
    tt.rating_count,
    tt.like_count,
    tt.trending_score
  FROM trending_toyboxes tt
  INNER JOIN toyboxes t ON tt.id = t.id
  WHERE (genre_filter IS NULL OR genre_filter = ANY(t.genres))
  ORDER BY tt.trending_score DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Query optimization: Create covering indexes
CREATE INDEX IF NOT EXISTS idx_toyboxes_list_covering ON toyboxes(status, featured, created_at DESC, download_count, title, creator_id);

-- Statistics update function optimization
CREATE OR REPLACE FUNCTION update_toybox_stats_batch()
RETURNS void AS $$
BEGIN
  -- Batch update download counts
  UPDATE toyboxes
  SET download_count = download_stats.total_downloads
  FROM (
    SELECT toybox_id, COUNT(*) as total_downloads
    FROM toybox_downloads
    GROUP BY toybox_id
  ) download_stats
  WHERE toyboxes.id = download_stats.toybox_id;

  -- Update cache timestamp
  UPDATE toyboxes
  SET updated_at = NOW()
  WHERE id IN (
    SELECT DISTINCT toybox_id
    FROM toybox_downloads
    WHERE downloaded_at > NOW() - INTERVAL '1 hour'
  );
END;
$$ LANGUAGE plpgsql;

-- Create a job to refresh trending data every hour
-- This would be called by a cron job or scheduled task
CREATE OR REPLACE FUNCTION scheduled_maintenance()
RETURNS void AS $$
BEGIN
  -- Refresh trending view
  PERFORM refresh_trending_toyboxes();

  -- Update statistics
  PERFORM update_toybox_stats_batch();

  -- Clean up old download logs (keep last 6 months)
  DELETE FROM toybox_downloads
  WHERE downloaded_at < NOW() - INTERVAL '6 months';

  -- Log maintenance completion
  RAISE NOTICE 'Scheduled maintenance completed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON MATERIALIZED VIEW trending_toyboxes IS 'Materialized view for fast trending toybox queries, refreshed hourly';
COMMENT ON FUNCTION get_trending_toyboxes IS 'Efficient function to get trending toyboxes with optional genre filtering';
COMMENT ON FUNCTION refresh_trending_toyboxes IS 'Refreshes the trending toyboxes materialized view';
COMMENT ON FUNCTION scheduled_maintenance IS 'Performs scheduled database maintenance tasks';
