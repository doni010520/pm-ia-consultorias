-- Migration 006: CRM Avancado - SLA, Automacoes, Aging
-- Rodar no Supabase SQL Editor

-- ============================================
-- 1. Campos de SLA e configuracao nas etapas
-- ============================================
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS max_days INTEGER; -- tempo maximo em dias
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS auto_assign_owner BOOLEAN DEFAULT false;

-- ============================================
-- 2. Campos extras nos deals
-- ============================================
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ DEFAULT NOW(); -- quando entrou na etapa atual
ALTER TABLE deals ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_follow_up TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS follow_up_notes TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0; -- lead scoring 0-100
ALTER TABLE deals ADD COLUMN IF NOT EXISTS converted_project_id UUID REFERENCES projects(id);

-- ============================================
-- 3. deal_automations - Automacoes criadas pelo usuario
-- ============================================
CREATE TABLE IF NOT EXISTS deal_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,

    -- Trigger
    trigger_type VARCHAR(50) NOT NULL, -- stage_change, time_in_stage, field_change, deal_created, deal_won, deal_lost
    trigger_config JSONB NOT NULL DEFAULT '{}',
    -- stage_change: { from_stage_id, to_stage_id } (null = qualquer)
    -- time_in_stage: { stage_id, days }
    -- field_change: { field, old_value, new_value }
    -- deal_created: {}
    -- deal_won/deal_lost: {}

    -- Action
    action_type VARCHAR(50) NOT NULL, -- send_whatsapp, send_email, create_task, move_stage, change_field, notify_owner, assign_owner
    action_config JSONB NOT NULL DEFAULT '{}',
    -- send_whatsapp: { template, to_field }
    -- send_email: { subject, body, to_field }
    -- create_task: { title, description, due_days }
    -- move_stage: { stage_id }
    -- change_field: { field, value }
    -- notify_owner: { message }
    -- assign_owner: { user_id }

    executions_count INTEGER DEFAULT 0,
    last_executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 4. deal_automation_log - Historico de execucoes
-- ============================================
CREATE TABLE IF NOT EXISTS deal_automation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES deal_automations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    trigger_data JSONB,
    action_result JSONB,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. deal_contacts - Multiplos contatos por deal
-- ============================================
CREATE TABLE IF NOT EXISTS deal_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(100), -- decisor, influenciador, usuario, financeiro
    is_primary BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_deal_automations_org ON deal_automations(organization_id);
CREATE INDEX IF NOT EXISTS idx_deal_automations_trigger ON deal_automations(trigger_type);
CREATE INDEX IF NOT EXISTS idx_deal_automation_log_automation ON deal_automation_log(automation_id);
CREATE INDEX IF NOT EXISTS idx_deal_automation_log_deal ON deal_automation_log(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_contacts_deal ON deal_contacts(deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage_entered ON deals(stage_entered_at);
CREATE INDEX IF NOT EXISTS idx_deals_last_activity ON deals(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_deals_next_follow_up ON deals(next_follow_up);
