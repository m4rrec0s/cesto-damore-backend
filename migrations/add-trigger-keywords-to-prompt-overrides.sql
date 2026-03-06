-- Alterar a tabela para adicionar a coluna trigger_keywords
ALTER TABLE llm_prompt_priority_instructions ADD COLUMN IF NOT EXISTS trigger_keywords TEXT;
