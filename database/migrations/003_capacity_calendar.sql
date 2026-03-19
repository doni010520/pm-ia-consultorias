-- Migration 003: Calendario de Capacidade dos Consultores
-- Rodar no Supabase SQL Editor

-- Tabela de bloqueios (ferias, licenca, etc)
CREATE TABLE IF NOT EXISTS consultant_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR(255),
    block_type VARCHAR(50) DEFAULT 'vacation', -- vacation, leave, holiday, training, other
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_consultant_blocks_user ON consultant_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_consultant_blocks_dates ON consultant_blocks(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_consultant_blocks_org ON consultant_blocks(organization_id);

-- Cor do projeto (para barras coloridas no Gantt)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#3b82f6';
