-- ============================================
-- MIGRATION 009b: Rastreabilidade total de leads (origem + atribuicao)
-- ============================================
-- RENUMERADA: este arquivo se chamava 009_rastreabilidade.sql e COLIDIA com
-- 009_crm_lead_journey.sql (dois arquivos "009" na mesma pasta). Renomeado para
-- 009b para deixar a ordem de execucao deterministica:
--     ... -> 008 -> 009 (crm_lead_journey) -> 009b (rastreabilidade) -> 010 ...
--
-- Adiciona:
--   1. Colunas em deals para rastrear origem detalhada e como/quando foi atribuido
--   2. (REMOVIDO) criacao da tabela deal_messages -- ver nota no fim do arquivo
-- ============================================

-- 1. Novas colunas em deals
ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS source_detail VARCHAR(100),     -- ex: 'anuncio_gps_padaria', 'anuncio_eneagrama', 'organico'
    ADD COLUMN IF NOT EXISTS assigned_via VARCHAR(50),       -- 'notificar_equipe' | 'manual' | 'catchup' | 'reassigned' | 'register_lead'
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,        -- quando o owner_id foi setado
    ADD COLUMN IF NOT EXISTS assigned_by VARCHAR(100);       -- 'system' | 'rica_ai' | uuid do user humano

-- Index pra queries de auditoria (rastreabilidade)
CREATE INDEX IF NOT EXISTS idx_deals_source_detail
    ON deals (organization_id, source_detail);
CREATE INDEX IF NOT EXISTS idx_deals_assigned
    ON deals (organization_id, owner_id, assigned_at, assigned_via);

-- Backfill: para deals existentes com owner_id, marca assigned_at = updated_at e via = 'historico'
UPDATE deals
SET assigned_via = 'historico',
    assigned_at = COALESCE(updated_at, created_at),
    assigned_by = 'unknown'
WHERE owner_id IS NOT NULL AND assigned_via IS NULL;

-- ============================================
-- 2. deal_messages -- DEFINICAO REMOVIDA DESTE ARQUIVO
-- ============================================
-- Esta migration criava `deal_messages` com o schema
--   (contact_phone, direction, sender, content_type, text, media_url,
--    raw_payload, n8n_execution_id, workflow_name, sent_at)
-- que e INCOMPATIVEL com o schema criado por 010_deal_messages.sql
--   (role, channel, content, media_type, external_message_id,
--    rica_session_id, metadata, occurred_at).
--
-- Como as duas usavam CREATE TABLE IF NOT EXISTS, o resultado dependia de qual
-- rodasse primeiro -- nao-deterministico.
--
-- DECISAO: a definicao CANONICA de deal_messages e a de `010_deal_messages.sql`,
-- porque e o schema que o codigo da API realmente usa
-- (api/src/routes/crm.js: POST /messages, POST /deals/:id/messages,
--  GET /deals/:id/messages, GET /contacts/by-phone/:phone/messages).
--
-- A migration `018_fechamento_deriva_schema.sql` reconcilia bancos que ja
-- tenham a versao antiga desta tabela (adiciona as colunas do 010 e relaxa as
-- NOT NULL herdadas do schema antigo).
-- ============================================

-- ============================================
-- FIM DA MIGRATION 009b
-- ============================================
