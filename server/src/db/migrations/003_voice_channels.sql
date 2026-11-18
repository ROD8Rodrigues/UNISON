-- Canais de voz e chamadas vinculadas a canais.
ALTER TABLE channels ADD COLUMN is_voice INTEGER NOT NULL DEFAULT 0;

ALTER TABLE calls ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_calls_channel ON calls(channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_active_channel
  ON calls(channel_id)
  WHERE channel_id IS NOT NULL AND status IN ('ringing', 'active');
