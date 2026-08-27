-- ============================================
-- MIGRATION 009: Rastreabilidade total de leads
-- ============================================
-- Adiciona:
--   1. Colunas em deals para rastrear origem detalhada e como/quando foi atribuido
--   2. Tabela deal_messages para historico completo de mensagens (in/out) Rica<->Cliente
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

-- 2. Tabela deal_messages - historico completo de mensagens
CREATE TABLE IF NOT EXISTS deal_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,    -- pode ser null se deal ainda nao existe
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    contact_phone VARCHAR(50) NOT NULL,                     -- normalizado, sempre presente

    direction VARCHAR(10) NOT NULL,                         -- 'in' (cliente) | 'out' (rica/sistema)
    sender VARCHAR(50),                                     -- 'cliente' | 'rica_ai' | 'system_followup' | 'executive' | 'system_catchup'
    content_type VARCHAR(20) DEFAULT 'text',                -- 'text' | 'image' | 'audio' | 'document' | 'system_note'
    text TEXT,                                              -- conteudo principal
    media_url TEXT,                                         -- url de media se aplicavel
    raw_payload JSONB,                                      -- payload bruto pra debug

    n8n_execution_id VARCHAR(50),                           -- id da execucao n8n correspondente
    workflow_name VARCHAR(100),                             -- nome do workflow

    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),             -- quando a mensagem foi efetivamente enviada/recebida
    created_at TIMESTAMPTZ DEFAULT NOW()                    -- quando o registro foi gravado
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_deal_messages_phone
    ON deal_messages (organization_id, contact_phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_messages_deal
    ON deal_messages (deal_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_deal_messages_contact
    ON deal_messages (contact_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_deal_messages_direction
    ON deal_messages (organization_id, direction, sent_at DESC);

-- ============================================
-- FIM DA MIGRATION 009
-- ============================================
