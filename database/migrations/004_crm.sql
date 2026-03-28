-- Migration 004: Modulo CRM - Pipeline de Vendas
-- Rodar no Supabase SQL Editor

-- ============================================
-- 1. pipeline_stages - Etapas do funil de vendas
-- ============================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name VARCHAR(100) NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    color VARCHAR(20) DEFAULT '#3b82f6',
    is_won BOOLEAN DEFAULT false,
    is_lost BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. deals - Oportunidades de venda / leads
-- ============================================
CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    pipeline_stage_id UUID REFERENCES pipeline_stages(id),
    title VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    company_name VARCHAR(255),
    owner_id UUID REFERENCES users(id),
    value DECIMAL(12,2),
    probability INTEGER DEFAULT 0,
    expected_close_date DATE,
    won_date TIMESTAMPTZ,
    lost_date TIMESTAMPTZ,
    lost_reason TEXT,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
    source VARCHAR(50),
    temperature VARCHAR(20) DEFAULT 'warm' CHECK (temperature IN ('hot', 'warm', 'cold')),
    tags TEXT[],
    custom_fields JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. deal_insights - Anotacoes geradas por IA
-- ============================================
CREATE TABLE IF NOT EXISTS deal_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    confidence DECIMAL(3,2),
    source VARCHAR(50) DEFAULT 'ai_agent',
    raw_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 4. deal_activities - Atividades / interacoes
-- ============================================
CREATE TABLE IF NOT EXISTS deal_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    type VARCHAR(30) NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    scheduled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. deal_products - Produtos / servicos do deal
-- ============================================
CREATE TABLE IF NOT EXISTS deal_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    quantity DECIMAL(10,2) DEFAULT 1,
    unit_price DECIMAL(12,2),
    total DECIMAL(12,2),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_deals_organization ON deals(organization_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact_phone ON deals(contact_phone);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON deals(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deal_insights_deal ON deal_insights(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_activities_deal ON deal_activities(deal_id);

-- ============================================
-- Seed: etapas padrao para todas as organizacoes existentes
-- ============================================
INSERT INTO pipeline_stages (organization_id, name, position, color, is_won, is_lost)
SELECT id, stage_name, stage_position, stage_color, stage_is_won, stage_is_lost
FROM organizations CROSS JOIN (VALUES
    ('Novo Lead',      0, '#94a3b8', false, false),
    ('Qualificação',   1, '#3b82f6', false, false),
    ('Apresentação',   2, '#8b5cf6', false, false),
    ('Proposta',       3, '#f59e0b', false, false),
    ('Negociação',     4, '#f97316', false, false),
    ('Ganho',          5, '#22c55e', true,  false),
    ('Perdido',        6, '#ef4444', false, true)
) AS stages(stage_name, stage_position, stage_color, stage_is_won, stage_is_lost);
