-- ============================================
-- MIGRATION 010: deal_messages (Log bruto da conversa Rica)
-- ============================================
-- Separado de deal_insights (que guarda interpretacoes da IA).
-- deal_messages e o log cronologico raw das trocas de mensagens.
-- ============================================

CREATE TABLE IF NOT EXISTS deal_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Quem enviou
    role VARCHAR(20) NOT NULL CHECK (role IN ('client', 'rica', 'agent', 'system')),
    -- client  = mensagem do lead/cliente
    -- rica    = resposta da IA Rica
    -- agent   = mensagem enviada manualmente pelo comercial
    -- system  = evento automatico (ex: "conversa iniciada")

    channel VARCHAR(30) NOT NULL DEFAULT 'whatsapp'
        CHECK (channel IN ('whatsapp', 'email', 'web', 'phone', 'other')),

    content TEXT NOT NULL,

    -- Midia opcional (foto/audio/doc enviado no WhatsApp)
    media_url TEXT,
    media_type VARCHAR(50),  -- image/jpeg, audio/ogg, application/pdf, ...

    -- ID externo para deduplicacao (ID da mensagem no n8n / WhatsApp)
    external_message_id VARCHAR(255),

    -- Sessao da Rica (agrupa uma conversa continua)
    rica_session_id VARCHAR(100),

    metadata JSONB DEFAULT '{}',

    -- Timestamp real da mensagem (pode diferir de created_at em importacoes)
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Evitar duplicatas: mesmo deal + mesmo external_message_id
    CONSTRAINT uq_deal_message_external UNIQUE (deal_id, external_message_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deal_messages_deal        ON deal_messages(deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_messages_session     ON deal_messages(rica_session_id) WHERE rica_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_messages_channel     ON deal_messages(organization_id, channel);

-- ============================================
-- FIM DA MIGRATION 010
-- ============================================
