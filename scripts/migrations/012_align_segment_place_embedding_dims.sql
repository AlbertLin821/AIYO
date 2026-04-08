DO $$
DECLARE
  segments_type TEXT;
  places_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO segments_type
  FROM pg_attribute a
  WHERE a.attrelid = 'segments'::regclass
    AND a.attname = 'embedding_vector'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF segments_type IS DISTINCT FROM 'vector(768)' THEN
    DROP INDEX IF EXISTS idx_segments_embedding;
    EXECUTE 'ALTER TABLE segments ALTER COLUMN embedding_vector TYPE vector(768) USING NULL::vector(768)';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
    INTO places_type
  FROM pg_attribute a
  WHERE a.attrelid = 'places'::regclass
    AND a.attname = 'embedding_vector'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF places_type IS DISTINCT FROM 'vector(768)' THEN
    DROP INDEX IF EXISTS idx_places_embedding;
    EXECUTE 'ALTER TABLE places ALTER COLUMN embedding_vector TYPE vector(768) USING NULL::vector(768)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_segments_embedding ON segments
  USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_places_embedding ON places
  USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;
