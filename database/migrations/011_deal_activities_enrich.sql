-- ============================================
-- MIGRATION 011: Enriquecimento de deal_activities
-- ============================================
-- Adiciona campos para registro rico de atividades:
--   outcome    - houve retorno? (replied, no_reply, scheduled, etc.)
--   transcription - colar conversa longa separado da description curta
--   duration_minutes - duracao de ligacoes/reunioes
--   direction  - inbound (cliente entrou em contato) ou outbound (comercial abordou)
-- ============================================

ALTER TABLE deal_activities
    ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)
        CHECK (outcome IN ('replied', 'no_reply', 'scheduled', 'closed', 'no_show', 'other')),
    ADD COLUMN IF NOT EXISTS transcription TEXT,
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS direction VARCHAR(10)
        CHECK (direction IN ('inbound', 'outbound'));

-- Index util para filtrar atividades sem retorno (follow-up pendente)
CREATE INDEX IF NOT EXISTS idx_deal_activities_outcome
    ON deal_activities(deal_id, outcome)
    WHERE outcome IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deal_activities_type_direction
    ON deal_activities(deal_id, type, direction);

-- ============================================
-- FIM DA MIGRATION 011
-- ============================================
