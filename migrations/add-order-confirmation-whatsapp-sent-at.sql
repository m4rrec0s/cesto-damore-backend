ALTER TABLE orders
ADD COLUMN IF NOT EXISTS confirmation_whatsapp_sent_at TIMESTAMP;