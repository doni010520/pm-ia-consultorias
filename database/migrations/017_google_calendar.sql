-- ============================================
-- MIGRATION 017: Integracao Google Agenda (por usuario)
-- ============================================
-- Cada usuario conecta a PROPRIA conta Google via OAuth.
-- Guardamos os tokens (refresh_token e access_token) por usuario, e
-- gravamos o id do evento criado no Google em cada atividade agendada,
-- para permitir atualizar/remover o evento depois.
-- ============================================

-- Tokens OAuth do Google por usuario
CREATE TABLE IF NOT EXISTS user_google_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    google_email VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_type VARCHAR(40),
    scope TEXT,
    expiry_date BIGINT,               -- epoch ms de expiracao do access_token
    calendar_id VARCHAR(255) DEFAULT 'primary',
    sync_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_google_tokens_user ON user_google_tokens(user_id);

-- Referencia ao evento criado no Google Agenda a partir de uma atividade
ALTER TABLE deal_activities
    ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS google_calendar_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_deal_activities_google_event
    ON deal_activities(google_event_id)
    WHERE google_event_id IS NOT NULL;

-- ============================================
-- FIM DA MIGRATION 017
-- ============================================
