-- ============================================
-- MIGRATION 013: deal_audit_log
-- ============================================
-- Registra QUEM fez O QUE e QUANDO em cada deal.
-- Populado via middleware Express (nao trigger PG),
-- pois o middleware tem acesso a req.user.id e actor_type.
-- ============================================

CREATE TABLE IF NOT EXISTS deal_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Quem fez a acao
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (actor_type IN ('user', 'rica', 'automation', 'system')),

    -- O que foi feito
    action VARCHAR(30) NOT NULL
        CHECK (action IN (
            'created',
            'updated',
            'deleted',
            'stage_changed',
            'owner_assigned',
            'status_changed',
            'activity_added',
            'message_received',
            'file_uploaded',
            'task_created',
            'proposal_generated',
            'email_sent'
        )),

    -- Qual campo mudou (null para create/delete)
    field VARCHAR(100),

    -- Valores antes e depois
    old_value JSONB,
    new_value JSONB,

    -- Contexto adicional (ex: nome do estagio anterior, dados do contato)
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deal_audit_deal       ON deal_audit_log(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_audit_org_user   ON deal_audit_log(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_deal_audit_action     ON deal_audit_log(deal_id, action);

-- ============================================
-- FIM DA MIGRATION 013
-- ============================================
