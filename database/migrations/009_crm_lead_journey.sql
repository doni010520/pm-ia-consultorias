-- ============================================
-- MIGRATION 009: Rastreabilidade do Lead (Lead Journey)
-- ============================================
-- Adiciona:
--   1. Campos de rastreabilidade em deals (UTM, canal, sessao Rica)
--   2. Tabela lead_journey_events (fonte de verdade da jornada)
-- ============================================

-- 1. Campos de rastreabilidade em deals
ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_channel VARCHAR(30),   -- whatsapp | email | form | manual | import
    ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100),
    ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(100),
    ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100),
    ADD COLUMN IF NOT EXISTS utm_content VARCHAR(100),
    ADD COLUMN IF NOT EXISTS utm_term VARCHAR(100),
    ADD COLUMN IF NOT EXISTS rica_session_id VARCHAR(100),
    -- cache desnormalizado dos ultimos 50 eventos para leitura rapida no modal
    ADD COLUMN IF NOT EXISTS lead_journey JSONB DEFAULT '[]';

-- 2. Tabela de eventos da jornada (fonte de verdade)
CREATE TABLE IF NOT EXISTS lead_journey_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Tipo de evento (enum fechado)
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
        'lead_created',
        'triagem_entered',
        'qualified',
        'owner_assigned',
        'first_response',
        'meeting_scheduled',
        'proposal_sent',
        'negotiation_started',
        'won',
        'lost',
        'stage_changed',
        'rica_message',
        'activity_logged',
        'task_created',
        'task_completed',
        'file_uploaded',
        'email_sent',
        'email_received'
    )),

    from_value JSONB,   -- estado anterior (ex: { stage_id, stage_name })
    to_value JSONB,     -- estado novo    (ex: { stage_id, stage_name })

    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'rica', 'automation', 'system')),

    -- chave de idempotencia para evitar duplicatas (especialmente da Rica)
    idempotency_key VARCHAR(255),

    metadata JSONB DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_lead_journey_deal       ON lead_journey_events(deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_journey_org_type   ON lead_journey_events(organization_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_journey_actor      ON lead_journey_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_journey_idem       ON lead_journey_events(deal_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Indexes nos novos campos de deals
CREATE INDEX IF NOT EXISTS idx_deals_first_channel     ON deals(organization_id, first_channel);
CREATE INDEX IF NOT EXISTS idx_deals_rica_session      ON deals(rica_session_id) WHERE rica_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_utm_source        ON deals(organization_id, utm_source) WHERE utm_source IS NOT NULL;

-- ============================================
-- FIM DA MIGRATION 009
-- ============================================
