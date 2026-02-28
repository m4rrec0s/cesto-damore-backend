ALTER TABLE IF EXISTS n8n_chat_histories
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS n8n_chat_histories_session_id_createdAt_idx
ON n8n_chat_histories(session_id, "createdAt");
