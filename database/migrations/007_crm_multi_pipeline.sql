-- Migration 007: CRM Multi-Pipeline + Companies + Contacts
-- Rodar no Supabase SQL Editor

-- ============================================
-- 1. Tabela pipelines (multiplos funis por org)
-- ============================================
CREATE TABLE IF NOT EXISTS pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipelines_org ON pipelines(organization_id);

-- ============================================
-- 2. Tabela companies (empresas standalone)
-- ============================================
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    cnpj VARCHAR(20),
    segment VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_companies_org ON companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(organization_id, name);

-- ============================================
-- 3. Tabela contacts (contatos standalone)
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(organization_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);

-- ============================================
-- 4. ALTER tabelas existentes
-- ============================================

-- pipeline_stages ganha pipeline_id
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

-- deals ganha pipeline_id, company_id, contact_id
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);

-- ============================================
-- 5. Migrar dados existentes
-- ============================================
DO $$
DECLARE
    v_org_id UUID;
    v_pipeline_id UUID;
    v_company_id UUID;
    v_contact_id UUID;
    v_deal RECORD;
BEGIN
    -- Para cada organizacao que tem pipeline_stages
    FOR v_org_id IN
        SELECT DISTINCT organization_id FROM pipeline_stages WHERE pipeline_id IS NULL
    LOOP
        -- Criar pipeline "Consultorias" default
        INSERT INTO pipelines (organization_id, name, description, position)
        VALUES (v_org_id, 'Consultorias', 'Pipeline migrado', 0)
        RETURNING id INTO v_pipeline_id;

        -- Vincular stages existentes a esse pipeline
        UPDATE pipeline_stages SET pipeline_id = v_pipeline_id
        WHERE organization_id = v_org_id AND pipeline_id IS NULL;

        -- Vincular deals existentes a esse pipeline
        UPDATE deals SET pipeline_id = v_pipeline_id
        WHERE organization_id = v_org_id AND pipeline_id IS NULL;

        -- Criar companies a partir dos company_name distintos
        INSERT INTO companies (organization_id, name)
        SELECT DISTINCT v_org_id, company_name
        FROM deals
        WHERE organization_id = v_org_id
          AND company_name IS NOT NULL
          AND company_name != ''
          AND company_id IS NULL
        ON CONFLICT DO NOTHING;

        -- Criar contacts a partir dos deals
        FOR v_deal IN
            SELECT DISTINCT ON (contact_phone) id, contact_name, contact_email, contact_phone, company_name
            FROM deals
            WHERE organization_id = v_org_id
              AND contact_id IS NULL
              AND (contact_name IS NOT NULL OR contact_phone IS NOT NULL)
        LOOP
            -- Buscar company_id se tiver company_name
            v_company_id := NULL;
            IF v_deal.company_name IS NOT NULL AND v_deal.company_name != '' THEN
                SELECT id INTO v_company_id FROM companies
                WHERE organization_id = v_org_id AND name = v_deal.company_name
                LIMIT 1;
            END IF;

            -- Criar contact
            INSERT INTO contacts (organization_id, company_id, name, email, phone)
            VALUES (
                v_org_id,
                v_company_id,
                COALESCE(v_deal.contact_name, 'Sem nome'),
                v_deal.contact_email,
                v_deal.contact_phone
            )
            RETURNING id INTO v_contact_id;

            -- Vincular deals com esse telefone ao contact
            UPDATE deals SET
                contact_id = v_contact_id,
                company_id = COALESCE(deals.company_id, v_company_id)
            WHERE organization_id = v_org_id
              AND contact_phone = v_deal.contact_phone
              AND contact_id IS NULL;
        END LOOP;

        -- Vincular deals sem telefone mas com company_name
        UPDATE deals d SET company_id = c.id
        FROM companies c
        WHERE d.organization_id = v_org_id
          AND d.company_id IS NULL
          AND d.company_name IS NOT NULL
          AND d.company_name != ''
          AND c.organization_id = v_org_id
          AND c.name = d.company_name;
    END LOOP;
END $$;

-- ============================================
-- 6. Seed dos 5 funis com estagios default
-- (Executa para cada org, cria funis se nao existirem)
-- ============================================
DO $$
DECLARE
    v_org_id UUID;
    v_pipeline_id UUID;
    v_pos INTEGER;
