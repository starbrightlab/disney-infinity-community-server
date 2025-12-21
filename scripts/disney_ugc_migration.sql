-- Disney Infinity UGC API Refactoring Migration
-- This migration adds Disney-format fields to align with original UGC API structure
-- Created: December 21, 2024

-- ============================================================================
-- STEP 1: Add new Disney-format columns to toyboxes table
-- ============================================================================

-- Add creation_time (Unix timestamp) alongside created_at
ALTER TABLE toyboxes 
ADD COLUMN IF NOT EXISTS creation_time INTEGER;

-- Add last_update_time (Unix timestamp) alongside updated_at
ALTER TABLE toyboxes 
ADD COLUMN IF NOT EXISTS last_update_time INTEGER;

-- Add _status (numeric) for Disney status codes
-- 1 = NOT_APPROVED, 2 = APPROVED, 4 = PUBLISHED, 8 = RETIRED, 16 = FLAGGED
ALTER TABLE toyboxes 
ADD COLUMN IF NOT EXISTS _status INTEGER DEFAULT 1;

-- Add platform_performance JSONB for multi-platform performance scores
ALTER TABLE toyboxes 
ADD COLUMN IF NOT EXISTS platform_performance JSONB DEFAULT '{"pc": 95, "default": 95}'::jsonb;

-- Add igps array (replaces avatars for Disney naming)
ALTER TABLE toyboxes 
ADD COLUMN IF NOT EXISTS igps INTEGER[];

-- ============================================================================
-- STEP 2: Populate new columns from existing data
-- ============================================================================

-- Populate creation_time from created_at
UPDATE toyboxes 
SET creation_time = EXTRACT(EPOCH FROM created_at)::INTEGER
WHERE creation_time IS NULL AND created_at IS NOT NULL;

-- Populate last_update_time from updated_at or created_at
UPDATE toyboxes 
SET last_update_time = COALESCE(
    EXTRACT(EPOCH FROM updated_at)::INTEGER,
    EXTRACT(EPOCH FROM created_at)::INTEGER
)
WHERE last_update_time IS NULL;

-- Map status numeric codes from current status integer
-- Current: 1=in_review, 2=approved, 3=published
-- Disney: 1=NOT_APPROVED, 2=APPROVED, 4=PUBLISHED, 8=RETIRED, 16=FLAGGED
UPDATE toyboxes 
SET _status = CASE 
    WHEN status = 1 THEN 1  -- in_review → NOT_APPROVED
    WHEN status = 2 THEN 2  -- approved → APPROVED  
    WHEN status = 3 THEN 4  -- published → PUBLISHED
    ELSE 1  -- default to NOT_APPROVED
END
WHERE _status IS NULL OR _status = 1;

-- Copy avatars to igps (Disney uses "igps" instead of "avatars")
UPDATE toyboxes 
SET igps = avatars
WHERE igps IS NULL AND avatars IS NOT NULL;

-- ============================================================================
-- STEP 3: Create indexes for new columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_toyboxes_creation_time ON toyboxes(creation_time DESC);
CREATE INDEX IF NOT EXISTS idx_toyboxes_last_update_time ON toyboxes(last_update_time DESC);
CREATE INDEX IF NOT EXISTS idx_toyboxes_status_numeric ON toyboxes(_status);
CREATE INDEX IF NOT EXISTS idx_toyboxes_igps_gin ON toyboxes USING GIN (igps);
CREATE INDEX IF NOT EXISTS idx_toyboxes_platform_performance ON toyboxes USING GIN (platform_performance);

-- ============================================================================
-- STEP 4: Create triggers to keep timestamp fields in sync
-- ============================================================================

-- Function to sync creation_time with created_at
CREATE OR REPLACE FUNCTION sync_creation_time()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.created_at IS NOT NULL THEN
        NEW.creation_time = EXTRACT(EPOCH FROM NEW.created_at)::INTEGER;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to sync last_update_time with updated_at
CREATE OR REPLACE FUNCTION sync_last_update_time()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.updated_at IS NOT NULL THEN
        NEW.last_update_time = EXTRACT(EPOCH FROM NEW.updated_at)::INTEGER;
    ELSIF NEW.created_at IS NOT NULL THEN
        NEW.last_update_time = EXTRACT(EPOCH FROM NEW.created_at)::INTEGER;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trigger_toyboxes_creation_time ON toyboxes;
