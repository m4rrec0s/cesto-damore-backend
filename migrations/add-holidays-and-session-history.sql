-- Migration: Add Holiday and AISessionProductHistory tables
-- Created: 2026-01-07
-- Description: Adds support for holiday closures and product history tracking in AI sessions

-- Create Holiday table for storing shop closure dates
CREATE TABLE IF NOT EXISTS "Holiday" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  closure_type VARCHAR(50) NOT NULL DEFAULT 'full_day', -- 'full_day' or 'custom'
  duration_hours INT, -- For custom closures
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for querying active holidays
CREATE INDEX IF NOT EXISTS "idx_holiday_start_date" ON "Holiday"(start_date);
CREATE INDEX IF NOT EXISTS "idx_holiday_is_active" ON "Holiday"(is_active);

-- Create AISessionProductHistory table to track sent products in conversations
CREATE TABLE IF NOT EXISTS "AISessionProductHistory" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  product_id UUID NOT NULL,
  sent_count INT DEFAULT 1,
  last_sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session FOREIGN KEY (session_id) REFERENCES "AIAgentSession"(id) ON DELETE CASCADE,
  CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES "Product"(id) ON DELETE CASCADE,
  CONSTRAINT uq_session_product UNIQUE (session_id, product_id)
);

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS "idx_ai_session_product_session" ON "AISessionProductHistory"(session_id);
CREATE INDEX IF NOT EXISTS "idx_ai_session_product_product" ON "AISessionProductHistory"(product_id);

-- Example: Insert some common holidays for 2026
-- Uncomment to use:
-- INSERT INTO "Holiday" (name, start_date, end_date, closure_type, description, is_active)
-- VALUES
--   ('Ano Novo', '2026-01-01'::date, '2026-01-01'::date, 'full_day', 'Feriado - 1º de janeiro', true),
--   ('Tiradentes', '2026-04-21'::date, '2026-04-21'::date, 'full_day', 'Feriado - Tiradentes', true),
--   ('Dia do Trabalho', '2026-05-01'::date, '2026-05-01'::date, 'full_day', 'Feriado - Dia do Trabalho', true),
--   ('Corpus Christi', '2026-05-14'::date, '2026-05-14'::date, 'full_day', 'Feriado - Corpus Christi', true),
--   ('Independência', '2026-09-07'::date, '2026-09-07'::date, 'full_day', 'Feriado - Independência', true),
--   ('Padroeira do Brasil', '2026-10-12'::date, '2026-10-12'::date, 'full_day', 'Feriado - Nossa Senhora Aparecida', true),
--   ('Finados', '2026-11-02'::date, '2026-11-02'::date, 'full_day', 'Feriado - Finados', true),
--   ('República', '2026-11-15'::date, '2026-11-15'::date, 'full_day', 'Feriado - Proclamação da República', true),
--   ('Consciência Negra', '2026-11-20'::date, '2026-11-20'::date, 'full_day', 'Feriado - Consciência Negra', true),
--   ('Natal', '2026-12-25'::date, '2026-12-25'::date, 'full_day', 'Feriado - Natal', true),
--   ('Férias da Loja', '2026-01-15'::date, '2026-01-17'::date, 'full_day', 'Fechado para manutenção', true);