BEGIN
    FOR v_org_id IN SELECT DISTINCT organization_id FROM pipelines
    LOOP
        -- GPS (se nao existe)
        IF NOT EXISTS (SELECT 1 FROM pipelines WHERE organization_id = v_org_id AND name = 'GPS') THEN
            INSERT INTO pipelines (organization_id, name, description, position)
            VALUES (v_org_id, 'GPS', 'GPS Resultado e GPS Padaria', 1)
            RETURNING id INTO v_pipeline_id;

            INSERT INTO pipeline_stages (organization_id, pipeline_id, name, position, color, is_won, is_lost) VALUES
            (v_org_id, v_pipeline_id, 'Novo Lead', 0, '#94a3b8', false, false),
            (v_org_id, v_pipeline_id, 'Qualificacao', 1, '#3b82f6', false, false),
            (v_org_id, v_pipeline_id, 'Apresentacao', 2, '#8b5cf6', false, false),
            (v_org_id, v_pipeline_id, 'Proposta', 3, '#f59e0b', false, false),
            (v_org_id, v_pipeline_id, 'Ganho', 4, '#22c55e', true, false),
            (v_org_id, v_pipeline_id, 'Perdido', 5, '#ef4444', false, true);
        END IF;

        -- Treinamentos
        IF NOT EXISTS (SELECT 1 FROM pipelines WHERE organization_id = v_org_id AND name = 'Treinamentos') THEN
            INSERT INTO pipelines (organization_id, name, description, position)
            VALUES (v_org_id, 'Treinamentos', 'Mentorias, Trilhas, ISN 2026', 2)
            RETURNING id INTO v_pipeline_id;

            INSERT INTO pipeline_stages (organization_id, pipeline_id, name, position, color, is_won, is_lost) VALUES
            (v_org_id, v_pipeline_id, 'Novo Lead', 0, '#94a3b8', false, false),
            (v_org_id, v_pipeline_id, 'Qualificacao', 1, '#3b82f6', false, false),
            (v_org_id, v_pipeline_id, 'Proposta', 2, '#f59e0b', false, false),
            (v_org_id, v_pipeline_id, 'Inscricao', 3, '#8b5cf6', false, false),
            (v_org_id, v_pipeline_id, 'Ganho', 4, '#22c55e', true, false),
            (v_org_id, v_pipeline_id, 'Perdido', 5, '#ef4444', false, true);
        END IF;

        -- App Alexy
        IF NOT EXISTS (SELECT 1 FROM pipelines WHERE organization_id = v_org_id AND name = 'App Alexy') THEN
            INSERT INTO pipelines (organization_id, name, description, position)
            VALUES (v_org_id, 'App Alexy', 'App de gestao de equipes', 3)
            RETURNING id INTO v_pipeline_id;

            INSERT INTO pipeline_stages (organization_id, pipeline_id, name, position, color, is_won, is_lost) VALUES
            (v_org_id, v_pipeline_id, 'Novo Lead', 0, '#94a3b8', false, false),
            (v_org_id, v_pipeline_id, 'Qualificacao', 1, '#3b82f6', false, false),
            (v_org_id, v_pipeline_id, 'Demo', 2, '#8b5cf6', false, false),
            (v_org_id, v_pipeline_id, 'Proposta', 3, '#f59e0b', false, false),
            (v_org_id, v_pipeline_id, 'Ganho', 4, '#22c55e', true, false),
            (v_org_id, v_pipeline_id, 'Perdido', 5, '#ef4444', false, true);
        END IF;

        -- Jornada da Lucratividade
        IF NOT EXISTS (SELECT 1 FROM pipelines WHERE organization_id = v_org_id AND name = 'Jornada da Lucratividade') THEN
            INSERT INTO pipelines (organization_id, name, description, position)
            VALUES (v_org_id, 'Jornada da Lucratividade', 'JDL - Jornada da Lucratividade na Padaria', 4)
            RETURNING id INTO v_pipeline_id;

            INSERT INTO pipeline_stages (organization_id, pipeline_id, name, position, color, is_won, is_lost) VALUES
            (v_org_id, v_pipeline_id, 'Novo Lead', 0, '#94a3b8', false, false),
            (v_org_id, v_pipeline_id, 'Qualificacao', 1, '#3b82f6', false, false),
            (v_org_id, v_pipeline_id, 'Proposta', 2, '#f59e0b', false, false),
            (v_org_id, v_pipeline_id, 'Negociacao', 3, '#8b5cf6', false, false),
            (v_org_id, v_pipeline_id, 'Ganho', 4, '#22c55e', true, false),
            (v_org_id, v_pipeline_id, 'Perdido', 5, '#ef4444', false, true);
        END IF;
    END LOOP;
END $$;