DROP TRIGGER IF EXISTS trigger_toyboxes_last_update_time ON toyboxes;

-- Create triggers
CREATE TRIGGER trigger_toyboxes_creation_time
    BEFORE INSERT ON toyboxes
    FOR EACH ROW
    EXECUTE FUNCTION sync_creation_time();

CREATE TRIGGER trigger_toyboxes_last_update_time
    BEFORE INSERT OR UPDATE ON toyboxes
    FOR EACH ROW
    EXECUTE FUNCTION sync_last_update_time();

-- ============================================================================
-- STEP 5: Add check constraint for _status values
-- ============================================================================

-- Ensure _status only contains valid Disney status codes
ALTER TABLE toyboxes
DROP CONSTRAINT IF EXISTS check_status_valid;

ALTER TABLE toyboxes
ADD CONSTRAINT check_status_valid 
CHECK (_status IN (1, 2, 4, 8, 16));

-- ============================================================================
-- STEP 6: Create view for easier querying (optional)
-- ============================================================================

CREATE OR REPLACE VIEW toyboxes_disney_format AS
SELECT 
    t.id,
    t.title,
    t.description,
    t.creator_id AS "_creatorId",
    t._status,
    t.creation_time,
    t.last_update_time,
    t.version,
    t.platform_performance,
    t.download_count,
    COALESCE(l.like_count, 0) AS like_count,
    COALESCE(r.average_rating, 0) AS rating,
    t.igps,
    t.abilities,
    t.genres,
    t.object_counts,
    t.total_objects,
    t.unique_objects,
    t.playsets,
    t.required_playsets_size,
    t.screenshot,
    t.screenshot_metadata,
    t.file_path,
    t.file_size,
    t.featured,
    t.created_at,
    t.updated_at,
    u.username AS creator_username
FROM toyboxes t
LEFT JOIN users u ON t.creator_id = u.id
LEFT JOIN (
    SELECT toybox_id, COUNT(*) AS like_count
    FROM toybox_likes
    GROUP BY toybox_id
) l ON t.id = l.toybox_id
LEFT JOIN (
    SELECT toybox_id, AVG(rating) AS average_rating
    FROM toybox_ratings
    GROUP BY toybox_id
) r ON t.id = r.toybox_id;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify migration completed successfully
DO $$
DECLARE
    missing_columns TEXT[];
    total_toyboxes INTEGER;
    synced_toyboxes INTEGER;
BEGIN
    -- Check for missing columns
    SELECT ARRAY_AGG(column_name)
    INTO missing_columns
    FROM (
        SELECT unnest(ARRAY['creation_time', 'last_update_time', '_status', 'platform_performance', 'igps']) AS column_name
    ) expected
    WHERE column_name NOT IN (
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'toyboxes'
    );

    IF missing_columns IS NOT NULL THEN
        RAISE WARNING 'Missing columns: %', missing_columns;
    ELSE
        RAISE NOTICE '✓ All Disney-format columns exist';
    END IF;

    -- Check data synchronization
    SELECT COUNT(*) INTO total_toyboxes FROM toyboxes;
    SELECT COUNT(*) INTO synced_toyboxes 
    FROM toyboxes 
    WHERE creation_time IS NOT NULL 
    AND last_update_time IS NOT NULL 
    AND _status IS NOT NULL;

    RAISE NOTICE '✓ Migrated %/% toyboxes', synced_toyboxes, total_toyboxes;

    IF synced_toyboxes < total_toyboxes THEN
        RAISE WARNING 'Some toyboxes missing synchronized data';
    END IF;
END $$;

-- Show sample of migrated data
SELECT 
    id,
    title,
    status AS old_status,
    _status AS disney_status,
    created_at,
    creation_time,
    EXTRACT(EPOCH FROM created_at)::INTEGER = creation_time AS time_synced
FROM toyboxes
LIMIT 5;

RAISE NOTICE 'Migration completed successfully!';
RAISE NOTICE 'Next steps:';
RAISE NOTICE '1. Update controllers to use Disney-format fields';
RAISE NOTICE '2. Update routes to Disney URL structure';
RAISE NOTICE '3. Test with game client';
