-- Migration: Sistema de Convites
-- Execute no Supabase SQL Editor

-- Tabela de convites
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'member',
    token VARCHAR(64) UNIQUE NOT NULL,
    invited_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, accepted, cancelled
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status);

-- Trigger para updated_at (usa a mesma função que já existe no schema)
CREATE TRIGGER tr_invites_updated_at BEFORE UPDATE ON invites
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
